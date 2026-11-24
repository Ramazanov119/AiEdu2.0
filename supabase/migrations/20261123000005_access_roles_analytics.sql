-- Prepared migration. Apply only after review/backup; never executed by backend startup.
BEGIN;
CREATE TABLE public.organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 300),
 is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles
 ADD COLUMN IF NOT EXISTS email text,
 ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'teacher' CHECK(role IN ('teacher','methodist','admin')),
 ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS subscription_until timestamptz,
 ADD COLUMN IF NOT EXISTS daily_limit integer NOT NULL DEFAULT 20 CHECK(daily_limit>=0),
 ADD COLUMN IF NOT EXISTS last_active_at timestamptz;
-- Link by verified Auth UUID, not by email. No role/organization is inferred.
INSERT INTO public.profiles(id,email,created_at) SELECT id,email,created_at FROM auth.users
 ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email;
CREATE FUNCTION public.aiedu_sync_auth_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN INSERT INTO public.profiles(id,email,created_at) VALUES(NEW.id,NEW.email,NEW.created_at) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.aiedu_sync_auth_profile() FROM PUBLIC;
CREATE TRIGGER aiedu_auth_profile_sync AFTER INSERT OR UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.aiedu_sync_auth_profile();
CREATE INDEX profiles_email_search ON public.profiles(email);
CREATE INDEX profiles_organization ON public.profiles(organization_id);
CREATE INDEX profiles_last_active ON public.profiles(last_active_at);
CREATE TABLE public.generation_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
 organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
 agent_type text NOT NULL CHECK(agent_type IN ('coordinator','methodist','creative','assessment')),
 action_type text NOT NULL, model_name text NOT NULL,
 tokens_used integer NOT NULL DEFAULT 0 CHECK(tokens_used>=0), tokens_reported boolean NOT NULL DEFAULT false,
 duration_ms integer NOT NULL CHECK(duration_ms>=0), status text NOT NULL CHECK(status IN ('success','error')),
 error_message text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX generation_user_day ON public.generation_logs(user_id,created_at);
CREATE INDEX generation_org_day ON public.generation_logs(organization_id,created_at);
CREATE INDEX generation_day ON public.generation_logs(created_at);
CREATE TABLE public.generation_reservations (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.profiles(id),
 organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL, created_at timestamptz NOT NULL
);
CREATE INDEX reservation_user_day ON public.generation_reservations(user_id,created_at);
CREATE TABLE public.admin_audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid NOT NULL REFERENCES public.profiles(id),
 target_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL, action text NOT NULL,
 details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_date ON public.admin_audit_logs(created_at);

-- Optional group for a dedicated backend DB login. No login/password is created.
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aiedu_backend') THEN CREATE ROLE aiedu_backend NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;
GRANT USAGE ON SCHEMA public TO aiedu_backend;

-- Replace old FOR ALL owner policies. Backend is the only writer of document paths,
-- task states, audit and generation telemetry. Keep safe direct profile display edits.
DO $$ DECLARE t text; p record; cols text; BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','portfolio_files','tasks','task_steps','lessons','lesson_materials','chat_messages','agent_audit','organizations','generation_logs','generation_reservations','admin_audit_logs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
   EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t);
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
GRANT USAGE ON SEQUENCE public.agent_audit_id_seq TO aiedu_backend,service_role;
CREATE FUNCTION public.aiedu_immutable_audit() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'AUDIT_IMMUTABLE' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION public.aiedu_immutable_audit() FROM PUBLIC;
CREATE TRIGGER agent_audit_immutable BEFORE UPDATE OR DELETE ON public.agent_audit FOR EACH ROW EXECUTE FUNCTION public.aiedu_immutable_audit();
CREATE TRIGGER admin_audit_immutable BEFORE UPDATE OR DELETE ON public.admin_audit_logs FOR EACH ROW EXECUTE FUNCTION public.aiedu_immutable_audit();
CREATE TRIGGER generation_logs_immutable BEFORE UPDATE OR DELETE ON public.generation_logs FOR EACH ROW EXECUTE FUNCTION public.aiedu_immutable_audit();
CREATE TRIGGER agent_audit_no_truncate BEFORE TRUNCATE ON public.agent_audit FOR EACH STATEMENT EXECUTE FUNCTION public.aiedu_immutable_audit();
CREATE TRIGGER admin_audit_no_truncate BEFORE TRUNCATE ON public.admin_audit_logs FOR EACH STATEMENT EXECUTE FUNCTION public.aiedu_immutable_audit();
CREATE TRIGGER generation_logs_no_truncate BEFORE TRUNCATE ON public.generation_logs FOR EACH STATEMENT EXECUTE FUNCTION public.aiedu_immutable_audit();
COMMIT;
