-- VISION AI · Esquema de base de datos (PostgreSQL / Supabase)
-- Puedes pegarlo en Supabase > SQL Editor > New query > Run.
-- El backend también lo ejecuta automáticamente al arrancar (es idempotente).

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text not null,
  role          text not null check (role in ('admin','supervisor','operador','auditor')),
  password_hash text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.events (
  id          text primary key,
  sector      text not null,
  object_id   text not null,
  label       text not null,
  confidence  real not null,
  distance    real not null,
  at          timestamptz not null,
  status      text not null default 'nueva' check (status in ('nueva','revisada')),
  severity    text not null default 'info' check (severity in ('info','warning')),
  created_by  uuid references public.app_users(id) on delete set null,
  reviewed_by uuid references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists events_at_idx on public.events (at desc);

create table if not exists public.analyses (
  id          text primary key,
  at          timestamptz not null,
  sector      text not null,
  source      text not null,
  mode        text not null,
  detections  jsonb not null default '[]'::jsonb,
  duration_ms integer not null default 0,
  status      text not null default 'COMPLETADO',
  created_by  uuid references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists analyses_at_idx on public.analyses (at desc);

-- Seguridad: activamos RLS sin políticas públicas. Así la API REST pública de
-- Supabase (anon key) NO puede leer ni escribir estas tablas; solo el backend,
-- que se conecta con el usuario "postgres" (que ignora RLS), tiene acceso.
alter table public.app_users enable row level security;
alter table public.events    enable row level security;
alter table public.analyses  enable row level security;
