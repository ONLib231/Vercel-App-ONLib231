-- 0001_extensions_and_profiles.sql
-- Core extensions, the profiles table, and the auth.users -> profiles sync trigger.
--
-- IMPORTANT: the trigger below is an AFTER INSERT trigger directly on auth.users.
-- That means it fires no matter how the auth user row was created — a normal
-- supabase.auth.signUp() call, an admin.createUser() call from a service-role
-- script, or a one-off manual `insert into auth.users ...` bootstrap. There is
-- no code path that creates an auth user without also getting a profiles row.

create extension if not exists "pgcrypto";

create type public.user_role as enum ('customer', 'vendor', 'admin');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role public.user_role not null default 'customer',
  phone text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Generic updated_at maintenance trigger function, reused by later migrations.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row for every new auth user.
-- requested_role is read from raw_user_meta_data so the signup form can pass
-- 'vendor' or 'customer' at auth.signUp() time (e.g. options.data.requested_role).
-- Any value other than 'customer' or 'vendor' safely falls back to 'customer';
-- nobody can self-provision the 'admin' role through signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested text;
  resolved_role public.user_role;
begin
  requested := new.raw_user_meta_data ->> 'requested_role';

  if requested = 'vendor' then
    resolved_role := 'vendor';
  else
    resolved_role := 'customer';
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    resolved_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Defensive guard: a user can update their own profile (full_name, phone, ...)
-- but cannot escalate their own role. Only a session where is_admin() is true
-- (defined in 0008_helper_functions.sql) can change `role`. This is enforced
-- with a trigger rather than relying solely on RLS, because RLS in Postgres is
-- row-level, not column-level, so a WITH CHECK policy alone can't distinguish
-- "user updated full_name" from "user updated role" on the same row.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role <> old.role and not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;
-- Note: public.is_admin() is created in 0008_helper_functions.sql, which runs
-- after this file. The trigger itself is attached down there (not here) to
-- keep the function-creation-before-trigger-attachment order correct.
