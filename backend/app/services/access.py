"""Server-only access policy. A NULL subscription is allowed, as specified for legacy/base accounts."""

from datetime import datetime, timezone, timedelta
from app.core.timezones import load_zone
from sqlalchemy.orm import Session
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from app.core.config import get_settings
from app.models import Profile, Organization, GenerationLog, GenerationReservation


def utcnow():
    return datetime.now(timezone.utc)


def aware(value):
    return (
        value.replace(tzinfo=timezone.utc)
        if value.tzinfo is None
        else value.astimezone(timezone.utc)
    )


def day_bounds(now=None):
    current = (now or utcnow()).astimezone(load_zone(get_settings().analytics_timezone))
    start = current.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(
        timezone.utc
    )


def ensure_profile(db: Session, user_id: str, *, full_name: str | None = None, institution: str | None = None):
    profile = db.get(Profile, user_id)
    if profile is None:
        profile = Profile(id=user_id, full_name=full_name, institution=institution)
        db.add(profile)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            profile = db.get(Profile, user_id)
            if profile is None:
                raise
        db.refresh(profile)
    return profile


def assert_access(db: Session, user_id: str, *, profile=None, now=None):
    current = now or utcnow()
    profile = profile or db.get(Profile, user_id, populate_existing=True)
    if profile is None:
        raise HTTPException(
            403, "Профиль пользователя не найден. Откройте профиль перед генерацией."
        )
    if not profile.is_active:
        raise HTTPException(403, "Доступ пользователя приостановлен администратором.")
    if (
        profile.subscription_until is not None
        and aware(profile.subscription_until) <= current
    ):
        raise HTTPException(
            403, "Срок подписки истёк. Обратитесь к администратору для продления."
        )
    if profile.organization_id:
        organization = db.get(Organization, profile.organization_id)
        if not organization or not organization.is_active:
            raise HTTPException(403, "Доступ организации приостановлен.")
    start, end = day_bounds(current)
    used = (
        db.query(func.count(GenerationLog.id))
        .filter(
            GenerationLog.user_id == user_id,
            GenerationLog.created_at >= start,
            GenerationLog.created_at < end,
        )
        .scalar()
    )
    pending = (
        db.query(func.count(GenerationReservation.id))
        .filter(
            GenerationReservation.user_id == user_id,
            GenerationReservation.created_at >= start,
            GenerationReservation.created_at < end,
        )
        .scalar()
    )
    if used + pending >= profile.daily_limit:
        raise HTTPException(
            403,
            "Дневной лимит генераций исчерпан. Дождитесь следующих суток или обратитесь к администратору.",
        )
    return profile
