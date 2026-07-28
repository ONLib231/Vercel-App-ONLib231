-- ============================================================================
-- Migration: 0004_create_vendor_module
-- Section: Vendor Onboarding & Dashboard
--
-- Purpose:
--   Lets a user sign up as a Vendor (not just Customer) from the same Sign Up
--   page — "vendors are only identified by their login details," per the
--   product brief, so there is deliberately no separate vendor portal route
--   or marketing page. A vendor signup captures a business registration
--   document + an identification document (Passport / National ID /
--   Driver's License), stored privately in Supabase Storage, and creates a
--   public.vendor_applications row with status = 'pending' for a future
--   Super Admin panel to review.
--
--   Also adds:
--   - profiles.phone — "add a contact input for all sign up," for both
--     Customer and Vendor accounts.
--   - public.orders — needed for the Vendor Dashboard's Sales Overview /
--     Total Orders / Recent Orders (no orders table existed before this;
--     the marketplace module so far only reached cart_items).
--
--   Until the Super Admin panel ships, approve a pending vendor by hand:
--
--     update public.vendor_applications
--        set status = 'approved', reviewed_at = now()
--      where user_id = (select id from auth.users where email = 'girleefashion@golib.test');
--
--   Approving a row auto-provisions a public.stores row for that vendor
--   (see trg_vendor_applications_approved below) so /vendor has something to
--   show immediately — no manual store insert needed.
-- ============================================================================

-- profiles: contact number + vendor metadata capture ------------------------
alter table public.profiles
  add column if not exists phone text;

-- Re-create handle_new_user() to also capture phone and an allowed role from
-- signup metadata. Only 'customer' and 'vendor' can be self-selected at
-- signup — 'driver' and 'admin' are assigned by staff, never by a public
-- signup form, so anything else in raw_user_meta_data->>'role' degrades to
-- 'customer' rather than being trusted verbatim.
create or replace function public.handle_new_user()
returns trigger
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'phone',
    case when new.raw_user_meta_data ->> 'role' = 'vendor' then 'vendor' else 'customer' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql;

-- Vendor applications ---------------------------------------------------------
create table if not exists public.vendor_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  business_name text not null,
  id_document_type text not null check (id_document_type in ('passport', 'national_id', 'drivers_license')),
  -- Object paths in the private "vendor-documents" Storage bucket, each
  -- namespaced under `${user_id}/...` so the owner-scoped storage policy
  -- below can check the path prefix.
  business_registration_path text not null,
  id_document_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer_notes text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);

comment on table public.vendor_applications is
  'One row per vendor signup. Documents live in the private vendor-documents '
  'Storage bucket. Reviewed by the (not-yet-built) Super Admin panel — until '
  'then, approve/reject by hand with a direct SQL update (see migration header).';

create index if not exists vendor_applications_status_idx on public.vendor_applications (status);

alter table public.vendor_applications enable row level security;

-- Owner can see and create their own application, and re-submit (update)
-- while it's still pending. Admin review is deferred to a service-role key
-- (future Super Admin panel), same reasoning as profiles.profiles_self_*.
create policy "vendor_applications_owner_select"
  on public.vendor_applications for select
  using (user_id = auth.uid());

create policy "vendor_applications_owner_insert"
  on public.vendor_applications for insert
  with check (user_id = auth.uid());

create policy "vendor_applications_owner_update_while_pending"
  on public.vendor_applications for update
  using (user_id = auth.uid() and status = 'pending')
  with check (user_id = auth.uid());

-- Auto-provision a store the moment an application is approved, so the
-- Vendor Dashboard has a store_id to attach products/orders to without a
-- separate manual step.
create or replace function public.handle_vendor_application_approved()
returns trigger
security definer set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into public.stores (owner_id, name, slug)
    values (
      new.user_id,
      new.business_name,
      lower(regexp_replace(new.business_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(new.user_id::text, 1, 8)
    )
    on conflict (slug) do nothing;

    if new.reviewed_at is null then
      new.reviewed_at = now();
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_vendor_applications_approved
  before update on public.vendor_applications
  for each row execute function public.handle_vendor_application_approved();

-- Orders -----------------------------------------------------------------
-- Backs the Vendor Dashboard's Sales Overview / Total Orders / Recent
-- Orders, and doubles as the future Customer "Orders" page. buyer_name is
-- denormalized (rather than joined from profiles) so a vendor can see who
-- placed an order without needing read access to that customer's profile row.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  buyer_id uuid, -- fk to public.profiles(id); nullable for guest/legacy orders
  buyer_name text not null,
  status text not null default 'processing' check (status in ('processing', 'fulfilled', 'cancelled')),
  total_cents integer not null check (total_cents >= 0),
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create index if not exists orders_store_idx on public.orders (store_id, created_at desc);
create index if not exists orders_buyer_idx on public.orders (buyer_id, created_at desc);

alter table public.orders enable row level security;

create policy "orders_store_owner_select"
  on public.orders for select
  using (
    exists (select 1 from public.stores s where s.id = orders.store_id and s.owner_id = auth.uid())
    or buyer_id = auth.uid()
  );

create policy "orders_store_owner_write"
  on public.orders for update
  using (exists (select 1 from public.stores s where s.id = orders.store_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from public.stores s where s.id = orders.store_id and s.owner_id = auth.uid()));

-- Vendor documents Storage bucket ---------------------------------------------
-- Private bucket — never publicly readable. Files uploaded by the trusted
-- server-side signup action (service-role client) under `${user_id}/...`;
-- the owner-select policy below is future-proofed for the day a signed-in
-- vendor is allowed to re-upload/view their own documents directly.
insert into storage.buckets (id, name, public)
values ('vendor-documents', 'vendor-documents', false)
on conflict (id) do nothing;

create policy "vendor_documents_owner_select"
  on storage.objects for select
  using (
    bucket_id = 'vendor-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "vendor_documents_owner_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'vendor-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
