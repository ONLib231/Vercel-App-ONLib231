-- 0004_vendor_applications.sql

create type public.id_document_type as enum ('passport', 'national_id', 'drivers_license');
create type public.vendor_application_status as enum ('pending', 'approved', 'rejected');

create table public.vendor_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  business_name text not null,
  id_document_type public.id_document_type not null,
  business_registration_path text,
  id_document_path text,
  status public.vendor_application_status not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vendor_applications_status_idx on public.vendor_applications (status);

create trigger vendor_applications_set_updated_at
  before update on public.vendor_applications
  for each row execute function public.set_updated_at();

alter table public.vendor_applications enable row level security;
