-- 0007_storage.sql
-- Storage buckets. vendor-documents is private (business registration + ID
-- documents); product-images and store-logos are public read buckets.
--
-- vendor-documents is written ONLY via a service-role client. That's required
-- because a brand-new vendor signup uploads their documents as part of the
-- same request that creates their account — at that point in the request
-- there may not yet be an established browser session/JWT to authenticate an
-- anon-key upload, so the server action uses the service-role key (which
-- bypasses RLS/storage policies entirely) to place the files.

insert into storage.buckets (id, name, public)
values ('vendor-documents', 'vendor-documents', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('store-logos', 'store-logos', true)
on conflict (id) do nothing;

-- Objects are expected to be stored under a `{user_id}/...` (or
-- `{store_owner_id}/...`) prefix so folder-based ownership checks work,
-- e.g. vendor-documents/<user_id>/business-registration.pdf
