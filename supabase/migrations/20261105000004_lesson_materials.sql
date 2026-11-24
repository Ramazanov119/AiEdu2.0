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

alter table public.lessons enable row level security;
alter table public.lesson_materials enable row level security;

create policy "lessons own" on public.lessons for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "lesson materials own" on public.lesson_materials for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
