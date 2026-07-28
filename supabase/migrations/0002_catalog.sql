-- 0002_catalog.sql
-- Marketplace catalog: categories, stores, products.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  icon text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  slug text not null unique,
  logo_path text,
  avatar_color text not null default '#0B1F4D',
  rating_avg numeric(3, 2) not null default 0,
  rating_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stores_owner_id_idx on public.stores (owner_id);

create trigger stores_set_updated_at
  before update on public.stores
  for each row execute function public.set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  name text not null,
  slug text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'USD',
  image_path text,
  rating_avg numeric(3, 2) not null default 0,
  rating_count integer not null default 0,
  is_featured boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, slug)
);

create index products_store_id_idx on public.products (store_id);
create index products_category_id_idx on public.products (category_id);
create index products_is_featured_idx on public.products (is_featured) where is_featured = true;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.categories enable row level security;
alter table public.stores enable row level security;
alter table public.products enable row level security;
