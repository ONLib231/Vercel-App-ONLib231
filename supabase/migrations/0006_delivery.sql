-- 0006_delivery.sql
-- Verta Delivery module: agents, orders, expenses, price presets, business settings.

create type public.duty_status as enum ('on_duty', 'off_duty');

create table public.delivery_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  duty_status public.duty_status not null default 'off_duty',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger delivery_agents_set_updated_at
  before update on public.delivery_agents
  for each row execute function public.set_updated_at();

create type public.delivery_status as enum ('pending', 'accepted', 'picked_up', 'delivered', 'cancelled');

create table public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references public.profiles (id) on delete set null,
  sender_name text not null,
  sender_phone text,
  pickup_address text not null,
  dropoff_address text not null,
  item_description text not null,
  price_cents integer,
  status public.delivery_status not null default 'pending',
  placed_by_admin boolean not null default false,
  assigned_agent_id uuid references public.delivery_agents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index delivery_orders_sender_id_idx on public.delivery_orders (sender_id);
create index delivery_orders_status_idx on public.delivery_orders (status);
create index delivery_orders_assigned_agent_id_idx on public.delivery_orders (assigned_agent_id);

create trigger delivery_orders_set_updated_at
  before update on public.delivery_orders
  for each row execute function public.set_updated_at();

create table public.delivery_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  amount numeric(10, 2) not null check (amount >= 0),
  description text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index delivery_expenses_expense_date_idx on public.delivery_expenses (expense_date);

create table public.delivery_price_presets (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  amount numeric(10, 2) not null check (amount >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Singleton settings row: business contact info that delivery-order
-- notifications (SMS/WhatsApp/email) get sent to. Always id = 'business'.
create table public.delivery_settings (
  id text primary key default 'business',
  business_phone text,
  business_email text,
  updated_at timestamptz not null default now(),
  constraint delivery_settings_is_singleton check (id = 'business')
);

create trigger delivery_settings_set_updated_at
  before update on public.delivery_settings
  for each row execute function public.set_updated_at();

insert into public.delivery_settings (id) values ('business')
  on conflict (id) do nothing;

alter table public.delivery_agents enable row level security;
alter table public.delivery_orders enable row level security;
alter table public.delivery_expenses enable row level security;
alter table public.delivery_price_presets enable row level security;
alter table public.delivery_settings enable row level security;
