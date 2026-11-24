"""Only a newly created disposable Unix-socket cluster is accepted; never a configured application DB."""

import os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import DBAPIError
from app.models import Profile, Organization, GenerationLog

USER = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-000000000002"


@pytest.fixture(scope="module")
def pg():
    value = os.environ.get("AIEDU_TEST_POSTGRES_URL")
    if not value:
        pytest.skip("Dedicated disposable PostgreSQL URL not supplied")
    url = make_url(value)
    assert (
        url.database == "aiedu_rbac_test"
        and url.host is None
        and str(url.query.get("host", "")).startswith(
            ("/private/tmp/aiedu-rbac-", "/tmp/aiedu-rbac-")
        )
    ), "Refuse non-disposable DB"
    engine = create_engine(value)
    with engine.connect() as conn:
        conn.exec_driver_sql("SELECT 1")
    raw = engine.raw_connection()
    try:
        cursor = raw.driver_connection.cursor()
        cursor.execute(
            """DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;
        CREATE SCHEMA auth;CREATE SCHEMA storage;
        CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,created_at timestamptz DEFAULT now());
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.user_id',true),'')::uuid $$;
        CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
        CREATE TABLE storage.objects(id uuid,owner_id text,bucket_id text);
        GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
        """,
            prepare=False,
        )
        root = Path(__file__).resolve().parents[3]
        for file in sorted((root / "supabase/migrations").glob("*.sql")):
            if file.name.startswith("202611230") or file.name.endswith(
                "_full_sync_production.sql"
            ):
                continue
            cursor.execute(file.read_text(), prepare=False)
        cursor.execute(
            f"""INSERT INTO auth.users(id,email) VALUES('{USER}','teacher@example.invalid'),('{OTHER}','other@example.invalid'),('00000000-0000-4000-8000-000000000005','unprofiled@example.invalid');
        INSERT INTO profiles(id,full_name) VALUES('{USER}','Legacy profile'),('{OTHER}','Other profile');
        INSERT INTO agent_audit(owner_id,agent,action)VALUES('{USER}','methodist','own'),('{OTHER}','creative','foreign');
        INSERT INTO portfolio_files(id,owner_id,category,filename,storage_path)VALUES('00000000-0000-4000-8000-000000000003','{USER}','РУП','test.docx','placeholder');
        GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,anon,service_role;
        GRANT UPDATE(storage_path) ON portfolio_files TO authenticated;
        """,
            prepare=False,
        )
        cursor.execute(
            (
                root / "supabase/migrations/20261123000005_access_roles_analytics.sql"
            ).read_text(),
            prepare=False,
        )
        raw.commit()
    finally:
        raw.close()
    yield engine
    engine.dispose()


def authenticated(engine, statement):
    with engine.begin() as conn:
        conn.exec_driver_sql("SET LOCAL ROLE authenticated")
        conn.execute(text("SELECT set_config('test.user_id',:id,true)"), {"id": USER})
        return (
            conn.execute(text(statement)).all()
            if statement.lstrip().upper().startswith("SELECT")
            else conn.execute(text(statement))
        )


def test_real_migration_backfills_auth_users_without_promoting_them(pg):
    with pg.begin() as conn:
        rows = conn.execute(
            text("SELECT id,role,email FROM profiles ORDER BY id")
        ).all()
        assert len(rows) == 3 and all(r.role == "teacher" for r in rows)
        new = str(uuid4())
        conn.execute(
            text("INSERT INTO auth.users(id,email)VALUES(:id,:email)"),
            {"id": new, "email": "new@example.invalid"},
        )
        assert (
            conn.execute(
                text("SELECT role FROM profiles WHERE id=:id"), {"id": new}
            ).scalar()
            == "teacher"
        )


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE profiles SET role='admin'",
        "UPDATE profiles SET is_active=false",
        "UPDATE profiles SET daily_limit=100000",
        "UPDATE profiles SET subscription_until=now()",
        "UPDATE profiles SET email='forged@example.invalid'",
        "UPDATE portfolio_files SET storage_path='/etc/passwd'",
        "DELETE FROM agent_audit",
        "UPDATE agent_audit SET action='forged'",
        "INSERT INTO agent_audit(owner_id,agent,action)VALUES('00000000-0000-4000-8000-000000000001','methodist','forged')",
    ],
)
def test_authenticated_cannot_write_system_fields_or_audit(pg, statement):
    with pytest.raises(DBAPIError) as exc:
        authenticated(pg, statement)
    assert exc.value.orig.sqlstate == "42501"


def test_owner_read_and_safe_profile_edits_still_work(pg):
    rows = authenticated(pg, "SELECT action FROM agent_audit")
    assert [r.action for r in rows] == ["own"]
    authenticated(
        pg, "UPDATE profiles SET full_name='Updated',institution='Legacy college'"
    )
    rows = authenticated(pg, "SELECT full_name FROM profiles")
    assert len(rows) == 1 and rows[0].full_name == "Updated"


def test_audit_is_immutable_even_for_owner_and_backend_can_only_append(pg):
    with pg.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO admin_audit_logs(admin_id,target_user_id,action,details)VALUES(:id,:id,'synthetic_test','{}')"
            ),
            {"id": USER},
        )
    with pytest.raises(DBAPIError):
        with pg.begin() as conn:
            conn.execute(text("DELETE FROM admin_audit_logs"))
    with pg.begin() as conn:
        conn.exec_driver_sql("SET LOCAL ROLE aiedu_backend")
        conn.execute(
            text(
                "INSERT INTO agent_audit(owner_id,agent,action)VALUES(:id,'coordinator','trusted_backend')"
            ),
            {"id": USER},
        )
    with pytest.raises(DBAPIError):
        with pg.begin() as conn:
            conn.exec_driver_sql("SET LOCAL ROLE aiedu_backend")
            conn.execute(text("UPDATE agent_audit SET action='changed'"))


def test_concurrent_workers_cannot_exceed_one_remaining_slot(pg, monkeypatch):
    import app.services.generation_tracking as tracking

    factory = sessionmaker(bind=pg, expire_on_commit=False)
    monkeypatch.setattr(tracking, "SessionLocal", factory)
    with factory() as db:
        db.get(Profile, USER).daily_limit = 1
        db.commit()

    def attempt():
        try:
            return tracking.reserve_generation(USER)
        except HTTPException as exc:
            return exc.status_code

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: attempt(), range(4)))
    reserved = [r for r in results if isinstance(r, dict)]
    assert len(reserved) == 1 and results.count(403) == 3
    tracking.finish_generation(
        reserved[0],
        agent_type="methodist",
        action_type="plan",
        model_name="test",
        tokens_used=7,
        tokens_reported=True,
        duration_ms=10,
        status="success",
        error_message=None,
    )
    with factory() as db:
        assert (
            db.query(GenerationLog).filter(GenerationLog.user_id == USER).count() == 1
        )


def test_bootstrap_and_admin_api_operate_on_native_uuid_schema(pg):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.db import get_db
    from app.core.auth import get_user_id
    from app.bootstrap_admin import assign_initial_admin

    factory = sessionmaker(bind=pg, expire_on_commit=False)
    with factory() as db:
        assign_initial_admin(
            db,
            {
                "id": USER,
                "email": "teacher@example.invalid",
                "email_confirmed_at": "2026-11-01T00:00:00Z",
            },
            "teacher@example.invalid",
        )
        db.commit()

    def dependency():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    app.dependency_overrides[get_user_id] = lambda: USER
    try:
        with TestClient(app) as client:
            response = client.get("/api/admin/users", params={"q": "teacher@example"})
            assert response.status_code == 200, response.text
            assert response.json()["items"][0]["id"] == USER
            assert client.get("/api/admin/analytics").status_code == 200
            changed = client.patch(
                "/api/admin/users/" + OTHER,
                json={
                    "role": "methodist",
                    "is_active": False,
                    "reason": "Native migration verification",
                },
            )
            assert changed.status_code == 200, changed.text
            assert changed.json()["role"] == "methodist"
    finally:
        app.dependency_overrides.clear()
