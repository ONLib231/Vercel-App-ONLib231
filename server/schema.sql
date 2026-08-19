-- Verta Delivery Service - PostgreSQL schema (Railway)
-- Run once against your Railway Postgres instance (server.js does this
-- automatically on boot).

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    business_name TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    phone         TEXT,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'sender' CHECK (role IN ('sender', 'admin', 'super_admin', 'vendor')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CREATE TABLE IF NOT EXISTS above only applies to brand-new databases —
-- an already-existing `users` table (from before this update) won't
-- automatically gain the `phone` column, so this migrates it explicitly.
-- Existing senders will have phone = NULL until they add one; password
-- reset simply won't be available to them until then (see README).
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- Vendor self-registration approval workflow. Existing/seeded accounts
-- (customers, Manage Agent, Super Admin, and the seeded Girlee Fashion
-- vendor) default to 'approved' so nothing already working is affected —
-- only a NEW self-registered vendor starts 'pending'. Documents stored
-- as base64 in Postgres, same pattern as product/logo images elsewhere
-- in this app, for the same reason (Railway wipes its filesystem on
-- redeploy, so a file path would silently break).
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_registration_doc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_document_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_document_doc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;
-- Set when a Super Admin rejects a vendor/delivery-company application
-- (required at that point — see the reject endpoints in server.js) so
-- the applicant knows why, not just that they were turned down.
-- Cleared automatically on a later approval (see
-- setVendorApprovalStatus/setDeliveryCompanyApprovalStatus in db.js),
-- so a fresh approval never carries a stale rejection explanation.
ALTER TABLE users ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Existing databases already have a `role` CHECK constraint that only
-- allows 'sender'/'admin' — CREATE TABLE IF NOT EXISTS above won't touch
-- it on an already-existing table, so this widens it explicitly to the
-- full current set of roles in one step (the Postgres-assigned default
-- name for an inline column CHECK constraint is `<table>_<column>_check`).
-- IMPORTANT: this must always list every role the app currently uses.
-- Narrowing this list on a live database with rows already using a role
-- being removed will crash on boot — Postgres validates ADD CONSTRAINT
-- against every existing row, not just new ones going forward.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('sender', 'admin', 'super_admin', 'vendor', 'delivery_company'));

-- Bumped whenever an admin uses "Logout All Devices" (Settings > Security).
-- Every JWT embeds the token_version that was current when it was issued;
-- requireAuth/socketAuth reject a token whose version doesn't match the
-- user's current value, which is what makes "logout everywhere" possible
-- without a full session-table rewrite of the stateless JWT auth this app
-- already uses.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- Single-row table: one business, one set of settings. Logo is stored as
-- a data URL (base64) directly in the row rather than a file path —
-- Railway's filesystem is wiped on every redeploy, so a path-based
-- upload would silently break; a small logo image living in Postgres
-- doesn't have that problem. Kept deliberately small (see server.js for
-- the upload size limit enforced on save).
CREATE TABLE IF NOT EXISTS settings (
    id                 TEXT PRIMARY KEY DEFAULT 'business',
    business_name      TEXT,
    business_email     TEXT,
    business_phone     TEXT,
    business_address   TEXT,
    business_description TEXT,
    logo_data_url      TEXT,
    opening_time       TEXT,
    closing_time       TEXT,
    open_days          TEXT[],
    currency           TEXT NOT NULL DEFAULT 'USD',
    timezone           TEXT NOT NULL DEFAULT 'Africa/Monrovia',
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Real, Super-Admin-editable Privacy Policy / Terms of Service text.
-- NULL until customized — the app falls back to sensible default
-- content until an admin actually edits and saves their own.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS privacy_policy TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS terms_of_service TEXT;

-- Real, Super-Admin-editable Help & Support FAQ lists — same
-- null-until-customized fallback pattern as privacy_policy/
-- terms_of_service above. Two separate lists because Help & Support
-- has always shown different questions to Admin/Manage Agent
-- (operating the dashboard) vs. everyone else (customers, vendors,
-- delivery companies — using the product). Each is a JSON array of
-- {q, a} objects, in display order.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS admin_faqs JSONB;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS customer_faqs JSONB;

-- Real login history — logged on every successful login (sender or
-- admin). Device/browser are parsed from the request's User-Agent
-- header; there's no city/location field because that needs a paid
-- IP-geolocation service this app doesn't have — showing a fabricated
-- "Monrovia" for every row would be worse than not showing one.
CREATE TABLE IF NOT EXISTS login_history (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT,
    device     TEXT,
    browser    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON login_history (user_id, created_at DESC);

-- Real per-device "Active Sessions" revocation. Each login_history row
-- IS the session — its id gets embedded in the JWT issued at that
-- login, and requireAuth checks revoked_at on every request. NULL
-- means still active; set means that one specific token now rejects
-- regardless of its expiry, without affecting any other device's
-- session (unlike "Logout All Devices", which bumps token_version and
-- invalidates everything at once).
ALTER TABLE login_history ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- Password reset codes, sent via SMS/WhatsApp (server/notify.js) to the
-- phone number a sender registered with. Each code is single-use and
-- expires — old/used rows are harmless to keep around (no cleanup job
-- needed for the volumes this app deals with), but see README if you
-- want to prune them later.
CREATE TABLE IF NOT EXISTS password_resets (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used       BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets (user_id);

CREATE TABLE IF NOT EXISTS orders (
    id               TEXT PRIMARY KEY,
    sender_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_name      TEXT NOT NULL,
    pickup_address   TEXT NOT NULL,
    dropoff_address  TEXT NOT NULL,
    item_description TEXT NOT NULL,
    amount           NUMERIC(10, 2),
    status           TEXT NOT NULL DEFAULT 'pending',
    accepted_by      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at      TIMESTAMPTZ,
    picked_up_at     TIMESTAMPTZ,
    delivered_at     TIMESTAMPTZ
);

-- Real payment method, set when an order is accepted (not fabricated
-- display data). NULL until then, same pattern as `amount`.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- True when an admin placed this order on a customer's behalf (phone/
-- walk-in order) rather than the customer placing it themselves.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS placed_by_admin BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS expenses (
    id          TEXT PRIMARY KEY,
    date        TIMESTAMPTZ NOT NULL,
    amount      NUMERIC(10, 2) NOT NULL,
    description TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Delivery agents (Fleet Directory). Separate from `users` on purpose —
-- agents aren't login accounts, just a managed contact/roster list that
-- admins can add to and edit. `accepted_by` on orders stores the agent's
-- NAME as free text (not a foreign key), so renaming an agent here won't
-- retroactively change historical order records — see README for the
-- tradeoff this implies.
CREATE TABLE IF NOT EXISTS agents (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "On Duty / Off Duty" — explicitly set by an admin in the Fleet
-- Directory, NOT automatic connection/GPS presence (agents don't have
-- logins or devices reporting to this app). Named "duty_status" rather
-- than reusing the word "online" to keep that distinction honest in the
-- data model itself, even though the UI may still show it as an
-- Online/Offline-style badge.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS duty_status TEXT NOT NULL DEFAULT 'off_duty' CHECK (duty_status IN ('on_duty', 'off_duty'));

-- Multi-provider delivery: which company (a user with role =
-- 'delivery_company', OR the existing 'admin' account representing
-- Verta Delivery Service's own in-house fleet — see the backward-
-- compat migration in server.js) this agent belongs to, and which
-- company actually fulfilled a given order. Nullable — existing
-- agents get backfilled in server.js on boot (needs the real
-- ADMIN_EMAIL value, which can be overridden per-deployment via an
-- env var, so it can't be safely hardcoded in this static SQL file).
ALTER TABLE agents ADD COLUMN IF NOT EXISTS delivery_company_id TEXT REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_company_id TEXT REFERENCES users(id);

-- Pricing presets (Settings > Pricing) — named, reusable delivery price
-- points an admin defines once (e.g. "Standard - $2.50"), offered as
-- quick-select options when accepting an order. Not an automatic
-- distance/zone pricing engine — this app has no mapping/geocoding data
-- to base that on, so this is real, admin-defined reference pricing
-- rather than a calculator pretending to know actual distances.
CREATE TABLE IF NOT EXISTS price_presets (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    amount     NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_sender_id ON orders (sender_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date DESC);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ============================================================
-- Marketplace foundation (ONLib) — vendors sell products, customers
-- (existing sender accounts) buy them. This is the real data model
-- the marketplace needs; the UI on top of it is a first, functional
-- slice, not the full mockup (no promos/wishlist/messages/reviews yet).
--
-- Two decisions were defaulted rather than asked a third time (flagged
-- in README): checkout is pay-on-delivery (no payment gateway exists),
-- and a purchase automatically creates a real delivery order in the
-- existing `orders` table for fulfillment — matching "Shop & Delivery"
-- branding and letting this reuse the whole existing agent/delivery
-- pipeline instead of building a second one.
-- ============================================================

CREATE TABLE IF NOT EXISTS products (
    id            TEXT PRIMARY KEY,
    vendor_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT,
    price         NUMERIC(10, 2) NOT NULL,
    category      TEXT,
    image_data_url TEXT, -- same pattern as the business logo: stored in
                          -- Postgres directly, not a file path, since
                          -- Railway's filesystem is wiped on redeploy
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Low-stock alerts: a vendor-set threshold (null = alerts off for this
-- product) plus a dedup timestamp so the periodic scan (see
-- db.getProductsNeedingLowStockAlert / server.js runLowStockScan) fires
-- once per dip below the threshold instead of every scan tick.
-- low_stock_alert_sent_at is cleared automatically whenever a vendor
-- explicitly changes the stock count (see db.updateProduct).
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_alert_sent_at TIMESTAMPTZ;

-- Follower broadcast — lets a vendor notify their store_follows
-- followers about a product (new listing or a sale). Timestamped (not a
-- boolean) so a cooldown can be enforced server-side (see
-- POST /api/vendor/products/:id/notify-followers in server.js),
-- preventing a vendor from spamming their followers on every request.
ALTER TABLE products ADD COLUMN IF NOT EXISTS followers_notified_at TIMESTAMPTZ;

-- Additional product photos, beyond the one primary photo stored on
-- products.image_data_url — lets the PDP show a real multi-image
-- gallery instead of being capped at a single picture. position
-- controls display order (lower shows first, after the primary image).
CREATE TABLE IF NOT EXISTS product_images (
    id            TEXT PRIMARY KEY,
    product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    image_data_url TEXT NOT NULL,
    position      INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images (product_id);
CREATE INDEX IF NOT EXISTS idx_products_vendor_id ON products (vendor_id);

-- Storefront home-screen hero carousel. Super Admin manages up to 3
-- slides here; the storefront falls back to a single hardcoded
-- "Discover Amazing Products" slide when this table is empty (fresh
-- installs, or every slide temporarily removed), so the home screen is
-- never left with an empty banner area.
CREATE TABLE IF NOT EXISTS home_banners (
    id            TEXT PRIMARY KEY,
    position      INTEGER NOT NULL DEFAULT 0,
    eyebrow       TEXT,
    headline      TEXT NOT NULL,
    subtext       TEXT,
    cta_text      TEXT NOT NULL DEFAULT 'Shop Now',
    cta_link      TEXT,
    image_data_url TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_home_banners_position ON home_banners (position);

-- A purchase is a shopping-cart checkout — one customer, one vendor
-- (carts don't mix vendors, so multi-vendor carts split into separate
-- purchases at checkout), optionally linked to the delivery order
-- created to fulfill it.
CREATE TABLE IF NOT EXISTS purchases (
    id              TEXT PRIMARY KEY,
    customer_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vendor_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_amount    NUMERIC(10, 2) NOT NULL,
    delivery_order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchases_vendor_id ON purchases (vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchases_customer_id ON purchases (customer_id);

-- Marketplace checkout payment tracking. Not to be confused with
-- orders.payment_method above (added earlier) — that one records how a
-- delivery agent collected payment in person when accepting/completing
-- an ordinary delivery order; this one tracks online payment for a
-- marketplace purchase itself, before any delivery even happens.
-- 'cod' (pay on delivery, the original/default behavior — payment_status
-- stays 'not_applicable' since nothing digital is tracked for it),
-- 'momo' (an automated MTN Open API push-to-phone flow — payment_status
-- starts 'pending' at checkout and is flipped to 'successful' or
-- 'failed' once MTN confirms; see db.checkout()/voidFailedMomoPayment()
-- and server.js's /api/marketplace/checkout/momo routes — currently
-- unreachable from the checkout UI, see README), or 'momo_manual' (the
-- customer transfers to the platform's own Mobile Money number
-- themselves and types a generated reference code into their transfer;
-- a Super Admin matches it by hand and confirms — see payment_provider/
-- payment_reference/payment_confirmed_by/payment_confirmed_at below).
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cod';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'not_applicable';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS momo_reference_id TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS momo_phone TEXT;
-- Held here only while a Mobile Money payment is pending — the real
-- delivery order (and its own pickup_address/dropoff_address columns
-- on `orders`) isn't created until payment succeeds, so it never shows
-- up in the live delivery queue for an order nobody has actually paid
-- for yet. Cleared back to NULL once the real order is created.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS pending_pickup_address TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS pending_dropoff_address TEXT;

-- 'momo_manual' payment fields — see the payment_method comment above.
-- payment_provider is which Mobile Money network the customer chose
-- ('orange_money' or 'lonestar_mtn'); payment_reference is the
-- system-generated 'REF-######' code shown to the customer and typed
-- into their own transfer, generated inside db.checkout() and unique
-- platform-wide (enforced below, not just app-side) so two customers'
-- codes can never collide and get cross-matched by mistake during
-- reconciliation. payment_confirmed_by/payment_confirmed_at record
-- which Super Admin matched the reference against a real received
-- payment and when — same audit shape as featured_slots/
-- subscription_charges' confirmed_by/confirmed_at for their own
-- 'direct' manual payment method.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_provider TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_reference TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_payment_reference ON purchases (payment_reference) WHERE payment_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS purchase_items (
    id            TEXT PRIMARY KEY,
    purchase_id   TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id    TEXT REFERENCES products(id) ON DELETE SET NULL,
    product_name  TEXT NOT NULL, -- snapshot at time of purchase, survives product edits/deletion
    unit_price    NUMERIC(10, 2) NOT NULL,
    quantity      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items (purchase_id);

-- Real product ratings (mobile mockup shows star ratings on every
-- product card — this makes them genuine rather than fabricated
-- numbers). A customer can only review a product they actually bought
-- (checked in server.js), one review per product per customer.
CREATE TABLE IF NOT EXISTS product_reviews (
    id          TEXT PRIMARY KEY,
    product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id ON product_reviews (product_id);

-- Vendor-level reviews — separate from product_reviews above. A
-- product review rates one dish/item; this rates the store or
-- restaurant as a whole (service, overall experience). Verified-
-- purchase gated the same way product reviews are (see
-- hasCustomerPurchasedFromVendor), one review per (vendor, customer)
-- so a repeat customer updates their existing review instead of
-- stacking a new one every order.
CREATE TABLE IF NOT EXISTS vendor_reviews (
    id          TEXT PRIMARY KEY,
    vendor_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (vendor_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_vendor_reviews_vendor_id ON vendor_reviews (vendor_id);

-- Real wishlist — one row per (customer, product) they've saved.
CREATE TABLE IF NOT EXISTS wishlist_items (
    id          TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_customer_id ON wishlist_items (customer_id);

-- Real saved addresses — customers can keep a few labeled delivery
-- addresses (e.g. "Home", "Office") instead of typing one at checkout
-- every time. Only one can be the default per customer, enforced in
-- application logic (unset the others, then set the new one) rather
-- than a DB constraint, since "exactly one default, or none" is easier
-- to express that way than as a partial unique index.
CREATE TABLE IF NOT EXISTS saved_addresses (
    id          TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    address     TEXT NOT NULL,
    is_default  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_addresses_customer_id ON saved_addresses (customer_id);
-- saved_addresses.zone_id (a FK to delivery_zones) is added further
-- down in this file, right after delivery_zones itself is created —
-- delivery_zones doesn't exist yet at this point on a truly fresh
-- database, and db.init() runs this whole file as one batched query
-- (see db.js), where Postgres implicitly wraps multiple statements in
-- one transaction: a FK referencing a not-yet-existing table here
-- would fail and roll back everything in the batch, not just this one
-- statement. Search this file for "ALTER TABLE saved_addresses ADD COLUMN IF NOT EXISTS zone_id".

-- Real in-app messaging between a customer and a vendor. One
-- conversation per (customer, vendor) pair — reused for every future
-- exchange between the same two people rather than starting a new
-- thread each time.
CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vendor_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, vendor_id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_customer_id ON conversations (customer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_vendor_id ON conversations (vendor_id);

CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id, created_at);

-- Real vendor promotions — a percentage discount on one of the
-- vendor's own products, active for a real date range. Capped at 90%
-- as a sanity guard rail (not a business rule, just a safeguard
-- against an obvious data-entry mistake like typing 100 by accident).
-- "Deals" (customer-facing) is just the set of products with a
-- currently-active row here — same data, two views.
CREATE TABLE IF NOT EXISTS promotions (
    id               TEXT PRIMARY KEY,
    vendor_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    discount_percent NUMERIC(5,2) NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 90),
    starts_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at          TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promotions_product_id ON promotions (product_id);
CREATE INDEX IF NOT EXISTS idx_promotions_vendor_id ON promotions (vendor_id);

-- Real high-intent buyer interaction tracking for vendors. buyer_id is
-- nullable — a guest can trigger PHONE_CLICK (viewing a vendor's
-- contact info doesn't require an account); every other type here
-- currently requires login, so those always have a buyer_id.
CREATE TABLE IF NOT EXISTS leads (
    id         TEXT PRIMARY KEY,
    vendor_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    buyer_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    type       TEXT NOT NULL CHECK (type IN ('PHONE_CLICK', 'MESSAGE_SENT', 'QUOTE_REQUEST', 'CHECKOUT_STARTED')),
    status     TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'CONVERTED', 'ARCHIVED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leads_vendor_id ON leads (vendor_id, created_at DESC);

-- Physical address, optional — powers a real "Get Directions" feature
-- (a plain Google Maps search-query link, no API key needed). NULL
-- until filled in via Settings (or registration). Originally
-- vendor-only ("store address"); also used by delivery_company
-- accounts as their company/home-base address once self-service
-- delivery-zone selection was added (see delivery_zone_id below) —
-- kept the column name rather than renaming it, since renaming would
-- touch every existing reference to `storeAddress` for no behavior
-- change; the meaning is "this account's physical location," which
-- fits both roles.
ALTER TABLE users ADD COLUMN IF NOT EXISTS store_address TEXT;

-- Restaurants as a real vendor type, not a separate table/entity — a
-- restaurant IS a vendor (role = 'vendor'), just one that sells food.
-- Its dishes are ordinary rows in products (already supports name,
-- price, image, stock, category), so the entire existing
-- create/edit/order/review/Q&A pipeline works for a restaurant's menu
-- with zero duplication. This column only distinguishes how a vendor
-- is labeled and surfaced on the storefront (Popular Restaurants vs
-- Popular Stores) — it changes no permissions or data model.
ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_type TEXT NOT NULL DEFAULT 'store' CHECK (vendor_type IN ('store', 'restaurant'));

-- Real, vendor-supplied estimate — set by a restaurant vendor in their
-- own Settings (see PUT /api/me/profile), never fabricated by the
-- platform. NULL until a restaurant fills it in, matching store_address's
-- own "unset until the vendor sets it" pattern above. Only meaningful
-- for vendor_type = 'restaurant', but not DB-constrained to that (a
-- vendor could flip type later without losing data already entered).
ALTER TABLE users ADD COLUMN IF NOT EXISTS avg_prep_time_minutes INTEGER;

-- Real profile photo, any role — stored as a data URL like the
-- business logo already is (see MAX_PROFILE_IMAGE_BYTES in server.js
-- for the size cap enforced on upload).
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url TEXT;

-- Real account suspension, any role — separate concept from
-- approval_status (a rejected vendor never got approved; a disabled
-- account was working fine and is now being suspended). Login is
-- blocked while true; disabling also bumps token_version so any
-- already-logged-in session is invalidated immediately, not just new
-- login attempts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT false;

-- Granular per-feature permission control — Super Admin cutting off
-- specific capabilities for a Manage Agent account, separate from
-- disabling the whole account above. Deliberately excludes personal
-- account security actions (change own password/email, view own
-- login history) — those stay controllable by the account holder no
-- matter what, since stripping them away could otherwise be used to
-- prevent someone from securing their own account. Values are feature
-- keys like 'fleet', 'expenses', 'business_settings', etc. — see the
-- FEATURE_KEYS list in server.js for the authoritative set.
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_features TEXT[] NOT NULL DEFAULT '{}';

-- Real "follow a store" — same pattern as wishlist_items, just for
-- stores instead of products.
CREATE TABLE IF NOT EXISTS store_follows (
    id          TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vendor_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, vendor_id)
);
CREATE INDEX IF NOT EXISTS idx_store_follows_customer_id ON store_follows (customer_id);
CREATE INDEX IF NOT EXISTS idx_store_follows_vendor_id ON store_follows (vendor_id);

-- ============================================================
-- Commission & payout tracking (Super Admin) — real, calculated from
-- actual purchase/order data, not fabricated display numbers. Two
-- concepts, deliberately kept separate:
--   - a commission RATE (percent): how much of a vendor's or delivery
--     company's revenue the platform keeps. Configurable globally,
--     with an optional per-account override.
--   - a payout: a real, recorded event of the platform actually
--     paying a vendor/delivery company their net share for a given
--     period. Recording one is how Super Admin marks money as paid;
--     nothing here moves real money — this is a ledger, same spirit
--     as expenses/price_presets elsewhere in this file.
-- ============================================================

-- Single-row table, same pattern as `settings` above.
CREATE TABLE IF NOT EXISTS platform_settings (
    id                              TEXT PRIMARY KEY DEFAULT 'platform',
    marketplace_commission_percent  NUMERIC(5,2) NOT NULL DEFAULT 10,
    delivery_commission_percent     NUMERIC(5,2) NOT NULL DEFAULT 15,
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Master on/off switches, one per recipient type, independent of the
-- configured percentage above — Super Admin can flip commission off
-- (e.g. during a promo period) without losing the rate they had
-- configured, then flip it back on later without re-entering it.
-- When a switch is off, that recipient type's effective commission
-- rate is treated as 0% everywhere it's calculated (see
-- db.getPayoutSummary), regardless of any per-account override.
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS marketplace_commission_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS delivery_commission_enabled    BOOLEAN NOT NULL DEFAULT true;

-- Optional per-account override — NULL means "use the platform
-- default above". Only meaningful for role = 'vendor' (marketplace)
-- or role = 'delivery_company' (delivery) accounts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_rate_override NUMERIC(5,2);

-- A real, recorded payout event. gross/commission/net are snapshotted
-- at the time it's recorded (not recalculated later), so a later
-- platform commission-rate change never silently rewrites a payout
-- that's already gone out in real life.
CREATE TABLE IF NOT EXISTS payouts (
    id                TEXT PRIMARY KEY,
    recipient_type    TEXT NOT NULL CHECK (recipient_type IN ('vendor', 'delivery_company')),
    recipient_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_start      TIMESTAMPTZ NOT NULL,
    period_end        TIMESTAMPTZ NOT NULL,
    gross_amount      NUMERIC(10, 2) NOT NULL,
    commission_rate   NUMERIC(5, 2) NOT NULL,
    commission_amount NUMERIC(10, 2) NOT NULL,
    net_amount        NUMERIC(10, 2) NOT NULL,
    notes             TEXT,
    created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payouts_recipient_id ON payouts (recipient_id, created_at DESC);

-- ============================================================
-- Audit log — a real, append-only record of sensitive Super Admin
-- actions (approvals, disables, permission/commission changes,
-- payouts, account edits). The app never updates or deletes rows
-- here — that's the whole point of an audit trail.
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id           TEXT PRIMARY KEY,
    actor_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
    actor_name   TEXT NOT NULL,
    actor_role   TEXT NOT NULL,
    action       TEXT NOT NULL,
    target_type  TEXT,
    target_id    TEXT,
    target_label TEXT,
    details      JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON audit_log (actor_id, created_at DESC);

-- ============================================================
-- Platform-wide settings — extends the single-row platform_settings
-- table above (commission rates) with the remaining "there's nowhere
-- to set this" gaps: a default delivery fee (a suggested starting
-- amount, not enforced — admins can still enter any amount when
-- accepting an order), a free-text description of the service area
-- shown to guests/customers, and a real maintenance-mode switch.
-- maintenance_mode is enforced server-side (blocks new order/purchase
-- creation for everyone except super_admin — see server.js) and is
-- exposed publicly via GET /api/config, unauthenticated, same as
-- privacyPolicy/termsOfService already are, so guests see the
-- maintenance banner before ever logging in.
-- ============================================================
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS default_delivery_fee NUMERIC(10, 2);
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS service_area TEXT;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS maintenance_message TEXT;

-- Flat platform service fee, charged on top of a delivery order's
-- amount or a marketplace purchase's total_amount — real ONLib
-- platform revenue, deliberately kept in its own column rather than
-- folded into amount/total_amount, so it never inflates a vendor's or
-- delivery company's gross revenue (and therefore their commission —
-- see getPayoutSummary) or a daily/monthly delivery report. Editable
-- by Super Admin via the same Platform Settings panel as
-- default_delivery_fee above; publicly exposed via GET /api/config so
-- the fee is visible before checkout, same reasoning as
-- default_delivery_fee.
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS service_fee NUMERIC(6, 2) NOT NULL DEFAULT 0.10;

-- Snapshotted onto each order/purchase at the moment money is
-- actually quoted (order acceptance / marketplace checkout) — same
-- "never recalculated later" reasoning as payouts.commission_rate,
-- so a later change to platform_settings.service_fee never silently
-- rewrites what a customer was already charged.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_fee NUMERIC(6, 2);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS service_fee NUMERIC(6, 2) NOT NULL DEFAULT 0;

-- ============================================================
-- Commission Statement (invoice) presentation settings — Super Admin
-- editable, purely cosmetic: these two switches control whether a
-- line renders on the generated statement (and, since a hidden line
-- can't reconcile against a printed total, whether its dollar amount
-- is folded into that statement's own Balance Due). They do NOT touch
-- what's actually charged at checkout or the real standing numbers
-- getPayoutSummary already shows elsewhere — same "invoice display
-- only" distinction as the marketplace/delivery commission on/off
-- switches above are NOT: those really do zero out the charge.
-- invoice_show_momo_line only ever matters for vendor statements —
-- delivery companies never have a Mobile Money-collected line since
-- there's no real payment gateway for standalone delivery orders.
-- ============================================================
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS invoice_show_service_fee_line BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS invoice_show_momo_line BOOLEAN NOT NULL DEFAULT true;

-- Editable statement text. The three *_note columns are lightweight
-- templates — {token} placeholders (documented in the Payouts &
-- Commission panel next to each field) are substituted with the real
-- computed numbers at PDF-generation time, so Super Admin can reword
-- the explanation without losing the actual figures. Defaults match
-- the wording this feature originally shipped with, so nothing looks
-- different for anyone who hasn't touched these. The footer's
-- commission-disabled disclosure is always appended by the app after
-- whatever custom footer text is configured here — not overridable —
-- so that factual disclosure can never be accidentally edited away.
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS invoice_header_title TEXT NOT NULL DEFAULT 'Commission Statement';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS invoice_header_subtitle TEXT;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS invoice_footer_note TEXT NOT NULL DEFAULT 'Generated from real purchase/order data for the period above. Gross revenue, commission, and service fee are computed fresh each time this is generated -- if a dispute affecting this period is resolved later, regenerating this statement will reflect it.';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS invoice_commission_note TEXT NOT NULL DEFAULT '{rate}% of net gross revenue for the period above{refundClause}';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS invoice_service_fee_note TEXT NOT NULL DEFAULT '$0.10 x {feeOwedOrders} {feeType} order(s) this period';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS invoice_momo_note TEXT NOT NULL DEFAULT '$0.10 x {momoCount} Mobile Money order(s) this period -- already collected by ONLib directly at checkout';

-- ============================================================
-- Disputes — the last of the original Super Admin gaps: a real,
-- structured way for a customer to report a problem with an order and
-- for a Super Admin to resolve it, optionally with a refund.
--
-- Deliberately references EITHER a delivery order OR a marketplace
-- purchase, not always both, since either can be disputed on its own
-- (a plain sender-to-recipient delivery has no purchase at all) — the
-- CHECK constraint below just requires at least one to be set. Which
-- one is set also decides who a refund is attributed to: a
-- purchase-linked dispute nets against that purchase's vendor (see
-- getPayoutSummary in db.js), an order-only dispute nets against that
-- order's delivery company. A marketplace order that also has its own
-- linked delivery order (purchases.delivery_order_id) can only be
-- disputed via the purchase — resolving it doesn't separately dock the
-- delivery company, since the complaint in that flow is about the
-- vendor's product/fulfillment, not the delivery itself.
--
-- No update/delete on open disputes here beyond the one resolve step
-- (open -> resolved | rejected) — same "small, real, honest" shape as
-- the rejection-reason and payout features: a required explanation is
-- always shown back to the person it affects, and refund_amount is
-- only ever set alongside status = 'resolved'.
-- ============================================================
CREATE TABLE IF NOT EXISTS disputes (
    id              TEXT PRIMARY KEY,
    order_id        TEXT REFERENCES orders(id) ON DELETE SET NULL,
    purchase_id     TEXT REFERENCES purchases(id) ON DELETE SET NULL,
    customer_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category        TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('wrong_item', 'damaged', 'never_arrived', 'overcharged', 'other')),
    description     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
    resolution_note TEXT,
    refund_amount   NUMERIC(10, 2),
    resolved_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (order_id IS NOT NULL OR purchase_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_disputes_customer_id ON disputes (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes (status, created_at DESC);

-- ============================================================
-- Real product variants (color/size) + Q&A, for the desktop Product
-- Detail Page redesign. Stock stays POOLED per product, not tracked
-- per variant — checkout() already decrements a single
-- products.stock_quantity inside one FOR UPDATE transaction, and a
-- full variant/SKU stock matrix would be a much bigger rewrite than
-- what a color/size picker actually needs. colors/sizes/size_chart are
-- vendor-authored option lists on the product itself; the customer's
-- pick is only ever SNAPSHOTTED onto the purchase line item (same
-- reasoning as purchase_items.product_name already snapshotting the
-- name), never turned into separate inventory pools.
-- ============================================================

-- [{name, imageDataUrl?}], NULL/empty = no color variants (PDP hides
-- the picker entirely and behaves exactly as it does today).
ALTER TABLE products ADD COLUMN IF NOT EXISTS colors JSONB;
-- [string], NULL/empty = no size variants.
ALTER TABLE products ADD COLUMN IF NOT EXISTS sizes JSONB;
-- {headers: [string], rows: [[string]]} — freeform, vendor-editable
-- measurement table (not hardcoded to apparel), capped 6 cols x 10
-- rows (enforced server-side). NULL = no size chart, PDP just doesn't
-- render that section.
ALTER TABLE products ADD COLUMN IF NOT EXISTS size_chart JSONB;

-- What the customer actually picked, snapshotted the same way
-- product_name already is — survives the product's colors/sizes list
-- changing or the product being deleted later.
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS selected_color TEXT;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS selected_size TEXT;

-- Real Q&A on a product page. Any logged-in customer can ask; only the
-- product's own vendor can answer (simpler than open peer-answering,
-- and consistent with vendors already being responsible for their own
-- listings elsewhere in this app). asker_name is snapshotted for the
-- same reason product_name/business_name snapshots exist elsewhere —
-- a later account rename shouldn't retroactively change old Q&A.
CREATE TABLE IF NOT EXISTS product_questions (
    id           TEXT PRIMARY KEY,
    product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    asker_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asker_name   TEXT NOT NULL,
    question     TEXT NOT NULL,
    answer       TEXT,
    answered_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_questions_product_id ON product_questions (product_id, created_at DESC);

-- ============================================================
-- Featured Placements — a vendor pays to boost a specific product or
-- their whole storefront's ranking in listings for a limited window.
-- featured_until on products/users is the SOURCE OF TRUTH for "is this
-- currently featured" everywhere it's ranked/rendered — always a plain
-- timestamp compare against now(), deliberately not a background job
-- flipping a status flag, since this app has no persistent scheduler
-- (a Node-process timer would reset on every Railway restart/sleep).
-- featured_slots is the purchase/audit trail behind that timestamp.
-- ============================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ;
-- Vendor-level "featured" — there's no customer-facing vendor
-- directory in this app, so featuring a whole storefront works by
-- boosting every one of that vendor's products in listings (with a
-- distinct "Featured Store" badge), rather than a dedicated page.
ALTER TABLE users ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ;

-- Super-Admin-configurable packages and slot caps, same single-row
-- platform_settings pattern as commission rates / service fee above.
-- Packages are JSONB arrays of {id, label, days, price} — separate
-- lists for 'product' vs 'vendor' scope since they're different value
-- propositions and likely priced differently. Slot caps are the hard
-- concurrent-featured ceiling per scope (first-come-first-served —
-- once full, purchasing is blocked until a slot frees up on expiry).
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS featured_product_packages JSONB NOT NULL DEFAULT '[{"id":"p7","label":"7 days","days":7,"price":5},{"id":"p30","label":"30 days","days":30,"price":15}]';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS featured_vendor_packages JSONB NOT NULL DEFAULT '[{"id":"v7","label":"7 days","days":7,"price":20},{"id":"v30","label":"30 days","days":30,"price":60}]';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS featured_product_slot_cap INTEGER NOT NULL DEFAULT 10;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS featured_vendor_slot_cap INTEGER NOT NULL DEFAULT 5;

-- One row per purchase attempt. payment_status follows the exact same
-- pending/successful/failed vocabulary as purchases.payment_status —
-- for 'momo' it's flipped automatically by the poll/webhook path
-- (mirroring the marketplace checkout momo flow exactly); for
-- 'direct' it's flipped manually by a Super Admin confirming or
-- rejecting a real-world payment (cash/bank transfer), the same
-- "manual reconciliation" pattern this app already leans on for COD.
-- A 'pending' row (of either payment method) counts against the
-- scope's slot cap immediately, so two vendors can't both reserve the
-- last slot before either payment resolves; see db.js's use of
-- pg_advisory_xact_lock around every capacity check for the race-
-- safety this relies on. package_label/price/duration_days are
-- snapshotted at purchase time — a later change to the configured
-- packages above never rewrites what an already-active slot cost or
-- how long it runs.
CREATE TABLE IF NOT EXISTS featured_slots (
    id                TEXT PRIMARY KEY,
    vendor_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope             TEXT NOT NULL CHECK (scope IN ('product', 'vendor')),
    product_id        TEXT REFERENCES products(id) ON DELETE CASCADE,
    package_label     TEXT NOT NULL,
    price             NUMERIC(10, 2) NOT NULL,
    duration_days     INTEGER NOT NULL,
    payment_method    TEXT NOT NULL CHECK (payment_method IN ('momo', 'direct')),
    payment_status    TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'successful', 'failed')),
    momo_reference_id TEXT,
    momo_phone        TEXT,
    starts_at         TIMESTAMPTZ,
    ends_at           TIMESTAMPTZ,
    confirmed_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
    confirmed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (scope = 'vendor' OR product_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_featured_slots_vendor_id ON featured_slots (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_featured_slots_scope_status ON featured_slots (scope, payment_status);

-- ============================================================
-- Premium subscription tier — an account-wide, recurring upgrade for
-- vendors (Free is the implicit default: no row in vendor_subscriptions,
-- or a lapsed/canceled one). Deliberately separate from featured_slots
-- above: Featured Placement stays open to every vendor as a pay-per-
-- boost purchase; Premium just makes that cheaper/free as one of
-- several perks (see platform_settings.premium_featuring_perk below),
-- alongside PDF report access, a lower commission rate, and a
-- "priority support" badge. Premium never sets featured_until directly
-- — it only affects what a featured_slots purchase costs.
--
-- Same "no persistent scheduler" constraint as Featured Placements
-- (Railway can restart/sleep the single Node process), and the same
-- lack of a stored-credential charge in the MoMo integration (every
-- charge needs a fresh phone approval — see server/momo.js). So there
-- is no silent auto-renewal: current_period_end is the live source of
-- truth for "is this vendor Premium right now" (now() < current_period
-- _end), and a best-effort hourly reminder (see the server-side
-- scheduler in server.js) nudges the vendor to renew before it lapses.
--
-- Premium was previously also grantable for free by a Super Admin
-- (source = 'admin_comp', a NULL current_period_end meaning indefinite)
-- — removed platform-wide (see the "Free Premium removed entirely"
-- README section): ending a grant only ever changed its dates, never
-- its `status`, so a vendor's own Premium status card could get
-- permanently stuck reading "Free — granted by ONLib" even after the
-- grant had genuinely expired. Premium is paid-subscription-only now.
-- `source` still allows the historical value ('paid', 'admin_comp') so
-- any pre-existing admin_comp row keeps its true origin rather than
-- being rewritten to look like a payment that never happened — see the
-- one-time cleanup UPDATE below this table, which force-cancels any
-- admin_comp row still marked active so it stops granting Premium.
-- ============================================================

-- Super-Admin-configured Premium tiers. Deliberately a real table (not
-- a JSONB array on platform_settings like the Featured Placement
-- packages) because a live vendor_subscriptions row references a
-- plan_id — editing a plan's price later must never rewrite what an
-- already-subscribed vendor agreed to pay.
CREATE TABLE IF NOT EXISTS subscription_plans (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    cycle_days INTEGER NOT NULL CHECK (cycle_days > 0),
    price      NUMERIC(10, 2) NOT NULL,
    is_active  BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per vendor (at most one ACTIVE row at a time, enforced by
-- the partial unique index below). plan_id is NULL for an admin comp
-- (there's no plan being paid for). featured_boost_credits_remaining
-- is the "free credit" perk's balance for the current billing period
-- (see premium_featuring_perk) — reset to 1 on every subscribe/renew,
-- regardless of whether the platform is currently using the credit or
-- discount perk mode, so switching modes never has to reconcile a
-- stale balance. reminder_sent_at tracks the last time a renewal
-- reminder went out; comparing it against current_period_start (not
-- just "was it ever sent") is what lets the reminder re-fire once per
-- billing period without a separate scheduled-job table.
CREATE TABLE IF NOT EXISTS vendor_subscriptions (
    id                             TEXT PRIMARY KEY,
    vendor_id                      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id                        TEXT REFERENCES subscription_plans(id) ON DELETE SET NULL,
    status                         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled')),
    source                         TEXT NOT NULL CHECK (source IN ('paid', 'admin_comp')),
    current_period_start           TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_period_end             TIMESTAMPTZ,
    featured_boost_credits_remaining INTEGER NOT NULL DEFAULT 0,
    reminder_sent_at               TIMESTAMPTZ,
    granted_by                     TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (source = 'admin_comp' OR plan_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_subscriptions_one_active_per_vendor
    ON vendor_subscriptions (vendor_id) WHERE status = 'active';

-- Was: CHECK (source = 'paid' OR current_period_end IS NULL) — an
-- admin-comp (free) grant used to be indefinite by definition, with no
-- end date allowed at all. Super Admin can now set a real start/end
-- date range on a free grant too (an optional end date — NULL still
-- means indefinite, same as before), so that restriction no longer
-- holds. CREATE TABLE IF NOT EXISTS above won't touch an
-- already-existing table's constraints, so this drops it explicitly
-- for databases created before this change (the Postgres-assigned
-- default name for the first unnamed table-level CHECK is
-- `<table>_check` — confirmed against a real Postgres instance, not
-- guessed).
ALTER TABLE vendor_subscriptions DROP CONSTRAINT IF EXISTS vendor_subscriptions_check;

-- One-time cleanup for the "Free Premium removed entirely" change: force-
-- cancel any admin_comp grant still marked active. The application no
-- longer has any route or UI that creates, edits, or revokes an
-- admin_comp row, so without this, a vendor granted free Premium before
-- this change would keep it forever with no way to end it. Runs on every
-- boot (schema.sql is executed in full on every db.init(), see db.js) but
-- is naturally idempotent — once a row is canceled here, this WHERE
-- clause never matches it again.
UPDATE vendor_subscriptions SET status = 'canceled', updated_at = now()
    WHERE source = 'admin_comp' AND status = 'active';

-- Payment audit trail per subscribe/renew attempt, same pending/
-- successful/failed vocabulary and momo/direct split as featured_slots
-- (and purchases.payment_status before that) — the one payment-status
-- state machine this whole app uses everywhere real money changes
-- hands. price is snapshotted at charge time for the same reason
-- featured_slots.price is: a later plan price edit never rewrites
-- history.
CREATE TABLE IF NOT EXISTS subscription_charges (
    id                TEXT PRIMARY KEY,
    subscription_id   TEXT NOT NULL REFERENCES vendor_subscriptions(id) ON DELETE CASCADE,
    price             NUMERIC(10, 2) NOT NULL,
    payment_method    TEXT NOT NULL CHECK (payment_method IN ('momo', 'direct')),
    payment_status    TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'successful', 'failed')),
    momo_reference_id TEXT,
    momo_phone        TEXT,
    confirmed_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
    confirmed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscription_charges_subscription_id ON subscription_charges (subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_charges_status ON subscription_charges (payment_method, payment_status);
CREATE INDEX IF NOT EXISTS idx_vendor_subscriptions_vendor_id ON vendor_subscriptions (vendor_id, created_at DESC);

-- One row per renewal reminder actually sent (see runPremiumReminderScan in
-- server.js) — exists purely so the Super Admin Overview can show a real
-- "reminders sent this week" count instead of an invented one. subscription_id
-- is nullable (ON DELETE SET NULL) so the count survives a subscription later
-- being deleted; sent_at is what the "this week" window filters on.
CREATE TABLE IF NOT EXISTS premium_reminder_log (
    id              TEXT PRIMARY KEY,
    vendor_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id TEXT REFERENCES vendor_subscriptions(id) ON DELETE SET NULL,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_premium_reminder_log_sent_at ON premium_reminder_log (sent_at DESC);

-- Platform-wide Premium configuration, same single-row platform_settings
-- pattern as commission rates and the Featured Placement packages above.
-- premium_featuring_perk picks which of the two Featured Placement
-- perks (discussed with the Super Admin) is currently live — only one
-- is active at a time, switchable without losing the other's config:
--   'credit'   — each billing period includes 1 free boost (redeemed
--                via the existing featured/purchase flow at price 0).
--   'discount' — every featured_slots purchase is discounted by
--                premium_featuring_discount_percent while Premium is
--                active, no redemption step, unlimited uses.
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS premium_commission_percent NUMERIC(5,2) NOT NULL DEFAULT 5;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS premium_reminder_lead_days INTEGER NOT NULL DEFAULT 3;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS premium_featuring_perk TEXT NOT NULL DEFAULT 'credit'
    CHECK (premium_featuring_perk IN ('credit', 'discount'));
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS premium_featuring_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 20
    CHECK (premium_featuring_discount_percent >= 0 AND premium_featuring_discount_percent <= 100);

-- ============================================================
-- Coupon codes (cart-level, vendor-scoped) — each vendor creates their
-- own discount codes for their own store, the same self-service pattern
-- as their existing per-product Promotions feature above. Checkout in
-- this app is always single-vendor (see the purchases.vendor_id comment
-- above), so a code only ever needs to be scoped to one vendor, never a
-- platform-wide/cross-vendor concept.
-- code is stored uppercase and unique PER VENDOR (not globally unique) —
-- two different vendors can both run a "SAVE10" code without collision.
-- discount_type/discount_value together express either a percent off
-- (capped 90%, same sanity rail as promotions.discount_percent) or a
-- flat dollar amount off. max_uses/uses_count is a total redemption cap
-- across all customers (NULL max_uses = unlimited); per_customer_limit
-- caps how many times one customer can reuse the same code (NULL =
-- unlimited). uses_count is only ever incremented inside the same
-- checkout transaction that actually applies the discount (see
-- db.checkout()), never client-side, so it can't be inflated by a
-- validate-only call.
CREATE TABLE IF NOT EXISTS coupons (
    id                  TEXT PRIMARY KEY,
    vendor_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,
    discount_type       TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
    discount_value      NUMERIC(10, 2) NOT NULL CHECK (discount_value > 0),
    min_order_amount    NUMERIC(10, 2),
    max_uses            INTEGER,
    per_customer_limit  INTEGER,
    uses_count          INTEGER NOT NULL DEFAULT 0,
    starts_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at             TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (discount_type != 'percent' OR discount_value <= 90),
    UNIQUE (vendor_id, code)
);
CREATE INDEX IF NOT EXISTS idx_coupons_vendor_id ON coupons (vendor_id);

-- One row per (coupon, customer) redemption — how per_customer_limit is
-- actually enforced (COUNT of rows here, not a guess), and gives a
-- vendor a real redemption history per code rather than just the
-- aggregate uses_count.
CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id          TEXT PRIMARY KEY,
    coupon_id   TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_id ON coupon_redemptions (coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_customer_id ON coupon_redemptions (customer_id, coupon_id);

-- Real applied-discount tracking on the purchase itself — coupon_id is
-- nullable (ON DELETE SET NULL) so a purchase record survives a vendor
-- later deleting the code; discount_amount is a real dollar snapshot
-- (never recomputed from the coupon's current value later, same
-- snapshot reasoning as purchase_items.product_name).
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS coupon_id TEXT REFERENCES coupons(id) ON DELETE SET NULL;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS coupon_code TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0;

-- Real per-variant stock, additive to the existing pooled products.stock_quantity
-- model — only created/populated for products that actually declare colors/sizes
-- (see products.colors/products.sizes above). Empty-string sentinels ('' via
-- NOT NULL DEFAULT '') are used instead of NULL for the unused dimension
-- (e.g. a color-only product has size='' on every row) specifically so the
-- UNIQUE constraint below actually enforces uniqueness at the DB level —
-- Postgres treats NULL as distinct-from-everything in unique indexes, so a
-- NULL-based version of this constraint would silently allow duplicate rows.
-- products.stock_quantity is kept as a transactionally-synced SUM of a
-- product's variant rows whenever variants exist, so every other stock-reading
-- code path in the app (storefront filters, low-stock alerts, PDP badges,
-- related-product queries) continues to work unchanged.
CREATE TABLE IF NOT EXISTS product_variants (
    id              TEXT PRIMARY KEY,
    product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    color           TEXT NOT NULL DEFAULT '',
    size            TEXT NOT NULL DEFAULT '',
    stock_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, color, size)
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants (product_id);

-- ============================================================
-- Round: Delivery agent ratings + tipping, self-service returns,
-- scheduled/recurring orders, live support chat, push notifications,
-- and a real (rebuilt-from-scratch) two-factor authentication.
-- ============================================================

-- A real, collision-safe link from an order to the agent who accepted
-- it. orders.accepted_by (above) is a permanent free-text NAME
-- snapshot — useful for display, but two agents (even across two
-- different companies) can share a name, so it was never safe to key
-- a rating off it. agent_id is populated going forward by
-- acceptOrderAtomic from the same already-resolved `agent` record the
-- accept handler uses for its own ownership check — see server.js.
-- Orders accepted before this column existed keep agent_id NULL;
-- there's no reliable way to backfill which specific agent a historic
-- free-text name actually referred to, so those orders simply aren't
-- rateable, rather than guessing.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL;

-- Optional tip, entered by the sender from the same "Rate your
-- delivery" prompt as the agent rating below (see the frontend's
-- rate-and-tip modal). Kept as its own column, separate from `amount`
-- (the delivery fee amount == the commission basis) — a tip is not
-- commissionable, so it's surfaced for visibility on the order but
-- deliberately NOT folded into the existing commission/payout
-- calculations (see the payout summary comment in db.js), which this
-- round didn't touch.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(10, 2);

-- One rating per delivered order (not one per agent-customer pair like
-- product_reviews/vendor_reviews) — a sender may use the same agent
-- for many separate deliveries and should be able to rate each one.
CREATE TABLE IF NOT EXISTS agent_reviews (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_reviews_agent_id ON agent_reviews (agent_id);

-- Self-service returns — distinct from the existing disputes table
-- (disputes are the "something went wrong, Super Admin adjudicates"
-- path; a return is the customer-initiated "I want to send this back"
-- path on a purchase that otherwise arrived fine). One open request
-- per purchase at a time; the vendor reviews it directly, no Super
-- Admin step. refund_amount here is the same kind of real bookkeeping
-- record disputes.refund_amount already is (see resolveDispute in
-- db.js) — there's no payment gateway integrated yet to actually
-- reverse a charge, only Mobile Money collections, so both this and
-- the existing dispute refund path record the decision rather than
-- move real money.
CREATE TABLE IF NOT EXISTS return_requests (
    id            TEXT PRIMARY KEY,
    purchase_id   TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    customer_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vendor_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason        TEXT NOT NULL,
    description   TEXT,
    status        TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'refunded')),
    vendor_note   TEXT,
    refund_amount NUMERIC(10, 2),
    resolved_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (purchase_id)
);
CREATE INDEX IF NOT EXISTS idx_return_requests_vendor_id ON return_requests (vendor_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_customer_id ON return_requests (customer_id);

-- Scheduled/recurring "Send a Package" orders. A scheduled order is
-- created with status='scheduled' (NOT 'pending') so it's invisible
-- to getPendingOrders()/the live delivery-company accept queue until
-- its time comes; a periodic sweep (see server.js) promotes it to
-- 'pending' once scheduled_for is due, exactly like the app's
-- existing periodic sweeps for Premium renewal reminders and
-- low-stock checks. A recurring order re-schedules a fresh copy of
-- itself, recurrence cycles ahead, at the moment the current one gets
-- promoted — a simple, real mechanism, not a general-purpose cron.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recurrence TEXT CHECK (recurrence IN ('daily', 'weekly'));

-- Live in-app support chat — a platform support channel, distinct
-- from the existing vendor<->customer conversations/messages tables
-- (those require a vendor_id and are scoped to one vendor's own
-- customers; support has neither). One thread per user account,
-- staffed by any admin/super_admin — sender_role distinguishes who
-- wrote each message within that single thread.
CREATE TABLE IF NOT EXISTS support_messages (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('user', 'support')),
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_support_messages_user_id ON support_messages (user_id, created_at);

-- Real Web Push (VAPID) subscriptions — no third-party account
-- required, unlike Firebase Cloud Messaging. One row per browser/
-- device a person has granted push permission on; a user can have
-- several (phone + laptop, etc).
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    TEXT NOT NULL UNIQUE,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions (user_id);

-- Two-factor authentication, rebuilt from scratch (see README — this
-- was built and then deliberately removed twice before, both times
-- because it added unwanted login friction; this round's explicit
-- instruction was "remove all of the old ones and build it for real
-- this time", scoped to SMS via the existing Twilio integration, for
-- any role that opts in). Same code/hash/expiry shape as the existing
-- password_resets table, kept as its own table since it's a distinct
-- concern (a login-time challenge, not a password-recovery flow).
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS two_factor_challenges (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_two_factor_challenges_user_id ON two_factor_challenges (user_id);
-- Single-use, same reasoning as password_resets.used — a code that's
-- already been redeemed (for login, or to confirm enabling 2FA) must
-- not work a second time even if it hasn't expired yet.
ALTER TABLE two_factor_challenges ADD COLUMN IF NOT EXISTS used BOOLEAN NOT NULL DEFAULT false;

-- Mobile Money providers for the manual/reference-code checkout flow
-- (see POST /api/marketplace/checkout/momo-manual) — Super-Admin-
-- managed, so a new provider (or a changed receiving number) doesn't
-- need a code deploy. Each provider has its OWN receiving phone
-- number: the old design sent every provider's payment to one shared
-- settings.business_phone number regardless of which network the
-- customer actually chose, which silently broke any provider that
-- wasn't on that number's network. sort_order controls display order
-- in the checkout radio list; is_enabled lets a Super Admin take a
-- provider offline (e.g. their line is down) without deleting its
-- history — a purchase already made through it keeps its
-- payment_provider value regardless.
CREATE TABLE IF NOT EXISTS momo_providers (
    id          TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    phone       TEXT NOT NULL,
    is_enabled  BOOLEAN NOT NULL DEFAULT true,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Seeds the two providers the app already had hardcoded, using the
-- existing shared business phone as both their starting numbers so
-- checkout doesn't go from "works (wrong number)" to "no providers at
-- all" the moment this migration runs — a Super Admin can then correct
-- each one to its real number from the new management UI.
INSERT INTO momo_providers (id, label, phone, sort_order)
SELECT 'orange_money', 'Orange Money', COALESCE((SELECT business_phone FROM settings WHERE id = 'business'), '+231880465612'), 1
WHERE NOT EXISTS (SELECT 1 FROM momo_providers WHERE id = 'orange_money');
INSERT INTO momo_providers (id, label, phone, sort_order)
SELECT 'lonestar_mtn', 'Lonestar Cell MTN', COALESCE((SELECT business_phone FROM settings WHERE id = 'business'), '+231880465612'), 2
WHERE NOT EXISTS (SELECT 1 FROM momo_providers WHERE id = 'lonestar_mtn');

-- Vendor-directed dispatch — a vendor can point a ready-for-delivery
-- marketplace order at a specific delivery company as a preference,
-- WITHOUT pulling it out of the open pending-orders pool (any company
-- can still accept it first — see acceptOrderAtomic, unchanged). This
-- is purely a "please look at this one" signal: requested_delivery_
-- company_id doesn't restrict who CAN accept, it's read by the
-- targeted company's UI to highlight/prioritize that order and by a
-- targeted push notification. Sortable by dispatch_requested_at
-- because a vendor's own Orders tab needs to show "just now" vs.
-- "sent 2 hours ago, still not picked up" at a glance.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS requested_delivery_company_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispatch_requested_at TIMESTAMPTZ;

-- Vendor-requested cancellation of a not-yet-confirmed Mobile Money
-- purchase — scoped to purchases (not orders), because a Mobile Money
-- purchase's delivery order doesn't exist yet at this stage (see
-- confirmMomoPaymentAndCreateOrder — the order is only created once a
-- Super Admin confirms payment). This is deliberately NOT a new status
-- enum or a separate approval queue: it's a flag read by the exact
-- same Super Admin "Mobile Money Payments" confirm/reject queue that
-- already exists — Reject already does everything "approve the
-- vendor's cancellation" needs (voids payment, restocks items);
-- Confirm already does everything "deny the vendor's cancellation and
-- proceed anyway" needs. One flag, zero new admin UI surface, one
-- existing decision point.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS vendor_cancel_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS vendor_cancel_reason TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS vendor_cancel_requested_at TIMESTAMPTZ;

-- Once a Mobile Money payment is REJECTED (payment_status = 'failed'),
-- the decision is already final — nothing for a Super Admin to
-- re-approve. A vendor can dismiss that dead record from their own
-- Orders view/stats without another approval round-trip; the row
-- itself is kept (audit trail, matches how nothing else in this app
-- hard-deletes purchase history), just hidden from that vendor's own
-- list. Scoped to payment_status = 'failed' only in every query that
-- uses this — a vendor can never dismiss a live/pending/successful
-- order this way.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS vendor_dismissed BOOLEAN NOT NULL DEFAULT false;

-- Delivery Zones — Super-Admin-defined (name + flat fee), each vendor
-- assigned to one. This is a deliberate, honest substitute for real
-- geolocation: this app has no paid geo/mapping service (see the
-- login_history comment elsewhere in this file for the same
-- reasoning), so "zone" is real structured data an admin assigns, not
-- something inferred from coordinates this app doesn't have.
CREATE TABLE IF NOT EXISTS delivery_zones (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    fee        NUMERIC(10,2) NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Originally Super-Admin-assigned only, for role = 'vendor'. Now also
-- self-service: a vendor, delivery_company, or sender (customer) can
-- set their own "Home Base" zone from Settings/registration by
-- searching it (see the Zone Search Picker in index.html and
-- setSelfDeliveryZone in db.js) — the Super Admin's own vendor
-- assignment route/UI is unchanged and can still override it. For a
-- sender this is a single preferred zone on the user row, separate
-- from the per-address zone they can also set on each entry in their
-- saved-addresses book (see saved_addresses.zone_id below) — one
-- customer can have several addresses in different zones, but only one
-- Home Base.
ALTER TABLE users ADD COLUMN IF NOT EXISTS delivery_zone_id TEXT REFERENCES delivery_zones(id) ON DELETE SET NULL;

-- Delivery Regions — a Super-Admin-defined grouping ABOVE zones (e.g.
-- "REGION 1 — CENTRAL MONROVIA" containing zones Z01, Z03, ...). Purely
-- organizational: the delivery fee still lives on the zone, a region
-- has no fee of its own. A zone's region is optional (region_id can be
-- NULL — "Unassigned") so existing zones created before this feature
-- keep working with no region set.
CREATE TABLE IF NOT EXISTS delivery_regions (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE delivery_zones ADD COLUMN IF NOT EXISTS region_id TEXT REFERENCES delivery_regions(id) ON DELETE SET NULL;

-- Short admin-facing zone code (e.g. "Z01"), shown alongside the zone's
-- descriptive name so a bulk-imported list (see the delivery-zones
-- import route in server.js) can be re-imported later to update fees
-- without creating duplicates — the code, not the name, is the stable
-- match key. Optional/nullable (existing zones predate codes) but
-- unique when set.
ALTER TABLE delivery_zones ADD COLUMN IF NOT EXISTS code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_zones_code ON delivery_zones (code) WHERE code IS NOT NULL;

-- Optional Region/Zone tag on a saved address, set via the same Zone
-- Search Picker used for vendor/delivery_company self-service (see
-- users.delivery_zone_id's comment above). Lives on the address, not
-- on the customer, because one customer can have several saved
-- addresses ("Home", "Office") in different zones — unlike a vendor
-- or delivery company, which only has one location. Nullable: this is
-- purely descriptive metadata for now (per the current scope, it does
-- NOT feed into delivery fee calculation, which stays 100%
-- vendor-zone-driven, same as before this column existed). Placed here
-- (after delivery_zones exists), not next to the rest of
-- saved_addresses further up this file — see the comment there.
ALTER TABLE saved_addresses ADD COLUMN IF NOT EXISTS zone_id TEXT REFERENCES delivery_zones(id) ON DELETE SET NULL;

-- Real delivery fee charged to the customer at checkout — snapshotted
-- at checkout time (same "never trust a stale value later" pattern as
-- purchases.service_fee), so a zone's fee changing afterward never
-- rewrites what a customer already paid. purchases.delivery_fee is
-- the amount actually charged (added into what the customer pays);
-- orders.delivery_fee mirrors it onto the linked delivery order for
-- the delivery side of the record — separate from orders.amount
-- (the courier's payout, set independently by an Admin/agent flow
-- that predates this feature and isn't necessarily the same number).
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10,2);

-- Groups multiple purchases created from ONE multi-vendor checkout
-- action together — e.g. so a Mobile Money customer sends ONE payment
-- covering every vendor in that checkout, using ONE shared reference
-- code, instead of a separate reference per vendor. NULL for an
-- ordinary single-vendor checkout (the normal case, unaffected).
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS checkout_batch_id TEXT;
CREATE INDEX IF NOT EXISTS idx_purchases_checkout_batch_id ON purchases (checkout_batch_id) WHERE checkout_batch_id IS NOT NULL;
