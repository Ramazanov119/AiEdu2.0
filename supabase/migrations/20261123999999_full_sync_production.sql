-- AiEdu full schema reconciliation for an existing legacy Supabase project.
-- MANUAL ALTERNATIVE to migrations 00001..00005, not an additional sequential step.
-- Run the ENTIRE file as the database migration owner in Supabase SQL Editor.
-- Backup/review first. Never executed by application startup. Safe to run again.
-- Assumptions: profiles and referenced business IDs are compatible UUID keys;
-- Supabase auth/storage schemas exist. Existing column types/keys are not rewritten.
-- Existing status/plan are preserved and NOT interpreted as roles/subscriptions.
-- Newly added access fields use teacher / true / NULL / 20 (legacy/base access).
-- Review old blocked/expired statuses before enabling the new backend: no mapping
-- from an unknown legacy status/plan vocabulary is guessed here.
-- RLS/grants of ONLY the listed AiEdu public tables are replaced deliberately:
-- clients get owner SELECT + UPDATE(full_name,institution); backend is the writer.
-- Review legacy apps that write these tables directly before applying.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $lock$ BEGIN
 IF NOT pg_try_advisory_xact_lock(684912305) THEN
  RAISE EXCEPTION 'Another AiEdu full sync is running; retry later.';
 END IF;
END $lock$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 300),
 is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 full_name text, institution text, created_at timestamptz NOT NULL DEFAULT now()
);
-- Do not remove or rewrite legacy full_name/college/status/plan values.
DO $legacy$ DECLARE col text; BEGIN
 FOREACH col IN ARRAY ARRAY['full_name','college'] LOOP
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name=col) THEN
   EXECUTE format('ALTER TABLE public.profiles ALTER COLUMN %I DROP NOT NULL', col);
  END IF;
 END LOOP;
END $legacy$;
ALTER TABLE public.profiles
 ADD COLUMN IF NOT EXISTS full_name text,
 ADD COLUMN IF NOT EXISTS institution text,
 ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN IF NOT EXISTS email text,
 ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'teacher' CHECK(role IN ('teacher','methodist','admin')),
 ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS subscription_until timestamptz,
 ADD COLUMN IF NOT EXISTS daily_limit integer NOT NULL DEFAULT 20 CHECK(daily_limit>=0),
 ADD COLUMN IF NOT EXISTS last_active_at timestamptz;
-- Preserve legacy college as a display label, never infer an organization/role.
UPDATE public.profiles p SET institution=to_jsonb(p)->>'college'
 WHERE institution IS NULL AND nullif(btrim(to_jsonb(p)->>'college'),'') IS NOT NULL;
-- Unknown NOT NULL columns with no default cannot be guessed for new Auth profiles.
-- Fail atomically instead of leaving a broken signup trigger in production.
DO $preflight$ DECLARE required_columns text; BEGIN
 SELECT string_agg(quote_ident(attname),', ') INTO required_columns
 FROM pg_attribute
 WHERE attrelid='public.profiles'::regclass AND attnum>0 AND NOT attisdropped
 AND attnotnull AND NOT atthasdef AND attidentity='' AND attgenerated=''
 AND attname<>'id';
 IF required_columns IS NOT NULL THEN
  RAISE EXCEPTION 'profiles has additional required columns without defaults: %. Review their defaults before running full sync.', required_columns;
 END IF;
END $preflight$;

CREATE TABLE IF NOT EXISTS public.portfolio_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('тарификация','РУП','расписание','оценки','шаблоны')),
  filename text not null,
  storage_path text not null,
  mime_type text,
  extracted_text text,
  structured_data jsonb,
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);
-- Complete additive reconciliation for an existing legacy table.
-- Missing business values stay NULL; no document paths/results are invented.
ALTER TABLE public.portfolio_files
 ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() UNIQUE,
 ADD COLUMN IF NOT EXISTS owner_id uuid,
 ADD COLUMN IF NOT EXISTS category text,
 ADD COLUMN IF NOT EXISTS filename text,
 ADD COLUMN IF NOT EXISTS storage_path text,
 ADD COLUMN IF NOT EXISTS mime_type text,
 ADD COLUMN IF NOT EXISTS extracted_text text,
 ADD COLUMN IF NOT EXISTS structured_data jsonb,
 ADD COLUMN IF NOT EXISTS confirmed boolean DEFAULT false,
 ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Legacy columns remain stored, but must not require values from the new backend.
DO $legacy_columns$ DECLARE col record; BEGIN
 FOR col IN
  SELECT a.attname,a.attidentity,a.atthasdef,
   EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=a.attrelid AND c.contype='p' AND a.attnum=ANY(c.conkey)) AS primary_key
  FROM pg_attribute a
  WHERE a.attrelid='public.portfolio_files'::regclass AND a.attnum>0 AND NOT a.attisdropped
   AND a.attnotnull AND a.attname NOT IN ('id','owner_id','category','filename','storage_path','mime_type','extracted_text','structured_data','confirmed','created_at')
 LOOP
  -- PostgreSQL requires primary key / identity columns to remain NOT NULL.
  -- Preserve generated keys; never drop a primary key just to permit a write.
  IF col.primary_key OR col.attidentity<>'' THEN
   IF NOT col.atthasdef AND col.attidentity='' THEN
    RAISE EXCEPTION 'public.portfolio_files.% is a legacy primary key without a default. Explicit key mapping is required; no data or keys were removed.',col.attname;
   END IF;
  ELSE
   EXECUTE format('ALTER TABLE public.portfolio_files ALTER COLUMN %I DROP NOT NULL',col.attname);
  END IF;
 END LOOP;
END $legacy_columns$;

-- Never overwrite an existing owner or guess ownership from email/name.
DO $owner$ DECLARE source_type text; affected bigint; BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='portfolio_files' AND column_name='user_id') THEN
  SELECT udt_name INTO source_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='portfolio_files' AND column_name='user_id';
  IF source_type='uuid' THEN
   EXECUTE 'UPDATE public.portfolio_files SET owner_id=user_id WHERE owner_id IS NULL AND user_id IS NOT NULL';
  ELSE
   -- Legacy text UUIDs are accepted; invalid/non-UUID identifiers remain untouched.
   EXECUTE $copy$UPDATE public.portfolio_files
    SET owner_id=CASE WHEN user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN user_id::text::uuid ELSE NULL END
    WHERE owner_id IS NULL AND user_id IS NOT NULL
      AND user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'$copy$;
  END IF;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RAISE NOTICE 'public.portfolio_files: reconciled % legacy ownership rows',affected;
 END IF;
END $owner$;


CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending','assigned','running','review','awaiting_confirmation','completed','failed','cancelled')),
  assigned_agent text check (assigned_agent in ('coordinator','methodist','creative','assessment')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Complete additive reconciliation for an existing legacy table.
-- Missing business values stay NULL; no document paths/results are invented.
ALTER TABLE public.tasks
 ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() UNIQUE,
 ADD COLUMN IF NOT EXISTS owner_id uuid,
 ADD COLUMN IF NOT EXISTS title text,
 ADD COLUMN IF NOT EXISTS description text,
 ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
 ADD COLUMN IF NOT EXISTS assigned_agent text,
 ADD COLUMN IF NOT EXISTS result jsonb,
 ADD COLUMN IF NOT EXISTS error text,
 ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
 ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
 ADD COLUMN IF NOT EXISTS dependencies jsonb DEFAULT '[]'::jsonb,
 ADD COLUMN IF NOT EXISTS celery_task_id text,
 ADD COLUMN IF NOT EXISTS started_at timestamptz,
 ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Legacy columns remain stored, but must not require values from the new backend.
DO $legacy_columns$ DECLARE col record; BEGIN
 FOR col IN
  SELECT a.attname,a.attidentity,a.atthasdef,
   EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=a.attrelid AND c.contype='p' AND a.attnum=ANY(c.conkey)) AS primary_key
  FROM pg_attribute a
  WHERE a.attrelid='public.tasks'::regclass AND a.attnum>0 AND NOT a.attisdropped
   AND a.attnotnull AND a.attname NOT IN ('id','owner_id','title','description','status','assigned_agent','result','error','created_at','updated_at','dependencies','celery_task_id','started_at','completed_at')
 LOOP
  -- PostgreSQL requires primary key / identity columns to remain NOT NULL.
  -- Preserve generated keys; never drop a primary key just to permit a write.
  IF col.primary_key OR col.attidentity<>'' THEN
   IF NOT col.atthasdef AND col.attidentity='' THEN
    RAISE EXCEPTION 'public.tasks.% is a legacy primary key without a default. Explicit key mapping is required; no data or keys were removed.',col.attname;
   END IF;
  ELSE
   EXECUTE format('ALTER TABLE public.tasks ALTER COLUMN %I DROP NOT NULL',col.attname);
  END IF;
 END LOOP;
END $legacy_columns$;

-- Never overwrite an existing owner or guess ownership from email/name.
DO $owner$ DECLARE source_type text; affected bigint; BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tasks' AND column_name='user_id') THEN
  SELECT udt_name INTO source_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='tasks' AND column_name='user_id';
  IF source_type='uuid' THEN
   EXECUTE 'UPDATE public.tasks SET owner_id=user_id WHERE owner_id IS NULL AND user_id IS NOT NULL';
  ELSE
   -- Legacy text UUIDs are accepted; invalid/non-UUID identifiers remain untouched.
   EXECUTE $copy$UPDATE public.tasks
    SET owner_id=CASE WHEN user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN user_id::text::uuid ELSE NULL END
    WHERE owner_id IS NULL AND user_id IS NOT NULL
      AND user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'$copy$;
  END IF;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RAISE NOTICE 'public.tasks: reconciled % legacy ownership rows',affected;
 END IF;
END $owner$;


CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('teacher','coordinator','methodist','creative','assessment','system')),
  content text not null,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
-- Complete additive reconciliation for an existing legacy table.
-- Missing business values stay NULL; no document paths/results are invented.
ALTER TABLE public.chat_messages
 ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() UNIQUE,
 ADD COLUMN IF NOT EXISTS owner_id uuid,
 ADD COLUMN IF NOT EXISTS role text,
 ADD COLUMN IF NOT EXISTS content text,
 ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb,
 ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Legacy columns remain stored, but must not require values from the new backend.
DO $legacy_columns$ DECLARE col record; BEGIN
 FOR col IN
  SELECT a.attname,a.attidentity,a.atthasdef,
   EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=a.attrelid AND c.contype='p' AND a.attnum=ANY(c.conkey)) AS primary_key
  FROM pg_attribute a
  WHERE a.attrelid='public.chat_messages'::regclass AND a.attnum>0 AND NOT a.attisdropped
   AND a.attnotnull AND a.attname NOT IN ('id','owner_id','role','content','attachments','created_at')
 LOOP
  -- PostgreSQL requires primary key / identity columns to remain NOT NULL.
  -- Preserve generated keys; never drop a primary key just to permit a write.
  IF col.primary_key OR col.attidentity<>'' THEN
   IF NOT col.atthasdef AND col.attidentity='' THEN
    RAISE EXCEPTION 'public.chat_messages.% is a legacy primary key without a default. Explicit key mapping is required; no data or keys were removed.',col.attname;
   END IF;
  ELSE
   EXECUTE format('ALTER TABLE public.chat_messages ALTER COLUMN %I DROP NOT NULL',col.attname);
  END IF;
 END LOOP;
END $legacy_columns$;

-- Never overwrite an existing owner or guess ownership from email/name.
DO $owner$ DECLARE source_type text; affected bigint; BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='chat_messages' AND column_name='user_id') THEN
  SELECT udt_name INTO source_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='chat_messages' AND column_name='user_id';
  IF source_type='uuid' THEN
   EXECUTE 'UPDATE public.chat_messages SET owner_id=user_id WHERE owner_id IS NULL AND user_id IS NOT NULL';
  ELSE
   -- Legacy text UUIDs are accepted; invalid/non-UUID identifiers remain untouched.
   EXECUTE $copy$UPDATE public.chat_messages
    SET owner_id=CASE WHEN user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN user_id::text::uuid ELSE NULL END
    WHERE owner_id IS NULL AND user_id IS NOT NULL
      AND user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'$copy$;
  END IF;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RAISE NOTICE 'public.chat_messages: reconciled % legacy ownership rows',affected;
 END IF;
END $owner$;


CREATE TABLE IF NOT EXISTS public.agent_audit (
  id bigserial primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  agent text not null,
  action text not null,
  input jsonb,
  output jsonb,
  prompt_injection_detected boolean not null default false,
  created_at timestamptz not null default now()
);
-- Complete additive reconciliation for an existing legacy table.
-- Missing business values stay NULL; no document paths/results are invented.
ALTER TABLE public.agent_audit
 ADD COLUMN IF NOT EXISTS id bigint GENERATED BY DEFAULT AS IDENTITY UNIQUE,
 ADD COLUMN IF NOT EXISTS owner_id uuid,
 ADD COLUMN IF NOT EXISTS agent text,
 ADD COLUMN IF NOT EXISTS action text,
 ADD COLUMN IF NOT EXISTS input jsonb,
 ADD COLUMN IF NOT EXISTS output jsonb,
 ADD COLUMN IF NOT EXISTS prompt_injection_detected boolean DEFAULT false,
 ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Legacy columns remain stored, but must not require values from the new backend.
DO $legacy_columns$ DECLARE col record; BEGIN
 FOR col IN
  SELECT a.attname,a.attidentity,a.atthasdef,
   EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=a.attrelid AND c.contype='p' AND a.attnum=ANY(c.conkey)) AS primary_key
  FROM pg_attribute a
  WHERE a.attrelid='public.agent_audit'::regclass AND a.attnum>0 AND NOT a.attisdropped
   AND a.attnotnull AND a.attname NOT IN ('id','owner_id','agent','action','input','output','prompt_injection_detected','created_at')
 LOOP
  -- PostgreSQL requires primary key / identity columns to remain NOT NULL.
  -- Preserve generated keys; never drop a primary key just to permit a write.
  IF col.primary_key OR col.attidentity<>'' THEN
   IF NOT col.atthasdef AND col.attidentity='' THEN
    RAISE EXCEPTION 'public.agent_audit.% is a legacy primary key without a default. Explicit key mapping is required; no data or keys were removed.',col.attname;
   END IF;
  ELSE
   EXECUTE format('ALTER TABLE public.agent_audit ALTER COLUMN %I DROP NOT NULL',col.attname);
  END IF;
 END LOOP;
END $legacy_columns$;

-- Never overwrite an existing owner or guess ownership from email/name.
DO $owner$ DECLARE source_type text; affected bigint; BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agent_audit' AND column_name='user_id') THEN
  SELECT udt_name INTO source_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='agent_audit' AND column_name='user_id';
  -- The migration already holds an exclusive DDL lock until COMMIT.
  -- Reinstall the known immutable trigger below after ownership reconciliation.
  DROP TRIGGER IF EXISTS agent_audit_immutable ON public.agent_audit;
  IF source_type='uuid' THEN
   EXECUTE 'UPDATE public.agent_audit SET owner_id=user_id WHERE owner_id IS NULL AND user_id IS NOT NULL';
  ELSE
   -- Legacy text UUIDs are accepted; invalid/non-UUID identifiers remain untouched.
   EXECUTE $copy$UPDATE public.agent_audit
    SET owner_id=CASE WHEN user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN user_id::text::uuid ELSE NULL END
    WHERE owner_id IS NULL AND user_id IS NOT NULL
      AND user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'$copy$;
  END IF;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RAISE NOTICE 'public.agent_audit: reconciled % legacy ownership rows',affected;
 END IF;
END $owner$;



create table if not exists public.task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  agent text not null,
  title text not null,
  status text not null default 'pending',
  depends_on jsonb not null default '[]'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now()
);
-- Complete additive reconciliation for an existing legacy table.
-- Missing business values stay NULL; no document paths/results are invented.
ALTER TABLE public.task_steps
 ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() UNIQUE,
 ADD COLUMN IF NOT EXISTS task_id uuid,
 ADD COLUMN IF NOT EXISTS owner_id uuid,
 ADD COLUMN IF NOT EXISTS agent text,
 ADD COLUMN IF NOT EXISTS title text,
 ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
 ADD COLUMN IF NOT EXISTS depends_on jsonb DEFAULT '[]'::jsonb,
 ADD COLUMN IF NOT EXISTS result jsonb,
 ADD COLUMN IF NOT EXISTS error text,
 ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Legacy columns remain stored, but must not require values from the new backend.
DO $legacy_columns$ DECLARE col record; BEGIN
 FOR col IN
  SELECT a.attname,a.attidentity,a.atthasdef,
   EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=a.attrelid AND c.contype='p' AND a.attnum=ANY(c.conkey)) AS primary_key
  FROM pg_attribute a
  WHERE a.attrelid='public.task_steps'::regclass AND a.attnum>0 AND NOT a.attisdropped
   AND a.attnotnull AND a.attname NOT IN ('id','task_id','owner_id','agent','title','status','depends_on','result','error','created_at')
 LOOP
  -- PostgreSQL requires primary key / identity columns to remain NOT NULL.
  -- Preserve generated keys; never drop a primary key just to permit a write.
  IF col.primary_key OR col.attidentity<>'' THEN
   IF NOT col.atthasdef AND col.attidentity='' THEN
    RAISE EXCEPTION 'public.task_steps.% is a legacy primary key without a default. Explicit key mapping is required; no data or keys were removed.',col.attname;
   END IF;
  ELSE
   EXECUTE format('ALTER TABLE public.task_steps ALTER COLUMN %I DROP NOT NULL',col.attname);
  END IF;
 END LOOP;
END $legacy_columns$;

-- Never overwrite an existing owner or guess ownership from email/name.
DO $owner$ DECLARE source_type text; affected bigint; BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='task_steps' AND column_name='user_id') THEN
  SELECT udt_name INTO source_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='task_steps' AND column_name='user_id';
  IF source_type='uuid' THEN
   EXECUTE 'UPDATE public.task_steps SET owner_id=user_id WHERE owner_id IS NULL AND user_id IS NOT NULL';
  ELSE
   -- Legacy text UUIDs are accepted; invalid/non-UUID identifiers remain untouched.
   EXECUTE $copy$UPDATE public.task_steps
    SET owner_id=CASE WHEN user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN user_id::text::uuid ELSE NULL END
    WHERE owner_id IS NULL AND user_id IS NOT NULL
      AND user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'$copy$;
  END IF;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RAISE NOTICE 'public.task_steps: reconciled % legacy ownership rows',affected;
 END IF;
END $owner$;



create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  portfolio_file_id uuid not null references public.portfolio_files(id) on delete cascade,
  topic text not null,
  group_name text,
  hours text,
  lesson_type text,
  status text not null default 'pending' check (status in ('pending','running','completed','failed','cancelled')),
  agent_progress jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- Complete additive reconciliation for an existing legacy table.
-- Missing business values stay NULL; no document paths/results are invented.
ALTER TABLE public.lessons
 ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() UNIQUE,
 ADD COLUMN IF NOT EXISTS owner_id uuid,
 ADD COLUMN IF NOT EXISTS portfolio_file_id uuid,
 ADD COLUMN IF NOT EXISTS topic text,
 ADD COLUMN IF NOT EXISTS group_name text,
 ADD COLUMN IF NOT EXISTS hours text,
 ADD COLUMN IF NOT EXISTS lesson_type text,
 ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
 ADD COLUMN IF NOT EXISTS agent_progress jsonb DEFAULT '{}'::jsonb,
 ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Legacy columns remain stored, but must not require values from the new backend.
DO $legacy_columns$ DECLARE col record; BEGIN
 FOR col IN
  SELECT a.attname,a.attidentity,a.atthasdef,
   EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=a.attrelid AND c.contype='p' AND a.attnum=ANY(c.conkey)) AS primary_key
  FROM pg_attribute a
  WHERE a.attrelid='public.lessons'::regclass AND a.attnum>0 AND NOT a.attisdropped
   AND a.attnotnull AND a.attname NOT IN ('id','owner_id','portfolio_file_id','topic','group_name','hours','lesson_type','status','agent_progress','created_at')
 LOOP
  -- PostgreSQL requires primary key / identity columns to remain NOT NULL.
  -- Preserve generated keys; never drop a primary key just to permit a write.
  IF col.primary_key OR col.attidentity<>'' THEN
   IF NOT col.atthasdef AND col.attidentity='' THEN
    RAISE EXCEPTION 'public.lessons.% is a legacy primary key without a default. Explicit key mapping is required; no data or keys were removed.',col.attname;
   END IF;
  ELSE
   EXECUTE format('ALTER TABLE public.lessons ALTER COLUMN %I DROP NOT NULL',col.attname);
  END IF;
 END LOOP;
END $legacy_columns$;

-- Never overwrite an existing owner or guess ownership from email/name.
DO $owner$ DECLARE source_type text; affected bigint; BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lessons' AND column_name='user_id') THEN
  SELECT udt_name INTO source_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='lessons' AND column_name='user_id';
  IF source_type='uuid' THEN
   EXECUTE 'UPDATE public.lessons SET owner_id=user_id WHERE owner_id IS NULL AND user_id IS NOT NULL';
  ELSE
   -- Legacy text UUIDs are accepted; invalid/non-UUID identifiers remain untouched.
   EXECUTE $copy$UPDATE public.lessons
    SET owner_id=CASE WHEN user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN user_id::text::uuid ELSE NULL END
    WHERE owner_id IS NULL AND user_id IS NOT NULL
      AND user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'$copy$;
  END IF;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RAISE NOTICE 'public.lessons: reconciled % legacy ownership rows',affected;
 END IF;
END $owner$;


create table if not exists public.lesson_materials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  material_type text not null check (material_type in ('plan','lecture','practice','presentation')),
  title text not null,
  content text not null default '',
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  error text,
  file_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Complete additive reconciliation for an existing legacy table.
-- Missing business values stay NULL; no document paths/results are invented.
ALTER TABLE public.lesson_materials
 ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() UNIQUE,
 ADD COLUMN IF NOT EXISTS owner_id uuid,
 ADD COLUMN IF NOT EXISTS lesson_id uuid,
 ADD COLUMN IF NOT EXISTS material_type text,
 ADD COLUMN IF NOT EXISTS title text,
 ADD COLUMN IF NOT EXISTS content text DEFAULT '',
 ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
 ADD COLUMN IF NOT EXISTS error text,
 ADD COLUMN IF NOT EXISTS file_path text,
 ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
 ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Legacy columns remain stored, but must not require values from the new backend.
DO $legacy_columns$ DECLARE col record; BEGIN
 FOR col IN
  SELECT a.attname,a.attidentity,a.atthasdef,
   EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=a.attrelid AND c.contype='p' AND a.attnum=ANY(c.conkey)) AS primary_key
  FROM pg_attribute a
  WHERE a.attrelid='public.lesson_materials'::regclass AND a.attnum>0 AND NOT a.attisdropped
   AND a.attnotnull AND a.attname NOT IN ('id','owner_id','lesson_id','material_type','title','content','status','error','file_path','created_at','updated_at')
 LOOP
  -- PostgreSQL requires primary key / identity columns to remain NOT NULL.
  -- Preserve generated keys; never drop a primary key just to permit a write.
  IF col.primary_key OR col.attidentity<>'' THEN
   IF NOT col.atthasdef AND col.attidentity='' THEN
    RAISE EXCEPTION 'public.lesson_materials.% is a legacy primary key without a default. Explicit key mapping is required; no data or keys were removed.',col.attname;
   END IF;
  ELSE
   EXECUTE format('ALTER TABLE public.lesson_materials ALTER COLUMN %I DROP NOT NULL',col.attname);
  END IF;
 END LOOP;
END $legacy_columns$;

-- Never overwrite an existing owner or guess ownership from email/name.
DO $owner$ DECLARE source_type text; affected bigint; BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lesson_materials' AND column_name='user_id') THEN
  SELECT udt_name INTO source_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='lesson_materials' AND column_name='user_id';
  IF source_type='uuid' THEN
   EXECUTE 'UPDATE public.lesson_materials SET owner_id=user_id WHERE owner_id IS NULL AND user_id IS NOT NULL';
  ELSE
   -- Legacy text UUIDs are accepted; invalid/non-UUID identifiers remain untouched.
   EXECUTE $copy$UPDATE public.lesson_materials
    SET owner_id=CASE WHEN user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN user_id::text::uuid ELSE NULL END
    WHERE owner_id IS NULL AND user_id IS NOT NULL
      AND user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'$copy$;
  END IF;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RAISE NOTICE 'public.lesson_materials: reconciled % legacy ownership rows',affected;
 END IF;
END $owner$;



CREATE INDEX IF NOT EXISTS profiles_email_search ON public.profiles(email);
CREATE INDEX IF NOT EXISTS profiles_organization ON public.profiles(organization_id);
CREATE INDEX IF NOT EXISTS profiles_last_active ON public.profiles(last_active_at);
CREATE TABLE IF NOT EXISTS public.generation_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
 organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
 agent_type text NOT NULL CHECK(agent_type IN ('coordinator','methodist','creative','assessment')),
 action_type text NOT NULL, model_name text NOT NULL,
 tokens_used integer NOT NULL DEFAULT 0 CHECK(tokens_used>=0), tokens_reported boolean NOT NULL DEFAULT false,
 duration_ms integer NOT NULL CHECK(duration_ms>=0), status text NOT NULL CHECK(status IN ('success','error')),
 error_message text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generation_user_day ON public.generation_logs(user_id,created_at);
CREATE INDEX IF NOT EXISTS generation_org_day ON public.generation_logs(organization_id,created_at);
CREATE INDEX IF NOT EXISTS generation_day ON public.generation_logs(created_at);
CREATE TABLE IF NOT EXISTS public.generation_reservations (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.profiles(id),
 organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL, created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS reservation_user_day ON public.generation_reservations(user_id,created_at);
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid NOT NULL REFERENCES public.profiles(id),
 target_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL, action text NOT NULL,
 details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_date ON public.admin_audit_logs(created_at);


-- Owner filters/orderings and foreign-key lookups used by existing APIs.
CREATE INDEX IF NOT EXISTS portfolio_owner_created ON public.portfolio_files(owner_id,created_at);
CREATE INDEX IF NOT EXISTS tasks_owner_created ON public.tasks(owner_id,created_at);
CREATE INDEX IF NOT EXISTS steps_task_created ON public.task_steps(task_id,created_at);
CREATE INDEX IF NOT EXISTS steps_owner_created ON public.task_steps(owner_id,created_at);
CREATE INDEX IF NOT EXISTS lessons_owner_created ON public.lessons(owner_id,created_at);
CREATE INDEX IF NOT EXISTS lessons_portfolio ON public.lessons(portfolio_file_id);
CREATE INDEX IF NOT EXISTS materials_lesson ON public.lesson_materials(lesson_id);
CREATE INDEX IF NOT EXISTS materials_owner ON public.lesson_materials(owner_id);
CREATE INDEX IF NOT EXISTS chat_owner_created ON public.chat_messages(owner_id,created_at);
CREATE INDEX IF NOT EXISTS audit_owner_created ON public.agent_audit(owner_id,created_at);

-- Link by verified Auth UUID, not by email. No role/organization is inferred.
INSERT INTO public.profiles(id,email,created_at) SELECT id,email,created_at FROM auth.users
 ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email;
CREATE OR REPLACE FUNCTION public.aiedu_sync_auth_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN INSERT INTO public.profiles(id,email,created_at) VALUES(NEW.id,NEW.email,NEW.created_at) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.aiedu_sync_auth_profile() FROM PUBLIC;
DROP TRIGGER IF EXISTS aiedu_auth_profile_sync ON auth.users;
CREATE TRIGGER aiedu_auth_profile_sync AFTER INSERT OR UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.aiedu_sync_auth_profile();

-- Optional group for a dedicated backend DB login. No login/password is created.
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aiedu_backend') THEN CREATE ROLE aiedu_backend NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;
GRANT USAGE ON SCHEMA public TO aiedu_backend;

-- Replace old FOR ALL owner policies. Backend is the only writer of document paths,
-- task states, audit and generation telemetry. Keep safe direct profile display edits.
DO $$ DECLARE t text; p record; cols text; BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','portfolio_files','tasks','task_steps','lessons','lesson_materials','chat_messages','agent_audit','organizations','generation_logs','generation_reservations','admin_audit_logs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
   EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',p.policyname,t);
  END LOOP;
  SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute WHERE attrelid=format('public.%I',t)::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('REVOKE ALL PRIVILEGES ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON public.%I FROM PUBLIC,anon,authenticated',cols,t);
  EXECUTE format('CREATE POLICY backend_access ON public.%I TO aiedu_backend USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
CREATE POLICY profiles_owner_read ON public.profiles FOR SELECT TO authenticated USING(id=auth.uid());
CREATE POLICY profiles_owner_display_edit ON public.profiles FOR UPDATE TO authenticated USING(id=auth.uid()) WITH CHECK(id=auth.uid());
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE(full_name,institution) ON public.profiles TO authenticated;
CREATE POLICY own_organization ON public.organizations FOR SELECT TO authenticated USING(id IN (SELECT organization_id FROM public.profiles WHERE id=auth.uid()));
GRANT SELECT ON public.organizations TO authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['portfolio_files','tasks','task_steps','lessons','lesson_materials','chat_messages','agent_audit'] LOOP
  EXECUTE format('CREATE POLICY owner_read ON public.%I FOR SELECT TO authenticated USING(owner_id=auth.uid())',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 END LOOP;
END $$;
CREATE POLICY own_generation_read ON public.generation_logs FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT ON public.generation_logs TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.profiles,public.organizations,public.portfolio_files,public.tasks,public.task_steps,public.lessons,public.lesson_materials,public.chat_messages,public.generation_reservations TO aiedu_backend,service_role;
GRANT SELECT,INSERT ON public.agent_audit,public.generation_logs,public.admin_audit_logs TO aiedu_backend,service_role;
REVOKE UPDATE,DELETE,TRUNCATE ON public.agent_audit,public.generation_logs,public.admin_audit_logs FROM aiedu_backend,service_role;
DO $audit_sequence$ DECLARE sequence_name text; BEGIN
 sequence_name:=pg_get_serial_sequence('public.agent_audit','id');
 IF sequence_name IS NOT NULL THEN
  EXECUTE format('GRANT USAGE ON SEQUENCE %s TO aiedu_backend,service_role',sequence_name::regclass);
 END IF;
END $audit_sequence$;

CREATE OR REPLACE FUNCTION public.aiedu_immutable_audit() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'AUDIT_IMMUTABLE' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION public.aiedu_immutable_audit() FROM PUBLIC;
DROP TRIGGER IF EXISTS agent_audit_immutable ON public.agent_audit;
CREATE TRIGGER agent_audit_immutable BEFORE UPDATE OR DELETE ON public.agent_audit FOR EACH ROW EXECUTE FUNCTION public.aiedu_immutable_audit();
DROP TRIGGER IF EXISTS admin_audit_immutable ON public.admin_audit_logs;
CREATE TRIGGER admin_audit_immutable BEFORE UPDATE OR DELETE ON public.admin_audit_logs FOR EACH ROW EXECUTE FUNCTION public.aiedu_immutable_audit();
DROP TRIGGER IF EXISTS generation_logs_immutable ON public.generation_logs;
CREATE TRIGGER generation_logs_immutable BEFORE UPDATE OR DELETE ON public.generation_logs FOR EACH ROW EXECUTE FUNCTION public.aiedu_immutable_audit();
DROP TRIGGER IF EXISTS agent_audit_no_truncate ON public.agent_audit;
CREATE TRIGGER agent_audit_no_truncate BEFORE TRUNCATE ON public.agent_audit FOR EACH STATEMENT EXECUTE FUNCTION public.aiedu_immutable_audit();
DROP TRIGGER IF EXISTS admin_audit_no_truncate ON public.admin_audit_logs;
CREATE TRIGGER admin_audit_no_truncate BEFORE TRUNCATE ON public.admin_audit_logs FOR EACH STATEMENT EXECUTE FUNCTION public.aiedu_immutable_audit();
DROP TRIGGER IF EXISTS generation_logs_no_truncate ON public.generation_logs;
CREATE TRIGGER generation_logs_no_truncate BEFORE TRUNCATE ON public.generation_logs FOR EACH STATEMENT EXECUTE FUNCTION public.aiedu_immutable_audit();

-- Only touch the named application bucket/policies. Other buckets are untouched.
-- Existing public bucket is not silently changed: abort before exposing private data.
DO $bucket$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='portfolio-private' AND public IS TRUE) THEN
  RAISE EXCEPTION 'portfolio-private already exists as public. Review and make it private before full sync.';
 END IF;
END $bucket$;
INSERT INTO storage.buckets(id,name,public) VALUES('portfolio-private','portfolio-private',false)
 ON CONFLICT(id) DO NOTHING;
DROP POLICY IF EXISTS "owner read portfolio" ON storage.objects;
DROP POLICY IF EXISTS "owner upload portfolio" ON storage.objects;
DROP POLICY IF EXISTS "owner delete portfolio" ON storage.objects;
CREATE POLICY "owner read portfolio" ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='portfolio-private' AND owner_id=auth.uid()::text);
CREATE POLICY "owner upload portfolio" ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='portfolio-private' AND owner_id=auth.uid()::text);
CREATE POLICY "owner delete portfolio" ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='portfolio-private' AND owner_id=auth.uid()::text);

-- Restrictive guards prevent unrelated legacy permissive storage policies from
-- exposing this bucket. Policies and access to OTHER buckets are preserved.
DROP POLICY IF EXISTS aiedu_portfolio_guard_select ON storage.objects;
CREATE POLICY aiedu_portfolio_guard_select ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated
 USING(bucket_id<>'portfolio-private' OR (auth.uid() IS NOT NULL AND owner_id=auth.uid()::text));
DROP POLICY IF EXISTS aiedu_portfolio_guard_insert ON storage.objects;
CREATE POLICY aiedu_portfolio_guard_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated
 WITH CHECK(bucket_id<>'portfolio-private' OR (auth.uid() IS NOT NULL AND owner_id=auth.uid()::text));
DROP POLICY IF EXISTS aiedu_portfolio_guard_update ON storage.objects;
CREATE POLICY aiedu_portfolio_guard_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated
 USING(bucket_id<>'portfolio-private' OR (auth.uid() IS NOT NULL AND owner_id=auth.uid()::text))
 WITH CHECK(bucket_id<>'portfolio-private' OR (auth.uid() IS NOT NULL AND owner_id=auth.uid()::text));
DROP POLICY IF EXISTS aiedu_portfolio_guard_delete ON storage.objects;
CREATE POLICY aiedu_portfolio_guard_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated
 USING(bucket_id<>'portfolio-private' OR (auth.uid() IS NOT NULL AND owner_id=auth.uid()::text));

COMMIT;
