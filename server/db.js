// db.js — Postgres access layer.
// Railway injects DATABASE_URL automatically when you attach a Postgres
// plugin to this service. Locally, put the same variable in server/.env.
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway's internal Postgres doesn't need SSL; its public proxy does.
  // This flag keeps both cases working without extra config.
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

function rowToOrder(r) {
  if (!r) return null;
  return {
    id: r.id,
    senderId: r.sender_id,
    senderName: r.sender_name,
    pickupAddress: r.pickup_address,
    dropoffAddress: r.dropoff_address,
    itemDescription: r.item_description,
    amount: r.amount === null ? null : Number(r.amount),
    serviceFee: r.service_fee === null || r.service_fee === undefined ? null : Number(r.service_fee),
    status: r.status,
    acceptedBy: r.accepted_by,
    paymentMethod: r.payment_method,
    placedByAdmin: r.placed_by_admin,
    createdAt: r.created_at,
    acceptedAt: r.accepted_at,
    pickedUpAt: r.picked_up_at,
    deliveredAt: r.delivered_at,
    deliveryCompanyId: r.delivery_company_id,
    // Vendor-directed dispatch preference — see schema.sql's comment on
    // orders.requested_delivery_company_id. Purely a signal, doesn't
    // restrict who can accept.
    requestedDeliveryCompanyId: r.requested_delivery_company_id || null,
    dispatchRequestedAt: r.dispatch_requested_at || null,
    // Real, collision-safe agent link (see the schema.sql comment on
    // orders.agent_id) — null for any order accepted before this
    // column existed, or one an admin accepted with no matching agent
    // record at all.
    agentId: r.agent_id || null,
    tipAmount: r.tip_amount === null || r.tip_amount === undefined ? null : Number(r.tip_amount),
    scheduledFor: r.scheduled_for || null,
    recurrence: r.recurrence || null,
    // Only present when the query joined agent_reviews (see
    // getOrdersBySender) — lets the sender's own order list know
    // whether "Rate your delivery" should still show for this order.
    ...(r.agent_review_id !== undefined ? { agentReviewId: r.agent_review_id } : {}),
    // Only present when the query joined purchases (see
    // getOrdersBySender) — a plain package-delivery order (no
    // marketplace purchase behind it) has nothing to rate, so these
    // stay undefined for it rather than null-padded.
    ...(r.purchase_vendor_id !== undefined ? {
      purchaseId: r.purchase_id,
      vendorId: r.purchase_vendor_id,
      vendorName: r.purchase_vendor_name,
    } : {}),
  };
}

function rowToExpense(r) {
  if (!r) return null;
  return {
    id: r.id,
    date: r.date,
    amount: Number(r.amount),
    description: r.description,
  };
}

function rowToAgent(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    dutyStatus: r.duty_status,
    deliveryCompanyId: r.delivery_company_id,
    // Only present when the query joined the agent_reviews aggregate
    // (see getAgentsByCompany) — an agent with zero ratings yet gets
    // null/0 here rather than a fabricated default.
    ...(r.avg_rating !== undefined ? {
      avgRating: r.avg_rating === null ? null : Number(r.avg_rating),
      reviewCount: Number(r.review_count || 0),
    } : {}),
  };
}

function rowToAgentReview(r) {
  if (!r) return null;
  return {
    id: r.id,
    agentId: r.agent_id,
    orderId: r.order_id,
    customerId: r.customer_id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.created_at,
  };
}

function rowToSupportMessage(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    senderRole: r.sender_role,
    body: r.body,
    createdAt: r.created_at,
    readAt: r.read_at,
  };
}

function rowToPricePreset(r) {
  if (!r) return null;
  return {
    id: r.id,
    label: r.label,
    amount: Number(r.amount),
  };
}

function rowToProduct(r) {
  if (!r) return null;
  return {
    id: r.id,
    vendorId: r.vendor_id,
    name: r.name,
    description: r.description,
    price: Number(r.price),
    category: r.category,
    imageDataUrl: r.image_data_url,
    stockQuantity: r.stock_quantity,
    isActive: r.is_active,
    createdAt: r.created_at,
    // pg already parses JSONB columns into real JS values — no
    // JSON.parse needed here. Normalized to [] rather than null/undefined
    // so the frontend can always safely call .length/.map on these
    // without a product having variants vs. not having them being two
    // different shapes to check for.
    colors: r.colors || [],
    sizes: r.sizes || [],
    sizeChart: r.size_chart || null,
    // Low-stock alerts — threshold is null when the vendor hasn't set
    // one (alerts off for this product). isLowStock is precomputed here,
    // same reasoning as isFeatured below, so every caller (Products tab
    // badge, Home tab summary) sees the same answer without recomputing
    // the comparison itself.
    lowStockThreshold: r.low_stock_threshold != null ? Number(r.low_stock_threshold) : null,
    isLowStock: r.low_stock_threshold != null && r.stock_quantity <= r.low_stock_threshold,
    followersNotifiedAt: r.followers_notified_at || null,
    // Featured Placements — featuredUntil is this product's own paid
    // placement (null/past = not featured). vendorFeaturedUntil only
    // appears on rows from queries that joined it in (storefront/PDP
    // listing queries below) — when present, a vendor-wide "featured
    // store" purchase boosts/badges every one of their products too,
    // since this app has no separate vendor-directory page for a
    // whole-storefront feature to live on. isFeatured/isStoreFeatured
    // are precomputed here (rather than left to the client) so every
    // caller sees the same now()-based answer.
    featuredUntil: r.featured_until || null,
    isFeatured: isFuture(r.featured_until) || isFuture(r.vendor_featured_until),
    isStoreFeatured: isFuture(r.vendor_featured_until),
  };
}

// Shared by rowToProduct/rowToUser's featured-placement fields — a
// plain timestamp compare against now(), never a stored boolean/status
// flag, since this app has no persistent background scheduler to flip
// one when a slot expires (see the schema.sql comment on featured_until).
function isFuture(ts) {
  return !!ts && new Date(ts).getTime() > Date.now();
}

// Shared id-slug helper — same rule the delivery-zone create route has
// always used inline (lowercase, non-alphanumeric runs collapsed to a
// single underscore, trimmed), now also used by the Regions/Zones bulk
// import so imported ids look the same as manually-created ones.
function slugify(text, fallback) {
  return String(text || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
}

function rowToHomeBanner(r) {
  if (!r) return null;
  return {
    id: r.id,
    position: r.position,
    eyebrow: r.eyebrow,
    headline: r.headline,
    subtext: r.subtext,
    ctaText: r.cta_text,
    ctaLink: r.cta_link,
    imageDataUrl: r.image_data_url,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToPurchase(r) {
  if (!r) return null;
  return {
    id: r.id,
    customerId: r.customer_id,
    vendorId: r.vendor_id,
    totalAmount: Number(r.total_amount),
    // The flat platform service fee charged at checkout, snapshotted
    // separately from total_amount so it's never counted as part of
    // the vendor's gross revenue (see getPayoutSummary) — grandTotal
    // is what the customer actually paid/owes.
    serviceFee: r.service_fee !== null && r.service_fee !== undefined ? Number(r.service_fee) : 0,
    // Real delivery fee, snapshotted from the vendor's assigned zone at
    // checkout time (see schema.sql's comment on delivery_zones) —
    // same "never recompute from a value that might have changed
    // since" posture as serviceFee above.
    deliveryFee: r.delivery_fee !== null && r.delivery_fee !== undefined ? Number(r.delivery_fee) : 0,
    checkoutBatchId: r.checkout_batch_id || null,
    // Real coupon discount, snapshotted at checkout (see db.checkout())
    // — never recomputed from the coupon's current settings later.
    discountAmount: r.discount_amount !== null && r.discount_amount !== undefined ? Number(r.discount_amount) : 0,
    couponCode: r.coupon_code || null,
    grandTotal: Number(r.total_amount)
      - (r.discount_amount !== null && r.discount_amount !== undefined ? Number(r.discount_amount) : 0)
      + (r.service_fee !== null && r.service_fee !== undefined ? Number(r.service_fee) : 0)
      + (r.delivery_fee !== null && r.delivery_fee !== undefined ? Number(r.delivery_fee) : 0),
    deliveryOrderId: r.delivery_order_id,
    createdAt: r.created_at,
    paymentMethod: r.payment_method,
    paymentStatus: r.payment_status,
    momoReferenceId: r.momo_reference_id,
    momoPhone: r.momo_phone,
    // 'momo_manual' fields — see the payment_method comment in
    // schema.sql. paymentProvider/paymentReference are null for every
    // other payment_method.
    paymentProvider: r.payment_provider || null,
    paymentReference: r.payment_reference || null,
    paymentConfirmedBy: r.payment_confirmed_by || null,
    paymentConfirmedAt: r.payment_confirmed_at || null,
    // See schema.sql's comment on vendor_cancel_requested — a flag the
    // vendor sets, read by the Super Admin's existing Mobile Money
    // confirm/reject queue rather than a separate approval screen.
    vendorCancelRequested: !!r.vendor_cancel_requested,
    vendorCancelReason: r.vendor_cancel_reason || null,
    vendorCancelRequestedAt: r.vendor_cancel_requested_at || null,
  };
}

function rowToSettings(r) {
  if (!r) return null;
  return {
    businessName: r.business_name,
    businessEmail: r.business_email,
    businessPhone: r.business_phone,
    businessAddress: r.business_address,
    businessDescription: r.business_description,
    logoDataUrl: r.logo_data_url,
    openingTime: r.opening_time,
    closingTime: r.closing_time,
    openDays: r.open_days || [],
    currency: r.currency,
    timezone: r.timezone,
    privacyPolicy: r.privacy_policy,
    termsOfService: r.terms_of_service,
    adminFaqs: r.admin_faqs || null,
    customerFaqs: r.customer_faqs || null,
    updatedAt: r.updated_at,
  };
}

function rowToPlatformSettings(r) {
  if (!r) return null;
  return {
    marketplaceCommissionPercent: Number(r.marketplace_commission_percent),
    deliveryCommissionPercent: Number(r.delivery_commission_percent),
    marketplaceCommissionEnabled: r.marketplace_commission_enabled !== false,
    deliveryCommissionEnabled: r.delivery_commission_enabled !== false,
    defaultDeliveryFee: r.default_delivery_fee !== null && r.default_delivery_fee !== undefined ? Number(r.default_delivery_fee) : null,
    serviceArea: r.service_area || null,
    maintenanceMode: !!r.maintenance_mode,
    maintenanceMessage: r.maintenance_message || null,
    serviceFee: Number(r.service_fee),
    invoiceShowServiceFeeLine: r.invoice_show_service_fee_line !== false,
    invoiceShowMomoLine: r.invoice_show_momo_line !== false,
    invoiceHeaderTitle: r.invoice_header_title || 'Commission Statement',
    invoiceHeaderSubtitle: r.invoice_header_subtitle || null,
    invoiceFooterNote: r.invoice_footer_note || '',
    invoiceCommissionNote: r.invoice_commission_note || '',
    invoiceServiceFeeNote: r.invoice_service_fee_note || '',
    invoiceMomoNote: r.invoice_momo_note || '',
    // Featured Placements — packages are [{id, label, days, price}];
    // pg already parses JSONB into real arrays, no JSON.parse needed.
    featuredProductPackages: r.featured_product_packages || [],
    featuredVendorPackages: r.featured_vendor_packages || [],
    featuredProductSlotCap: r.featured_product_slot_cap !== null && r.featured_product_slot_cap !== undefined ? Number(r.featured_product_slot_cap) : 10,
    featuredVendorSlotCap: r.featured_vendor_slot_cap !== null && r.featured_vendor_slot_cap !== undefined ? Number(r.featured_vendor_slot_cap) : 5,
    // Premium subscription tier — see the schema.sql comment above these
    // columns for what each controls.
    premiumCommissionPercent: Number(r.premium_commission_percent),
    premiumReminderLeadDays: r.premium_reminder_lead_days !== null && r.premium_reminder_lead_days !== undefined ? Number(r.premium_reminder_lead_days) : 3,
    premiumFeaturingPerk: r.premium_featuring_perk === 'discount' ? 'discount' : 'credit',
    premiumFeaturingDiscountPercent: Number(r.premium_featuring_discount_percent),
    updatedAt: r.updated_at,
  };
}

function rowToPayout(r) {
  if (!r) return null;
  return {
    id: r.id,
    recipientType: r.recipient_type,
    recipientId: r.recipient_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    grossAmount: Number(r.gross_amount),
    commissionRate: Number(r.commission_rate),
    commissionAmount: Number(r.commission_amount),
    netAmount: Number(r.net_amount),
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function rowToFeaturedSlot(r) {
  if (!r) return null;
  return {
    id: r.id,
    vendorId: r.vendor_id,
    scope: r.scope,
    productId: r.product_id,
    packageLabel: r.package_label,
    price: Number(r.price),
    durationDays: r.duration_days,
    paymentMethod: r.payment_method,
    paymentStatus: r.payment_status,
    momoReferenceId: r.momo_reference_id,
    momoPhone: r.momo_phone,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    confirmedBy: r.confirmed_by,
    confirmedAt: r.confirmed_at,
    createdAt: r.created_at,
  };
}

function rowToSubscriptionPlan(r) {
  if (!r) return null;
  return {
    id: r.id,
    label: r.label,
    cycleDays: r.cycle_days,
    price: Number(r.price),
    isActive: r.is_active,
    createdAt: r.created_at,
  };
}

function rowToVendorSubscription(r) {
  if (!r) return null;
  return {
    id: r.id,
    vendorId: r.vendor_id,
    planId: r.plan_id,
    status: r.status,
    source: r.source,
    currentPeriodStart: r.current_period_start,
    currentPeriodEnd: r.current_period_end || null,
    featuredBoostCreditsRemaining: r.featured_boost_credits_remaining,
    reminderSentAt: r.reminder_sent_at || null,
    grantedBy: r.granted_by || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToSubscriptionCharge(r) {
  if (!r) return null;
  return {
    id: r.id,
    subscriptionId: r.subscription_id,
    price: Number(r.price),
    paymentMethod: r.payment_method,
    paymentStatus: r.payment_status,
    momoReferenceId: r.momo_reference_id,
    momoPhone: r.momo_phone,
    confirmedBy: r.confirmed_by,
    confirmedAt: r.confirmed_at,
    createdAt: r.created_at,
  };
}

// Whether a vendor_subscriptions row currently grants Premium access —
// deliberately NOT just "current_period_end is null or future", since a
// 'paid' subscription with a null current_period_end means its first
// charge hasn't been confirmed yet (still pending), not "indefinite".
// Premium was previously also grantable for free by a Super Admin
// (source = 'admin_comp', with its own indefinite-when-null-end rule) —
// that capability was removed platform-wide (see the "Free Premium
// removed entirely" README section: the vendor-facing status card could
// get stuck reading "granted by ONLib" forever, since ending a grant only
// changed dates, never the row's own status). Only 'paid' rows exist
// going forward; a stray legacy 'admin_comp' row is force-canceled by a
// one-time schema.sql migration, so this only needs the paid rule now.
function isSubscriptionCurrentlyActive(sub) {
  if (!sub || sub.status !== 'active') return false;
  const now = Date.now();
  if (sub.currentPeriodStart && new Date(sub.currentPeriodStart).getTime() > now) return false;
  return !!sub.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() > now;
}

// Base row only — no joins. getDisputes()/getDisputeById() below build
// their own richer, joined shape (customer/order/purchase/vendor/
// delivery-company context) for display; this mapper is just for the
// plain INSERT/UPDATE ... RETURNING * results in createDispute/
// resolveDispute.
function rowToDispute(r) {
  if (!r) return null;
  return {
    id: r.id,
    orderId: r.order_id,
    purchaseId: r.purchase_id,
    customerId: r.customer_id,
    category: r.category,
    description: r.description,
    status: r.status,
    resolutionNote: r.resolution_note,
    refundAmount: r.refund_amount !== null && r.refund_amount !== undefined ? Number(r.refund_amount) : null,
    resolvedBy: r.resolved_by,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  };
}

function rowToAuditLogEntry(r) {
  if (!r) return null;
  return {
    id: r.id,
    actorId: r.actor_id,
    actorName: r.actor_name,
    actorRole: r.actor_role,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    targetLabel: r.target_label,
    details: r.details || {},
    createdAt: r.created_at,
  };
}

function rowToLoginHistory(r) {
  if (!r) return null;
  return {
    id: r.id,
    ipAddress: r.ip_address,
    device: r.device,
    browser: r.browser,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
  };
}

function rowToAddress(r) {
  if (!r) return null;
  return { id: r.id, label: r.label, address: r.address, isDefault: r.is_default, createdAt: r.created_at };
}

function rowToMessage(r) {
  if (!r) return null;
  return { id: r.id, conversationId: r.conversation_id, senderId: r.sender_id, body: r.body, createdAt: r.created_at, readAt: r.read_at };
}

function rowToUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    businessName: r.business_name,
    email: r.email,
    phone: r.phone,
    role: r.role,
    passwordHash: r.password_hash, // only used internally for login checks
    tokenVersion: r.token_version,
    approvalStatus: r.approval_status,
    rejectionReason: r.rejection_reason || null,
    businessRegistrationDoc: r.business_registration_doc,
    idDocumentType: r.id_document_type,
    idDocumentDoc: r.id_document_doc,
    appliedAt: r.applied_at,
    createdAt: r.created_at,
    storeAddress: r.store_address,
    vendorType: r.vendor_type || 'store',
    avgPrepTimeMinutes: r.avg_prep_time_minutes,
    profileImageUrl: r.profile_image_url,
    // Real, Super-Admin-assigned zone (see schema.sql's comment on
    // delivery_zones) — only meaningful for role = 'vendor', null on
    // every other role.
    deliveryZoneId: r.delivery_zone_id || null,
    isDisabled: r.is_disabled,
    disabledFeatures: r.disabled_features || [],
    commissionRateOverride: r.commission_rate_override !== null && r.commission_rate_override !== undefined ? Number(r.commission_rate_override) : null,
    // Featured Placements — only meaningful for role = 'vendor', but
    // harmless (always null) on every other role. See rowToProduct's
    // comment on why every one of the vendor's products inherits this
    // boost/badge instead of a separate vendor-directory page.
    featuredUntil: r.featured_until || null,
    isStoreFeatured: isFuture(r.featured_until),
    twoFactorEnabled: !!r.two_factor_enabled,
  };
}

// Shared by cancelOrderAndRestock and voidFailedMomoPayment — both
// "undo" a checkout for a different reason (customer cancelled vs.
// payment never went through), but restocking the purchased items back
// onto their products is the same operation either way. Must be called
// from inside an already-open transaction (client), not the pool
// directly, so it commits/rolls back atomically with whatever else the
// caller is doing.
// Creates the linked delivery order for one just-confirmed Mobile
// Money purchase (row already has payment_status = 'successful' at
// this point) — extracted so confirmMomoPaymentAndCreateOrder can run
// it once for the purchase that was directly confirmed and again for
// each sibling in the same checkout_batch_id, without duplicating the
// order-creation logic. Returns null if this purchase never stashed a
// pending pickup/dropoff (already had a delivery order, or never
// needed one).
async function createDeliveryOrderForConfirmedPurchaseInTx(client, purchase) {
  if (!purchase.pending_pickup_address || !purchase.pending_dropoff_address) return null;
  const { rows: itemRows } = await client.query(
    'SELECT product_name, quantity, selected_color, selected_size FROM purchase_items WHERE purchase_id = $1', [purchase.id]
  );
  const itemSummary = itemRows.map(li => {
    const variantBits = [li.selected_color, li.selected_size].filter(Boolean).join(', ');
    return `${li.quantity}x ${li.product_name}${variantBits ? ` (${variantBits})` : ''}`;
  }).join(', ');
  const { rows: custRows } = await client.query('SELECT business_name FROM users WHERE id = $1', [purchase.customer_id]);
  const deliveryOrderId = `ORD-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}M`;
  await client.query(
    `INSERT INTO orders (id, sender_id, sender_name, pickup_address, dropoff_address, item_description, amount, status, placed_by_admin, delivery_fee)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', false, $8)`,
    [deliveryOrderId, purchase.customer_id, custRows[0] ? custRows[0].business_name : 'Customer',
      purchase.pending_pickup_address, purchase.pending_dropoff_address, `Marketplace order: ${itemSummary}`, null, purchase.delivery_fee || 0]
  );
  await client.query(
    `UPDATE purchases SET delivery_order_id = $1, pending_pickup_address = NULL, pending_dropoff_address = NULL WHERE id = $2`,
    [deliveryOrderId, purchase.id]
  );
  return deliveryOrderId;
}

async function restockPurchaseItemsInTx(client, purchaseId) {
  const { rows: items } = await client.query(
    'SELECT product_id, quantity, selected_color, selected_size FROM purchase_items WHERE purchase_id = $1', [purchaseId]
  );
  for (const item of items) {
    await client.query('UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2', [item.quantity, item.product_id]);
    // Also restock the specific variant row this item was decremented
    // from, mirroring checkout()'s variant-aware decrement above — a
    // purchase_items row only has selected_color/selected_size set when
    // it was decremented from a variant row in the first place, and this
    // is a no-op (0 rows matched) if the vendor has since deleted that
    // variant or removed the product's colors/sizes entirely.
    if (item.selected_color !== null || item.selected_size !== null) {
      await client.query(
        'UPDATE product_variants SET stock_quantity = stock_quantity + $1 WHERE product_id = $2 AND color = $3 AND size = $4',
        [item.quantity, item.product_id, item.selected_color || '', item.selected_size || '']
      );
    }
  }
}

const db = {
  async init() {
    const fs = require('fs');
    const path = require('path');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
  },

  // ---- Users -------------------------------------------------------

  async createUser({ id, businessName, email, phone, passwordHash, role, approvalStatus, businessRegistrationDoc, idDocumentType, idDocumentDoc, appliedAt, vendorType }) {
    const { rows } = await pool.query(
      `INSERT INTO users (id, business_name, email, phone, password_hash, role, approval_status, business_registration_doc, id_document_type, id_document_doc, applied_at, vendor_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [id, businessName, email.toLowerCase(), phone || null, passwordHash, role, approvalStatus || 'approved', businessRegistrationDoc || null, idDocumentType || null, idDocumentDoc || null, appliedAt || null, vendorType === 'restaurant' ? 'restaurant' : 'store']
    );
    return rowToUser(rows[0]);
  },

  async updateUserPassword(userId, passwordHash) {
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
  },

  async updateUserEmail(userId, email) {
    const { rows } = await pool.query(
      'UPDATE users SET email = $1 WHERE id = $2 RETURNING *',
      [email.toLowerCase(), userId]
    );
    return rowToUser(rows[0]);
  },

  // Self-service profile edit (business/store name + phone) — any
  // authenticated user updating their own account. Email/password stay
  // on their existing separate, more careful flows (uniqueness checks,
  // re-auth) rather than folding into this simpler update.
  async updateUserProfile(userId, { businessName, phone, storeAddress, avgPrepTimeMinutes }) {
    // storeAddress === undefined means "don't touch this field" (e.g. a
    // non-vendor caller, where it's never part of the payload at all).
    // Anything else — including an explicit null/empty string — means
    // "set it to this," so a vendor can actually clear their address,
    // not just ever replace it with a new non-empty value. Same
    // untouched-vs-explicit-null convention for avgPrepTimeMinutes.
    const touchingAddress = storeAddress !== undefined;
    const touchingPrepTime = avgPrepTimeMinutes !== undefined;
    const { rows } = await pool.query(
      `UPDATE users SET business_name = $1, phone = $2,
         store_address = CASE WHEN $3 THEN $4 ELSE store_address END,
         avg_prep_time_minutes = CASE WHEN $5 THEN $6 ELSE avg_prep_time_minutes END
       WHERE id = $7 RETURNING *`,
      [businessName, phone || null, touchingAddress, touchingAddress ? (storeAddress || null) : null,
       touchingPrepTime, touchingPrepTime ? avgPrepTimeMinutes : null, userId]
    );
    return rowToUser(rows[0]);
  },

  // Real profile photo update — any role, always the caller's own
  // account (the endpoint never takes a target user id). Passing null
  // removes the photo, falling back to the initial-letter avatar.
  async updateProfileImage(userId, dataUrl) {
    const { rows } = await pool.query(
      'UPDATE users SET profile_image_url = $1 WHERE id = $2 RETURNING *',
      [dataUrl || null, userId]
    );
    return rowToUser(rows[0]);
  },

  // Invalidates every JWT issued before this call for this user — used by
  // "Logout All Devices". See the token_version comment in schema.sql.
  async bumpTokenVersion(userId) {
    const { rows } = await pool.query(
      'UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING *',
      [userId]
    );
    return rowToUser(rows[0]);
  },

  // Real account suspension — scoped away from role = 'super_admin' in
  // the query itself, not just trusted from the caller, so this can
  // never be used to disable a Super Admin account (including
  // accidentally disabling your own). Disabling also bumps
  // token_version so any already-active session is invalidated
  // immediately on its very next request, not just future logins.
  async setUserDisabled(id, disabled) {
    const { rows } = await pool.query(
      `UPDATE users SET is_disabled = $1 WHERE id = $2 AND role != 'super_admin' RETURNING *`,
      [disabled, id]
    );
    if (rows[0] && disabled) {
      await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [id]);
    }
    return rowToUser(rows[0]);
  },

  // Super Admin cutting off specific features for a Manage Agent
  // account. Scoped away from super_admin for the same reason
  // setUserDisabled is — this can never be pointed at a Super Admin
  // account, including accidentally.
  async setDisabledFeatures(id, features) {
    const { rows } = await pool.query(
      `UPDATE users SET disabled_features = $1 WHERE id = $2 AND role != 'super_admin' RETURNING *`,
      [features, id]
    );
    return rowToUser(rows[0]);
  },

  // Promote a Manage Agent to Super Admin, or demote a Super Admin
  // back to Manage Agent. Scoped to exactly these two roles in the
  // query itself (never vendor/sender/delivery_company/etc — those
  // have their own dedicated account types, not a "level" to move up
  // or down) so this can never be misused to grant/revoke any other
  // kind of access. Also bumps token_version, same as setUserDisabled
  // above — the role is baked into every already-issued JWT, so
  // without this the account would keep operating under its old role
  // until whatever token it's holding happens to expire on its own (up
  // to 30 days).
  //
  // Promoting to super_admin also clears disabled_features. Without
  // this, a promoted account keeps whatever features were disabled on
  // it as a Manage Agent — harmless server-side (requireFeature always
  // exempts super_admin regardless of this column), but the frontend
  // used to trust that a Super Admin's disabled_features was always
  // empty and hid UI based on it unconditionally, which made Business
  // Profile (and potentially others) silently vanish for a freshly
  // promoted Super Admin who'd had it restricted back when they were
  // still Manage Agent. The frontend now checks role first too (belt
  // and suspenders), but there's no reason to leave stale restrictions
  // sitting on the row either.
  async setUserRole(id, role) {
    const { rows } = await pool.query(
      `UPDATE users SET role = $1, token_version = token_version + 1,
         disabled_features = CASE WHEN $1 = 'super_admin' THEN '{}' ELSE disabled_features END
       WHERE id = $2 AND role IN ('admin', 'super_admin') RETURNING *`,
      [role, id]
    );
    return rowToUser(rows[0]);
  },

  // How many accounts currently hold role = 'super_admin' — used to
  // block demoting the last one and leaving the platform with no one
  // able to reach the Super Admin console at all.
  async countSuperAdmins() {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'super_admin'`);
    return rows[0].count;
  },

  // Fast permission check — used on every gated request, so this is
  // intentionally a single small query rather than fetching the full
  // user row. Takes effect immediately (no token/session dependency),
  // same as is_disabled above.
  async isFeatureDisabledForUser(id, featureKey) {
    const { rows } = await pool.query(
      'SELECT disabled_features @> ARRAY[$1]::text[] AS is_disabled FROM users WHERE id = $2',
      [featureKey, id]
    );
    return rows[0] ? rows[0].is_disabled : false;
  },

  async getUserByEmail(email) {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    return rowToUser(rows[0]);
  },

  async getUserById(id) {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rowToUser(rows[0]);
  },

  async countAdmins() {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'");
    return rows[0].count;
  },

  // ---- Orders -------------------------------------------------------

  async getAllOrders() {
    const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    return rows.map(rowToOrder);
  },

  // ---- Delivery Company (multi-provider) scoped queries ----------------
  async getAgentsByCompany(companyId) {
    const { rows } = await pool.query(
      `SELECT a.*, r.avg_rating, r.review_count
       FROM agents a
       LEFT JOIN (
         SELECT agent_id, AVG(rating)::numeric(3,2) AS avg_rating, COUNT(*) AS review_count
         FROM agent_reviews GROUP BY agent_id
       ) r ON r.agent_id = a.id
       WHERE a.delivery_company_id = $1 ORDER BY a.created_at ASC`,
      [companyId]
    );
    return rows.map(rowToAgent);
  },

  async getOrdersByCompany(companyId) {
    const { rows } = await pool.query(
      'SELECT * FROM orders WHERE delivery_company_id = $1 ORDER BY created_at DESC',
      [companyId]
    );
    return rows.map(rowToOrder);
  },

  // Real, unassigned orders — visible to any approved delivery
  // company, matching the "first company to accept it" design. Not
  // scoped to a company, since by definition these don't belong to
  // one yet.
  async getPendingOrders() {
    const { rows } = await pool.query(
      "SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at ASC"
    );
    return rows.map(rowToOrder);
  },

  // Joined to purchases so a customer's order list can tell which
  // orders are actually a restaurant/store order (has a vendor to
  // rate) vs a plain package delivery (doesn't) — powers the
  // post-delivery review prompt without a separate round-trip per
  // order. LEFT JOIN because most orders have no linked purchase at
  // all, and that's normal, not missing data.
  async getOrdersBySender(senderId) {
    const { rows } = await pool.query(`
      SELECT o.*, pu.id AS purchase_id, pu.vendor_id AS purchase_vendor_id, u.business_name AS purchase_vendor_name,
        ar.id AS agent_review_id
      FROM orders o
      LEFT JOIN purchases pu ON pu.delivery_order_id = o.id
      LEFT JOIN users u ON u.id = pu.vendor_id
      LEFT JOIN agent_reviews ar ON ar.order_id = o.id
      WHERE o.sender_id = $1
      ORDER BY o.created_at DESC
    `, [senderId]);
    return rows.map(rowToOrder);
  },

  async createOrder(order) {
    const { rows } = await pool.query(
      `INSERT INTO orders (id, sender_id, sender_name, pickup_address, dropoff_address, item_description, amount, status, placed_by_admin, scheduled_for, recurrence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [order.id, order.senderId, order.senderName, order.pickupAddress, order.dropoffAddress, order.itemDescription, order.amount, order.status || 'pending', !!order.placedByAdmin, order.scheduledFor || null, order.recurrence || null]
    );
    return rowToOrder(rows[0]);
  },

  // ---- Scheduled/recurring "Send a Package" orders — see the
  // scheduled_for/recurrence comment in schema.sql for the design:
  // status='scheduled' keeps a not-yet-due order invisible to
  // getPendingOrders() until a periodic sweep (see server.js) promotes
  // it. ----

  async getScheduledOrdersDue() {
    const { rows } = await pool.query(
      "SELECT * FROM orders WHERE status = 'scheduled' AND scheduled_for <= now()"
    );
    return rows.map(rowToOrder);
  },

  // Guarded by WHERE status = 'scheduled' for the same reason
  // acceptOrderAtomic guards on 'pending' — the sweep runs on an
  // interval, not exactly-once, so this stays safe even if a future
  // change ever calls it twice for the same order.
  async promoteScheduledOrder(id) {
    const { rows } = await pool.query(
      `UPDATE orders SET status = 'pending' WHERE id = $1 AND status = 'scheduled' RETURNING *`,
      [id]
    );
    return rowToOrder(rows[0]);
  },

  // Listing a sender's own scheduled orders doesn't need a dedicated
  // getter — GET /api/state already returns every order for a sender
  // (getOrdersBySender is not status-filtered), scheduled ones
  // included, and every subsequent change arrives live over the
  // socket like any other order.

  // A customer cancelling a not-yet-due scheduled order — distinct from
  // cancelOrderAndRestock, which only ever matches status='pending' and
  // has no reason to run here: a scheduled order was created through
  // this same manual "Send a Package" flow, never through marketplace
  // checkout, so it never has a linked purchase to restock.
  async cancelScheduledOrder(id, senderId) {
    const { rows } = await pool.query(
      `UPDATE orders SET status = 'cancelled' WHERE id = $1 AND sender_id = $2 AND status = 'scheduled' RETURNING *`,
      [id, senderId]
    );
    return rowToOrder(rows[0]);
  },

  // Atomic accept — the WHERE status = 'pending' guard is the actual
  // protection here, not just a nicety: now that multiple delivery
  // companies can see and try to accept the same pending order at
  // once, a plain UPDATE by id alone would let two acceptances both
  // "succeed" and silently overwrite each other. This returns null if
  // someone else's acceptance already changed the status first —
  // whichever request's UPDATE runs first wins, the second one gets
  // nothing to update and the caller can tell the user honestly that
  // someone else got there first.
  // service_fee is computed in the same statement, atomically, rather
  // than fetched beforehand — a CASE that skips it entirely for any
  // order already linked to a marketplace purchase (via
  // purchases.delivery_order_id), since that purchase already charged
  // one service fee at checkout; charging a second one here for the
  // same transaction's delivery leg would double-charge the customer.
  // A plain "Send a Package" order (no linked purchase) gets the
  // platform's current service fee snapshotted, same reasoning as
  // amount/commission_rate elsewhere in this app.
  async acceptOrderAtomic(id, { amount, acceptedBy, paymentMethod, deliveryCompanyId, agentId }) {
    const { rows } = await pool.query(
      `UPDATE orders SET amount = $1, accepted_by = $2, payment_method = $3,
       status = 'accepted', accepted_at = now(), delivery_company_id = $4, agent_id = $6,
       service_fee = CASE
         WHEN EXISTS (SELECT 1 FROM purchases WHERE delivery_order_id = orders.id) THEN 0
         ELSE (SELECT service_fee FROM platform_settings WHERE id = 'platform')
       END
       WHERE id = $5 AND status = 'pending' RETURNING *`,
      [amount, acceptedBy, paymentMethod || null, deliveryCompanyId || null, id, agentId || null]
    );
    return rowToOrder(rows[0]);
  },

  // The "Rate your delivery" submission — a star rating for the real
  // agent who delivered the order (agent_id, see schema.sql), plus an
  // optional tip. Ownership/status/agent-presence are all validated by
  // the caller (see POST /api/orders/:id/rate in server.js) before
  // this runs; the UNIQUE(order_id) constraint on agent_reviews is the
  // actual backstop against a double-submit race. tipAmount is
  // optional and independent of the rating — a sender can tip without
  // leaving a comment, or leave a rating with no tip.
  async rateDelivery({ id, orderId, agentId, customerId, rating, comment, tipAmount }) {
    const { rows } = await pool.query(
      `INSERT INTO agent_reviews (id, agent_id, order_id, customer_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, agentId, orderId, customerId, rating, comment || null]
    );
    if (tipAmount !== undefined && tipAmount !== null) {
      await pool.query('UPDATE orders SET tip_amount = $1 WHERE id = $2', [tipAmount, orderId]);
    }
    return rowToAgentReview(rows[0]);
  },

  async getAgentReviewForOrder(orderId) {
    const { rows } = await pool.query('SELECT * FROM agent_reviews WHERE order_id = $1', [orderId]);
    return rowToAgentReview(rows[0]);
  },

  async getAgentReviews(agentId) {
    const { rows } = await pool.query(
      `SELECT ar.*, u.business_name AS customer_name
       FROM agent_reviews ar JOIN users u ON u.id = ar.customer_id
       WHERE ar.agent_id = $1 ORDER BY ar.created_at DESC`,
      [agentId]
    );
    return rows.map(r => ({ ...rowToAgentReview(r), customerName: r.customer_name }));
  },

  async updateOrder(id, fields) {
    // Whitelist of updatable columns, mapped from camelCase -> snake_case.
    const colMap = {
      amount: 'amount',
      status: 'status',
      acceptedBy: 'accepted_by',
      acceptedAt: 'accepted_at',
      pickedUpAt: 'picked_up_at',
      deliveredAt: 'delivered_at',
      paymentMethod: 'payment_method',
      deliveryCompanyId: 'delivery_company_id',
    };
    const sets = [];
    const values = [];
    let i = 1;
    for (const [key, col] of Object.entries(colMap)) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        sets.push(`${col} = $${i}`);
        values.push(fields[key]);
        i += 1;
      }
    }
    if (sets.length === 0) return this.getOrder(id);
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE orders SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return rowToOrder(rows[0]);
  },

  async getOrder(id) {
    const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    return rowToOrder(rows[0]);
  },

  // Cancels a pending order and, if it's a marketplace order (linked to
  // a purchase via delivery_order_id), restocks every purchased item in
  // the same transaction — so a crash between the two steps can't leave
  // stock permanently short, and two concurrent cancel attempts on the
  // same order can't double-restock it (the UPDATE only matches while
  // status is still 'pending'). Plain delivery orders (no linked
  // purchase) just get their status flipped, same as before this
  // existed. Returns null if the order wasn't pending (already
  // cancelled/accepted/etc.) so the caller can report that cleanly.
  async cancelOrderAndRestock(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: orderRows } = await client.query(
        `UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending' RETURNING *`,
        [id]
      );
      if (!orderRows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      const { rows: purchaseRows } = await client.query(
        'SELECT id FROM purchases WHERE delivery_order_id = $1', [id]
      );
      if (purchaseRows[0]) {
        await restockPurchaseItemsInTx(client, purchaseRows[0].id);
      }

      await client.query('COMMIT');
      return rowToOrder(orderRows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async getPurchaseByMomoReferenceId(referenceId) {
    const { rows } = await pool.query('SELECT * FROM purchases WHERE momo_reference_id = $1', [referenceId]);
    return rowToPurchase(rows[0]);
  },

  // Flips a pending Mobile Money purchase to 'successful' once MTN
  // confirms the payment, and — only now, not at checkout time — creates
  // the real delivery order from the pending_pickup_address/
  // pending_dropoff_address stashed on the purchase (see checkout()'s
  // comment on why order creation is deferred for this payment method).
  // Scoped to payment_status = 'pending' so a late/duplicate webhook
  // firing after the polling path already confirmed it (or vice versa)
  // is a safe no-op, not a double-apply/double-order. Returns null if
  // the purchase was already resolved (paid or already voided).
  //
  // confirmedBy is only passed by the manual Mobile Money admin-confirm
  // route (Super Admin matching a reference code by hand) — left null
  // for the automated MTN path above, which nobody manually approved.
  // payment_confirmed_at is stamped either way, since "when did this
  // resolve" is meaningful regardless of mechanism.
  // Confirms one purchase, creates its linked delivery order (if it
  // doesn't have one yet), and — when this purchase is part of a
  // multi-vendor checkout batch (see schema.sql's comment on
  // checkout_batch_id) — cascades the same confirmation to every
  // sibling purchase in that batch. A batch shares ONE payment
  // reference/one combined Mobile Money payment across several
  // vendors, so confirming that one payment has to resolve every
  // vendor's piece of it together, not leave the others stranded
  // in 'pending' forever.
  async confirmMomoPaymentAndCreateOrder(purchaseId, confirmedBy = null) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: purchaseRows } = await client.query(
        `UPDATE purchases SET payment_status = 'successful', payment_confirmed_by = $2, payment_confirmed_at = now()
         WHERE id = $1 AND payment_status = 'pending' RETURNING *`,
        [purchaseId, confirmedBy]
      );
      if (!purchaseRows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const purchase = purchaseRows[0];
      const deliveryOrderId = await createDeliveryOrderForConfirmedPurchaseInTx(client, purchase);

      // Cascade to the rest of this batch, if any — same confirm logic,
      // just without re-touching the purchase we already confirmed
      // above. A plain single-vendor checkout has no checkout_batch_id
      // at all, so this loop is simply empty for it (unchanged
      // behavior).
      const siblingOrderIds = [];
      if (purchase.checkout_batch_id) {
        const { rows: siblings } = await client.query(
          `UPDATE purchases SET payment_status = 'successful', payment_confirmed_by = $2, payment_confirmed_at = now()
           WHERE checkout_batch_id = $1 AND id != $3 AND payment_status = 'pending' RETURNING *`,
          [purchase.checkout_batch_id, confirmedBy, purchaseId]
        );
        for (const sibling of siblings) {
          const siblingOrderId = await createDeliveryOrderForConfirmedPurchaseInTx(client, sibling);
          if (siblingOrderId) siblingOrderIds.push(siblingOrderId);
        }
      }

      await client.query('COMMIT');
      return {
        purchase: rowToPurchase({ ...purchase, delivery_order_id: deliveryOrderId, payment_status: 'successful' }),
        deliveryOrderId,
        siblingOrderIds,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // The payment-side equivalent of cancelOrderAndRestock: MTN reported
  // the Request to Pay as failed/rejected/timed out, so nothing was
  // actually paid for — restock the items (stock was reserved
  // optimistically at initiation, same as any other checkout) in one
  // transaction. Scoped to payment_status = 'pending' for the same
  // no-double-restock reasoning as cancelOrderAndRestock. Returns null
  // if the purchase was already resolved (paid or already voided).
  async voidFailedMomoPayment(purchaseId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: purchaseRows } = await client.query(
        `UPDATE purchases SET payment_status = 'failed' WHERE id = $1 AND payment_status = 'pending' RETURNING *`,
        [purchaseId]
      );
      if (!purchaseRows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      await restockPurchaseItemsInTx(client, purchaseId);
      // A coupon (if any) was redeemed optimistically at initiation,
      // same reasoning as the stock reservation above — since the
      // payment never actually went through, give the redemption back:
      // decrement the aggregate counter and remove the per-customer
      // redemption row, so the customer can genuinely reuse the code
      // (their failed attempt shouldn't count against a usage cap) and
      // max_uses isn't silently eaten by payments that never completed.
      if (purchaseRows[0].coupon_id) {
        await client.query('UPDATE coupons SET uses_count = GREATEST(uses_count - 1, 0) WHERE id = $1', [purchaseRows[0].coupon_id]);
        await client.query('DELETE FROM coupon_redemptions WHERE purchase_id = $1', [purchaseId]);
      }
      if (purchaseRows[0].delivery_order_id) {
        await client.query(
          `UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`,
          [purchaseRows[0].delivery_order_id]
        );
      }

      // Cascade to the rest of the batch, if any — one combined
      // payment covers every vendor in it, so if it's being voided,
      // none of them got paid, not just this one (same reasoning as
      // the confirm-side cascade in confirmMomoPaymentAndCreateOrder).
      if (purchaseRows[0].checkout_batch_id) {
        const { rows: siblings } = await client.query(
          `UPDATE purchases SET payment_status = 'failed'
           WHERE checkout_batch_id = $1 AND id != $2 AND payment_status = 'pending' RETURNING *`,
          [purchaseRows[0].checkout_batch_id, purchaseId]
        );
        for (const sibling of siblings) {
          await restockPurchaseItemsInTx(client, sibling.id);
          if (sibling.coupon_id) {
            await client.query('UPDATE coupons SET uses_count = GREATEST(uses_count - 1, 0) WHERE id = $1', [sibling.coupon_id]);
            await client.query('DELETE FROM coupon_redemptions WHERE purchase_id = $1', [sibling.id]);
          }
          if (sibling.delivery_order_id) {
            await client.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`, [sibling.delivery_order_id]);
          }
        }
      }

      await client.query('COMMIT');
      return rowToPurchase(purchaseRows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async deleteOrders(ids) {
    if (!ids.length) return;
    await pool.query('DELETE FROM orders WHERE id = ANY($1::text[])', [ids]);
  },

  // ---- Expenses -------------------------------------------------------

  async getAllExpenses() {
    const { rows } = await pool.query('SELECT * FROM expenses ORDER BY date DESC');
    return rows.map(rowToExpense);
  },

  async createExpense(expense) {
    const { rows } = await pool.query(
      `INSERT INTO expenses (id, date, amount, description) VALUES ($1, $2, $3, $4) RETURNING *`,
      [expense.id, expense.date, expense.amount, expense.description]
    );
    return rowToExpense(rows[0]);
  },

  async deleteExpense(id) {
    await pool.query('DELETE FROM expenses WHERE id = $1', [id]);
  },

  // ---- Agents (Fleet Directory) -------------------------------------

  async getAgentById(id) {
    const { rows } = await pool.query('SELECT * FROM agents WHERE id = $1', [id]);
    return rowToAgent(rows[0]);
  },

  async getAllAgents() {
    const { rows } = await pool.query('SELECT * FROM agents ORDER BY created_at ASC');
    return rows.map(rowToAgent);
  },

  // LEGACY FALLBACK ONLY. order:accept in server.js now resolves the
  // agent by id (getAgentById, below) — the real fix for the collision
  // risk this function has: with no uniqueness constraint on `name`,
  // two agents sharing a name (even across two different companies)
  // could match the wrong row via this unordered `LIMIT 1`, silently
  // misattributing an order's company or wrongly denying a delivery
  // company's own accept. This still exists only so a browser tab
  // holding pre-fix JS during a rolling deploy doesn't hard-fail; once
  // every client has reloaded, this path is never exercised. Do not use
  // this for any new code — use getAgentById.
  async getAgentByName(name) {
    const { rows } = await pool.query('SELECT * FROM agents WHERE name = $1 LIMIT 1', [name]);
    return rowToAgent(rows[0]);
  },

  async countAgents() {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM agents');
    return rows[0].count;
  },

  // Backward-compat migration for the multi-provider delivery system —
  // links every agent that doesn't yet have a delivery_company_id to
  // the given company (the primary admin account, representing Verta
  // Delivery Service's own fleet). Safe to call on every boot: only
  // touches agents still missing one.
  async linkOrphanedAgentsToCompany(companyId) {
    const { rowCount } = await pool.query(
      'UPDATE agents SET delivery_company_id = $1 WHERE delivery_company_id IS NULL',
      [companyId]
    );
    return rowCount;
  },

  // Moves an entire fleet — agents AND their order history — from one
  // company to another. Used exactly once, when Verta's own
  // delivery_company account is first created, to move the fleet that
  // was previously linked to the Manage Agent account over to it.
  async reassignFleetToCompany(fromCompanyId, toCompanyId) {
    const agentsResult = await pool.query(
      'UPDATE agents SET delivery_company_id = $1 WHERE delivery_company_id = $2',
      [toCompanyId, fromCompanyId]
    );
    const ordersResult = await pool.query(
      'UPDATE orders SET delivery_company_id = $1 WHERE delivery_company_id = $2',
      [toCompanyId, fromCompanyId]
    );
    return { agentsMoved: agentsResult.rowCount, ordersMoved: ordersResult.rowCount };
  },

  async createAgent({ id, name, phone, deliveryCompanyId }) {
    const { rows } = await pool.query(
      `INSERT INTO agents (id, name, phone, delivery_company_id) VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, name, phone, deliveryCompanyId || null]
    );
    return rowToAgent(rows[0]);
  },

  // deliveryCompanyId: undefined = leave the agent's current company
  // unchanged (the normal case — a delivery company editing its own
  // agent's name/phone, or an admin doing the same without reassigning
  // it). Any other value (including null) is written through, so an
  // admin reassigning a legacy/unassigned agent to a real company goes
  // through this same path as a name/phone edit.
  async updateAgent(id, { name, phone, deliveryCompanyId }) {
    if (deliveryCompanyId !== undefined) {
      const { rows } = await pool.query(
        `UPDATE agents SET name = $1, phone = $2, delivery_company_id = $3 WHERE id = $4 RETURNING *`,
        [name, phone, deliveryCompanyId, id]
      );
      return rowToAgent(rows[0]);
    }
    const { rows } = await pool.query(
      `UPDATE agents SET name = $1, phone = $2 WHERE id = $3 RETURNING *`,
      [name, phone, id]
    );
    return rowToAgent(rows[0]);
  },

  async updateAgentDutyStatus(id, dutyStatus) {
    const { rows } = await pool.query(
      `UPDATE agents SET duty_status = $1 WHERE id = $2 RETURNING *`,
      [dutyStatus, id]
    );
    return rowToAgent(rows[0]);
  },

  // Hard delete — safe to do: nothing in the schema has a foreign key
  // pointing at agents.id (accepted_by on orders is a free-text
  // snapshot of the agent's name, not a reference — see the comment on
  // the agents table in schema.sql), so removing an agent never breaks
  // historical order records.
  async deleteAgent(id) {
    const { rowCount } = await pool.query('DELETE FROM agents WHERE id = $1', [id]);
    return rowCount > 0;
  },

  // ---- Password resets -----------------------------------------------

  async createPasswordReset({ id, userId, codeHash, expiresAt }) {
    await pool.query(
      `INSERT INTO password_resets (id, user_id, code_hash, expires_at) VALUES ($1, $2, $3, $4)`,
      [id, userId, codeHash, expiresAt]
    );
  },

  // Most recent unused, unexpired reset row for this user — a user may
  // have requested a code more than once; only the latest one counts.
  async getActivePasswordReset(userId) {
    const { rows } = await pool.query(
      `SELECT * FROM password_resets
       WHERE user_id = $1 AND used = false AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  },

  async markPasswordResetUsed(id) {
    await pool.query('UPDATE password_resets SET used = true WHERE id = $1', [id]);
  },

  // ---- Two-factor authentication (SMS via Twilio, all roles) — same
  // code/hash/expiry/used shape as password_resets above, kept as its
  // own table since it's a distinct concern (a login-time challenge,
  // not a password-recovery flow). See schema.sql for the "rebuilt
  // from scratch" note. ----

  async setTwoFactorEnabled(userId, enabled) {
    await pool.query('UPDATE users SET two_factor_enabled = $1 WHERE id = $2', [enabled, userId]);
  },

  async createTwoFactorChallenge({ id, userId, codeHash, expiresAt }) {
    await pool.query(
      `INSERT INTO two_factor_challenges (id, user_id, code_hash, expires_at) VALUES ($1, $2, $3, $4)`,
      [id, userId, codeHash, expiresAt]
    );
  },

  async getTwoFactorChallenge(id) {
    const { rows } = await pool.query('SELECT * FROM two_factor_challenges WHERE id = $1', [id]);
    return rows[0] || null;
  },

  async markTwoFactorChallengeUsed(id) {
    await pool.query('UPDATE two_factor_challenges SET used = true WHERE id = $1', [id]);
  },

  // ---- Settings (Business Profile / Regional) -------------------------
  // Single row, id = 'business' always. Upsert on save.

  async getSettings() {
    const { rows } = await pool.query("SELECT * FROM settings WHERE id = 'business'");
    // The 'business' row is normally created the first time anyone
    // saves Settings > Business Profile (see upsertSettings, which
    // inserts it on first write) — but nothing before that point has
    // ever required it to exist, so a fresh deployment where no admin
    // has opened Settings yet has zero rows here. Every caller of
    // getSettings() (checkout, /api/config, etc.) expects an object
    // back, not null, so this falls back to the same all-null/default
    // shape rowToSettings() would produce for an existing-but-empty
    // row, rather than crashing every caller that does
    // `settings.someField` right after awaiting this.
    return rowToSettings(rows[0]) || rowToSettings({ open_days: [] });
  },

  async upsertSettings(fields) {
    const existing = await pool.query("SELECT id FROM settings WHERE id = 'business'");
    if (existing.rows.length === 0) {
      await pool.query("INSERT INTO settings (id) VALUES ('business')");
    }
    const colMap = {
      businessName: 'business_name',
      businessEmail: 'business_email',
      businessPhone: 'business_phone',
      businessAddress: 'business_address',
      businessDescription: 'business_description',
      logoDataUrl: 'logo_data_url',
      openingTime: 'opening_time',
      closingTime: 'closing_time',
      openDays: 'open_days',
      currency: 'currency',
      timezone: 'timezone',
      privacyPolicy: 'privacy_policy',
      termsOfService: 'terms_of_service',
      adminFaqs: 'admin_faqs',
      customerFaqs: 'customer_faqs',
    };
    // JSONB columns — explicit JSON.stringify before binding, same
    // reasoning as createAuditLogEntry's JSONB write: don't rely on
    // node-pg's implicit object serialization.
    const jsonbKeys = new Set(['adminFaqs', 'customerFaqs']);
    const sets = [];
    const values = [];
    let i = 1;
    for (const [key, col] of Object.entries(colMap)) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        sets.push(`${col} = $${i}`);
        const raw = fields[key];
        values.push(jsonbKeys.has(key) && raw != null ? JSON.stringify(raw) : raw);
        i += 1;
      }
    }
    sets.push('updated_at = now()');
    if (sets.length > 1) {
      await pool.query(`UPDATE settings SET ${sets.join(', ')} WHERE id = 'business'`, values);
    }
    return this.getSettings();
  },

  // ---- Mobile Money providers (Super Admin managed) --------------------
  // See schema.sql's comment on momo_providers for why this replaced the
  // old hardcoded 2-provider list + single shared settings.businessPhone.

  rowToMomoProvider(r) {
    return {
      id: r.id,
      label: r.label,
      phone: r.phone,
      isEnabled: r.is_enabled,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  // Full list, any status — for the Super Admin management screen.
  async getAllMomoProviders() {
    const { rows } = await pool.query('SELECT * FROM momo_providers ORDER BY sort_order ASC, created_at ASC');
    return rows.map(this.rowToMomoProvider);
  },

  // Enabled only, for the customer-facing checkout radio list.
  async getEnabledMomoProviders() {
    const { rows } = await pool.query('SELECT * FROM momo_providers WHERE is_enabled = true ORDER BY sort_order ASC, created_at ASC');
    return rows.map(this.rowToMomoProvider);
  },

  async getMomoProviderById(id) {
    const { rows } = await pool.query('SELECT * FROM momo_providers WHERE id = $1', [id]);
    return rows[0] ? this.rowToMomoProvider(rows[0]) : null;
  },

  async createMomoProvider({ id, label, phone, sortOrder }) {
    const { rows } = await pool.query(
      `INSERT INTO momo_providers (id, label, phone, sort_order, is_enabled) VALUES ($1, $2, $3, $4, false) RETURNING *`,
      [id, label, phone || '', sortOrder || 0]
    );
    return this.rowToMomoProvider(rows[0]);
  },

  async updateMomoProvider(id, { label, phone, isEnabled, sortOrder }) {
    const sets = [];
    const values = [];
    let i = 1;
    if (label !== undefined) { sets.push(`label = $${i}`); values.push(label); i += 1; }
    if (phone !== undefined) { sets.push(`phone = $${i}`); values.push(phone); i += 1; }
    if (isEnabled !== undefined) { sets.push(`is_enabled = $${i}`); values.push(isEnabled); i += 1; }
    if (sortOrder !== undefined) { sets.push(`sort_order = $${i}`); values.push(sortOrder); i += 1; }
    if (sets.length === 0) return this.getMomoProviderById(id);
    sets.push('updated_at = now()');
    values.push(id);
    const { rows } = await pool.query(`UPDATE momo_providers SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return rows[0] ? this.rowToMomoProvider(rows[0]) : null;
  },

  async deleteMomoProvider(id) {
    await pool.query('DELETE FROM momo_providers WHERE id = $1', [id]);
  },

  // ---- Delivery Zones & Regions (Super Admin managed) --------------------
  // See schema.sql's comment on delivery_zones — a real, admin-defined
  // substitute for geolocation this app doesn't have. Regions are a purely
  // organizational grouping ABOVE zones (see schema.sql's comment on
  // delivery_regions) — the fee still lives on the zone.

  rowToDeliveryZone(r) {
    return {
      id: r.id,
      name: r.name,
      code: r.code || null,
      regionId: r.region_id || null,
      fee: Number(r.fee),
      sortOrder: r.sort_order,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  rowToDeliveryRegion(r) {
    return {
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  async getAllDeliveryZones() {
    const { rows } = await pool.query('SELECT * FROM delivery_zones ORDER BY sort_order ASC, created_at ASC');
    return rows.map(this.rowToDeliveryZone);
  },

  async getDeliveryZoneById(id) {
    const { rows } = await pool.query('SELECT * FROM delivery_zones WHERE id = $1', [id]);
    return rows[0] ? this.rowToDeliveryZone(rows[0]) : null;
  },

  async getDeliveryZoneByCode(code) {
    if (!code) return null;
    const { rows } = await pool.query('SELECT * FROM delivery_zones WHERE code = $1', [code]);
    return rows[0] ? this.rowToDeliveryZone(rows[0]) : null;
  },

  async createDeliveryZone({ id, name, code, regionId, fee, sortOrder }) {
    const { rows } = await pool.query(
      `INSERT INTO delivery_zones (id, name, code, region_id, fee, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, name, code || null, regionId || null, fee, sortOrder || 0]
    );
    return this.rowToDeliveryZone(rows[0]);
  },

  async updateDeliveryZone(id, { name, code, regionId, fee, sortOrder }) {
    const sets = [];
    const values = [];
    let i = 1;
    if (name !== undefined) { sets.push(`name = $${i}`); values.push(name); i += 1; }
    if (code !== undefined) { sets.push(`code = $${i}`); values.push(code || null); i += 1; }
    if (regionId !== undefined) { sets.push(`region_id = $${i}`); values.push(regionId || null); i += 1; }
    if (fee !== undefined) { sets.push(`fee = $${i}`); values.push(fee); i += 1; }
    if (sortOrder !== undefined) { sets.push(`sort_order = $${i}`); values.push(sortOrder); i += 1; }
    if (sets.length === 0) return this.getDeliveryZoneById(id);
    sets.push('updated_at = now()');
    values.push(id);
    const { rows } = await pool.query(`UPDATE delivery_zones SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return rows[0] ? this.rowToDeliveryZone(rows[0]) : null;
  },

  async deleteDeliveryZone(id) {
    // Vendors assigned to a deleted zone fall back to no zone (delivery
    // fee 0 / "not set") via the FK's ON DELETE SET NULL — never left
    // pointing at a zone that no longer exists.
    await pool.query('DELETE FROM delivery_zones WHERE id = $1', [id]);
  },

  async setVendorDeliveryZone(vendorId, zoneId) {
    const { rows } = await pool.query(
      `UPDATE users SET delivery_zone_id = $1 WHERE id = $2 AND role = 'vendor' RETURNING id`,
      [zoneId || null, vendorId]
    );
    return rows.length > 0;
  },

  async getAllDeliveryRegions() {
    const { rows } = await pool.query('SELECT * FROM delivery_regions ORDER BY sort_order ASC, created_at ASC');
    return rows.map(this.rowToDeliveryRegion);
  },

  async getDeliveryRegionById(id) {
    const { rows } = await pool.query('SELECT * FROM delivery_regions WHERE id = $1', [id]);
    return rows[0] ? this.rowToDeliveryRegion(rows[0]) : null;
  },

  async getDeliveryRegionByName(name) {
    if (!name) return null;
    const { rows } = await pool.query('SELECT * FROM delivery_regions WHERE lower(name) = lower($1)', [name]);
    return rows[0] ? this.rowToDeliveryRegion(rows[0]) : null;
  },

  async createDeliveryRegion({ id, name, sortOrder }) {
    const { rows } = await pool.query(
      `INSERT INTO delivery_regions (id, name, sort_order) VALUES ($1, $2, $3) RETURNING *`,
      [id, name, sortOrder || 0]
    );
    return this.rowToDeliveryRegion(rows[0]);
  },

  async updateDeliveryRegion(id, { name, sortOrder }) {
    const sets = [];
    const values = [];
    let i = 1;
    if (name !== undefined) { sets.push(`name = $${i}`); values.push(name); i += 1; }
    if (sortOrder !== undefined) { sets.push(`sort_order = $${i}`); values.push(sortOrder); i += 1; }
    if (sets.length === 0) return this.getDeliveryRegionById(id);
    sets.push('updated_at = now()');
    values.push(id);
    const { rows } = await pool.query(`UPDATE delivery_regions SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return rows[0] ? this.rowToDeliveryRegion(rows[0]) : null;
  },

  async deleteDeliveryRegion(id) {
    // Zones in this region fall back to "Unassigned" (region_id NULL) via
    // the FK's ON DELETE SET NULL — never left pointing at a deleted
    // region, and never deleted themselves just because their region was.
    await pool.query('DELETE FROM delivery_regions WHERE id = $1', [id]);
  },

  // Bulk import used by the Super Admin "Import Regions & Zones" flow.
  // `regions` is [{ name, zones: [{ code, name, fee }] }], already parsed
  // and validated by the caller (server.js) from the pasted text. Matching
  // is by name (case-insensitive) for regions and by code for zones, so
  // re-importing the same list later updates fees/names in place instead
  // of creating duplicates — the whole point of a code being a stable key
  // (see schema.sql's comment on delivery_zones.code). Runs as one
  // transaction: either the whole list is applied, or none of it is.
  async importDeliveryZones(regions) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existingRegionRows } = await client.query('SELECT * FROM delivery_regions');
      const { rows: existingZoneRows } = await client.query('SELECT * FROM delivery_zones');
      const regionByName = new Map(existingRegionRows.map(r => [String(r.name).toLowerCase(), r]));
      const zoneByCode = new Map(existingZoneRows.filter(z => z.code).map(z => [z.code, z]));
      const usedRegionIds = new Set(existingRegionRows.map(r => r.id));
      const usedZoneIds = new Set(existingZoneRows.map(z => z.id));
      let regionSortOrder = existingRegionRows.length;
      let zoneSortOrder = existingZoneRows.length;
      const summary = { regionsCreated: 0, regionsUpdated: 0, zonesCreated: 0, zonesUpdated: 0 };

      const uniqueId = (base, used) => {
        let id = base;
        let suffix = 2;
        while (used.has(id)) { id = `${base}_${suffix}`; suffix += 1; }
        used.add(id);
        return id;
      };

      for (const region of regions) {
        let regionRow = regionByName.get(region.name.toLowerCase());
        if (!regionRow) {
          const id = uniqueId(slugify(region.name, 'region'), usedRegionIds);
          const { rows } = await client.query(
            `INSERT INTO delivery_regions (id, name, sort_order) VALUES ($1, $2, $3) RETURNING *`,
            [id, region.name, regionSortOrder]
          );
          regionRow = rows[0];
          regionByName.set(region.name.toLowerCase(), regionRow);
          regionSortOrder += 1;
          summary.regionsCreated += 1;
        } else {
          summary.regionsUpdated += 1;
        }

        for (const zone of region.zones) {
          const existingZone = zoneByCode.get(zone.code);
          if (existingZone) {
            await client.query(
              `UPDATE delivery_zones SET name = $1, fee = $2, region_id = $3, updated_at = now() WHERE id = $4`,
              [zone.name, zone.fee, regionRow.id, existingZone.id]
            );
            summary.zonesUpdated += 1;
          } else {
            const id = uniqueId(slugify(`${zone.code}_${zone.name}`, 'zone'), usedZoneIds);
            const { rows } = await client.query(
              `INSERT INTO delivery_zones (id, name, code, region_id, fee, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
              [id, zone.name, zone.code, regionRow.id, zone.fee, zoneSortOrder]
            );
            zoneByCode.set(zone.code, rows[0]);
            zoneSortOrder += 1;
            summary.zonesCreated += 1;
          }
        }
      }

      await client.query('COMMIT');
      return summary;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ---- Login history ---------------------------------------------------

  async recordLogin({ id, userId, ipAddress, device, browser }) {
    await pool.query(
      `INSERT INTO login_history (id, user_id, ip_address, device, browser) VALUES ($1, $2, $3, $4, $5)`,
      [id, userId, ipAddress, device, browser]
    );
  },

  async getLoginHistory(userId, limit = 20) {
    const { rows } = await pool.query(
      'SELECT * FROM login_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return rows.map(rowToLoginHistory);
  },

  // Fail-open by design: if the session row doesn't exist (e.g. the
  // history insert failed at login time — a real but rare case), this
  // returns false rather than locking the person out. Login history is
  // a convenience; it should never become a way to break login itself.
  async isSessionRevoked(sessionId) {
    if (!sessionId) return false;
    const { rows } = await pool.query('SELECT revoked_at FROM login_history WHERE id = $1', [sessionId]);
    if (!rows[0]) return false;
    return rows[0].revoked_at !== null;
  },

  // Ownership-checked — a user (or admin viewing their own history)
  // can only revoke sessions that are actually theirs.
  async revokeSession(sessionId, userId) {
    const { rows } = await pool.query(
      'UPDATE login_history SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id',
      [sessionId, userId]
    );
    return rows.length > 0;
  },

  // ---- Full data export (Backup & Restore > Export Database) ----------

  async exportAllData() {
    const [orders, expenses, agents, users] = await Promise.all([
      this.getAllOrders(),
      this.getAllExpenses(),
      this.getAllAgents(),
      pool.query('SELECT id, business_name, email, phone, role, created_at FROM users'),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      orders,
      expenses,
      agents,
      customers: users.rows.map(u => ({
        id: u.id,
        businessName: u.business_name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        createdAt: u.created_at,
      })), // password hashes deliberately excluded
    };
  },

  // ---- Restore Database -------------------------------------------------
  // Deliberately restores ONLY what exportAllData() actually captures:
  // orders, expenses, agents. Customer/vendor ACCOUNTS are never touched
  // by a restore — the export excludes password hashes (correctly, for
  // security), so recreating those rows here would leave every restored
  // account unable to log in. An identity/auth table should never be
  // silently destroyed and rebuilt by a data restore anyway; this is a
  // deliberate scope limit, not an oversight.

  // Dry-run — checks the file's shape and cross-references it against
  // the CURRENT database (specifically: do the customers referenced by
  // these orders still exist?) without changing anything. Real restore
  // execution is a separate step, gated on this passing.
  async validateRestorePayload(data) {
    const errors = [];
    if (!data || !Array.isArray(data.orders) || !Array.isArray(data.expenses) || !Array.isArray(data.agents)) {
      return {
        valid: false,
        errors: ["This doesn't look like a real export from this app — expected orders/expenses/agents arrays weren't found."],
        counts: null, missingSenderIds: [],
      };
    }
    const senderIds = [...new Set(data.orders.map(o => o.senderId).filter(Boolean))];
    let missingSenderIds = [];
    if (senderIds.length > 0) {
      const { rows } = await pool.query('SELECT id FROM users WHERE id = ANY($1)', [senderIds]);
      const existing = new Set(rows.map(r => r.id));
      missingSenderIds = senderIds.filter(id => !existing.has(id));
    }
    if (missingSenderIds.length > 0) {
      errors.push(`${missingSenderIds.length} order(s) in this file belong to customer account(s) that no longer exist in this database (likely deleted since this backup was taken) — restore cancelled rather than creating orders with a broken reference.`);
    }
    return {
      valid: errors.length === 0,
      errors,
      counts: { orders: data.orders.length, expenses: data.expenses.length, agents: data.agents.length },
      missingSenderIds,
    };
  },

  // Real restore — replaces every current order/expense/agent with the
  // ones in the file, inside one transaction (all-or-nothing: if any
  // row fails to insert, everything rolls back and nothing changes).
  async restoreFromExport(data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM orders');
      await client.query('DELETE FROM expenses');
      await client.query('DELETE FROM agents');

      for (const o of data.orders) {
        await client.query(
          `INSERT INTO orders (id, sender_id, sender_name, pickup_address, dropoff_address, item_description, amount, status, accepted_by, payment_method, placed_by_admin, created_at, accepted_at, picked_up_at, delivered_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [o.id, o.senderId, o.senderName, o.pickupAddress, o.dropoffAddress, o.itemDescription, o.amount,
           o.status, o.acceptedBy || null, o.paymentMethod || null, !!o.placedByAdmin,
           o.createdAt, o.acceptedAt || null, o.pickedUpAt || null, o.deliveredAt || null]
        );
      }
      for (const e of data.expenses) {
        await client.query(
          `INSERT INTO expenses (id, date, amount, description) VALUES ($1,$2,$3,$4)`,
          [e.id, e.date, e.amount, e.description]
        );
      }
      for (const a of data.agents) {
        await client.query(
          `INSERT INTO agents (id, name, phone, duty_status) VALUES ($1,$2,$3,$4)`,
          [a.id, a.name, a.phone, a.dutyStatus || 'off_duty']
        );
      }

      await client.query('COMMIT');
      return { ordersRestored: data.orders.length, expensesRestored: data.expenses.length, agentsRestored: data.agents.length };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ---- Customers (aggregated from users + orders) ---------------------

  async getCustomers() {
    const { rows } = await pool.query(`
      SELECT
        u.id, u.business_name, u.email, u.phone, u.created_at, u.is_disabled,
        COUNT(o.id)::int AS total_orders,
        COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'delivered'), 0)::numeric AS total_spent,
        MAX(o.created_at) AS last_order_at
      FROM users u
      LEFT JOIN orders o ON o.sender_id = u.id
      WHERE u.role = 'sender'
      GROUP BY u.id
      ORDER BY total_orders DESC, u.business_name ASC
    `);
    return rows.map(r => ({
      id: r.id,
      businessName: r.business_name,
      email: r.email,
      phone: r.phone,
      createdAt: r.created_at,
      isDisabled: r.is_disabled,
      totalOrders: r.total_orders,
      totalSpent: Number(r.total_spent),
      lastOrderAt: r.last_order_at,
    }));
  },

  // Super Admin editing a customer's own account details directly —
  // scoped to role = 'sender' so this can never be pointed at a
  // vendor or admin account by accident.
  async updateCustomerByAdmin(id, { businessName, email, phone }) {
    const { rows } = await pool.query(
      `UPDATE users SET business_name = $1, email = $2, phone = $3
       WHERE id = $4 AND role = 'sender' RETURNING *`,
      [businessName, email.toLowerCase(), phone || null, id]
    );
    return rowToUser(rows[0]);
  },

  // Super Admin editing a staff (Manage Agent) account directly — scoped
  // to role = 'admin' so this can never be pointed at any other account.
  // Reused for every staff account now, not just a single fixed one.
  async updateManageAgentAccount(id, { businessName, email, phone }) {
    const { rows } = await pool.query(
      `UPDATE users SET business_name = $1, email = $2, phone = $3
       WHERE id = $4 AND role = 'admin' RETURNING *`,
      [businessName, email.toLowerCase(), phone || null, id]
    );
    return rowToUser(rows[0]);
  },

  // Real delete — cascades to the customer's own orders, purchases,
  // reviews, wishlist, addresses, conversations, and messages (all
  // foreign keys to users.id are ON DELETE CASCADE). This is genuinely
  // destructive and irreversible; the caller is responsible for real
  // confirmation before calling this. Scoped to role = 'sender' so
  // this endpoint can never delete a vendor or admin account.
  async deleteCustomer(id) {
    const { rows } = await pool.query(
      `DELETE FROM users WHERE id = $1 AND role = 'sender' RETURNING id`,
      [id]
    );
    return rows.length > 0;
  },

  // Same real, irreversible, cascading delete as deleteCustomer above,
  // scoped to role = 'vendor' instead — a vendor's products, purchases,
  // reviews, promotions, etc. all reference users(id) with the same
  // cascade behavior products/purchases already rely on elsewhere in
  // this file.
  async deleteVendor(id) {
    const { rows } = await pool.query(
      `DELETE FROM users WHERE id = $1 AND role = 'vendor' RETURNING id`,
      [id]
    );
    return rows.length > 0;
  },

  // ---- Vendors (real vendor accounts — Super Admin oversight) --------
  // NOTE: this app is still single-tenant for ORDER data — there is no
  // per-vendor isolation of orders/agents/expenses yet, those stay one
  // shared dataset until the marketplace's own data model exists. But
  // vendor ACCOUNTS themselves are real and distinct (role = 'vendor'),
  // including the approval workflow below — this was previously (and
  // wrongly) querying role = 'admin' instead, a leftover from before
  // real vendor accounts existed.
  async getVendors() {
    // is_premium is computed with the same left-join-and-check pattern
    // used everywhere else in this file (rather than a stored flag) —
    // see isSubscriptionCurrentlyActive's comment (Premium is
    // paid-subscription-only now, free/admin_comp grants were removed).
    const { rows } = await pool.query(
      `SELECT u.id, u.business_name, u.email, u.phone, u.approval_status, u.rejection_reason, u.applied_at, u.created_at, u.is_disabled, u.commission_rate_override, u.vendor_type,
         (vs.id IS NOT NULL) AS is_premium
       FROM users u
       LEFT JOIN vendor_subscriptions vs ON vs.vendor_id = u.id AND vs.status = 'active'
         AND vs.current_period_end IS NOT NULL AND vs.current_period_end > now()
       WHERE u.role = 'vendor' ORDER BY u.created_at DESC`
    );
    return rows.map(r => ({
      id: r.id,
      businessName: r.business_name,
      email: r.email,
      phone: r.phone,
      approvalStatus: r.approval_status,
      rejectionReason: r.rejection_reason || null,
      appliedAt: r.applied_at,
      createdAt: r.created_at,
      isDisabled: r.is_disabled,
      commissionRateOverride: r.commission_rate_override !== null && r.commission_rate_override !== undefined ? Number(r.commission_rate_override) : null,
      vendorType: r.vendor_type || 'store',
      isPremium: !!r.is_premium,
    }));
  },

  // ---- Staff accounts — role = 'admin' ("Manage Agent") or
  // 'super_admin', shown together in one list so Change Role has
  // something to toggle between. No approval workflow (a Super Admin
  // creating one here IS the approval, same as Add Vendor/Add Delivery
  // Company), so no approval_status/rejection_reason/applied_at
  // columns to select. ----
  async getStaffAccounts() {
    const { rows } = await pool.query(
      "SELECT id, business_name, email, phone, role, created_at, is_disabled, disabled_features FROM users WHERE role IN ('admin', 'super_admin') ORDER BY (role = 'super_admin') DESC, created_at ASC"
    );
    return rows.map(r => ({
      id: r.id,
      businessName: r.business_name,
      email: r.email,
      phone: r.phone,
      role: r.role,
      createdAt: r.created_at,
      isDisabled: r.is_disabled,
      disabledFeatures: r.disabled_features || [],
    }));
  },

  // ---- Delivery Companies (multi-provider fleets — same real
  // self-registration + Super Admin approval workflow as vendors
  // above, mirrored exactly, scoped to role = 'delivery_company'). ----
  async getDeliveryCompanies() {
    const { rows } = await pool.query(
      "SELECT id, business_name, email, phone, approval_status, rejection_reason, applied_at, created_at, is_disabled, commission_rate_override FROM users WHERE role = 'delivery_company' ORDER BY created_at DESC"
    );
    return rows.map(r => ({
      id: r.id,
      businessName: r.business_name,
      email: r.email,
      phone: r.phone,
      approvalStatus: r.approval_status,
      rejectionReason: r.rejection_reason || null,
      appliedAt: r.applied_at,
      createdAt: r.created_at,
      isDisabled: r.is_disabled,
      commissionRateOverride: r.commission_rate_override !== null && r.commission_rate_override !== undefined ? Number(r.commission_rate_override) : null,
    }));
  },

  // Lightweight list for the Fleet Directory's "which delivery company
  // owns this agent" picker (see the agent:create/agent:update comment
  // in server.js). Any admin-like account needs this, not just Super
  // Admin — but unlike getDeliveryCompanies() above, this only returns
  // companies actually able to receive a new agent right now (approved,
  // not disabled), and skips management-only fields (rejection reason,
  // commission override) the picker has no use for.
  async getActiveDeliveryCompaniesForFleetPicker() {
    const { rows } = await pool.query(
      "SELECT id, business_name FROM users WHERE role = 'delivery_company' AND approval_status = 'approved' AND is_disabled = false ORDER BY business_name ASC"
    );
    return rows.map(r => ({ id: r.id, businessName: r.business_name }));
  },

  // reason is required by the caller (server.js) when status ===
  // 'rejected'; when status === 'approved' (or any other value), the
  // previous rejection reason — if any — is cleared automatically, so
  // a fresh approval never carries a stale explanation forward.
  async setDeliveryCompanyApprovalStatus(id, status, reason = null) {
    const { rows } = await pool.query(
      "UPDATE users SET approval_status = $1, rejection_reason = $2 WHERE id = $3 AND role = 'delivery_company' RETURNING *",
      [status, status === 'rejected' ? reason : null, id]
    );
    return rowToUser(rows[0]);
  },

  async getDeliveryCompanyApplicationDocuments(id) {
    const { rows } = await pool.query(
      "SELECT business_registration_doc, id_document_type, id_document_doc FROM users WHERE id = $1 AND role = 'delivery_company'",
      [id]
    );
    if (!rows[0]) return null;
    return {
      businessRegistrationDoc: rows[0].business_registration_doc,
      idDocumentType: rows[0].id_document_type,
      idDocumentDoc: rows[0].id_document_doc,
    };
  },

  async getVendorApplicationDocuments(vendorId) {
    const { rows } = await pool.query(
      "SELECT business_registration_doc, id_document_type, id_document_doc FROM users WHERE id = $1 AND role = 'vendor'",
      [vendorId]
    );
    if (!rows[0]) return null;
    return {
      businessRegistrationDoc: rows[0].business_registration_doc,
      idDocumentType: rows[0].id_document_type,
      idDocumentDoc: rows[0].id_document_doc,
    };
  },

  // Same reason-handling as setDeliveryCompanyApprovalStatus above —
  // required by the caller when rejecting, cleared on any other status.
  async setVendorApprovalStatus(vendorId, status, reason = null) {
    const { rows } = await pool.query(
      "UPDATE users SET approval_status = $1, rejection_reason = $2 WHERE id = $3 AND role = 'vendor' RETURNING *",
      [status, status === 'rejected' ? reason : null, vendorId]
    );
    return rowToUser(rows[0]);
  },

  // ---- Price presets (Settings > Pricing) ------------------------------

  async getAllPricePresets() {
    const { rows } = await pool.query('SELECT * FROM price_presets ORDER BY amount ASC');
    return rows.map(rowToPricePreset);
  },

  async createPricePreset({ id, label, amount }) {
    const { rows } = await pool.query(
      'INSERT INTO price_presets (id, label, amount) VALUES ($1, $2, $3) RETURNING *',
      [id, label, amount]
    );
    return rowToPricePreset(rows[0]);
  },

  async deletePricePreset(id) {
    await pool.query('DELETE FROM price_presets WHERE id = $1', [id]);
  },

  // Bulk-insert path used by the PDF import (Settings > Pricing >
  // Import from PDF) — takes the reviewed/confirmed rows from the
  // parse-preview step and creates them all in one transaction, same
  // "all or nothing" reasoning as everywhere else in this app that
  // writes several related rows together. Each preset still gets a
  // real, independently-deletable row afterward — this is just a
  // faster way to create many of them than the single-add form.
  async bulkCreatePricePresets(presets) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = [];
      for (const p of presets) {
        const { rows } = await client.query(
          'INSERT INTO price_presets (id, label, amount) VALUES ($1, $2, $3) RETURNING *',
          [crypto.randomUUID(), p.label, p.amount]
        );
        created.push(rowToPricePreset(rows[0]));
      }
      await client.query('COMMIT');
      return created;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ---- Marketplace: products -----------------------------------------

  async getProductsByVendor(vendorId) {
    const { rows } = await pool.query(`
      SELECT p.*,
        (
          SELECT json_agg(json_build_object('id', pi.id, 'imageDataUrl', pi.image_data_url) ORDER BY pi.position, pi.created_at)
          FROM product_images pi WHERE pi.product_id = p.id
        ) AS extra_images
      FROM products p WHERE p.vendor_id = $1 ORDER BY p.created_at DESC
    `, [vendorId]);
    return rows.map(r => ({ ...rowToProduct(r), images: r.extra_images || [] }));
  },

  // Storefront listing — every active product from every vendor, with
  // the vendor's business name attached so the storefront can show it.
  // Featured Placements boost: a product with its own active featured_until,
  // or belonging to a vendor with an active featured_until, sorts ahead
  // of everything else — product-level boost first, then vendor-level,
  // then the existing recency order. This is the server-side "relevance"
  // order the client's default Newest sort now preserves instead of
  // re-sorting purely by createdAt (see sortStorefrontProducts in
  // index.html) — an explicit Price/Rating sort still overrides it, same
  // as most marketplaces treat paid placement as a relevance-view thing
  // rather than something that fights an explicit sort choice.
  async getActiveProductsForStorefront() {
    const { rows } = await pool.query(`
      SELECT p.*, u.business_name AS vendor_name, u.phone AS vendor_phone, u.store_address AS vendor_store_address,
        u.featured_until AS vendor_featured_until, u.delivery_zone_id AS vendor_delivery_zone_id,
        COALESCE(AVG(r.rating), 0)::numeric AS avg_rating,
        COUNT(DISTINCT r.id)::int AS review_count,
        COALESCE(sold.units_sold, 0)::int AS units_sold,
        promo.discount_percent, promo.ends_at AS promo_ends_at,
        (
          SELECT json_agg(json_build_object('id', pi.id, 'imageDataUrl', pi.image_data_url) ORDER BY pi.position, pi.created_at)
          FROM product_images pi WHERE pi.product_id = p.id
        ) AS extra_images
      FROM products p
      JOIN users u ON u.id = p.vendor_id
      LEFT JOIN product_reviews r ON r.product_id = p.id
      LEFT JOIN (
        SELECT product_id, SUM(quantity)::int AS units_sold
        FROM purchase_items
        GROUP BY product_id
      ) sold ON sold.product_id = p.id
      LEFT JOIN (
        SELECT DISTINCT ON (product_id) product_id, discount_percent, ends_at
        FROM promotions
        WHERE starts_at <= now() AND ends_at > now()
        ORDER BY product_id, ends_at ASC
      ) promo ON promo.product_id = p.id
      WHERE p.is_active = true AND p.stock_quantity > 0 AND u.vendor_type = 'store'
      GROUP BY p.id, u.business_name, u.phone, u.store_address, u.featured_until, u.delivery_zone_id, sold.units_sold, promo.discount_percent, promo.ends_at
      ORDER BY
        (p.featured_until IS NOT NULL AND p.featured_until > now()) DESC,
        (u.featured_until IS NOT NULL AND u.featured_until > now()) DESC,
        p.created_at DESC
    `);
    return rows.map(r => {
      const originalPrice = Number(r.price);
      const discountPercent = r.discount_percent ? Number(r.discount_percent) : null;
      const effectivePrice = discountPercent ? Number((originalPrice * (1 - discountPercent / 100)).toFixed(2)) : originalPrice;
      return {
        ...rowToProduct(r),
        vendorName: r.vendor_name,
        vendorPhone: r.vendor_phone,
        vendorStoreAddress: r.vendor_store_address,
        // Real, admin-assigned zone id (see schema.sql's comment on
        // delivery_zones) — the frontend looks up its fee from the
        // public /api/delivery-zones list rather than this query
        // embedding the fee redundantly on every single product row.
        vendorDeliveryZoneId: r.vendor_delivery_zone_id || null,
        avgRating: Number(r.avg_rating),
        reviewCount: r.review_count,
        unitsSold: r.units_sold,
        originalPrice,
        price: effectivePrice, // the price everywhere else in the app already reads
        discountPercent,
        promoEndsAt: r.promo_ends_at,
        images: r.extra_images || [],
      };
    });
  },

  // ONLib Delivery's restaurant menu — deliberately a separate query
  // from getActiveProductsForStorefront above, not a client-side filter
  // of it: that one is now Marketplace-only (vendor_type = 'store'), so
  // restaurant dishes need their own path that never touches the
  // Marketplace product feed. Same shape/fields as the Marketplace
  // query (rating, reviews, promo price) so the dish cards work
  // identically, just scoped to one restaurant vendor.
  async getRestaurantMenu(vendorId) {
    const { rows } = await pool.query(`
      SELECT p.*, u.business_name AS vendor_name, u.phone AS vendor_phone, u.store_address AS vendor_store_address,
        u.delivery_zone_id AS vendor_delivery_zone_id,
        COALESCE(AVG(r.rating), 0)::numeric AS avg_rating,
        COUNT(DISTINCT r.id)::int AS review_count,
        promo.discount_percent, promo.ends_at AS promo_ends_at
      FROM products p
      JOIN users u ON u.id = p.vendor_id
      LEFT JOIN product_reviews r ON r.product_id = p.id
      LEFT JOIN (
        SELECT DISTINCT ON (product_id) product_id, discount_percent, ends_at
        FROM promotions
        WHERE starts_at <= now() AND ends_at > now()
        ORDER BY product_id, ends_at ASC
      ) promo ON promo.product_id = p.id
      WHERE p.is_active = true AND p.vendor_id = $1 AND u.vendor_type = 'restaurant'
      GROUP BY p.id, u.business_name, u.phone, u.store_address, u.delivery_zone_id, promo.discount_percent, promo.ends_at
      ORDER BY p.created_at DESC
    `, [vendorId]);
    return rows.map(r => {
      const originalPrice = Number(r.price);
      const discountPercent = r.discount_percent ? Number(r.discount_percent) : null;
      const effectivePrice = discountPercent ? Number((originalPrice * (1 - discountPercent / 100)).toFixed(2)) : originalPrice;
      return {
        ...rowToProduct(r),
        vendorName: r.vendor_name,
        vendorPhone: r.vendor_phone,
        vendorStoreAddress: r.vendor_store_address,
        vendorDeliveryZoneId: r.vendor_delivery_zone_id || null,
        avgRating: Number(r.avg_rating),
        reviewCount: r.review_count,
        originalPrice,
        price: effectivePrice,
        discountPercent,
        promoEndsAt: r.promo_ends_at,
      };
    });
  },

  // Super Admin product moderation — every product from every vendor,
  // active or hidden, in or out of stock (unlike getActiveProductsForStorefront,
  // which is deliberately filtered for the customer-facing feed).
  async getAllProductsForModeration() {
    const { rows } = await pool.query(`
      SELECT p.*, u.business_name AS vendor_name
      FROM products p
      JOIN users u ON u.id = p.vendor_id
      ORDER BY p.created_at DESC
    `);
    return rows.map(r => ({ ...rowToProduct(r), vendorName: r.vendor_name }));
  },

  async getActiveDeals() {
    const products = await db.getActiveProductsForStorefront();
    return products.filter(p => p.discountPercent);
  },

  async getProductById(id) {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    return rowToProduct(rows[0]);
  },

  async createProduct({ id, vendorId, name, description, price, category, imageDataUrl, stockQuantity, colors, sizes, sizeChart, lowStockThreshold }) {
    const { rows } = await pool.query(
      `INSERT INTO products (id, vendor_id, name, description, price, category, image_data_url, stock_quantity, colors, sizes, size_chart, low_stock_threshold)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        id, vendorId, name, description || null, price, category || null, imageDataUrl || null, stockQuantity || 0,
        // Explicit JSON.stringify before handing JSONB columns to pg —
        // matches the one other JSONB write site in this file
        // (createAuditLogEntry) rather than relying on implicit
        // serialization. Empty/absent lists are stored as NULL, same as
        // "no variants" everywhere else, instead of an empty-array JSONB
        // value — keeps "does this product have variants" a simple NULL
        // check in every SQL query that needs it.
        colors && colors.length ? JSON.stringify(colors) : null,
        sizes && sizes.length ? JSON.stringify(sizes) : null,
        sizeChart ? JSON.stringify(sizeChart) : null,
        lowStockThreshold != null && lowStockThreshold !== '' ? Number(lowStockThreshold) : null,
      ]
    );
    return rowToProduct(rows[0]);
  },

  async updateProduct(id, fields) {
    const colMap = {
      name: 'name', description: 'description', price: 'price', category: 'category',
      imageDataUrl: 'image_data_url', stockQuantity: 'stock_quantity', isActive: 'is_active',
      colors: 'colors', sizes: 'sizes', sizeChart: 'size_chart', lowStockThreshold: 'low_stock_threshold',
    };
    // These three are JSONB columns — stringify explicitly (see
    // createProduct above) and normalize empty arrays/falsy to NULL
    // rather than storing '[]', so "no variants" stays a plain NULL
    // check everywhere.
    const jsonKeys = new Set(['colors', 'sizes', 'sizeChart']);
    const sets = []; const values = []; let i = 1;
    for (const [key, col] of Object.entries(colMap)) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        let value = fields[key];
        if (jsonKeys.has(key)) {
          value = value && (Array.isArray(value) ? value.length : true) ? JSON.stringify(value) : null;
        } else if (key === 'lowStockThreshold') {
          value = value != null && value !== '' ? Number(value) : null;
        }
        sets.push(`${col} = $${i}`); values.push(value); i += 1;
      }
    }
    // A vendor explicitly changing the stock count (almost always a
    // restock) clears any previously-sent low-stock alert, so the next
    // scan re-evaluates from scratch instead of staying permanently
    // silenced after the one alert that already went out.
    if (Object.prototype.hasOwnProperty.call(fields, 'stockQuantity')) {
      sets.push('low_stock_alert_sent_at = NULL');
    }
    if (sets.length === 0) return this.getProductById(id);
    values.push(id);
    const { rows } = await pool.query(`UPDATE products SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return rowToProduct(rows[0]);
  },

  // Best-effort periodic scan (see the setInterval in server.js) for
  // products that have dropped to/below their vendor-set low-stock
  // threshold. low_stock_alert_sent_at IS NULL is the re-fire guard —
  // cleared automatically whenever a vendor explicitly changes the stock
  // count (see updateProduct above), so this fires once per "dip" below
  // the threshold rather than on every scan tick.
  async getProductsNeedingLowStockAlert() {
    const { rows } = await pool.query(
      `SELECT p.*, u.business_name AS vendor_name, u.email AS vendor_email, u.phone AS vendor_phone
       FROM products p
       JOIN users u ON u.id = p.vendor_id
       WHERE p.is_active = true AND p.low_stock_threshold IS NOT NULL
         AND p.stock_quantity <= p.low_stock_threshold
         AND p.low_stock_alert_sent_at IS NULL`
    );
    return rows.map(r => ({
      ...rowToProduct(r),
      vendorName: r.vendor_name,
      vendorEmail: r.vendor_email,
      vendorPhone: r.vendor_phone,
    }));
  },

  async markLowStockAlertSent(productId) {
    await pool.query('UPDATE products SET low_stock_alert_sent_at = now() WHERE id = $1', [productId]);
  },

  async deleteProduct(id) {
    await pool.query('DELETE FROM products WHERE id = $1', [id]); // product_variants rows cascade-delete with it
  },

  // ---- Marketplace: per-variant stock (color/size combinations) --------

  // Replaces this product's whole set of per-variant stock rows and
  // recomputes products.stock_quantity as their SUM in the same
  // transaction, so the cached pooled total (read by every other
  // stock-aware code path in the app) never drifts out of sync with the
  // real per-variant numbers. Simplest correct way to handle a vendor
  // adding/removing a color or size combo is to just delete-and-reinsert
  // the whole set rather than diffing against what was there before.
  // Must be called AFTER colors/sizes are already saved on the product
  // (createProduct/updateProduct) — server.js validates each entry's
  // color/size against the product's own declared lists before calling
  // this, so this function trusts its input.
  async setProductVariantStock(productId, variantStock) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM product_variants WHERE product_id = $1', [productId]);
      let total = 0;
      if (variantStock && variantStock.length) {
        for (const v of variantStock) {
          const qty = Math.max(0, Math.floor(Number(v.stockQuantity) || 0));
          total += qty;
          await client.query(
            'INSERT INTO product_variants (id, product_id, color, size, stock_quantity) VALUES ($1, $2, $3, $4, $5)',
            [crypto.randomUUID(), productId, v.color || '', v.size || '', qty]
          );
        }
      }
      // Same re-fire-guard reasoning as updateProduct's stockQuantity
      // branch above — a vendor setting per-variant stock counts as
      // "changing the stock", so any previously-sent low-stock alert is
      // cleared for re-evaluation on the next scan.
      await client.query('UPDATE products SET stock_quantity = $1, low_stock_alert_sent_at = NULL WHERE id = $2', [total, productId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getProductById(productId);
  },

  // Used by the vendor product form (edit mode) to pre-fill the
  // per-combination stock grid — [] for a product with no variant rows
  // (a plain pooled-stock product, the majority case).
  async getProductVariants(productId) {
    const { rows } = await pool.query(
      'SELECT * FROM product_variants WHERE product_id = $1 ORDER BY color, size', [productId]
    );
    return rows.map(r => ({ id: r.id, color: r.color, size: r.size, stockQuantity: r.stock_quantity }));
  },

  // Cleanup-only path (no products.stock_quantity touch) for when a
  // vendor removes a product's colors/sizes entirely and goes back to
  // plain pooled stock — the pooled number in that case comes from
  // whatever stockQuantity value the same update request submitted
  // (handled by updateProduct's ordinary column set), so this just
  // clears any now-orphaned variant rows. A no-op if there were none.
  async deleteProductVariants(productId) {
    await pool.query('DELETE FROM product_variants WHERE product_id = $1', [productId]);
  },

  // ---- Marketplace: additional product photos (gallery) ----------------

  async countProductImages(productId) {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM product_images WHERE product_id = $1', [productId]);
    return rows[0].count;
  },

  async addProductImage({ id, productId, imageDataUrl }) {
    const { rows: posRows } = await pool.query('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM product_images WHERE product_id = $1', [productId]);
    const { rows } = await pool.query(
      'INSERT INTO product_images (id, product_id, image_data_url, position) VALUES ($1, $2, $3, $4) RETURNING *',
      [id, productId, imageDataUrl, posRows[0].next_position]
    );
    return { id: rows[0].id, productId: rows[0].product_id, imageDataUrl: rows[0].image_data_url };
  },

  // Scoped to product_id too, not just the image id — so a vendor can
  // never delete an image belonging to a product that isn't theirs
  // (the route also checks product ownership, but this is cheap
  // belt-and-suspenders since it's a single indexed WHERE clause).
  async deleteProductImage(id, productId) {
    const { rowCount } = await pool.query('DELETE FROM product_images WHERE id = $1 AND product_id = $2', [id, productId]);
    return rowCount > 0;
  },

  // ---- Marketplace: home-screen hero carousel ---------------------------

  // Public — storefront-facing, active slides only, in display order.
  async getActiveHomeBanners() {
    const { rows } = await pool.query('SELECT * FROM home_banners WHERE is_active = true ORDER BY position ASC, created_at ASC');
    return rows.map(rowToHomeBanner);
  },

  // Super Admin — every slide (including hidden ones), in display order.
  async getAllHomeBanners() {
    const { rows } = await pool.query('SELECT * FROM home_banners ORDER BY position ASC, created_at ASC');
    return rows.map(rowToHomeBanner);
  },

  async countHomeBanners() {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM home_banners');
    return rows[0].count;
  },

  async getHomeBannerById(id) {
    const { rows } = await pool.query('SELECT * FROM home_banners WHERE id = $1', [id]);
    return rowToHomeBanner(rows[0]);
  },

  async createHomeBanner({ id, eyebrow, headline, subtext, ctaText, ctaLink, imageDataUrl }) {
    const { rows: posRows } = await pool.query('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM home_banners');
    const { rows } = await pool.query(
      `INSERT INTO home_banners (id, position, eyebrow, headline, subtext, cta_text, cta_link, image_data_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, posRows[0].next_position, eyebrow || null, headline, subtext || null, ctaText || 'Shop Now', ctaLink || null, imageDataUrl || null]
    );
    return rowToHomeBanner(rows[0]);
  },

  async updateHomeBanner(id, fields) {
    const colMap = {
      eyebrow: 'eyebrow', headline: 'headline', subtext: 'subtext', ctaText: 'cta_text',
      ctaLink: 'cta_link', imageDataUrl: 'image_data_url', isActive: 'is_active',
    };
    const sets = ['updated_at = now()']; const values = []; let i = 1;
    for (const [key, col] of Object.entries(colMap)) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        sets.push(`${col} = $${i}`); values.push(fields[key]); i += 1;
      }
    }
    if (sets.length === 1) return this.getHomeBannerById(id);
    values.push(id);
    const { rows } = await pool.query(`UPDATE home_banners SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return rowToHomeBanner(rows[0]);
  },

  async deleteHomeBanner(id) {
    await pool.query('DELETE FROM home_banners WHERE id = $1', [id]);
  },

  // Swaps this slide's position with its immediate neighbor in the
  // requested direction — simple, dependency-free reordering for a
  // list capped at 3 items (no need for a full drag-and-drop reorder).
  async moveHomeBanner(id, direction) {
    const banners = await this.getAllHomeBanners();
    const idx = banners.findIndex(b => b.id === id);
    if (idx === -1) return null;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= banners.length) return banners;
    const a = banners[idx]; const b = banners[swapIdx];
    await pool.query('UPDATE home_banners SET position = $1 WHERE id = $2', [b.position, a.id]);
    await pool.query('UPDATE home_banners SET position = $1 WHERE id = $2', [a.position, b.id]);
    return this.getAllHomeBanners();
  },

  // ---- Marketplace: checkout + purchases -------------------------------

  // Runs as a single transaction: validates stock, decrements it,
  // creates the purchase + line items, and (per the "Shop & Delivery"
  // default) a linked delivery order in the existing `orders` table for
  // fulfillment — all-or-nothing, so a failed delivery-order insert
  // can't leave stock decremented with no purchase recorded.
  //
  // paymentMethod/paymentStatus/momoReferenceId/momoPhone default to
  // plain pay-on-delivery (the original behavior, unchanged for the
  // existing COD checkout call site). The Mobile Money checkout route
  // passes 'momo'/'pending'/a fresh UUID/the payer's phone instead, AND
  // passes createDeliveryOrder: false — stock still gets reserved and
  // the purchase still gets created immediately (so nobody else can buy
  // the last unit out from under a payment that's about to succeed),
  // but the delivery order itself is deliberately NOT created yet: it
  // would otherwise show up in the live delivery queue (getAllOrders
  // has no concept of payment_status) before the customer has actually
  // paid. pickupAddress/dropoffAddress are stashed on the purchase row
  // instead and turned into a real order later, only once
  // confirmMomoPaymentAndCreateOrder sees the payment succeed.
  async checkout({
    customerId, customerName, vendorId, items, pickupAddress, dropoffAddress, createDeliveryOrder,
    paymentMethod = 'cod', paymentStatus = 'not_applicable', momoReferenceId = null, momoPhone = null,
    paymentProvider = null, couponCode = null, deliveryFee = 0, externalPaymentReference = null,
    checkoutBatchId = null, skipReferenceGeneration = false,
  }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // For the manual Mobile Money flow only: generate the short code
      // the customer types into their own transfer and a Super Admin
      // later matches by hand (see the payment_reference comment in
      // schema.sql). Generated inside this same transaction, checked
      // against the DB fresh each attempt — the unique index on
      // payment_reference is the real backstop against a collision
      // slipping through a race between two simultaneous checkouts,
      // this loop is just what keeps that backstop from ever actually
      // firing in practice (900,000 possible codes, checked before use).
      let paymentReference = externalPaymentReference;
      // A multi-vendor checkout batch shares ONE reference across all
      // its purchases (so the customer sends one payment, once) — the
      // orchestrator (see the /api/marketplace/checkout/multi routes)
      // generates it once via the FIRST vendor group's ordinary
      // checkout() call, then passes skipReferenceGeneration: true for
      // every other vendor group in that same batch, since
      // payment_reference has a real uniqueness constraint (see
      // schema.sql) — those sibling purchases store no reference of
      // their own and are matched via checkout_batch_id instead. An
      // ordinary single-vendor checkout (the normal, unaffected case)
      // never sets skipReferenceGeneration, so it generates its own
      // reference exactly as before.
      if (paymentMethod === 'momo_manual' && !paymentReference && !skipReferenceGeneration) {
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = `REF-${crypto.randomInt(100000, 1000000)}`;
          const { rows: existing } = await client.query('SELECT 1 FROM purchases WHERE payment_reference = $1', [candidate]);
          if (!existing.length) { paymentReference = candidate; break; }
        }
        if (!paymentReference) throw new Error('Could not generate a unique payment reference — please try again');
      }

      let totalAmount = 0;
      const lineItems = [];
      for (const item of items) {
        const productRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [item.productId]);
        const product = productRes.rows[0];
        if (!product) throw new Error(`Product not found: ${item.productId}`);
        if (product.vendor_id !== vendorId) throw new Error('All items in a checkout must be from the same vendor');

        // Never trust the client's claimed color/size — re-check against
        // this product's CURRENT option lists, fetched fresh inside the
        // same transaction, same "don't trust the client" posture as the
        // price/stock checks below. A product with a colors/sizes list
        // defined requires a valid matching pick; a product with no list
        // defined ignores whatever the client sent (there's nothing to
        // validate against, and nothing to snapshot).
        const productColors = product.colors || [];
        const productSizes = product.sizes || [];
        let selectedColor = null;
        let selectedSize = null;
        if (productColors.length) {
          if (!item.selectedColor || !productColors.some(c => c.name === item.selectedColor)) {
            throw new Error(`Please choose a color for ${product.name}`);
          }
          selectedColor = item.selectedColor;
        }
        if (productSizes.length) {
          if (!item.selectedSize || !productSizes.includes(item.selectedSize)) {
            throw new Error(`Please choose a size for ${product.name}`);
          }
          selectedSize = item.selectedSize;
        }

        // Real per-variant stock for products that declare colors/sizes;
        // pooled products.stock_quantity for everything else (the majority
        // of listings — no behavior change for them at all). When a variant
        // row is decremented, products.stock_quantity is decremented by the
        // same amount in the same transaction so it stays a correct cached
        // SUM for every other stock-reading code path in the app.
        if (productColors.length || productSizes.length) {
          const variantRes = await client.query(
            'SELECT * FROM product_variants WHERE product_id = $1 AND color = $2 AND size = $3 FOR UPDATE',
            [product.id, selectedColor || '', selectedSize || '']
          );
          const variant = variantRes.rows[0];
          if (!variant) throw new Error(`That option is no longer available for ${product.name}`);
          if (variant.stock_quantity < item.quantity) throw new Error(`Not enough stock for ${product.name}`);
          await client.query('UPDATE product_variants SET stock_quantity = stock_quantity - $1 WHERE id = $2', [item.quantity, variant.id]);
          await client.query('UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2', [item.quantity, product.id]);
        } else {
          if (product.stock_quantity < item.quantity) throw new Error(`Not enough stock for ${product.name}`);
          await client.query('UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2', [item.quantity, product.id]);
        }

        // Real price, looked up fresh in the same transaction — never
        // trusts a client-supplied price, and always reflects any
        // currently-active promotion discount, not just the list price.
        const promoRes = await client.query(
          'SELECT discount_percent FROM promotions WHERE product_id = $1 AND starts_at <= now() AND ends_at > now() LIMIT 1',
          [product.id]
        );
        const discountPercent = promoRes.rows[0] ? Number(promoRes.rows[0].discount_percent) : 0;
        const unitPrice = discountPercent
          ? Number((Number(product.price) * (1 - discountPercent / 100)).toFixed(2))
          : Number(product.price);

        const lineTotal = unitPrice * item.quantity;
        totalAmount += lineTotal;
        lineItems.push({
          productId: product.id, productName: product.name, unitPrice, quantity: item.quantity,
          selectedColor, selectedSize,
        });
      }

      // Real coupon validation and application — looked up fresh inside
      // this same transaction (never trusts a client-supplied discount
      // amount), same "don't trust the client" posture as the price/
      // stock/variant checks above. Every rejection reason throws, which
      // rolls back the whole checkout — a coupon either fully applies or
      // the checkout fails with a clear reason, never a silent partial
      // apply. FOR UPDATE on the coupon row prevents a max_uses race
      // between two simultaneous checkouts both using the last redemption.
      let coupon = null;
      let discountAmount = 0;
      if (couponCode && couponCode.trim()) {
        const couponRes = await client.query(
          'SELECT * FROM coupons WHERE vendor_id = $1 AND code = $2 FOR UPDATE',
          [vendorId, couponCode.trim().toUpperCase()]
        );
        coupon = couponRes.rows[0];
        if (!coupon) throw new Error('That coupon code is not valid for this store');
        if (!coupon.is_active) throw new Error('That coupon code is no longer active');
        if (new Date(coupon.starts_at) > new Date()) throw new Error('That coupon code is not active yet');
        if (coupon.ends_at && new Date(coupon.ends_at) <= new Date()) throw new Error('That coupon code has expired');
        if (coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses) {
          throw new Error('That coupon code has reached its usage limit');
        }
        if (coupon.min_order_amount !== null && totalAmount < Number(coupon.min_order_amount)) {
          throw new Error(`That coupon requires an order of at least $${Number(coupon.min_order_amount).toFixed(2)}`);
        }
        if (coupon.per_customer_limit !== null) {
          const usedRes = await client.query(
            'SELECT COUNT(*)::int AS count FROM coupon_redemptions WHERE coupon_id = $1 AND customer_id = $2',
            [coupon.id, customerId]
          );
          if (usedRes.rows[0].count >= coupon.per_customer_limit) {
            throw new Error("You've already used that coupon code the maximum number of times");
          }
        }
        discountAmount = coupon.discount_type === 'percent'
          ? Number((totalAmount * Number(coupon.discount_value) / 100).toFixed(2))
          : Math.min(Number(coupon.discount_value), totalAmount); // never discount below $0
      }

      const purchaseId = `PUR-${Date.now().toString(36).toUpperCase()}`;
      let deliveryOrderId = null;

      if (createDeliveryOrder) {
        deliveryOrderId = `ORD-${Date.now().toString(36).toUpperCase()}M`; // 'M' suffix avoids colliding with a same-millisecond regular order id
        // Fold the picked variant into the plain-text summary too — this
        // string is what a delivery agent/vendor actually reads to know
        // what to pack, so "2x T-Shirt" alone would silently drop which
        // color/size to send once products can have variants at all.
        const itemSummary = lineItems.map(li => {
          const variantBits = [li.selectedColor, li.selectedSize].filter(Boolean).join(', ');
          return `${li.quantity}x ${li.productName}${variantBits ? ` (${variantBits})` : ''}`;
        }).join(', ');
        await client.query(
          `INSERT INTO orders (id, sender_id, sender_name, pickup_address, dropoff_address, item_description, amount, status, placed_by_admin, delivery_fee)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', false, $8)`,
          [deliveryOrderId, customerId, customerName, pickupAddress, dropoffAddress, `Marketplace order: ${itemSummary}`, null, deliveryFee]
        );
      }

      // Only stashed when the delivery order wasn't created yet (the
      // Mobile Money path) — for the normal COD path the real order
      // already has these, so there's nothing left to hold onto.
      const pendingPickupAddress = !createDeliveryOrder ? pickupAddress : null;
      const pendingDropoffAddress = !createDeliveryOrder ? dropoffAddress : null;

      // The flat platform service fee, snapshotted at checkout — read
      // fresh inside this same transaction rather than trusting a
      // value computed earlier, same "never trust a stale price"
      // posture as the per-item price/promotion lookups above. Stored
      // in its own column, never folded into total_amount, so it's
      // never counted as this vendor's gross revenue (see
      // getPayoutSummary's commission math).
      const feeRes = await client.query("SELECT service_fee FROM platform_settings WHERE id = 'platform'");
      const serviceFee = feeRes.rows[0] ? Number(feeRes.rows[0].service_fee) : 0;

      await client.query(
        `INSERT INTO purchases (id, customer_id, vendor_id, total_amount, service_fee, delivery_order_id, payment_method, payment_status, momo_reference_id, momo_phone, payment_provider, payment_reference, pending_pickup_address, pending_dropoff_address, coupon_id, coupon_code, discount_amount, delivery_fee, checkout_batch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [purchaseId, customerId, vendorId, totalAmount, serviceFee, deliveryOrderId, paymentMethod, paymentStatus, momoReferenceId, momoPhone, paymentProvider, paymentReference, pendingPickupAddress, pendingDropoffAddress, coupon ? coupon.id : null, coupon ? coupon.code : null, discountAmount, deliveryFee, checkoutBatchId]
      );
      for (const li of lineItems) {
        await client.query(
          `INSERT INTO purchase_items (id, purchase_id, product_id, product_name, unit_price, quantity, selected_color, selected_size) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [crypto.randomUUID(), purchaseId, li.productId, li.productName, li.unitPrice, li.quantity, li.selectedColor, li.selectedSize]
        );
      }

      // Redeem the coupon — bump the aggregate counter and record a real
      // per-customer redemption row (what per_customer_limit above
      // actually counts against next time), both inside this same
      // transaction so a checkout that fails after this point can never
      // consume a redemption without a matching purchase existing.
      if (coupon) {
        await client.query('UPDATE coupons SET uses_count = uses_count + 1 WHERE id = $1', [coupon.id]);
        await client.query(
          'INSERT INTO coupon_redemptions (id, coupon_id, customer_id, purchase_id) VALUES ($1, $2, $3, $4)',
          [crypto.randomUUID(), coupon.id, customerId, purchaseId]
        );
      }

      await client.query('COMMIT');
      const grandTotal = Math.round((totalAmount - discountAmount + serviceFee + deliveryFee) * 100) / 100;
      return { purchaseId, deliveryOrderId, totalAmount, serviceFee, deliveryFee, discountAmount, couponCode: coupon ? coupon.code : null, grandTotal, paymentMethod, paymentStatus, paymentProvider, paymentReference, checkoutBatchId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async getPurchasesByVendor(vendorId, limit = 50) {
    const { rows } = await pool.query(`
      SELECT p.*, u.business_name AS customer_name, o.status AS delivery_status,
        o.requested_delivery_company_id, o.dispatch_requested_at, dc.business_name AS requested_delivery_company_name
      FROM purchases p
      JOIN users u ON u.id = p.customer_id
      LEFT JOIN orders o ON o.id = p.delivery_order_id
      LEFT JOIN users dc ON dc.id = o.requested_delivery_company_id
      WHERE p.vendor_id = $1 AND p.vendor_dismissed = false
      ORDER BY p.created_at DESC
      LIMIT $2
    `, [vendorId, limit]);
    return rows.map(r => ({
      ...rowToPurchase(r),
      customerName: r.customer_name,
      deliveryStatus: r.delivery_status,
      requestedDeliveryCompanyId: r.requested_delivery_company_id || null,
      requestedDeliveryCompanyName: r.requested_delivery_company_name || null,
      dispatchRequestedAt: r.dispatch_requested_at || null,
    }));
  },

  // A rejected Mobile Money payment is a closed matter — see
  // schema.sql's comment on vendor_dismissed. Scoped to payment_status
  // = 'failed' in the WHERE clause itself so a vendor can never dismiss
  // a live order this way, not even by guessing an id.
  async dismissVendorPurchase(purchaseId, vendorId) {
    const { rows } = await pool.query(`
      UPDATE purchases SET vendor_dismissed = true
      WHERE id = $1 AND vendor_id = $2 AND payment_status = 'failed'
      RETURNING *
    `, [purchaseId, vendorId]);
    return rows[0] ? rowToPurchase(rows[0]) : null;
  },

  // Unbounded version of the above, used only for the vendor's own
  // Monthly Report PDF — that needs every purchase in the selected
  // month/year, not just the most recent 50 (the cap the Orders tab
  // list uses, which is fine for a UI list but would silently
  // undercount a busy or older month's totals). Same shape as
  // getPurchasesByVendor otherwise.
  async getAllPurchasesByVendor(vendorId) {
    const { rows } = await pool.query(`
      SELECT p.*, u.business_name AS customer_name, o.status AS delivery_status
      FROM purchases p
      JOIN users u ON u.id = p.customer_id
      LEFT JOIN orders o ON o.id = p.delivery_order_id
      WHERE p.vendor_id = $1
      ORDER BY p.created_at DESC
    `, [vendorId]);
    return rows.map(r => ({ ...rowToPurchase(r), customerName: r.customer_name, deliveryStatus: r.delivery_status }));
  },

  // Every purchase on the whole platform, unbounded, with both the
  // customer and vendor name joined in — used only by Super Admin's
  // Platform Report (Monthly/Weekly), which needs the full marketplace
  // picture, not one vendor's slice of it.
  async getAllPurchases() {
    const { rows } = await pool.query(`
      SELECT p.*, cu.business_name AS customer_name, vu.business_name AS vendor_name, o.status AS delivery_status
      FROM purchases p
      JOIN users cu ON cu.id = p.customer_id
      JOIN users vu ON vu.id = p.vendor_id
      LEFT JOIN orders o ON o.id = p.delivery_order_id
      ORDER BY p.created_at DESC
    `);
    return rows.map(r => ({ ...rowToPurchase(r), customerName: r.customer_name, vendorName: r.vendor_name, deliveryStatus: r.delivery_status }));
  },

  // Real customer-facing purchase history — vendor name, real delivery
  // status (via the linked delivery order), and the actual items
  // bought (name/price/quantity + the product's CURRENT image, since
  // no image snapshot is stored at purchase time — if a product was
  // later deleted or its photo changed, this reflects that rather than
  // showing a stale copy).
  async getPurchasesByCustomer(customerId, limit = 50) {
    const { rows } = await pool.query(`
      SELECT p.*, u.business_name AS vendor_name, o.status AS delivery_status,
        (
          SELECT json_agg(json_build_object(
            'productId', pi.product_id,
            'productName', pi.product_name,
            'unitPrice', pi.unit_price,
            'quantity', pi.quantity,
            'imageDataUrl', prod.image_data_url,
            'selectedColor', pi.selected_color,
            'selectedSize', pi.selected_size
          ) ORDER BY pi.id)
          FROM purchase_items pi
          LEFT JOIN products prod ON prod.id = pi.product_id
          WHERE pi.purchase_id = p.id
        ) AS items
      FROM purchases p
      JOIN users u ON u.id = p.vendor_id
      LEFT JOIN orders o ON o.id = p.delivery_order_id
      WHERE p.customer_id = $1
      ORDER BY p.created_at DESC
      LIMIT $2
    `, [customerId, limit]);
    return rows.map(r => ({
      ...rowToPurchase(r),
      vendorName: r.vendor_name,
      deliveryStatus: r.delivery_status,
      items: (r.items || []).map(i => ({
        productId: i.productId, productName: i.productName,
        unitPrice: Number(i.unitPrice), quantity: i.quantity, imageDataUrl: i.imageDataUrl,
        selectedColor: i.selectedColor, selectedSize: i.selectedSize,
      })),
    }));
  },

  async getPurchaseItems(purchaseId) {
    const { rows } = await pool.query('SELECT * FROM purchase_items WHERE purchase_id = $1', [purchaseId]);
    return rows.map(r => ({
      id: r.id, productId: r.product_id, productName: r.product_name, unitPrice: Number(r.unit_price), quantity: r.quantity,
      selectedColor: r.selected_color, selectedSize: r.selected_size,
    }));
  },

  // Single-purchase lookup — used by the disputes endpoints to verify
  // a customer actually owns the purchase they're filing a dispute
  // against, without pulling their whole purchase history.
  async getPurchaseById(id) {
    const { rows } = await pool.query('SELECT * FROM purchases WHERE id = $1', [id]);
    return rowToPurchase(rows[0]);
  },

  // Super Admin's manual Mobile Money reconciliation queue — every
  // purchase still waiting on a Super Admin to match its
  // payment_reference against a real received payment and confirm it
  // by hand. Same shape/purpose as getPendingDirectFeaturedSlots()
  // above for Featured Placements' 'direct' payment method, just
  // scoped to marketplace purchases instead.
  async getPendingManualMomoPurchases() {
    const { rows } = await pool.query(`
      SELECT p.*, c.business_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
        v.business_name AS vendor_name
      FROM purchases p
      JOIN users c ON c.id = p.customer_id
      JOIN users v ON v.id = p.vendor_id
      WHERE p.payment_method = 'momo_manual' AND p.payment_status = 'pending'
      ORDER BY p.created_at ASC
    `);
    return rows.map(r => ({
      ...rowToPurchase(r),
      customerName: r.customer_name,
      customerEmail: r.customer_email,
      customerPhone: r.customer_phone,
      vendorName: r.vendor_name,
    }));
  },

  // Vendor requests cancellation of a not-yet-confirmed Mobile Money
  // purchase — see schema.sql's comment on vendor_cancel_requested for
  // why this is a flag on the existing purchase rather than a new
  // status/approval flow. Scoped to payment_method = 'momo_manual' AND
  // payment_status = 'pending' in the WHERE clause itself (not just
  // checked by the caller) so this can never silently "succeed" against
  // a purchase that's already been confirmed, rejected, or was never a
  // Mobile Money purchase to begin with — the UPDATE just matches zero
  // rows and the caller treats that as not-found/not-eligible.
  async requestVendorPurchaseCancellation(purchaseId, vendorId, reason) {
    const { rows } = await pool.query(`
      UPDATE purchases
      SET vendor_cancel_requested = true, vendor_cancel_reason = $1, vendor_cancel_requested_at = now()
      WHERE id = $2 AND vendor_id = $3 AND payment_method = 'momo_manual' AND payment_status = 'pending'
      RETURNING *
    `, [reason || null, purchaseId, vendorId]);
    return rows[0] ? rowToPurchase(rows[0]) : null;
  },

  // Vendor dispatches a ready-for-delivery order to a specific
  // delivery company — see schema.sql's comment on orders.
  // requested_delivery_company_id. WHERE o.id = $2 AND pu.vendor_id =
  // $3 AND o.status = 'pending' guards this the same way: a vendor can
  // only dispatch their own order, and only while it's still
  // unaccepted (dispatching an already-accepted order would just be
  // confusing, not meaningful).
  async dispatchOrderToDeliveryCompany(orderId, vendorId, deliveryCompanyId) {
    const { rows } = await pool.query(`
      UPDATE orders o
      SET requested_delivery_company_id = $1, dispatch_requested_at = now()
      FROM purchases pu
      WHERE o.id = $2 AND pu.delivery_order_id = o.id AND pu.vendor_id = $3 AND o.status = 'pending'
      RETURNING o.*
    `, [deliveryCompanyId, orderId, vendorId]);
    return rows[0] ? rowToOrder(rows[0]) : null;
  },

  // ---- Self-service returns — distinct from disputes, see the
  // schema.sql comment on return_requests. ----

  _returnRequestSelect() {
    return `SELECT rr.*, pr.total_amount AS purchase_total_amount, cust.business_name AS customer_name
      FROM return_requests rr
      JOIN purchases pr ON pr.id = rr.purchase_id
      JOIN users cust ON cust.id = rr.customer_id`;
  },

  _rowToReturnRequest(r) {
    if (!r) return null;
    return {
      id: r.id,
      purchaseId: r.purchase_id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      vendorId: r.vendor_id,
      reason: r.reason,
      description: r.description,
      status: r.status,
      vendorNote: r.vendor_note,
      refundAmount: r.refund_amount === null || r.refund_amount === undefined ? null : Number(r.refund_amount),
      purchaseAmount: r.purchase_total_amount === null || r.purchase_total_amount === undefined ? null : Number(r.purchase_total_amount),
      resolvedAt: r.resolved_at,
      createdAt: r.created_at,
    };
  },

  async createReturnRequest({ id, purchaseId, customerId, vendorId, reason, description }) {
    const { rows } = await pool.query(
      `INSERT INTO return_requests (id, purchase_id, customer_id, vendor_id, reason, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, purchaseId, customerId, vendorId, reason, description || null]
    );
    return this._rowToReturnRequest(rows[0]);
  },

  async getReturnRequestByPurchase(purchaseId) {
    const { rows } = await pool.query(`${this._returnRequestSelect()} WHERE rr.purchase_id = $1`, [purchaseId]);
    return this._rowToReturnRequest(rows[0]);
  },

  async getReturnRequestById(id) {
    const { rows } = await pool.query(`${this._returnRequestSelect()} WHERE rr.id = $1`, [id]);
    return this._rowToReturnRequest(rows[0]);
  },

  async getReturnRequestsForCustomer(customerId) {
    const { rows } = await pool.query(
      `${this._returnRequestSelect()} WHERE rr.customer_id = $1 ORDER BY rr.created_at DESC`,
      [customerId]
    );
    return rows.map(r => this._rowToReturnRequest(r));
  },

  // Vendor's own review queue — the equivalent of Super Admin's
  // dispute queue, but scoped to this vendor and with no Super Admin
  // step: the vendor decides directly (see resolveReturnRequest).
  async getReturnRequestsForVendor(vendorId, { status } = {}) {
    const values = [vendorId];
    let where = 'WHERE rr.vendor_id = $1';
    if (status) { values.push(status); where += ` AND rr.status = $${values.length}`; }
    const { rows } = await pool.query(
      `${this._returnRequestSelect()} ${where} ORDER BY (rr.status = 'requested') DESC, rr.created_at DESC`,
      values
    );
    return rows.map(r => this._rowToReturnRequest(r));
  },

  // requested -> approved|rejected (vendor's first decision), or
  // approved -> refunded (vendor confirms the refund happened). Scoped
  // to the expected "from" status so a return can't be double-decided
  // or refunded before being approved; returns null (not an error) if
  // that guard fails, same 409-on-null pattern as resolveDispute.
  async resolveReturnRequest(id, { status, vendorNote, refundAmount }) {
    const fromStatus = status === 'refunded' ? 'approved' : 'requested';
    const { rows } = await pool.query(
      `UPDATE return_requests SET status = $1, vendor_note = $2, refund_amount = $3, resolved_at = now()
       WHERE id = $4 AND status = $5 RETURNING *`,
      [status, vendorNote || null, refundAmount || null, id, fromStatus]
    );
    return this._rowToReturnRequest(rows[0]);
  },

  // ---- Live in-app support chat — one thread per user account,
  // distinct from vendor<->customer conversations (support is
  // platform-run, not scoped to any one vendor). See the
  // support_messages comment in schema.sql. ----

  async getSupportMessages(userId) {
    const { rows } = await pool.query(
      `SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId]
    );
    return rows.map(rowToSupportMessage);
  },

  async createSupportMessage({ id, userId, senderRole, body }) {
    const { rows } = await pool.query(
      `INSERT INTO support_messages (id, user_id, sender_role, body) VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, userId, senderRole, body]
    );
    return rowToSupportMessage(rows[0]);
  },

  // Marks the OTHER side's messages read — called when the user opens
  // their own thread (marks 'support' messages read) or when support
  // opens a user's thread (marks 'user' messages read). Mirrors the
  // read-on-open pattern GET /api/conversations/:id/messages already
  // uses for vendor<->customer messaging.
  async markSupportMessagesRead(userId, readerRole) {
    const otherRole = readerRole === 'user' ? 'support' : 'user';
    await pool.query(
      `UPDATE support_messages SET read_at = now() WHERE user_id = $1 AND sender_role = $2 AND read_at IS NULL`,
      [userId, otherRole]
    );
  },

  // Support inbox (admin-facing) — one row per user who has ever
  // messaged support, most-recently-active first, with a last-message
  // preview and an unread count (messages from the user support hasn't
  // read yet) so the inbox can show what needs a reply first.
  async getSupportThreadsForAdmin() {
    const { rows } = await pool.query(`
      SELECT u.id AS user_id, u.business_name AS user_name, u.role AS user_role,
        (SELECT body FROM support_messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_message,
        (SELECT created_at FROM support_messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
        (SELECT COUNT(*) FROM support_messages WHERE user_id = u.id AND sender_role = 'user' AND read_at IS NULL)::int AS unread_count
      FROM users u
      WHERE EXISTS (SELECT 1 FROM support_messages sm WHERE sm.user_id = u.id)
      ORDER BY last_message_at DESC
    `);
    return rows.map(r => ({
      userId: r.user_id,
      userName: r.user_name,
      userRole: r.user_role,
      lastMessage: r.last_message,
      lastMessageAt: r.last_message_at,
      unreadCount: r.unread_count,
    }));
  },

  // Admin "New Message" recipient picker — a lightweight, role-scoped
  // directory search, deliberately separate from getCustomers()/
  // getVendors()/getDeliveryCompanies() (which carry extra fields
  // those pages need — order totals, approval status, etc. — and are
  // gated by different feature/role checks). This one is scoped
  // entirely to role IN ('sender','vendor','delivery_company') —
  // enforced by the caller passing only a whitelisted role — and
  // capped at 50 results, same convention as every other search box
  // in this app (Fleet Directory, Customers, Order History).
  async searchMessagingDirectory(role, search) {
    const term = (search || '').trim();
    const { rows } = await pool.query(
      `SELECT id, business_name, email, phone FROM users
       WHERE role = $1
         AND ($2 = '' OR business_name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%' OR phone ILIKE '%' || $2 || '%')
       ORDER BY business_name ASC
       LIMIT 50`,
      [role, term]
    );
    return rows.map(r => ({ id: r.id, businessName: r.business_name, email: r.email, phone: r.phone }));
  },

  // Admin "message everyone in this group" broadcast — writes one
  // support_messages row per recipient (sender_role='support'), same
  // table and shape a normal reply uses, so from each recipient's own
  // Chat with Support it looks exactly like Support messaged them
  // individually. Skips disabled accounts (nothing gained by writing
  // a message a suspended account can never read). A single bulk
  // INSERT via unnest() rather than one query per recipient — this
  // app has no other bulk-insert precedent to follow, so this is
  // written to scale to a few thousand recipients without issuing
  // that many round trips.
  async broadcastSupportMessage({ role, body }) {
    const { rows: recipients } = await pool.query(
      `SELECT id FROM users WHERE role = $1 AND is_disabled = false`,
      [role]
    );
    if (recipients.length === 0) return [];
    const ids = recipients.map(() => crypto.randomUUID());
    const userIds = recipients.map(r => r.id);
    const { rows } = await pool.query(
      `INSERT INTO support_messages (id, user_id, sender_role, body)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
       RETURNING *`,
      [ids, userIds, userIds.map(() => 'support'), userIds.map(() => body)]
    );
    return rows.map(rowToSupportMessage);
  },

  // ---- Web Push (VAPID) subscriptions — see push.js for the send
  // side. A user can have more than one (a phone and a laptop both
  // subscribed), so this is a plain list, not a single row per user. ----

  // ON CONFLICT (endpoint) rather than a plain INSERT: re-subscribing
  // (e.g. the browser silently rotated the push endpoint's keys, or the
  // same device re-registered) should update the existing row, not
  // throw on the UNIQUE(endpoint) constraint or create a duplicate.
  async upsertPushSubscription({ id, userId, endpoint, p256dh, auth }) {
    const { rows } = await pool.query(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $2, p256dh = $4, auth = $5
       RETURNING *`,
      [id, userId, endpoint, p256dh, auth]
    );
    return rows[0];
  },

  async deletePushSubscriptionByEndpoint(endpoint) {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  },

  async getPushSubscriptionsForUser(userId) {
    const { rows } = await pool.query(
      'SELECT * FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );
    return rows.map(r => ({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }));
  },

  // Real sales overview for the vendor dashboard — total revenue and
  // order count over the last N days, no fabricated trend line.
  async getVendorSalesOverview(vendorId, days = 30) {
    const { rows } = await pool.query(`
      SELECT COALESCE(SUM(total_amount), 0)::numeric AS total_sales, COUNT(*)::int AS total_orders
      FROM purchases
      WHERE vendor_id = $1 AND created_at > now() - ($2 || ' days')::interval
        AND (payment_method = 'cod' OR payment_status = 'successful')
    `, [vendorId, days]);
    return { totalSales: Number(rows[0].total_sales), totalOrders: rows[0].total_orders };
  },

  // Real day-by-day revenue for the Sales Overview line chart — no
  // fabricated curve, actual sums grouped by day. Same "cod or
  // confirmed" filter as getVendorSalesOverview above — a still-
  // unconfirmed or rejected Mobile Money payment was never real
  // revenue, so it shouldn't shape this chart either.
  async getVendorDailySales(vendorId, days = 30) {
    const { rows } = await pool.query(`
      SELECT date_trunc('day', created_at) AS day, COALESCE(SUM(total_amount), 0)::numeric AS total
      FROM purchases
      WHERE vendor_id = $1 AND created_at > now() - ($2 || ' days')::interval
        AND (payment_method = 'cod' OR payment_status = 'successful')
      GROUP BY day
      ORDER BY day ASC
    `, [vendorId, days]);
    return rows.map(r => ({ day: r.day, total: Number(r.total) }));
  },

  // ---- Product reviews (real ratings, not fabricated) ------------------

  // A customer can only review a product they actually bought — checked
  // via purchase_items/purchases joined to this customer, matching the
  // rest of this app's "don't trust the client, verify against real
  // records" pattern.
  async hasCustomerPurchasedFromVendor(customerId, vendorId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM purchases WHERE customer_id = $1 AND vendor_id = $2 LIMIT 1`,
      [customerId, vendorId]
    );
    return rows.length > 0;
  },

  async upsertVendorReview({ id, vendorId, customerId, rating, comment }) {
    const { rows } = await pool.query(`
      INSERT INTO vendor_reviews (id, vendor_id, customer_id, rating, comment)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (vendor_id, customer_id) DO UPDATE SET rating = $4, comment = $5, created_at = now()
      RETURNING *
    `, [id, vendorId, customerId, rating, comment || null]);
    return rows[0];
  },

  // Reviewer name shown as "J*** D***"-style would need real PII
  // masking logic we don't have — this app already shows full
  // customer/business names elsewhere (e.g. product reviews), so
  // vendor reviews follow the same existing convention rather than
  // inventing a new privacy rule just for this feature.
  async getVendorReviews(vendorId) {
    const { rows } = await pool.query(`
      SELECT vr.*, u.business_name AS customer_name
      FROM vendor_reviews vr
      JOIN users u ON u.id = vr.customer_id
      WHERE vr.vendor_id = $1
      ORDER BY vr.created_at DESC
    `, [vendorId]);
    return rows.map(r => ({
      id: r.id,
      vendorId: r.vendor_id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.created_at,
    }));
  },

  async hasCustomerPurchasedProduct(customerId, productId) {
    const { rows } = await pool.query(`
      SELECT 1 FROM purchase_items pi
      JOIN purchases p ON p.id = pi.purchase_id
      WHERE p.customer_id = $1 AND pi.product_id = $2
      LIMIT 1
    `, [customerId, productId]);
    return rows.length > 0;
  },

  async upsertProductReview({ id, productId, customerId, rating, comment }) {
    const { rows } = await pool.query(`
      INSERT INTO product_reviews (id, product_id, customer_id, rating, comment)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (product_id, customer_id) DO UPDATE SET rating = $4, comment = $5
      RETURNING *
    `, [id, productId, customerId, rating, comment || null]);
    return rows[0];
  },

  async getProductReviews(productId) {
    const { rows } = await pool.query(`
      SELECT r.*, u.business_name AS customer_name
      FROM product_reviews r
      JOIN users u ON u.id = r.customer_id
      WHERE r.product_id = $1
      ORDER BY r.created_at DESC
    `, [productId]);
    return rows.map(r => ({
      id: r.id, rating: r.rating, comment: r.comment, customerName: r.customer_name, createdAt: r.created_at,
    }));
  },

  // ---- Product Q&A -------------------------------------------------------
  // Anyone logged in as a customer can ask; only the product's own vendor
  // can answer (see server.js's ownership check on the answer route) —
  // simpler than open peer-answering, matching this app's existing
  // "vendor is responsible for their own listings" posture elsewhere.

  async getProductQuestions(productId) {
    const { rows } = await pool.query(
      `SELECT id, asker_name, question, answer, answered_at, created_at
       FROM product_questions WHERE product_id = $1 ORDER BY created_at DESC`,
      [productId]
    );
    return rows.map(r => ({
      id: r.id, askerName: r.asker_name, question: r.question, answer: r.answer,
      answeredAt: r.answered_at, createdAt: r.created_at,
    }));
  },

  async createProductQuestion({ id, productId, askerId, askerName, question }) {
    const { rows } = await pool.query(
      `INSERT INTO product_questions (id, product_id, asker_id, asker_name, question)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, asker_name, question, answer, answered_at, created_at`,
      [id, productId, askerId, askerName, question]
    );
    const r = rows[0];
    return { id: r.id, askerName: r.asker_name, question: r.question, answer: r.answer, answeredAt: r.answered_at, createdAt: r.created_at };
  },

  // Ownership-checked the same way product PUT/DELETE routes already
  // are in server.js: only succeeds when this question's product
  // actually belongs to vendorId — the UPDATE's WHERE clause does the
  // check in one round trip rather than a separate SELECT-then-UPDATE.
  async answerProductQuestion(questionId, vendorId, answer) {
    const { rows } = await pool.query(
      `UPDATE product_questions q SET answer = $1, answered_at = now()
       FROM products p
       WHERE q.id = $2 AND q.product_id = p.id AND p.vendor_id = $3
       RETURNING q.id, q.asker_name, q.question, q.answer, q.answered_at, q.created_at`,
      [answer, questionId, vendorId]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, askerName: r.asker_name, question: r.question, answer: r.answer, answeredAt: r.answered_at, createdAt: r.created_at };
  },

  // ---- Recommended products ("more from this store" on the PDP) --------
  // Same active/in-stock filter as getActiveProductsForStorefront, just
  // scoped to one vendor and excluding the product being viewed — a real
  // backend query rather than a client-side filter, since the client's
  // already-loaded storefrontProducts array isn't guaranteed to be
  // populated yet if a customer opens a product page from Wishlist/Deals
  // without ever having visited the Home tab first.
  async getRelatedVendorProducts(vendorId, excludeProductId, limit = 8) {
    const { rows } = await pool.query(`
      SELECT p.*, u.business_name AS vendor_name,
        COALESCE(AVG(r.rating), 0)::numeric AS avg_rating,
        COUNT(DISTINCT r.id)::int AS review_count,
        COALESCE(sold.units_sold, 0)::int AS units_sold,
        (
          SELECT json_agg(json_build_object('id', pi.id, 'imageDataUrl', pi.image_data_url) ORDER BY pi.position, pi.created_at)
          FROM product_images pi WHERE pi.product_id = p.id
        ) AS extra_images
      FROM products p
      JOIN users u ON u.id = p.vendor_id
      LEFT JOIN product_reviews r ON r.product_id = p.id
      LEFT JOIN (
        SELECT product_id, SUM(quantity)::int AS units_sold
        FROM purchase_items GROUP BY product_id
      ) sold ON sold.product_id = p.id
      WHERE p.vendor_id = $1 AND p.id != $2 AND p.is_active = true AND p.stock_quantity > 0
      GROUP BY p.id, u.business_name, sold.units_sold
      ORDER BY p.created_at DESC
      LIMIT $3
    `, [vendorId, excludeProductId, limit]);
    return rows.map(r => ({
      ...rowToProduct(r),
      vendorName: r.vendor_name,
      avgRating: Number(r.avg_rating),
      reviewCount: r.review_count,
      unitsSold: r.units_sold,
      images: r.extra_images || [],
    }));
  },

  // ---- Per-vendor Marketplace storefront page ("Visit Store") ----------
  // Public — real vendor info + real aggregates (follower count, review
  // average, active listing count), never fabricated. Same shape as
  // getRelatedVendorProducts's vendor fields, just not scoped to
  // excluding one product or a small limit, since this is the page a
  // customer lands on specifically to browse everything this vendor has.
  async getVendorStorefrontProfile(vendorId) {
    const { rows } = await pool.query(`
      SELECT u.id, u.business_name, u.profile_image_url, u.store_address, u.vendor_type, u.created_at,
        COALESCE(vr.avg_rating, 0)::numeric AS avg_rating,
        COALESCE(vr.review_count, 0)::int AS review_count,
        COALESCE(sf.follower_count, 0)::int AS follower_count,
        COALESCE(pc.product_count, 0)::int AS product_count
      FROM users u
      LEFT JOIN (
        SELECT vendor_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
        FROM vendor_reviews GROUP BY vendor_id
      ) vr ON vr.vendor_id = u.id
      LEFT JOIN (
        SELECT vendor_id, COUNT(*) AS follower_count
        FROM store_follows GROUP BY vendor_id
      ) sf ON sf.vendor_id = u.id
      LEFT JOIN (
        SELECT vendor_id, COUNT(*) AS product_count
        FROM products WHERE is_active = true AND stock_quantity > 0 GROUP BY vendor_id
      ) pc ON pc.vendor_id = u.id
      WHERE u.id = $1 AND u.role = 'vendor'
    `, [vendorId]);
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      businessName: r.business_name,
      profileImageUrl: r.profile_image_url,
      storeAddress: r.store_address,
      vendorType: r.vendor_type,
      memberSince: r.created_at,
      avgRating: Number(r.avg_rating),
      reviewCount: r.review_count,
      followerCount: r.follower_count,
      productCount: r.product_count,
    };
  },

  // Every active, in-stock product from one vendor — same shape/filters
  // as getActiveProductsForStorefront, just scoped to a single vendor and
  // with no exclusion or limit (unlike getRelatedVendorProducts, which is
  // for the PDP's small "more from this store" strip).
  async getVendorStorefrontProducts(vendorId) {
    const { rows } = await pool.query(`
      SELECT p.*, u.business_name AS vendor_name,
        COALESCE(AVG(r.rating), 0)::numeric AS avg_rating,
        COUNT(DISTINCT r.id)::int AS review_count,
        COALESCE(sold.units_sold, 0)::int AS units_sold,
        promo.discount_percent, promo.ends_at AS promo_ends_at,
        (
          SELECT json_agg(json_build_object('id', pi.id, 'imageDataUrl', pi.image_data_url) ORDER BY pi.position, pi.created_at)
          FROM product_images pi WHERE pi.product_id = p.id
        ) AS extra_images
      FROM products p
      JOIN users u ON u.id = p.vendor_id
      LEFT JOIN product_reviews r ON r.product_id = p.id
      LEFT JOIN (
        SELECT product_id, SUM(quantity)::int AS units_sold
        FROM purchase_items GROUP BY product_id
      ) sold ON sold.product_id = p.id
      LEFT JOIN (
        SELECT DISTINCT ON (product_id) product_id, discount_percent, ends_at
        FROM promotions
        WHERE starts_at <= now() AND ends_at > now()
        ORDER BY product_id, ends_at ASC
      ) promo ON promo.product_id = p.id
      WHERE p.vendor_id = $1 AND p.is_active = true AND p.stock_quantity > 0
      GROUP BY p.id, u.business_name, sold.units_sold, promo.discount_percent, promo.ends_at
      ORDER BY p.created_at DESC
    `, [vendorId]);
    return rows.map(r => {
      const originalPrice = Number(r.price);
      const discountPercent = r.discount_percent ? Number(r.discount_percent) : null;
      const effectivePrice = discountPercent ? Number((originalPrice * (1 - discountPercent / 100)).toFixed(2)) : originalPrice;
      return {
        ...rowToProduct(r),
        vendorName: r.vendor_name,
        avgRating: Number(r.avg_rating),
        reviewCount: r.review_count,
        unitsSold: r.units_sold,
        originalPrice,
        price: effectivePrice,
        discountPercent,
        promoEndsAt: r.promo_ends_at,
        images: r.extra_images || [],
      };
    });
  },

  // ---- Real co-purchase recommendations ("customers who bought this
  // also bought") ---------------------------------------------------
  // A real query against purchase_items — every other product that has
  // ever shared a purchase (any vendor, not just this one) with the
  // product being viewed, ranked by how many distinct purchases they've
  // co-occurred in. No fabricated "customers who bought X also bought Y"
  // copy here — if nobody has ever bought this product alongside
  // anything else, this simply returns an empty list (the PDP falls
  // back to "More From This Store" in that case — see loadPdpCoPurchased
  // in index.html).
  async getCoPurchasedProducts(productId, limit = 8) {
    const { rows } = await pool.query(`
      SELECT p.*, u.business_name AS vendor_name,
        COALESCE(AVG(r.rating), 0)::numeric AS avg_rating,
        COUNT(DISTINCT r.id)::int AS review_count,
        COALESCE(sold.units_sold, 0)::int AS units_sold,
        co.co_count::int AS co_count,
        (
          SELECT json_agg(json_build_object('id', pi.id, 'imageDataUrl', pi.image_data_url) ORDER BY pi.position, pi.created_at)
          FROM product_images pi WHERE pi.product_id = p.id
        ) AS extra_images
      FROM (
        SELECT pi2.product_id, COUNT(DISTINCT pi1.purchase_id) AS co_count
        FROM purchase_items pi1
        JOIN purchase_items pi2 ON pi2.purchase_id = pi1.purchase_id AND pi2.product_id != pi1.product_id
        WHERE pi1.product_id = $1
        GROUP BY pi2.product_id
      ) co
      JOIN products p ON p.id = co.product_id
      JOIN users u ON u.id = p.vendor_id
      LEFT JOIN product_reviews r ON r.product_id = p.id
      LEFT JOIN (
        SELECT product_id, SUM(quantity)::int AS units_sold
        FROM purchase_items GROUP BY product_id
      ) sold ON sold.product_id = p.id
      WHERE p.is_active = true AND p.stock_quantity > 0
      GROUP BY p.id, u.business_name, co.co_count, sold.units_sold
      ORDER BY co.co_count DESC, p.created_at DESC
      LIMIT $2
    `, [productId, limit]);
    return rows.map(r => ({
      ...rowToProduct(r),
      vendorName: r.vendor_name,
      avgRating: Number(r.avg_rating),
      reviewCount: r.review_count,
      unitsSold: r.units_sold,
      coCount: r.co_count,
      images: r.extra_images || [],
    }));
  },

  // ============================================================
  // Featured Placements — a vendor pays (Mobile Money or a manually-
  // confirmed Direct request) to boost a product or their whole
  // storefront's ranking for a Super-Admin-configured package length.
  // See the long schema.sql comment above featured_slots for the full
  // design reasoning (why featured_until is the source of truth, why
  // capacity uses an advisory lock, why payment_status mirrors
  // purchases.payment_status's pending/successful/failed vocabulary).
  // ============================================================

  async getFeaturedSlotById(id) {
    const { rows } = await pool.query('SELECT * FROM featured_slots WHERE id = $1', [id]);
    return rowToFeaturedSlot(rows[0]);
  },

  async getFeaturedSlotsForVendor(vendorId) {
    const { rows } = await pool.query(
      'SELECT * FROM featured_slots WHERE vendor_id = $1 ORDER BY created_at DESC', [vendorId]
    );
    return rows.map(rowToFeaturedSlot);
  },

  // Super Admin's queue of Direct-payment requests still waiting on a
  // real-world payment to be confirmed — never includes 'momo' rows,
  // those resolve themselves via polling/webhook.
  async getPendingDirectFeaturedSlots() {
    const { rows } = await pool.query(
      `SELECT fs.*, u.business_name AS vendor_name, u.email AS vendor_email, p.name AS product_name
       FROM featured_slots fs
       JOIN users u ON u.id = fs.vendor_id
       LEFT JOIN products p ON p.id = fs.product_id
       WHERE fs.payment_method = 'direct' AND fs.payment_status = 'pending'
       ORDER BY fs.created_at ASC`
    );
    return rows.map(r => ({ ...rowToFeaturedSlot(r), vendorName: r.vendor_name, vendorEmail: r.vendor_email, productName: r.product_name }));
  },

  // How many of each scope's slots are currently taken (active or
  // still-pending-payment, since a pending row already reserves
  // capacity — see the schema.sql comment on why) vs. the configured
  // cap. Used both to block a purchase server-side and to show a
  // vendor "6 of 10 slots available" before they even try.
  async getFeaturedSlotAvailability() {
    const [settings, counts] = await Promise.all([
      this.getPlatformSettings(),
      pool.query(
        `SELECT scope, COUNT(*)::int AS taken FROM featured_slots
         WHERE payment_status = 'pending' OR (payment_status = 'successful' AND ends_at > now())
         GROUP BY scope`
      ),
    ]);
    const takenMap = Object.fromEntries(counts.rows.map(r => [r.scope, r.taken]));
    return {
      product: { cap: settings.featuredProductSlotCap, taken: takenMap.product || 0, available: Math.max(0, settings.featuredProductSlotCap - (takenMap.product || 0)) },
      vendor: { cap: settings.featuredVendorSlotCap, taken: takenMap.vendor || 0, available: Math.max(0, settings.featuredVendorSlotCap - (takenMap.vendor || 0)) },
    };
  },

  // Reserves a slot and creates the purchase row in one transaction.
  // pg_advisory_xact_lock serializes concurrent purchase attempts for
  // the same scope so two vendors can't both squeeze into the last
  // slot — it's released automatically at COMMIT/ROLLBACK, so a crash
  // mid-transaction can never leave it held. Throws a plain Error with
  // a user-facing message on capacity-full, which server.js surfaces
  // as a 409.
  // useCredit/creditSubscriptionId redeem a Premium vendor's included
  // free-boost-per-period perk (see vendor_subscriptions.featured_
  // boost_credits_remaining and platform_settings.premium_featuring_perk
  // = 'credit') — price should be passed as 0 by the caller in that
  // case. The credit decrement and slot creation/activation happen in
  // the same transaction as the capacity check, so a crash mid-request
  // can never consume a credit without granting the slot, or vice versa.
  // The 'discount' perk mode needs no special handling here at all —
  // the caller (server.js) just computes a smaller `price` up front and
  // this function charges it through the normal momo/direct flow.
  async createFeaturedSlotPurchase({ id, vendorId, scope, productId, packageLabel, price, durationDays, paymentMethod, momoReferenceId, momoPhone, useCredit, creditSubscriptionId }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`featured_slot:${scope}`]);
      const settings = await this.getPlatformSettings();
      const cap = scope === 'product' ? settings.featuredProductSlotCap : settings.featuredVendorSlotCap;
      const { rows: countRows } = await client.query(
        `SELECT COUNT(*)::int AS taken FROM featured_slots
         WHERE scope = $1 AND (payment_status = 'pending' OR (payment_status = 'successful' AND ends_at > now()))`,
        [scope]
      );
      if (countRows[0].taken >= cap) {
        await client.query('ROLLBACK');
        throw new Error(`All ${scope === 'product' ? 'product' : 'store'} featured slots are taken right now — try again once one frees up.`);
      }
      if (useCredit) {
        const { rows: creditRows } = await client.query(
          `UPDATE vendor_subscriptions SET featured_boost_credits_remaining = featured_boost_credits_remaining - 1, updated_at = now()
           WHERE id = $1 AND vendor_id = $2 AND featured_boost_credits_remaining > 0 RETURNING id`,
          [creditSubscriptionId, vendorId]
        );
        if (!creditRows[0]) {
          await client.query('ROLLBACK');
          throw new Error('No free Premium boost credit available right now.');
        }
      }
      const { rows } = await client.query(
        `INSERT INTO featured_slots (id, vendor_id, scope, product_id, package_label, price, duration_days, payment_method, payment_status, momo_reference_id, momo_phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10) RETURNING *`,
        // A credit redemption never actually touches MoMo/Direct — it's
        // recorded as 'direct' (no external reference) so the Super
        // Admin's pending-payments queue never mistakes it for a live
        // momo poll, but it's activated immediately below rather than
        // left pending like a real direct payment would be.
        [id, vendorId, scope, productId || null, packageLabel, price, durationDays, useCredit ? 'direct' : paymentMethod, momoReferenceId || null, momoPhone || null]
      );
      let slot = rowToFeaturedSlot(rows[0]);
      if (useCredit) {
        slot = await this._activateFeaturedSlotInTx(client, slot.id);
      }
      await client.query('COMMIT');
      return slot;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // Shared activation step — sets starts_at/ends_at from the snapshotted
  // duration_days and writes featured_until onto the product or vendor,
  // all inside the same transaction as flipping payment_status. Called
  // by both the momo poll/webhook path and the admin Direct-confirm
  // path, exactly like confirmMomoPaymentAndCreateOrder is shared logic
  // for the marketplace checkout equivalent. Scoped to payment_status =
  // 'pending' so a duplicate confirm (late webhook, double-click) is a
  // safe no-op, not a double-extension of the featured window.
  async _activateFeaturedSlotInTx(client, id) {
    const { rows } = await client.query(
      `UPDATE featured_slots SET payment_status = 'successful', starts_at = now(), ends_at = now() + (duration_days || ' days')::interval
       WHERE id = $1 AND payment_status = 'pending' RETURNING *`,
      [id]
    );
    const slot = rows[0];
    if (!slot) return null;
    if (slot.scope === 'product') {
      await client.query('UPDATE products SET featured_until = $1 WHERE id = $2', [slot.ends_at, slot.product_id]);
    } else {
      await client.query('UPDATE users SET featured_until = $1 WHERE id = $2', [slot.ends_at, slot.vendor_id]);
    }
    return rowToFeaturedSlot(slot);
  },

  async confirmFeaturedSlotPayment(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const slot = await this._activateFeaturedSlotInTx(client, id);
      await client.query('COMMIT');
      return slot;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async voidFailedFeaturedSlotPayment(id) {
    const { rows } = await pool.query(
      `UPDATE featured_slots SET payment_status = 'failed' WHERE id = $1 AND payment_status = 'pending' RETURNING *`,
      [id]
    );
    return rowToFeaturedSlot(rows[0]);
  },

  async adminConfirmDirectFeaturedSlot(id, adminId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: guardRows } = await client.query(
        `SELECT id FROM featured_slots WHERE id = $1 AND payment_method = 'direct' AND payment_status = 'pending'`, [id]
      );
      if (!guardRows[0]) { await client.query('ROLLBACK'); return null; }
      const slot = await this._activateFeaturedSlotInTx(client, id);
      if (slot) {
        await client.query('UPDATE featured_slots SET confirmed_by = $1, confirmed_at = now() WHERE id = $2', [adminId, id]);
      }
      await client.query('COMMIT');
      return slot ? { ...slot, confirmedBy: adminId } : null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async adminRejectDirectFeaturedSlot(id, adminId) {
    const { rows } = await pool.query(
      `UPDATE featured_slots SET payment_status = 'failed', confirmed_by = $1, confirmed_at = now()
       WHERE id = $2 AND payment_method = 'direct' AND payment_status = 'pending' RETURNING *`,
      [adminId, id]
    );
    return rowToFeaturedSlot(rows[0]);
  },

  // ============================================================
  // Premium subscription tier — account-wide, recurring vendor upgrade.
  // See the long schema.sql comment above vendor_subscriptions for the
  // full design reasoning (why current_period_end is the live source of
  // truth, why a NULL end is reserved for admin comps, why there's no
  // silent auto-charge). Mirrors the Featured Placements payment
  // machinery above wherever the shape matches (pending/successful/
  // failed vocabulary, momo/direct split, Super Admin direct-confirm
  // queue).
  // ============================================================

  async getSubscriptionPlans() {
    const { rows } = await pool.query('SELECT * FROM subscription_plans ORDER BY price ASC, created_at ASC');
    return rows.map(rowToSubscriptionPlan);
  },

  async getActiveSubscriptionPlans() {
    const { rows } = await pool.query('SELECT * FROM subscription_plans WHERE is_active = true ORDER BY price ASC, created_at ASC');
    return rows.map(rowToSubscriptionPlan);
  },

  async createSubscriptionPlan({ id, label, cycleDays, price }) {
    const { rows } = await pool.query(
      `INSERT INTO subscription_plans (id, label, cycle_days, price) VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, label, cycleDays, price]
    );
    return rowToSubscriptionPlan(rows[0]);
  },

  // isActive lets Super Admin retire a plan (hide it from the vendor
  // picker) without breaking the foreign key from vendors already
  // subscribed to it — same "never rewrite what's already active"
  // reasoning as featured_slots snapshotting its package/price.
  async updateSubscriptionPlan(id, { label, cycleDays, price, isActive }) {
    const sets = [];
    const values = [];
    let i = 1;
    if (label !== undefined) { sets.push(`label = $${i}`); values.push(label); i += 1; }
    if (cycleDays !== undefined) { sets.push(`cycle_days = $${i}`); values.push(cycleDays); i += 1; }
    if (price !== undefined) { sets.push(`price = $${i}`); values.push(price); i += 1; }
    if (isActive !== undefined) { sets.push(`is_active = $${i}`); values.push(isActive); i += 1; }
    if (!sets.length) {
      const { rows } = await pool.query('SELECT * FROM subscription_plans WHERE id = $1', [id]);
      return rowToSubscriptionPlan(rows[0]);
    }
    values.push(id);
    const { rows } = await pool.query(`UPDATE subscription_plans SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return rowToSubscriptionPlan(rows[0]);
  },

  // The vendor's current/most-recent subscription record (there's at
  // most one ACTIVE row per vendor, enforced by the partial unique
  // index — but a canceled/lapsed history can have older rows too, and
  // "most recent" is always the right one to show as current status).
  async getVendorSubscription(vendorId) {
    const { rows } = await pool.query(
      `SELECT vs.*, sp.label AS plan_label, sp.cycle_days AS plan_cycle_days, sp.price AS plan_price
       FROM vendor_subscriptions vs LEFT JOIN subscription_plans sp ON sp.id = vs.plan_id
       WHERE vs.vendor_id = $1 ORDER BY vs.created_at DESC LIMIT 1`,
      [vendorId]
    );
    const r = rows[0];
    if (!r) return null;
    return {
      ...rowToVendorSubscription(r),
      planLabel: r.plan_label || null,
      planCycleDays: r.plan_cycle_days || null,
      planPrice: r.plan_price !== null && r.plan_price !== undefined ? Number(r.plan_price) : null,
    };
  },

  async isVendorPremiumActive(vendorId) {
    return isSubscriptionCurrentlyActive(await this.getVendorSubscription(vendorId));
  },

  // Used by getPayoutSummary to batch-resolve which vendors get the
  // Premium commission rate, without an N+1 query per vendor row. Keyed
  // by vendor_id -> { start, end }, so callers get both "is this vendor
  // Premium" (map.has) and the real start/end date range (map.get) from
  // one query — the latter is what the Payouts & Commission table's
  // Premium column shows, straight off the subscription row rather than
  // a fabricated date. Mirrors isSubscriptionCurrentlyActive's rule
  // exactly: gated on current_period_start having arrived, and a null
  // current_period_end never counts as active (a null end means the
  // first charge hasn't been confirmed yet, not "indefinite"). Premium
  // was previously also grantable for free (source = 'admin_comp',
  // indefinite when its end was left blank) — that was removed
  // platform-wide, see isSubscriptionCurrentlyActive's comment.
  async getActivePremiumVendorIds() {
    const { rows } = await pool.query(
      `SELECT vendor_id, current_period_start, current_period_end FROM vendor_subscriptions WHERE status = 'active'
         AND current_period_start <= now()
         AND current_period_end IS NOT NULL AND current_period_end > now()`
    );
    return new Map(rows.map(r => [r.vendor_id, { start: r.current_period_start, end: r.current_period_end || null }]));
  },

  async getSubscriptionChargesForVendor(vendorId) {
    const { rows } = await pool.query(
      `SELECT sc.* FROM subscription_charges sc JOIN vendor_subscriptions vs ON vs.id = sc.subscription_id
       WHERE vs.vendor_id = $1 ORDER BY sc.created_at DESC`,
      [vendorId]
    );
    return rows.map(rowToSubscriptionCharge);
  },

  async getSubscriptionChargeById(id) {
    const { rows } = await pool.query('SELECT * FROM subscription_charges WHERE id = $1', [id]);
    return rowToSubscriptionCharge(rows[0]);
  },

  // Computes what a Featured Placement purchase should actually cost a
  // given vendor right now — the one place platform_settings.premium_
  // featuring_perk is interpreted. Free/non-Premium vendors always get
  // basePrice back unchanged.
  async getFeaturedPurchasePricing(vendorId, basePrice) {
    const [settings, subscription] = await Promise.all([this.getPlatformSettings(), this.getVendorSubscription(vendorId)]);
    if (!isSubscriptionCurrentlyActive(subscription)) {
      return { finalPrice: basePrice, perk: null, creditAvailable: false, subscriptionId: null };
    }
    if (settings.premiumFeaturingPerk === 'credit') {
      return {
        finalPrice: basePrice,
        perk: 'credit',
        creditAvailable: (subscription.featuredBoostCreditsRemaining || 0) > 0,
        subscriptionId: subscription.id,
      };
    }
    const discounted = Math.round(basePrice * (1 - settings.premiumFeaturingDiscountPercent / 100) * 100) / 100;
    return { finalPrice: Math.max(0, discounted), perk: 'discount', discountPercent: settings.premiumFeaturingDiscountPercent, creditAvailable: false, subscriptionId: subscription.id };
  },

  // Creates (first subscribe) or reuses (renewal / completing a still-
  // pending first charge) the vendor's subscription row, then records a
  // new pending charge against it. Locks any existing row for this
  // vendor first so two concurrent subscribe/renew clicks can't both
  // create duplicate subscription rows.
  async createSubscriptionCharge({ id, vendorId, planId, paymentMethod, momoReferenceId, momoPhone }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(
        `SELECT * FROM vendor_subscriptions WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [vendorId]
      );
      const existing = existingRows[0];
      const { rows: planRows } = await client.query('SELECT * FROM subscription_plans WHERE id = $1 AND is_active = true', [planId]);
      const planRow = planRows[0];
      if (!planRow) {
        await client.query('ROLLBACK');
        throw new Error('That plan is no longer available.');
      }

      let subscriptionId;
      // Free/admin_comp grants were removed platform-wide (see
      // isSubscriptionCurrentlyActive's comment) — a vendor's row can
      // only ever be 'paid' now, or a legacy admin_comp row already
      // force-canceled by the schema.sql migration, so there's no longer
      // a "blocked by an active free grant" case to guard against here.
      if (existing && existing.status === 'active' && existing.source === 'paid') {
        subscriptionId = existing.id;
        await client.query('UPDATE vendor_subscriptions SET plan_id = $1, updated_at = now() WHERE id = $2', [planRow.id, subscriptionId]);
      } else {
        subscriptionId = crypto.randomUUID();
        await client.query(
          `INSERT INTO vendor_subscriptions (id, vendor_id, plan_id, status, source, current_period_start, current_period_end)
           VALUES ($1, $2, $3, 'active', 'paid', now(), NULL)`,
          [subscriptionId, vendorId, planRow.id]
        );
      }
      const { rows: chargeRows } = await client.query(
        `INSERT INTO subscription_charges (id, subscription_id, price, payment_method, payment_status, momo_reference_id, momo_phone)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6) RETURNING *`,
        [id, subscriptionId, planRow.price, paymentMethod, momoReferenceId || null, momoPhone || null]
      );
      await client.query('COMMIT');
      return { charge: rowToSubscriptionCharge(chargeRows[0]), plan: rowToSubscriptionPlan(planRow) };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // Shared activation step, mirroring _activateFeaturedSlotInTx: flips
  // the charge to successful and extends the subscription's period.
  // GREATEST(current_period_end, now()) means renewing early keeps the
  // remaining paid time instead of losing it, while renewing after a
  // lapse starts the new period from now(). Also resets the free-boost
  // credit and the reminder marker for the new period. Scoped to
  // payment_status = 'pending' so a duplicate confirm is a safe no-op.
  async _activateSubscriptionChargeInTx(client, chargeId) {
    const { rows: chargeRows } = await client.query(
      `UPDATE subscription_charges SET payment_status = 'successful' WHERE id = $1 AND payment_status = 'pending' RETURNING *`,
      [chargeId]
    );
    const charge = chargeRows[0];
    if (!charge) return null;
    const { rows: subRows } = await client.query(
      `UPDATE vendor_subscriptions vs SET
         current_period_end = GREATEST(COALESCE(vs.current_period_end, now()), now()) + (sp.cycle_days || ' days')::interval,
         current_period_start = CASE WHEN vs.current_period_end IS NULL OR vs.current_period_end <= now() THEN now() ELSE vs.current_period_start END,
         featured_boost_credits_remaining = 1,
         reminder_sent_at = NULL,
         status = 'active',
         updated_at = now()
       FROM subscription_plans sp
       WHERE vs.id = $1 AND sp.id = vs.plan_id
       RETURNING vs.*`,
      [charge.subscription_id]
    );
    return { charge: rowToSubscriptionCharge(charge), subscription: rowToVendorSubscription(subRows[0]) };
  },

  async confirmSubscriptionChargePayment(chargeId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this._activateSubscriptionChargeInTx(client, chargeId);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async voidFailedSubscriptionCharge(id) {
    const { rows } = await pool.query(
      `UPDATE subscription_charges SET payment_status = 'failed' WHERE id = $1 AND payment_status = 'pending' RETURNING *`,
      [id]
    );
    return rowToSubscriptionCharge(rows[0]);
  },

  // Super Admin's queue of Direct-payment subscription charges still
  // waiting on a real-world payment to be confirmed — mirrors
  // getPendingDirectFeaturedSlots exactly.
  async getPendingDirectSubscriptionCharges() {
    const { rows } = await pool.query(
      `SELECT sc.*, vs.vendor_id, sp.label AS plan_label, u.business_name AS vendor_name, u.email AS vendor_email
       FROM subscription_charges sc
       JOIN vendor_subscriptions vs ON vs.id = sc.subscription_id
       LEFT JOIN subscription_plans sp ON sp.id = vs.plan_id
       JOIN users u ON u.id = vs.vendor_id
       WHERE sc.payment_method = 'direct' AND sc.payment_status = 'pending'
       ORDER BY sc.created_at ASC`
    );
    return rows.map(r => ({ ...rowToSubscriptionCharge(r), vendorId: r.vendor_id, vendorName: r.vendor_name, vendorEmail: r.vendor_email, planLabel: r.plan_label }));
  },

  async adminConfirmDirectSubscriptionCharge(id, adminId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: guardRows } = await client.query(
        `SELECT id FROM subscription_charges WHERE id = $1 AND payment_method = 'direct' AND payment_status = 'pending'`, [id]
      );
      if (!guardRows[0]) { await client.query('ROLLBACK'); return null; }
      const result = await this._activateSubscriptionChargeInTx(client, id);
      if (result) {
        await client.query('UPDATE subscription_charges SET confirmed_by = $1, confirmed_at = now() WHERE id = $2', [adminId, id]);
      }
      await client.query('COMMIT');
      return result ? { ...result, charge: { ...result.charge, confirmedBy: adminId } } : null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async adminRejectDirectSubscriptionCharge(id, adminId) {
    const { rows } = await pool.query(
      `UPDATE subscription_charges SET payment_status = 'failed', confirmed_by = $1, confirmed_at = now()
       WHERE id = $2 AND payment_method = 'direct' AND payment_status = 'pending' RETURNING *`,
      [adminId, id]
    );
    return rowToSubscriptionCharge(rows[0]);
  },

  // Free/comp Premium grants (adminGrantPremiumComp/adminSetPremiumComp-
  // Dates/adminRevokePremiumComp formerly lived here) were removed
  // platform-wide — see isSubscriptionCurrentlyActive's comment and the
  // "Free Premium removed entirely" README section. Any pre-existing
  // admin_comp row is force-canceled by a one-time migration in
  // schema.sql, so Premium is paid-subscription-only from here on.

  // Best-effort hourly scan (see the setInterval in server.js) for
  // subscriptions entering their renewal window. reminder_sent_at IS
  // NULL is the whole re-fire guard — it's reset to NULL on every
  // successful (re)activation (see _activateSubscriptionChargeInTx), so
  // this naturally fires at most once per billing period without a
  // separate "which period was this for" column to maintain.
  async getSubscriptionsNeedingReminder() {
    const settings = await this.getPlatformSettings();
    const { rows } = await pool.query(
      `SELECT vs.*, u.business_name AS vendor_name, u.email AS vendor_email, u.phone AS vendor_phone, sp.label AS plan_label
       FROM vendor_subscriptions vs
       JOIN users u ON u.id = vs.vendor_id
       LEFT JOIN subscription_plans sp ON sp.id = vs.plan_id
       WHERE vs.status = 'active' AND vs.source = 'paid' AND vs.current_period_end IS NOT NULL
         AND vs.current_period_end > now()
         AND vs.current_period_end <= now() + ($1 || ' days')::interval
         AND vs.reminder_sent_at IS NULL`,
      [settings.premiumReminderLeadDays]
    );
    return rows.map(r => ({
      ...rowToVendorSubscription(r),
      vendorName: r.vendor_name,
      vendorEmail: r.vendor_email,
      vendorPhone: r.vendor_phone,
      planLabel: r.plan_label,
    }));
  },

  async markSubscriptionReminderSent(id) {
    await pool.query('UPDATE vendor_subscriptions SET reminder_sent_at = now() WHERE id = $1', [id]);
  },

  // Records every renewal reminder actually sent (see runPremiumReminderScan
  // in server.js) so the Super Admin Overview can show a real "reminders
  // sent this week" count instead of an invented one.
  async logPremiumReminderSent(vendorId, subscriptionId) {
    await pool.query(
      `INSERT INTO premium_reminder_log (id, vendor_id, subscription_id) VALUES ($1, $2, $3)`,
      [crypto.randomUUID(), vendorId, subscriptionId]
    );
  },

  async countPremiumRemindersSince(sinceDate) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM premium_reminder_log WHERE sent_at >= $1`,
      [sinceDate]
    );
    return rows[0].count;
  },

  // Sum of active PAID Premium subscriptions' plan price, normalized to a
  // monthly figure (an annual plan's cycle_days makes it price/12) — a
  // real, current snapshot, not a projection or trend.
  async getActivePremiumMonthlyValue() {
    const { rows } = await pool.query(
      `SELECT sp.price, sp.cycle_days
       FROM vendor_subscriptions vs
       JOIN subscription_plans sp ON sp.id = vs.plan_id
       WHERE vs.status = 'active' AND vs.source = 'paid'
         AND vs.current_period_end IS NOT NULL AND vs.current_period_end > now()`
    );
    return rows.reduce((sum, r) => sum + (Number(r.price) * (30 / Number(r.cycle_days))), 0);
  },

  // ---- Wishlist ---------------------------------------------------------

  async addToWishlist(customerId, productId) {
    await pool.query(
      `INSERT INTO wishlist_items (id, customer_id, product_id) VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, product_id) DO NOTHING`,
      [crypto.randomUUID(), customerId, productId]
    );
  },

  async removeFromWishlist(customerId, productId) {
    await pool.query('DELETE FROM wishlist_items WHERE customer_id = $1 AND product_id = $2', [customerId, productId]);
  },

  // Full product data (same shape as the storefront listing) for
  // rendering the actual Wishlist tab — not just a list of IDs.
  async getWishlist(customerId) {
    const { rows } = await pool.query(`
      SELECT p.*, u.business_name AS vendor_name, w.created_at AS wishlisted_at,
        COALESCE(AVG(r.rating), 0)::numeric AS avg_rating,
        COUNT(DISTINCT r.id)::int AS review_count,
        COALESCE(sold.units_sold, 0)::int AS units_sold,
        (
          SELECT json_agg(json_build_object('id', pi.id, 'imageDataUrl', pi.image_data_url) ORDER BY pi.position, pi.created_at)
          FROM product_images pi WHERE pi.product_id = p.id
        ) AS extra_images
      FROM wishlist_items w
      JOIN products p ON p.id = w.product_id
      JOIN users u ON u.id = p.vendor_id
      LEFT JOIN product_reviews r ON r.product_id = p.id
      LEFT JOIN (
        SELECT product_id, SUM(quantity)::int AS units_sold
        FROM purchase_items
        GROUP BY product_id
      ) sold ON sold.product_id = p.id
      WHERE w.customer_id = $1
      GROUP BY p.id, u.business_name, w.created_at, sold.units_sold
      ORDER BY w.created_at DESC
    `, [customerId]);
    return rows.map(r => ({
      ...rowToProduct(r),
      vendorName: r.vendor_name,
      avgRating: Number(r.avg_rating),
      reviewCount: r.review_count,
      unitsSold: r.units_sold,
      wishlistedAt: r.wishlisted_at,
      images: r.extra_images || [],
    }));
  },

  // Just the product IDs — cheap to fetch on marketplace load so every
  // product card/PDP can show the right heart state without a query per item.
  async getWishlistProductIds(customerId) {
    const { rows } = await pool.query('SELECT product_id FROM wishlist_items WHERE customer_id = $1', [customerId]);
    return rows.map(r => r.product_id);
  },

  // ---- Leads --------------------------------------------------------
  // Real high-intent interaction events (direct contact, inquiries,
  // cart/checkout intent, store-profile actions). Logging a lead is a
  // background side effect of a real user action — it should never
  // block or break that action if it fails, so callers wrap this in
  // try/catch and ignore errors (see server.js).

  // ---- Store Follows (mirrors wishlist_items, for stores) ------------

  async followStore(customerId, vendorId) {
    await pool.query(
      `INSERT INTO store_follows (id, customer_id, vendor_id) VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, vendor_id) DO NOTHING`,
      [crypto.randomUUID(), customerId, vendorId]
    );
  },

  async unfollowStore(customerId, vendorId) {
    await pool.query('DELETE FROM store_follows WHERE customer_id = $1 AND vendor_id = $2', [customerId, vendorId]);
  },

  async getFollowedStoreIds(customerId) {
    const { rows } = await pool.query('SELECT vendor_id FROM store_follows WHERE customer_id = $1', [customerId]);
    return rows.map(r => r.vendor_id);
  },

  // Real followers of one vendor's store — used by the follower
  // broadcast feature (see POST /api/vendor/products/:id/notify-followers
  // in server.js) to send a real notification to each one, never a
  // fabricated "reached N people" figure.
  async getStoreFollowers(vendorId) {
    const { rows } = await pool.query(
      `SELECT u.id, u.business_name, u.email, u.phone
       FROM store_follows sf JOIN users u ON u.id = sf.customer_id
       WHERE sf.vendor_id = $1`,
      [vendorId]
    );
    return rows.map(r => ({ id: r.id, businessName: r.business_name, email: r.email, phone: r.phone }));
  },

  async markFollowersNotified(productId) {
    await pool.query('UPDATE products SET followers_notified_at = now() WHERE id = $1', [productId]);
  },

  // ---- Saved Addresses ---------------------------------------------------

  async getSavedAddresses(customerId) {
    const { rows } = await pool.query(
      'SELECT * FROM saved_addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at DESC',
      [customerId]
    );
    return rows.map(rowToAddress);
  },

  async createSavedAddress({ id, customerId, label, address, isDefault }) {
    if (isDefault) await pool.query('UPDATE saved_addresses SET is_default = false WHERE customer_id = $1', [customerId]);
    const { rows } = await pool.query(
      'INSERT INTO saved_addresses (id, customer_id, label, address, is_default) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [id, customerId, label, address, !!isDefault]
    );
    return rowToAddress(rows[0]);
  },

  async updateSavedAddress(id, customerId, { label, address, isDefault }) {
    if (isDefault) await pool.query('UPDATE saved_addresses SET is_default = false WHERE customer_id = $1', [customerId]);
    const { rows } = await pool.query(
      'UPDATE saved_addresses SET label = $1, address = $2, is_default = $3 WHERE id = $4 AND customer_id = $5 RETURNING *',
      [label, address, !!isDefault, id, customerId]
    );
    return rows[0] ? rowToAddress(rows[0]) : null;
  },

  async deleteSavedAddress(id, customerId) {
    const { rows } = await pool.query(
      'DELETE FROM saved_addresses WHERE id = $1 AND customer_id = $2 RETURNING id',
      [id, customerId]
    );
    return rows.length > 0;
  },

  // ---- Promotions ---------------------------------------------------

  // Rejects if this product already has a promotion whose window
  // overlaps the requested one — one active/future discount per
  // product at a time, so there's never ambiguity about which % applies.
  // ---- Messages -----------------------------------------------------

  // One conversation per (customer, vendor) pair, reused for every
  // future exchange — created on first contact, found thereafter.
  async getOrCreateConversation(customerId, vendorId) {
    const existing = await pool.query(
      'SELECT * FROM conversations WHERE customer_id = $1 AND vendor_id = $2',
      [customerId, vendorId]
    );
    if (existing.rows[0]) return { conversation: existing.rows[0], wasCreated: false };
    const { rows } = await pool.query(
      'INSERT INTO conversations (id, customer_id, vendor_id) VALUES ($1, $2, $3) RETURNING *',
      [crypto.randomUUID(), customerId, vendorId]
    );
    return { conversation: rows[0], wasCreated: true };
  },

  async getConversationById(conversationId) {
    const { rows } = await pool.query('SELECT * FROM conversations WHERE id = $1', [conversationId]);
    return rows[0] || null;
  },

  // Real conversation list — the other party's name, the actual last
  // message preview, and a real unread count (messages in this
  // conversation not sent by the viewer, not yet marked read).
  async getConversationsForUser(userId, role) {
    const otherPartyColumn = role === 'vendor' ? 'c.customer_id' : 'c.vendor_id';
    const { rows } = await pool.query(`
      SELECT c.id, c.created_at, u.business_name AS other_party_name, u.id AS other_party_id,
        (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
        (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
        (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != $1 AND m.read_at IS NULL) AS unread_count
      FROM conversations c
      JOIN users u ON u.id = ${otherPartyColumn}
      WHERE ${role === 'vendor' ? 'c.vendor_id' : 'c.customer_id'} = $1
      ORDER BY last_message_at DESC NULLS LAST, c.created_at DESC
    `, [userId]);
    return rows.map(r => ({
      id: r.id,
      otherPartyId: r.other_party_id,
      otherPartyName: r.other_party_name,
      lastMessage: r.last_message,
      lastMessageAt: r.last_message_at,
      unreadCount: r.unread_count,
      createdAt: r.created_at,
    }));
  },

  async sendMessageToConversation({ id, conversationId, senderId, body }) {
    const { rows } = await pool.query(
      'INSERT INTO messages (id, conversation_id, sender_id, body) VALUES ($1, $2, $3, $4) RETURNING *',
      [id, conversationId, senderId, body]
    );
    return rowToMessage(rows[0]);
  },

  async getConversationMessages(conversationId) {
    const { rows } = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );
    return rows.map(rowToMessage);
  },

  async markConversationRead(conversationId, readerId) {
    await pool.query(
      'UPDATE messages SET read_at = now() WHERE conversation_id = $1 AND sender_id != $2 AND read_at IS NULL',
      [conversationId, readerId]
    );
  },

  // ---- Promotions / Deals --------------------------------------------

  // Rejects overlapping promotions on the same product — a product can
  // only ever have one discount active (or scheduled) at a time, so
  // there's never ambiguity about which percentage actually applies.
  async createPromotion({ id, vendorId, productId, discountPercent, startsAt, endsAt }) {
    const product = await pool.query('SELECT vendor_id FROM products WHERE id = $1', [productId]);
    if (!product.rows[0]) throw new Error('Product not found');
    if (product.rows[0].vendor_id !== vendorId) throw new Error('You can only run promotions on your own products');

    const overlap = await pool.query(
      `SELECT id FROM promotions WHERE product_id = $1 AND starts_at <= $3 AND ends_at >= $2`,
      [productId, startsAt, endsAt]
    );
    if (overlap.rows.length > 0) {
      throw new Error('This product already has a promotion scheduled or active in that date range — cancel it first');
    }

    const { rows } = await pool.query(
      `INSERT INTO promotions (id, vendor_id, product_id, discount_percent, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, vendorId, productId, discountPercent, startsAt, endsAt]
    );
    return rows[0];
  },

  async getVendorPromotions(vendorId) {
    const { rows } = await pool.query(`
      SELECT p.*, pr.name AS product_name, pr.price AS product_price, pr.image_data_url AS product_image,
        (now() BETWEEN p.starts_at AND p.ends_at) AS is_active
      FROM promotions p
      JOIN products pr ON pr.id = p.product_id
      WHERE p.vendor_id = $1
      ORDER BY p.starts_at DESC
    `, [vendorId]);
    return rows.map(r => ({
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      productPrice: Number(r.product_price),
      productImage: r.product_image,
      discountPercent: Number(r.discount_percent),
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      isActive: r.is_active,
    }));
  },

  async deletePromotion(id, vendorId) {
    const { rows } = await pool.query(
      'DELETE FROM promotions WHERE id = $1 AND vendor_id = $2 RETURNING id',
      [id, vendorId]
    );
    return rows.length > 0;
  },

  // ---- Coupon codes (cart-level, vendor-scoped) ----------------------
  // Same self-service pattern as promotions above, just a customer-typed
  // code applied at checkout instead of an automatic per-product
  // discount. See schema.sql's comment on the coupons table for the
  // full design reasoning (vendor-scoped uniqueness, percent vs fixed,
  // usage caps).

  rowToCoupon(r) {
    if (!r) return null;
    return {
      id: r.id,
      vendorId: r.vendor_id,
      code: r.code,
      discountType: r.discount_type,
      discountValue: Number(r.discount_value),
      minOrderAmount: r.min_order_amount !== null ? Number(r.min_order_amount) : null,
      maxUses: r.max_uses,
      perCustomerLimit: r.per_customer_limit,
      usesCount: r.uses_count,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      isActive: r.is_active,
      createdAt: r.created_at,
    };
  },

  async createCoupon({ id, vendorId, code, discountType, discountValue, minOrderAmount, maxUses, perCustomerLimit, startsAt, endsAt }) {
    const normalizedCode = code.trim().toUpperCase();
    const existing = await pool.query('SELECT id FROM coupons WHERE vendor_id = $1 AND code = $2', [vendorId, normalizedCode]);
    if (existing.rows.length > 0) throw new Error('You already have a coupon with that code');
    const { rows } = await pool.query(
      `INSERT INTO coupons (id, vendor_id, code, discount_type, discount_value, min_order_amount, max_uses, per_customer_limit, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, vendorId, normalizedCode, discountType, discountValue, minOrderAmount || null, maxUses || null, perCustomerLimit || null, startsAt || new Date(), endsAt || null]
    );
    return this.rowToCoupon(rows[0]);
  },

  async getVendorCoupons(vendorId) {
    const { rows } = await pool.query('SELECT * FROM coupons WHERE vendor_id = $1 ORDER BY created_at DESC', [vendorId]);
    return rows.map(r => this.rowToCoupon(r));
  },

  async getCouponById(id, vendorId) {
    const { rows } = await pool.query('SELECT * FROM coupons WHERE id = $1 AND vendor_id = $2', [id, vendorId]);
    return this.rowToCoupon(rows[0]);
  },

  // Toggle active/inactive rather than a hard delete by default — a
  // coupon already referenced by real purchases (purchases.coupon_id)
  // should stay around for order-history/audit purposes. A vendor can
  // still hard-delete one that's never been used (see deleteCoupon).
  async setCouponActive(id, vendorId, isActive) {
    const { rows } = await pool.query(
      'UPDATE coupons SET is_active = $1 WHERE id = $2 AND vendor_id = $3 RETURNING *',
      [isActive, id, vendorId]
    );
    return this.rowToCoupon(rows[0]);
  },

  async deleteCoupon(id, vendorId) {
    const { rows } = await pool.query(
      'DELETE FROM coupons WHERE id = $1 AND vendor_id = $2 AND uses_count = 0 RETURNING id',
      [id, vendorId]
    );
    return rows.length > 0;
  },

  // Read-only preview for the cart's "Apply" button, so a customer sees
  // the real discount before submitting — NEVER mutates uses_count or
  // writes a redemption row (that only happens transactionally inside
  // checkout() above, the moment the discount is actually charged).
  // Mirrors checkout()'s own validation exactly so a coupon that
  // previews as valid never unexpectedly fails at actual checkout
  // (short of a genuine race on the last few uses).
  async previewCoupon(vendorId, code, subtotal, customerId) {
    const { rows } = await pool.query(
      'SELECT * FROM coupons WHERE vendor_id = $1 AND code = $2',
      [vendorId, (code || '').trim().toUpperCase()]
    );
    const coupon = rows[0];
    if (!coupon) return { valid: false, error: 'That coupon code is not valid for this store' };
    if (!coupon.is_active) return { valid: false, error: 'That coupon code is no longer active' };
    if (new Date(coupon.starts_at) > new Date()) return { valid: false, error: 'That coupon code is not active yet' };
    if (coupon.ends_at && new Date(coupon.ends_at) <= new Date()) return { valid: false, error: 'That coupon code has expired' };
    if (coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses) {
      return { valid: false, error: 'That coupon code has reached its usage limit' };
    }
    if (coupon.min_order_amount !== null && subtotal < Number(coupon.min_order_amount)) {
      return { valid: false, error: `That coupon requires an order of at least $${Number(coupon.min_order_amount).toFixed(2)}` };
    }
    if (coupon.per_customer_limit !== null && customerId) {
      const usedRes = await pool.query(
        'SELECT COUNT(*)::int AS count FROM coupon_redemptions WHERE coupon_id = $1 AND customer_id = $2',
        [coupon.id, customerId]
      );
      if (usedRes.rows[0].count >= coupon.per_customer_limit) {
        return { valid: false, error: "You've already used that coupon code the maximum number of times" };
      }
    }
    const discountAmount = coupon.discount_type === 'percent'
      ? Number((subtotal * Number(coupon.discount_value) / 100).toFixed(2))
      : Math.min(Number(coupon.discount_value), subtotal);
    return { valid: true, code: coupon.code, discountType: coupon.discount_type, discountValue: Number(coupon.discount_value), discountAmount };
  },

  // ---- Leads -------------------------------------------------------

  async createLead({ id, vendorId, buyerId, productId, type }) {
    const { rows } = await pool.query(
      `INSERT INTO leads (id, vendor_id, buyer_id, product_id, type) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, vendorId, buyerId || null, productId || null, type]
    );
    return rows[0];
  },

  async getVendorLeads(vendorId) {
    const { rows } = await pool.query(`
      SELECT l.*, u.business_name AS buyer_name, p.name AS product_name
      FROM leads l
      LEFT JOIN users u ON u.id = l.buyer_id
      LEFT JOIN products p ON p.id = l.product_id
      WHERE l.vendor_id = $1
      ORDER BY l.created_at DESC
    `, [vendorId]);
    return rows.map(r => ({
      id: r.id,
      buyerId: r.buyer_id,
      buyerName: r.buyer_name || 'Guest',
      productId: r.product_id,
      productName: r.product_name,
      type: r.type,
      status: r.status,
      createdAt: r.created_at,
    }));
  },

  async updateLeadStatus(id, vendorId, status) {
    const { rows } = await pool.query(
      'UPDATE leads SET status = $1 WHERE id = $2 AND vendor_id = $3 RETURNING *',
      [status, id, vendorId]
    );
    return rows[0] || null;
  },

  async getVendorLeadsSummary(vendorId) {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'NEW')::int AS new_count,
        COUNT(*) FILTER (WHERE status = 'CONVERTED')::int AS converted_count
      FROM leads WHERE vendor_id = $1
    `, [vendorId]);
    return { total: rows[0].total, newCount: rows[0].new_count, convertedCount: rows[0].converted_count };
  },

  // Used inside the checkout transaction (passed the transaction's own
  // client, not the shared pool) so the discount check sees a
  // consistent snapshot alongside the FOR UPDATE product lock already
  // taken there.
  async getActivePromotionForProductTx(client, productId) {
    const { rows } = await client.query(
      'SELECT * FROM promotions WHERE product_id = $1 AND now() BETWEEN starts_at AND ends_at LIMIT 1',
      [productId]
    );
    return rows[0] || null;
  },

  // ---- Stores directory (public — Marketplace "Stores" tab) -----------
  // Real vendor list with real product counts and real average rating
  // aggregated across all of that vendor's products' reviews.
  async getStorefrontVendors() {
    const { rows } = await pool.query(`
      SELECT u.id, u.business_name, u.store_address, u.phone,
        COUNT(DISTINCT p.id)::int AS product_count,
        COALESCE(AVG(r.rating), 0)::numeric AS avg_rating,
        COUNT(DISTINCT r.id)::int AS review_count,
        vr.avg_vendor_rating, vr.vendor_review_count
      FROM users u
      LEFT JOIN products p ON p.vendor_id = u.id AND p.is_active = true
      LEFT JOIN product_reviews r ON r.product_id = p.id
      LEFT JOIN (
        SELECT vendor_id, AVG(rating)::numeric AS avg_vendor_rating, COUNT(*)::int AS vendor_review_count
        FROM vendor_reviews GROUP BY vendor_id
      ) vr ON vr.vendor_id = u.id
      WHERE u.role = 'vendor' AND u.vendor_type = 'store'
      GROUP BY u.id, vr.avg_vendor_rating, vr.vendor_review_count
      ORDER BY u.business_name ASC
    `);
    return rows.map(r => ({
      id: r.id,
      businessName: r.business_name,
      storeAddress: r.store_address,
      phone: r.phone,
      productCount: r.product_count,
      avgRating: Number(r.avg_rating),
      reviewCount: r.review_count,
      avgVendorRating: r.avg_vendor_rating !== null ? Number(r.avg_vendor_rating) : null,
      vendorReviewCount: r.vendor_review_count || 0,
    }));
  },

  // Restaurants tab — same real-data discipline as getStorefrontVendors
  // (no fabricated delivery-time/rating placeholders): each card gets a
  // real dish count, a real aggregate rating from product_reviews on
  // that restaurant's dishes, and a real "from" price (the cheapest
  // active dish), or null if the restaurant hasn't listed anything yet.
  // A restaurant with zero dishes still shows up here (so a newly
  // approved restaurant isn't invisible) with dishCount 0 and
  // startingPrice null; the frontend is responsible for hiding a
  // "from $X" line when startingPrice is null rather than this query
  // inventing a number. avgVendorRating/vendorReviewCount are the
  // separate, verified-purchase, whole-restaurant rating (see
  // vendor_reviews) — kept alongside avgRating (the dish-level
  // average) rather than replacing it, per how this is meant to read.
  async getPopularRestaurants() {
    const { rows } = await pool.query(`
      SELECT u.id, u.business_name, u.store_address, u.phone, u.profile_image_url, u.avg_prep_time_minutes,
        COUNT(DISTINCT p.id)::int AS dish_count,
        COALESCE(AVG(r.rating), 0)::numeric AS avg_rating,
        COUNT(DISTINCT r.id)::int AS review_count,
        MIN(p.price) AS starting_price,
        vr.avg_vendor_rating, vr.vendor_review_count
      FROM users u
      LEFT JOIN products p ON p.vendor_id = u.id AND p.is_active = true
      LEFT JOIN product_reviews r ON r.product_id = p.id
      LEFT JOIN (
        SELECT vendor_id, AVG(rating)::numeric AS avg_vendor_rating, COUNT(*)::int AS vendor_review_count
        FROM vendor_reviews GROUP BY vendor_id
      ) vr ON vr.vendor_id = u.id
      WHERE u.role = 'vendor' AND u.vendor_type = 'restaurant'
      GROUP BY u.id, vr.avg_vendor_rating, vr.vendor_review_count
      ORDER BY avg_rating DESC, dish_count DESC, u.business_name ASC
    `);
    return rows.map(r => ({
      id: r.id,
      businessName: r.business_name,
      storeAddress: r.store_address,
      phone: r.phone,
      profileImageUrl: r.profile_image_url,
      avgPrepTimeMinutes: r.avg_prep_time_minutes,
      dishCount: r.dish_count,
      avgRating: Number(r.avg_rating),
      reviewCount: r.review_count,
      avgVendorRating: r.avg_vendor_rating !== null ? Number(r.avg_vendor_rating) : null,
      vendorReviewCount: r.vendor_review_count || 0,
      startingPrice: r.starting_price !== null ? Number(r.starting_price) : null,
    }));
  },

  // ---- Vendor: real customers (from actual purchases) -----------------
  // Real per-vendor customer list — who bought from this vendor, how many
  // times, and how much they've spent. No fabricated "leads" concept.
  async getVendorCustomers(vendorId) {
    const { rows } = await pool.query(`
      SELECT u.id, u.business_name, u.email, u.phone,
        COUNT(p.id) FILTER (WHERE p.payment_method = 'cod' OR p.payment_status = 'successful')::int AS order_count,
        COALESCE(SUM(p.total_amount) FILTER (WHERE p.payment_method = 'cod' OR p.payment_status = 'successful'), 0)::numeric AS total_spent,
        MAX(p.created_at) AS last_order_at
      FROM purchases p
      JOIN users u ON u.id = p.customer_id
      WHERE p.vendor_id = $1
      GROUP BY u.id
      ORDER BY total_spent DESC
    `, [vendorId]);
    return rows.map(r => ({
      id: r.id,
      businessName: r.business_name,
      email: r.email,
      phone: r.phone,
      orderCount: r.order_count,
      totalSpent: Number(r.total_spent),
      lastOrderAt: r.last_order_at,
    }));
  },

  // Real order-status breakdown for this vendor's purchases — replaces
  // the mockup's "Sales by Channel" (Direct/Website/Referral/Social),
  // which this app has no way to track (no traffic-source attribution
  // exists). Status IS real, tracked data.
  async getVendorOrderStatusBreakdown(vendorId) {
    const { rows } = await pool.query(`
      SELECT COALESCE(o.status, 'placed') AS status, COUNT(*)::int AS count
      FROM purchases p
      LEFT JOIN orders o ON o.id = p.delivery_order_id
      WHERE p.vendor_id = $1
      GROUP BY COALESCE(o.status, 'placed')
    `, [vendorId]);
    return rows.map(r => ({ status: r.status, count: r.count }));
  },

  // Real marketplace-wide stats for the Super Admin Vendors panel —
  // actual purchases across every vendor, and how many applications are
  // waiting on a decision. Replaces the previous version of this panel,
  // which showed unrelated Delivery-service order/agent numbers.
  async getMarketplacePlatformStats() {
    const [purchaseTotals, pendingCount] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS total_orders, COALESCE(SUM(total_amount), 0)::numeric AS total_revenue FROM purchases WHERE payment_method = 'cod' OR payment_status = 'successful'"),
      pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'vendor' AND approval_status = 'pending'"),
    ]);
    return {
      totalMarketplaceOrders: purchaseTotals.rows[0].total_orders,
      totalMarketplaceRevenue: Number(purchaseTotals.rows[0].total_revenue),
      pendingVendorApplications: pendingCount.rows[0].count,
    };
  },

  // Admin Overview's Marketplace/Restaurant sections — same purchases
  // table as getMarketplacePlatformStats above, just split by the
  // purchased vendor's vendor_type instead of lumped together, since
  // a restaurant order and a store order are the same DB row shape
  // (both a "purchases" row, both possibly linked to a delivery order)
  // but are two distinct lines of business to an admin reading a
  // dashboard. Same "cod or confirmed" filter as every other order/
  // revenue query in this file — a still-pending or rejected Mobile
  // Money purchase was never real revenue.
  async getBusinessOverviewStats() {
    const [byType, vendorCounts, pendingCount] = await Promise.all([
      pool.query(`
        SELECT u.vendor_type, COUNT(p.*)::int AS total_orders, COALESCE(SUM(p.total_amount), 0)::numeric AS total_revenue
        FROM purchases p JOIN users u ON u.id = p.vendor_id
        WHERE p.payment_method = 'cod' OR p.payment_status = 'successful'
        GROUP BY u.vendor_type
      `),
      pool.query("SELECT vendor_type, COUNT(*)::int AS count FROM users WHERE role = 'vendor' AND approval_status = 'approved' GROUP BY vendor_type"),
      pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'vendor' AND approval_status = 'pending'"),
    ]);
    const forType = (type) => byType.rows.find(r => r.vendor_type === type) || { total_orders: 0, total_revenue: 0 };
    const countForType = (type) => (vendorCounts.rows.find(r => r.vendor_type === type) || { count: 0 }).count;
    const store = forType('store');
    const restaurant = forType('restaurant');
    return {
      marketplace: {
        totalOrders: store.total_orders,
        totalRevenue: Number(store.total_revenue),
        vendorCount: countForType('store'),
      },
      restaurants: {
        totalOrders: restaurant.total_orders,
        totalRevenue: Number(restaurant.total_revenue),
        vendorCount: countForType('restaurant'),
      },
      pendingVendorApplications: pendingCount.rows[0].count,
    };
  },

  // ---- Commission & payouts (Super Admin) ---------------------------
  // Single-row table, same upsert pattern as Business settings above.

  async getPlatformSettings() {
    const existing = await pool.query("SELECT * FROM platform_settings WHERE id = 'platform'");
    if (existing.rows.length === 0) {
      const { rows } = await pool.query("INSERT INTO platform_settings (id) VALUES ('platform') RETURNING *");
      return rowToPlatformSettings(rows[0]);
    }
    return rowToPlatformSettings(existing.rows[0]);
  },

  // Generic partial-update over the single platform_settings row —
  // covers commission rates (used by the Payouts & Commission panel)
  // and the platform-wide settings (default delivery fee, service
  // area, maintenance mode) added later, so both panels can share one
  // upsert path instead of drifting into two near-duplicate ones.
  async upsertPlatformSettings({ marketplaceCommissionPercent, deliveryCommissionPercent, marketplaceCommissionEnabled, deliveryCommissionEnabled, defaultDeliveryFee, serviceArea, maintenanceMode, maintenanceMessage, serviceFee, invoiceShowServiceFeeLine, invoiceShowMomoLine, invoiceHeaderTitle, invoiceHeaderSubtitle, invoiceFooterNote, invoiceCommissionNote, invoiceServiceFeeNote, invoiceMomoNote, featuredProductPackages, featuredVendorPackages, featuredProductSlotCap, featuredVendorSlotCap, premiumCommissionPercent, premiumReminderLeadDays, premiumFeaturingPerk, premiumFeaturingDiscountPercent }) {
    await this.getPlatformSettings(); // ensures the row exists
    const sets = [];
    const values = [];
    let i = 1;
    if (marketplaceCommissionPercent !== undefined) { sets.push(`marketplace_commission_percent = $${i}`); values.push(marketplaceCommissionPercent); i += 1; }
    if (deliveryCommissionPercent !== undefined) { sets.push(`delivery_commission_percent = $${i}`); values.push(deliveryCommissionPercent); i += 1; }
    if (marketplaceCommissionEnabled !== undefined) { sets.push(`marketplace_commission_enabled = $${i}`); values.push(marketplaceCommissionEnabled); i += 1; }
    if (deliveryCommissionEnabled !== undefined) { sets.push(`delivery_commission_enabled = $${i}`); values.push(deliveryCommissionEnabled); i += 1; }
    if (serviceFee !== undefined) { sets.push(`service_fee = $${i}`); values.push(serviceFee); i += 1; }
    if (defaultDeliveryFee !== undefined) { sets.push(`default_delivery_fee = $${i}`); values.push(defaultDeliveryFee); i += 1; }
    if (serviceArea !== undefined) { sets.push(`service_area = $${i}`); values.push(serviceArea); i += 1; }
    if (maintenanceMode !== undefined) { sets.push(`maintenance_mode = $${i}`); values.push(maintenanceMode); i += 1; }
    if (maintenanceMessage !== undefined) { sets.push(`maintenance_message = $${i}`); values.push(maintenanceMessage); i += 1; }
    if (invoiceShowServiceFeeLine !== undefined) { sets.push(`invoice_show_service_fee_line = $${i}`); values.push(invoiceShowServiceFeeLine); i += 1; }
    if (invoiceShowMomoLine !== undefined) { sets.push(`invoice_show_momo_line = $${i}`); values.push(invoiceShowMomoLine); i += 1; }
    if (invoiceHeaderTitle !== undefined) { sets.push(`invoice_header_title = $${i}`); values.push(invoiceHeaderTitle); i += 1; }
    if (invoiceHeaderSubtitle !== undefined) { sets.push(`invoice_header_subtitle = $${i}`); values.push(invoiceHeaderSubtitle); i += 1; }
    if (invoiceFooterNote !== undefined) { sets.push(`invoice_footer_note = $${i}`); values.push(invoiceFooterNote); i += 1; }
    if (invoiceCommissionNote !== undefined) { sets.push(`invoice_commission_note = $${i}`); values.push(invoiceCommissionNote); i += 1; }
    if (invoiceServiceFeeNote !== undefined) { sets.push(`invoice_service_fee_note = $${i}`); values.push(invoiceServiceFeeNote); i += 1; }
    if (invoiceMomoNote !== undefined) { sets.push(`invoice_momo_note = $${i}`); values.push(invoiceMomoNote); i += 1; }
    if (featuredProductPackages !== undefined) { sets.push(`featured_product_packages = $${i}`); values.push(JSON.stringify(featuredProductPackages)); i += 1; }
    if (featuredVendorPackages !== undefined) { sets.push(`featured_vendor_packages = $${i}`); values.push(JSON.stringify(featuredVendorPackages)); i += 1; }
    if (featuredProductSlotCap !== undefined) { sets.push(`featured_product_slot_cap = $${i}`); values.push(featuredProductSlotCap); i += 1; }
    if (featuredVendorSlotCap !== undefined) { sets.push(`featured_vendor_slot_cap = $${i}`); values.push(featuredVendorSlotCap); i += 1; }
    if (premiumCommissionPercent !== undefined) { sets.push(`premium_commission_percent = $${i}`); values.push(premiumCommissionPercent); i += 1; }
    if (premiumReminderLeadDays !== undefined) { sets.push(`premium_reminder_lead_days = $${i}`); values.push(premiumReminderLeadDays); i += 1; }
    if (premiumFeaturingPerk !== undefined) { sets.push(`premium_featuring_perk = $${i}`); values.push(premiumFeaturingPerk); i += 1; }
    if (premiumFeaturingDiscountPercent !== undefined) { sets.push(`premium_featuring_discount_percent = $${i}`); values.push(premiumFeaturingDiscountPercent); i += 1; }
    sets.push('updated_at = now()');
    if (sets.length > 1) {
      await pool.query(`UPDATE platform_settings SET ${sets.join(', ')} WHERE id = 'platform'`, values);
    }
    return this.getPlatformSettings();
  },

  // rate === null clears the override (falls back to the platform
  // default). Scoped to vendor/delivery_company roles only — enforced
  // here, not just trusted from the caller.
  async setCommissionRateOverride(userId, rate) {
    const { rows } = await pool.query(
      `UPDATE users SET commission_rate_override = $1
       WHERE id = $2 AND role IN ('vendor', 'delivery_company') RETURNING *`,
      [rate, userId]
    );
    return rowToUser(rows[0]);
  },

  // Real, calculated-from-actual-data summary — vendor gross comes
  // from `purchases`, delivery company gross from delivered `orders`,
  // each net of any refunds issued through resolved disputes (see
  // resolveDispute below — a purchase-linked refund nets against that
  // purchase's vendor, an order-only refund nets against that order's
  // delivery company; see the comment on the disputes table in
  // schema.sql for the full reasoning). Never recalculates past
  // payouts; only used to show current standing (gross earned
  // all-time, net of refunds, vs. already paid out all-time). Vendor
  // gross is filtered to `payment_method = 'cod' OR payment_status =
  // 'successful'` — a still-pending or rejected Mobile Money purchase
  // was never actually received, so it can't be gross earnings owed to
  // that vendor.
  async getPayoutSummary() {
    const [vendorRows, companyRows, vendorRevenue, deliveryRevenue, vendorRefunds, deliveryRefunds, paidOut, platformSettings, premiumVendorIds] = await Promise.all([
      pool.query("SELECT id, business_name, email, commission_rate_override FROM users WHERE role = 'vendor' AND approval_status = 'approved' ORDER BY business_name"),
      pool.query("SELECT id, business_name, email, commission_rate_override FROM users WHERE role = 'delivery_company' AND approval_status = 'approved' ORDER BY business_name"),
      pool.query("SELECT vendor_id, COALESCE(SUM(total_amount), 0)::numeric AS gross FROM purchases WHERE payment_method = 'cod' OR payment_status = 'successful' GROUP BY vendor_id"),
      pool.query("SELECT delivery_company_id, COALESCE(SUM(amount), 0)::numeric AS gross FROM orders WHERE status = 'delivered' AND delivery_company_id IS NOT NULL GROUP BY delivery_company_id"),
      pool.query(
        `SELECT pur.vendor_id AS vendor_id, COALESCE(SUM(d.refund_amount), 0)::numeric AS refunded
         FROM disputes d JOIN purchases pur ON pur.id = d.purchase_id
         WHERE d.status = 'resolved' AND d.refund_amount IS NOT NULL
         GROUP BY pur.vendor_id`
      ),
      pool.query(
        `SELECT o.delivery_company_id AS delivery_company_id, COALESCE(SUM(d.refund_amount), 0)::numeric AS refunded
         FROM disputes d JOIN orders o ON o.id = d.order_id
         WHERE d.status = 'resolved' AND d.refund_amount IS NOT NULL AND d.purchase_id IS NULL AND o.delivery_company_id IS NOT NULL
         GROUP BY o.delivery_company_id`
      ),
      pool.query("SELECT recipient_id, COALESCE(SUM(net_amount), 0)::numeric AS paid FROM payouts GROUP BY recipient_id"),
      this.getPlatformSettings(),
      this.getActivePremiumVendorIds(),
    ]);
    const vendorRevMap = new Map(vendorRevenue.rows.map(r => [r.vendor_id, Number(r.gross)]));
    const deliveryRevMap = new Map(deliveryRevenue.rows.map(r => [r.delivery_company_id, Number(r.gross)]));
    const vendorRefundMap = new Map(vendorRefunds.rows.map(r => [r.vendor_id, Number(r.refunded)]));
    const deliveryRefundMap = new Map(deliveryRefunds.rows.map(r => [r.delivery_company_id, Number(r.refunded)]));
    const paidMap = new Map(paidOut.rows.map(r => [r.recipient_id, Number(r.paid)]));

    // premiumRate/premiumMap are only ever passed for recipientType =
    // 'vendor' — Premium is a vendor-only tier, delivery companies
    // always use their plain default/override rate.
    const build = (rows, revMap, refundMap, recipientType, defaultRate, commissionEnabled, premiumRate, premiumMap) => rows.map(r => {
      // Clamped at 0 rather than allowed to go negative — refunds can
      // never exceed what was actually sold, but this guards against
      // it visually even if it somehow did.
      const gross = Math.max(0, (revMap.get(r.id) || 0) - (refundMap.get(r.id) || 0));
      const override = r.commission_rate_override !== null && r.commission_rate_override !== undefined ? Number(r.commission_rate_override) : null;
      const isPremium = !!(premiumMap && premiumMap.has(r.id));
      // Precedence: the master on/off switch always wins (off means 0%
      // for everyone of that type); then a per-account override (most
      // specific — a manual Super Admin decision for this one account);
      // then the Premium tier rate if this vendor is currently
      // subscribed; then the plain platform default.
      const effectiveRate = commissionEnabled ? (override !== null ? override : (isPremium ? premiumRate : defaultRate)) : 0;
      const commissionAmount = Math.round(gross * (effectiveRate / 100) * 100) / 100;
      const netEarned = Math.round((gross - commissionAmount) * 100) / 100;
      const totalPaidOut = paidMap.get(r.id) || 0;
      return {
        id: r.id,
        businessName: r.business_name,
        email: r.email,
        recipientType,
        commissionRateOverride: override,
        isPremium,
        // Real start/end date range straight off the active
        // vendor_subscriptions row — what the Payouts & Commission
        // table's Premium column shows, read-only (billing-cycle-driven).
        // Null for non-Premium vendors. Premium was previously also
        // grantable for free with a Super-Admin-editable date range
        // (source = 'admin_comp') — that was removed platform-wide, see
        // isSubscriptionCurrentlyActive's comment.
        premiumStart: isPremium ? premiumMap.get(r.id).start : null,
        premiumEnd: isPremium ? premiumMap.get(r.id).end : null,
        effectiveRate,
        grossRevenue: gross,
        commissionAmount,
        netEarned,
        totalPaidOut,
        outstandingBalance: Math.max(0, Math.round((netEarned - totalPaidOut) * 100) / 100),
      };
    });

    return {
      platformSettings,
      vendors: build(vendorRows.rows, vendorRevMap, vendorRefundMap, 'vendor', platformSettings.marketplaceCommissionPercent, platformSettings.marketplaceCommissionEnabled, platformSettings.premiumCommissionPercent, premiumVendorIds),
      deliveryCompanies: build(companyRows.rows, deliveryRevMap, deliveryRefundMap, 'delivery_company', platformSettings.deliveryCommissionPercent, platformSettings.deliveryCommissionEnabled, null, null),
    };
  },

  // A real, period-bound Commission Statement (invoice) for one
  // vendor/delivery company — unlike getPayoutSummary above (which is
  // an all-time running standing), this scopes gross revenue,
  // commission, and service fee to a specific [periodStart, periodEnd)
  // window, the way an actual monthly invoice would. Every number here
  // is computed fresh from purchases/orders/disputes/payouts, never
  // stored — there's no separate "statements" table, so re-generating
  // the same recipient+period always reflects the current data (e.g.
  // if a dispute is resolved after the fact, later PDFs of that same
  // period will pick that up; already-downloaded PDFs are a snapshot,
  // same as any invoice).
  //
  // Service fee handling mirrors the reasoning worked out with the
  // user: for a vendor (marketplace), MoMo purchases already sent
  // their $0.10 straight into ONLib's own MoMo collection account at
  // checkout (see momo.js / POST /api/marketplace/checkout/momo), so
  // those are excluded from what's billed — only cash/COD purchases'
  // service fees are owed back. For a delivery company, orders.
  // payment_method is just text a delivery agent typed in when
  // accepting the order (there is no real payment gateway for
  // standalone delivery orders), so ONLib never actually receives any
  // of that money directly — every delivered order's service fee is
  // owed back, regardless of what payment_method says.
  async getCommissionStatement({ recipientType, recipientId, periodStart, periodEnd }) {
    if (!['vendor', 'delivery_company'].includes(recipientType)) return null;
    const [recipientRes, platformSettings, isPremium] = await Promise.all([
      pool.query(
        `SELECT id, business_name, email, commission_rate_override FROM users WHERE id = $1 AND role = $2`,
        [recipientId, recipientType]
      ),
      this.getPlatformSettings(),
      // Premium is a vendor-only tier — never true for a delivery company.
      recipientType === 'vendor' ? this.isVendorPremiumActive(recipientId) : Promise.resolve(false),
    ]);
    const recipient = recipientRes.rows[0];
    if (!recipient) return null;

    const override = recipient.commission_rate_override !== null && recipient.commission_rate_override !== undefined
      ? Number(recipient.commission_rate_override) : null;

    let grossRevenue, orderCount, serviceFeeOwed, serviceFeeExcludedCount, refunded, defaultRate, commissionEnabled;

    if (recipientType === 'vendor') {
      const [purchasesRes, refundRes] = await Promise.all([
        pool.query(
          `SELECT total_amount, service_fee, payment_method, payment_status
           FROM purchases WHERE vendor_id = $1 AND created_at >= $2 AND created_at < $3`,
          [recipientId, periodStart, periodEnd]
        ),
        pool.query(
          `SELECT COALESCE(SUM(d.refund_amount), 0)::numeric AS refunded
           FROM disputes d JOIN purchases pur ON pur.id = d.purchase_id
           WHERE pur.vendor_id = $1 AND pur.created_at >= $2 AND pur.created_at < $3
             AND d.status = 'resolved' AND d.refund_amount IS NOT NULL`,
          [recipientId, periodStart, periodEnd]
        ),
      ]);
      grossRevenue = purchasesRes.rows.reduce((sum, r) => sum + Number(r.total_amount), 0);
      orderCount = purchasesRes.rows.length;
      serviceFeeExcludedCount = 0;
      serviceFeeOwed = purchasesRes.rows.reduce((sum, r) => {
        const alreadyCollectedViaMomo = r.payment_method === 'momo' && r.payment_status === 'successful';
        if (alreadyCollectedViaMomo) { serviceFeeExcludedCount += 1; return sum; }
        return sum + Number(r.service_fee || 0);
      }, 0);
      refunded = Number(refundRes.rows[0].refunded);
      defaultRate = platformSettings.marketplaceCommissionPercent;
      commissionEnabled = platformSettings.marketplaceCommissionEnabled;
    } else {
      const [ordersRes, refundRes] = await Promise.all([
        pool.query(
          `SELECT amount, service_fee FROM orders
           WHERE delivery_company_id = $1 AND status = 'delivered' AND delivered_at >= $2 AND delivered_at < $3`,
          [recipientId, periodStart, periodEnd]
        ),
        pool.query(
          `SELECT COALESCE(SUM(d.refund_amount), 0)::numeric AS refunded
           FROM disputes d JOIN orders o ON o.id = d.order_id
           WHERE o.delivery_company_id = $1 AND o.delivered_at >= $2 AND o.delivered_at < $3
             AND d.status = 'resolved' AND d.refund_amount IS NOT NULL AND d.purchase_id IS NULL`,
          [recipientId, periodStart, periodEnd]
        ),
      ]);
      grossRevenue = ordersRes.rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
      orderCount = ordersRes.rows.length;
      serviceFeeExcludedCount = 0;
      serviceFeeOwed = ordersRes.rows.reduce((sum, r) => sum + Number(r.service_fee || 0), 0);
      refunded = Number(refundRes.rows[0].refunded);
      defaultRate = platformSettings.deliveryCommissionPercent;
      commissionEnabled = platformSettings.deliveryCommissionEnabled;
    }

    const netGrossRevenue = Math.max(0, Math.round((grossRevenue - refunded) * 100) / 100);
    // Same precedence as getPayoutSummary's build(): master switch >
    // per-account override > Premium tier rate > plain default.
    const effectiveRate = commissionEnabled
      ? (override !== null ? override : (isPremium ? platformSettings.premiumCommissionPercent : defaultRate))
      : 0;
    const commissionAmount = Math.round(netGrossRevenue * (effectiveRate / 100) * 100) / 100;
    serviceFeeOwed = Math.round(serviceFeeOwed * 100) / 100;

    // Payouts already recorded (via the existing Record Payout flow)
    // whose own period overlaps this statement's period — netted
    // against what's owed here, same "previously paid" idea as a real
    // invoice. Payouts predate the service fee, so this only ever
    // nets against commission, never against the service fee line.
    const paidRes = await pool.query(
      `SELECT COALESCE(SUM(net_amount), 0)::numeric AS paid FROM payouts
       WHERE recipient_id = $1 AND period_start < $3 AND period_end > $2`,
      [recipientId, periodStart, periodEnd]
    );
    const previouslyPaid = Number(paidRes.rows[0].paid);
    const balanceDue = Math.max(0, Math.round((commissionAmount + serviceFeeOwed - previouslyPaid) * 100) / 100);

    // Deterministic statement number — same recipient+period always
    // produces the same number, without needing a persisted table.
    const periodKey = String(periodStart).slice(0, 10).replace(/-/g, '');
    const shortId = recipientId.replace(/-/g, '').slice(-6).toUpperCase();
    const statementNumber = `CS-${periodKey}-${shortId}`;

    return {
      statementNumber,
      recipientType,
      recipientId: recipient.id,
      businessName: recipient.business_name,
      email: recipient.email,
      periodStart,
      periodEnd,
      orderCount,
      grossRevenue: Math.round(grossRevenue * 100) / 100,
      refunded: Math.round(refunded * 100) / 100,
      netGrossRevenue,
      effectiveRate,
      isPremium,
      commissionEnabled,
      commissionAmount,
      serviceFeeOwed,
      serviceFeeExcludedCount,
      previouslyPaid: Math.round(previouslyPaid * 100) / 100,
      balanceDue,
    };
  },

  async createPayout({ id, recipientType, recipientId, periodStart, periodEnd, grossAmount, commissionRate, notes, createdBy }) {
    const commissionAmount = Math.round(grossAmount * (commissionRate / 100) * 100) / 100;
    const netAmount = Math.round((grossAmount - commissionAmount) * 100) / 100;
    const { rows } = await pool.query(
      `INSERT INTO payouts (id, recipient_type, recipient_id, period_start, period_end, gross_amount, commission_rate, commission_amount, net_amount, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [id, recipientType, recipientId, periodStart, periodEnd, grossAmount, commissionRate, commissionAmount, netAmount, notes || null, createdBy || null]
    );
    return rowToPayout(rows[0]);
  },

  async getPayouts({ recipientId, limit = 50 } = {}) {
    const conditions = [];
    const values = [];
    let i = 1;
    if (recipientId) { conditions.push(`recipient_id = $${i}`); values.push(recipientId); i += 1; }
    values.push(limit);
    const { rows } = await pool.query(
      `SELECT * FROM payouts ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY created_at DESC LIMIT $${i}`,
      values
    );
    return rows.map(rowToPayout);
  },

  // ---- Disputes ---------------------------------------------------------
  // A customer reporting a problem with an order or marketplace
  // purchase, and a Super Admin resolving it (optionally with a
  // refund). See the schema.sql comment on the disputes table for the
  // order_id/purchase_id reasoning.

  // Shared SELECT for both getDisputes() and getDisputeById() — joins
  // in exactly the display context the Super Admin queue and the
  // customer's own dispute list need (who, what order/purchase, how
  // much, which vendor/delivery company), so callers never have to
  // make a second round trip just to render a row.
  _disputeSelect() {
    return `SELECT d.*,
        cust.business_name AS customer_name, cust.email AS customer_email,
        o.item_description AS order_item_description, o.amount AS order_amount, o.status AS order_status,
        o.delivery_company_id AS order_delivery_company_id, dc.business_name AS delivery_company_name,
        pur.total_amount AS purchase_amount, pur.vendor_id AS purchase_vendor_id, v.business_name AS vendor_name
      FROM disputes d
      JOIN users cust ON cust.id = d.customer_id
      LEFT JOIN orders o ON o.id = d.order_id
      LEFT JOIN users dc ON dc.id = o.delivery_company_id
      LEFT JOIN purchases pur ON pur.id = d.purchase_id
      LEFT JOIN users v ON v.id = pur.vendor_id`;
  },

  _rowToDisputeWithContext(r) {
    if (!r) return null;
    return {
      ...rowToDispute(r),
      customerName: r.customer_name,
      customerEmail: r.customer_email,
      order: r.order_id ? {
        itemDescription: r.order_item_description,
        amount: r.order_amount !== null && r.order_amount !== undefined ? Number(r.order_amount) : null,
        status: r.order_status,
        deliveryCompanyId: r.order_delivery_company_id,
        deliveryCompanyName: r.delivery_company_name,
      } : null,
      purchase: r.purchase_id ? {
        amount: r.purchase_amount !== null && r.purchase_amount !== undefined ? Number(r.purchase_amount) : null,
        vendorId: r.purchase_vendor_id,
        vendorName: r.vendor_name,
      } : null,
    };
  },

  async createDispute({ id, orderId, purchaseId, customerId, category, description }) {
    const { rows } = await pool.query(
      `INSERT INTO disputes (id, order_id, purchase_id, customer_id, category, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, orderId || null, purchaseId || null, customerId, category, description]
    );
    return rowToDispute(rows[0]);
  },

  async getDisputeById(id) {
    const { rows } = await pool.query(`${this._disputeSelect()} WHERE d.id = $1`, [id]);
    return this._rowToDisputeWithContext(rows[0]);
  },

  // A customer's own disputes — also used to block filing a second
  // open dispute against the same order/purchase (see the
  // already-open check in the POST /api/disputes handler).
  async getDisputesForCustomer(customerId) {
    const { rows } = await pool.query(
      `${this._disputeSelect()} WHERE d.customer_id = $1 ORDER BY d.created_at DESC`,
      [customerId]
    );
    return rows.map(r => this._rowToDisputeWithContext(r));
  },

  // Read-only vendor visibility — every dispute tied to one of this
  // vendor's own Marketplace purchases (d.purchase_id, never d.order_id
  // — an order_id dispute is a Delivery Company matter, not this
  // vendor's, per the schema.sql comment on the disputes table). A
  // vendor currently has no other way to know a dispute happened at
  // all beyond a lower payout, so this is intentionally read-only: no
  // vendor-side status/resolution mutation route exists, only Super
  // Admin resolves disputes.
  async getDisputesForVendor(vendorId, { status } = {}) {
    const values = [vendorId];
    let where = 'WHERE pur.vendor_id = $1';
    if (status) { values.push(status); where += ` AND d.status = $${values.length}`; }
    const { rows } = await pool.query(
      `${this._disputeSelect()} ${where} ORDER BY (d.status = 'open') DESC, d.created_at DESC`,
      values
    );
    return rows.map(r => this._rowToDisputeWithContext(r));
  },

  // Read-only delivery-company visibility — the mirror image of
  // getDisputesForVendor above, but keyed off d.order_id (a Delivery
  // Company matter) instead of d.purchase_id (a vendor's Marketplace
  // matter), per the schema.sql comment on the disputes table. Same
  // reasoning as the vendor version: a delivery company previously had
  // no way to know a dispute against one of its own deliveries even
  // existed, only a quieter lower payout once Super Admin resolved it.
  // Intentionally read-only for the same reason — only Super Admin
  // resolves a dispute.
  async getDisputesForDeliveryCompany(deliveryCompanyId, { status } = {}) {
    const values = [deliveryCompanyId];
    let where = 'WHERE o.delivery_company_id = $1';
    if (status) { values.push(status); where += ` AND d.status = $${values.length}`; }
    const { rows } = await pool.query(
      `${this._disputeSelect()} ${where} ORDER BY (d.status = 'open') DESC, d.created_at DESC`,
      values
    );
    return rows.map(r => this._rowToDisputeWithContext(r));
  },

  // Super Admin queue. status is optional — omitted means "all".
  async getDisputes({ status } = {}) {
    const values = [];
    let where = '';
    if (status) { values.push(status); where = 'WHERE d.status = $1'; }
    const { rows } = await pool.query(
      `${this._disputeSelect()} ${where} ORDER BY (d.status = 'open') DESC, d.created_at DESC`,
      values
    );
    return rows.map(r => this._rowToDisputeWithContext(r));
  },

  async countOpenDisputes() {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM disputes WHERE status = 'open'");
    return rows[0].count;
  },

  // The one resolve step — open -> resolved (with a refund amount) or
  // open -> rejected (no refund, resolutionNote explains why). Scoped
  // to status = 'open' so a dispute can only ever be resolved once;
  // returns null (not an error) if it's already been decided, which
  // the caller turns into a 409.
  async resolveDispute(id, { status, resolutionNote, refundAmount, resolvedBy }) {
    const { rows } = await pool.query(
      `UPDATE disputes SET status = $1, resolution_note = $2, refund_amount = $3, resolved_by = $4, resolved_at = now()
       WHERE id = $5 AND status = 'open' RETURNING *`,
      [status, resolutionNote, refundAmount, resolvedBy || null, id]
    );
    return rowToDispute(rows[0]);
  },

  // ---- Audit log ------------------------------------------------------
  // Append-only by design — no update/delete helper exists here on
  // purpose, matching how login_history is treated elsewhere.

  async createAuditLogEntry({ id, actorId, actorName, actorRole, action, targetType, targetId, targetLabel, details }) {
    const { rows } = await pool.query(
      `INSERT INTO audit_log (id, actor_id, actor_name, actor_role, action, target_type, target_id, target_label, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [id, actorId || null, actorName, actorRole, action, targetType || null, targetId || null, targetLabel || null, JSON.stringify(details || {})]
    );
    return rowToAuditLogEntry(rows[0]);
  },

  async getAuditLog({ limit = 50, before, action, actorId } = {}) {
    const conditions = [];
    const values = [];
    let i = 1;
    if (before) { conditions.push(`created_at < $${i}`); values.push(before); i += 1; }
    if (action) { conditions.push(`action = $${i}`); values.push(action); i += 1; }
    if (actorId) { conditions.push(`actor_id = $${i}`); values.push(actorId); i += 1; }
    values.push(limit);
    const { rows } = await pool.query(
      `SELECT * FROM audit_log ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY created_at DESC LIMIT $${i}`,
      values
    );
    return rows.map(rowToAuditLogEntry);
  },

  async getAuditActionKeys() {
    const { rows } = await pool.query('SELECT DISTINCT action FROM audit_log ORDER BY action');
    return rows.map(r => r.action);
  },
};

module.exports = db;
