-- ============================================================================
-- Migration: 0007_super_admin_module
-- Section: Super Admin Dashboard
--
-- Purpose:
--   The Super Admin panel every earlier migration referenced as "not yet
--   built" (see 0004/0005's vendor_applications comments). profiles.role =
--   'admin' already gates the Delivery admin dashboard (0006) and already
--   has write access to categories/stores/products/service_options (0001,
--   0002) — this migration is the one remaining gap: proper admin RLS
--   coverage for reviewing vendor applications and reading every
--   Marketplace order, so the Super Admin app (app/admin/*) can use the
--   same "regular authenticated client + RLS" pattern as the rest of the
--   platform instead of a service-role bypass for every read.
--
--   profiles itself is deliberately NOT touched here — see 0003's comment:
--   a policy on public.profiles that queries public.profiles to check the
--   caller's own role recurses into itself. User/role management
--   (app/admin/users) goes through a service-role key in
--   lib/actions/super-admin.ts, same reasoning as vendor document uploads.
--
--   Run this after 0006. Approve/reject vendor applications used to require
--   a hand-written SQL update (see 0004's header) — once this migration and
--   the Super Admin app are both in place, do it from app/admin/vendor-applications
--   instead. The bootstrap step below still needs to be run by hand once: no
--   UI can promote the *first* Super Admin, since promoting yourself to
--   admin is the one action that Super Admin app can't yet perform on itself.
--
--     update public.profiles
--        set role = 'admin'
--      where id = (select id from auth.users where email = 'onlib231@gmail.com');
-- ============================================================================

-- Vendor application review — who reviewed it, alongside the existing
-- reviewer_notes/reviewed_at columns from 0004. ON DELETE SET NULL so a
-- reviewing admin's account can later be deleted without a foreign-key
-- violation on every application they ever touched — the historical
-- decision (status/reviewer_notes/reviewed_at) stays intact either way.
alter table public.vendor_applications
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

create policy "vendor_applications_admin_select"
  on public.vendor_applications for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "vendor_applications_admin_update"
  on public.vendor_applications for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Platform-wide orders oversight — read-only. orders_store_owner_select
-- (0004) already covers "the store owner or the buyer"; this adds a third,
-- OR'd SELECT policy for admin rather than replacing it.
create policy "orders_admin_select"
  on public.orders for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
