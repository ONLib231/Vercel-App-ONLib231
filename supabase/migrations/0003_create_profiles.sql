-- ============================================================================
-- Migration: 0003_create_profiles
-- Section: Auth — Login / Sign Up
--
-- Purpose:
--   Introduces public.profiles, referenced as a forward dependency by the
--   admin-write policies in 0001_create_service_options.sql and
--   0002_create_marketplace_core.sql (their `p.role = 'admin'` checks).
--   Run this migration and those two admin-write policies become live —
--   nothing to change in the earlier files.
--
--   Also backs the Sidebar/header "Girlee Fashion / Customer" identity
--   (lib/user.ts#getNavUser) and the role field the future Delivery/Vendor
--   role-routing module will read.
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'customer' check (role in ('customer', 'vendor', 'driver', 'admin')),
  avatar_path text, -- object path in the "app-assets" Storage bucket
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth.users entry. Created automatically by handle_new_user() on sign-up.';

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- Deliberately NOT adding an "admin can read/write any profile" policy here:
-- a policy on public.profiles that queries public.profiles to check the
-- caller's own role causes RLS to recurse into itself. Admin management of
-- profiles should go through a service-role key (future admin panel), not
-- through client-side RLS on this table.
create policy "profiles_self_select"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_self_update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up -----------------------
-- full_name arrives via the `data: { full_name }` option passed to
-- supabase.auth.signUp() in lib/actions/auth.ts#signUpWithPassword, and via
-- Google's `name` claim for OAuth sign-ins.
create or replace function public.handle_new_user()
returns trigger
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
