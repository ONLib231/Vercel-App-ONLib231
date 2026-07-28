-- ============================================================================
-- Migration: 0001_create_service_options
-- Section: Landing / Role-Selector screen ("What would you like to do?")
--
-- Purpose:
--   Drives the two service cards shown on the shared landing screen
--   (Verta Delivery vs ONLib Marketplace). Kept in the database — rather
--   than hardcoded in the UI — so copy, badges, ordering, and hero images
--   (served from Supabase Storage) can be updated without a redeploy.
--
-- Dependency note:
--   The admin-write policy below references public.profiles.role, which is
--   introduced in the Auth & Role-Routing module (not yet built). Until that
--   migration lands, comment out / defer the "service_options_admin_write"
--   policy, or run this after the profiles table exists — the public read
--   policy (all the landing screen needs) has no such dependency.
-- ============================================================================

create extension if not exists "pgcrypto";

create type public.service_key as enum ('delivery', 'marketplace');

create table if not exists public.service_options (
  id uuid primary key default gen_random_uuid(),
  key public.service_key not null unique,
  title text not null,
  subtitle text not null,
  badge_label text not null,
  badge_icon text not null default 'zap', -- lucide-react icon name, e.g. 'zap' | 'tag'
  image_path text not null, -- object path within the "app-assets" storage bucket
  accent text not null default 'verta', -- tailwind token group: 'verta' | 'onlib'
  route text not null, -- client-side route this card links to, e.g. '/delivery'
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_options is
  'Content-managed cards for the dual-service landing screen (Delivery vs Marketplace).';

-- Keep updated_at fresh on every edit.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_service_options_updated_at
  before update on public.service_options
  for each row execute function public.set_updated_at();

-- Row Level Security -----------------------------------------------------
alter table public.service_options enable row level security;

-- Anyone (including anonymous visitors on the landing screen) may read
-- active service options. This is public marketing content, not user data.
create policy "service_options_public_read"
  on public.service_options
  for select
  using (is_active = true);

-- Only authenticated users with the 'admin' role (see profiles.role in the
-- auth/routing migration) may insert/update/delete these rows.
create policy "service_options_admin_write"
  on public.service_options
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Seed the two launch options ---------------------------------------------
insert into public.service_options
  (key, title, subtitle, badge_label, badge_icon, image_path, accent, route, sort_order)
values
  (
    'delivery',
    'Verta Delivery',
    'Send a package, on demand',
    'Fast. Reliable. Secure.',
    'zap',
    'landing/verta-delivery-hero.png',
    'verta',
    '/delivery',
    1
  ),
  (
    'marketplace',
    'ONLib Marketplace',
    'Shop products from real vendors',
    'Quality. Trusted. Convenient.',
    'tag',
    'landing/onlib-marketplace-hero.png',
    'onlib',
    '/marketplace',
    2
  )
on conflict (key) do nothing;
