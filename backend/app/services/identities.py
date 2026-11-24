"""Email is synced by verified auth user ID, never accepted from editable profile input."""

from datetime import timedelta
from sqlalchemy import or_
from app.db import SessionLocal
from app.models import Profile
from app.services.access import ensure_profile, utcnow


def sync_identity(user_id: str, email: str | None):
    with SessionLocal() as db:
        profile = ensure_profile(db, user_id)
        now = utcnow()
        values = {"last_active_at": now}
        if email:
            values["email"] = email
        db.query(Profile).filter(
            Profile.id == profile.id,
            or_(
                Profile.last_active_at.is_(None),
                Profile.last_active_at < now - timedelta(minutes=1),
            ),
        ).update(values, synchronize_session=False)
        if email and profile.email != email:
            db.query(Profile).filter(Profile.id == profile.id).update(
                {"email": email}, synchronize_session=False
            )
        db.commit()
