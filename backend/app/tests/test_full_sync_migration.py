"""Reconcile only a disposable local database; never read application DATABASE_URL."""

import os
from pathlib import Path
from uuid import uuid4
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "supabase/migrations/20261123999999_full_sync_production.sql"
USER = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-000000000002"


@pytest.fixture(
    scope="module",
    params=[
        "legacy",
        "empty",
        "previous_migrations",
        "legacy_tables_uuid",
        "legacy_tables_text",
    ],
)
def reconciled(request):
    value = os.environ.get("AIEDU_TEST_POSTGRES_URL")
    if not value:
        pytest.skip("Dedicated disposable PostgreSQL URL not supplied")
    url = make_url(value)
    assert url.database == "aiedu_rbac_test" and url.host is None
    assert str(url.query.get("host", "")).startswith(
        ("/private/tmp/aiedu-rbac-", "/tmp/aiedu-rbac-")
    )
    control = create_engine(url, isolation_level="AUTOCOMMIT")
    database = "aiedu_sync_" + uuid4().hex
    with control.connect() as conn:
        conn.exec_driver_sql("CREATE DATABASE " + database)
    engine = create_engine(url.set(database=database))
    raw = engine.raw_connection()
    try:
        cursor = raw.driver_connection.cursor()
        cursor.execute(
            """DO $$ BEGIN
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
          END $$;
          CREATE SCHEMA auth; CREATE SCHEMA storage;
          CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,created_at timestamptz DEFAULT now());
          CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.user_id',true),'')::uuid $$;
          CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
          CREATE TABLE storage.objects(id uuid,owner_id text,bucket_id text);
          ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
          GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated;
          GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated;
          CREATE POLICY unrelated_legacy_storage ON storage.objects TO authenticated USING(true) WITH CHECK(true);
        """,
            prepare=False,
        )
        cursor.execute(
            f"INSERT INTO auth.users(id,email) VALUES('{USER}','owner@example.invalid'),('{OTHER}','other@example.invalid')"
        )
        if request.param.startswith("legacy"):
            cursor.execute(
                f"""CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),full_name text NOT NULL,college text NOT NULL,status text DEFAULT 'active',plan text DEFAULT 'base');
             INSERT INTO profiles VALUES('{USER}','Legacy Name','Legacy College','blocked','old-plan');
             ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
             CREATE POLICY legacy_full_access ON profiles TO authenticated USING(true) WITH CHECK(true);
             GRANT ALL ON profiles TO authenticated,anon;
             GRANT UPDATE(college,status,plan) ON profiles TO authenticated;
            """,
                prepare=False,
            )
        if request.param in {"legacy_tables_uuid", "legacy_tables_text"}:
            source_type = "uuid" if request.param.endswith("uuid") else "text"
            for table in [
                "portfolio_files",
                "tasks",
                "task_steps",
                "lessons",
                "lesson_materials",
                "chat_messages",
                "agent_audit",
            ]:
                cursor.execute(
                    f"CREATE TABLE public.{table}(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id {source_type} NOT NULL,legacy_required text NOT NULL)"
                )
                cursor.execute(
                    f"INSERT INTO public.{table}(user_id,legacy_required)VALUES('{USER}','kept-own'),('{OTHER}','kept-other')"
                )
                if source_type == "text":
                    cursor.execute(
                        f"INSERT INTO public.{table}(user_id,legacy_required)VALUES('external-non-uuid','kept-unmapped')"
                    )
            # A populated owner takes precedence over an inconsistent old user_id.
            cursor.execute(
                f"ALTER TABLE tasks ADD COLUMN owner_id uuid; UPDATE tasks SET owner_id='{OTHER}' WHERE user_id::text='{USER}'"
            )
            # Reconcile even if a prior schema has already locked audit rows.
            cursor.execute(
                """CREATE FUNCTION public.legacy_test_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'old audit immutable'; END $$;
              CREATE TRIGGER agent_audit_immutable BEFORE UPDATE OR DELETE ON public.agent_audit FOR EACH ROW EXECUTE FUNCTION public.legacy_test_immutable();""",
                prepare=False,
            )
        elif request.param == "previous_migrations":
            for file in sorted((ROOT / "supabase/migrations").glob("*.sql")):
                if file == SCRIPT:
                    continue
                cursor.execute(file.read_text(), prepare=False)
        raw.commit()
        cursor.execute(SCRIPT.read_text(), prepare=False)
        raw.commit()
        # A repeat must retain explicit admin/access/subscription settings and real logs.
        cursor.execute(
            f"UPDATE profiles SET role='admin',is_active=false,daily_limit=7,subscription_until='2027-01-01Z' WHERE id='{USER}'"
        )
        cursor.execute(
            f"INSERT INTO agent_audit(owner_id,agent,action) VALUES('{USER}','methodist','own'),('{OTHER}','methodist','foreign')"
        )
        raw.commit()
        cursor.execute(SCRIPT.read_text(), prepare=False)
        raw.commit()
        yield engine, request.param
    finally:
        raw.close()
        engine.dispose()
        with control.connect() as conn:
            conn.exec_driver_sql("DROP DATABASE " + database + " WITH (FORCE)")
        control.dispose()


def test_full_sync_preserves_rows_and_access_on_repeat(reconciled):
    engine, variant = reconciled
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT role,is_active,daily_limit FROM profiles WHERE id=:id"),
            {"id": USER},
        ).one()
        assert tuple(row) == ("admin", False, 7)
        assert conn.exec_driver_sql("SELECT count(*) FROM profiles").scalar() == 2
        assert conn.exec_driver_sql("SELECT count(*) FROM agent_audit").scalar() == (
            5
            if variant == "legacy_tables_text"
            else 4 if variant == "legacy_tables_uuid" else 2
        )
        assert (
            conn.exec_driver_sql(
                "SELECT public FROM storage.buckets WHERE id='portfolio-private'"
            ).scalar()
            is False
        )
        if variant == "legacy":
            row = conn.execute(
                text(
                    "SELECT full_name,college,status,plan,institution FROM profiles WHERE id=:id"
                ),
                {"id": USER},
            ).one()
            assert tuple(row) == (
                "Legacy Name",
                "Legacy College",
                "blocked",
                "old-plan",
                "Legacy College",
            )
        tables = {
            r[0]
            for r in conn.exec_driver_sql(
                "SELECT tablename FROM pg_tables WHERE schemaname='public'"
            )
        }
        assert {
            "organizations",
            "portfolio_files",
            "tasks",
            "task_steps",
            "lessons",
            "lesson_materials",
            "chat_messages",
            "agent_audit",
            "generation_logs",
            "generation_reservations",
            "admin_audit_logs",
        } <= tables


def test_full_sync_auth_trigger_handles_missing_legacy_display_fields(reconciled):
    engine, _ = reconciled
    new = str(uuid4())
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO auth.users(id,email) VALUES(:id,:email)"),
            {"id": new, "email": "new@example.invalid"},
        )
        assert (
            conn.execute(
                text("SELECT role FROM profiles WHERE id=:id"), {"id": new}
            ).scalar()
            == "teacher"
        )
        conn.execute(text("DELETE FROM profiles WHERE id=:id"), {"id": new})
        conn.execute(text("DELETE FROM auth.users WHERE id=:id"), {"id": new})


def test_full_sync_owner_reads_and_safe_profile_edits_only(reconciled):
    engine, _ = reconciled
    with engine.begin() as conn:
        conn.exec_driver_sql("SET LOCAL ROLE authenticated")
        conn.execute(text("SELECT set_config('test.user_id',:id,true)"), {"id": USER})
        assert conn.exec_driver_sql(
            "SELECT action FROM agent_audit WHERE action IS NOT NULL"
        ).scalars().all() == ["own"]
        assert conn.exec_driver_sql(
            "SELECT id::text FROM profiles"
        ).scalars().all() == [USER]
        conn.exec_driver_sql(
            "UPDATE profiles SET full_name='Changed' WHERE id=auth.uid()"
        )
    for sql in [
        "UPDATE profiles SET role='admin'",
        "UPDATE profiles SET daily_limit=1000",
        "DELETE FROM agent_audit",
        "INSERT INTO agent_audit(owner_id,agent,action) VALUES(auth.uid(),'creative','forged')",
    ]:
        with pytest.raises(DBAPIError) as exc:
            with engine.begin() as conn:
                conn.exec_driver_sql("SET LOCAL ROLE authenticated")
                conn.execute(
                    text("SELECT set_config('test.user_id',:id,true)"), {"id": USER}
                )
                conn.exec_driver_sql(sql)
        assert exc.value.orig.sqlstate == "42501"


def test_full_sync_log_immutability_and_storage_isolation(reconciled):
    engine, _ = reconciled
    for sql in [
        "UPDATE agent_audit SET action='forged'",
        "DELETE FROM agent_audit",
        "TRUNCATE agent_audit",
    ]:
        with pytest.raises(DBAPIError) as exc:
            with engine.begin() as conn:
                conn.exec_driver_sql(sql)
        assert exc.value.orig.sqlstate == "42501"
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO storage.objects(id,bucket_id,owner_id) VALUES(:id,'portfolio-private',:owner)"
            ),
            {"id": str(uuid4()), "owner": OTHER},
        )
        conn.exec_driver_sql("SET LOCAL ROLE authenticated")
        conn.execute(text("SELECT set_config('test.user_id',:id,true)"), {"id": USER})
        assert (
            conn.exec_driver_sql("SELECT count(*) FROM storage.objects").scalar() == 0
        )
        conn.execute(
            text(
                "INSERT INTO storage.objects(id,bucket_id,owner_id) VALUES(:id,'portfolio-private',:owner)"
            ),
            {"id": str(uuid4()), "owner": USER},
        )
    with pytest.raises(DBAPIError):
        with engine.begin() as conn:
            conn.exec_driver_sql("SET LOCAL ROLE authenticated")
            conn.execute(
                text("SELECT set_config('test.user_id',:id,true)"), {"id": USER}
            )
            conn.execute(
                text(
                    "INSERT INTO storage.objects(id,bucket_id,owner_id) VALUES(:id,'portfolio-private',:owner)"
                ),
                {"id": str(uuid4()), "owner": OTHER},
            )


def test_full_sync_aborts_atomically_for_public_private_bucket(reconciled):
    engine, _ = reconciled
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "UPDATE storage.buckets SET public=true WHERE id='portfolio-private'"
        )
        before = conn.exec_driver_sql(
            "SELECT id::text,role,is_active,daily_limit FROM profiles ORDER BY id"
        ).all()
    raw = engine.raw_connection()
    try:
        with pytest.raises(Exception, match="already exists as public"):
            raw.driver_connection.cursor().execute(SCRIPT.read_text(), prepare=False)
        raw.rollback()
    finally:
        raw.close()
    with engine.begin() as conn:
        assert (
            conn.exec_driver_sql(
                "SELECT id::text,role,is_active,daily_limit FROM profiles ORDER BY id"
            ).all()
            == before
        )
        conn.exec_driver_sql(
            "UPDATE storage.buckets SET public=false WHERE id='portfolio-private'"
        )


def test_legacy_business_data_and_new_backend_inserts(reconciled):
    engine, variant = reconciled
    tables = [
        "portfolio_files",
        "tasks",
        "task_steps",
        "lessons",
        "lesson_materials",
        "chat_messages",
        "agent_audit",
    ]
    with engine.begin() as conn:
        if variant.startswith("legacy_tables"):
            for table in tables:
                rows = conn.exec_driver_sql(
                    f"SELECT user_id::text,owner_id::text,legacy_required FROM {table} ORDER BY legacy_required"
                ).all()
                values = {
                    r.legacy_required: (r.user_id, r.owner_id)
                    for r in rows
                    if r.legacy_required
                }
                assert values["kept-own"] == (USER, OTHER if table == "tasks" else USER)
                assert values["kept-other"] == (OTHER, OTHER)
                if variant.endswith("text"):
                    assert values["kept-unmapped"] == ("external-non-uuid", None)
                assert (
                    conn.execute(
                        text(
                            "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=:table AND column_name='legacy_required'"
                        ),
                        {"table": table},
                    ).scalar()
                    == "YES"
                )
                assert (
                    conn.execute(
                        text(
                            "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=:table AND column_name='user_id'"
                        ),
                        {"table": table},
                    ).scalar()
                    == "YES"
                )
        conn.exec_driver_sql("SET LOCAL ROLE aiedu_backend")
        file_id = conn.execute(
            text(
                "INSERT INTO portfolio_files(owner_id,category,filename,storage_path)VALUES(:owner,'РУП','new.docx','test/new.docx') RETURNING id"
            ),
            {"owner": USER},
        ).scalar()
        task_id = conn.execute(
            text(
                "INSERT INTO tasks(owner_id,title)VALUES(:owner,'New task') RETURNING id"
            ),
            {"owner": USER},
        ).scalar()
        conn.execute(
            text(
                "INSERT INTO task_steps(owner_id,task_id,agent,title)VALUES(:owner,:task,'methodist','New step')"
            ),
            {"owner": USER, "task": task_id},
        )
        lesson_id = conn.execute(
            text(
                "INSERT INTO lessons(owner_id,portfolio_file_id,topic)VALUES(:owner,:file,'New topic') RETURNING id"
            ),
            {"owner": USER, "file": file_id},
        ).scalar()
        conn.execute(
            text(
                "INSERT INTO lesson_materials(owner_id,lesson_id,material_type,title)VALUES(:owner,:lesson,'plan','New plan')"
            ),
            {"owner": USER, "lesson": lesson_id},
        )
        conn.execute(
            text(
                "INSERT INTO chat_messages(owner_id,role,content)VALUES(:owner,'teacher','New message')"
            ),
            {"owner": USER},
        )
        conn.execute(
            text(
                "INSERT INTO agent_audit(owner_id,agent,action)VALUES(:owner,'methodist','new backend audit')"
            ),
            {"owner": USER},
        )
