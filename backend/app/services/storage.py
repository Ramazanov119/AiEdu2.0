from pathlib import Path
from uuid import uuid4

import httpx

from app.core.config import get_settings

async def upload_private(owner_id: str, local_path: Path, filename: str, content_type: str | None = None) -> str:
    settings=get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        if settings.environment != "local":
            raise RuntimeError("Для хранения файлов настройте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY")
        return str(local_path)
    extension = Path(filename).suffix.lower()
    if extension and not (
        extension[1:].isascii() and extension[1:].isalnum()
    ):
        extension = ""
    object_name=f'{owner_id}/{uuid4().hex}{extension}'
    url=f"{settings.supabase_url.rstrip('/')}/storage/v1/object/portfolio-private/{object_name}"
    async with httpx.AsyncClient(timeout=30) as client:
        response=await client.post(url, headers={'Authorization':'Bearer ' + settings.supabase_service_role_key,'apikey':settings.supabase_service_role_key,'Content-Type':content_type or 'application/octet-stream','x-upsert':'true'}, content=local_path.read_bytes())
    if response.status_code >= 300:
        raise RuntimeError(f'Supabase Storage отклонил загрузку: {response.text[:300]}')
    local_path.unlink(missing_ok=True)
    return f'supabase://portfolio-private/{object_name}'

async def download_private(storage_path: str, destination: Path) -> Path | None:
    settings=get_settings()
    if not storage_path.startswith('supabase://'):
        if settings.environment != 'local':
            return None
        return Path(storage_path) if Path(storage_path).exists() else None
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return None
    object_name=storage_path.split('supabase://portfolio-private/',1)[1]
    url=f"{settings.supabase_url.rstrip('/')}/storage/v1/object/authenticated/portfolio-private/{object_name}"
    async with httpx.AsyncClient(timeout=30) as client:
        response=await client.get(url, headers={'Authorization':'Bearer ' + settings.supabase_service_role_key,'apikey':settings.supabase_service_role_key})
    if response.status_code >= 300:
        return None
    destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_bytes(response.content)
    return destination
