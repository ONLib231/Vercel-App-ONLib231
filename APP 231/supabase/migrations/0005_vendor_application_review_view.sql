-- ============================================================================
-- Migration: 0005_vendor_application_review_view
-- Section: Vendor Onboarding & Dashboard
--
-- Purpose:
--   Replaces the email-notification path (there's no email provider wired
--   up, and the product decision was to skip email entirely rather than add
--   one) with a review-friendly view for checking new vendor applications
--   directly in Supabase — the Table/SQL Editor — until the Super Admin
--   panel ships.
--
--   public.vendor_applications_review joins the applicant's name/phone
--   (profiles) and email (auth.users) onto each vendor_applications row, so
--   you don't have to cross-reference three tables by hand.
--
--   Deliberately NOT exposed to the app's normal client/server API: the
--   explicit revokes below mean this view only works when queried directly
--   (Supabase SQL Editor, or any Postgres client connected with the
--   postgres/service_role credentials) — the anon/authenticated roles
--   PostgREST uses for the running app can't see it at all. Do the same
--   review work through this view that you'd otherwise have done by reading
--   raw rows in the vendor_applications table.
-- ============================================================================

create or replace view public.vendor_applications_review as
select
  va.id,
  va.user_id,
  va.business_name,
  p.full_name as applicant_name,
  p.phone as applicant_phone,
  u.email as applicant_email,
  va.id_document_type,
  va.business_registration_path,
  va.id_document_path,
  va.status,
  va.reviewer_notes,
  va.submitted_at,
  va.reviewed_at
from public.vendor_applications va
join public.profiles p on p.id = va.user_id
join auth.users u on u.id = va.user_id
order by va.submitted_at desc;

comment on view public.vendor_applications_review is
  'Admin-review convenience view — join of vendor_applications + profiles + '
  'auth.users(email). Not reachable via the app''s anon/authenticated API '
  '(see revokes below); query it directly in the Supabase SQL Editor.';

revoke all on public.vendor_applications_review from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Handy queries for manual review (run these in the Supabase SQL Editor):
--
-- List everything waiting on a decision:
--   select * from public.vendor_applications_review where status = 'pending';
--
-- Look up documents for one applicant (business_registration_path /
-- id_document_path are object paths in the private "vendor-documents"
-- bucket — open Storage > vendor-documents in the dashboard and navigate to
-- that path, or generate a signed URL for it):
--   select business_registration_path, id_document_path
--   from public.vendor_applications_review
--   where applicant_email = 'girleefashion@golib.test';
--
-- Approve (also auto-creates the vendor's store — see
-- handle_vendor_application_approved() in migration 0004):
--   update public.vendor_applications set status = 'approved', reviewed_at = now()
--   where user_id = (select id from auth.users where email = 'girleefashion@golib.test');
--
-- Reject, with a note the applicant will see on /vendor/pending:
--   update public.vendor_applications
--      set status = 'rejected', reviewed_at = now(),
--          reviewer_notes = 'Business registration document was unreadable — please re-submit.'
--   where user_id = (select id from auth.users where email = 'girleefashion@golib.test');
-- ----------------------------------------------------------------------------
