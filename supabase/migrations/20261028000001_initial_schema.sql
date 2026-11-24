create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  institution text,
  created_at timestamptz not null default now()
);

create table public.portfolio_files (
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

create table public.tasks (
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

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('teacher','coordinator','methodist','creative','assessment','system')),
  content text not null,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.agent_audit (
  id bigserial primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  agent text not null,
  action text not null,
  input jsonb,
  output jsonb,
  prompt_injection_detected boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.portfolio_files enable row level security;
alter table public.tasks enable row level security;
alter table public.chat_messages enable row level security;
alter table public.agent_audit enable row level security;

create policy "profiles own" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "files own" on public.portfolio_files for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "tasks own" on public.tasks for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "chat own" on public.chat_messages for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "audit own" on public.agent_audit for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

insert into storage.buckets (id, name, public) values ('portfolio-private','portfolio-private',false) on conflict (id) do nothing;
