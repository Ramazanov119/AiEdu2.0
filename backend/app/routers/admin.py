from datetime import date, datetime, time, timedelta, timezone
from typing import Literal, Optional
from app.core.timezones import load_zone
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    AwareDatetime,
    StrictBool,
    StrictInt,
    field_validator,
)
from sqlalchemy import func, case, or_
from sqlalchemy.orm import Session
from app.core.auth import require_admin
from app.core.config import get_settings
from app.db import get_db
from app.models import (
    Profile,
    Organization,
    GenerationLog,
    GenerationReservation,
    AdminAuditLog,
)
from app.services.access import day_bounds, utcnow, aware

router = APIRouter(
    prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)]
)


def period(date_from: date | None, date_to: date | None):
    zone = load_zone(get_settings().analytics_timezone)
    today = utcnow().astimezone(zone).date()
    first = date_from or today - timedelta(days=29)
    last = date_to or today
    if last < first or (last - first).days > 366:
        raise HTTPException(422, "Период должен составлять от 1 до 367 дней.")
    return (
        datetime.combine(first, time.min, zone).astimezone(timezone.utc),
        datetime.combine(last + timedelta(days=1), time.min, zone).astimezone(
            timezone.utc
        ),
        first,
        last,
    )


@router.get("/analytics")
def analytics(
    date_from: date | None = None,
    date_to: date | None = None,
    all_time: bool = False,
    db: Session = Depends(get_db),
):
    if all_time:
        if date_from or date_to:
            raise HTTPException(422, "all_time нельзя совмещать с датами периода.")
        zone = load_zone(get_settings().analytics_timezone)
        last = utcnow().astimezone(zone).date()
        earliest = db.query(func.min(GenerationLog.created_at)).scalar()
        first = min(aware(earliest).astimezone(zone).date(), last) if earliest else last
        start = datetime.combine(first, time.min, zone).astimezone(timezone.utc)
        end = datetime.combine(last + timedelta(days=1), time.min, zone).astimezone(
            timezone.utc
        )
    else:
        start, end, first, last = period(date_from, date_to)
    logs = (
        db.query(GenerationLog)
        .filter(GenerationLog.created_at >= start, GenerationLog.created_at < end)
        .yield_per(1000)
    )
    # Aggregate by the captured organization, never the user's current membership.
    organizations = {
        o.id: {
            "organization_id": o.id,
            "name": o.name,
            "generations": 0,
            "success": 0,
            "error": 0,
        }
        for o in db.query(Organization).all()
    }
    organizations[None] = {
        "organization_id": None,
        "name": None,
        "generations": 0,
        "success": 0,
        "error": 0,
    }
    days = {
        str(first + timedelta(days=i)): {
            "date": str(first + timedelta(days=i)),
            "generations": 0,
            "success": 0,
            "error": 0,
        }
        for i in range((last - first).days + 1)
    }
    agents = {key: 0 for key in ("coordinator", "methodist", "creative", "assessment")}
    profile_counts = dict(
        db.query(Profile.organization_id, func.count(Profile.id))
        .filter(Profile.role.in_(["teacher", "methodist"]))
        .group_by(Profile.organization_id)
        .all()
    )
    for org_id, bucket in organizations.items():
        bucket["teachers"] = profile_counts.get(org_id, 0)
    tokens = 0
    unknown_tokens = 0
    total = successes = errors = total_duration = 0
    for log in logs:
        total += 1
        successes += log.status == "success"
        errors += log.status == "error"
        total_duration += log.duration_ms
        bucket = organizations.setdefault(
            log.organization_id,
            {
                "organization_id": log.organization_id,
                "name": None,
                "teachers": 0,
                "generations": 0,
                "success": 0,
                "error": 0,
            },
        )
        bucket["generations"] += 1
        bucket[log.status] += 1
        day = days[
            str(
                aware(log.created_at)
                .astimezone(load_zone(get_settings().analytics_timezone))
                .date()
            )
        ]
        day["generations"] += 1
        day[log.status] += 1
        agents[log.agent_type] = agents.get(log.agent_type, 0) + 1
        if log.tokens_reported:
            tokens += log.tokens_used
        else:
            unknown_tokens += 1
    now = utcnow()
    return {
        "date_from": first,
        "date_to": last,
        "timezone": get_settings().analytics_timezone,
        "total_users": db.query(func.count(Profile.id)).scalar(),
        "enabled_users": db.query(func.count(Profile.id))
        .filter(Profile.is_active.is_(True))
        .scalar(),
        "active_24h": db.query(func.count(Profile.id))
        .filter(Profile.last_active_at >= now - timedelta(hours=24))
        .scalar(),
        "active_7d": db.query(func.count(Profile.id))
        .filter(Profile.last_active_at >= now - timedelta(days=7))
        .scalar(),
        "total_generations": total,
        "success": successes,
        "error": errors,
        "average_duration_ms": round(total_duration / total) if total else None,
        "total_teachers": db.query(func.count(Profile.id))
        .filter(Profile.role.in_(["teacher", "methodist"]))
        .scalar(),
        "all_time": all_time,
        "tokens_used_reported": tokens,
        "generations_without_token_data": unknown_tokens,
        "in_flight_generations": db.query(
            func.count(GenerationReservation.id)
        ).scalar(),
        "by_organization": list(organizations.values()),
        "by_agent": agents,
        "by_day": list(days.values()),
    }


def serialize_profile(p):
    return {
        "id": p.id,
        "email": p.email,
        "full_name": p.full_name,
        "institution": p.institution,
        "role": p.role,
        "organization_id": p.organization_id,
        "is_active": p.is_active,
        "subscription_until": p.subscription_until,
        "daily_limit": p.daily_limit,
        "daily_limit_v1": getattr(p, "daily_limit_v1", None),
        "created_at": p.created_at,
        "last_active_at": p.last_active_at,
    }


@router.get("/users")
def users(
    organization_id: UUID | None = None,
    role: Literal["teacher", "methodist", "admin"] | None = None,
    is_active: bool | None = None,
    q: str = Query("", max_length=200),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    query = db.query(Profile)
    if organization_id is not None:
        query = query.filter(Profile.organization_id == str(organization_id))
    if role:
        query = query.filter(Profile.role == role)
    if is_active is not None:
        query = query.filter(Profile.is_active == is_active)
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.filter(
            or_(
                Profile.full_name.ilike("%" + escaped + "%", escape="\\"),
                Profile.email.ilike("%" + escaped + "%", escape="\\"),
            )
        )
    total = query.count()
    profiles = query.order_by(Profile.id).offset(offset).limit(limit).all()
    start, end = day_bounds()
    ids = [p.id for p in profiles]
    counts = (
        {
            row[0]: (row[1], row[2])
            for row in db.query(
                GenerationLog.user_id,
                func.count(GenerationLog.id),
                func.sum(
                    case(
                        (
                            (GenerationLog.created_at >= start)
                            & (GenerationLog.created_at < end),
                            1,
                        ),
                        else_=0,
                    )
                ),
            )
            .filter(GenerationLog.user_id.in_(ids))
            .group_by(GenerationLog.user_id)
            .all()
        }
        if ids
        else {}
    )
    return {
        "items": [
            {
                **serialize_profile(p),
                "generations_today": counts.get(p.id, (0, 0))[1],
                "generations_total": counts.get(p.id, (0, 0))[0],
            }
            for p in profiles
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


class UserPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["teacher", "methodist", "admin"] | None = None
    organization_id: str | None = Field(default=None, min_length=1, max_length=36)
    is_active: StrictBool | None = None
    subscription_until: AwareDatetime | None = None
    daily_limit: StrictInt | None = Field(default=None, ge=0, le=1000000)
    daily_limit_v1: Optional[int] = Field(default=None, ge=0, le=1000000)
    reason: str = Field(
        default="Изменение через административный API", min_length=3, max_length=1000
    )

    @field_validator("organization_id")
    @classmethod
    def organization_uuid(cls, value):
        if value is not None:
            return str(UUID(value))
        return None


@router.patch("/users/{user_id}")
def update_user(
    user_id: str,
    payload: UserPatch,
    admin: Profile = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if db.bind.dialect.name == "postgresql":
        try:
            user_id = str(UUID(user_id))
        except ValueError:
            raise HTTPException(422, "Некорректный UUID пользователя.")
    changes = payload.model_dump(exclude_unset=True, exclude={"reason"})
    if not changes:
        raise HTTPException(422, "Не указаны изменения.")
    if any(
        changes.get(key, "not_null") is None
        for key in ("role", "is_active", "daily_limit")
    ):
        raise HTTPException(422, "Роль, статус и лимит не могут быть null.")
    # Fixed lock order prevents two admins concurrently removing the last active admin.
    active_admins = (
        db.query(Profile)
        .filter(Profile.role == "admin", Profile.is_active.is_(True))
        .order_by(Profile.id)
        .with_for_update()
        .populate_existing()
        .all()
    )
    if not any(p.id == admin.id for p in active_admins):
        raise HTTPException(403, "Права администратора отозваны.")
    target = (
        db.query(Profile)
        .filter(Profile.id == user_id)
        .with_for_update()
        .populate_existing()
        .first()
    )
    if not target:
        raise HTTPException(404, "Пользователь не найден.")
    if changes.get("organization_id") is not None and not db.get(
        Organization, changes["organization_id"]
    ):
        raise HTTPException(422, "Организация не найдена.")
    if (
        target.role == "admin"
        and target.is_active
        and (
            changes.get("role", target.role) != "admin"
            or changes.get("is_active", True) is False
        )
        and len(active_admins) <= 1
    ):
        raise HTTPException(
            409, "Нельзя отключить или понизить последнего активного администратора."
        )
    for key, value in changes.items():
        old = getattr(target, key)
        if (
            isinstance(old, datetime)
            and isinstance(value, datetime)
            and aware(old) == aware(value)
        ):
            continue
        if old == value:
            continue
        setattr(target, key, value)
        action = {
            "role": "change_role",
            "organization_id": "change_organization",
            "subscription_until": "change_subscription",
            "daily_limit": "change_daily_limit",
            "daily_limit_v1": "change_daily_limit_v1",
            "is_active": "unblock" if value else "block",
        }[key]
        db.add(
            AdminAuditLog(
                admin_id=admin.id,
                target_user_id=target.id,
                action=action,
                details={
                    "field": key,
                    "before": old.isoformat() if isinstance(old, datetime) else old,
                    "after": (
                        value.isoformat() if isinstance(value, datetime) else value
                    ),
                    "reason": payload.reason,
                },
            )
        )
    db.commit()
    db.refresh(target)
    return serialize_profile(target)


class OrganizationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=300)
    is_active: StrictBool = True


@router.get("/organizations")
def organizations(db: Session = Depends(get_db)):
    counts = dict(
        db.query(Profile.organization_id, func.count(Profile.id))
        .filter(Profile.role.in_(["teacher", "methodist"]))
        .group_by(Profile.organization_id)
        .all()
    )
    return [
        {
            "id": o.id,
            "name": o.name,
            "is_active": o.is_active,
            "created_at": o.created_at,
            "teachers_count": counts.get(o.id, 0),
        }
        for o in db.query(Organization).order_by(Organization.name).all()
    ]


@router.post("/organizations", status_code=201)
def create_organization(
    payload: OrganizationCreate,
    admin: Profile = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not payload.name.strip():
        raise HTTPException(422, "Название колледжа не может быть пустым.")
    organization = Organization(name=payload.name.strip(), is_active=payload.is_active)
    db.add(organization)
    db.flush()
    db.add(
        AdminAuditLog(
            admin_id=admin.id,
            target_user_id=None,
            action="create_organization",
            details={
                "organization_id": organization.id,
                "name": organization.name,
                "is_active": organization.is_active,
            },
        )
    )
    db.commit()
    db.refresh(organization)
    return {
        "id": organization.id,
        "name": organization.name,
        "is_active": organization.is_active,
        "created_at": organization.created_at,
    }


@router.get("/logs")
def logs(
    status: Literal["success", "error"] | None = None,
    organization_id: UUID | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(GenerationLog)
    if status:
        query = query.filter(GenerationLog.status == status)
    if organization_id is not None:
        query = query.filter(GenerationLog.organization_id == str(organization_id))
    rows = (
        query.order_by(GenerationLog.created_at.desc(), GenerationLog.id.desc())
        .limit(100)
        .all()
    )
    profiles = (
        {
            p.id: p
            for p in db.query(Profile)
            .filter(Profile.id.in_({r.user_id for r in rows}))
            .all()
        }
        if rows
        else {}
    )
    organizations = {o.id: o.name for o in db.query(Organization).all()}
    return [
        {
            "id": l.id,
            "user_id": l.user_id,
            "user_name": (
                profiles[l.user_id].full_name if l.user_id in profiles else None
            ),
            "user_email": profiles[l.user_id].email if l.user_id in profiles else None,
            "organization_name": organizations.get(l.organization_id),
            "organization_id": l.organization_id,
            "agent_type": l.agent_type,
            "action_type": l.action_type,
            "model_name": l.model_name,
            "tokens_used": l.tokens_used,
            "tokens_reported": l.tokens_reported,
            "duration_ms": l.duration_ms,
            "status": l.status,
            "error_message": l.error_message,
            "created_at": l.created_at,
        }
        for l in rows
    ]


@router.get("/me")
def admin_me(admin: Profile = Depends(require_admin)):
    return serialize_profile(admin)


@router.get("/audit")
def audit_feed(
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(AdminAuditLog)
        .order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    ids = {r.admin_id for r in rows} | {
        r.target_user_id for r in rows if r.target_user_id
    }
    profiles = (
        {p.id: p for p in db.query(Profile).filter(Profile.id.in_(ids)).all()}
        if ids
        else {}
    )

    def label(user_id):
        p = profiles.get(user_id)
        return (p.full_name or p.email or p.id) if p else user_id

    return [
        {
            "id": r.id,
            "admin_id": r.admin_id,
            "admin_name": label(r.admin_id),
            "target_user_id": r.target_user_id,
            "target_user_name": label(r.target_user_id) if r.target_user_id else None,
            "action": r.action,
            "details": r.details,
            "created_at": r.created_at,
        }
        for r in rows
    ]
