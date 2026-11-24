import io
import pytest
from docx import Document
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient
from app.main import app
from app.db import get_db
from app.core.auth import get_user_id
from app.models import Base, Task, Lesson, LessonMaterial, Profile, PortfolioFile
from app.services.documents import extract_structured_rup, extract_document

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session=sessionmaker(bind=engine,expire_on_commit=False)
    def db():
        with session() as s: yield s
    app.dependency_overrides[get_db]=db
    app.dependency_overrides[get_user_id]=lambda:'teacher-a'
    with TestClient(app) as c: yield c,session
    app.dependency_overrides.clear()
    engine.dispose()

def upload(client):
    d=Document(); d.add_paragraph('Предмет: Информатика')
    table=d.add_table(rows=2,cols=3)
    for row,values in zip(table.rows,[['Тема: 2.3 SQL','2 часа','лекция'],['Тема: Python','4 часа','практика']]):
        for cell,value in zip(row.cells,values):cell.text=value
    stream=io.BytesIO();d.save(stream)
    r=client.post('/portfolio/upload',data={'category':'РУП'},files={'file':('rup.docx',stream.getvalue())})
    assert r.status_code==200
    return r.json()

def test_topics_keep_row_association():
    topics=extract_structured_rup('Тема: SQL | 2 часа | лекция\nТема: Python | 4 часа | практика')['topics']
    assert topics==[{'title':'SQL','hours':'2','lesson_type':'лекция'},{'title':'Python','hours':'4','lesson_type':'практика'}]

def test_xlsx_values_are_read(tmp_path):
    w=Workbook();w.active.append(['SQL',2]);p=tmp_path/'input.xlsx';w.save(p)
    assert extract_document(str(p),'input.xlsx')=='SQL\n2'

def test_invalid_document_is_422(client):
    c,_=client
    r=c.post('/portfolio/upload',data={'category':'РУП'},files={'file':('bad.docx',b'not zip')})
    assert r.status_code==422

def test_task_list_nonempty_and_owner_isolation(client):
    c,session=client
    with session() as db:
        db.add(Profile(id='teacher-a'));db.add(Task(owner_id='teacher-a',title='Контрольная'));db.commit()
    assert c.get('/tasks').status_code==200
    assert len(c.get('/tasks').json())==1
    app.dependency_overrides[get_user_id]=lambda:'teacher-b'
    assert c.get('/tasks').json()==[]

def test_rup_review_events_edit_download_and_owner(client):
    c,session=client
    item=upload(c)
    assert len(item['structured_data']['topics'])==2
    assert c.post('/portfolio/'+item['id']+'/confirm',json=item['structured_data']).status_code==200
    with session() as db:
        l=Lesson(owner_id='teacher-a',portfolio_file_id=item['id'],topic='SQL',status='completed');db.add(l);db.flush()
        m=LessonMaterial(owner_id='teacher-a',lesson_id=l.id,material_type='plan',title='План',content='SQL',status='completed');db.add(m);db.commit();lid=l.id;mid=m.id
    assert c.post(f'/lessons/{lid}/review',json={'decision':'approved'}).status_code==200
    assert c.get('/lessons').json()[0]['review']=='approved'
    assert c.put(f'/lessons/{lid}/materials/{mid}',json={'content':'Обновлённый план SQL'}).status_code==200
    assert c.get('/lessons').json()[0]['review']=='revision'
    response=c.get(f'/lessons/{lid}/materials/{mid}/download')
    assert response.status_code==200
    assert 'Обновлённый план SQL' in '\n'.join(p.text for p in Document(io.BytesIO(response.content)).paragraphs)
    events=c.get('/events').json();assert any(e['action']=='material_edited' and e['at'] for e in events)
    app.dependency_overrides[get_user_id]=lambda:'teacher-b'
    assert c.get('/events').json()==[]
    assert c.post(f'/lessons/{lid}/review',json={'decision':'approved'}).status_code==404
    assert c.get(f'/lessons/{lid}/materials/{mid}/download').status_code==404

@pytest.mark.asyncio
async def test_cloud_status_never_generates(monkeypatch):
    from types import SimpleNamespace
    import app.services.llm as llm
    monkeypatch.setattr(llm,'get_settings',lambda:SimpleNamespace(llm_base_url='https://example.invalid/v1',llm_model='test',llm_provider='openai',llm_api_key='test-only'))
    class ForbiddenClient:
        def __init__(self,*a,**kw):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*a):pass
        async def post(self,*a,**kw):raise AssertionError('status must not generate')
    monkeypatch.setattr(llm.httpx,'AsyncClient',ForbiddenClient)
    result=await llm.check_availability()
    assert result['available'] is True and result['verified'] is False

def test_chat_lesson_request_reports_missing_llm(client,monkeypatch):
    c,_=client
    item=upload(c)
    c.post('/portfolio/'+item['id']+'/confirm',json=item['structured_data'])
    async def unavailable():return {'available':False,'error':'LLM не настроена'}
    monkeypatch.setattr('app.services.llm.check_availability',unavailable)
    r=c.post('/chat/messages',json={'content':'Подготовьте комплект материалов по теме 2.3'})
    assert r.status_code==503
    assert any(m['role']=='system' and 'LLM' in m['content'] for m in c.get('/chat/messages').json())
    assert c.get('/lessons').json()==[]

def test_cloud_material_edit_reuploads_new_document(client,monkeypatch):
    c,session=client
    item=upload(c)
    with session() as db:
        l=Lesson(owner_id='teacher-a',portfolio_file_id=item['id'],topic='SQL',status='completed');db.add(l);db.flush()
        m=LessonMaterial(owner_id='teacher-a',lesson_id=l.id,material_type='plan',title='План',content='Old',status='completed',file_path='supabase://portfolio-private/teacher-a/old.docx');db.add(m);db.commit();lid=l.id;mid=m.id
    captured=[]
    async def upload_spy(owner,path,filename,mime):
        captured.append((owner,Document(path).paragraphs[-1].text,mime))
        return 'supabase://portfolio-private/teacher-a/new.docx'
    monkeypatch.setattr('app.main.upload_private',upload_spy)
    assert c.put(f'/lessons/{lid}/materials/{mid}',json={'content':'Updated SQL'}).status_code==200
    assert captured[0][0:2]==('teacher-a','Updated SQL')
    assert c.get('/lessons').json()[0]['materials'][0]['file_path'].endswith('new.docx')


def test_upload_reports_parser_reason_and_cleans_file(client, monkeypatch, tmp_path):
    c, _ = client
    def fail(*args):
        raise ValueError("Невозможно прочитать таблицу тем")
    monkeypatch.setattr("app.main.extract_structured_rup", fail)
    # Use a synthetic extractor to reach the structure parser, no external services.
    monkeypatch.setattr("app.main.extract_document", lambda *args: "Тема: SQL")
    response = c.post("/portfolio/upload", data={"category": "РУП"}, files={"file": ("rup.pdf", b"fixture")})
    assert response.status_code == 422
    assert response.json()["detail"] == "Распознавание структуры РУП: Невозможно прочитать таблицу тем"
    assert not list((tmp_path / "storage").rglob("*.pdf"))


def test_upload_reports_storage_failure(client, monkeypatch):
    c, factory = client
    monkeypatch.setattr("app.main.extract_document", lambda *args: "Тема: SQL")
    async def fail(*args):
        raise RuntimeError("Storage: bucket portfolio-private не найден")
    monkeypatch.setattr("app.main.upload_private", fail)
    response = c.post("/portfolio/upload", data={"category": "РУП"}, files={"file": ("rup.pdf", b"fixture")})
    assert response.status_code == 502
    assert "bucket portfolio-private не найден" in response.json()["detail"]
    with factory() as db:
        assert db.query(PortfolioFile).count() == 0


def test_upload_database_error_does_not_expose_sql_or_credentials(client, monkeypatch):
    from sqlalchemy.exc import OperationalError
    c, _ = client
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-private-key")
    from app.core.config import get_settings
    get_settings.cache_clear()
    def fail(*args):
        raise OperationalError("SELECT secret SQL", {"private": "bound-content"}, RuntimeError("database unavailable test-private-key"))
    monkeypatch.setattr("app.main.ensure_profile", fail)
    response = c.post("/portfolio/upload", data={"category": "РУП"}, files={"file": ("rup.pdf", b"fixture")})
    assert response.status_code == 500
    detail = response.json()["detail"]
    assert "Подготовка профиля: database unavailable [скрыто]" == detail
    assert "bound-content" not in detail and "SELECT" not in detail


def test_upload_empty_file_is_rejected(client):
    c, _ = client
    response = c.post("/portfolio/upload", data={"category": "РУП"}, files={"file": ("empty.pdf", b"")})
    assert response.status_code == 422
    assert "Файл пуст" in response.json()["detail"]
