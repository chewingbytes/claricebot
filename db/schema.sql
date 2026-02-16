create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_text text,
  status text not null default 'new',
  priority text,
  due_at timestamptz,
  tags text[] default '{}',
  model_used text,
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.task_artifacts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  artifact_type text not null,
  title text,
  format text,
  content text,
  storage_url text,
  metadata jsonb default '{}'::jsonb
);

create index if not exists tasks_created_at_idx on public.tasks(created_at desc);
create index if not exists task_artifacts_task_id_idx on public.task_artifacts(task_id);

create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  input_text text,
  image_count integer not null default 0,
  file_count integer not null default 0,
  files jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.request_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  filename text,
  mimetype text,
  size_bytes integer,
  extracted_text text,
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.task_runs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  step_index integer not null,
  model text not null,
  goal text,
  output_text text,
  iterations integer not null default 1,
  review_status text,
  review_issues jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.request_artifacts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  artifact_type text not null,
  filename text,
  content_text text,
  storage_url text,
  metadata jsonb default '{}'::jsonb
);

create index if not exists requests_created_at_idx on public.requests(created_at desc);
create index if not exists request_files_request_id_idx on public.request_files(request_id);
create index if not exists task_runs_request_id_idx on public.task_runs(request_id);
create index if not exists request_artifacts_request_id_idx on public.request_artifacts(request_id);
