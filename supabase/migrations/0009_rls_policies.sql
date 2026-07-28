-- 0009_rls_policies.sql
-- Row Level Security policies for every table. General shape:
--   * Marketplace catalog (categories/stores/products) is publicly readable
--     when active, writable only by the owning approved vendor or an admin.
--   * Per-user tables (cart/wishlist/notifications) are strictly self-scoped.
--   * vendor_applications: self-submit + self-view, admin reviews.
--   * delivery_* tables: admin/staff-only (role = 'admin' covers both the
--     Super Admin and Delivery Admin dashboards per the shared role enum),
--     except delivery_orders which senders can also create and view their own.
--   * A service-role client (used by trusted server actions, e.g. checkout,
--     vendor approval, delivery-order notification fan-out) bypasses RLS
--     entirely, so those flows are not blocked by any policy below.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy "profiles: select own or admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "profiles: update own or admin"
  on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
-- Note: role escalation is additionally blocked by the
-- profiles_prevent_role_self_escalation trigger regardless of this policy.

-- No insert policy: rows are created exclusively by the
-- handle_new_user() SECURITY DEFINER trigger, which bypasses RLS.

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create policy "categories: public read active"
  on public.categories for select
  using (is_active = true or public.is_admin());

create policy "categories: admin write insert"
  on public.categories for insert
  with check (public.is_admin());

create policy "categories: admin write update"
  on public.categories for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "categories: admin write delete"
  on public.categories for delete
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- stores
-- ---------------------------------------------------------------------------
create policy "stores: public read active or own or admin"
  on public.stores for select
  using (is_active = true or owner_id = auth.uid() or public.is_admin());

create policy "stores: admin insert"
  on public.stores for insert
  with check (public.is_admin());
-- Stores are provisioned by the admin approve-vendor-application action
-- (using the caller's admin session or a service-role client), not
-- self-inserted by vendors.

create policy "stores: owner or admin update"
  on public.stores for update
  using (
    (owner_id = auth.uid() and public.is_approved_vendor_for_store(id))
    or public.is_admin()
  )
  with check (
    (owner_id = auth.uid() and public.is_approved_vendor_for_store(id))
    or public.is_admin()
  );

create policy "stores: admin delete"
  on public.stores for delete
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create policy "products: public read active or owner or admin"
  on public.products for select
  using (
    (is_active = true and exists (
      select 1 from public.stores s where s.id = store_id and s.is_active = true
    ))
    or public.owns_store(store_id)
    or public.is_admin()
  );

create policy "products: approved vendor or admin insert"
  on public.products for insert
  with check (public.is_approved_vendor_for_store(store_id) or public.is_admin());

create policy "products: approved vendor or admin update"
  on public.products for update
  using (public.is_approved_vendor_for_store(store_id) or public.is_admin())
  with check (public.is_approved_vendor_for_store(store_id) or public.is_admin());

create policy "products: approved vendor or admin delete"
  on public.products for delete
  using (public.is_approved_vendor_for_store(store_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- cart_items
-- ---------------------------------------------------------------------------
create policy "cart_items: owner full access select"
  on public.cart_items for select
  using (user_id = auth.uid());

create policy "cart_items: owner full access insert"
  on public.cart_items for insert
  with check (user_id = auth.uid());

create policy "cart_items: owner full access update"
  on public.cart_items for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "cart_items: owner full access delete"
  on public.cart_items for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- wishlist_items
-- ---------------------------------------------------------------------------
create policy "wishlist_items: owner full access select"
  on public.wishlist_items for select
  using (user_id = auth.uid());

create policy "wishlist_items: owner full access insert"
  on public.wishlist_items for insert
  with check (user_id = auth.uid());

create policy "wishlist_items: owner full access delete"
  on public.wishlist_items for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create policy "notifications: owner select"
  on public.notifications for select
  using (user_id = auth.uid());

create policy "notifications: owner update (mark read)"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "notifications: owner delete"
  on public.notifications for delete
  using (user_id = auth.uid());
-- No general insert policy: notifications are inserted by trusted server
-- code (service-role client) as part of order/delivery-order flows.

-- ---------------------------------------------------------------------------
-- vendor_applications
-- ---------------------------------------------------------------------------
create policy "vendor_applications: self or admin select"
  on public.vendor_applications for select
  using (user_id = auth.uid() or public.is_admin());

create policy "vendor_applications: self insert"
  on public.vendor_applications for insert
  with check (user_id = auth.uid());

create policy "vendor_applications: self update while pending, admin any time"
  on public.vendor_applications for update
  using ((user_id = auth.uid() and status = 'pending') or public.is_admin())
  with check ((user_id = auth.uid() and status = 'pending') or public.is_admin());

-- ---------------------------------------------------------------------------
-- orders (marketplace)
-- ---------------------------------------------------------------------------
create policy "orders: buyer, store owner, or admin select"
  on public.orders for select
  using (
    buyer_id = auth.uid()
    or public.owns_store(store_id)
    or public.is_admin()
  );

create policy "orders: buyer or admin insert"
  on public.orders for insert
  with check (buyer_id = auth.uid() or public.is_admin());

create policy "orders: store owner or admin update"
  on public.orders for update
  using (public.is_approved_vendor_for_store(store_id) or public.is_admin())
  with check (public.is_approved_vendor_for_store(store_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- delivery_agents / delivery_expenses / delivery_price_presets / delivery_settings
-- (Delivery Admin dashboard — staff only, i.e. role = 'admin')
-- ---------------------------------------------------------------------------
create policy "delivery_agents: admin all select"
  on public.delivery_agents for select using (public.is_admin());
create policy "delivery_agents: admin all insert"
  on public.delivery_agents for insert with check (public.is_admin());
create policy "delivery_agents: admin all update"
  on public.delivery_agents for update using (public.is_admin()) with check (public.is_admin());
create policy "delivery_agents: admin all delete"
  on public.delivery_agents for delete using (public.is_admin());

create policy "delivery_expenses: admin all select"
  on public.delivery_expenses for select using (public.is_admin());
create policy "delivery_expenses: admin all insert"
  on public.delivery_expenses for insert with check (public.is_admin());
create policy "delivery_expenses: admin all update"
  on public.delivery_expenses for update using (public.is_admin()) with check (public.is_admin());
create policy "delivery_expenses: admin all delete"
  on public.delivery_expenses for delete using (public.is_admin());

create policy "delivery_price_presets: admin all select"
  on public.delivery_price_presets for select using (public.is_admin());
create policy "delivery_price_presets: admin all insert"
  on public.delivery_price_presets for insert with check (public.is_admin());
create policy "delivery_price_presets: admin all update"
  on public.delivery_price_presets for update using (public.is_admin()) with check (public.is_admin());
create policy "delivery_price_presets: admin all delete"
  on public.delivery_price_presets for delete using (public.is_admin());

create policy "delivery_settings: admin select"
  on public.delivery_settings for select using (public.is_admin());
create policy "delivery_settings: admin update"
  on public.delivery_settings for update using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- delivery_orders (senders can create + view their own; staff manage all)
-- ---------------------------------------------------------------------------
create policy "delivery_orders: sender or admin select"
  on public.delivery_orders for select
  using (sender_id = auth.uid() or public.is_admin());

create policy "delivery_orders: sender or admin insert"
  on public.delivery_orders for insert
  with check (sender_id = auth.uid() or public.is_admin());

create policy "delivery_orders: admin update"
  on public.delivery_orders for update
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- storage.objects
-- ---------------------------------------------------------------------------
create policy "vendor-documents: read own or admin"
  on storage.objects for select
  using (
    bucket_id = 'vendor-documents'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );
-- No insert/update/delete policy for vendor-documents: all writes go through
-- the service-role client from the signup/re-upload server action, which
-- bypasses storage RLS entirely. This is intentional (see 0007_storage.sql).

create policy "product-images: public read"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "product-images: approved vendor or admin write insert"
  on storage.objects for insert
  with check (
    bucket_id = 'product-images'
    and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );

create policy "product-images: approved vendor or admin write update"
  on storage.objects for update
  using (
    bucket_id = 'product-images'
    and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );

create policy "product-images: approved vendor or admin write delete"
  on storage.objects for delete
  using (
    bucket_id = 'product-images'
    and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );

create policy "store-logos: public read"
  on storage.objects for select
  using (bucket_id = 'store-logos');

create policy "store-logos: approved vendor or admin write insert"
  on storage.objects for insert
  with check (
    bucket_id = 'store-logos'
    and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );

create policy "store-logos: approved vendor or admin write update"
  on storage.objects for update
  using (
    bucket_id = 'store-logos'
    and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );

create policy "store-logos: approved vendor or admin write delete"
  on storage.objects for delete
  using (
    bucket_id = 'store-logos'
    and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );
