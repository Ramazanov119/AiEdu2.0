"""Trusted operator CLI: python -m app.bootstrap_admin --user-id <verified Supabase UUID>."""

import argparse
import asyncio
from uuid import UUID
import httpx
from sqlalchemy import text
from app.core.config import get_settings
from app.db import SessionLocal
from app.models import Profile, AdminAuditLog


def assign_initial_admin(db, identity, expected_email):
    if not expected_email or not identity.get("email_confirmed_at"):
        raise ValueError(
            "Требуются INITIAL_ADMIN_EMAIL и подтверждённый email Supabase Auth."
        )
    if (
        str(identity.get("email", "")).strip().casefold()
        != expected_email.strip().casefold()
    ):
        raise ValueError("Email не совпадает с INITIAL_ADMIN_EMAIL.")
    user_id = str(UUID(identity["id"]))
    if db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(684912304)"))
    else:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
    existing = db.query(Profile).filter(Profile.role == "admin").first()
    if existing:
        if existing.id == user_id and existing.is_active:
            return existing
        raise ValueError(
            "Первый администратор уже назначен. Используйте защищённый административный API."
        )
    profile = db.get(Profile, user_id)
    if profile is None:
        profile = Profile(id=user_id, email=identity["email"])
        db.add(profile)
        db.flush()
    if not profile.is_active:
        raise ValueError(
            "Нельзя автоматически назначить заблокированного пользователя."
        )
    old = profile.role
    profile.role = "admin"
    profile.email = identity["email"]
    db.add(
        AdminAuditLog(
            admin_id=user_id,
            target_user_id=user_id,
            action="bootstrap_initial_admin",
            details={
                "before": old,
                "after": "admin",
                "source": "trusted_cli",
                "email_verified": True,
            },
        )
    )
    db.flush()
    return profile


async def main():
    parser = argparse.ArgumentParser(
        description="Назначение первого администратора по подтверждённой Supabase identity"
    )
    parser.add_argument("--user-id", required=True, type=UUID)
    args = parser.parse_args()
    settings = get_settings()
    if (
        not settings.initial_admin_email
        or not settings.supabase_url
        or not settings.supabase_service_role_key
    ):
        raise RuntimeError(
            "Задайте INITIAL_ADMIN_EMAIL и серверные Supabase credentials. Пароли и ключи не выводятся."
        )
    if not settings.supabase_url.startswith("https://"):
        raise RuntimeError("Supabase Auth URL должен использовать HTTPS.")
    async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
        response = await client.get(
            settings.supabase_url.rstrip("/")
            + "/auth/v1/admin/users/"
            + str(args.user_id),
            headers={
                "Authorization": "Bearer " + settings.supabase_service_role_key,
                "apikey": settings.supabase_service_role_key,
            },
        )
    if response.status_code != 200:
        raise RuntimeError("Не удалось проверить пользователя в Supabase Auth.")
    identity = response.json()
    if identity.get("id") != str(args.user_id):
        raise RuntimeError("Supabase вернул другую identity.")
    with SessionLocal() as db:
        assign_initial_admin(db, identity, settings.initial_admin_email)
        db.commit()
    print(
        "Первый администратор назначен. Удалите INITIAL_ADMIN_EMAIL из рабочего окружения."
    )


if __name__ == "__main__":
    asyncio.run(main())
