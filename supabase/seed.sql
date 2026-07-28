-- supabase/seed.sql
-- Optional local/dev seed data. Safe to run repeatedly (idempotent upserts).
-- Not applied automatically on a linked remote project by `supabase db push`;
-- run explicitly with `supabase db reset` (local) or paste into the SQL editor.

insert into public.categories (name, slug, icon, sort_order) values
  ('Electronics', 'electronics', 'monitor', 1),
  ('Home', 'home', 'home', 2),
  ('Fashion', 'fashion', 'shirt', 3),
  ('Beauty', 'beauty', 'sparkles', 4),
  ('More', 'more', 'grid', 5)
on conflict (slug) do nothing;

insert into public.delivery_price_presets (label, amount, sort_order) values
  ('Same-city, small item', 5.00, 1),
  ('Same-city, standard', 8.00, 2),
  ('Cross-town', 12.00, 3),
  ('Express (under 1 hour)', 18.00, 4)
on conflict do nothing;
