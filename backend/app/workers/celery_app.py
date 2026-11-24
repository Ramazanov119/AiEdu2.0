import asyncio
from pathlib import Path
from celery import Celery
from app.core.config import get_settings
from app.db import SessionLocal
from app.models import Task, TaskStep, ChatMessage, AgentAudit, PortfolioFile
from app.services.agents import build_agent_context
from app.services.llm import generate, check_availability
from app.services.documents import create_test_docx, create_answer_key_docx
from app.services.security import prompt_injection_detected
from app.services.storage import upload_private
from app.services.access import assert_access, utcnow

s = get_settings()
celery_app = Celery("ai_edu", broker=s.redis_url or "memory://", backend=s.redis_url or "cache+memory://")
celery_app.conf.update(
    broker_connection_timeout=2,
    broker_transport_options={"socket_connect_timeout": 2, "socket_timeout": 2},
    task_publish_retry=False,
    task_track_started=True,
    task_time_limit=s.task_timeout_seconds,
    task_soft_time_limit=max(30, s.task_timeout_seconds - 30),
    task_max_retries=2,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
)


@celery_app.task(bind=True, max_retries=2, name="app.workers.agent_team_task")
def agent_team_task(self, task_id: str, owner_id: str):
    db = SessionLocal()
    try:
        task = (
            db.query(Task).filter(Task.id == task_id, Task.owner_id == owner_id).first()
        )
        if not task:
            return {"error": "Задание не найдено"}
        if task.status == "cancelled":
            return {"status": "cancelled"}
        if task.status == "completed":
            return {"status": "already_completed", "task_id": task_id}

        assert_access(db, owner_id)
        task.started_at = utcnow()
        task.status = "running"
        db.commit()
        order = [
            "Проверить подтверждённые темы и часы",
            "Создать контрольную и ключи",
            "Добавить практический кейс",
            "Проверить итоговый комплект",
        ]
        steps = sorted(
            db.query(TaskStep).filter(TaskStep.task_id == task_id).all(),
            key=lambda step: (
                order.index(step.title) if step.title in order else len(order)
            ),
        )
        health = asyncio.run(check_availability())
        if not health["available"]:
            task.status = "failed"
            task.error = health["error"]
            db.commit()
            db.add(
                ChatMessage(
                    owner_id=owner_id,
                    role="assessment",
                    content=health["error"],
                    attachments=[],
                )
            )
            db.commit()
            for step in steps:
                step.status = "failed"
                step.error = health["error"]
            db.commit()
            return {"status": "failed", "error": health["error"]}

        context = (
            asyncio.run(build_agent_context(db, owner_id))
            if False
            else build_agent_context_sync(db, owner_id)
        )
        topics = (
            "; ".join(context.topics)
            if context.topics
            else "В подтвержденных документах темы не выделены"
        )
        source_ids = ", ".join(context.source_ids) or "нет подтвержденных документов"

        if task.status == "cancelled":
            return {"status": "cancelled"}
        first = steps[0] if steps else None
        if first:
            first.status = "running"
            db.commit()
        methodist_prompt = f"""Проверь подтвержденные темы и часы только по следующим документам. Не применяй внешние нормативные требования и не выдумывай данные.\nРУП:\n{context.rup_text[:12000]}\nРасписание:\n{context.schedule_text[:8000]}\nВыделенные темы: {topics}\nВерни JSON-подобный список фактов: документ, тема, часы если указаны, источник_id. Не утверждай отсутствующее."""
        methodist_review = asyncio.run(
            generate(
                methodist_prompt,
                "Ты Методист. Используешь только подтвержденные документы и явно отмечаешь отсутствующие данные.",
                user_id=owner_id,
                agent_type="methodist",
                action_type="review_sources",
            )
        )
        if prompt_injection_detected(context.rup_text + context.schedule_text):
            task.status = "failed"
            task.error = "Prompt injection обнаружен в подтвержденном документе; генерация остановлена"
            db.commit()
            return {"status": "failed", "error": task.error}
        if first:
            first.status = "completed"
            first.result = {
                "review": methodist_review,
                "topics": context.topics,
                "source_ids": context.source_ids,
            }
            db.commit()

        second = steps[1] if len(steps) > 1 else None
        if second:
            second.status = "running"
            db.commit()
        assessment_prompt = f"""Поручение преподавателя: {task.description}\nПодтвержденные темы Методиста: {topics}\nПодтвержденные документы: {source_ids}\nРУП: {context.rup_text[:10000]}\nСоздай контрольную работу строго по этим темам. Если темы или часы отсутствуют, явно перечисли недостающие данные. Отдельно дай раздел КЛЮЧИ ОТВЕТОВ и КРИТЕРИИ ОЦЕНИВАНИЯ. Не добавляй официальные нормы баллов, если их нет в документе."""
        assessment_text = asyncio.run(
            generate(
                assessment_prompt,
                "Ты Ассистент по оцениванию. Не устанавливаешь официальный журнал и не выдумываешь учебные требования.",
                user_id=owner_id,
                agent_type="assessment",
                action_type="assessment",
            )
        )
        if second:
            second.status = "completed"
            second.result = {"content_length": len(assessment_text)}
            db.commit()

        third = steps[2] if len(steps) > 2 else None
        if third:
            third.status = "running"
            db.commit()
        creative_prompt = f"""Дополнить контрольную практическим кейсом.\nПодтвержденные темы: {topics}\nИсходный запрос: {task.description}\nРасписание: {context.schedule_text[:6000]}\nПредложи один практический кейс, интерактивное задание или игровую механику, учитывая КПО и указанную длительность, только если она есть. Не выдумывай оборудование и возраст."""
        creative_text = asyncio.run(
            generate(
                creative_prompt,
                "Ты Креативщик. Создаёшь оригинальный сценарий на основе подтвержденных данных, без выдуманных сведений.",
                user_id=owner_id,
                agent_type="creative",
                action_type="creative_case",
            )
        )
        if third:
            third.status = "completed"
            third.result = {"content_length": len(creative_text)}
            db.commit()

        fourth = steps[3] if len(steps) > 3 else None
        if fourth:
            fourth.status = "running"
            db.commit()
        final_prompt = f"""Проверь итоговый комплект только по подтвержденному РУП и расписанию.\nРУП: {context.rup_text[:8000]}\nРасписание: {context.schedule_text[:5000]}\nКонтрольная: {assessment_text[:9000]}\nПрактический кейс: {creative_text[:6000]}\nВерни: СООТВЕТСТВИЕ, ИСПОЛЬЗОВАННЫЕ ДОКУМЕНТЫ, ОБНАРУЖЕННЫЕ ВЫДУМКИ или НЕДОСТАЮЩИЕ ДАННЫЕ."""
        final_review = asyncio.run(
            generate(
                final_prompt,
                "Ты Методист. Ты проводишь финальную проверку соответствия и не создаёшь новый материал.",
                user_id=owner_id,
                agent_type="methodist",
                action_type="final_review",
            )
        )
        if fourth:
            fourth.status = "completed"
            fourth.result = {"review": final_review, "source_ids": context.source_ids}
            db.commit()

        Path("./generated").mkdir(parents=True, exist_ok=True)
        main = Path("./generated") / f"{task.id}-test.docx"
        answers = Path("./generated") / f"{task.id}-answers.docx"
        create_test_docx(
            str(main),
            "Контрольная работа и практический кейс",
            assessment_text
            + "\n\n## Практический кейс\n"
            + creative_text
            + "\n\n## Методистская проверка\n"
            + final_review,
        )
        create_answer_key_docx(
            str(answers),
            assessment_text + "\n\n## Методистская проверка\n" + final_review,
        )

        result = {
            "main_document": str(main),
            "answer_document": str(answers),
            "topics": context.topics,
            "source_ids": context.source_ids,
            "methodist_review": methodist_review,
            "final_review": final_review,
        }
        task.status = "completed"
        task.completed_at = utcnow()
        task.result = result
        db.commit()

        for path, category, filename in [
            (main, "шаблоны", main.name),
            (answers, "оценки", answers.name),
        ]:
            storage_path = asyncio.run(
                upload_private(
                    owner_id,
                    path,
                    filename,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            )
            result["main_document" if category == "шаблоны" else "answer_document"] = (
                storage_path
            )
            db.add(
                PortfolioFile(
                    owner_id=owner_id,
                    category=category,
                    filename=filename,
                    storage_path=storage_path,
                    mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    extracted_text=None,
                    structured_data=result,
                    confirmed=True,
                )
            )
        task.result = dict(result)
        db.commit()
        db.add(
            ChatMessage(
                owner_id=owner_id,
                role="assessment",
                content="Ассистент сформировал контрольную и отдельный файл ключей. Оценки не внесены в журнал.",
                attachments=[
                    {"type": "document", "document_id": task_id, "filename": main.name},
                    {
                        "type": "document",
                        "document_id": task_id,
                        "filename": answers.name,
                        "kind": "answers",
                    },
                ],
            )
        )
        db.commit()
        db.add(
            ChatMessage(
                owner_id=owner_id,
                role="creative",
                content="Креативщик подготовил практический кейс только на основе доступных подтвержденных данных.",
                attachments=[],
            )
        )
        db.commit()
        db.add(
            ChatMessage(
                owner_id=owner_id,
                role="methodist",
                content="Финальная проверка завершена: " + final_review[:4000],
                attachments=[],
            )
        )
        db.commit()
        db.add(
            AgentAudit(
                owner_id=owner_id,
                agent="methodist",
                action="final_review",
                input={"source_ids": context.source_ids, "topics": context.topics},
                output={"review": final_review},
            )
        )
        db.commit()
        return {"status": "completed", "task_id": task_id, "result": result}
    except Exception as exc:
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            task.status = "failed"
            task.completed_at = utcnow()
            task.error = str(exc)
            for step in (
                db.query(TaskStep)
                .filter(TaskStep.task_id == task_id, TaskStep.owner_id == owner_id)
                .all()
            ):
                if step.status in ("pending", "running"):
                    step.status = "failed"
                    step.error = str(exc)
            db.commit()
            db.add(
                ChatMessage(
                    owner_id=owner_id,
                    role="system",
                    content="Ошибка выполнения команды: " + str(exc),
                    attachments=[],
                )
            )
            db.commit()
        return {"status": "failed", "error": str(exc)}
    finally:
        db.close()


def build_agent_context_sync(db, owner_id):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(build_agent_context(db, owner_id))
    finally:
        loop.close()


@celery_app.task(name="app.workers.health_task")
def health_task():
    return {"status": "ready", "worker": "celery"}
