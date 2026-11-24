import asyncio, shutil, uuid, json, re
from datetime import datetime, timezone
from pathlib import Path
from fastapi import (
    FastAPI,
    Depends,
    UploadFile,
    File,
    Form,
    HTTPException,
    BackgroundTasks,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict

from app.core.auth import get_user_id, check_user_access
from app.services.access import assert_access, ensure_profile as access_profile
from app.db import get_db
from app.models import (
    Profile,
    PortfolioFile,
    ChatMessage,
    Task,
    TaskStep,
    AgentAudit,
    Lesson,
    LessonMaterial,
)
from app.db import SessionLocal
from app.services.documents import (
    extract_document,
    extract_structured_rup,
    create_test_docx,
    create_material_docx,
    create_presentation,
)
from app.services.security import prompt_injection_detected
from app.services.llm import generate, LLMConfigurationError
from app.services.storage import upload_private, download_private
from app.services.agents import analyze_request
from app.core.config import get_settings

app = FastAPI(title="AI EDU 2.0 API", version="0.1.0")
_settings = get_settings()
_cors_origins = _settings.allowed_cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=r"https://[a-zA-Z0-9-]+\.vercel\.app",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def ensure_profile(db: Session, user_id: str) -> Profile:
    return access_profile(db, user_id)


def record_event(db, owner_id, agent, action, lesson_id=None, **details):
    payload = {"at": datetime.now(timezone.utc).isoformat(), **details}
    if lesson_id:
        payload["lesson_id"] = lesson_id
    db.add(
        AgentAudit(
            owner_id=owner_id, agent=agent, action=action, input={}, output=payload
        )
    )
    db.commit()


@app.get("/events")
def events(
    after: int = 0, db: Session = Depends(get_db), user_id: str = Depends(get_user_id)
):
    rows = (
        db.query(AgentAudit)
        .filter(AgentAudit.owner_id == user_id, AgentAudit.id > after)
        .order_by(AgentAudit.id.desc())
        .limit(200)
        .all()
    )
    return [
        {
            "id": r.id,
            "agent": r.agent,
            "action": r.action,
            "details": r.output or {},
            "at": (r.output or {}).get("at"),
        }
        for r in reversed(rows)
    ]


class LessonReview(BaseModel):
    decision: str
    comment: str = ""


@app.post("/lessons/{lesson_id}/review")
def review_lesson(
    lesson_id: str,
    payload: LessonReview,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id),
):
    lesson = (
        db.query(Lesson)
        .filter(Lesson.id == lesson_id, Lesson.owner_id == user_id)
        .first()
    )
    if not lesson:
        raise HTTPException(404, "Занятие не найдено")
    if payload.decision not in ("approved", "revision"):
        raise HTTPException(422, "Неизвестное решение")
    if lesson.status != "completed":
        raise HTTPException(409, "Сначала дождитесь завершения всех материалов")
    record_event(
        db,
        user_id,
        "teacher",
        "lesson_review",
        lesson_id,
        decision=payload.decision,
        comment=payload.comment[:2000],
    )
    return {"id": lesson_id, "review": payload.decision}


@app.get("/health")
def health():
    return {"status": "ok", "service": "ai-edu-2-api"}


@app.get("/profile")
def profile(db: Session = Depends(get_db), user_id: str = Depends(get_user_id)):
    p = ensure_profile(db, user_id)
    return {"id": p.id, "full_name": p.full_name, "institution": p.institution}


class ProfileUpdate(BaseModel):
    # Legacy frontend round-trips the id received from GET /profile. It is never authority.
    id: str | None = None
    model_config = ConfigDict(extra="forbid")
    full_name: str | None = None
    institution: str | None = None


@app.put("/profile")
def update_profile(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id),
):
    if payload.id is not None and payload.id != user_id:
        raise HTTPException(403, "Нельзя изменять профиль другого пользователя.")
    p = ensure_profile(db, user_id)
    p.full_name = payload.full_name
    p.institution = payload.institution
    db.commit()
    return {"id": p.id, "full_name": p.full_name, "institution": p.institution}


class RupConfirm(BaseModel):
    subject: str | None = None
    grade: str | None = None
    groups: str | None = None
    topics: list[dict] | None = None
    assessment_criteria: str | None = None


@app.post("/portfolio/upload")
async def upload(
    category: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id),
):
    if category not in ("тарификация", "РУП", "расписание", "оценки", "шаблоны"):
        raise HTTPException(400, "Недопустимая категория портфеля")
    if not Path(file.filename or "").suffix.lower() in (".docx", ".xlsx", ".pdf"):
        raise HTTPException(400, "Разрешены DOCX, XLSX и PDF")
    ensure_profile(db, user_id)
    storage_dir = Path("./storage") / user_id
    storage_dir.mkdir(parents=True, exist_ok=True)
    name = f'{uuid.uuid4().hex}_{Path(file.filename or "document").name}'
    path = storage_dir / name
    size = 0
    with path.open("wb") as output:
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > 20 * 1024 * 1024:
                output.close()
                path.unlink(missing_ok=True)
                raise HTTPException(413, "Максимальный размер файла — 20 МБ")
            output.write(chunk)
    try:
        if path.suffix.lower() in (".docx", ".xlsx"):
            from zipfile import ZipFile

            with ZipFile(path) as archive:
                if sum(i.file_size for i in archive.infolist()) > 80 * 1024 * 1024:
                    raise ValueError("Слишком большой распакованный документ")
        text = extract_document(str(path), file.filename or "")
    except Exception as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(
            422, "Не удалось прочитать документ. Проверьте формат и целостность файла."
        ) from exc
    detected = prompt_injection_detected(text)
    if detected:
        path.unlink(missing_ok=True)
        raise HTTPException(
            422,
            "В документе обнаружены признаки prompt injection. Файл отклонён и не сохранён.",
        )
    structured = extract_structured_rup(text) if category == "РУП" else None
    try:
        persistent_path = await upload_private(
            user_id, path, file.filename or name, file.content_type
        )
    except Exception as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(502, str(exc)) from exc
    item = PortfolioFile(
        owner_id=user_id,
        category=category,
        filename=file.filename or name,
        storage_path=persistent_path,
        mime_type=file.content_type,
        extracted_text=text,
        structured_data=structured,
        confirmed=False,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    record_event(
        db,
        user_id,
        "portfolio",
        "upload_document",
        filename=item.filename,
        category=category,
        file_id=item.id,
    )
    return {
        "id": item.id,
        "filename": item.filename,
        "category": category,
        "extracted_preview": text[:500],
        "structured_data": structured,
        "prompt_injection_detected": detected,
        "confirmed": False,
    }


@app.post("/portfolio/{file_id}/confirm")
def confirm_file(
    file_id: str,
    payload: RupConfirm,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id),
):
    item = (
        db.query(PortfolioFile)
        .filter(PortfolioFile.id == file_id, PortfolioFile.owner_id == user_id)
        .first()
    )
    if not item:
        raise HTTPException(404, "Файл не найден")
    if not payload.topics:
        raise HTTPException(422, "Подтвердите хотя бы одну тему РУП")
    cleaned_topics = []
    for topic in payload.topics:
        title = str(topic.get("title", "")).strip()
        if title:
            cleaned_topics.append(
                {
                    "title": title,
                    "hours": topic.get("hours"),
                    "lesson_type": topic.get("lesson_type"),
                }
            )
    if not cleaned_topics:
        raise HTTPException(422, "Название темы не может быть пустым")
    original = item.structured_data or {}
    item.structured_data = {
        **original,
        "subject": payload.subject,
        "grade": payload.grade,
        "groups": payload.groups,
        "topics": cleaned_topics,
        "assessment_criteria": payload.assessment_criteria,
    }
    item.confirmed = True
    db.commit()
    db.refresh(item)
    record_event(db, user_id, "methodist", "confirm_rup", file_id=file_id)
    return {"id": item.id, "confirmed": True, "structured_data": item.structured_data}


@app.get("/portfolio")
def list_files(db: Session = Depends(get_db), user_id: str = Depends(get_user_id)):
    items = (
        db.query(PortfolioFile)
        .filter(PortfolioFile.owner_id == user_id)
        .order_by(PortfolioFile.id.desc())
        .all()
    )
    return [
        {
            "id": i.id,
            "filename": i.filename,
            "category": i.category,
            "confirmed": i.confirmed,
            "prompt_injection_detected": prompt_injection_detected(
                i.extracted_text or ""
            ),
        }
        for i in items
    ]


@app.get("/portfolio/{file_id}/download")
async def download_file(
    file_id: str, db: Session = Depends(get_db), user_id: str = Depends(get_user_id)
):
    item = (
        db.query(PortfolioFile)
        .filter(PortfolioFile.id == file_id, PortfolioFile.owner_id == user_id)
        .first()
    )
    if not item:
        raise HTTPException(404, "Файл не найден")
    destination = await download_private(
        item.storage_path,
        Path("./generated")
        / user_id
        / f"{uuid.uuid4().hex}_{Path(item.filename).name}",
    )
    if not destination:
        raise HTTPException(404, "Файл недоступен в приватном хранилище")
    return FileResponse(str(destination), filename=item.filename)


class ChatRequest(BaseModel):
    content: str


@app.post("/chat/messages")
async def chat(
    payload: ChatRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user_id: str = Depends(check_user_access),
):
    ensure_profile(db, user_id)
    db.add(
        ChatMessage(
            owner_id=user_id, role="teacher", content=payload.content, attachments=[]
        )
    )
    db.commit()

    if any(
        word in payload.content.lower()
        for word in ("комплект", "план урока", "лекци", "презентац")
    ):
        sources = (
            db.query(PortfolioFile)
            .filter(
                PortfolioFile.owner_id == user_id,
                PortfolioFile.confirmed == True,
                PortfolioFile.category == "РУП",
            )
            .all()
        )
        candidates = [
            (source, topic)
            for source in sources
            for topic in (source.structured_data or {}).get("topics", [])
        ]
        request = payload.content.lower()
        matches = [
            (source, topic)
            for source, topic in candidates
            if topic.get("title", "").lower() in request
            or (
                re.search(r"теме?\s+(\d+(?:\.\d+)*)", request)
                and re.match(
                    r"^"
                    + re.escape(re.search(r"теме?\s+(\d+(?:\.\d+)*)", request).group(1))
                    + r"(?:\D|$)",
                    topic.get("title", ""),
                )
            )
        ]
        if len(matches) != 1:
            answer = "Укажите точное название темы из подтверждённой РУП. " + (
                "РУП ещё не подтверждена."
                if not candidates
                else "Найдено совпадений: " + str(len(matches))
            )
            db.add(
                ChatMessage(
                    owner_id=user_id, role="coordinator", content=answer, attachments=[]
                )
            )
            db.commit()
            return {"status": "awaiting_information", "message": answer}
        source, topic = matches[0]
        try:
            result = await create_lesson(
                LessonCreate(
                    portfolio_file_id=source.id,
                    topic=topic["title"],
                    hours=str(topic["hours"]) if topic.get("hours") else None,
                    lesson_type=topic.get("lesson_type"),
                ),
                background_tasks,
                db,
                user_id,
            )
        except HTTPException as exc:
            db.add(
                ChatMessage(
                    owner_id=user_id,
                    role="system",
                    content=str(exc.detail),
                    attachments=[],
                )
            )
            db.commit()
            raise
        answer = "Создано занятие «" + topic["title"] + "». Генерация передана backend."
        db.add(
            ChatMessage(
                owner_id=user_id, role="coordinator", content=answer, attachments=[]
            )
        )
        db.commit()
        return {**result, "message": answer}

    plan = await analyze_request(db, user_id, payload.content)
    text = payload.content.lower()
    mentions = []
    for name, role in [
        ("методист", "methodist"),
        ("креатив", "creative"),
        ("ассистент", "assessment"),
        ("координатор", "coordinator"),
    ]:
        if "@" + name in text:
            mentions.append(role)

    missing = plan["missing"]
    if missing:
        answer = (
            "Недостаточно подтвержденных данных: "
            + "; ".join(missing)
            + ". Запросите у преподавателя недостающую информацию в портфеле."
        )
        db.add(
            ChatMessage(
                owner_id=user_id, role="coordinator", content=answer, attachments=[]
            )
        )
        db.commit()
        db.add(
            AgentAudit(
                owner_id=user_id,
                agent="coordinator",
                action="request_missing_information",
                input={"request": payload.content, "mentions": mentions},
                output={"missing": missing},
            )
        )
        db.commit()
        return {"status": "awaiting_information", "message": answer, "missing": missing}

    if not plan["needs_control"]:
        answer = "Запрос принят координатором. Уточните: контрольная работа, план урока, РУП или воспитательное мероприятие."
        db.add(
            ChatMessage(
                owner_id=user_id, role="coordinator", content=answer, attachments=[]
            )
        )
        db.commit()
        return {
            "status": "pending",
            "message": answer,
            "roles": plan["roles"],
            "mentions": mentions,
        }

    from app.services.llm import check_availability

    availability = await check_availability()
    if not availability["available"]:
        db.add(
            ChatMessage(
                owner_id=user_id,
                role="system",
                content=availability["error"],
                attachments=[],
            )
        )
        db.commit()
        raise HTTPException(503, availability["error"])
    task = Task(
        owner_id=user_id,
        title="Подготовить контрольную и практический кейс",
        description=payload.content,
        status="assigned",
        assigned_agent="assessment",
        dependencies=[
            "methodist:inputs",
            "assessment:test",
            "creative:case",
            "methodist:review",
        ],
    )
    db.add(task)
    db.flush()
    titles = [
        ("methodist", "Проверить подтверждённые темы и часы", "methodist"),
        ("assessment", "Создать контрольную и ключи", "methodist"),
        ("creative", "Добавить практический кейс", "assessment"),
        ("methodist", "Проверить итоговый комплект", "creative"),
    ]
    for agent, title, dependency in titles:
        db.add(
            TaskStep(
                task_id=task.id,
                owner_id=user_id,
                agent=agent,
                title=title,
                status="pending",
                depends_on=(
                    []
                    if dependency == "methodist"
                    and title.startswith("Проверить подтверждённые")
                    else [dependency]
                ),
            )
        )
    db.commit()
    db.refresh(task)

    db.add(
        AgentAudit(
            owner_id=user_id,
            agent="coordinator",
            action="create_task_plan",
            input={"request": payload.content, "mentions": mentions},
            output={
                "task_id": task.id,
                "roles": plan["roles"],
                "topics": plan["topics"],
                "source_documents": plan["confirmed_documents"],
            },
        )
    )
    db.commit()
    db.add(
        ChatMessage(
            owner_id=user_id,
            role="coordinator",
            content="Координатор создал цепочку: Методист → Ассистент → Креативщик → Методист.",
            attachments=[],
        )
    )
    db.commit()

    from app.services.background import dispatch_agent_team

    task.celery_task_id = await asyncio.to_thread(
        dispatch_agent_team, background_tasks, task.id, user_id
    )
    db.commit()

    return {
        "status": "running",
        "task_id": task.id,
        "message": "Поручение передано команде ИИ-агентов. Результат сохранится в задаче и чате.",
        "roles": plan["roles"],
        "topics": plan["topics"],
        "source_documents": plan["confirmed_documents"],
    }


class LessonCreate(BaseModel):
    portfolio_file_id: str
    topic: str
    group_name: str | None = None
    hours: str | None = None
    lesson_type: str | None = None


class MaterialUpdate(BaseModel):
    content: str


@app.get("/portfolio/{file_id}")
def get_portfolio_file(
    file_id: str, db: Session = Depends(get_db), user_id: str = Depends(get_user_id)
):
    item = (
        db.query(PortfolioFile)
        .filter(PortfolioFile.id == file_id, PortfolioFile.owner_id == user_id)
        .first()
    )
    if not item:
        raise HTTPException(404, "Файл не найден")
    return {
        "id": item.id,
        "filename": item.filename,
        "category": item.category,
        "confirmed": item.confirmed,
        "structured_data": item.structured_data,
        "extracted_preview": (item.extracted_text or "")[:5000],
    }


async def generate_lesson_materials(lesson_id: str, owner_id: str):
    db = SessionLocal()
    try:
        lesson = (
            db.query(Lesson)
            .filter(Lesson.id == lesson_id, Lesson.owner_id == owner_id)
            .first()
        )
        if not lesson:
            return
        rup = (
            db.query(PortfolioFile)
            .filter(
                PortfolioFile.id == lesson.portfolio_file_id,
                PortfolioFile.owner_id == owner_id,
            )
            .first()
        )
        if not rup:
            lesson.status = "failed"
            db.commit()
            return
        try:
            assert_access(db, owner_id)
        except HTTPException as exc:
            lesson.status = "failed"
            for item in (
                db.query(LessonMaterial)
                .filter(
                    LessonMaterial.lesson_id == lesson_id,
                    LessonMaterial.owner_id == owner_id,
                )
                .all()
            ):
                item.status = "failed"
                item.error = exc.detail
            db.commit()
            record_event(
                db,
                owner_id,
                "coordinator",
                "lesson_failed",
                lesson_id,
                error=exc.detail,
            )
            return
        base = {
            "subject": (rup.structured_data or {}).get("subject"),
            "groups": lesson.group_name or (rup.structured_data or {}).get("groups"),
            "topic": lesson.topic,
            "hours": lesson.hours,
            "lesson_type": lesson.lesson_type,
            "criteria": (rup.structured_data or {}).get("assessment_criteria"),
        }
        lesson.status = "running"
        record_event(db, owner_id, "coordinator", "analysis_started", lesson_id)
        lesson.agent_progress = {
            "coordinator": "running",
            "methodist": "pending",
            "creative": "pending",
            "assessment": "pending",
        }
        db.commit()
        db.add(
            AgentAudit(
                owner_id=owner_id,
                agent="coordinator",
                action="start_lesson_generation",
                input={"lesson_id": lesson_id, "topic": lesson.topic},
                output={"materials": 4},
            )
        )
        db.commit()
        specifications = [
            ("plan", "План занятия"),
            ("lecture", "Подробная лекция"),
            ("practice", "Практическая работа"),
            ("presentation", "Презентация"),
        ]
        Path("./generated").mkdir(parents=True, exist_ok=True)
        for material_type, title in specifications:
            material = (
                db.query(LessonMaterial)
                .filter(
                    LessonMaterial.lesson_id == lesson_id,
                    LessonMaterial.material_type == material_type,
                )
                .first()
            )
            assigned = {
                "plan": "methodist",
                "lecture": "methodist",
                "practice": "assessment",
                "presentation": "creative",
            }[material_type]
            material.status = "running"
            material.error = None
            progress = dict(lesson.agent_progress or {})
            progress["coordinator"] = "completed"
            progress[assigned] = "running"
            lesson.agent_progress = progress
            db.commit()
            record_event(
                db,
                owner_id,
                assigned,
                "material_started",
                lesson_id,
                material_type=material_type,
                material_id=material.id,
            )
            db.add(
                AgentAudit(
                    owner_id=owner_id,
                    agent=assigned,
                    action="generate_" + material_type,
                    input={"lesson_id": lesson_id, "topic": lesson.topic},
                    output={"title": title},
                )
            )
            db.commit()
            prompt = f"""Создай {title} по учебной теме. Используй ТОЛЬКО следующие данные РУП и запрет запрограммированного выдумывания:\n"""
            prompt += f"Дисциплина: {base['subject'] or 'не указана'}\nГруппа: {base['groups'] or 'не указана'}\nТема: {base['topic']}\nЧасы занятия: {base['hours'] or 'не указаны в РУП'}\nВид занятия: {base['lesson_type'] or 'не указан'}\nКритерии оценивания: {base['criteria'] or 'не указаны в РУП'}\n"
            prompt += (
                "Подтверждённые пользователем данные РУП:\n"
                + json.dumps(rup.structured_data or {}, ensure_ascii=False)[:14000]
            )
            prompt += "\nНе добавляй темы, часы, оборудование, возраст, нормативы или баллы, которых нет в РУП. Верни содержательный материал с заголовками и разделами. Для практической работы укажи цель, задания, ход выполнения и критерии; для плана — этапы, время и действия; для презентации — структуру слайдов."
            system = "Ты Координатор и команда преподавательских ИИ-агентов: Методист, Креативщик и Ассистент по оцениванию. Методист обеспечивает соответствие РУП, Креативщик — методическую практичность, Ассистент — критерии оценивания. Вы не выдумываете факты."
            try:
                content = await generate(
                    prompt,
                    system,
                    user_id=owner_id,
                    agent_type=assigned,
                    action_type=material_type,
                )
                if len(content.strip()) < 300:
                    raise RuntimeError(
                        "Проверка качества не пройдена: получен слишком короткий материал"
                    )
                if (
                    lesson.topic.lower() not in content.lower()
                    and lesson.topic[:20].lower() not in content.lower()
                ):
                    raise RuntimeError(
                        "Проверка качества не пройдена: тема занятия отсутствует в результате"
                    )
                material.content = content.strip()
                material.status = "completed"
                if material_type == "presentation":
                    path = Path("./generated") / f"{lesson_id}-presentation.pptx"
                    create_presentation(str(path), title, content)
                else:
                    path = Path("./generated") / f"{lesson_id}-{material_type}.docx"
                    create_material_docx(str(path), title, content)
                stored = await upload_private(
                    owner_id,
                    path,
                    path.name,
                    (
                        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                        if material_type == "presentation"
                        else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    ),
                )
                material.file_path = stored
                record_event(
                    db,
                    owner_id,
                    assigned,
                    "material_completed",
                    lesson_id,
                    material_type=material_type,
                    material_id=material.id,
                )
                progress = dict(lesson.agent_progress or {})
                progress[assigned] = "completed"
                lesson.agent_progress = progress
                db.commit()
            except Exception as exc:
                material.status = "failed"
                material.error = str(exc)
                record_event(
                    db,
                    owner_id,
                    assigned,
                    "material_failed",
                    lesson_id,
                    material_type=material_type,
                    error=str(exc),
                )
                progress = dict(lesson.agent_progress or {})
                progress[assigned] = "failed"
                lesson.agent_progress = progress
                db.commit()
        statuses = [
            m.status
            for m in db.query(LessonMaterial)
            .filter(LessonMaterial.lesson_id == lesson_id)
            .all()
        ]
        lesson.status = (
            "completed"
            if statuses and all(s == "completed" for s in statuses)
            else "failed"
        )
        db.commit()
        record_event(db, owner_id, "coordinator", "lesson_" + lesson.status, lesson_id)
    finally:
        db.close()


@app.post("/lessons/generate")
async def create_lesson(
    payload: LessonCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user_id: str = Depends(check_user_access),
):
    rup = (
        db.query(PortfolioFile)
        .filter(
            PortfolioFile.id == payload.portfolio_file_id,
            PortfolioFile.owner_id == user_id,
        )
        .first()
    )
    if not rup:
        raise HTTPException(404, "Подтвержденная РУП не найдена")
    if not rup.confirmed or rup.category.lower() != "руп":
        raise HTTPException(409, "Сначала подтвердите распознанные данные РУП")
    if not payload.topic.strip():
        raise HTTPException(422, "Укажите тему занятия")
    from app.services.llm import check_availability

    availability = await check_availability()
    if not availability["available"]:
        raise HTTPException(503, availability["error"])
    lesson = Lesson(
        owner_id=user_id,
        portfolio_file_id=rup.id,
        topic=payload.topic.strip(),
        group_name=payload.group_name,
        hours=payload.hours,
        lesson_type=payload.lesson_type,
        status="pending",
    )
    db.add(lesson)
    db.flush()
    for material_type, title in [
        ("plan", "План занятия"),
        ("lecture", "Подробная лекция"),
        ("practice", "Практическая работа"),
        ("presentation", "Презентация"),
    ]:
        db.add(
            LessonMaterial(
                owner_id=user_id,
                lesson_id=lesson.id,
                material_type=material_type,
                title=title,
                status="pending",
                content="",
            )
        )
    db.commit()
    db.refresh(lesson)
    record_event(
        db, user_id, "coordinator", "lesson_queued", lesson.id, topic=lesson.topic
    )
    background_tasks.add_task(generate_lesson_materials, lesson.id, user_id)
    return {
        "id": lesson.id,
        "status": lesson.status,
        "topic": lesson.topic,
        "materials": [
            {"material_type": m.material_type, "title": m.title, "status": m.status}
            for m in db.query(LessonMaterial)
            .filter(LessonMaterial.lesson_id == lesson.id)
            .all()
        ],
    }


@app.post("/lessons/{lesson_id}/retry")
async def retry_lesson(
    lesson_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user_id: str = Depends(check_user_access),
):
    lesson = (
        db.query(Lesson)
        .filter(Lesson.id == lesson_id, Lesson.owner_id == user_id)
        .first()
    )
    if not lesson:
        raise HTTPException(404, "Занятие не найдено")
    if lesson.status in ("pending", "running"):
        raise HTTPException(409, "Занятие уже в работе")
    from app.services.llm import check_availability

    availability = await check_availability()
    if not availability["available"]:
        raise HTTPException(503, availability["error"])
    materials = (
        db.query(LessonMaterial)
        .filter(
            LessonMaterial.lesson_id == lesson_id, LessonMaterial.owner_id == user_id
        )
        .all()
    )
    for material in materials:
        if material.status == "failed" or lesson.status == "failed":
            material.status = "pending"
            material.error = None
    lesson.status = "pending"
    lesson.agent_progress = {
        "coordinator": "pending",
        "methodist": "pending",
        "creative": "pending",
        "assessment": "pending",
    }
    db.commit()
    record_event(
        db,
        user_id,
        "teacher",
        "lesson_review",
        lesson.id,
        decision="revision",
        comment="Повторная генерация",
    )
    record_event(
        db, user_id, "coordinator", "lesson_queued", lesson.id, topic=lesson.topic
    )
    background_tasks.add_task(generate_lesson_materials, lesson.id, user_id)
    return {
        "id": lesson.id,
        "status": "pending",
        "message": "Повторный запуск материалов запущен",
    }


@app.get("/lessons")
def list_lessons(db: Session = Depends(get_db), user_id: str = Depends(get_user_id)):
    lessons = (
        db.query(Lesson)
        .filter(Lesson.owner_id == user_id)
        .order_by(Lesson.created_at.desc())
        .all()
    )
    output = []
    reviews = (
        db.query(AgentAudit)
        .filter(AgentAudit.owner_id == user_id, AgentAudit.action == "lesson_review")
        .order_by(AgentAudit.id)
        .all()
    )
    review_map = {
        (r.output or {}).get("lesson_id"): (r.output or {}).get("decision")
        for r in reviews
    }
    for lesson in lessons:
        source = (
            db.query(PortfolioFile)
            .filter(
                PortfolioFile.id == lesson.portfolio_file_id,
                PortfolioFile.owner_id == user_id,
            )
            .first()
        )
        materials = (
            db.query(LessonMaterial)
            .filter(
                LessonMaterial.lesson_id == lesson.id,
                LessonMaterial.owner_id == user_id,
            )
            .all()
        )
        output.append(
            {
                "id": lesson.id,
                "subject": (
                    (source.structured_data or {}).get("subject") if source else None
                ),
                "portfolio_file_id": lesson.portfolio_file_id,
                "review": review_map.get(lesson.id),
                "schedule": None,
                "topic": lesson.topic,
                "group_name": lesson.group_name,
                "hours": lesson.hours,
                "lesson_type": lesson.lesson_type,
                "status": lesson.status,
                "agent_progress": lesson.agent_progress or {},
                "created_at": (
                    lesson.created_at.isoformat() if lesson.created_at else None
                ),
                "materials": [
                    {
                        "id": m.id,
                        "material_type": m.material_type,
                        "title": m.title,
                        "status": m.status,
                        "content": m.content,
                        "error": m.error,
                        "file_path": m.file_path,
                    }
                    for m in materials
                ],
            }
        )
    return output


@app.put("/lessons/{lesson_id}/materials/{material_id}")
async def update_lesson_material(
    lesson_id: str,
    material_id: str,
    payload: MaterialUpdate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id),
):
    material = (
        db.query(LessonMaterial)
        .filter(
            LessonMaterial.id == material_id,
            LessonMaterial.lesson_id == lesson_id,
            LessonMaterial.owner_id == user_id,
        )
        .first()
    )
    if not material:
        raise HTTPException(404, "Материал не найден")
    lesson = (
        db.query(Lesson)
        .filter(Lesson.id == lesson_id, Lesson.owner_id == user_id)
        .first()
    )
    if lesson and lesson.status in ("pending", "running"):
        raise HTTPException(409, "Дождитесь завершения генерации")
    ext = ".pptx" if material.material_type == "presentation" else ".docx"
    path = Path("./generated") / user_id / f"{material.id}{ext}"
    path.parent.mkdir(parents=True, exist_ok=True)
    writer = create_presentation if ext == ".pptx" else create_material_docx
    writer(str(path), material.title, payload.content)
    mime = "application/vnd.openxmlformats-officedocument." + (
        "presentationml.presentation" if ext == ".pptx" else "wordprocessingml.document"
    )
    try:
        stored = await upload_private(user_id, path, path.name, mime)
    except Exception as exc:
        raise HTTPException(502, "Не удалось сохранить файл в хранилище") from exc
    material.content = payload.content
    material.file_path = stored
    material.status = "completed"
    material.error = None
    db.flush()
    statuses = [
        m.status
        for m in db.query(LessonMaterial)
        .filter(
            LessonMaterial.lesson_id == lesson_id, LessonMaterial.owner_id == user_id
        )
        .all()
    ]
    if lesson:
        lesson.status = (
            "completed"
            if statuses and all(status == "completed" for status in statuses)
            else "failed"
        )
    db.commit()
    record_event(
        db, user_id, "teacher", "material_edited", lesson_id, material_id=material.id
    )
    record_event(
        db,
        user_id,
        "teacher",
        "lesson_review",
        lesson_id,
        decision="revision",
        comment="Материал изменён; требуется повторная проверка",
    )
    return {"id": material.id, "status": material.status, "content": material.content}


@app.get("/lessons/{lesson_id}/materials/{material_id}/download")
async def download_lesson_material(
    lesson_id: str,
    material_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id),
):
    material = (
        db.query(LessonMaterial)
        .filter(
            LessonMaterial.id == material_id,
            LessonMaterial.lesson_id == lesson_id,
            LessonMaterial.owner_id == user_id,
        )
        .first()
    )
    if not material or not material.file_path:
        raise HTTPException(404, "Материал ещё не создан или недоступен")
    destination = await download_private(
        material.file_path,
        Path("./generated")
        / user_id
        / f"{uuid.uuid4().hex}_{Path(material.file_path).name}",
    )
    if not destination:
        raise HTTPException(404, "Материал недоступен в хранилище")
    return FileResponse(str(destination), filename=destination.name)


@app.get("/llm/status")
async def llm_status():
    from app.services.llm import check_availability

    return await check_availability()


@app.get("/chat/messages")
def messages(db: Session = Depends(get_db), user_id: str = Depends(get_user_id)):
    items = (
        db.query(ChatMessage)
        .filter(ChatMessage.owner_id == user_id)
        .order_by(ChatMessage.id)
        .all()
    )
    return [
        {"id": i.id, "role": i.role, "content": i.content, "attachments": i.attachments}
        for i in items
    ]


@app.get("/tasks")
def tasks(db: Session = Depends(get_db), user_id: str = Depends(get_user_id)):
    items = (
        db.query(Task).filter(Task.owner_id == user_id).order_by(Task.id.desc()).all()
    )
    output = []
    for item in items:
        steps = (
            db.query(TaskStep)
            .filter(TaskStep.task_id == item.id, TaskStep.owner_id == user_id)
            .all()
        )
        output.append(
            {
                "id": item.id,
                "title": item.title,
                "status": item.status,
                "assigned_agent": item.assigned_agent,
                "result": item.result,
                "error": item.error,
                "celery_task_id": item.celery_task_id,
                "steps": [
                    {
                        "agent": s.agent,
                        "title": s.title,
                        "status": s.status,
                        "depends_on": s.depends_on,
                        "result": s.result,
                        "error": s.error,
                    }
                    for s in steps
                ],
            }
        )
    return output


@app.post("/tasks/{task_id}/cancel")
def cancel_task(
    task_id: str, db: Session = Depends(get_db), user_id: str = Depends(get_user_id)
):
    task = db.query(Task).filter(Task.id == task_id, Task.owner_id == user_id).first()
    if not task:
        raise HTTPException(404, "Задание не найдено")
    if task.status == "completed":
        raise HTTPException(409, "Завершённое задание нельзя отменить")
    task.status = "cancelled"
    db.commit()
    if task.celery_task_id:
        try:
            from app.workers.celery_app import celery_app

            celery_app.control.revoke(task.celery_task_id, terminate=True)
        except Exception:
            pass
    return {"id": task.id, "status": task.status}


@app.get("/documents/{task_id}/download")
async def download_document(
    task_id: str,
    kind: str = "main",
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id),
):
    task = db.query(Task).filter(Task.id == task_id, Task.owner_id == user_id).first()
    if not task:
        raise HTTPException(404, "Задание не найдено")
    if task.status != "completed" or not task.result:
        raise HTTPException(404, "Документ ещё не создан")
    key = "answer_document" if kind == "answers" else "main_document"
    stored = task.result.get(key, "")
    path = (
        await download_private(
            stored,
            Path("./generated") / user_id / f"{uuid.uuid4().hex}_{Path(stored).name}",
        )
        if stored
        else None
    )
    if not path or not path.is_file():
        raise HTTPException(404, "Документ недоступен")
    return FileResponse(str(path), filename=path.name)


from app.routers.admin import router as admin_router

# Both spellings are supported; /api/admin is canonical for new clients.
app.include_router(admin_router, prefix="/api")
app.include_router(admin_router, include_in_schema=False)


@app.get("/profile/access")
def own_access_profile(
    db: Session = Depends(get_db), user_id: str = Depends(get_user_id)
):
    from app.routers.admin import serialize_profile

    return serialize_profile(ensure_profile(db, user_id))
