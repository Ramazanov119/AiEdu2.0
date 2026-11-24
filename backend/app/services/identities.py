"""Email is synced by verified auth user ID, never accepted from editable profile input."""

from datetime import timedelta
from sqlalchemy import or_
from app.db import SessionLocal
from app.models import Profile
from app.services.access import ensure_profile, utcnow


def sync_identity(user_id: str, email: str | None, metadata: dict | None = None):
    # Auth metadata is editable: use it for display fields only, never RBAC.
    metadata = metadata if isinstance(metadata, dict) else {}
    name = metadata.get("full_name")
    name = name.strip()[:200] if isinstance(name, str) and name.strip() else None
    college = metadata.get("college")
    college = college if isinstance(college, str) and college in ("ETEC", "META", "ALT", "Q", "ATKK") else None
    with SessionLocal() as db:
        profile = ensure_profile(db, user_id, full_name=name, institution=college)
        # Preserve values already written by the shared DB's legacy Auth trigger.
        if not profile.full_name and name:
            profile.full_name = name
        if not profile.institution and college:
            profile.institution = college
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
