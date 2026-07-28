-- ============================================================================
-- Migration: 0002_create_marketplace_core
-- Section: Marketplace Homepage (web + mobile)
--
-- Purpose:
--   Backs the ONLib Marketplace homepage: category quick-links, featured
--   products, popular stores, plus the three header/nav badge counts
--   (cart, wishlist, notifications) shown in both the mobile and desktop
--   mockups.
--
-- Dependency note:
--   Write policies below reference public.profiles.role, introduced in the
--   Auth & Role-Routing module (not yet built). Until that migration lands,
--   defer the *_write policies — the public read policies (all this
--   homepage needs) have no such dependency. cart_items / wishlist_items /
--   notifications policies reference auth.uid() directly and have no
--   dependency on profiles.
-- ============================================================================

-- Categories ---------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  icon text not null default 'grid', -- lucide-react icon name
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;

create policy "categories_public_read"
  on public.categories for select
  using (is_active = true);

create policy "categories_admin_write"
  on public.categories for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Stores (vendors) -----------------------------------------------------------
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid, -- fk to public.profiles(id) once the Auth module creates it
  name text not null,
  slug text not null unique,
  logo_path text, -- object path in the "app-assets" Storage bucket; null = initials avatar
  avatar_color text not null default '#1e2a99', -- hex, used for the initials-avatar fallback
  rating_avg numeric(2,1) not null default 0.0,
  rating_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.stores enable row level security;

create policy "stores_public_read"
  on public.stores for select
  using (is_active = true);

create policy "stores_owner_or_admin_write"
  on public.stores for all
  using (
    owner_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    owner_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Products ---------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  slug text not null unique,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'USD',
  image_path text, -- object path in "app-assets"; null = category-icon placeholder in the UI
  rating_avg numeric(2,1) not null default 0.0,
  rating_count integer not null default 0,
  is_featured boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists products_featured_idx on public.products (is_featured, is_active);
create index if not exists products_store_idx on public.products (store_id);
create index if not exists products_category_idx on public.products (category_id);

alter table public.products enable row level security;

create policy "products_public_read"
  on public.products for select
  using (is_active = true);

create policy "products_owner_or_admin_write"
  on public.products for all
  using (
    exists (
      select 1 from public.stores s
      where s.id = products.store_id
        and (s.owner_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
    )
  )
  with check (
    exists (
      select 1 from public.stores s
      where s.id = products.store_id
        and (s.owner_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
    )
  );

-- Cart items ---------------------------------------------------------------
create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, -- fk to public.profiles(id) once the Auth module creates it
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

alter table public.cart_items enable row level security;

create policy "cart_items_owner_rw"
  on public.cart_items for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create trigger trg_cart_items_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();

-- Wishlist items -------------------------------------------------------------
create table if not exists public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, -- fk to public.profiles(id) once the Auth module creates it
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

alter table public.wishlist_items enable row level security;

create policy "wishlist_items_owner_rw"
  on public.wishlist_items for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Notifications --------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, -- fk to public.profiles(id) once the Auth module creates it
  title text not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_unread_idx on public.notifications (user_id, is_read);

alter table public.notifications enable row level security;

create policy "notifications_owner_rw"
  on public.notifications for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Seed data for the homepage mockups -----------------------------------------
insert into public.categories (name, slug, icon, sort_order) values
  ('Electronics', 'electronics', 'monitor', 1),
  ('Home', 'home', 'home', 2),
  ('Fashion', 'fashion', 'shirt', 3),
  ('Beauty', 'beauty', 'sparkles', 4),
  ('More', 'more', 'grid-2x2', 5)
on conflict (slug) do nothing;

insert into public.stores (name, slug, avatar_color, rating_avg, rating_count) values
  ('TechHub', 'techhub', '#0f766e', 4.8, 214),
  ('CraftyHands', 'craftyhands', '#fbbf24', 4.7, 156),
  ('UrbanThreads', 'urbanthreads', '#1e293b', 4.9, 302),
  ('GadgetMaxx', 'gadgetmaxx', '#c92a37', 4.6, 189)
on conflict (slug) do nothing;

insert into public.products (store_id, category_id, name, slug, price_cents, rating_avg, rating_count, is_featured)
select s.id, c.id, v.name, v.slug, v.price_cents, v.rating_avg, v.rating_count, true
from (values
  ('techhub', 'electronics', 'Apex Wireless Headphones', 'apex-wireless-headphones', 14900, 4.5, 128),
  ('urbanthreads', 'fashion', 'Leather Weekend Bag', 'leather-weekend-bag', 19800, 4.6, 98),
  ('craftyhands', 'home', 'Artisan Ceramic Bowl', 'artisan-ceramic-bowl', 6500, 4.9, 74),
  ('gadgetmaxx', 'electronics', 'Smart Watch Series 8', 'smart-watch-series-8', 29900, 4.4, 112)
) as v(store_slug, category_slug, name, slug, price_cents, rating_avg, rating_count)
join public.stores s on s.slug = v.store_slug
join public.categories c on c.slug = v.category_slug
on conflict (slug) do nothing;
