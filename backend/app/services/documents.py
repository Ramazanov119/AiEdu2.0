from pathlib import Path
import re
from docx import Document

CATEGORY_TEMPLATES=('тарификация','руп','расписание','оценки','шаблоны')

def extract_document(path: str, filename: str) -> str:
    suffix=Path(filename).suffix.lower()
    if suffix == '.docx':
        document=Document(path)
        parts=[p.text for p in document.paragraphs if p.text.strip()]
        for table in document.tables:
            for row in table.rows:
                line=' | '.join(cell.text.strip().replace('\n',' ') for cell in row.cells if cell.text.strip())
                if line:
                    parts.append(line)
        return '\n'.join(parts)[:50000]
    if suffix == '.pdf':
        from PyPDF2 import PdfReader
        reader=PdfReader(path)
        return '\n'.join(page.extract_text() or '' for page in reader.pages)[:50000]
    if suffix == '.xlsx':
        from openpyxl import load_workbook
        workbook=load_workbook(path, read_only=True, data_only=True)
        return '\n'.join(str(cell) for sheet in workbook.worksheets for row in sheet.iter_rows(values_only=True) for cell in row if cell is not None)[:50000]
    if suffix == '.txt': return Path(path).read_text(errors='ignore')[:50000]
    return ''

def extract_structured_rup(text: str) -> dict:
    def field(patterns):
        for pattern in patterns:
            match=re.search(pattern,text,re.I|re.M)
            if match and match.group(1).strip():
                return match.group(1).strip(' |\t')
        return None

    subject=field([r'(?:дисциплина|предмет|subject)\s*[:\-]\s*([^\n|]+)',r'^([^\n]+)(?:учебная дисциплина|дисциплина)',r'по дисциплине\s+([^\n,.]+)'])
    grade=field([r'(?:класс|grade|курс)\s*[:\-]\s*([^\n|]+)'])
    groups=field([r'(?:группы|группа)\s*[:\-]\s*([^\n|]+)',r'(?:для групп(?:ы)?|групп(?:а)?\s+)[:\s]*([^\n,.]+)'])
    criteria_text=re.search(r'(?:критери(?:и|й).*?оцениван(?:ия|ие)|оцениван(?:ие|ия)|баллы).*?(?=\n(?:[A-ZА-ЯЁ]|\d+[.)]|$))',text,re.I|re.M|re.S)

    topics=[]
    # Keep the topic, duration and lesson kind from the SAME row.
    kind_pattern=r'(лекционное занятие|лекция|практическое занятие|практика|семинар|лабораторная работа|самостоятельная работа)'
    for raw in text.splitlines():
        parts=[part.strip() for part in raw.split('|')]
        title=None
        for part in parts:
            match=re.match(r'^(?:тема|topic)\s*([\d.]*\s*[^|]*)',part,re.I)
            if match:
                candidate=match.group(1).strip(' :-')
                if candidate and candidate.lower() not in ('занятия','часы','название'):
                    title=candidate
                    break
        if not title and len(parts)>1:
            title=next((part for part in parts if re.search(r'[а-яa-z]',part,re.I)
                        and not re.fullmatch(kind_pattern,part,re.I)
                        and not re.search(r'название|содержание|количество|дисциплина|предмет|час|вид занятия',part,re.I)),None)
        if not title and raw.strip().startswith(('-', '•')):
            title=raw.strip().lstrip('-• ')
        if not title or title.lower() in ('тема','темы','наименование темы'):
            continue
        hm=re.search(r'(\d+(?:[,.]\d+)?)\s*(?:час(?:а|ов)?|ч\.?)(?!\w)',raw,re.I)
        numeric=next((part for part in parts[1:] if re.fullmatch(r'\d+(?:[,.]\d+)?',part)),None)
        km=re.search(kind_pattern,raw,re.I)
        topic={'title':title[:300],'hours':hm.group(1) if hm else numeric,'lesson_type':km.group(1).lower() if km else None}
        if not any(t['title']==topic['title'] for t in topics): topics.append(topic)
    return {'subject':subject,'grade':grade,'groups':groups,'topics':topics[:100],
            'hours':list(dict.fromkeys(t['hours'] for t in topics if t['hours'])),
            'lesson_types':list(dict.fromkeys(t['lesson_type'] for t in topics if t['lesson_type'])),
            'assessment_criteria':criteria_text.group(0).strip()[:5000] if criteria_text else None}

def create_test_docx(output_path: str, title: str, body: str) -> str:
    document=Document()
    document.add_heading(title,0)
    for block in body.split('\n\n'):
        block=block.strip()
        if block:
            if block.startswith('#'):
                document.add_heading(block.lstrip('#').strip(),level=1)
            else:
                document.add_paragraph(block)
    document.save(output_path)
    return output_path

def create_answer_key_docx(output_path: str, body: str) -> str:
    document=Document()
    document.add_heading('Ключи ответов и критерии оценивания',0)
    for block in body.split('\n\n'):
        block=block.strip()
        if block:
            document.add_paragraph(block)
    document.save(output_path)
    return output_path

def create_material_docx(output_path: str, title: str, body: str) -> str:
    document=Document()
    document.add_heading(title,0)
    for block in body.split('\n\n'):
        block=block.strip()
        if not block:
            continue
        if block.startswith('#'):
            heading=block.lstrip('#').strip()
            document.add_heading(heading,level=1)
        elif block.startswith('- '):
            for line in block.splitlines():
                document.add_paragraph(line.lstrip('- ').strip(),style='List Bullet')
        else:
            document.add_paragraph(block)
    document.save(output_path)
    return output_path

def create_presentation(output_path: str, title: str, body: str) -> str:
    from pptx import Presentation
    from pptx.util import Inches, Pt
    prs=Presentation()
    slide=prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text=title
    slide.placeholders[1].text='Материал AI EDU 2.0'
    for block in body.split('\n\n')[:12]:
        block=block.strip()
        if not block:
            continue
        slide=prs.slides.add_slide(prs.slide_layouts[1])
        lines=block.splitlines()
        slide.shapes.title.text=(lines[0][:100] if lines else 'Слайд')
        if len(lines)>1:
            slide.placeholders[1].text='\n'.join(lines[1:])[:1500]
    prs.save(output_path)
    return output_path
