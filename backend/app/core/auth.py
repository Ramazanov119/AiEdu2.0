import httpx
from fastapi import Header, HTTPException
from app.core.config import get_settings


async def get_user_id(authorization: str | None = Header(None)) -> str:
    settings = get_settings()
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]

        if settings.supabase_url:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(
                    settings.supabase_url.rstrip("/") + "/auth/v1/user",
                    headers={
                        "Authorization": "Bearer " + token,
                        "apikey": settings.supabase_anon_key
                        or settings.supabase_service_role_key,
                    },
                )
            if response.status_code != 200:
                raise HTTPException(
                    status_code=401,
                    detail="Недействительный или истёкший токен Supabase",
                )
            user_id = response.json().get("id")
            if not user_id:
                raise HTTPException(
                    status_code=401,
                    detail="Supabase не вернул идентификатор пользователя",
                )
            from app.services.identities import sync_identity

            sync_identity(user_id, response.json().get("email"))
            return user_id

        if settings.supabase_jwt_secret:
            from jose import jwt

            try:
                payload = jwt.decode(
                    token,
                    settings.supabase_jwt_secret,
                    algorithms=["HS256"],
                    audience="authenticated",
                )
                from app.services.identities import sync_identity

                sync_identity(payload["sub"], None)
                return payload["sub"]
            except Exception as exc:
                raise HTTPException(
                    status_code=401, detail="Недействительный токен Supabase"
                ) from exc

        raise HTTPException(
            status_code=503,
            detail="Supabase Auth не настроен: задайте SUPABASE_URL и ключ проекта",
        )

    if settings.environment == "local" and settings.local_dev_user_id:
        return settings.local_dev_user_id
    raise HTTPException(status_code=401, detail="Требуется Bearer-токен Supabase")


from fastapi import Depends
from sqlalchemy.orm import Session
from app.db import get_db
from app.models import Profile
from app.services.access import ensure_profile, assert_access


def require_admin(
    user_id: str = Depends(get_user_id), db: Session = Depends(get_db)
) -> Profile:
    profile = db.get(Profile, user_id, populate_existing=True)
    if not profile or not profile.is_active or profile.role != "admin":
        raise HTTPException(403, "Доступ разрешён только активному администратору.")
    return profile


def check_user_access(
    user_id: str = Depends(get_user_id), db: Session = Depends(get_db)
) -> str:
    ensure_profile(db, user_id)
    assert_access(db, user_id)
    return user_id
