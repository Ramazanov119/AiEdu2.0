"""Reserve before network I/O under a per-profile lock; commit the immutable outcome afterwards."""

import uuid
from app.db import SessionLocal
from app.models import Profile, GenerationLog, GenerationReservation
from app.services.access import assert_access, utcnow
from fastapi import HTTPException


def reserve_generation(user_id):
    with SessionLocal() as db:
        # PostgreSQL row locks serialize API/Celery processes; SQLite uses a write transaction.
        if db.bind.dialect.name == "sqlite":
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        profile = (
            db.query(Profile)
            .filter(Profile.id == user_id)
            .with_for_update()
            .populate_existing()
            .first()
        )
        assert_access(db, user_id, profile=profile)
        reservation = GenerationReservation(
            id=str(uuid.uuid4()),
            user_id=user_id,
            organization_id=profile.organization_id,
            created_at=utcnow(),
        )
        db.add(reservation)
        db.commit()
        return {
            "id": reservation.id,
            "user_id": user_id,
            "organization_id": reservation.organization_id,
            "created_at": reservation.created_at,
        }


def finish_generation(
    reservation,
    *,
    agent_type,
    action_type,
    model_name,
    tokens_used,
    tokens_reported,
    duration_ms,
    status,
    error_message,
):
    with SessionLocal() as db:
        row = (
            db.query(GenerationReservation)
            .filter(GenerationReservation.id == reservation["id"])
            .with_for_update()
            .first()
        )
        if row is None:
            if db.get(GenerationLog, reservation["id"]):
                return
            raise RuntimeError("GENERATION_RESERVATION_MISSING")
        db.add(
            GenerationLog(
                id=row.id,
                user_id=row.user_id,
                organization_id=row.organization_id,
                created_at=row.created_at,
                agent_type=agent_type,
                action_type=action_type,
                model_name=model_name,
                tokens_used=tokens_used,
                tokens_reported=tokens_reported,
                duration_ms=duration_ms,
                status=status,
                error_message=error_message,
            )
        )
        db.delete(row)
        db.commit()
