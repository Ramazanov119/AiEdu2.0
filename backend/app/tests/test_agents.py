import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models import Base, Profile, PortfolioFile
from app.services.agents import analyze_request

def make_db():
    engine=create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    Session=sessionmaker(bind=engine)
    return Session()

@pytest.mark.asyncio
async def test_coordinator_requests_missing_rup_and_schedule():
    db=make_db()
    db.add(Profile(id='teacher-a'))
    db.commit()
    plan=await analyze_request(db,'teacher-a','Сегодня в 12:00 у меня пара в КПО. Подготовьте контрольную работу по пройденным темам')
    assert plan['needs_control'] is True
    assert 'подтверждённый РУП' in plan['missing']
    assert 'подтверждённое расписание' in plan['missing']
    assert plan['roles'][0]=='coordinator'

@pytest.mark.asyncio
async def test_coordinator_uses_confirmed_rup_and_schedule():
    db=make_db()
    db.add(Profile(id='teacher-b'))
    db.add_all([
        PortfolioFile(owner_id='teacher-b',category='РУП',filename='rup.docx',storage_path='/tmp/rup.docx',confirmed=True,extracted_text='Тема: SQL\nТема: нормализация'),
        PortfolioFile(owner_id='teacher-b',category='расписание',filename='schedule.docx',storage_path='/tmp/schedule.docx',confirmed=True,extracted_text='12:00 КПО')
    ])
    db.commit()
    plan=await analyze_request(db,'teacher-b','Сегодня в 12:00 у меня пара в КПО. Подготовьте контрольную работу по пройденным темам')
    assert plan['missing']==[]
    assert 'SQL' in str(plan['topics'])
    assert {'coordinator','methodist','assessment','creative'}.issubset(set(plan['roles']))
