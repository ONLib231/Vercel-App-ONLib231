-- 0003_customer_activity.sql
-- Per-user marketplace activity: cart, wishlist, in-app notifications.

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (user_id, product_id) -- required for upsert-on-conflict "add to cart"
);

create index cart_items_user_id_idx on public.cart_items (user_id);

create table public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index wishlist_items_user_id_idx on public.wishlist_items (user_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_id_idx on public.notifications (user_id);
create index notifications_user_id_unread_idx on public.notifications (user_id) where is_read = false;

alter table public.cart_items enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.notifications enable row level security;
