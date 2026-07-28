-- 0008_helper_functions.sql
-- SECURITY DEFINER helper functions used throughout the RLS policies in
-- 0009_rls_policies.sql. Defined as STABLE SQL functions so Postgres can
-- inline/cache them cheaply inside policy checks.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.owns_store(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.stores
    where id = target_store_id and owner_id = auth.uid()
  );
$$;

-- True only once the owning user's vendor application has been approved.
-- Store rows are created by an admin action at approval time (see the admin
-- vendor-application approve server action), so "owns the store" and "is an
-- approved vendor" are checked separately for clarity even though in
-- practice a store should never exist for a non-approved owner.
create or replace function public.is_approved_vendor_for_store(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stores s
    join public.vendor_applications va on va.user_id = s.owner_id
    where s.id = target_store_id
      and s.owner_id = auth.uid()
      and va.status = 'approved'
  );
$$;

-- Attach the role-self-escalation guard declared in 0001 now that is_admin()
-- exists.
create trigger profiles_prevent_role_self_escalation
  before update on public.profiles
  for each row execute function public.prevent_role_self_escalation();
