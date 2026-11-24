from dataclasses import dataclass
from sqlalchemy.orm import Session
from app.models import PortfolioFile

MISSING_FIELDS='Недостаточно подтвержденных данных'

@dataclass
class AgentContext:
    rup_text: str
    schedule_text: str
    topics: list[str]
    source_ids: list[str]

async def analyze_request(db: Session, owner_id: str, request: str) -> dict:
    needs_control=any(w in request.lower() for w in ('контрольн','проверочн','test','задани'))
    needs_creative=any(w in request.lower() for w in ('практическ','кейс','интерактив','игр','мероприят')) or needs_control
    confirmed=db.query(PortfolioFile).filter(PortfolioFile.owner_id==owner_id,PortfolioFile.confirmed==True).all()
    rup=[f for f in confirmed if f.category.lower()=='руп']
    schedules=[f for f in confirmed if f.category=='расписание']
    roles=['coordinator']
    if needs_control: roles += ['methodist','assessment']
    if needs_creative: roles += ['creative']
    roles += ['methodist'] if 'methodist' not in roles else []
    missing=[]
    if needs_control and not rup: missing.append('подтверждённый РУП')
    if needs_control and not schedules: missing.append('подтверждённое расписание')
    topics=[]
    for f in rup:
        text=f.extracted_text or ''
        for line in text.splitlines():
            clean=line.strip().lstrip('-•0123456789. ') 
            if clean and len(clean)<=120 and any(ch.isalpha() for ch in clean): topics.append(clean)
    topics=list(dict.fromkeys(topics))[:25]
    return {'roles':roles,'missing':missing,'confirmed_documents':[{'id':f.id,'filename':f.filename,'category':f.category} for f in confirmed],'topics':topics,'needs_control':needs_control}

async def build_agent_context(db: Session, owner_id: str) -> AgentContext:
    confirmed=db.query(PortfolioFile).filter(PortfolioFile.owner_id==owner_id,PortfolioFile.confirmed==True).all()
    rup=[f for f in confirmed if f.category.lower()=='руп']
    schedules=[f for f in confirmed if f.category=='расписание']
    rup_text='\n\n'.join(f'Документ {f.filename}:\n{f.extracted_text or ""}' for f in rup)
    schedule_text='\n\n'.join(f'Документ {f.filename}:\n{f.extracted_text or ""}' for f in schedules)
    topics=[]
    for f in rup:
        for line in (f.extracted_text or '').splitlines():
            clean=line.strip().lstrip('-•0123456789. ')
            if clean and len(clean)<=120 and any(ch.isalpha() for ch in clean): topics.append(clean)
    return AgentContext(rup_text,schedule_text,list(dict.fromkeys(topics))[:25],[f.id for f in confirmed])
