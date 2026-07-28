# Verta Platform

Next.js 14 (App Router) + Supabase app unifying two products under one account:

- **ONLib Marketplace** (`/marketplace`) — multi-vendor storefront.
- **Verta Delivery** (`/delivery`) — peer-to-peer delivery requests.
- **Vendor Dashboard** (`/vendor/dashboard`) — gated on an approved vendor application.
- **Super Admin** (`/admin`) — vendor approvals, user roles, categories, cross-module order visibility, and the Delivery Admin console (`/admin/delivery/*`).

`/` is the "What would you like to do?" hub that links into the two services.

## ⚠️ Read this before your first deploy: how this repo was built

This repo was assembled in a sandbox whose outbound network only allowed a
small host allowlist — `registry.npmjs.org` (and the Supabase CLI's download
host) were **not** reachable, so `npm install` could not be run there, and
`npx supabase gen types typescript ...` could not be run against a real
project either. Concretely, that means:

1. **`lib/supabase/database.types.ts` is hand-authored**, not generated. It
   was written column-for-column against `supabase/migrations/*.sql` and
   deliberately kept simple (no PostgREST embedded-resource `Relationships`
   metadata — every function in `lib/*.ts` that queries a related table does
   a second explicit query and merges in application code instead of relying
   on `.select("*, store:stores(*)")` type inference). That sidesteps the
   exact class of bug that ate a huge number of iterations on a previous
   build of this app (`Property 'x' does not exist on type 'never'` from a
   hand-authored `Database` type drifting from what postgrest-js expected).
2. **This code has not been run through a real TypeScript compiler or
   `next build` here.** It was written carefully and consistently, but you
   must verify it yourself — see the checklist below. Please paste back any
   real compiler/build errors if you hit them; that's a fast, mechanical fix
   from real output, not a guessing game.

**As soon as you have a normal environment, regenerate the real types:**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase gen types typescript --project-id <your-project-ref> --schema public > lib/supabase/database.types.ts
```

Re-run that after every future migration change, and treat any diff it
produces against the current file as a bug to go fix (in the SQL or here).

## Deployment checklist

### 1. Create the Supabase project and run migrations

1. Create a new project at supabase.com.
2. Apply the migrations in `supabase/migrations/` **in numeric order** —
   either `npx supabase link --project-ref <ref>` then `npx supabase db push`,
   or paste each file's contents into the SQL Editor in order (0001 → 0009).
3. Optionally run `supabase/seed.sql` for starter categories + delivery price
   presets.
4. In **Storage**, confirm three buckets exist: `vendor-documents` (private),
   `product-images` (public), `store-logos` (public) — migration
   `0007_storage.sql` creates them, but double-check in the dashboard.
5. Regenerate `lib/supabase/database.types.ts` for real (see above).

### 2. Bootstrap your first admin user

There is no self-serve way to become `admin` (by design — see
`handle_new_user()` in `0001_extensions_and_profiles.sql`, which only ever
assigns `customer` or `vendor`). After you sign up your own account through
the app:

```sql
update public.profiles set role = 'admin' where id = '<your-auth-user-uuid>';
```

Find the UUID in Supabase → Authentication → Users.

### 3. Set environment variables

Copy `.env.local.example` → `.env.local` for local dev, and set the same
keys in **Vercel → Project Settings → Environment Variables** (Production
and Preview):

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API — **server-only**, do not prefix `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SITE_URL` | Your production domain once you have one; leave unset on Preview so `lib/site-url.ts` falls back to each preview's own host |
| `DELIVERY_DELETE_PASSWORD` | Shared password gating expense deletion in `/admin/delivery/expenses` |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio console |
| `TWILIO_SMS_FROM` / `TWILIO_WHATSAPP_FROM` | Twilio phone numbers (WhatsApp number must be WhatsApp-enabled in Twilio) |
| `SENDGRID_API_KEY` | Twilio SendGrid |
| `SENDGRID_FROM_EMAIL` | Must be a **verified sender identity** in SendGrid or sends will silently fail |

### 4. Update Supabase Auth URLs once you have a live Vercel domain

Supabase Dashboard → Authentication → URL Configuration:

- **Site URL**: `https://your-app.vercel.app` (or your custom domain)
- **Redirect URLs**: add `https://your-app.vercel.app/auth/callback` (and
  the same for any custom domain, plus `http://localhost:3000/auth/callback`
  for local dev)

If you enable Google as an OAuth provider (the login/signup pages already
have a "Sign in with Google" button wired to `supabase.auth.signInWithOAuth`),
configure it under Authentication → Providers first, or that button will
error harmlessly.

### 5. Verify the build before your first deploy

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # next build
```

Fix anything that surfaces from **real** compiler/build output — don't
hand-tweak types speculatively. If you hit an error, the fastest path is
pasting the exact error text back for a targeted fix.

### 6. Deploy to Vercel

- Import the repo in Vercel, framework preset **Next.js** (auto-detected).
- No `Dockerfile`, `railway.json`, or other platform config exists in this
  repo on purpose — Vercel is the only deploy target.
- Set the env vars from step 3, then deploy.
- After the first successful deploy, go back to step 4 and point Supabase
  Auth at the real Vercel domain.

## Project structure

```
app/
  page.tsx                     # hub: "What would you like to do?"
  (auth)/login, (auth)/signup   # shared auth, account-type toggle
  (auth)/auth/callback/route.ts # email confirm / OAuth redirect exchange
  marketplace/                  # ONLib storefront
  delivery/                     # Verta Delivery sender flow
  vendor/apply, vendor/dashboard/  # vendor application + gated dashboard
  admin/                        # Super Admin + Delivery Admin (/admin/delivery/*)
lib/
  supabase/                     # server.ts, browser.ts, service-role.ts, database.types.ts
  notifications/                # twilio.ts, sendgrid.ts, send-delivery-notification.ts
  auth.ts, marketplace.ts, vendor.ts, vendor-dashboard.ts, delivery-admin.ts
supabase/
  migrations/0001..0009_*.sql   # apply in order
  seed.sql
```

## Notable design decisions

- **RLS from the start**, not bolted on later — see
  `supabase/migrations/0009_rls_policies.sql`. Admin bypass is via an
  `is_admin()` SQL function, not a hardcoded role check, so it composes
  cleanly with every table's policies.
- **`profiles.role` can't be self-escalated** — a trigger
  (`prevent_role_self_escalation`) silently reverts any role change attempted
  by a non-admin session, independent of the RLS policy itself.
- **Vendor documents upload via the service-role client**, because a
  brand-new signup uploads documents in the same request that creates the
  account, before any session/JWT may exist yet.
- **Delivery-order notifications are concurrent and time-boxed** — SMS,
  WhatsApp, email, and the in-app admin notification all fire via
  `Promise.allSettled` with an 8s-per-channel timeout
  (`lib/notifications/send-delivery-notification.ts`), so one slow provider
  can't block the others, and the order itself has already succeeded in the
  database before notification fan-out even starts.
