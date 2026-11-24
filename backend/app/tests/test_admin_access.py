from datetime import timedelta, datetime, timezone
from uuid import uuid4
import asyncio
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.main import app
from app.db import get_db
from app.core.auth import get_user_id
from app.core.config import Settings, get_settings
from app.models import (
    Base,
    Profile,
    Organization,
    GenerationLog,
    GenerationReservation,
    AdminAuditLog,
    Task,
)
from app.services.access import utcnow, assert_access, day_bounds
from app.services.generation_tracking import reserve_generation, finish_generation
from app.bootstrap_admin import assign_initial_admin


@pytest.fixture
def setup(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    org_id = str(uuid4())
    with factory() as db:
        db.add(Organization(id=org_id, name="ЕТЭК"))
        db.flush()
        db.add_all(
            [
                Profile(
                    id="teacher",
                    full_name="Teacher",
                    email="teacher@example.invalid",
                    organization_id=org_id,
                ),
                Profile(id="admin", role="admin", email="admin@example.invalid"),
                Profile(id="methodist", role="methodist"),
            ]
        )
        db.commit()

    def dependency():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    app.dependency_overrides[get_user_id] = lambda: "teacher"
    monkeypatch.setattr("app.services.generation_tracking.SessionLocal", factory)
    monkeypatch.setattr("app.services.identities.SessionLocal", factory)
    monkeypatch.setattr("app.main.SessionLocal", factory)
    monkeypatch.setattr("app.workers.celery_app.SessionLocal", factory)
    with TestClient(app) as client:
        yield client, factory, org_id
    app.dependency_overrides.clear()
    engine.dispose()


def admin_login():
    app.dependency_overrides[get_user_id] = lambda: "admin"


@pytest.mark.parametrize(
    "path",
    [
        "/admin/analytics",
        "/admin/users",
        "/admin/organizations",
        "/admin/logs",
        "/api/admin/users",
    ],
)
def test_teacher_cannot_read_admin_routes(setup, path):
    client, _, _ = setup
    assert client.get(path).status_code == 403


def test_teacher_and_methodist_cannot_write_or_assign_roles(setup):
    client, _, _ = setup
    for user in ["teacher", "methodist"]:
        app.dependency_overrides[get_user_id] = lambda: user
        assert (
            client.patch("/api/admin/users/teacher", json={"role": "admin"}).status_code
            == 403
        )
        assert (
            client.post("/admin/organizations", json={"name": "META"}).status_code
            == 403
        )


@pytest.mark.parametrize(
    "change,reason",
    [
        ({"is_active": False}, "приостановлен"),
        ({"subscription_until": utcnow() - timedelta(seconds=1)}, "истёк"),
        ({"daily_limit": 0}, "лимит"),
    ],
)
def test_generation_routes_check_access_before_any_provider(setup, change, reason):
    client, factory, _ = setup
    with factory() as db:
        p = db.get(Profile, "teacher")
        for key, value in change.items():
            setattr(p, key, value)
        db.commit()
    for path, body in [
        ("/chat/messages", {"content": "контрольная"}),
        ("/lessons/generate", {"portfolio_file_id": "missing", "topic": "SQL"}),
        ("/lessons/missing/retry", {}),
    ]:
        response = client.post(path, json=body)
        assert response.status_code == 403
        assert reason in response.json()["detail"].lower()
    with factory() as db:
        assert db.query(GenerationLog).count() == 0


def test_nullable_subscription_allows_base_access_and_inactive_org_denies(setup):
    _, factory, org = setup
    with factory() as db:
        assert assert_access(db, "teacher").id == "teacher"
        db.get(Organization, org).is_active = False
        db.commit()
        with pytest.raises(HTTPException, match="организации"):
            assert_access(db, "teacher")


def test_inactive_admin_is_denied_immediately(setup):
    client, factory, _ = setup
    admin_login()
    with factory() as db:
        db.get(Profile, "admin").is_active = False
        db.commit()
    assert client.get("/admin/users").status_code == 403


def test_admin_patch_is_atomic_audited_and_does_not_touch_auth(setup):
    client, factory, _ = setup
    admin_login()
    org = client.post("/api/admin/organizations", json={"name": "META"}).json()
    result = client.patch(
        "/admin/users/teacher",
        json={
            "role": "methodist",
            "organization_id": org["id"],
            "is_active": False,
            "subscription_until": (utcnow() + timedelta(days=30)).isoformat(),
            "daily_limit": 9,
            "reason": "Paid grant checked",
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["daily_limit"] == 9
    with factory() as db:
        logs = (
            db.query(AdminAuditLog)
            .filter(AdminAuditLog.target_user_id == "teacher")
            .all()
        )
        assert len(logs) == 5
        assert all(
            log.admin_id == "admin" and log.details["reason"] == "Paid grant checked"
            for log in logs
        )
    assert (
        client.patch(
            "/admin/users/teacher",
            json={"organization_id": str(uuid4()), "role": "admin"},
        ).status_code
        == 422
    )
    with factory() as db:
        assert db.get(Profile, "teacher").role == "methodist"
    assert (
        client.patch(
            "/admin/users/teacher", json={"subscription_until": None, "is_active": True}
        ).status_code
        == 200
    )


def test_last_admin_cannot_be_demoted_or_disabled(setup):
    client, _, _ = setup
    admin_login()
    assert (
        client.patch("/admin/users/admin", json={"is_active": False}).status_code == 409
    )
    assert (
        client.patch("/admin/users/admin", json={"role": "teacher"}).status_code == 409
    )


def test_ordinary_profile_update_cannot_write_system_fields(setup):
    client, _, _ = setup
    for key, value in [
        ("role", "admin"),
        ("is_active", True),
        ("subscription_until", None),
        ("daily_limit", 99999),
        ("storage_path", "/etc/passwd"),
        ("email", "other@example.invalid"),
    ]:
        assert client.put("/profile", json={key: value}).status_code == 422
    assert (
        client.put(
            "/profile", json={"full_name": "Updated", "institution": "Legacy text"}
        ).status_code
        == 200
    )


def add_log(
    db, user="teacher", org=None, status="success", when=None, agent="methodist"
):
    log = GenerationLog(
        user_id=user,
        organization_id=org,
        agent_type=agent,
        action_type="plan",
        model_name="test-model",
        duration_ms=100,
        status=status,
        tokens_used=5,
        tokens_reported=True,
        created_at=when or utcnow(),
    )
    db.add(log)
    db.commit()
    return log


def test_admin_filters_counts_analytics_and_log_feed(setup):
    client, factory, org = setup
    admin_login()
    with factory() as db:
        add_log(db, org=org)
        add_log(db, org=org, status="error", agent="assessment")
        add_log(db, when=utcnow() - timedelta(days=3))
        db.get(Profile, "teacher").last_active_at = utcnow()
        db.commit()
    page = client.get(
        "/admin/users",
        params={"q": "teacher@example", "organization_id": org, "role": "teacher"},
    ).json()
    assert page["total"] == 1
    assert page["items"][0]["generations_today"] == 2
    assert page["items"][0]["generations_total"] == 3
    stats = client.get("/admin/analytics").json()
    assert (
        stats["total_users"] == 3
        and stats["active_24h"] == 1
        and stats["active_7d"] == 1
    )
    assert (stats["total_generations"], stats["success"], stats["error"]) == (3, 2, 1)
    assert stats["by_agent"]["assessment"] == 1
    assert (
        next(x for x in stats["by_organization"] if x["organization_id"] == org)[
            "generations"
        ]
        == 2
    )
    assert (
        len(
            client.get(
                "/admin/logs", params={"status": "error", "organization_id": org}
            ).json()
        )
        == 1
    )
    assert (
        client.get("/admin/users", params={"organization_id": "bad-uuid"}).status_code
        == 422
    )
    assert (
        client.get(
            "/admin/analytics",
            params={"date_from": "2026-11-23", "date_to": "2026-11-22"},
        ).status_code
        == 422
    )


def test_quota_counts_errors_and_reserves_parallel_slots(setup):
    _, factory, _ = setup
    with factory() as db:
        db.get(Profile, "teacher").daily_limit = 2
        db.commit()
        add_log(db, status="error")
    reservation = reserve_generation("teacher")
    with pytest.raises(HTTPException, match="лимит"):
        reserve_generation("teacher")
    finish_generation(
        reservation,
        agent_type="creative",
        action_type="presentation",
        model_name="test",
        tokens_used=0,
        tokens_reported=False,
        duration_ms=10,
        status="success",
        error_message=None,
    )
    with factory() as db:
        assert db.query(GenerationLog).count() == 2
        assert db.query(GenerationReservation).count() == 0


def test_day_boundary_uses_almaty_not_server_timezone(setup):
    _, factory, _ = setup
    now = datetime(2026, 11, 23, 19, 1, tzinfo=timezone.utc)  # Nov 24 00:01 Almaty
    start, end = day_bounds(now)
    assert start == datetime(2026, 11, 23, 19, 0, tzinfo=timezone.utc)
    with factory() as db:
        db.get(Profile, "teacher").daily_limit = 1
        db.commit()
        add_log(db, when=start - timedelta(microseconds=1))
        assert assert_access(db, "teacher", now=now)
        add_log(db, when=start)
        with pytest.raises(HTTPException):
            assert_access(db, "teacher", now=now)


def test_celery_rechecks_access_before_llm(setup, monkeypatch):
    _, factory, _ = setup
    from app.workers.celery_app import agent_team_task

    with factory() as db:
        db.get(Profile, "teacher").is_active = False
        task = Task(owner_id="teacher", title="Queued before ban", status="assigned")
        db.add(task)
        db.commit()
        task_id = task.id

    async def forbidden(*a, **kw):
        raise AssertionError("LLM must not run")

    monkeypatch.setattr("app.workers.celery_app.generate", forbidden)
    result = agent_team_task.run(task_id, "teacher")
    assert result["status"] == "failed"
    with factory() as db:
        assert db.query(GenerationLog).count() == 0
        assert "приостановлен" in db.get(Task, task_id).error


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://u:secret@db.production.example/db",
        "postgresql://localhost/db?host=remote.example",
        "postgresql://localhost/db?hostaddr=8.8.8.8",
        "postgresql://localhost/db?host=/tmp,remote.example",
        "postgresql://localhost/db?service=production",
    ],
)
def test_local_mode_rejects_external_postgres_without_exposing_password(url):
    with pytest.raises(ValueError) as error:
        Settings(_env_file=None, environment="local", database_url=url)
    assert "secret" not in str(error.value)


def test_explicit_local_is_required_and_staging_never_uses_fallback(monkeypatch):
    from app.core.auth import get_user_id

    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("LOCAL_DEV_USER_ID", "must-not-authenticate")
    get_settings.cache_clear()
    with pytest.raises(HTTPException) as error:
        asyncio.run(get_user_id(None))
    assert error.value.status_code == 401
    monkeypatch.delenv("ENVIRONMENT")
    get_settings.cache_clear()
    assert Settings(_env_file=None).environment == "production"


def test_trusted_bootstrap_requires_confirmed_configured_email(generation_session):
    user = str(uuid4())
    identity = {
        "id": user,
        "email": "owner@example.invalid",
        "email_confirmed_at": "2026-11-01T00:00:00Z",
    }
    with generation_session() as db:
        with pytest.raises(ValueError):
            assign_initial_admin(
                db, {**identity, "email_confirmed_at": None}, identity["email"]
            )
        with pytest.raises(ValueError):
            assign_initial_admin(db, identity, "different@example.invalid")
        profile = assign_initial_admin(db, identity, identity["email"])
        db.commit()
        assert profile.role == "admin"
        assert (
            db.query(AdminAuditLog)
            .filter(AdminAuditLog.action == "bootstrap_initial_admin")
            .count()
            == 1
        )


def test_actual_startup_refuses_local_external_database():
    import subprocess, sys, os
    from pathlib import Path

    env = {
        **os.environ,
        "ENVIRONMENT": "local",
        "DATABASE_URL": "postgresql+psycopg://user:must-not-be-printed@production.example.invalid/database",
    }
    result = subprocess.run(
        [sys.executable, "-c", "import app.main"],
        cwd=Path(__file__).resolve().parents[2],
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode != 0
    assert "ENVIRONMENT=local" in result.stderr
    assert "must-not-be-printed" not in result.stderr


def test_old_sqlite_profile_survives_additive_local_upgrade(tmp_path):
    import sqlite3, subprocess, sys, os
    from pathlib import Path

    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as connection:
        connection.execute(
            "CREATE TABLE profiles(id VARCHAR(36) PRIMARY KEY,full_name TEXT,institution TEXT)"
        )
        connection.execute(
            "INSERT INTO profiles VALUES('legacy-user','Legacy teacher','Old institution')"
        )
    env = {
        **os.environ,
        "ENVIRONMENT": "local",
        "DATABASE_URL": "sqlite:///" + str(path),
    }
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from app.db import SessionLocal;from app.models import Profile;db=SessionLocal();p=db.get(Profile,'legacy-user');assert (p.role,p.is_active,p.daily_limit,p.subscription_until,p.institution)==('teacher',True,20,None,'Old institution');db.close()",
        ],
        cwd=Path(__file__).resolve().parents[2],
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr


def test_verified_auth_sync_ignores_metadata_roles_and_requires_cli_bootstrap(
    setup, monkeypatch
):
    client, factory, organization_id = setup
    app.dependency_overrides.pop(get_user_id)
    monkeypatch.setenv("SUPABASE_URL", "https://auth.example.invalid")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "synthetic")
    monkeypatch.setenv("INITIAL_ADMIN_EMAIL", "teacher@example.invalid")
    get_settings.cache_clear()

    class AuthResponse:
        status_code = 200

        def json(self):
            return {
                "id": "teacher",
                "email": "teacher@example.invalid",
                "email_confirmed_at": "2026-11-01T00:00:00Z",
                "user_metadata": {"role": "admin", "full_name": "Иван Петров", "college": "ETEC"},
            }

    class AuthClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **kw):
            return AuthResponse()

    monkeypatch.setattr("app.core.auth.httpx.AsyncClient", AuthClient)
    response = client.get("/profile", headers={"Authorization": "Bearer test"})
    assert response.status_code == 200
    with factory() as db:
        assert db.get(Profile, "teacher").role == "teacher"
        assert db.get(Profile, "teacher").full_name == "Teacher"
        assert db.get(Profile, "teacher").institution == "ETEC"
        assert db.get(Profile, "teacher").organization_id == organization_id
    assert (
        client.get("/admin/users", headers={"Authorization": "Bearer test"}).status_code
        == 403
    )
    with factory() as db:
        assert db.get(Profile, "teacher").last_active_at is not None


def test_existing_frontend_profile_round_trip_remains_compatible(setup):
    client, _, _ = setup
    profile = client.get("/profile").json()
    profile["full_name"] = "Updated by legacy UI"
    assert client.put("/profile", json=profile).status_code == 200
    assert client.put("/profile", json={**profile, "id": "admin"}).status_code == 403


def test_admin_ui_read_contracts_and_own_profile(setup):
    client, factory, org_id = setup
    own = client.get("/profile/access")
    assert own.status_code == 200
    assert own.json()["id"] == "teacher"
    assert client.get("/profile/access?user_id=admin").json()["id"] == "teacher"
    assert own.json()["role"] == "teacher"
    assert "role" not in client.get("/profile").json()
    for path in ["/api/admin/me", "/api/admin/audit"]:
        assert client.get(path).status_code == 403
    admin_login()
    assert client.get("/api/admin/me").json()["role"] == "admin"
    assert (
        client.patch(
            "/api/admin/users/teacher",
            json={"is_active": False, "reason": "Проверка интерфейса"},
        ).status_code
        == 200
    )
    rows = client.get(
        "/api/admin/users", params={"is_active": False, "limit": 1}
    ).json()
    assert rows["total"] == 1 and rows["items"][0]["id"] == "teacher"
    assert (
        client.get("/api/admin/users", params={"is_active": True}).json()["total"] == 2
    )
    audit = client.get("/api/admin/audit").json()
    assert audit[0]["action"] == "block"
    assert audit[0]["admin_name"] == "admin@example.invalid"
    assert audit[0]["target_user_name"] == "Teacher"
    assert audit[0]["details"]["before"] is True
    assert client.get("/api/admin/audit", params={"offset": 1}).json() == []
    assert client.get("/api/admin/organizations").json()[0]["teachers_count"] == 1


def test_admin_ui_all_time_and_average(setup):
    client, factory, org_id = setup
    with factory() as db:
        for days, duration in [(800, 100), (0, 300)]:
            db.add(
                GenerationLog(
                    user_id="teacher",
                    organization_id=org_id,
                    agent_type="coordinator",
                    action_type="plan",
                    model_name="test-only",
                    duration_ms=duration,
                    status="success",
                    created_at=utcnow() - timedelta(days=days),
                )
            )
        db.commit()
    admin_login()
    recent = client.get("/api/admin/analytics").json()
    assert recent["total_generations"] == 1
    assert recent["average_duration_ms"] == 300
    all_time = client.get("/api/admin/analytics", params={"all_time": True}).json()
    assert all_time["total_generations"] == 2
    assert all_time["average_duration_ms"] == 200
    assert all_time["total_teachers"] == 2
    assert sum(row["teachers"] for row in all_time["by_organization"]) == 2
    assert len(all_time["by_day"]) >= 800
    assert (
        client.get(
            "/api/admin/analytics", params={"all_time": True, "date_from": "2026-01-01"}
        ).status_code
        == 422
    )
    row = client.get("/api/admin/logs").json()[0]
    assert row["user_name"] == "Teacher"
    assert row["organization_name"] == "ЕТЭК"


def test_admin_ui_rejects_missing_authentication(setup):
    client, _, _ = setup
    del app.dependency_overrides[get_user_id]
    for path in ["/profile/access", "/api/admin/me", "/api/admin/audit"]:
        assert client.get(path).status_code == 401
