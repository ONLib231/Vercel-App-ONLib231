-- ============================================================================
-- Migration: 0006_create_delivery_module
-- Section: Verta Delivery (senders, admin dispatch dashboard)
--
-- Purpose:
--   Ports the previously-standalone Verta Delivery service (a separate
--   Express + Socket.io + Postgres app, kept as reference under
--   /verta-delivery in the workspace) INTO this Next.js/Supabase codebase,
--   per the decision to unify Marketplace and Delivery under one login,
--   one database, one deploy.
--
--   Mapping from the original app's model to this one:
--     - "sender" (original: its own users table, JWT auth) -> any signed-in
--       profile (public.profiles), same account a customer already has for
--       Marketplace. No new role needed — every signed-in user can place a
--       delivery order.
--     - "admin" (original: one shared password) -> profiles.role = 'admin',
--       the same admin role already used for service_options/categories
--       admin-write policies (see 0001/0002). One admin tier, not two.
--     - Fleet Directory "agents" -> delivery_agents, still NOT login
--       accounts, just an admin-managed roster (same as the original).
--     - Realtime Socket.io rooms -> Supabase Realtime (Postgres Changes) on
--       these tables; RLS is what makes a sender's subscription only ever
--       receive their own rows, same effect as the original's per-sender
--       Socket.io room without any separate realtime server to run.
--
--   Deliberately NOT ported in this migration (kept as later follow-ups,
--   same reasoning as the vendor module's Super Admin panel):
--     - Login history, "logout all devices" / token_version — Supabase Auth
--       already manages sessions; there's no hand-rolled JWT to invalidate.
--     - Password reset via SMS/WhatsApp (Twilio) — Supabase Auth's own
--       email-based reset already covers this; a phone-based reset would be
--       new work, not a port, if still wanted later.
--     - PDF reports, Customers aggregation page, Help & Support content.
--   The admin dashboard pages for these ship as "coming soon" placeholders
--   (see app/delivery/admin/*), same pattern as the vendor stub pages.
-- ============================================================================

-- Orders ----------------------------------------------------------------
create table if not exists public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_name text not null,
  pickup_address text not null,
  dropoff_address text not null,
  item_description text not null,
  amount numeric(10, 2),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'picked_up', 'delivered', 'cancelled')),
  -- Agent's name as free text (not a foreign key) — matches the original
  -- app's delivery_agents design: renaming/removing an agent later shouldn't
  -- retroactively change historical order records.
  accepted_by text,
  payment_method text,
  placed_by_admin boolean not null default false,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz
);

comment on table public.delivery_orders is
  'Delivery requests. A sender sees only their own rows; profiles.role = ''admin'' sees every row (dispatch dashboard).';

create index if not exists delivery_orders_created_at_idx on public.delivery_orders (created_at desc);
create index if not exists delivery_orders_sender_idx on public.delivery_orders (sender_id, created_at desc);

alter table public.delivery_orders enable row level security;

create policy "delivery_orders_select"
  on public.delivery_orders for select
  using (
    sender_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- A sender places their own order. Admin-placed ("walk-in"/phone) orders go
-- through a Server Action using the service-role client instead (it needs
-- to look up an arbitrary customer, not just auth.uid()'s own id).
create policy "delivery_orders_sender_insert"
  on public.delivery_orders for insert
  with check (sender_id = auth.uid() and placed_by_admin = false);

-- A sender may cancel their OWN order, and only while it's still pending
-- (not yet accepted by an agent) — mirrors the original app's
-- "order:cancel" socket handler exactly.
create policy "delivery_orders_sender_cancel"
  on public.delivery_orders for update
  using (sender_id = auth.uid() and status = 'pending')
  with check (sender_id = auth.uid() and status = 'cancelled');

-- Everything else an admin does (accept, change status/amount/agent, bulk
-- delete) goes through Server Actions using the service-role client after
-- checking profiles.role = 'admin' server-side — deliberately no admin
-- UPDATE/DELETE policy here, same reasoning as vendor_applications review.

-- Fleet Directory (agents) ------------------------------------------------
-- NOT login accounts — an admin-managed contact roster, same as the
-- original app's `agents` table.
create table if not exists public.delivery_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  duty_status text not null default 'off_duty' check (duty_status in ('on_duty', 'off_duty')),
  created_at timestamptz not null default now()
);

alter table public.delivery_agents enable row level security;

create policy "delivery_agents_admin_select"
  on public.delivery_agents for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Expenses (admin only, not tied to a sender) -----------------------------
create table if not exists public.delivery_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date timestamptz not null,
  amount numeric(10, 2) not null,
  description text not null,
  created_at timestamptz not null default now()
);

create index if not exists delivery_expenses_date_idx on public.delivery_expenses (expense_date desc);

alter table public.delivery_expenses enable row level security;

create policy "delivery_expenses_admin_select"
  on public.delivery_expenses for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Pricing presets (admin-defined reference price points, offered as
-- quick-select options in the Accept Order flow) ---------------------------
create table if not exists public.delivery_price_presets (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  amount numeric(10, 2) not null,
  created_at timestamptz not null default now()
);

alter table public.delivery_price_presets enable row level security;

create policy "delivery_price_presets_admin_select"
  on public.delivery_price_presets for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Business settings (single row) -------------------------------------------
-- Readable by everyone (business name/hours/logo are shown to senders too,
-- same as any storefront's public profile); writable by admin only.
create table if not exists public.delivery_settings (
  id text primary key default 'business',
  business_name text,
  business_email text,
  business_phone text,
  business_address text,
  business_description text,
  logo_path text, -- object path in the public "app-assets" Storage bucket
  opening_time text,
  closing_time text,
  open_days text[],
  currency text not null default 'USD',
  timezone text not null default 'Africa/Monrovia',
  updated_at timestamptz not null default now()
);

insert into public.delivery_settings (id) values ('business') on conflict (id) do nothing;

create trigger trg_delivery_settings_updated_at
  before update on public.delivery_settings
  for each row execute function public.set_updated_at();

alter table public.delivery_settings enable row level security;

create policy "delivery_settings_public_select"
  on public.delivery_settings for select
  using (true);

-- Admin-managed write path also goes through a Server Action + service-role
-- client (same reasoning as agents/expenses/price presets) rather than a
-- client-side write policy, since settings updates also touch Storage
-- (logo upload) in the same request.

-- Realtime -----------------------------------------------------------------
-- Replaces the original app's Socket.io rooms: a sender's Supabase client
-- subscribes to postgres_changes on delivery_orders and only ever receives
-- rows RLS lets them see (their own); an admin's client subscribes without
-- a filter and, because the admin SELECT policy allows every row, receives
-- every change. Guarded with a DO block so re-running this migration
-- doesn't error if the table's already in the publication.
do $$
begin
  alter publication supabase_realtime add table public.delivery_orders;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.delivery_agents;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.delivery_expenses;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.delivery_price_presets;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.delivery_settings;
exception when duplicate_object then null;
end $$;
