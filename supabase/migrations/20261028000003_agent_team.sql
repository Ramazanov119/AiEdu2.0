alter table public.tasks
  add column if not exists dependencies jsonb not null default '[]'::jsonb,
  add column if not exists celery_task_id text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

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

alter table public.task_steps enable row level security;
create policy "task steps own" on public.task_steps for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
