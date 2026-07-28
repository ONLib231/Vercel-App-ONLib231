-- 0005_orders.sql
-- Marketplace orders (one row per order against a single store).

create type public.order_status as enum ('pending', 'processing', 'fulfilled', 'cancelled');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  buyer_id uuid references public.profiles (id) on delete set null,
  buyer_name text not null,
  total_cents integer not null default 0 check (total_cents >= 0),
  status public.order_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_store_id_idx on public.orders (store_id);
create index orders_buyer_id_idx on public.orders (buyer_id);
create index orders_status_idx on public.orders (status);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.orders enable row level security;
