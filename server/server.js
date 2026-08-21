// server.js — Express + Socket.io backend for Railway.
// Single container: serves the static frontend AND the realtime API.
require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const db = require('./db');
const { notifyNewOrder, sendMessage, notifyNewVendorApplication, sendEmail, notifySubscriptionRenewalDue, notifyLowStock, notifyNewProductFromFollowedStore } = require('./notify');
const { sendPushToUser, publicKey: VAPID_PUBLIC_KEY } = require('./push');
const momo = require('./momo');
const { parsePriceRowsFromText } = require('./pricePresetPdfParser');
const DEFAULT_HOME_BANNERS = require('./seed-data/default-home-banners');
const { OAuth2Client } = require('google-auth-library');
const {
  hashPassword,
  comparePassword,
  signToken,
  signImpersonationToken,
  verifyToken,
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
  requireVendor,
  requireDeliveryCompany,
  isAdminLike,
  socketAuth,
} = require('./auth');

const PORT = process.env.PORT || 3000;

// Granular, per-account feature permissions — Super Admin cutting off
// specific capabilities for a Manage Agent account. This is the
// authoritative list of what can be toggled; deliberately excludes
// personal account security (own password/email/login history), which
// stays available no matter what — see the schema.sql comment on
// disabled_features for the full reasoning.
const FEATURE_KEYS = {
  new_order: 'Create New Order (on behalf of a customer)',
  order_actions: 'Accept, update, and cancel orders',
  // 'fleet' used to live here as a togglable per-account permission
  // (Super Admin could grant/revoke Fleet Directory access for a
  // specific Manage Agent account). Removed entirely at the Super
  // Admin's request — Fleet Directory / Agent Contacts is no longer
  // available to Manage Agent at all, for any account, so there's
  // nothing left to toggle. See the four agent:* socket handlers below,
  // which now hard-require role === 'super_admin' (or delivery_company
  // for its own agents) instead of checking this key.
  expenses: 'Expenses',
  price_presets: 'Price Presets',
  customers: 'Customers panel',
  business_settings: 'Business Profile settings (logo, hours, currency)',
  backup_restore: 'Export & Backup/Restore Database',
  // Client-side only — the Monthly/Daily Report PDFs are generated in
  // the browser from data the account already has loaded (same as the
  // Overview stats), so there's no separate server endpoint to enforce
  // this against. Unlike every other key above, this is a UI-visibility
  // toggle, not a hard security boundary; documented here so that stays
  // obvious rather than assumed.
  reports: 'Monthly & Daily Reports (view and download PDF)',
  // Support Inbox was built Super-Admin-only (see the "Support Inbox"
  // section of the README) — a Manage Agent account couldn't reach it
  // at all, gated purely in the frontend nav. Opened up to Manage
  // Agent as an opt-in, Super-Admin-granted permission like every
  // other key here, rather than turned on unconditionally for every
  // Manage Agent account.
  support_inbox: 'Support Inbox (live chat with customers/vendors/delivery companies)',
};

// REST middleware version — checked fresh against the database on
// every request (not cached in the JWT), so a Super Admin's change
// takes effect immediately, the same principle as is_disabled/
// token_version elsewhere in this file. super_admin is always exempt
// — these restrictions only ever apply to role = 'admin'.
function requireFeature(featureKey) {
  return async (req, res, next) => {
    if (req.user.role === 'super_admin') return next();
    try {
      const disabled = await db.isFeatureDisabledForUser(req.user.id, featureKey);
      if (disabled) {
        return res.status(403).json({ error: `This feature has been turned off for your account by a Super Admin: ${FEATURE_KEYS[featureKey] || featureKey}` });
      }
      next();
    } catch (err) {
      console.error('requireFeature check failed', err);
      res.status(500).json({ error: 'Failed to verify permissions' });
    }
  };
}

// Socket.io version — same check, callable inline inside a handler
// since Socket.io events don't support Express-style middleware chains.
async function checkFeatureEnabled(user, featureKey) {
  if (user.role === 'super_admin') return true;
  return !(await db.isFeatureDisabledForUser(user.id, featureKey));
}

// Append-only audit trail for Super Admin actions. Best-effort by
// design: a logging failure must never block or roll back the action
// it's describing, so failures are swallowed here (after being logged
// server-side) rather than surfaced to the caller. req.user comes from
// the verified JWT payload (see auth.js signToken) and already carries
// id/role/businessName/email, so no extra DB lookup is needed just to
// know who did this.
async function logAudit(req, action, { targetType, targetId, targetLabel, details } = {}) {
  try {
    await db.createAuditLogEntry({
      id: crypto.randomUUID(),
      actorId: req.user?.id || null,
      actorName: req.user?.businessName || req.user?.email || 'Unknown',
      actorRole: req.user?.role || 'unknown',
      action,
      targetType: targetType || null,
      targetId: targetId || null,
      targetLabel: targetLabel || null,
      details: details || {},
    });
  } catch (err) {
    console.error(`logAudit failed for action "${action}"`, err);
  }
}

// Sign in with Google — optional, same graceful-degradation pattern as
// Twilio below. Unset means the feature simply isn't available yet;
// nothing else in the app depends on it.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// The admin side keeps a single shared password (as in the original app),
// rather than per-admin email+password — set ADMIN_PASSWORD in Railway's
// Variables tab to change it. Defaults to "1Nigeria@" so the app works
// out of the box without any env config.
// ONLib rebrand: Manage Agent is now ONLib's own operational account,
// not Verta's — Verta operates as an ordinary delivery_company account
// with no special access, same as any other company. LEGACY_ADMIN_EMAIL
// is kept around specifically so the one-time migration below can find
// and rename the existing account rather than create a duplicate.
const LEGACY_ADMIN_EMAIL = 'admin@vertadelivery.com';
const DEFAULT_ADMIN_EMAIL = 'onlib231@gmail.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1Nigeria@';

// Verta's own delivery_company account — reuses ADMIN_PASSWORD's
// default password for consistency, but a genuinely distinct email
// from Manage Agent's, so it can be created immediately with no
// rename dependency.
const VERTA_DC_EMAIL = process.env.VERTA_DC_EMAIL || 'verta.dc@vertadelivery.com';
const VERTA_DC_PASSWORD = process.env.VERTA_DC_PASSWORD || '1Nigeria@';

// Extra confirmation step for destructive actions (bulk order delete,
// expense delete) — required on top of already being logged in as admin.
// Matches the original app's behavior. Set DELETE_PASSWORD to override.
const DELETE_PASSWORD = process.env.DELETE_PASSWORD || 'SKY';

const app = express();

// Railway (and most hosts) put the app behind a reverse proxy — without
// this, express-rate-limit below would see every request as coming from
// the same proxy IP and either rate-limit all users together or refuse
// to start in strict mode. `1` trusts exactly one hop (Railway's edge).
app.set('trust proxy', 1);

app.use(cors());
// Default express.json() limit is 100kb — too small for base64 image/
// document uploads (product photos, business logos, vendor registration
// documents). Raised to comfortably cover the largest of those with
// room for JSON overhead and two documents in one request.
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Brute-force protection on the three password-checking endpoints
// (sender login, sender registration, admin login). Generous enough
// for a real person mistyping a password a few times, tight enough to
// blunt scripted guessing — each IP gets 10 attempts per 15 minutes
// across these endpoints combined.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

const server = http.createServer(app);

// Small, honest User-Agent parser for login history — covers the common
// cases (not a full device-detection library) rather than pretending to
// be exhaustive. Falls back to "Unknown" instead of guessing.
function parseUserAgent(ua) {
  if (!ua) return { device: 'Unknown', browser: 'Unknown' };
  let device = 'Desktop';
  if (/iPhone/i.test(ua)) device = 'iPhone';
  else if (/iPad/i.test(ua)) device = 'iPad';
  else if (/Android/i.test(ua)) device = 'Android';
  else if (/Macintosh/i.test(ua)) device = 'Mac';
  else if (/Windows/i.test(ua)) device = 'Windows';
  else if (/Linux/i.test(ua)) device = 'Linux';

  let browser = 'Unknown';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';

  return { device, browser };
}

async function recordLoginHistory(req, userId) {
  try {
    const { device, browser } = parseUserAgent(req.headers['user-agent']);
    const sessionId = crypto.randomUUID();
    await db.recordLogin({ id: sessionId, userId, ipAddress: req.ip, device, browser });
    return sessionId;
  } catch (err) {
    // Login history is a convenience, never a reason to fail a login —
    // a null sessionId just means this token won't support individual
    // revocation (falls back to "Logout All Devices" only).
    console.error('recordLoginHistory failed', err);
    return null;
  }
}

// Socket.io on the same HTTP server/port — Railway only exposes one port
// per service, so frontend and websocket traffic share it. The frontend
// connects with `io({ auth: { token } })` (no URL) which resolves to
// same-origin automatically.
const io = new Server(server, {
  cors: { origin: '*' }, // tighten to your real domain once you have one
});

io.use(socketAuth); // every socket connection must present a valid JWT

// Room strategy:
//   - Each sender's sockets join `user:<their id>` — so a sender's own
//     browsers/devices sync with each other, and only see their own orders.
//   - Every admin socket joins `admins` — admins see every order from every
//     sender, live, across all their own devices too.
//   - Every delivery_company socket joins TWO rooms: `pending-orders` (a
//     shared pool, deliberately not company-scoped, so every approved
//     company gets real-time visibility into new, unassigned orders any of
//     them could accept) AND its own `delivery-company:<their id>` room —
//     a real per-tenant room, the same idea as `vendor:<id>` below.
//     Previously `pending-orders` was the ONLY room a delivery-company
//     socket ever joined, so once an order was accepted by one company,
//     every further update to it (amount, agent, payment method, admin
//     edits) still broadcast to `pending-orders` and therefore leaked to
//     every OTHER company too — not just the one that accepted it. Adding
//     the per-company room and having orderRooms() below switch to it once
//     an order is claimed closes that leak.
// orderRooms(order) picks the right room set for THIS order's current
// state: still-pending/unclaimed orders (no deliveryCompanyId yet)
// broadcast to the whole `pending-orders` pool, since any company might
// accept them; once claimed, only that one company's own room gets
// further updates.
function orderRooms(order) {
  const rooms = [`user:${order.senderId}`, 'admins'];
  rooms.push(order.deliveryCompanyId ? `delivery-company:${order.deliveryCompanyId}` : 'pending-orders');
  return rooms;
}

io.on('connection', (socket) => {
  const room = isAdminLike(socket.user.role) ? 'admins' : `user:${socket.user.id}`;
  socket.join(room);
  if (socket.user.role === 'vendor') {
    // Vendors keep their own `vendor:<id>` room for vendor-specific
    // broadcasts (new purchase orders, product Q&A, store messages) AND
    // now also join `user:<id>` above like every other non-admin role —
    // vendors can place their own delivery orders (order:create below),
    // and orderRooms() below broadcasts order:created/order:updated to
    // `user:${order.senderId}`, the same way it already does for a
    // regular customer's own orders. Without this, a vendor's own
    // delivery-order status changes wouldn't reach their open tab live.
    socket.join(`vendor:${socket.user.id}`);
  }
  if (socket.user.role === 'delivery_company') {
    socket.join('pending-orders');
    socket.join(`delivery-company:${socket.user.id}`);
  }
  console.log(`[socket] ${socket.user.role} connected: ${socket.user.email} (${socket.id})`);

  socket.on('disconnect', () => {
    console.log(`[socket] disconnected: ${socket.user.email} (${socket.id})`);
  });

  // ---- Orders (create = sender or vendor, on their own behalf; everything else = admin only) ----

  socket.on('order:create', async (payload, ack) => {
    // Vendors can place their own delivery orders too (e.g. sending
    // stock between stores, or a courier pickup) — same flow as a
    // regular customer sending a package, just gated to their own
    // account like everything else non-admin here.
    const isSender = socket.user.role === 'sender' || socket.user.role === 'vendor';
    const isAdmin = isAdminLike(socket.user.role);
    if (!isSender && !isAdmin) {
      return ack && ack({ ok: false, error: 'Not allowed to create orders' });
    }
    // Maintenance mode pauses new order creation platform-wide — super
    // admin stays exempt, since they're the only role that can turn it
    // back off and may need to place/test an order while it's on.
    if (socket.user.role !== 'super_admin') {
      const platformSettings = await db.getPlatformSettings();
      if (platformSettings.maintenanceMode) {
        return ack && ack({ ok: false, error: platformSettings.maintenanceMessage || 'New orders are temporarily paused for maintenance. Please try again shortly.' });
      }
    }
    try {
      let senderId = socket.user.id;
      let senderName = socket.user.businessName;
      if (isAdmin) {
        if (!(await checkFeatureEnabled(socket.user, 'new_order'))) {
          return ack && ack({ ok: false, error: `This feature has been turned off for your account by a Super Admin: ${FEATURE_KEYS.new_order}` });
        }
        // Admin is placing this on a customer's behalf (phone/walk-in
        // order) — look up the real customer record rather than trusting
        // any name the client might send, same principle as everywhere
        // else in this app.
        if (!payload.senderId) {
          return ack && ack({ ok: false, error: 'Please choose which customer this order is for' });
        }
        const customer = await db.getUserById(payload.senderId);
        if (!customer || customer.role !== 'sender') {
          return ack && ack({ ok: false, error: 'Customer not found' });
        }
        senderId = customer.id;
        senderName = customer.businessName;
      }
      // Scheduled/recurring "Send a Package" orders — optional. A
      // future scheduled_for gets status='scheduled' instead of
      // 'pending' so it stays invisible to delivery companies until a
      // periodic sweep promotes it (see runScheduledOrderSweep below
      // and the design comment in schema.sql). recurrence is only
      // meaningful alongside a real scheduled_for.
      let scheduledFor = null;
      let recurrence = null;
      if (payload.scheduledFor) {
        scheduledFor = new Date(payload.scheduledFor);
        if (isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now()) {
          return ack && ack({ ok: false, error: 'Scheduled time must be in the future' });
        }
        if (['daily', 'weekly'].includes(payload.recurrence)) recurrence = payload.recurrence;
      }
      const order = await db.createOrder({
        // Date.now() alone is NOT safe as a unique ID source — it has
        // only millisecond resolution, so two requests landing in the
        // same millisecond (a double-click, a rapid resubmit) would
        // generate the exact same order ID. Appending a short random
        // suffix makes a collision astronomically unlikely even for
        // genuinely simultaneous requests.
        id: `ORD-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        senderId,
        senderName,
        pickupAddress: payload.pickupAddress,
        dropoffAddress: payload.dropoffAddress,
        itemDescription: payload.itemDescription,
        amount: null,
        status: scheduledFor ? 'scheduled' : 'pending',
        placedByAdmin: isAdmin,
        scheduledFor,
        recurrence,
      });
      if (order.status === 'scheduled') {
        // Not accept-ready yet — only the sender and admins need to
        // know it exists; delivery companies don't see it until the
        // sweep promotes it to 'pending' and broadcasts it for real.
        io.to(`user:${order.senderId}`).to('admins').emit('order:created', order);
      } else {
        orderRooms(order).forEach((r) => io.to(r).emit('order:created', order));
        notifyNewOrder(order); // fire-and-forget — never blocks the order response
      }
      ack && ack({ ok: true, order });
    } catch (err) {
      console.error('order:create failed', err);
      ack && ack({ ok: false, error: 'Failed to create order' });
    }
  });

  socket.on('order:cancel', async ({ id }, ack) => {
    if (socket.user.role !== 'sender' && socket.user.role !== 'vendor') {
      return ack && ack({ ok: false, error: 'Only the sender who placed an order can cancel it' });
    }
    try {
      const existing = await db.getOrder(id);
      if (!existing) return ack && ack({ ok: false, error: 'Order not found' });
      if (existing.senderId !== socket.user.id) {
        return ack && ack({ ok: false, error: 'You can only cancel your own orders' });
      }
      if (existing.status === 'scheduled') {
        // Not due yet — no restock/atomic-accept concerns apply, so
        // this is a simpler cancel than cancelOrderAndRestock below.
        const order = await db.cancelScheduledOrder(id, socket.user.id);
        if (!order) return ack && ack({ ok: false, error: 'This scheduled order was already cancelled or is no longer scheduled' });
        io.to(`user:${order.senderId}`).to('admins').emit('order:updated', order);
        return ack && ack({ ok: true, order });
      }
      if (existing.status !== 'pending') {
        return ack && ack({ ok: false, error: 'Only pending orders (not yet accepted by an agent) can be cancelled' });
      }
      // Atomically cancels + restocks (if this order is linked to a
      // marketplace purchase) — see cancelOrderAndRestock's own comment.
      const order = await db.cancelOrderAndRestock(id);
      if (!order) {
        return ack && ack({ ok: false, error: 'Only pending orders (not yet accepted by an agent) can be cancelled' });
      }
      orderRooms(order).forEach((r) => io.to(r).emit('order:updated', order));
      ack && ack({ ok: true, order });
    } catch (err) {
      console.error('order:cancel failed', err);
      ack && ack({ ok: false, error: 'Failed to cancel order' });
    }
  });

  socket.on('order:update', async ({ id, fields }, ack) => {
    if (!isAdminLike(socket.user.role)) {
      return ack && ack({ ok: false, error: 'Only admins can update orders' });
    }
    if (!(await checkFeatureEnabled(socket.user, 'order_actions'))) {
      return ack && ack({ ok: false, error: `This feature has been turned off for your account by a Super Admin: ${FEATURE_KEYS.order_actions}` });
    }
    try {
      const order = await db.updateOrder(id, fields);
      orderRooms(order).forEach((r) => io.to(r).emit('order:updated', order));
      if (order.status === 'picked-up') {
        sendPushToUser(db, order.senderId, { title: 'Order picked up', body: `Your order ${order.id} is on its way.`, url: '/' }); // fire-and-forget
      } else if (order.status === 'delivered') {
        sendPushToUser(db, order.senderId, { title: 'Order delivered', body: `Your order ${order.id} has been delivered.`, url: '/' }); // fire-and-forget
      }
      ack && ack({ ok: true, order });
    } catch (err) {
      console.error('order:update failed', err);
      ack && ack({ ok: false, error: 'Failed to update order' });
    }
  });

  socket.on('order:accept', async ({ id, amount, agentId, acceptedBy, paymentMethod }, ack) => {
    if (!isAdminLike(socket.user.role) && socket.user.role !== 'delivery_company') {
      return ack && ack({ ok: false, error: 'Only admins can accept orders' });
    }
    if (isAdminLike(socket.user.role) && !(await checkFeatureEnabled(socket.user, 'order_actions'))) {
      return ack && ack({ ok: false, error: `This feature has been turned off for your account by a Super Admin: ${FEATURE_KEYS.order_actions}` });
    }
    try {
      // Prefer a real agent id — the collision-safe lookup — over the
      // legacy name-based one. Agents have no uniqueness constraint on
      // `name` (see schema.sql), so two agents sharing a name, even
      // across two different companies, could previously resolve to the
      // wrong one via getAgentByName()'s unordered `LIMIT 1`: wrongly
      // denying a delivery company's own accept ("not your agent"), or
      // worse, wrongly attributing the order's deliveryCompanyId to
      // someone else's company. acceptedBy (name) is kept ONLY as a
      // fallback for a browser tab still holding pre-fix JS during a
      // rolling deploy; every reloaded client now sends agentId.
      const agent = agentId
        ? await db.getAgentById(agentId)
        : (acceptedBy ? await db.getAgentByName(acceptedBy) : null);
      // A delivery company can only accept using one of its own
      // agents — this is the real check, not just trusting whatever
      // id/name the client sent.
      if (socket.user.role === 'delivery_company') {
        if (!agent || agent.deliveryCompanyId !== socket.user.id) {
          return ack && ack({ ok: false, error: 'That agent does not belong to your company' });
        }
      }
      // accepted_by is stored as a permanent, point-in-time snapshot of
      // the agent's name (see schema.sql) — always derived from the
      // resolved agent now, not trusted verbatim from the client, so a
      // stale/mismatched acceptedBy string can no longer end up on the
      // order. Falls back to the raw client string only in the rare
      // admin case where no agent record matched at all (preserves prior
      // permissiveness for admins, who aren't restricted to real agents).
      const order = await db.acceptOrderAtomic(id, {
        amount,
        acceptedBy: agent ? agent.name : (acceptedBy || 'Unknown'),
        paymentMethod: paymentMethod || null,
        deliveryCompanyId: agent ? agent.deliveryCompanyId : null,
        // Real agent_id link (see schema.sql) — only set when a real
        // agent record was resolved above, same condition acceptedBy's
        // name snapshot already uses.
        agentId: agent ? agent.id : null,
      });
      if (!order) {
        return ack && ack({ ok: false, error: 'This order was already accepted — someone got there first.' });
      }
      orderRooms(order).forEach((r) => io.to(r).emit('order:updated', order));
      sendPushToUser(db, order.senderId, { title: 'Order accepted', body: `${order.acceptedBy} is on the way for order ${order.id}.`, url: '/' }); // fire-and-forget
      ack && ack({ ok: true, order });
    } catch (err) {
      console.error('order:accept failed', err);
      ack && ack({ ok: false, error: 'Failed to accept order' });
    }
  });

  socket.on('order:delete-bulk', async ({ ids, password }, ack) => {
    if (!isAdminLike(socket.user.role)) {
      return ack && ack({ ok: false, error: 'Only admins can delete orders' });
    }
    if (!(await checkFeatureEnabled(socket.user, 'order_actions'))) {
      return ack && ack({ ok: false, error: `This feature has been turned off for your account by a Super Admin: ${FEATURE_KEYS.order_actions}` });
    }
    if (!password || password !== DELETE_PASSWORD) {
      return ack && ack({ ok: false, error: 'Incorrect delete password' });
    }
    try {
      // Look up owning senders before deleting so we know which rooms to notify.
      const affected = (await Promise.all(ids.map((id) => db.getOrder(id)))).filter(Boolean);
      await db.deleteOrders(ids);
      const senderIds = [...new Set(affected.map((o) => o.senderId))];
      senderIds.forEach((sid) => io.to(`user:${sid}`).emit('order:deleted', { ids }));
      io.to('admins').emit('order:deleted', { ids });
      ack && ack({ ok: true });
    } catch (err) {
      console.error('order:delete-bulk failed', err);
      ack && ack({ ok: false, error: 'Failed to delete orders' });
    }
  });

  // ---- Expenses (admin only, not tied to a sender) ----

  socket.on('expense:create', async (payload, ack) => {
    if (!isAdminLike(socket.user.role)) {
      return ack && ack({ ok: false, error: 'Only admins can add expenses' });
    }
    if (!(await checkFeatureEnabled(socket.user, 'expenses'))) {
      return ack && ack({ ok: false, error: `This feature has been turned off for your account by a Super Admin: ${FEATURE_KEYS.expenses}` });
    }
    try {
      const expense = await db.createExpense({ ...payload, id: `expense-${Date.now()}` });
      io.to('admins').emit('expense:created', expense);
      ack && ack({ ok: true, expense });
    } catch (err) {
      console.error('expense:create failed', err);
      ack && ack({ ok: false, error: 'Failed to add expense' });
    }
  });

  socket.on('expense:delete', async ({ id, password }, ack) => {
    if (!isAdminLike(socket.user.role)) {
      return ack && ack({ ok: false, error: 'Only admins can delete expenses' });
    }
    if (!(await checkFeatureEnabled(socket.user, 'expenses'))) {
      return ack && ack({ ok: false, error: `This feature has been turned off for your account by a Super Admin: ${FEATURE_KEYS.expenses}` });
    }
    if (!password || password !== DELETE_PASSWORD) {
      return ack && ack({ ok: false, error: 'Incorrect delete password' });
    }
    try {
      await db.deleteExpense(id);
      io.to('admins').emit('expense:deleted', { id });
      ack && ack({ ok: true });
    } catch (err) {
      console.error('expense:delete failed', err);
      ack && ack({ ok: false, error: 'Failed to delete expense' });
    }
  });

  // ---- Fleet Directory (agents) — admin-managed, admin-only --------

  // Agent CRUD previously only ever emitted to `admins` — a delivery
  // company creating/editing/toggling duty status on its OWN agent got
  // no real-time echo of that at all, since delivery-company sockets
  // were never members of `admins` and there was no per-company room to
  // target instead. Now that each delivery-company socket also joins
  // `delivery-company:<their id>` (see the room-strategy comment above),
  // route the same event there too when the agent belongs to one.
  function emitAgentEvent(eventName, agent) {
    io.to('admins').emit(eventName, agent);
    if (agent.deliveryCompanyId) {
      io.to(`delivery-company:${agent.deliveryCompanyId}`).emit(eventName, agent);
    }
  }

  // Admin/staff accounts aren't a delivery company themselves — they're
  // just the platform operator — so every agent they add or reassign
  // must be explicitly pointed at a real, active delivery company
  // (Verta or any other registered one), never left owned by the admin
  // account itself the way legacy agents were. Returns the validated
  // company id, or throws an object with an .ack error message the
  // caller can hand straight to its ack() callback. A delivery_company
  // account is unaffected either way — it can only ever act on its own
  // fleet, so this isn't called for that role at all.
  async function resolveAdminChosenDeliveryCompanyId(deliveryCompanyId) {
    if (!deliveryCompanyId) {
      throw { ack: { ok: false, error: 'Please select a delivery company for this agent.' } };
    }
    const company = await db.getUserById(deliveryCompanyId);
    if (!company || company.role !== 'delivery_company' || company.approvalStatus !== 'approved' || company.isDisabled) {
      throw { ack: { ok: false, error: 'That delivery company is not available. Please pick another.' } };
    }
    return company.id;
  }

  // Rider payout percentage — a delivery-company-only setting (product
  // decision: Super Admin never sets or edits this, even though it can
  // otherwise manage any company's agents). Validates a raw client
  // value into either undefined (field omitted — leave unchanged),
  // null (explicitly cleared — no percentage set), or a finite number
  // in [0, 100] rounded to match the agents.payout_percent NUMERIC(5,2)
  // column. Throws an object with an .ack error the caller can hand
  // straight to ack(), same convention as resolveAdminChosenDeliveryCompanyId.
  function parsePayoutPercent(raw) {
    if (raw === undefined) return undefined;
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw { ack: { ok: false, error: 'Payout percentage must be a number between 0 and 100.' } };
    }
    return Math.round(n * 100) / 100;
  }

  // Fleet Directory / agent management is Super Admin + delivery_company
  // only now — Manage Agent ('admin') lost this ability entirely (see
  // the FEATURE_KEYS.fleet removal comment above), not just the UI for
  // it, so the role check below is a hard exclusion rather than a
  // togglable checkFeatureEnabled() call.
  socket.on('agent:create', async ({ name, phone, deliveryCompanyId, payoutPercent }, ack) => {
    if (socket.user.role !== 'super_admin' && socket.user.role !== 'delivery_company') {
      return ack && ack({ ok: false, error: 'Only Super Admin can add agents' });
    }
    if (!name || !name.trim() || !phone || !phone.trim()) {
      return ack && ack({ ok: false, error: 'Name and phone are required' });
    }
    try {
      // A delivery_company account adding its own agent is unambiguous:
      // always assigned to itself, ignoring any deliveryCompanyId the
      // client might send. An admin/staff account must pick a real one.
      const resolvedCompanyId = socket.user.role === 'delivery_company'
        ? socket.user.id
        : await resolveAdminChosenDeliveryCompanyId(deliveryCompanyId);
      // Payout % is delivery-company-only (see parsePayoutPercent above)
      // — an admin/staff account creating an agent never sets this,
      // regardless of what the client sends.
      const resolvedPayoutPercent = socket.user.role === 'delivery_company'
        ? (parsePayoutPercent(payoutPercent) ?? null)
        : null;
      const agent = await db.createAgent({ id: crypto.randomUUID(), name: name.trim(), phone: phone.trim(), deliveryCompanyId: resolvedCompanyId, payoutPercent: resolvedPayoutPercent });
      emitAgentEvent('agent:created', agent);
      ack && ack({ ok: true, agent });
    } catch (err) {
      if (err && err.ack) return ack && ack(err.ack);
      console.error('agent:create failed', err);
      ack && ack({ ok: false, error: 'Failed to add agent' });
    }
  });

  socket.on('agent:update', async ({ id, name, phone, deliveryCompanyId, payoutPercent }, ack) => {
    if (socket.user.role !== 'super_admin' && socket.user.role !== 'delivery_company') {
      return ack && ack({ ok: false, error: 'Only Super Admin can edit agents' });
    }
    if (!name || !name.trim() || !phone || !phone.trim()) {
      return ack && ack({ ok: false, error: 'Name and phone are required' });
    }
    try {
      // resolvedCompanyId stays undefined (= leave the agent's current
      // company unchanged in db.updateAgent) unless an admin/staff
      // account explicitly sent a new one to reassign it — e.g. fixing
      // up a legacy agent still owned by the admin account, or moving
      // an agent to a different company. A delivery_company account can
      // rename/re-phone its own agent but can never reassign it away to
      // another company; that stays admin-only.
      let resolvedCompanyId;
      if (socket.user.role === 'delivery_company') {
        const existing = await db.getAgentById(id);
        if (!existing || existing.deliveryCompanyId !== socket.user.id) {
          return ack && ack({ ok: false, error: 'Agent not found' });
        }
      } else if (deliveryCompanyId !== undefined) {
        resolvedCompanyId = await resolveAdminChosenDeliveryCompanyId(deliveryCompanyId);
      }
      // Payout % is delivery-company-only (see parsePayoutPercent above)
      // — resolvedPayoutPercent stays undefined (= leave unchanged in
      // db.updateAgent) for every role but delivery_company, even if an
      // admin/staff client somehow sent a value.
      const resolvedPayoutPercent = socket.user.role === 'delivery_company'
        ? parsePayoutPercent(payoutPercent)
        : undefined;
      const agent = await db.updateAgent(id, { name: name.trim(), phone: phone.trim(), deliveryCompanyId: resolvedCompanyId, payoutPercent: resolvedPayoutPercent });
      if (!agent) return ack && ack({ ok: false, error: 'Agent not found' });
      emitAgentEvent('agent:updated', agent);
      ack && ack({ ok: true, agent });
    } catch (err) {
      if (err && err.ack) return ack && ack(err.ack);
      console.error('agent:update failed', err);
      ack && ack({ ok: false, error: 'Failed to update agent' });
    }
  });

  // Removing an agent — same authorization shape as agent:update: Super
  // Admin can remove any agent, a delivery_company can only remove its
  // own. Hard delete is safe (see the comment on db.deleteAgent) — no
  // historical order data references agents.id.
  socket.on('agent:remove', async ({ id }, ack) => {
    if (socket.user.role !== 'super_admin' && socket.user.role !== 'delivery_company') {
      return ack && ack({ ok: false, error: 'Only Super Admin can remove agents' });
    }
    try {
      const existing = await db.getAgentById(id);
      if (!existing) return ack && ack({ ok: false, error: 'Agent not found' });
      if (socket.user.role === 'delivery_company' && existing.deliveryCompanyId !== socket.user.id) {
        return ack && ack({ ok: false, error: 'Agent not found' });
      }
      const removed = await db.deleteAgent(id);
      if (!removed) return ack && ack({ ok: false, error: 'Agent not found' });
      // Broadcast the pre-deletion record (it has the id and
      // deliveryCompanyId emitAgentEvent needs to route the event) so
      // every connected admin/staff tab and the owning company's tab
      // can drop it from their local list.
      emitAgentEvent('agent:removed', existing);
      ack && ack({ ok: true });
    } catch (err) {
      console.error('agent:remove failed', err);
      ack && ack({ ok: false, error: 'Failed to remove agent' });
    }
  });

  // "On Duty / Off Duty" — explicitly admin-set, not automatic presence
  // (see the duty_status comment in schema.sql for why).
  socket.on('agent:set-duty-status', async ({ id, dutyStatus }, ack) => {
    if (socket.user.role !== 'super_admin' && socket.user.role !== 'delivery_company') {
      return ack && ack({ ok: false, error: 'Only Super Admin can change agent duty status' });
    }
    if (dutyStatus !== 'on_duty' && dutyStatus !== 'off_duty') {
      return ack && ack({ ok: false, error: 'Invalid duty status' });
    }
    try {
      if (socket.user.role === 'delivery_company') {
        const existing = await db.getAgentById(id);
        if (!existing || existing.deliveryCompanyId !== socket.user.id) {
          return ack && ack({ ok: false, error: 'Agent not found' });
        }
      }
      const agent = await db.updateAgentDutyStatus(id, dutyStatus);
      if (!agent) return ack && ack({ ok: false, error: 'Agent not found' });
      emitAgentEvent('agent:updated', agent);
      ack && ack({ ok: true, agent });
    } catch (err) {
      console.error('agent:set-duty-status failed', err);
      ack && ack({ ok: false, error: 'Failed to update duty status' });
    }
  });
});

// ============================================================
// REST: auth + one-time initial state load
// ============================================================

// Zone Search Picker support — a customer registering (or, separately,
// saving an address) can optionally search-and-pick a Region/Zone
// instead of typing an address blind. Shared validator since three
// registration routes plus the saved-addresses routes all need the
// same "if given, it must be a real zone" check.
async function validateOptionalZoneId(zoneId) {
  if (!zoneId) return true;
  const zone = await db.getDeliveryZoneById(zoneId);
  return !!zone;
}

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { businessName, email, password, phone, address, deliveryZoneId } = req.body || {};
  if (!businessName || !email || !password || !phone) {
    return res.status(400).json({ error: 'businessName, email, phone, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!(await validateOptionalZoneId(deliveryZoneId))) {
    return res.status(400).json({ error: 'Selected delivery zone was not found' });
  }
  try {
    const existing = await db.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const passwordHash = await hashPassword(password);
    const user = await db.createUser({
      id: crypto.randomUUID(),
      businessName,
      email,
      phone,
      passwordHash,
      role: 'sender', // public registration always creates senders; admins are seeded (see below)
    });
    // A customer's zone lives per saved address, not on the user (see
    // schema.sql's comment on saved_addresses.zone_id) — so an address
    // typed/picked at registration becomes their first, default saved
    // address, exactly like adding one later from Settings would.
    // Optional and best-effort: a failure here never fails the account
    // creation that already succeeded above.
    if (address && address.trim()) {
      try {
        await db.createSavedAddress({
          id: crypto.randomUUID(), customerId: user.id, label: 'Home', address: address.trim(), isDefault: true, zoneId: deliveryZoneId || null,
        });
      } catch (err) {
        console.error('register: failed to save initial address', err);
      }
    }
    const sessionId = await recordLoginHistory(req, user.id);
    const token = signToken(user, sessionId);
    res.json({ token, user: { id: user.id, businessName: user.businessName, email: user.email, phone: user.phone, storeAddress: user.storeAddress, vendorType: user.vendorType, avgPrepTimeMinutes: user.avgPrepTimeMinutes, profileImageUrl: user.profileImageUrl, role: user.role, approvalStatus: user.approvalStatus, rejectionReason: user.rejectionReason } });
  } catch (err) {
    console.error('register failed', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Vendor self-registration — creates a real account (so the applicant
// can log in and see their status) but starts 'pending': requireVendor
// blocks every actual vendor action (products, orders, etc.) until a
// Super Admin approves it. That approval UI doesn't exist yet — this
// endpoint is the intake side of that workflow; the review side is a
// separate, later piece of work.
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024; // ~2MB raw per document — these are photos of real paperwork, larger than a product photo
const VALID_ID_DOCUMENT_TYPES = ['passport', 'national_id', 'drivers_license'];

app.post('/api/auth/register-vendor', authLimiter, async (req, res) => {
  const { businessName, email, password, phone, businessRegistrationDoc, idDocumentType, idDocumentDoc, vendorType, deliveryZoneId } = req.body || {};
  if (!businessName || !email || !password || !phone) {
    return res.status(400).json({ error: 'Business name, email, phone, and password are required' });
  }
  if (vendorType !== undefined && vendorType !== 'store' && vendorType !== 'restaurant') {
    return res.status(400).json({ error: 'Invalid business type' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!businessRegistrationDoc || !idDocumentDoc || !idDocumentType) {
    return res.status(400).json({ error: 'Business registration document and a government ID are required for vendor applications' });
  }
  if (!VALID_ID_DOCUMENT_TYPES.includes(idDocumentType)) {
    return res.status(400).json({ error: 'Invalid ID document type' });
  }
  if (businessRegistrationDoc.length > MAX_DOCUMENT_BYTES * 1.4 || idDocumentDoc.length > MAX_DOCUMENT_BYTES * 1.4) {
    return res.status(400).json({ error: 'Each document must be under ~2MB — please use a smaller photo or scan.' });
  }
  if (!(await validateOptionalZoneId(deliveryZoneId))) {
    return res.status(400).json({ error: 'Selected delivery zone was not found' });
  }
  try {
    const existing = await db.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const passwordHash = await hashPassword(password);
    const user = await db.createUser({
      id: crypto.randomUUID(),
      businessName,
      email,
      phone,
      passwordHash,
      role: 'vendor',
      approvalStatus: 'pending',
      businessRegistrationDoc,
      idDocumentType,
      idDocumentDoc,
      appliedAt: new Date().toISOString(),
      vendorType: vendorType === 'restaurant' ? 'restaurant' : 'store',
      deliveryZoneId,
    });

    // Real notification attempt — fire-and-forget, never blocks the
    // response. If SMTP isn't configured yet, notify.js quietly no-ops
    // and this line just doesn't do anything; nothing else depends on it.
    notifyNewVendorApplication(businessName, email);
    console.log(`[vendor-application] New vendor application from "${businessName}" (${email}) — review via the Super Admin console under Vendors.`);
    // Live in-app signal too — the email above only reaches an admin
    // who isn't already looking at the app; this reaches one who is,
    // the same "admins" room every other admin-facing request/message
    // notification in this file uses (see the client's
    // socket.on('vendor_application:new', ...)).
    io.to('admins').emit('vendor_application:new', { id: user.id, businessName: user.businessName, role: 'vendor', vendorType: user.vendorType || null });

    const sessionId = await recordLoginHistory(req, user.id);
    const token = signToken(user, sessionId);
    res.json({
      token,
      user: { id: user.id, businessName: user.businessName, email: user.email, phone: user.phone, storeAddress: user.storeAddress, vendorType: user.vendorType, avgPrepTimeMinutes: user.avgPrepTimeMinutes, profileImageUrl: user.profileImageUrl, deliveryZoneId: user.deliveryZoneId, role: user.role, approvalStatus: user.approvalStatus, rejectionReason: user.rejectionReason },
    });
  } catch (err) {
    console.error('register-vendor failed', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Delivery company self-registration — same real approval workflow as
// vendor registration above, mirrored exactly (same document
// requirements, same pending-until-approved status), just scoped to
// role = 'delivery_company'. Also collects an optional company/home-base
// address + delivery zone, same as vendor registration — this role had
// no address concept at all before the Zone Search Picker feature.
app.post('/api/auth/register-delivery-company', authLimiter, async (req, res) => {
  const { businessName, email, password, phone, businessRegistrationDoc, idDocumentType, idDocumentDoc, storeAddress, deliveryZoneId } = req.body || {};
  if (!businessName || !email || !password || !phone) {
    return res.status(400).json({ error: 'Business name, email, phone, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!businessRegistrationDoc || !idDocumentDoc || !idDocumentType) {
    return res.status(400).json({ error: 'Business registration document and a government ID are required for delivery company applications' });
  }
  if (!VALID_ID_DOCUMENT_TYPES.includes(idDocumentType)) {
    return res.status(400).json({ error: 'Invalid ID document type' });
  }
  if (businessRegistrationDoc.length > MAX_DOCUMENT_BYTES * 1.4 || idDocumentDoc.length > MAX_DOCUMENT_BYTES * 1.4) {
    return res.status(400).json({ error: 'Each document must be under ~2MB — please use a smaller photo or scan.' });
  }
  if (!(await validateOptionalZoneId(deliveryZoneId))) {
    return res.status(400).json({ error: 'Selected delivery zone was not found' });
  }
  try {
    const existing = await db.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const passwordHash = await hashPassword(password);
    const user = await db.createUser({
      id: crypto.randomUUID(),
      businessName,
      email,
      phone,
      passwordHash,
      role: 'delivery_company',
      approvalStatus: 'pending',
      businessRegistrationDoc,
      idDocumentType,
      idDocumentDoc,
      appliedAt: new Date().toISOString(),
      storeAddress: storeAddress ? storeAddress.trim() : null,
      deliveryZoneId,
    });

    notifyNewVendorApplication(businessName, email, 'delivery_company');
    console.log(`[delivery-company-application] New delivery company application from "${businessName}" (${email}) — review via the Super Admin console under Delivery Companies.`);
    // Live in-app signal — see the matching comment in
    // /api/auth/register-vendor above.
    io.to('admins').emit('vendor_application:new', { id: user.id, businessName: user.businessName, role: 'delivery_company', vendorType: null });

    const sessionId = await recordLoginHistory(req, user.id);
    const token = signToken(user, sessionId);
    res.json({
      token,
      user: { id: user.id, businessName: user.businessName, email: user.email, phone: user.phone, storeAddress: user.storeAddress, vendorType: user.vendorType, avgPrepTimeMinutes: user.avgPrepTimeMinutes, profileImageUrl: user.profileImageUrl, deliveryZoneId: user.deliveryZoneId, role: user.role, approvalStatus: user.approvalStatus, rejectionReason: user.rejectionReason },
    });
  } catch (err) {
    console.error('register-delivery-company failed', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Shape shared by every route below that completes a real login
// (plain login, 2FA verify, password reset) — kept as one function so
// the fields returned to the frontend can't quietly drift apart
// between the different ways a session can start.
function publicUserShape(user) {
  return { id: user.id, businessName: user.businessName, email: user.email, phone: user.phone, storeAddress: user.storeAddress, vendorType: user.vendorType, avgPrepTimeMinutes: user.avgPrepTimeMinutes, profileImageUrl: user.profileImageUrl, deliveryZoneId: user.deliveryZoneId, role: user.role, approvalStatus: user.approvalStatus, rejectionReason: user.rejectionReason, twoFactorEnabled: user.twoFactorEnabled };
}

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  try {
    const user = await db.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const match = await comparePassword(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.isDisabled) return res.status(403).json({ error: 'This account has been disabled. Contact support for help.' });

    // Two-factor authentication (SMS via Twilio, opt-in, any role) —
    // password alone isn't enough for this account; a fresh code goes
    // out and the frontend must call /api/auth/2fa/verify with it
    // before a real session token is issued. See schema.sql for the
    // "rebuilt from scratch" note on why this exists as its own,
    // deliberately simple table rather than reusing password_resets.
    if (user.twoFactorEnabled && user.phone) {
      const code = crypto.randomInt(100000, 1000000).toString(); // 6 digits
      const codeHash = await hashPassword(code);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      const challengeId = crypto.randomUUID();
      await db.createTwoFactorChallenge({ id: challengeId, userId: user.id, codeHash, expiresAt });
      const sent = await sendMessage(user.phone, `Your ONLib login code is: ${code}\nIt expires in 10 minutes. If you didn't try to log in, ignore this message.`);
      if (!sent) console.warn(`[2fa] Could not deliver login code to ${user.phone} — is Twilio configured? (see server/notify.js)`);
      return res.json({ requiresTwoFactor: true, challengeId });
    }

    const sessionId = await recordLoginHistory(req, user.id);
    const token = signToken(user, sessionId);
    res.json({ token, user: publicUserShape(user) });
  } catch (err) {
    console.error('login failed', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Login, step 2 for a 2FA-enabled account: verify the code an
// /api/auth/login response's challengeId asked for, then complete the
// login exactly like a plain login would have.
app.post('/api/auth/2fa/verify', authLimiter, async (req, res) => {
  const { challengeId, code } = req.body || {};
  if (!challengeId || !code) return res.status(400).json({ error: 'A verification code is required' });
  try {
    const challenge = await db.getTwoFactorChallenge(challengeId);
    if (!challenge || challenge.used || new Date(challenge.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }
    const match = await comparePassword(code, challenge.code_hash);
    if (!match) return res.status(400).json({ error: 'Invalid or expired code' });
    const user = await db.getUserById(challenge.user_id);
    if (!user) return res.status(400).json({ error: 'Invalid or expired code' });
    if (user.isDisabled) return res.status(403).json({ error: 'This account has been disabled. Contact support for help.' });

    await db.markTwoFactorChallengeUsed(challenge.id);
    const sessionId = await recordLoginHistory(req, user.id);
    const token = signToken(user, sessionId);
    res.json({ token, user: publicUserShape(user) });
  } catch (err) {
    console.error('2fa verify failed', err);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

// Lets someone re-request a code if the first one expired or never
// arrived, without having to re-enter their password. Invalidates the
// old challenge so only the newest code is ever valid at once.
app.post('/api/auth/2fa/resend', authLimiter, async (req, res) => {
  const { challengeId } = req.body || {};
  if (!challengeId) return res.status(400).json({ error: 'challengeId is required' });
  try {
    const challenge = await db.getTwoFactorChallenge(challengeId);
    if (!challenge || challenge.used) return res.status(400).json({ error: 'This login attempt has expired — please log in again' });
    const user = await db.getUserById(challenge.user_id);
    if (!user || !user.phone) return res.status(400).json({ error: 'This login attempt has expired — please log in again' });

    await db.markTwoFactorChallengeUsed(challenge.id); // the old code no longer works
    const code = crypto.randomInt(100000, 1000000).toString();
    const codeHash = await hashPassword(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const newChallengeId = crypto.randomUUID();
    await db.createTwoFactorChallenge({ id: newChallengeId, userId: user.id, codeHash, expiresAt });
    const sent = await sendMessage(user.phone, `Your ONLib login code is: ${code}\nIt expires in 10 minutes.`);
    if (!sent) console.warn(`[2fa] Could not resend login code to ${user.phone}`);
    res.json({ ok: true, challengeId: newChallengeId });
  } catch (err) {
    console.error('2fa resend failed', err);
    res.status(500).json({ error: 'Failed to resend code' });
  }
});

// ============================================================
// Two-factor authentication — account settings (any authenticated
// role can opt in, matching the user's explicit choice for this
// round). Enabling requires proving the phone on file can actually
// receive a code (not just trusting whatever number is stored);
// disabling requires the account password, since turning this off is
// the security-reducing direction — same "confirm with password"
// bar as change-email/change-password above.
// ============================================================

app.post('/api/me/2fa/enable-request', requireAuth, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.phone) return res.status(400).json({ error: 'Add a phone number to your account before enabling two-factor authentication' });
    if (user.twoFactorEnabled) return res.status(400).json({ error: 'Two-factor authentication is already enabled' });
    const code = crypto.randomInt(100000, 1000000).toString();
    const codeHash = await hashPassword(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const challengeId = crypto.randomUUID();
    await db.createTwoFactorChallenge({ id: challengeId, userId: user.id, codeHash, expiresAt });
    const sent = await sendMessage(user.phone, `Your ONLib verification code is: ${code}\nIt expires in 10 minutes.`);
    if (!sent) return res.status(502).json({ error: 'Could not send a verification code to your phone. Please try again shortly.' });
    res.json({ ok: true, challengeId });
  } catch (err) {
    console.error('2fa enable-request failed', err);
    res.status(500).json({ error: 'Failed to start two-factor setup' });
  }
});

app.post('/api/me/2fa/enable-confirm', requireAuth, async (req, res) => {
  const { challengeId, code } = req.body || {};
  if (!challengeId || !code) return res.status(400).json({ error: 'A verification code is required' });
  try {
    const challenge = await db.getTwoFactorChallenge(challengeId);
    if (!challenge || challenge.user_id !== req.user.id || challenge.used || new Date(challenge.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }
    const match = await comparePassword(code, challenge.code_hash);
    if (!match) return res.status(400).json({ error: 'Invalid or expired code' });
    await db.markTwoFactorChallengeUsed(challenge.id);
    await db.setTwoFactorEnabled(req.user.id, true);
    res.json({ ok: true });
  } catch (err) {
    console.error('2fa enable-confirm failed', err);
    res.status(500).json({ error: 'Failed to enable two-factor authentication' });
  }
});

app.post('/api/me/2fa/disable', requireAuth, async (req, res) => {
  const { currentPassword } = req.body || {};
  if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
  try {
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const match = await comparePassword(currentPassword, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Incorrect password' });
    await db.setTwoFactorEnabled(req.user.id, false);
    res.json({ ok: true });
  } catch (err) {
    console.error('2fa disable failed', err);
    res.status(500).json({ error: 'Failed to disable two-factor authentication' });
  }
});

// Public, non-secret config the frontend needs — safe to expose since
// a Google Client ID is meant to be embedded in frontend code (unlike
// a client secret, which this flow never uses or stores).
// Public, non-secret config the frontend needs before a person is
// even logged in — Google Client ID, and the real Privacy Policy /
// Terms of Service content, since guests need to be able to read
// these too (e.g. from the App Chooser or before creating an
// account), not just users who are already signed in.
app.get('/api/config', async (req, res) => {
  try {
    const [settings, platformSettings, momoProviders] = await Promise.all([db.getSettings(), db.getPlatformSettings(), db.getEnabledMomoProviders()]);
    res.json({
      googleClientId: GOOGLE_CLIENT_ID || null,
      privacyPolicy: settings.privacyPolicy || null,
      termsOfService: settings.termsOfService || null,
      // Public, unauthenticated on purpose — a guest who hasn't logged
      // in yet should still see the maintenance banner / service area
      // before hitting a wall trying to place an order. Commission
      // rates and the maintenance message's internal-only cousins stay
      // behind requireSuperAdmin (see /api/super-admin/settings/*).
      serviceArea: platformSettings.serviceArea || null,
      defaultDeliveryFee: platformSettings.defaultDeliveryFee,
      maintenanceMode: platformSettings.maintenanceMode,
      maintenanceMessage: platformSettings.maintenanceMessage || null,
      // Flat platform service fee, shown at checkout before payment —
      // same "guest should see it before hitting a wall" reasoning as
      // the fields above.
      serviceFee: platformSettings.serviceFee,
      // Real, Super-Admin-managed Mobile Money providers (see
      // momo_providers in schema.sql) — each with its own receiving
      // phone number, not one shared number stretched across every
      // provider regardless of network. Only enabled ones ship here;
      // the checkout radio list is built from exactly this array.
      momoProviders: momoProviders.map(p => ({ id: p.id, label: p.label, phone: p.phone })),
    });
  } catch (err) {
    console.error('GET /api/config failed', err);
    res.json({ googleClientId: GOOGLE_CLIENT_ID || null, privacyPolicy: null, termsOfService: null, serviceArea: null, defaultDeliveryFee: null, maintenanceMode: false, maintenanceMessage: null, serviceFee: 0.10, momoProviders: [] });
  }
});

// Sign in with Google — verifies the ID token Google's own frontend
// library hands back, server-side, using Google's public keys (no
// client secret involved). Finds an existing account by email, or
// creates a new customer account if this is a first-time sign-in.
app.post('/api/auth/google', authLimiter, async (req, res) => {
  if (!googleClient) {
    return res.status(501).json({ error: 'Google Sign-In is not configured on this server yet.' });
  }
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'Missing Google credential' });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email_verified) {
      return res.status(401).json({ error: "This Google account's email isn't verified" });
    }

    let user = await db.getUserByEmail(payload.email);
    if (user && user.isDisabled) {
      return res.status(403).json({ error: 'This account has been disabled. Contact support for help.' });
    }
    if (!user) {
      // First time signing in with this email — create a real customer
      // account. No phone number (Google doesn't provide one) — same
      // nullable-phone state existing senders can already be in; they
      // can add one later via Settings. Password is a random, never-
      // shown value (this account simply signs in via Google going
      // forward, unless they later use "Forgot password" to set a real one).
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await hashPassword(randomPassword);
      user = await db.createUser({
        id: crypto.randomUUID(),
        businessName: payload.name || payload.email.split('@')[0],
        email: payload.email,
        phone: null,
        passwordHash,
        role: 'sender',
      });
    }

    const sessionId = await recordLoginHistory(req, user.id);
    const token = signToken(user, sessionId);
    res.json({ token, user: { id: user.id, businessName: user.businessName, email: user.email, phone: user.phone, storeAddress: user.storeAddress, vendorType: user.vendorType, avgPrepTimeMinutes: user.avgPrepTimeMinutes, profileImageUrl: user.profileImageUrl, role: user.role, approvalStatus: user.approvalStatus, rejectionReason: user.rejectionReason } });
  } catch (err) {
    console.error('Google sign-in failed', err);
    res.status(401).json({ error: 'Google sign-in failed — the token could not be verified' });
  }
});

// Forgot password, step 1: request a code. Always responds with the same
// generic message regardless of whether the email exists — this
// prevents an attacker from using this endpoint to discover which
// emails are registered. The code itself only actually gets sent if a
// matching account exists and the requested channel is deliverable.
//
// `channel` ('email' | 'phone', default 'email') lets the person
// requesting the reset choose where the code goes, instead of the
// code always going out on both channels regardless of preference.
// Choosing 'phone' when the account has no phone on file (e.g. a
// Google Sign-In account) silently delivers nothing — same
// intentional non-disclosure as the rest of this endpoint, so trying
// 'phone' can't be used to probe whether an account has a phone
// number on file.
const GENERIC_FORGOT_PASSWORD_RESPONSE = {
  ok: true,
  message: 'If an account exists for that email, a reset code has been sent using the method you selected.',
};

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  const { email, channel } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const resetChannel = channel === 'phone' ? 'phone' : 'email'; // default to email for any unrecognized/missing value
  try {
    const user = await db.getUserByEmail(email);
    if (user) {
      const code = crypto.randomInt(100000, 1000000).toString(); // 6 digits
      const codeHash = await hashPassword(code);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      await db.createPasswordReset({ id: crypto.randomUUID(), userId: user.id, codeHash, expiresAt });

      const messageBody = `Your ONLib password reset code is: ${code}\nIt expires in 10 minutes. If you didn't request this, ignore this message.`;

      // Only the selected channel is attempted now — previously both
      // were always attempted regardless of what the user wanted.
      let sent = false;
      if (resetChannel === 'phone') {
        if (user.phone) {
          sent = await sendMessage(user.phone, messageBody);
          if (!sent) console.warn(`[forgot-password] Could not deliver reset code by SMS/WhatsApp to ${user.phone} — is Twilio configured? (see server/notify.js)`);
        } else {
          console.warn(`[forgot-password] ${email} chose the phone channel but has no phone on file — nothing sent`);
        }
      } else {
        sent = await sendEmail(email, 'Your ONLib password reset code', messageBody);
        if (!sent) console.warn(`[forgot-password] Could not deliver reset code by email to ${email} — is SMTP configured? (see server/notify.js)`);
      }
      if (!sent) {
        console.warn(`[forgot-password] No reset code delivered to ${email} via the ${resetChannel} channel.`);
      }
    }
    // Same response either way — see comment above.
    res.json(GENERIC_FORGOT_PASSWORD_RESPONSE);
  } catch (err) {
    console.error('forgot-password failed', err);
    // Still don't leak anything specific on error.
    res.json(GENERIC_FORGOT_PASSWORD_RESPONSE);
  }
});

// Forgot password, step 2: verify the code and set a new password.
app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, code, and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const user = await db.getUserByEmail(email);
    if (!user) return res.status(400).json({ error: 'Invalid or expired code' });

    const reset = await db.getActivePasswordReset(user.id);
    if (!reset) return res.status(400).json({ error: 'Invalid or expired code' });

    const match = await comparePassword(code, reset.code_hash);
    if (!match) return res.status(400).json({ error: 'Invalid or expired code' });

    const passwordHash = await hashPassword(newPassword);
    await db.updateUserPassword(user.id, passwordHash);
    await db.markPasswordResetUsed(reset.id);

    // Log the user in immediately as a convenience — they just proved
    // phone ownership via the code, which is a stronger check than a
    // typed password alone.
    const freshUser = await db.getUserById(user.id);
    const sessionId = await recordLoginHistory(req, freshUser.id);
    const token = signToken(freshUser, sessionId);
    res.json({ ok: true, token, user: { id: freshUser.id, businessName: freshUser.businessName, email: freshUser.email, role: freshUser.role } });
  } catch (err) {
    console.error('reset-password failed', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Admin login: a single shared password (matches the original app's UX),
// checked against the seeded admin account server-side. Returns a real JWT
// so the rest of the app (REST + sockets) treats admins exactly like any
// other authenticated role.
app.post('/api/auth/admin-login', authLimiter, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password is required' });
  try {
    const admin = await db.getUserByEmail(ADMIN_EMAIL);
    if (!admin) return res.status(500).json({ error: 'Admin account is not set up yet' });
    const match = await comparePassword(password, admin.passwordHash);
    if (!match) return res.status(401).json({ error: 'Incorrect password' });

    const sessionId = await recordLoginHistory(req, admin.id);
    const token = signToken(admin, sessionId);
    res.json({ token, user: { id: admin.id, businessName: admin.businessName, email: admin.email, role: admin.role } });
  } catch (err) {
    console.error('admin-login failed', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });
  res.json({ user: { id: user.id, businessName: user.businessName, email: user.email, phone: user.phone, storeAddress: user.storeAddress, vendorType: user.vendorType, avgPrepTimeMinutes: user.avgPrepTimeMinutes, profileImageUrl: user.profileImageUrl, deliveryZoneId: user.deliveryZoneId, role: user.role, approvalStatus: user.approvalStatus, rejectionReason: user.rejectionReason } });
});

// Self-service profile edit — any authenticated user updating their own
// name/phone (customer, vendor, admin, or super admin). Email and
// password stay on their existing separate flows. storeAddress stays
// vendor/delivery_company only (see schema.sql's comments on that
// column — customers have no single store/company address, they have a
// whole saved-addresses book instead). deliveryZoneId ("Home Base") is
// now self-service for vendor, delivery_company, AND sender (customer)
// — a customer's own preferred zone, separate from the per-address zone
// on each entry in their saved-addresses book — alongside the Super
// Admin's separate, still-unchanged vendor assignment route.
app.put('/api/me/profile', requireAuth, async (req, res) => {
  const { businessName, phone, storeAddress, avgPrepTimeMinutes, deliveryZoneId } = req.body || {};
  const canSelfSetStoreAddress = req.user.role === 'vendor' || req.user.role === 'delivery_company';
  const canSelfSetZone = canSelfSetStoreAddress || req.user.role === 'sender';
  if (!businessName || !businessName.trim()) {
    return res.status(400).json({ error: 'Name cannot be empty' });
  }
  if (avgPrepTimeMinutes !== undefined && avgPrepTimeMinutes !== null) {
    const n = Number(avgPrepTimeMinutes);
    if (!Number.isFinite(n) || n < 0 || n > 500) {
      return res.status(400).json({ error: 'Prep time must be a realistic number of minutes' });
    }
  }
  if (canSelfSetZone && !(await validateOptionalZoneId(deliveryZoneId))) {
    return res.status(400).json({ error: 'Selected delivery zone was not found' });
  }
  try {
    const existing = await db.getUserById(req.user.id);
    const updated = await db.updateUserProfile(req.user.id, {
      businessName: businessName.trim(),
      phone: phone ? phone.trim() : null,
      storeAddress: canSelfSetStoreAddress && storeAddress !== undefined ? (storeAddress.trim() || null) : undefined,
      avgPrepTimeMinutes: req.user.role === 'vendor' && existing && existing.vendorType === 'restaurant' && avgPrepTimeMinutes !== undefined
        ? (avgPrepTimeMinutes === null || avgPrepTimeMinutes === '' ? null : Number(avgPrepTimeMinutes))
        : undefined,
    });
    if (canSelfSetZone && deliveryZoneId !== undefined) {
      await db.setSelfDeliveryZone(req.user.id, deliveryZoneId || null);
    }
    const final = canSelfSetZone && deliveryZoneId !== undefined ? await db.getUserById(req.user.id) : updated;
    res.json({ user: { id: final.id, businessName: final.businessName, email: final.email, phone: final.phone, storeAddress: final.storeAddress, vendorType: final.vendorType, avgPrepTimeMinutes: final.avgPrepTimeMinutes, deliveryZoneId: final.deliveryZoneId, role: final.role } });
  } catch (err) {
    console.error('PUT /api/me/profile failed', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Role-scoped bootstrap load: senders get only their own orders; admins get
// everything. Every update after this arrives over the socket in realtime.
app.get('/api/state', requireAuth, async (req, res) => {
  try {
    const settings = await db.getSettings();
    if (isAdminLike(req.user.role)) {
      const [orders, expenses, agents, pricePresets, currentUser] = await Promise.all([
        db.getAllOrders(), db.getAllExpenses(), db.getAllAgents(), db.getAllPricePresets(), db.getUserById(req.user.id),
      ]);
      res.json({ orders, expenses, agents, settings, pricePresets, disabledFeatures: currentUser ? currentUser.disabledFeatures : [] });
    } else {
      const orders = await db.getOrdersBySender(req.user.id);
      res.json({ orders, expenses: [], agents: [], settings, pricePresets: [] });
    }
  } catch (err) {
    console.error('GET /api/state failed', err);
    res.status(500).json({ error: 'Failed to load state' });
  }
});

// ============================================================
// Admin Settings page — Business Profile, Security, Backup & Restore.
// Every route below requires both requireAuth AND requireAdmin: senders
// can't reach any of this even with a valid token.
// ============================================================

const MAX_LOGO_BYTES = 700 * 1024; // ~700KB — logo lives as a data URL in
// Postgres (see schema.sql), so this keeps row size sane. A data URL is
// ~33% larger than the raw file, so this allows roughly a 500KB image.

const MAX_PROFILE_IMAGE_BYTES = 700 * 1024; // same reasoning as the logo above

// Real profile photo upload — any authenticated role, always the
// caller's own account (never takes a target user id in the URL).
app.put('/api/me/profile-image', requireAuth, async (req, res) => {
  const { imageDataUrl } = req.body || {};
  if (imageDataUrl && imageDataUrl.length > MAX_PROFILE_IMAGE_BYTES) {
    return res.status(400).json({ error: 'Image is too large — please use one under ~500KB.' });
  }
  try {
    const updated = await db.updateProfileImage(req.user.id, imageDataUrl || null);
    res.json({
      user: {
        id: updated.id, businessName: updated.businessName, email: updated.email, phone: updated.phone,
        storeAddress: updated.storeAddress, vendorType: updated.vendorType, profileImageUrl: updated.profileImageUrl,
        role: updated.role, approvalStatus: updated.approvalStatus,
      },
    });
  } catch (err) {
    console.error('PUT /api/me/profile-image failed', err);
    res.status(500).json({ error: 'Failed to update profile image' });
  }
});

app.put('/api/admin/settings', requireAuth, requireAdmin, requireFeature('business_settings'), async (req, res) => {
  const fields = req.body || {};
  if (fields.logoDataUrl && fields.logoDataUrl.length > MAX_LOGO_BYTES) {
    return res.status(400).json({ error: 'Logo image is too large — please use an image under ~500KB.' });
  }
  if (fields.openDays && !Array.isArray(fields.openDays)) {
    return res.status(400).json({ error: 'openDays must be a list of day names' });
  }
  // Help & Support FAQ lists — validated the same shape/cap reasoning
  // as the vendor product colors/sizes lists elsewhere in this app:
  // never trust the client, cap array length and per-field size so one
  // bad request can't bloat the settings row.
  for (const key of ['adminFaqs', 'customerFaqs']) {
    if (fields[key] === undefined) continue;
    if (fields[key] !== null) {
      if (!Array.isArray(fields[key])) {
        return res.status(400).json({ error: `${key} must be a list of {q, a} questions` });
      }
      if (fields[key].length > 50) {
        return res.status(400).json({ error: `${key} can have at most 50 questions` });
      }
      for (const item of fields[key]) {
        if (!item || typeof item.q !== 'string' || typeof item.a !== 'string') {
          return res.status(400).json({ error: `${key} entries must each have a question and an answer` });
        }
        if (item.q.length > 300 || item.a.length > 3000) {
          return res.status(400).json({ error: `${key} question/answer text is too long` });
        }
      }
    }
  }
  try {
    const settings = await db.upsertSettings(fields);
    io.to('admins').emit('settings:updated', settings); // live-sync to any other open admin sessions
    res.json({ ok: true, settings });
  } catch (err) {
    console.error('PUT /api/admin/settings failed', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// ============================================================
// Mobile Money providers (Super Admin) — full CRUD for the list that
// powers the checkout provider radio options (see /api/config's
// momoProviders and POST /api/marketplace/checkout/momo-manual above).
// requireSuperAdmin, not requireAdmin — this controls where real
// customer payments get sent, same trust level as Payouts/Commission.
// ============================================================
app.get('/api/super-admin/momo-providers', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const providers = await db.getAllMomoProviders();
    res.json({ providers });
  } catch (err) {
    console.error('GET /api/super-admin/momo-providers failed', err);
    res.status(500).json({ error: 'Failed to load Mobile Money providers' });
  }
});

app.post('/api/super-admin/momo-providers', requireAuth, requireSuperAdmin, async (req, res) => {
  const { label, phone } = req.body || {};
  if (!label || !label.trim()) return res.status(400).json({ error: 'A provider name is required' });
  // Phone isn't required at creation — a brand-new provider is created
  // disabled (see db.createMomoProvider) regardless of what's sent
  // here, so an admin can add the row first and fill in the real
  // number before turning it on, rather than being blocked from
  // creating the row at all until they have the number handy.
  try {
    const providers = await db.getAllMomoProviders();
    // Deterministic, human-diffable id from the label (e.g. "M-Pesa" ->
    // "m_pesa") rather than a random UUID, matching orange_money/
    // lonestar_mtn's existing style — this id is what gets stored on
    // every purchase.payment_provider going forward, so it's worth it
    // being readable in the database, not just in the UI.
    let baseId = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'provider';
    let id = baseId;
    let suffix = 2;
    while (providers.some(p => p.id === id)) { id = `${baseId}_${suffix}`; suffix += 1; }
    const provider = await db.createMomoProvider({ id, label: label.trim(), phone: phone ? phone.trim() : '', sortOrder: providers.length });
    await logAudit(req, 'momo_provider.create', { targetType: 'momo_provider', targetId: provider.id, targetLabel: provider.label });
    res.json({ ok: true, provider });
  } catch (err) {
    console.error('POST /api/super-admin/momo-providers failed', err);
    res.status(500).json({ error: 'Failed to add Mobile Money provider' });
  }
});

app.put('/api/super-admin/momo-providers/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const { label, phone, isEnabled, sortOrder } = req.body || {};
  if (label !== undefined && !label.trim()) return res.status(400).json({ error: 'A provider name is required' });
  if (phone !== undefined && !phone.trim()) return res.status(400).json({ error: 'A receiving phone number is required' });
  try {
    const provider = await db.updateMomoProvider(req.params.id, {
      label: label !== undefined ? label.trim() : undefined,
      phone: phone !== undefined ? phone.trim() : undefined,
      isEnabled,
      sortOrder,
    });
    if (!provider) return res.status(404).json({ error: 'Provider not found' });
    await logAudit(req, 'momo_provider.update', { targetType: 'momo_provider', targetId: provider.id, targetLabel: provider.label });
    res.json({ ok: true, provider });
  } catch (err) {
    console.error('PUT /api/super-admin/momo-providers/:id failed', err);
    res.status(500).json({ error: 'Failed to update Mobile Money provider' });
  }
});

app.delete('/api/super-admin/momo-providers/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    // Purchases already made through this provider keep their real
    // payment_provider id regardless (see getMomoProviderLabel's
    // client-side fallback for a deleted provider's label) — deleting
    // it here only removes it from future checkout options.
    await db.deleteMomoProvider(req.params.id);
    await logAudit(req, 'momo_provider.delete', { targetType: 'momo_provider', targetId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/super-admin/momo-providers/:id failed', err);
    res.status(500).json({ error: 'Failed to delete Mobile Money provider' });
  }
});

// ============================================================
// Delivery Zones (Super Admin) — full CRUD, same shape as Mobile Money
// providers above. See schema.sql's comment on delivery_zones for why
// this is a real, admin-defined substitute for geolocation rather than
// GPS-based zone detection this app has no service for.
// ============================================================
app.get('/api/super-admin/delivery-zones', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const zones = await db.getAllDeliveryZones();
    res.json({ zones });
  } catch (err) {
    console.error('GET /api/super-admin/delivery-zones failed', err);
    res.status(500).json({ error: 'Failed to load delivery zones' });
  }
});

app.post('/api/super-admin/delivery-zones', requireAuth, requireSuperAdmin, async (req, res) => {
  const { name, fee, code, regionId } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'A zone name is required' });
  const feeNum = Number(fee);
  if (!Number.isFinite(feeNum) || feeNum < 0) return res.status(400).json({ error: 'A valid delivery fee is required' });
  const trimmedCode = code && code.trim() ? code.trim() : null;
  try {
    const zones = await db.getAllDeliveryZones();
    if (trimmedCode && zones.some(z => z.code === trimmedCode)) {
      return res.status(400).json({ error: `Zone code "${trimmedCode}" is already used` });
    }
    if (regionId) {
      const region = await db.getDeliveryRegionById(regionId);
      if (!region) return res.status(400).json({ error: 'Region not found' });
    }
    let baseId = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'zone';
    let id = baseId;
    let suffix = 2;
    while (zones.some(z => z.id === id)) { id = `${baseId}_${suffix}`; suffix += 1; }
    const zone = await db.createDeliveryZone({ id, name: name.trim(), code: trimmedCode, regionId: regionId || null, fee: feeNum, sortOrder: zones.length });
    await logAudit(req, 'delivery_zone.create', { targetType: 'delivery_zone', targetId: zone.id, targetLabel: zone.name });
    res.json({ ok: true, zone });
  } catch (err) {
    console.error('POST /api/super-admin/delivery-zones failed', err);
    res.status(500).json({ error: 'Failed to add delivery zone' });
  }
});

app.put('/api/super-admin/delivery-zones/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const { name, fee, sortOrder, code, regionId } = req.body || {};
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'A zone name is required' });
  if (fee !== undefined && (!Number.isFinite(Number(fee)) || Number(fee) < 0)) {
    return res.status(400).json({ error: 'A valid delivery fee is required' });
  }
  const trimmedCode = code !== undefined ? (code && code.trim() ? code.trim() : null) : undefined;
  try {
    if (trimmedCode) {
      const existing = await db.getDeliveryZoneByCode(trimmedCode);
      if (existing && existing.id !== req.params.id) {
        return res.status(400).json({ error: `Zone code "${trimmedCode}" is already used` });
      }
    }
    if (regionId) {
      const region = await db.getDeliveryRegionById(regionId);
      if (!region) return res.status(400).json({ error: 'Region not found' });
    }
    const zone = await db.updateDeliveryZone(req.params.id, {
      name: name !== undefined ? name.trim() : undefined,
      code: trimmedCode,
      regionId: regionId !== undefined ? (regionId || null) : undefined,
      fee: fee !== undefined ? Number(fee) : undefined,
      sortOrder,
    });
    if (!zone) return res.status(404).json({ error: 'Zone not found' });
    await logAudit(req, 'delivery_zone.update', { targetType: 'delivery_zone', targetId: zone.id, targetLabel: zone.name });
    res.json({ ok: true, zone });
  } catch (err) {
    console.error('PUT /api/super-admin/delivery-zones/:id failed', err);
    res.status(500).json({ error: 'Failed to update delivery zone' });
  }
});

app.delete('/api/super-admin/delivery-zones/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    // Vendors assigned to this zone fall back to "no zone" via the FK's
    // ON DELETE SET NULL (see schema.sql) — never left pointing at a
    // deleted zone.
    await db.deleteDeliveryZone(req.params.id);
    await logAudit(req, 'delivery_zone.delete', { targetType: 'delivery_zone', targetId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/super-admin/delivery-zones/:id failed', err);
    res.status(500).json({ error: 'Failed to delete delivery zone' });
  }
});

// Assigns a vendor to a zone (or clears it with zoneId: null) — a
// separate small endpoint rather than folding into vendor account
// editing, since this is set from the Vendors table row, not a form.
app.put('/api/super-admin/vendors/:id/delivery-zone', requireAuth, requireSuperAdmin, async (req, res) => {
  const { zoneId } = req.body || {};
  // Clearing (zoneId: null/omitted) is intentionally still allowed here —
  // unlike vendor creation, which requires a zone up front (see POST
  // /api/super-admin/vendors above), this route also has to support
  // un-assigning a vendor mid-reassignment. But a non-empty zoneId must
  // still be real, same "if given, it must exist" check every other
  // zone-accepting route already applies (validateOptionalZoneId) —
  // this route was the one place that skipped it and just let a bad ID
  // fall through to the database's foreign key as an opaque 500.
  if (!(await validateOptionalZoneId(zoneId))) {
    return res.status(400).json({ error: 'Selected delivery zone was not found' });
  }
  try {
    const ok = await db.setVendorDeliveryZone(req.params.id, zoneId || null);
    if (!ok) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/super-admin/vendors/:id/delivery-zone failed', err);
    res.status(500).json({ error: 'Failed to set delivery zone' });
  }
});

// Public — every enabled zone (+ its regions), so checkout can show a
// real per-vendor fee and label before the customer is even logged in.
// `regions` is included alongside the existing flat `zones` array so
// this stays backward compatible with any code that only reads `zones`.
app.get('/api/delivery-zones', async (req, res) => {
  try {
    const [zones, regions] = await Promise.all([db.getAllDeliveryZones(), db.getAllDeliveryRegions()]);
    res.json({ zones, regions });
  } catch (err) {
    console.error('GET /api/delivery-zones failed', err);
    res.status(500).json({ error: 'Failed to load delivery zones' });
  }
});

// ============================================================
// Delivery Regions (Super Admin) — a purely organizational grouping
// above zones (see schema.sql's comment on delivery_regions). Same
// CRUD shape as delivery zones above.
// ============================================================
app.get('/api/super-admin/delivery-regions', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const regions = await db.getAllDeliveryRegions();
    res.json({ regions });
  } catch (err) {
    console.error('GET /api/super-admin/delivery-regions failed', err);
    res.status(500).json({ error: 'Failed to load delivery regions' });
  }
});

app.post('/api/super-admin/delivery-regions', requireAuth, requireSuperAdmin, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'A region name is required' });
  try {
    const regions = await db.getAllDeliveryRegions();
    let baseId = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'region';
    let id = baseId;
    let suffix = 2;
    while (regions.some(r => r.id === id)) { id = `${baseId}_${suffix}`; suffix += 1; }
    const region = await db.createDeliveryRegion({ id, name: name.trim(), sortOrder: regions.length });
    await logAudit(req, 'delivery_region.create', { targetType: 'delivery_region', targetId: region.id, targetLabel: region.name });
    res.json({ ok: true, region });
  } catch (err) {
    console.error('POST /api/super-admin/delivery-regions failed', err);
    res.status(500).json({ error: 'Failed to add delivery region' });
  }
});

app.put('/api/super-admin/delivery-regions/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const { name, sortOrder } = req.body || {};
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'A region name is required' });
  try {
    const region = await db.updateDeliveryRegion(req.params.id, {
      name: name !== undefined ? name.trim() : undefined,
      sortOrder,
    });
    if (!region) return res.status(404).json({ error: 'Region not found' });
    await logAudit(req, 'delivery_region.update', { targetType: 'delivery_region', targetId: region.id, targetLabel: region.name });
    res.json({ ok: true, region });
  } catch (err) {
    console.error('PUT /api/super-admin/delivery-regions/:id failed', err);
    res.status(500).json({ error: 'Failed to update delivery region' });
  }
});

app.delete('/api/super-admin/delivery-regions/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    // Zones in this region fall back to "Unassigned" via the FK's ON
    // DELETE SET NULL (see schema.sql) — never deleted along with it.
    await db.deleteDeliveryRegion(req.params.id);
    await logAudit(req, 'delivery_region.delete', { targetType: 'delivery_region', targetId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/super-admin/delivery-regions/:id failed', err);
    res.status(500).json({ error: 'Failed to delete delivery region' });
  }
});

// ============================================================
// Zone-pair delivery fees (Super Admin) — see schema.sql's comment on
// zone_pair_fees. The delivery fee charged to a customer is priced per
// (vendor zone, customer zone) pair instead of the vendor's flat zone
// fee alone; multi-vendor carts still get one fee per vendor group,
// summed, exactly as before this feature.
// ============================================================
app.get('/api/super-admin/zone-pair-fees', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const pairs = await db.getAllZonePairFees();
    res.json({ pairs });
  } catch (err) {
    console.error('GET /api/super-admin/zone-pair-fees failed', err);
    res.status(500).json({ error: 'Failed to load zone-pair delivery fees' });
  }
});

app.post('/api/super-admin/zone-pair-fees', requireAuth, requireSuperAdmin, async (req, res) => {
  const { vendorZoneId, customerZoneId, fee } = req.body || {};
  if (!vendorZoneId || !customerZoneId) {
    return res.status(400).json({ error: 'A vendor zone and a customer zone are both required' });
  }
  const feeNum = Number(fee);
  if (!Number.isFinite(feeNum) || feeNum < 0) return res.status(400).json({ error: 'A valid delivery fee is required' });
  try {
    const [vendorZone, customerZone] = await Promise.all([
      db.getDeliveryZoneById(vendorZoneId),
      db.getDeliveryZoneById(customerZoneId),
    ]);
    if (!vendorZone) return res.status(400).json({ error: 'Vendor zone not found' });
    if (!customerZone) return res.status(400).json({ error: 'Customer zone not found' });
    const pair = await db.setZonePairFee({ id: crypto.randomUUID(), vendorZoneId, customerZoneId, fee: feeNum });
    await logAudit(req, 'zone_pair_fee.set', {
      targetType: 'zone_pair_fee', targetId: pair.id,
      targetLabel: `${vendorZone.name} → ${customerZone.name}`,
    });
    res.json({ ok: true, pair });
  } catch (err) {
    console.error('POST /api/super-admin/zone-pair-fees failed', err);
    res.status(500).json({ error: 'Failed to save zone-pair delivery fee' });
  }
});

app.delete('/api/super-admin/zone-pair-fees/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await db.deleteZonePairFee(req.params.id);
    await logAudit(req, 'zone_pair_fee.delete', { targetType: 'zone_pair_fee', targetId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/super-admin/zone-pair-fees/:id failed', err);
    res.status(500).json({ error: 'Failed to delete zone-pair delivery fee' });
  }
});

// Public — every admin-set zone pair, so checkout can show the real
// per-vendor fee (based on the customer's chosen dropoff zone) before
// the order is placed, same reasoning as the public /api/delivery-zones
// route above.
app.get('/api/delivery-zone-pair-fees', async (req, res) => {
  try {
    const pairs = await db.getAllZonePairFees();
    res.json({ pairs });
  } catch (err) {
    console.error('GET /api/delivery-zone-pair-fees failed', err);
    res.status(500).json({ error: 'Failed to load zone-pair delivery fees' });
  }
});

// Bulk import — lets the Super Admin paste a whole zone-pair fee chart
// (e.g. built in a spreadsheet) instead of setting each pair one at a
// time in the panel. Expected shape — a header row of customer zone
// codes, then one row per vendor zone code followed by that row's fees,
// tab- or comma-separated (a straight paste from Excel/Google Sheets is
// tab-separated):
//   <blank>  Z01    Z02    Z03
//   Z01      2.00   12.50  8.00
//   Z02      15.00  3.00   10.00
// A blank cell means "skip this pair" (leave whatever's already set, or
// leave it unset) rather than being treated as a $0 fee — only a cell
// that actually has a number in it gets imported. Re-importing later
// updates existing pairs (matched by the same vendor/customer zone
// code pair) in place rather than duplicating them — see
// db.importZonePairFees. Zone codes are matched against
// delivery_zones.code, same stable-key convention as the Delivery
// Zones bulk importer above.
function parseZonePairFeesImportText(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim() !== '');
  const errors = [];
  if (lines.length < 2) {
    errors.push('Paste a header row of customer zone codes, then at least one row for a vendor zone.');
    return { pairs: [], errors };
  }
  const splitLine = (line) => (line.includes('\t') ? line.split('\t') : line.split(','));
  const header = splitLine(lines[0]).map((c) => c.trim());
  const customerCodes = header.slice(1);
  if (customerCodes.length === 0) {
    errors.push('The header row (line 1) must list customer zone codes after the first, blank column.');
    return { pairs: [], errors };
  }
  const pairs = [];
  const seenPairs = new Set();
  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const cells = splitLine(lines[i]).map((c) => c.trim());
    const vendorCode = cells[0];
    if (!vendorCode) {
      errors.push(`Line ${lineNo}: missing vendor zone code in the first column.`);
      continue;
    }
    for (let col = 0; col < customerCodes.length; col += 1) {
      const raw = cells[col + 1];
      if (raw === undefined || raw === '') continue; // blank cell — skip this pair, not a $0 fee
      const customerCode = customerCodes[col];
      const fee = Number(String(raw).replace(/[$,]/g, ''));
      if (!Number.isFinite(fee) || fee < 0) {
        errors.push(`Line ${lineNo}, column "${customerCode}": invalid fee "${raw}".`);
        continue;
      }
      const key = `${vendorCode} ${customerCode}`;
      if (seenPairs.has(key)) {
        errors.push(`Line ${lineNo}: duplicate pair "${vendorCode} → ${customerCode}" in this import.`);
        continue;
      }
      seenPairs.add(key);
      pairs.push({ vendorCode, customerCode, fee });
    }
  }
  return { pairs, errors };
}

app.post('/api/super-admin/zone-pair-fees/import', requireAuth, requireSuperAdmin, async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Paste the zone-pair fee chart to import.' });
  const { pairs, errors } = parseZonePairFeesImportText(text);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Could not parse the pasted chart.', details: errors });
  }
  if (pairs.length === 0) {
    return res.status(400).json({ error: 'No fees found in the pasted chart.' });
  }
  try {
    // Resolve every code to a real zone id before touching the database
    // at all — same "validate the whole batch first, apply nothing if
    // anything's wrong" posture as the Delivery Zones importer below,
    // so a typo'd code can never leave a half-applied import behind.
    const zones = await db.getAllDeliveryZones();
    const zoneIdByCode = new Map(zones.filter((z) => z.code).map((z) => [z.code, z.id]));
    const resolved = [];
    const codeErrors = new Set();
    pairs.forEach((p) => {
      const vendorZoneId = zoneIdByCode.get(p.vendorCode);
      const customerZoneId = zoneIdByCode.get(p.customerCode);
      if (!vendorZoneId) codeErrors.add(`Unknown vendor zone code "${p.vendorCode}" — check the Delivery Zones panel above for the real code.`);
      if (!customerZoneId) codeErrors.add(`Unknown customer zone code "${p.customerCode}" — check the Delivery Zones panel above for the real code.`);
      if (vendorZoneId && customerZoneId) resolved.push({ vendorZoneId, customerZoneId, fee: p.fee });
    });
    if (codeErrors.size > 0) {
      return res.status(400).json({ error: 'Could not match every zone code to an existing zone.', details: [...codeErrors] });
    }
    const summary = await db.importZonePairFees(resolved);
    await logAudit(req, 'zone_pair_fee.import', {
      targetType: 'zone_pair_fee',
      targetLabel: `${summary.created + summary.updated} pair(s)`,
    });
    const pairsList = await db.getAllZonePairFees();
    res.json({ ok: true, summary, pairs: pairsList });
  } catch (err) {
    console.error('POST /api/super-admin/zone-pair-fees/import failed', err);
    res.status(500).json({ error: 'Import failed' });
  }
});

// Bulk import — lets the Super Admin paste a whole Region/Zone list
// (e.g. copied from a planning doc) instead of adding each zone one at
// a time. Expected format, one region header followed by its zones:
//   REGION 1 — CENTRAL MONROVIA
//   Z01 — Central Monrovia — $2.00
//   Z03 — Vai Town, Clara Town — $2.50
// Re-importing the same list later updates existing regions (matched
// by name) and zones (matched by code) in place rather than
// duplicating them — see db.importDeliveryZones.
function parseDeliveryZonesImportText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const regions = [];
  const errors = [];
  const seenCodes = new Set();
  let currentRegion = null;
  const REGION_RE = /^REGION\b/i;
  const ZONE_RE = /^(\S+)\s+[—–-]\s+(.+?)\s+[—–-]\s+\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$/;

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return;
    const lineNo = idx + 1;
    if (REGION_RE.test(line)) {
      currentRegion = { name: line, zones: [] };
      regions.push(currentRegion);
      return;
    }
    const m = line.match(ZONE_RE);
    if (m) {
      if (!currentRegion) {
        errors.push(`Line ${lineNo}: zone "${line}" appears before any REGION header.`);
        return;
      }
      const code = m[1].trim();
      const name = m[2].trim();
      const fee = Number(m[3].replace(/,/g, ''));
      if (!Number.isFinite(fee) || fee < 0) {
        errors.push(`Line ${lineNo}: invalid fee in "${line}".`);
        return;
      }
      if (seenCodes.has(code)) {
        errors.push(`Line ${lineNo}: duplicate zone code "${code}" in this import.`);
        return;
      }
      seenCodes.add(code);
      currentRegion.zones.push({ code, name, fee });
      return;
    }
    errors.push(`Line ${lineNo}: could not parse "${line}". Expected "REGION ..." or "CODE — Name — $Fee".`);
  });

  regions.filter(r => r.zones.length === 0).forEach(r => errors.push(`Region "${r.name}" has no zones listed under it.`));

  return { regions: regions.filter(r => r.zones.length > 0), errors };
}

app.post('/api/super-admin/delivery-zones/import', requireAuth, requireSuperAdmin, async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Paste the regions and zones to import.' });
  const { regions, errors } = parseDeliveryZonesImportText(text);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Could not parse the pasted list.', details: errors });
  }
  if (regions.length === 0) {
    return res.status(400).json({ error: 'No regions found in the pasted list.' });
  }
  try {
    const summary = await db.importDeliveryZones(regions);
    await logAudit(req, 'delivery_zone.import', {
      targetType: 'delivery_zone',
      targetLabel: `${summary.regionsCreated + summary.regionsUpdated} region(s), ${summary.zonesCreated + summary.zonesUpdated} zone(s)`,
    });
    const [zones, allRegions] = await Promise.all([db.getAllDeliveryZones(), db.getAllDeliveryRegions()]);
    res.json({ ok: true, summary, zones, regions: allRegions });
  } catch (err) {
    console.error('POST /api/super-admin/delivery-zones/import failed', err);
    res.status(500).json({ error: 'Import failed' });
  }
});

app.post('/api/admin/change-email', requireAuth, requireAdmin, authLimiter, async (req, res) => {
  const { newEmail, currentPassword } = req.body || {};
  if (!newEmail || !currentPassword) {
    return res.status(400).json({ error: 'New email and current password are required' });
  }
  try {
    const admin = await db.getUserById(req.user.id);
    const match = await comparePassword(currentPassword, admin.passwordHash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const existing = await db.getUserByEmail(newEmail);
    if (existing && existing.id !== admin.id) {
      return res.status(409).json({ error: 'That email is already in use' });
    }
    const updated = await db.updateUserEmail(admin.id, newEmail);
    const token = signToken(updated); // token embeds email, so it must be reissued
    res.json({ ok: true, token, user: { id: updated.id, businessName: updated.businessName, email: updated.email, role: updated.role } });
  } catch (err) {
    console.error('change-email failed', err);
    res.status(500).json({ error: 'Failed to change email' });
  }
});

app.post('/api/admin/change-password', requireAuth, requireAdmin, authLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  try {
    const admin = await db.getUserById(req.user.id);
    const match = await comparePassword(currentPassword, admin.passwordHash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
    const passwordHash = await hashPassword(newPassword);
    await db.updateUserPassword(admin.id, passwordHash);
    res.json({ ok: true });
  } catch (err) {
    console.error('change-password failed', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Role-generic self-service email/password change — any authenticated
// role (vendor, customer, admin, super admin) can change their own email
// or password this way. Mirrors /api/admin/change-email and
// /api/admin/change-password above almost verbatim, but gated on
// requireAuth only so it isn't blocked for non-admin roles like vendors.
app.post('/api/me/change-email', requireAuth, authLimiter, async (req, res) => {
  const { newEmail, currentPassword } = req.body || {};
  if (!newEmail || !currentPassword) {
    return res.status(400).json({ error: 'New email and current password are required' });
  }
  try {
    const user = await db.getUserById(req.user.id);
    const match = await comparePassword(currentPassword, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const existing = await db.getUserByEmail(newEmail);
    if (existing && existing.id !== user.id) {
      return res.status(409).json({ error: 'That email is already in use' });
    }
    const updated = await db.updateUserEmail(user.id, newEmail);
    const token = signToken(updated); // token embeds email, so it must be reissued
    res.json({ ok: true, token, user: { id: updated.id, businessName: updated.businessName, email: updated.email, role: updated.role } });
  } catch (err) {
    console.error('change-email (self) failed', err);
    res.status(500).json({ error: 'Failed to change email' });
  }
});

app.post('/api/me/change-password', requireAuth, authLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  try {
    const user = await db.getUserById(req.user.id);
    const match = await comparePassword(currentPassword, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
    const passwordHash = await hashPassword(newPassword);
    await db.updateUserPassword(user.id, passwordHash);
    res.json({ ok: true });
  } catch (err) {
    console.error('change-password (self) failed', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

app.get('/api/admin/login-history', requireAuth, requireAdmin, async (req, res) => {
  try {
    const history = await db.getLoginHistory(req.user.id, 20);
    res.json({ history });
  } catch (err) {
    console.error('GET /api/admin/login-history failed', err);
    res.status(500).json({ error: 'Failed to load login history' });
  }
});

// Real per-device revoke — ends exactly one session (identified by its
// login_history row id), unlike "Logout All Devices" below which ends
// every session at once. Ownership-checked in db.revokeSession, so this
// can only revoke a session that's actually yours.
app.post('/api/admin/login-history/:id/revoke', requireAuth, requireAdmin, async (req, res) => {
  try {
    const revoked = await db.revokeSession(req.params.id, req.user.id);
    if (!revoked) return res.status(404).json({ error: 'Session not found, not yours, or already signed out' });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/admin/login-history/:id/revoke failed', err);
    res.status(500).json({ error: 'Failed to revoke session' });
  }
});

// "Logout All Devices" — bumps token_version, which invalidates every
// JWT issued before this call (see checkTokenVersion in auth.js). Then
// immediately re-issues a fresh token for THIS request, so the admin
// doing this isn't accidentally logged out of their own current session.
app.post('/api/admin/logout-all-devices', requireAuth, requireAdmin, authLimiter, async (req, res) => {
  try {
    const updated = await db.bumpTokenVersion(req.user.id);
    const token = signToken(updated);
    res.json({ ok: true, token });
  } catch (err) {
    console.error('logout-all-devices failed', err);
    res.status(500).json({ error: 'Failed to log out other devices' });
  }
});

app.get('/api/admin/export', requireAuth, requireAdmin, requireFeature('backup_restore'), async (req, res) => {
  try {
    const data = await db.exportAllData();
    const filename = `verta-delivery-export-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('GET /api/admin/export failed', err);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Restore — dry-run validation only, changes nothing. Real execution is
// a separate, explicit second step (see below).
app.post('/api/admin/restore/validate', requireAuth, requireAdmin, requireFeature('backup_restore'), async (req, res) => {
  try {
    const result = await db.validateRestorePayload(req.body);
    res.json(result);
  } catch (err) {
    console.error('POST /api/admin/restore/validate failed', err);
    res.status(500).json({ error: 'Failed to validate the file' });
  }
});

// Restore — actually applies it. Re-validates from scratch server-side
// (never trusts that the client's earlier /validate call is still
// accurate) before touching anything.
app.post('/api/admin/restore/execute', requireAuth, requireAdmin, requireFeature('backup_restore'), async (req, res) => {
  try {
    const validation = await db.validateRestorePayload(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.errors.join(' ') });
    }
    const result = await db.restoreFromExport(req.body);
    console.log(`[restore] ${req.user.email} restored ${result.ordersRestored} orders, ${result.expensesRestored} expenses, ${result.agentsRestored} agents`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/admin/restore/execute failed', err);
    res.status(500).json({ error: 'Restore failed — no changes were made (the whole operation is one transaction, so a failure partway through rolls back completely).' });
  }
});

// ============================================================
// Customers page — real aggregated data (order counts, total spent)
// per customer, joined from users + orders. Read-only.
// ============================================================
app.get('/api/admin/customers', requireAuth, requireAdmin, requireFeature('customers'), async (req, res) => {
  try {
    const customers = await db.getCustomers();
    res.json({ customers });
  } catch (err) {
    console.error('GET /api/admin/customers failed', err);
    res.status(500).json({ error: 'Failed to load customers' });
  }
});

// Super Admin creating a customer account directly — same reasoning
// as Add Vendor: no documents needed, immediately usable, useful for
// onboarding someone (e.g. over the phone) without making them
// self-register.
app.post('/api/super-admin/customers', requireAuth, requireSuperAdmin, async (req, res) => {
  const { businessName, email, phone, password } = req.body || {};
  if (!businessName || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const existing = await db.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const passwordHash = await hashPassword(password);
    const customer = await db.createUser({
      id: crypto.randomUUID(),
      businessName,
      email,
      phone: phone || null,
      passwordHash,
      role: 'sender',
    });
    await logAudit(req, 'customer.create', { targetType: 'user', targetId: customer.id, targetLabel: customer.businessName });
    res.json({ customer });
  } catch (err) {
    console.error('POST /api/super-admin/customers failed', err);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

app.put('/api/super-admin/customers/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const { businessName, email, phone } = req.body || {};
  if (!businessName || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  try {
    const existing = await db.getUserByEmail(email);
    if (existing && existing.id !== req.params.id) {
      return res.status(409).json({ error: 'Another account already uses that email' });
    }
    const updated = await db.updateCustomerByAdmin(req.params.id, { businessName, email, phone });
    if (!updated) return res.status(404).json({ error: 'Customer not found' });
    await logAudit(req, 'customer.update', { targetType: 'user', targetId: updated.id, targetLabel: updated.businessName });
    res.json({ customer: updated });
  } catch (err) {
    console.error('PUT /api/super-admin/customers/:id failed', err);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// Real, irreversible delete — cascades to the customer's entire order
// and purchase history. requireSuperAdmin only; the frontend requires
// a typed confirmation before ever calling this.
app.delete('/api/super-admin/customers/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const deleted = await db.deleteCustomer(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Customer not found' });
    await logAudit(req, 'customer.delete', { targetType: 'user', targetId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/super-admin/customers/:id failed', err);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

// A real, deliberately separate action from the general edit endpoint
// above — resetting someone's password is more sensitive than
// updating their name/phone, so it gets its own explicit confirmation
// step on the frontend rather than being bundled into casual editing.
app.put('/api/super-admin/customers/:id/password', requireAuth, requireSuperAdmin, async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const target = await db.getUserById(req.params.id);
    if (!target || target.role !== 'sender') return res.status(404).json({ error: 'Customer not found' });
    const passwordHash = await hashPassword(password);
    await db.updateUserPassword(req.params.id, passwordHash);
    await logAudit(req, 'customer.password_reset', { targetType: 'user', targetId: target.id, targetLabel: target.businessName });
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/super-admin/customers/:id/password failed', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ============================================================
// Super Admin only — platform-wide Overview. Genuinely cross-cutting
// data (vendors, customers, marketplace AND delivery totals) — this is
// what makes the Super Admin console a real oversight view rather than
// a relabeled copy of the Manage Agent operations dashboard.
// ============================================================
app.get('/api/super-admin/overview', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const [vendors, marketplaceStats, customers, deliveryOrders, platformSettings, premiumEstMonthlyValue, premiumRemindersSentLast7Days, pendingDirectCharges, deliveryCompanies, staffAccounts] = await Promise.all([
      db.getVendors(),
      db.getMarketplacePlatformStats(),
      db.getCustomers(),
      db.getAllOrders(),
      db.getPlatformSettings(),
      db.getActivePremiumMonthlyValue(),
      db.countPremiumRemindersSince(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
      db.getPendingDirectSubscriptionCharges(),
      db.getDeliveryCompanies(),
      db.getStaffAccounts(),
    ]);
    const deliveryRevenue = deliveryOrders
      .filter(o => o.status === 'delivered')
      .reduce((sum, o) => sum + (o.amount || 0), 0);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const newCustomersLast7Days = customers.filter(c => new Date(c.createdAt) >= sevenDaysAgo).length;
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const todayOrders = deliveryOrders.filter(o => new Date(o.createdAt) >= startOfToday).length;
    res.json({
      vendorCounts: {
        total: vendors.length,
        approved: vendors.filter(v => v.approvalStatus === 'approved').length,
        pending: vendors.filter(v => v.approvalStatus === 'pending').length,
        rejected: vendors.filter(v => v.approvalStatus === 'rejected').length,
      },
      totalCustomers: customers.length,
      newCustomersLast7Days,
      marketplace: marketplaceStats,
      delivery: {
        totalOrders: deliveryOrders.length,
        totalRevenue: deliveryRevenue,
        todayOrders,
        companyCount: deliveryCompanies.length,
      },
      // Platform administration — Super Admin and Manage Agent accounts,
      // broken out by role. Deliberately a top-level sibling of
      // marketplace/delivery, not nested under either one: these are
      // ONLib's own internal control accounts, not a line of business —
      // Super Admin oversees the whole platform (Marketplace, Restaurants,
      // AND Delivery), so counting it as a "Delivery" metric (the old
      // placement) mischaracterized it as delivery-specific staff.
      staff: {
        total: staffAccounts.length,
        superAdminCount: staffAccounts.filter(s => s.role === 'super_admin').length,
        manageAgentCount: staffAccounts.filter(s => s.role === 'admin').length,
      },
      // Real, current-state Premium figures for the Overview's spotlight
      // panel — no invented trends. premiumEstMonthlyValue and the pending
      // Direct queue are live aggregates; premiumRemindersSentLast7Days is
      // backed by premium_reminder_log (see db.logPremiumReminderSent).
      premium: {
        estMonthlyValue: premiumEstMonthlyValue,
        remindersSentLast7Days: premiumRemindersSentLast7Days,
        pendingDirectCount: pendingDirectCharges.length,
        commissionPercent: platformSettings.premiumCommissionPercent,
        featuringPerk: platformSettings.premiumFeaturingPerk,
        featuringDiscountPercent: platformSettings.premiumFeaturingDiscountPercent,
      },
    });
  } catch (err) {
    console.error('GET /api/super-admin/overview failed', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

// ============================================================
// Super Admin only — Vendors oversight panel. Lists every real vendor
// account (role = 'vendor'), their approval status, and real
// marketplace-wide stats. This previously (incorrectly) listed Manage
// Agent accounts and unrelated Delivery-service stats — fixed to show
// actual vendor data now that real vendor accounts exist.
// ============================================================
// Admin Overview's Marketplace/Restaurant sections — available to any
// admin-like role (not Super-Admin-only like /api/super-admin/vendors),
// since a regular Admin should see the same combined business picture.
app.get('/api/admin/business-overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await db.getBusinessOverviewStats();
    res.json(stats);
  } catch (err) {
    console.error('GET /api/admin/business-overview failed', err);
    res.status(500).json({ error: 'Failed to load business overview' });
  }
});

app.get('/api/super-admin/vendors', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const [vendors, platformStats] = await Promise.all([
      db.getVendors(), db.getMarketplacePlatformStats(),
    ]);
    res.json({ vendors, platformTotals: platformStats });
  } catch (err) {
    console.error('GET /api/super-admin/vendors failed', err);
    res.status(500).json({ error: 'Failed to load vendors' });
  }
});

// Super Admin creating a vendor account directly — no business/ID
// documents required, unlike public self-registration, since the
// Super Admin creating this account IS the approval. Skips the
// pending-review queue entirely.
app.post('/api/super-admin/vendors', requireAuth, requireSuperAdmin, async (req, res) => {
  const { businessName, email, phone, password, vendorType, deliveryZoneId } = req.body || {};
  if (!businessName || !email || !password) {
    return res.status(400).json({ error: 'Business name, email, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (vendorType !== undefined && vendorType !== 'store' && vendorType !== 'restaurant') {
    return res.status(400).json({ error: 'Invalid business type' });
  }
  // Required — a vendor with no delivery zone prices every order at $0
  // (zonePairFeeFor's/resolveDeliveryFee's guard for "no zone assigned")
  // with nothing in the storefront to explain why. A Super Admin creating
  // a vendor directly IS the approval step (no later review queue to
  // catch this the way self-registration still has), so this can't be
  // deferred the way the vendor's own optional Home Base zone in
  // Settings can.
  if (!deliveryZoneId) {
    return res.status(400).json({ error: 'A delivery zone is required' });
  }
  try {
    const zone = await db.getDeliveryZoneById(deliveryZoneId);
    if (!zone) return res.status(400).json({ error: 'That delivery zone no longer exists — pick another.' });
    const existing = await db.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const passwordHash = await hashPassword(password);
    const vendor = await db.createUser({
      id: crypto.randomUUID(),
      businessName,
      email,
      phone: phone || null,
      passwordHash,
      role: 'vendor',
      approvalStatus: 'approved',
      vendorType: vendorType === 'restaurant' ? 'restaurant' : 'store',
      deliveryZoneId,
    });
    await logAudit(req, 'vendor.create', { targetType: 'user', targetId: vendor.id, targetLabel: vendor.businessName });
    res.json({ vendor });
  } catch (err) {
    console.error('POST /api/super-admin/vendors failed', err);
    res.status(500).json({ error: 'Failed to create vendor' });
  }
});

// Real, irreversible delete — cascades to the vendor's entire product,
// purchase, and review history. requireSuperAdmin only; the frontend
// requires a typed confirmation before ever calling this — same
// pattern as DELETE /api/super-admin/customers/:id.
app.delete('/api/super-admin/vendors/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const deleted = await db.deleteVendor(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Vendor not found' });
    await logAudit(req, 'vendor.delete', { targetType: 'user', targetId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/super-admin/vendors/:id failed', err);
    res.status(500).json({ error: 'Failed to delete vendor' });
  }
});

// Same deliberately separate reset-password action as
// PUT /api/super-admin/customers/:id/password — its own explicit
// confirmation step on the frontend, not bundled into general editing.
app.put('/api/super-admin/vendors/:id/password', requireAuth, requireSuperAdmin, async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const target = await db.getUserById(req.params.id);
    if (!target || target.role !== 'vendor') return res.status(404).json({ error: 'Vendor not found' });
    const passwordHash = await hashPassword(password);
    await db.updateUserPassword(req.params.id, passwordHash);
    await logAudit(req, 'vendor.password_reset', { targetType: 'user', targetId: target.id, targetLabel: target.businessName });
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/super-admin/vendors/:id/password failed', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Staff accounts ("Manage Agent" role = 'admin') — real multi-account
// CRUD for the Super Admin Console's "Staff" tab. Historically there was
// only ever one such account, found on every boot by looking up a fixed
// ADMIN_EMAIL environment variable (see seedAdminIfConfigured further
// down this file) — that seeding still runs and still creates that one
// account on a fresh deploy, but it's now just how staff account #1
// happens to come into existence. From here a Super Admin can create,
// edit, reset the password of, permission, and disable as many more
// role = 'admin' accounts as the business needs — no different from any
// other account once created.
app.get('/api/super-admin/staff', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const staff = await db.getStaffAccounts();
    res.json({ staff });
  } catch (err) {
    console.error('GET /api/super-admin/staff failed', err);
    res.status(500).json({ error: 'Failed to load staff accounts' });
  }
});

// Creating a new staff (Manage Agent) account directly — no
// application/approval step needed, mirroring Add Vendor/Add Delivery
// Company: the Super Admin creating it here IS the approval.
app.post('/api/super-admin/staff', requireAuth, requireSuperAdmin, async (req, res) => {
  const { businessName, email, phone, password } = req.body || {};
  if (!businessName || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const existing = await db.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });
    const passwordHash = await hashPassword(password);
    const staff = await db.createUser({
      id: crypto.randomUUID(),
      businessName,
      email,
      phone: phone || null,
      passwordHash,
      role: 'admin',
      approvalStatus: 'approved',
    });
    await logAudit(req, 'staff.create', { targetType: 'user', targetId: staff.id, targetLabel: staff.businessName });
    res.json({ staff: { id: staff.id, businessName: staff.businessName, email: staff.email, phone: staff.phone, role: staff.role, createdAt: staff.createdAt, isDisabled: staff.isDisabled, disabledFeatures: staff.disabledFeatures } });
  } catch (err) {
    console.error('POST /api/super-admin/staff failed', err);
    res.status(500).json({ error: 'Failed to create staff account' });
  }
});

// Editing a staff account's name/email/phone. The ADMIN_EMAIL warning
// below only matters for the one account that's actually looked up by
// that env var on every boot (see seedAdminIfConfigured) — any other
// staff account created from here has no such dependency, so the
// warning only fires when this is that specific account.
app.put('/api/super-admin/staff/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const { businessName, email, phone } = req.body || {};
  if (!businessName || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  try {
    const target = await db.getUserById(req.params.id);
    if (!target || target.role !== 'admin') return res.status(404).json({ error: 'Staff account not found' });
    const existing = await db.getUserByEmail(email);
    if (existing && existing.id !== req.params.id) {
      return res.status(409).json({ error: 'Another account already uses that email' });
    }
    const wasEnvSeededAccount = target.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const updated = await db.updateManageAgentAccount(req.params.id, { businessName, email, phone });
    if (!updated) return res.status(404).json({ error: 'Staff account not found' });
    await logAudit(req, 'staff.update', { targetType: 'user', targetId: updated.id, targetLabel: updated.businessName });
    const emailChanged = wasEnvSeededAccount && updated.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase();
    res.json({
      staff: { id: updated.id, businessName: updated.businessName, email: updated.email, phone: updated.phone },
      emailChangedWarning: emailChanged
        ? `This was the account found via ADMIN_EMAIL on server boot. Update ADMIN_EMAIL=${updated.email} in Railway's Variables tab too — otherwise the next restart re-creates a new, blank account at the old address instead of finding this one.`
        : null,
    });
  } catch (err) {
    console.error('PUT /api/super-admin/staff failed', err);
    res.status(500).json({ error: 'Failed to update staff account' });
  }
});

app.put('/api/super-admin/staff/:id/password', requireAuth, requireSuperAdmin, async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const target = await db.getUserById(req.params.id);
    if (!target || target.role !== 'admin') return res.status(404).json({ error: 'Staff account not found' });
    const passwordHash = await hashPassword(password);
    await db.updateUserPassword(req.params.id, passwordHash);
    await logAudit(req, 'staff.password_reset', { targetType: 'user', targetId: target.id, targetLabel: target.businessName });
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/super-admin/staff/:id/password failed', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// The authoritative feature list, for the Super Admin's permissions
// toggle UI to render — so the frontend never has to hardcode this
// list separately from the backend's actual enforcement.
app.get('/api/super-admin/feature-keys', requireAuth, requireSuperAdmin, (req, res) => {
  res.json({ featureKeys: FEATURE_KEYS });
});

// Super Admin cutting off (or restoring) specific features for a
// staff account. Takes effect immediately — checked fresh against the
// database on every gated request, not cached in a token.
app.put('/api/super-admin/staff/:id/features', requireAuth, requireSuperAdmin, async (req, res) => {
  const { disabledFeatures } = req.body || {};
  if (!Array.isArray(disabledFeatures) || !disabledFeatures.every(f => typeof f === 'string')) {
    return res.status(400).json({ error: 'disabledFeatures must be a list of feature keys' });
  }
  const validKeys = Object.keys(FEATURE_KEYS);
  const invalid = disabledFeatures.filter(f => !validKeys.includes(f));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Unknown feature key(s): ${invalid.join(', ')}` });
  }
  try {
    const updated = await db.setDisabledFeatures(req.params.id, disabledFeatures);
    if (!updated) return res.status(404).json({ error: 'Staff account not found' });
    await logAudit(req, 'staff.features_update', { targetType: 'user', targetId: updated.id, targetLabel: updated.businessName, details: { disabledFeatures } });
    res.json({ ok: true, disabledFeatures: updated.disabledFeatures });
  } catch (err) {
    console.error('PUT /api/super-admin/staff/:id/features failed', err);
    res.status(500).json({ error: 'Failed to update permissions' });
  }
});

// Change Role — promote a Manage Agent to Super Admin, or demote a
// Super Admin back to Manage Agent. Scoped to exactly these two roles
// at the db layer (see setUserRole) so this can never be pointed at
// any other kind of account. Two safety checks that live here rather
// than the DB layer, since they need to read other rows first: never
// leave the platform with zero Super Admins, and always bump the
// target's token_version (done inside setUserRole) so the change is
// enforced immediately rather than waiting for their current token to
// expire on its own (up to 30 days).
app.put('/api/super-admin/staff/:id/role', requireAuth, requireSuperAdmin, async (req, res) => {
  const { role } = req.body || {};
  if (!['admin', 'super_admin'].includes(role)) {
    return res.status(400).json({ error: "role must be 'admin' or 'super_admin'" });
  }
  try {
    const target = await db.getUserById(req.params.id);
    if (!target || !['admin', 'super_admin'].includes(target.role)) {
      return res.status(404).json({ error: 'Staff account not found' });
    }
    if (target.role === role) {
      return res.status(400).json({ error: `This account is already ${role === 'super_admin' ? 'a Super Admin' : 'a Manage Agent'}` });
    }
    if (target.role === 'super_admin' && role === 'admin') {
      const superAdminCount = await db.countSuperAdmins();
      if (superAdminCount <= 1) {
        return res.status(400).json({ error: "Can't demote the last Super Admin — promote another account first" });
      }
    }
    const updated = await db.setUserRole(target.id, role);
    if (!updated) return res.status(404).json({ error: 'Staff account not found' });
    await logAudit(req, 'staff.role_change', {
      targetType: 'user',
      targetId: updated.id,
      targetLabel: updated.businessName,
      details: { from: target.role, to: role },
    });

    // Demoting/promoting your OWN account: the request that got us here
    // is still running on the old token, which the token_version bump
    // above just invalidated — re-sign a fresh one right now so this
    // response can log the caller straight into their new role instead
    // of leaving them holding a token that's already been rejected.
    const selfToken = target.id === req.user.id ? signToken(updated, req.user.sessionId) : null;
    res.json({
      ok: true,
      staff: { id: updated.id, businessName: updated.businessName, email: updated.email, phone: updated.phone, role: updated.role, createdAt: updated.createdAt, isDisabled: updated.isDisabled, disabledFeatures: updated.disabledFeatures },
      ...(selfToken ? { token: selfToken, user: { id: updated.id, businessName: updated.businessName, email: updated.email, phone: updated.phone, role: updated.role } } : {}),
    });
  } catch (err) {
    console.error('PUT /api/super-admin/staff/:id/role failed', err);
    res.status(500).json({ error: 'Failed to change role' });
  }
});

// A pending vendor's submitted documents — fetched on demand (not
// included in the list above) since they're base64 images/PDFs and
// would bloat that response for every vendor just to review one.
app.get('/api/super-admin/vendors/:id/documents', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const docs = await db.getVendorApplicationDocuments(req.params.id);
    if (!docs) return res.status(404).json({ error: 'Vendor not found' });
    res.json(docs);
  } catch (err) {
    console.error('GET /api/super-admin/vendors/:id/documents failed', err);
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

app.post('/api/super-admin/vendors/:id/approve', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    // Approving clears any previous rejection reason (see
    // db.setVendorApprovalStatus) — a fresh approval shouldn't carry a
    // stale explanation for why an earlier attempt was turned down.
    const vendor = await db.setVendorApprovalStatus(req.params.id, 'approved');
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    await logAudit(req, 'vendor.approve', { targetType: 'user', targetId: vendor.id, targetLabel: vendor.businessName });
    res.json({ ok: true, vendor: { id: vendor.id, businessName: vendor.businessName, approvalStatus: vendor.approvalStatus } });
  } catch (err) {
    console.error('POST vendor approve failed', err);
    res.status(500).json({ error: 'Failed to approve vendor' });
  }
});

// A reason is required — this is the whole point of the feature: the
// applicant (and the audit log) should always know why an application
// was turned down, not just that it was.
app.post('/api/super-admin/vendors/:id/reject', requireAuth, requireSuperAdmin, async (req, res) => {
  const { reason } = req.body || {};
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'A rejection reason is required' });
  }
  try {
    const vendor = await db.setVendorApprovalStatus(req.params.id, 'rejected', reason.trim());
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    await logAudit(req, 'vendor.reject', { targetType: 'user', targetId: vendor.id, targetLabel: vendor.businessName, details: { reason: reason.trim() } });
    res.json({ ok: true, vendor: { id: vendor.id, businessName: vendor.businessName, approvalStatus: vendor.approvalStatus, rejectionReason: vendor.rejectionReason } });
  } catch (err) {
    console.error('POST vendor reject failed', err);
    res.status(500).json({ error: 'Failed to reject vendor' });
  }
});

// Any admin-like account (Manage Agent staff, not just Super Admin)
// needs a delivery company list to route Fleet Directory agents to a
// real company — Admin itself is no longer a valid owner (see the
// agent:create/agent:update comment below). Deliberately lighter than
// the Super Admin route right below it: only companies that can
// actually receive an agent right now (approved, not disabled), none
// of the pending-application/rejection/disable-toggle fields that
// route is for.
app.get('/api/admin/delivery-companies', requireAuth, requireAdmin, async (req, res) => {
  try {
    const deliveryCompanies = await db.getActiveDeliveryCompaniesForFleetPicker();
    res.json({ deliveryCompanies });
  } catch (err) {
    console.error('GET /api/admin/delivery-companies failed', err);
    res.status(500).json({ error: 'Failed to load delivery companies' });
  }
});

// Delivery Companies — Super Admin oversight, mirroring the Vendors
// endpoints above exactly.
app.get('/api/super-admin/delivery-companies', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const deliveryCompanies = await db.getDeliveryCompanies();
    res.json({ deliveryCompanies });
  } catch (err) {
    console.error('GET /api/super-admin/delivery-companies failed', err);
    res.status(500).json({ error: 'Failed to load delivery companies' });
  }
});

// Super Admin creating a delivery company account directly — no
// business/ID documents required, unlike public self-registration,
// since the Super Admin creating this account IS the approval. Same
// reasoning as Add Vendor and Add Customer.
app.post('/api/super-admin/delivery-companies', requireAuth, requireSuperAdmin, async (req, res) => {
  const { businessName, email, phone, password } = req.body || {};
  if (!businessName || !email || !password) {
    return res.status(400).json({ error: 'Business name, email, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const existing = await db.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const passwordHash = await hashPassword(password);
    const deliveryCompany = await db.createUser({
      id: crypto.randomUUID(),
      businessName,
      email,
      phone: phone || null,
      passwordHash,
      role: 'delivery_company',
      approvalStatus: 'approved',
    });
    await logAudit(req, 'delivery_company.create', { targetType: 'user', targetId: deliveryCompany.id, targetLabel: deliveryCompany.businessName });
    res.json({ deliveryCompany });
  } catch (err) {
    console.error('POST /api/super-admin/delivery-companies failed', err);
    res.status(500).json({ error: 'Failed to create delivery company' });
  }
});

app.get('/api/super-admin/delivery-companies/:id/documents', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const docs = await db.getDeliveryCompanyApplicationDocuments(req.params.id);
    if (!docs) return res.status(404).json({ error: 'Delivery company not found' });
    res.json(docs);
  } catch (err) {
    console.error('GET delivery company documents failed', err);
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

// One generic endpoint covering Customers, Vendors, Delivery
// Companies, and Manage Agent accounts — real account suspension, not
// deletion. Blocks login and invalidates any already-active session
// immediately (see setUserDisabled). Deliberately cannot target
// role = 'super_admin' at all (enforced in the SQL itself, not just
// here) — including preventing a Super Admin from disabling their own
// account by accident.
app.put('/api/super-admin/users/:id/disable-status', requireAuth, requireSuperAdmin, async (req, res) => {
  const { disabled } = req.body || {};
  if (typeof disabled !== 'boolean') {
    return res.status(400).json({ error: 'disabled must be true or false' });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't disable your own account" });
  }
  try {
    const updated = await db.setUserDisabled(req.params.id, disabled);
    if (!updated) return res.status(404).json({ error: 'Account not found, or it belongs to a Super Admin (not allowed)' });
    await logAudit(req, disabled ? 'user.disable' : 'user.enable', { targetType: 'user', targetId: updated.id, targetLabel: updated.businessName });
    res.json({ ok: true, user: { id: updated.id, businessName: updated.businessName, isDisabled: updated.isDisabled } });
  } catch (err) {
    console.error('PUT disable-status failed', err);
    res.status(500).json({ error: 'Failed to update account status' });
  }
});

app.post('/api/super-admin/delivery-companies/:id/approve', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    // Approving clears any previous rejection reason — see the matching
    // comment on the vendor approve endpoint above.
    const company = await db.setDeliveryCompanyApprovalStatus(req.params.id, 'approved');
    if (!company) return res.status(404).json({ error: 'Delivery company not found' });
    await logAudit(req, 'delivery_company.approve', { targetType: 'user', targetId: company.id, targetLabel: company.businessName });
    res.json({ ok: true, deliveryCompany: { id: company.id, businessName: company.businessName, approvalStatus: company.approvalStatus } });
  } catch (err) {
    console.error('POST delivery company approve failed', err);
    res.status(500).json({ error: 'Failed to approve delivery company' });
  }
});

// A reason is required — same reasoning as the vendor reject endpoint
// above.
app.post('/api/super-admin/delivery-companies/:id/reject', requireAuth, requireSuperAdmin, async (req, res) => {
  const { reason } = req.body || {};
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'A rejection reason is required' });
  }
  try {
    const company = await db.setDeliveryCompanyApprovalStatus(req.params.id, 'rejected', reason.trim());
    if (!company) return res.status(404).json({ error: 'Delivery company not found' });
    await logAudit(req, 'delivery_company.reject', { targetType: 'user', targetId: company.id, targetLabel: company.businessName, details: { reason: reason.trim() } });
    res.json({ ok: true, deliveryCompany: { id: company.id, businessName: company.businessName, approvalStatus: company.approvalStatus, rejectionReason: company.rejectionReason } });
  } catch (err) {
    console.error('POST delivery company reject failed', err);
    res.status(500).json({ error: 'Failed to reject delivery company' });
  }
});

// "Enter Dashboard" — lets a Super Admin operate a vendor's real
// dashboard (same UI the vendor themselves uses, full read/write) for
// oversight/support purposes. Real safeguards, not just a relabeled
// login:
//   - Requires requireSuperAdmin (only Super Admin can mint this).
//   - The token is short-lived (1 hour — see signImpersonationToken),
//     not a normal 30-day session.
//   - Carries `impersonatedBy` so every action taken shows up in
//     server logs traceable back to the real Super Admin, not silently
//     attributed to the vendor with no trail.
//   - If the vendor isn't approved yet, this still works, but
//     enterApp() will show that vendor's own pending/rejected status
//     screen (same as the vendor would see) rather than the operational
//     dashboard — reviewing a pending application is what the Vendors
//     panel's document review is for, not this.
app.post('/api/super-admin/vendors/:id/impersonate', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const vendor = await db.getUserById(req.params.id);
    if (!vendor || vendor.role !== 'vendor') return res.status(404).json({ error: 'Vendor not found' });
    const superAdmin = await db.getUserById(req.user.id);
    const token = signImpersonationToken(vendor, superAdmin);
    console.log(`[impersonation] Super Admin ${superAdmin.email} entered vendor dashboard for "${vendor.businessName}" (${vendor.email})`);
    await logAudit(req, 'vendor.impersonate', { targetType: 'user', targetId: vendor.id, targetLabel: vendor.businessName });
    res.json({
      token,
      user: { id: vendor.id, businessName: vendor.businessName, email: vendor.email, role: vendor.role, approvalStatus: vendor.approvalStatus, rejectionReason: vendor.rejectionReason },
    });
  } catch (err) {
    console.error('POST vendor impersonate failed', err);
    res.status(500).json({ error: 'Failed to enter vendor dashboard' });
  }
});

// ============================================================
// Commission & Payouts — Super Admin only. Two-tier commission model:
// a global default rate per recipient type (marketplace vendors vs.
// delivery companies) in platform_settings, with an optional per-
// account override on the user (commission_rate_override). Payouts
// are real records — gross/commission/net are snapshotted at creation
// time and never recalculated retroactively if rates change later.
// ============================================================
app.get('/api/super-admin/settings/commission', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const settings = await db.getPlatformSettings();
    res.json({ settings });
  } catch (err) {
    console.error('GET /api/super-admin/settings/commission failed', err);
    res.status(500).json({ error: 'Failed to load commission settings' });
  }
});

app.put('/api/super-admin/settings/commission', requireAuth, requireSuperAdmin, async (req, res) => {
  const { marketplaceCommissionPercent, deliveryCommissionPercent, marketplaceCommissionEnabled, deliveryCommissionEnabled } = req.body || {};
  const fields = { marketplaceCommissionPercent, deliveryCommissionPercent, marketplaceCommissionEnabled, deliveryCommissionEnabled };
  const percentFields = { marketplaceCommissionPercent, deliveryCommissionPercent };
  for (const [key, val] of Object.entries(percentFields)) {
    if (val === undefined) continue;
    if (typeof val !== 'number' || isNaN(val) || val < 0 || val > 100) {
      return res.status(400).json({ error: `${key} must be a number between 0 and 100` });
    }
  }
  const enabledFields = { marketplaceCommissionEnabled, deliveryCommissionEnabled };
  for (const [key, val] of Object.entries(enabledFields)) {
    if (val === undefined) continue;
    if (typeof val !== 'boolean') {
      return res.status(400).json({ error: `${key} must be true or false` });
    }
  }
  for (const key of Object.keys(fields)) {
    if (fields[key] === undefined) delete fields[key];
  }
  try {
    const settings = await db.upsertPlatformSettings(fields);
    await logAudit(req, 'settings.commission_update', { targetType: 'platform_settings', targetId: 'platform', details: fields });
    res.json({ ok: true, settings });
  } catch (err) {
    console.error('PUT /api/super-admin/settings/commission failed', err);
    res.status(500).json({ error: 'Failed to update commission settings' });
  }
});

// ============================================================
// Platform-wide settings — Super Admin only. Same single-row table as
// commission settings above (platform_settings), a different slice of
// it: a default delivery fee (a suggested starting amount only — never
// enforced, admins can still type any amount when accepting an order),
// a free-text service area description, and a real maintenance-mode
// switch that actually blocks new order/purchase creation (see
// order:create and POST /api/marketplace/checkout) rather than just
// being a label. maintenanceMode/serviceArea/defaultDeliveryFee are
// also exposed unauthenticated via GET /api/config, so guests see the
// maintenance banner and service area before ever logging in.
// ============================================================
app.get('/api/super-admin/settings/platform', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const settings = await db.getPlatformSettings();
    res.json({ settings });
  } catch (err) {
    console.error('GET /api/super-admin/settings/platform failed', err);
    res.status(500).json({ error: 'Failed to load platform settings' });
  }
});

// Max lengths for the free-text Commission Statement fields below —
// generous enough for real sentences, but bounded so a Super Admin
// can't accidentally (or maliciously, since this is still a
// server-trust-nothing app) balloon the platform_settings row or the
// generated PDF with runaway text.
const MAX_INVOICE_TITLE_LENGTH = 120;
const MAX_INVOICE_NOTE_LENGTH = 500;

app.put('/api/super-admin/settings/platform', requireAuth, requireSuperAdmin, async (req, res) => {
  const {
    defaultDeliveryFee, serviceArea, maintenanceMode, maintenanceMessage, serviceFee,
    invoiceShowServiceFeeLine, invoiceShowMomoLine, invoiceHeaderTitle, invoiceHeaderSubtitle,
    invoiceFooterNote, invoiceCommissionNote, invoiceServiceFeeNote, invoiceMomoNote,
    featuredProductPackages, featuredVendorPackages, featuredProductSlotCap, featuredVendorSlotCap,
    premiumCommissionPercent, premiumReminderLeadDays, premiumFeaturingPerk, premiumFeaturingDiscountPercent,
  } = req.body || {};
  const fields = {};
  if (defaultDeliveryFee !== undefined) {
    if (defaultDeliveryFee !== null && (typeof defaultDeliveryFee !== 'number' || isNaN(defaultDeliveryFee) || defaultDeliveryFee < 0)) {
      return res.status(400).json({ error: 'defaultDeliveryFee must be a non-negative number, or null to clear it' });
    }
    fields.defaultDeliveryFee = defaultDeliveryFee;
  }
  if (serviceFee !== undefined) {
    if (typeof serviceFee !== 'number' || isNaN(serviceFee) || serviceFee < 0 || serviceFee > 1000) {
      return res.status(400).json({ error: 'serviceFee must be a non-negative number (under 1000)' });
    }
    fields.serviceFee = Math.round(serviceFee * 100) / 100;
  }
  if (serviceArea !== undefined) {
    if (serviceArea !== null && typeof serviceArea !== 'string') {
      return res.status(400).json({ error: 'serviceArea must be a string, or null to clear it' });
    }
    fields.serviceArea = serviceArea;
  }
  if (maintenanceMode !== undefined) {
    if (typeof maintenanceMode !== 'boolean') {
      return res.status(400).json({ error: 'maintenanceMode must be true or false' });
    }
    fields.maintenanceMode = maintenanceMode;
  }
  if (maintenanceMessage !== undefined) {
    if (maintenanceMessage !== null && typeof maintenanceMessage !== 'string') {
      return res.status(400).json({ error: 'maintenanceMessage must be a string, or null to clear it' });
    }
    fields.maintenanceMessage = maintenanceMessage;
  }
  if (invoiceShowServiceFeeLine !== undefined) {
    if (typeof invoiceShowServiceFeeLine !== 'boolean') {
      return res.status(400).json({ error: 'invoiceShowServiceFeeLine must be true or false' });
    }
    fields.invoiceShowServiceFeeLine = invoiceShowServiceFeeLine;
  }
  if (invoiceShowMomoLine !== undefined) {
    if (typeof invoiceShowMomoLine !== 'boolean') {
      return res.status(400).json({ error: 'invoiceShowMomoLine must be true or false' });
    }
    fields.invoiceShowMomoLine = invoiceShowMomoLine;
  }
  if (invoiceHeaderTitle !== undefined) {
    if (typeof invoiceHeaderTitle !== 'string' || !invoiceHeaderTitle.trim() || invoiceHeaderTitle.length > MAX_INVOICE_TITLE_LENGTH) {
      return res.status(400).json({ error: `invoiceHeaderTitle must be a non-empty string under ${MAX_INVOICE_TITLE_LENGTH} characters` });
    }
    fields.invoiceHeaderTitle = invoiceHeaderTitle.trim();
  }
  if (invoiceHeaderSubtitle !== undefined) {
    if (invoiceHeaderSubtitle !== null && (typeof invoiceHeaderSubtitle !== 'string' || invoiceHeaderSubtitle.length > MAX_INVOICE_TITLE_LENGTH)) {
      return res.status(400).json({ error: `invoiceHeaderSubtitle must be a string under ${MAX_INVOICE_TITLE_LENGTH} characters, or null to clear it` });
    }
    fields.invoiceHeaderSubtitle = invoiceHeaderSubtitle === null ? null : invoiceHeaderSubtitle.trim();
  }
  const noteFields = { invoiceFooterNote, invoiceCommissionNote, invoiceServiceFeeNote, invoiceMomoNote };
  for (const [key, value] of Object.entries(noteFields)) {
    if (value !== undefined) {
      if (typeof value !== 'string' || !value.trim() || value.length > MAX_INVOICE_NOTE_LENGTH) {
        return res.status(400).json({ error: `${key} must be a non-empty string under ${MAX_INVOICE_NOTE_LENGTH} characters` });
      }
      fields[key] = value.trim();
    }
  }
  if (featuredProductPackages !== undefined) {
    const err = validateFeaturedPackages(featuredProductPackages);
    if (err) return res.status(400).json({ error: `featuredProductPackages ${err}` });
    fields.featuredProductPackages = featuredProductPackages;
  }
  if (featuredVendorPackages !== undefined) {
    const err = validateFeaturedPackages(featuredVendorPackages);
    if (err) return res.status(400).json({ error: `featuredVendorPackages ${err}` });
    fields.featuredVendorPackages = featuredVendorPackages;
  }
  if (featuredProductSlotCap !== undefined) {
    if (typeof featuredProductSlotCap !== 'number' || !Number.isInteger(featuredProductSlotCap) || featuredProductSlotCap < 1 || featuredProductSlotCap > 1000) {
      return res.status(400).json({ error: 'featuredProductSlotCap must be a whole number between 1 and 1000' });
    }
    fields.featuredProductSlotCap = featuredProductSlotCap;
  }
  if (featuredVendorSlotCap !== undefined) {
    if (typeof featuredVendorSlotCap !== 'number' || !Number.isInteger(featuredVendorSlotCap) || featuredVendorSlotCap < 1 || featuredVendorSlotCap > 1000) {
      return res.status(400).json({ error: 'featuredVendorSlotCap must be a whole number between 1 and 1000' });
    }
    fields.featuredVendorSlotCap = featuredVendorSlotCap;
  }
  if (premiumCommissionPercent !== undefined) {
    if (typeof premiumCommissionPercent !== 'number' || isNaN(premiumCommissionPercent) || premiumCommissionPercent < 0 || premiumCommissionPercent > 100) {
      return res.status(400).json({ error: 'premiumCommissionPercent must be a number between 0 and 100' });
    }
    fields.premiumCommissionPercent = premiumCommissionPercent;
  }
  if (premiumReminderLeadDays !== undefined) {
    if (typeof premiumReminderLeadDays !== 'number' || !Number.isInteger(premiumReminderLeadDays) || premiumReminderLeadDays < 1 || premiumReminderLeadDays > 30) {
      return res.status(400).json({ error: 'premiumReminderLeadDays must be a whole number between 1 and 30' });
    }
    fields.premiumReminderLeadDays = premiumReminderLeadDays;
  }
  if (premiumFeaturingPerk !== undefined) {
    if (!['credit', 'discount'].includes(premiumFeaturingPerk)) {
      return res.status(400).json({ error: 'premiumFeaturingPerk must be "credit" or "discount"' });
    }
    fields.premiumFeaturingPerk = premiumFeaturingPerk;
  }
  if (premiumFeaturingDiscountPercent !== undefined) {
    if (typeof premiumFeaturingDiscountPercent !== 'number' || isNaN(premiumFeaturingDiscountPercent) || premiumFeaturingDiscountPercent < 0 || premiumFeaturingDiscountPercent > 100) {
      return res.status(400).json({ error: 'premiumFeaturingDiscountPercent must be a number between 0 and 100' });
    }
    fields.premiumFeaturingDiscountPercent = premiumFeaturingDiscountPercent;
  }
  try {
    const settings = await db.upsertPlatformSettings(fields);
    await logAudit(req, 'settings.platform_update', { targetType: 'platform_settings', targetId: 'platform', details: fields });
    res.json({ ok: true, settings });
  } catch (err) {
    console.error('PUT /api/super-admin/settings/platform failed', err);
    res.status(500).json({ error: 'Failed to update platform settings' });
  }
});

// Per-account commission rate override — vendors and delivery
// companies share the same handler shape, so one route body is
// parameterized by role rather than duplicated.
function handleCommissionOverride(role) {
  return async (req, res) => {
    const { rate } = req.body || {};
    if (rate !== null && (typeof rate !== 'number' || isNaN(rate) || rate < 0 || rate > 100)) {
      return res.status(400).json({ error: 'rate must be a number between 0 and 100, or null to clear the override' });
    }
    try {
      const target = await db.getUserById(req.params.id);
      if (!target || target.role !== role) return res.status(404).json({ error: 'Account not found' });
      const updated = await db.setCommissionRateOverride(req.params.id, rate);
      await logAudit(req, `${role}.commission_rate_override`, { targetType: 'user', targetId: target.id, targetLabel: target.businessName, details: { rate } });
      res.json({ ok: true, commissionRateOverride: updated.commissionRateOverride });
    } catch (err) {
      console.error(`PUT commission-rate override (${role}) failed`, err);
      res.status(500).json({ error: 'Failed to update commission rate' });
    }
  };
}
app.put('/api/super-admin/vendors/:id/commission-rate', requireAuth, requireSuperAdmin, handleCommissionOverride('vendor'));
app.put('/api/super-admin/delivery-companies/:id/commission-rate', requireAuth, requireSuperAdmin, handleCommissionOverride('delivery_company'));

// Current standing for every approved vendor/delivery company — gross
// revenue earned all-time, commission at their effective rate, and
// what's already been paid out vs. still outstanding. Real data only:
// gross comes from actual purchases/delivered orders, nothing
// estimated or fabricated.
app.get('/api/super-admin/payouts/summary', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const summary = await db.getPayoutSummary();
    res.json(summary);
  } catch (err) {
    console.error('GET /api/super-admin/payouts/summary failed', err);
    res.status(500).json({ error: 'Failed to load payout summary' });
  }
});

// A real, period-bound Commission Statement (invoice) for one
// vendor/delivery company — see the long comment on
// db.getCommissionStatement for how gross revenue, commission, and
// the (cash/COD-only) service fee owed are computed. This just
// returns the numbers; the PDF itself is generated client-side with
// jsPDF, matching every other report in this app.
app.get('/api/super-admin/commission-statement', requireAuth, requireSuperAdmin, async (req, res) => {
  const { recipientType, recipientId, periodStart, periodEnd } = req.query || {};
  if (!['vendor', 'delivery_company'].includes(recipientType)) {
    return res.status(400).json({ error: 'recipientType must be "vendor" or "delivery_company"' });
  }
  if (!recipientId || !periodStart || !periodEnd) {
    return res.status(400).json({ error: 'recipientId, periodStart, and periodEnd are required' });
  }
  const startDate = new Date(periodStart);
  const endDate = new Date(periodEnd);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
    return res.status(400).json({ error: 'periodEnd must be a valid date after periodStart' });
  }
  try {
    const statement = await db.getCommissionStatement({ recipientType, recipientId, periodStart: startDate.toISOString(), periodEnd: endDate.toISOString() });
    if (!statement) return res.status(404).json({ error: 'Recipient not found' });
    res.json({ statement });
  } catch (err) {
    console.error('GET /api/super-admin/commission-statement failed', err);
    res.status(500).json({ error: 'Failed to generate commission statement' });
  }
});

// Recording a real payout — a Super Admin marking that a specific
// amount was actually paid out to a vendor/delivery company for a
// given period. commission_amount/net_amount are computed and
// snapshotted here at creation time (see db.createPayout) — they will
// never drift if the platform's commission rate changes afterward.
app.post('/api/super-admin/payouts', requireAuth, requireSuperAdmin, async (req, res) => {
  const { recipientType, recipientId, periodStart, periodEnd, grossAmount, commissionRate, notes } = req.body || {};
  if (!['vendor', 'delivery_company'].includes(recipientType)) {
    return res.status(400).json({ error: 'recipientType must be "vendor" or "delivery_company"' });
  }
  if (!recipientId || !periodStart || !periodEnd) {
    return res.status(400).json({ error: 'recipientId, periodStart, and periodEnd are required' });
  }
  if (typeof grossAmount !== 'number' || isNaN(grossAmount) || grossAmount < 0) {
    return res.status(400).json({ error: 'grossAmount must be a non-negative number' });
  }
  if (typeof commissionRate !== 'number' || isNaN(commissionRate) || commissionRate < 0 || commissionRate > 100) {
    return res.status(400).json({ error: 'commissionRate must be a number between 0 and 100' });
  }
  try {
    const target = await db.getUserById(recipientId);
    if (!target || target.role !== recipientType) return res.status(404).json({ error: 'Recipient not found' });
    const payout = await db.createPayout({
      id: crypto.randomUUID(),
      recipientType, recipientId, periodStart, periodEnd, grossAmount, commissionRate,
      notes: notes || null,
      createdBy: req.user.id,
    });
    await logAudit(req, 'payout.create', {
      targetType: 'user', targetId: target.id, targetLabel: target.businessName,
      details: { payoutId: payout.id, grossAmount, netAmount: payout.netAmount, recipientType },
    });
    res.json({ ok: true, payout });
  } catch (err) {
    console.error('POST /api/super-admin/payouts failed', err);
    res.status(500).json({ error: 'Failed to record payout' });
  }
});

// Payout history — optionally filtered to a single recipient (used by
// the per-vendor/per-company detail view); otherwise platform-wide,
// most recent first.
app.get('/api/super-admin/payouts', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const payouts = await db.getPayouts({ recipientId: req.query.recipientId || undefined, limit });
    res.json({ payouts });
  } catch (err) {
    console.error('GET /api/super-admin/payouts failed', err);
    res.status(500).json({ error: 'Failed to load payouts' });
  }
});

// ============================================================
// Disputes — Super Admin queue. The customer-facing "report a
// problem"/"my disputes" endpoints live down with the other
// marketplace/customer routes; this half is the resolution side,
// gated the same as Payouts and Vendors (Super Admin only) since
// resolving a dispute can move money — see the refund-netting comment
// on db.getPayoutSummary.
// ============================================================
const DISPUTE_CATEGORIES = ['wrong_item', 'damaged', 'never_arrived', 'overcharged', 'other', 'vendor_return'];
const RETURN_REASONS = ['changed_mind', 'wrong_item', 'damaged', 'not_as_described', 'other'];

app.get('/api/super-admin/disputes', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const status = ['open', 'resolved', 'rejected'].includes(req.query.status) ? req.query.status : undefined;
    const [disputes, openCount] = await Promise.all([
      db.getDisputes({ status }),
      db.countOpenDisputes(),
    ]);
    res.json({ disputes, openCount });
  } catch (err) {
    console.error('GET /api/super-admin/disputes failed', err);
    res.status(500).json({ error: 'Failed to load disputes' });
  }
});

// The one resolution step. decision === 'refund' requires a positive
// refundAmount and moves the dispute to 'resolved'; decision ===
// 'reject' forces refundAmount to null and moves it to 'rejected';
// decision === 'void' also moves it to 'resolved' (no refund amount)
// but additionally flags the linked purchase as excluded from revenue
// — see db.excludePurchaseFromRevenue. 'void' is how a vendor's
// deletion request (POST /api/vendor/purchases/:id/request-deletion,
// folded into this same queue via initiated_by) gets approved, though
// it's allowed generically for any dispute with a purchase attached,
// not gated to vendor-initiated ones specifically. resolutionNote is
// required in every case — shown back to the customer, same reasoning
// as the vendor/delivery-company rejection-reason feature: they
// should always know why, not just what happened.
app.put('/api/super-admin/disputes/:id/resolve', requireAuth, requireSuperAdmin, async (req, res) => {
  const { decision, refundAmount, resolutionNote } = req.body || {};
  if (!['refund', 'reject', 'void'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "refund", "reject", or "void"' });
  }
  if (!resolutionNote || !resolutionNote.trim()) {
    return res.status(400).json({ error: 'A resolution note is required — the customer will see this' });
  }
  let finalRefundAmount = null;
  if (decision === 'refund') {
    if (typeof refundAmount !== 'number' || isNaN(refundAmount) || refundAmount <= 0) {
      return res.status(400).json({ error: 'refundAmount must be a positive number when issuing a refund' });
    }
    finalRefundAmount = Math.round(refundAmount * 100) / 100;
  }
  try {
    const existing = await db.getDisputeById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Dispute not found' });
    if (existing.status !== 'open') return res.status(409).json({ error: `This dispute was already ${existing.status}` });
    if (decision === 'void' && !existing.purchaseId) {
      return res.status(400).json({ error: 'Only a marketplace purchase can be voided — this dispute has no purchase attached' });
    }
    const dispute = await db.resolveDispute(req.params.id, {
      status: decision === 'reject' ? 'rejected' : 'resolved',
      resolutionNote: resolutionNote.trim(),
      refundAmount: finalRefundAmount,
      resolvedBy: req.user.id,
    });
    if (!dispute) return res.status(409).json({ error: 'This dispute was already resolved' });
    if (decision === 'void') {
      // "Void it, keep it" — the purchase row stays exactly where it
      // is, in every order history, forever; this only stops it
      // counting toward vendor/Super-Admin revenue from here on. Never
      // touches delivery_fee — a delivery company that already did the
      // work keeps that fee no matter why the vendor's own product
      // revenue is later voided. The one exception (see
      // excludePurchaseFromRevenue's own comment): a still-pending,
      // never-accepted delivery order gets cancelled in the same
      // transaction, instead of sitting in Pending Assignment forever
      // for a purchase that's now dead — broadcast the same way any
      // other order cancellation already is, so an admin watching the
      // dashboard live sees it drop out of Pending Assignment
      // immediately, not just on the next report generation.
      const { cancelledOrder } = await db.excludePurchaseFromRevenue(existing.purchaseId, { reason: resolutionNote.trim() });
      if (cancelledOrder) orderRooms(cancelledOrder).forEach((r) => io.to(r).emit('order:updated', cancelledOrder));
    }
    await logAudit(req, 'dispute.resolve', {
      targetType: 'dispute', targetId: dispute.id, targetLabel: existing.customerName,
      details: { decision, refundAmount: finalRefundAmount, resolutionNote: resolutionNote.trim() },
    });
    // Live-update an open customer tab, same pattern as order:updated.
    io.to(`user:${dispute.customerId}`).emit('dispute:resolved', dispute);
    res.json({ ok: true, dispute });
  } catch (err) {
    console.error('PUT /api/super-admin/disputes/:id/resolve failed', err);
    res.status(500).json({ error: 'Failed to resolve dispute' });
  }
});

// ============================================================
// Audit Log — Super Admin only. Read-only, append-only trail of
// every sensitive action taken from the Super Admin console (see the
// logAudit() calls threaded through this file). Paginated with a
// created_at cursor (`before`) rather than offset, since new entries
// are always being appended.
// ============================================================
app.get('/api/super-admin/audit-log', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const entries = await db.getAuditLog({
      limit,
      before: req.query.before || undefined,
      action: req.query.action || undefined,
      actorId: req.query.actorId || undefined,
    });
    res.json({ entries });
  } catch (err) {
    console.error('GET /api/super-admin/audit-log failed', err);
    res.status(500).json({ error: 'Failed to load audit log' });
  }
});

app.get('/api/super-admin/audit-log/actions', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const actions = await db.getAuditActionKeys();
    res.json({ actions });
  } catch (err) {
    console.error('GET /api/super-admin/audit-log/actions failed', err);
    res.status(500).json({ error: 'Failed to load audit actions' });
  }
});

// ============================================================
// Pricing presets — admin-defined reference price points, offered as
// quick-select options in the Accept Order flow. Not an automatic
// distance/zone calculator (no mapping data backs this app).
// ============================================================
app.post('/api/admin/price-presets', requireAuth, requireAdmin, requireFeature('price_presets'), async (req, res) => {
  const { label, amount } = req.body || {};
  if (!label || !label.trim() || amount === undefined || amount === null || isNaN(Number(amount)) || Number(amount) < 0) {
    return res.status(400).json({ error: 'A label and a valid non-negative amount are required' });
  }
  try {
    const preset = await db.createPricePreset({ id: crypto.randomUUID(), label: label.trim(), amount: Number(amount) });
    io.to('admins').emit('price-preset:created', preset);
    res.json({ ok: true, preset });
  } catch (err) {
    console.error('POST /api/admin/price-presets failed', err);
    res.status(500).json({ error: 'Failed to save price preset' });
  }
});

app.delete('/api/admin/price-presets/:id', requireAuth, requireAdmin, requireFeature('price_presets'), async (req, res) => {
  try {
    await db.deletePricePreset(req.params.id);
    io.to('admins').emit('price-preset:deleted', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/price-presets failed', err);
    res.status(500).json({ error: 'Failed to delete price preset' });
  }
});

// ------------------------------------------------------------
// Price Presets — PDF import. Two-step (parse, then commit) so
// nothing is actually saved off a heuristic PDF-text parse without a
// human reviewing it first — same "preview before you commit" shape
// as the existing JSON database Restore flow (see
// /api/admin/restore/validate + /execute). Step 1 never touches the
// database; step 2 only ever writes exactly the rows the caller sends
// back, so a Super Admin who edited/removed a bad row in the preview
// gets exactly that, not a silent re-parse.
// ------------------------------------------------------------
const MAX_PRICE_PRESET_PDF_BYTES = 5 * 1024 * 1024; // ~5MB raw — a multi-page price list PDF, not a scanned book

app.post('/api/admin/price-presets/import/parse', requireAuth, requireAdmin, requireFeature('price_presets'), async (req, res) => {
  const { pdfDataUrl } = req.body || {};
  if (!pdfDataUrl || typeof pdfDataUrl !== 'string' || !pdfDataUrl.startsWith('data:application/pdf')) {
    return res.status(400).json({ error: 'Please upload a PDF file' });
  }
  if (pdfDataUrl.length > MAX_PRICE_PRESET_PDF_BYTES * 1.4) {
    return res.status(400).json({ error: 'PDF is too large — please use a file under ~5MB' });
  }
  try {
    const base64 = pdfDataUrl.slice(pdfDataUrl.indexOf(',') + 1);
    const buffer = Buffer.from(base64, 'base64');
    // Lazy-required so a missing/broken pdf-parse install can only
    // ever fail this one route, never prevent the rest of the server
    // from booting.
    let pdfParse;
    try {
      pdfParse = require('pdf-parse');
    } catch (requireErr) {
      console.error('pdf-parse is not installed', requireErr);
      return res.status(500).json({ error: 'PDF parsing isn\'t available on this server right now — please try again later or add presets manually.' });
    }
    const parsed = await pdfParse(buffer);
    const { rows, skippedLines, truncated } = parsePriceRowsFromText(parsed.text);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Couldn\'t find any "label — amount" rows in that PDF. You can still add presets manually below.' });
    }
    res.json({ ok: true, rows, skippedLines, truncated });
  } catch (err) {
    console.error('POST /api/admin/price-presets/import/parse failed', err);
    res.status(400).json({ error: 'Could not read that PDF — please make sure it\'s a valid, non-password-protected PDF file.' });
  }
});

app.post('/api/admin/price-presets/import/commit', requireAuth, requireAdmin, requireFeature('price_presets'), async (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No presets to import' });
  }
  if (rows.length > 200) {
    return res.status(400).json({ error: 'Too many presets in one import — please split into batches of 200 or fewer' });
  }
  const cleaned = [];
  for (const r of rows) {
    const label = r && typeof r.label === 'string' ? r.label.trim() : '';
    const amount = r ? Number(r.amount) : NaN;
    if (!label || label.length > 200 || isNaN(amount) || amount < 0 || amount > 100000) {
      return res.status(400).json({ error: `Every row needs a label (under 200 characters) and a non-negative amount — check "${label || '(blank)'}"` });
    }
    cleaned.push({ label, amount });
  }
  try {
    const created = await db.bulkCreatePricePresets(cleaned);
    created.forEach(preset => io.to('admins').emit('price-preset:created', preset));
    await logAudit(req, 'price_presets.pdf_import', { targetType: 'price_presets', details: { count: created.length } });
    res.json({ ok: true, presets: created });
  } catch (err) {
    console.error('POST /api/admin/price-presets/import/commit failed', err);
    res.status(500).json({ error: 'Failed to import price presets' });
  }
});

// ============================================================
// Marketplace (ONLib) — vendor product management
// ============================================================

app.get('/api/vendor/products', requireAuth, requireVendor, async (req, res) => {
  try {
    const products = await db.getProductsByVendor(req.user.id);
    res.json({ products });
  } catch (err) {
    console.error('GET /api/vendor/products failed', err);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

// ============================================================
// Promotions — a vendor puts one of their own products on sale for a
// percentage off, for a real date range. The discount is enforced at
// checkout (see db.checkout) — this isn't just cosmetic pricing.
// ============================================================
app.get('/api/vendor/promotions', requireAuth, requireVendor, async (req, res) => {
  try {
    const promotions = await db.getVendorPromotions(req.user.id);
    res.json({ promotions });
  } catch (err) {
    console.error('GET /api/vendor/promotions failed', err);
    res.status(500).json({ error: 'Failed to load promotions' });
  }
});

app.post('/api/vendor/promotions', requireAuth, requireVendor, async (req, res) => {
  const { productId, discountPercent, startsAt, endsAt } = req.body || {};
  const discount = Number(discountPercent);
  if (!productId || !discount || discount <= 0 || discount > 90) {
    return res.status(400).json({ error: 'A product and a discount between 1 and 90 percent are required' });
  }
  if (!endsAt || new Date(endsAt) <= new Date()) {
    return res.status(400).json({ error: 'End date must be in the future' });
  }
  try {
    const product = await db.getProductById(productId);
    if (!product || product.vendorId !== req.user.id) {
      return res.status(404).json({ error: 'Product not found in your store' });
    }
    const promotion = await db.createPromotion({
      id: crypto.randomUUID(), vendorId: req.user.id, productId,
      discountPercent: discount, startsAt: startsAt ? new Date(startsAt) : new Date(), endsAt: new Date(endsAt),
    });
    res.json({ promotion });
  } catch (err) {
    console.error('POST /api/vendor/promotions failed', err);
    res.status(400).json({ error: err.message || 'Failed to create promotion' });
  }
});

app.delete('/api/vendor/promotions/:id', requireAuth, requireVendor, async (req, res) => {
  try {
    const deleted = await db.deletePromotion(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Promotion not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/vendor/promotions/:id failed', err);
    res.status(500).json({ error: 'Failed to end promotion' });
  }
});

// ============================================================
// Coupon codes — cart-level, vendor-scoped self-service discount codes.
// See schema.sql's comment on the coupons table for the full design
// (why vendor-scoped rather than platform-wide, percent vs fixed,
// usage caps). The actual discount is only ever applied inside
// db.checkout()'s own transaction (see POST /api/marketplace/checkout
// and its momo counterpart below) — everything here is management
// (create/list/toggle/delete) plus a read-only preview for the cart.
// ============================================================

function validateCouponFields({ code, discountType, discountValue, minOrderAmount, maxUses, perCustomerLimit, startsAt, endsAt }) {
  if (!code || !code.trim()) return 'A coupon code is required';
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(code.trim())) return 'Coupon codes must be 3-20 letters, numbers, hyphens, or underscores';
  if (!['percent', 'fixed'].includes(discountType)) return 'Discount type must be "percent" or "fixed"';
  const value = Number(discountValue);
  if (!Number.isFinite(value) || value <= 0) return 'Discount value must be a positive number';
  if (discountType === 'percent' && value > 90) return 'Percent discounts are capped at 90%';
  if (minOrderAmount !== undefined && minOrderAmount !== null && minOrderAmount !== '') {
    if (!Number.isFinite(Number(minOrderAmount)) || Number(minOrderAmount) < 0) return 'Minimum order amount must be a non-negative number';
  }
  if (maxUses !== undefined && maxUses !== null && maxUses !== '') {
    if (!Number.isInteger(Number(maxUses)) || Number(maxUses) <= 0) return 'Max uses must be a positive whole number';
  }
  if (perCustomerLimit !== undefined && perCustomerLimit !== null && perCustomerLimit !== '') {
    if (!Number.isInteger(Number(perCustomerLimit)) || Number(perCustomerLimit) <= 0) return 'Per-customer limit must be a positive whole number';
  }
  if (endsAt && new Date(endsAt) <= new Date()) return 'End date must be in the future';
  // A vendor could otherwise submit a start date after (or equal to) the
  // end date — the coupon would then validate at creation but never once
  // be redeemable, silently, with no error telling them why. Only checked
  // when a start date was actually supplied — an omitted startsAt defaults
  // to "now" below, which is always before any endsAt that already passed
  // the future-date check above.
  if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) return 'Start date must be before end date';
  return null;
}

app.get('/api/vendor/coupons', requireAuth, requireVendor, async (req, res) => {
  try {
    const coupons = await db.getVendorCoupons(req.user.id);
    res.json({ coupons });
  } catch (err) {
    console.error('GET /api/vendor/coupons failed', err);
    res.status(500).json({ error: 'Failed to load coupons' });
  }
});

app.post('/api/vendor/coupons', requireAuth, requireVendor, async (req, res) => {
  const { code, discountType, discountValue, minOrderAmount, maxUses, perCustomerLimit, startsAt, endsAt } = req.body || {};
  const validationError = validateCouponFields({ code, discountType, discountValue, minOrderAmount, maxUses, perCustomerLimit, startsAt, endsAt });
  if (validationError) return res.status(400).json({ error: validationError });
  try {
    const coupon = await db.createCoupon({
      id: crypto.randomUUID(), vendorId: req.user.id, code, discountType, discountValue: Number(discountValue),
      minOrderAmount: minOrderAmount ? Number(minOrderAmount) : null,
      maxUses: maxUses ? Number(maxUses) : null,
      perCustomerLimit: perCustomerLimit ? Number(perCustomerLimit) : null,
      startsAt: startsAt ? new Date(startsAt) : new Date(),
      endsAt: endsAt ? new Date(endsAt) : null,
    });
    res.json({ coupon });
  } catch (err) {
    console.error('POST /api/vendor/coupons failed', err);
    res.status(400).json({ error: err.message || 'Failed to create coupon' });
  }
});

app.patch('/api/vendor/coupons/:id/active', requireAuth, requireVendor, async (req, res) => {
  const { isActive } = req.body || {};
  if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be true or false' });
  try {
    const coupon = await db.setCouponActive(req.params.id, req.user.id, isActive);
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
    res.json({ coupon });
  } catch (err) {
    console.error('PATCH /api/vendor/coupons/:id/active failed', err);
    res.status(500).json({ error: 'Failed to update coupon' });
  }
});

app.delete('/api/vendor/coupons/:id', requireAuth, requireVendor, async (req, res) => {
  try {
    const deleted = await db.deleteCoupon(req.params.id, req.user.id);
    if (!deleted) return res.status(400).json({ error: 'Coupon not found, or already redeemed at least once (deactivate it instead)' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/vendor/coupons/:id failed', err);
    res.status(500).json({ error: 'Failed to delete coupon' });
  }
});

// Public-ish (requireAuth only, any role) preview — lets the cart's
// "Apply" button show the real discount before the customer commits to
// checkout, without ever mutating usage counters (see
// db.previewCoupon's comment).
app.post('/api/marketplace/coupons/preview', requireAuth, async (req, res) => {
  const { vendorId, code, subtotal } = req.body || {};
  if (!vendorId || !code) return res.status(400).json({ error: 'vendorId and code are required' });
  const sub = Number(subtotal) || 0;
  try {
    const result = await db.previewCoupon(vendorId, code, sub, req.user.id);
    res.json(result);
  } catch (err) {
    console.error('POST /api/marketplace/coupons/preview failed', err);
    res.status(500).json({ error: 'Failed to check coupon' });
  }
});

const MAX_PRODUCT_IMAGE_BYTES = 700 * 1024; // same limit/reasoning as the business logo upload
const MAX_PRODUCT_COLORS = 8;
const MAX_PRODUCT_SIZES = 8;
const MAX_SIZE_CHART_COLUMNS = 6;
const MAX_SIZE_CHART_ROWS = 10;

// Shared validation for the vendor product form's new variant fields —
// used by both create and update, since a vendor can add colors/sizes/a
// size chart at either point, not just at creation. Never trusts client
// caps/shapes even though the UI itself already limits them (matching
// every other "don't trust the client" check already in this file).
// Returns an error string, or null if everything (present) is valid.
function validateProductVariantFields({ colors, sizes, sizeChart, lowStockThreshold }) {
  if (lowStockThreshold !== undefined && lowStockThreshold !== null && lowStockThreshold !== '') {
    const n = Number(lowStockThreshold);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return 'Low-stock alert threshold must be a whole number of 0 or more';
    }
  }
  if (colors !== undefined && colors !== null) {
    if (!Array.isArray(colors)) return 'Colors must be a list';
    if (colors.length > MAX_PRODUCT_COLORS) return `A product can have at most ${MAX_PRODUCT_COLORS} colors`;
    for (const c of colors) {
      if (!c || typeof c.name !== 'string' || !c.name.trim()) return 'Every color needs a name';
      if (c.imageDataUrl && c.imageDataUrl.length > MAX_PRODUCT_IMAGE_BYTES) {
        return 'A color swatch photo is too large — please use an image under ~500KB.';
      }
    }
  }
  if (sizes !== undefined && sizes !== null) {
    if (!Array.isArray(sizes)) return 'Sizes must be a list';
    if (sizes.length > MAX_PRODUCT_SIZES) return `A product can have at most ${MAX_PRODUCT_SIZES} sizes`;
    for (const s of sizes) {
      if (typeof s !== 'string' || !s.trim()) return 'Every size needs a label';
    }
  }
  if (sizeChart !== undefined && sizeChart !== null) {
    if (!sizeChart || !Array.isArray(sizeChart.headers) || !Array.isArray(sizeChart.rows)) {
      return 'Size chart is malformed';
    }
    if (sizeChart.headers.length > MAX_SIZE_CHART_COLUMNS) return `A size chart can have at most ${MAX_SIZE_CHART_COLUMNS} columns`;
    if (sizeChart.rows.length > MAX_SIZE_CHART_ROWS) return `A size chart can have at most ${MAX_SIZE_CHART_ROWS} rows`;
    if (sizeChart.headers.some(h => typeof h !== 'string')) return 'Size chart headers must be text';
    if (sizeChart.rows.some(row => !Array.isArray(row) || row.length !== sizeChart.headers.length || row.some(cell => typeof cell !== 'string'))) {
      return 'Every size chart row must have one value per column';
    }
  }
  return null;
}

// Real per-variant stock (task: "Only for products with variants") — a
// vendor submits one row per color/size combination they're stocking;
// this validates each row's color/size against the product's OWN
// colors/sizes lists (never trusts the client's claimed option names,
// same posture as db.checkout()'s variant validation) and rejects
// duplicate combinations. Returns an error string, or null if
// variantStock is absent/valid. A product with neither colors nor
// sizes declared has nothing to validate against — callers below treat
// that case as "ignore variantStock, this product uses plain pooled
// stock" rather than an error, since a vendor's product-form payload
// may still include a leftover empty variantStock array from earlier UI
// state.
function validateVariantStockPayload(variantStock, colors, sizes) {
  if (variantStock === undefined || variantStock === null) return null;
  if (!Array.isArray(variantStock)) return 'Variant stock must be a list';
  const colorNames = (colors || []).map(c => c.name);
  const hasColors = colorNames.length > 0;
  const hasSizes = (sizes || []).length > 0;
  if (!hasColors && !hasSizes) return null; // nothing to validate against — ignored by the route handlers
  const seen = new Set();
  for (const v of variantStock) {
    if (!v || typeof v !== 'object') return 'Malformed variant stock row';
    const color = hasColors ? String(v.color || '') : '';
    const size = hasSizes ? String(v.size || '') : '';
    if (hasColors && !colorNames.includes(color)) return `Unknown color "${v.color}" in variant stock`;
    if (hasSizes && !sizes.includes(size)) return `Unknown size "${v.size}" in variant stock`;
    const qty = Number(v.stockQuantity);
    if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
      return 'Variant stock quantity must be a whole number of 0 or more';
    }
    const key = `${color}::${size}`;
    if (seen.has(key)) return 'Duplicate color/size combination in variant stock';
    seen.add(key);
  }
  return null;
}

// Normalizes a validated variantStock payload into the {color, size,
// stockQuantity} shape db.setProductVariantStock expects, applying the
// empty-string sentinel to whichever dimension the product doesn't use
// (mirrors db.checkout()'s own sentinel handling).
function normalizeVariantStock(variantStock, colors, sizes) {
  const hasColors = (colors || []).length > 0;
  const hasSizes = (sizes || []).length > 0;
  return variantStock.map(v => ({
    color: hasColors ? String(v.color || '') : '',
    size: hasSizes ? String(v.size || '') : '',
    stockQuantity: Math.max(0, Math.floor(Number(v.stockQuantity) || 0)),
  }));
}

app.post('/api/vendor/products', requireAuth, requireVendor, async (req, res) => {
  const { name, description, price, category, imageDataUrl, stockQuantity, colors, sizes, sizeChart, lowStockThreshold, variantStock } = req.body || {};
  if (!name || !name.trim() || price === undefined || isNaN(Number(price)) || Number(price) < 0) {
    return res.status(400).json({ error: 'A name and a valid non-negative price are required' });
  }
  if (imageDataUrl && imageDataUrl.length > MAX_PRODUCT_IMAGE_BYTES) {
    return res.status(400).json({ error: 'Product image is too large — please use an image under ~500KB.' });
  }
  const variantError = validateProductVariantFields({ colors, sizes, sizeChart, lowStockThreshold });
  if (variantError) return res.status(400).json({ error: variantError });
  const variantStockError = validateVariantStockPayload(variantStock, colors, sizes);
  if (variantStockError) return res.status(400).json({ error: variantStockError });
  try {
    let product = await db.createProduct({
      id: crypto.randomUUID(),
      vendorId: req.user.id,
      name: name.trim(),
      description,
      price: Number(price),
      category,
      imageDataUrl,
      stockQuantity: Number(stockQuantity) || 0,
      colors,
      sizes,
      sizeChart,
      lowStockThreshold,
    });
    const hasVariants = (product.colors.length || product.sizes.length) && Array.isArray(variantStock);
    if (hasVariants) {
      product = await db.setProductVariantStock(product.id, normalizeVariantStock(variantStock, product.colors, product.sizes));
    }
    res.json({ ok: true, product });
  } catch (err) {
    console.error('POST /api/vendor/products failed', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

app.put('/api/vendor/products/:id', requireAuth, requireVendor, async (req, res) => {
  try {
    const existing = await db.getProductById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found' });
    if (existing.vendorId !== req.user.id) return res.status(403).json({ error: 'Not your product' });
    if (req.body.imageDataUrl && req.body.imageDataUrl.length > MAX_PRODUCT_IMAGE_BYTES) {
      return res.status(400).json({ error: 'Product image is too large — please use an image under ~500KB.' });
    }
    // Same "name and a valid non-negative price are required" guard
    // POST /api/vendor/products already has — only enforced when the
    // field is actually part of THIS request (a vendor updating just
    // stock or colors/sizes shouldn't be forced to resend name/price),
    // matching the "omitted = leave unchanged" convention this route
    // already uses for every other field. The product form always sends
    // both together, so this only ever bites a malformed direct request.
    if (Object.prototype.hasOwnProperty.call(req.body, 'name') && (!req.body.name || !req.body.name.trim())) {
      return res.status(400).json({ error: 'A name and a valid non-negative price are required' });
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'price')
      && (req.body.price === null || req.body.price === '' || isNaN(Number(req.body.price)) || Number(req.body.price) < 0)) {
      return res.status(400).json({ error: 'A name and a valid non-negative price are required' });
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) req.body.name = req.body.name.trim();
    if (Object.prototype.hasOwnProperty.call(req.body, 'price')) req.body.price = Number(req.body.price);
    const variantError = validateProductVariantFields(req.body || {});
    if (variantError) return res.status(400).json({ error: variantError });
    // Validate variantStock against whichever colors/sizes this update
    // will end up with — the submitted colors/sizes if present, else
    // the product's existing ones (a vendor updating only stock counts
    // without touching colors/sizes on this particular request).
    const effectiveColors = Object.prototype.hasOwnProperty.call(req.body, 'colors') ? req.body.colors : existing.colors;
    const effectiveSizes = Object.prototype.hasOwnProperty.call(req.body, 'sizes') ? req.body.sizes : existing.sizes;
    const variantStockError = validateVariantStockPayload(req.body.variantStock, effectiveColors, effectiveSizes);
    if (variantStockError) return res.status(400).json({ error: variantStockError });
    let product = await db.updateProduct(req.params.id, req.body || {});
    const hasVariants = (product.colors.length || product.sizes.length);
    if (hasVariants && Array.isArray(req.body.variantStock)) {
      product = await db.setProductVariantStock(product.id, normalizeVariantStock(req.body.variantStock, product.colors, product.sizes));
    } else if (!hasVariants) {
      // Vendor cleared colors/sizes entirely on this update (or the
      // product never had them) — drop any now-orphaned variant rows.
      // Cheap no-op when there weren't any.
      await db.deleteProductVariants(product.id);
    }
    res.json({ ok: true, product });
  } catch (err) {
    console.error('PUT /api/vendor/products failed', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Used by the vendor product form (edit mode) to pre-fill the
// per-combination stock grid when opening a product that has variants.
app.get('/api/vendor/products/:id/variants', requireAuth, requireVendor, async (req, res) => {
  try {
    const existing = await db.getProductById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found' });
    if (existing.vendorId !== req.user.id) return res.status(403).json({ error: 'Not your product' });
    const variants = await db.getProductVariants(req.params.id);
    res.json({ variants });
  } catch (err) {
    console.error('GET /api/vendor/products/:id/variants failed', err);
    res.status(500).json({ error: 'Failed to load variant stock' });
  }
});

app.delete('/api/vendor/products/:id', requireAuth, requireVendor, async (req, res) => {
  try {
    const existing = await db.getProductById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found' });
    if (existing.vendorId !== req.user.id) return res.status(403).json({ error: 'Not your product' });
    await db.deleteProduct(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/vendor/products failed', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ============================================================
// Bulk CSV import/export — a vendor's own product catalog only, core
// catalog fields (name/description/category/price/stock/threshold/
// active) round-trip through CSV; colors/sizes/size chart/photos and
// real per-variant stock deliberately stay UI-only (task scope: "bulk
// CSV product import/export tools", not a full variant-matrix CSV
// format — colors have swatch photos and per-combo stock is a 2D grid,
// neither of which serializes cleanly to one row per product). Blank ID
// column creates a new product; a filled ID updates that product by id
// (ownership-checked, same as every other product route).
// ============================================================

const PRODUCT_CSV_COLUMNS = ['id', 'name', 'description', 'category', 'price', 'stockQuantity', 'lowStockThreshold', 'isActive'];
const MAX_CSV_IMPORT_ROWS = 500; // never trust an unbounded upload — same "don't trust the client" posture as every cap elsewhere in this file

// Minimal RFC4180-ish CSV field escaper — wraps in quotes and doubles
// any embedded quotes whenever the value contains a comma, quote, or
// newline; passes plain values through untouched for readability.
function csvEscapeField(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function productsToCsv(products) {
  const lines = [PRODUCT_CSV_COLUMNS.join(',')];
  for (const p of products) {
    lines.push(PRODUCT_CSV_COLUMNS.map(col => csvEscapeField(
      col === 'isActive' ? (p.isActive ? 'true' : 'false') : p[col]
    )).join(','));
  }
  return lines.join('\r\n');
}

// Minimal RFC4180-ish CSV parser — handles quoted fields (including
// embedded commas/newlines/escaped "" quotes) without pulling in a
// dependency for what's a small, fully-controlled format (we wrote the
// exporter above too, so the shapes are known). Returns an array of
// row-arrays; the caller maps the header row to column names itself.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch === '\r') {
      // swallow — paired \n (if any) handles the row break
    } else {
      field += ch;
    }
  }
  // Trailing field/row with no final newline.
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

app.get('/api/vendor/products/export.csv', requireAuth, requireVendor, async (req, res) => {
  try {
    const products = await db.getProductsByVendor(req.user.id);
    const csv = productsToCsv(products);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
    res.send(csv);
  } catch (err) {
    console.error('GET /api/vendor/products/export.csv failed', err);
    res.status(500).json({ error: 'Failed to export products' });
  }
});

app.post('/api/vendor/products/import', requireAuth, requireVendor, async (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: 'No CSV content received' });
  }
  let rows;
  try {
    rows = parseCsv(csv);
  } catch (err) {
    return res.status(400).json({ error: 'Could not parse that CSV file' });
  }
  if (rows.length === 0) return res.status(400).json({ error: 'CSV file is empty' });
  const header = rows[0].map(h => h.trim());
  const dataRows = rows.slice(1);
  if (dataRows.length === 0) return res.status(400).json({ error: 'CSV file has no data rows' });
  if (dataRows.length > MAX_CSV_IMPORT_ROWS) {
    return res.status(400).json({ error: `A single import is capped at ${MAX_CSV_IMPORT_ROWS} rows — please split this file.` });
  }
  const colIndex = {};
  header.forEach((h, i) => { colIndex[h] = i; });
  if (colIndex.name === undefined || colIndex.price === undefined) {
    return res.status(400).json({ error: 'CSV must have at least "name" and "price" columns (see the exported file for the expected format)' });
  }

  const results = [];
  let created = 0, updated = 0, errored = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i];
    const get = (col) => (colIndex[col] !== undefined && cells[colIndex[col]] !== undefined) ? cells[colIndex[col]].trim() : '';
    const rowNum = i + 2; // +1 for 0-index, +1 for the header row — matches what a vendor sees opening the file in a spreadsheet app
    try {
      const id = get('id');
      const name = get('name');
      const priceRaw = get('price');
      if (!name) throw new Error('Missing name');
      const price = Number(priceRaw);
      if (!priceRaw || isNaN(price) || price < 0) throw new Error('Invalid price');
      const stockRaw = get('stockQuantity');
      const lowStockRaw = get('lowStockThreshold');
      const isActiveRaw = get('isActive').toLowerCase();

      if (id) {
        const existing = await db.getProductById(id);
        if (!existing) throw new Error(`Product ${id} not found`);
        if (existing.vendorId !== req.user.id) throw new Error('Not your product');
        const fields = {
          name, price,
          description: get('description'),
          category: get('category'),
        };
        // Stock is derived (SUM of real per-variant rows) for a product
        // that already has colors/sizes — never let a stale CSV number
        // clobber that invariant. A plain product's stock updates
        // normally, same as the product-form edit path.
        if (!(existing.colors.length || existing.sizes.length) && stockRaw !== '') {
          const stockQuantity = parseInt(stockRaw, 10);
          if (isNaN(stockQuantity) || stockQuantity < 0) throw new Error('Invalid stockQuantity');
          fields.stockQuantity = stockQuantity;
        }
        if (lowStockRaw !== '') {
          const lowStockThreshold = parseInt(lowStockRaw, 10);
          if (isNaN(lowStockThreshold) || lowStockThreshold < 0) throw new Error('Invalid lowStockThreshold');
          fields.lowStockThreshold = lowStockThreshold;
        } else if (colIndex.lowStockThreshold !== undefined) {
          fields.lowStockThreshold = null;
        }
        if (isActiveRaw) fields.isActive = ['true', '1', 'yes'].includes(isActiveRaw);
        const product = await db.updateProduct(id, fields);
        results.push({ row: rowNum, id: product.id, name: product.name, status: 'updated' });
        updated++;
      } else {
        const stockQuantity = stockRaw !== '' ? parseInt(stockRaw, 10) : 0;
        if (stockRaw !== '' && (isNaN(stockQuantity) || stockQuantity < 0)) throw new Error('Invalid stockQuantity');
        let lowStockThreshold = null;
        if (lowStockRaw !== '') {
          lowStockThreshold = parseInt(lowStockRaw, 10);
          if (isNaN(lowStockThreshold) || lowStockThreshold < 0) throw new Error('Invalid lowStockThreshold');
        }
        const product = await db.createProduct({
          id: crypto.randomUUID(), vendorId: req.user.id, name,
          description: get('description'), category: get('category'),
          price, stockQuantity, lowStockThreshold,
        });
        results.push({ row: rowNum, id: product.id, name: product.name, status: 'created' });
        created++;
      }
    } catch (err) {
      results.push({ row: rowNum, id: cells[colIndex.id] || null, name: cells[colIndex.name] || null, status: 'error', error: err.message });
      errored++;
    }
  }
  res.json({ results, summary: { created, updated, errored, total: dataRows.length } });
});

// Follower broadcast — a vendor announces one product (a new listing or
// a sale) to everyone who follows their store. Real recipients only
// (store_follows rows), best-effort delivery per notify.js's existing
// pattern, and rate-limited to once per 24h per product (via
// followers_notified_at) so this can't be used to spam the same
// followers over and over.
const FOLLOWER_BROADCAST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
app.post('/api/vendor/products/:id/notify-followers', requireAuth, requireVendor, async (req, res) => {
  try {
    const product = await db.getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.vendorId !== req.user.id) return res.status(403).json({ error: 'Not your product' });
    if (product.followersNotifiedAt) {
      const elapsed = Date.now() - new Date(product.followersNotifiedAt).getTime();
      if (elapsed < FOLLOWER_BROADCAST_COOLDOWN_MS) {
        const hoursLeft = Math.ceil((FOLLOWER_BROADCAST_COOLDOWN_MS - elapsed) / (60 * 60 * 1000));
        return res.status(429).json({ error: `You already notified your followers about this product recently — try again in about ${hoursLeft}h.` });
      }
    }
    const followers = await db.getStoreFollowers(req.user.id);
    if (followers.length === 0) {
      return res.json({ ok: true, notifiedCount: 0 });
    }
    const vendor = await db.getUserById(req.user.id);
    let notifiedCount = 0;
    for (const follower of followers) {
      try {
        const sent = await notifyNewProductFromFollowedStore(follower, vendor, product);
        if (sent) notifiedCount += 1;
      } catch (sendErr) {
        console.error(`[follower-broadcast] Failed to notify follower ${follower.id}`, sendErr);
      }
    }
    await db.markFollowersNotified(product.id);
    res.json({ ok: true, notifiedCount, followerCount: followers.length });
  } catch (err) {
    console.error('POST /api/vendor/products/:id/notify-followers failed', err);
    res.status(500).json({ error: 'Failed to notify followers' });
  }
});

// Additional product photos (gallery) — beyond the one primary photo
// captured at creation time. Capped at 4 extra (5 total with the
// primary) so a vendor can't unintentionally balloon a single row's
// storage; each photo is size-capped the same way the primary is.
const MAX_EXTRA_PRODUCT_IMAGES = 4;

app.post('/api/vendor/products/:id/images', requireAuth, requireVendor, async (req, res) => {
  const { imageDataUrl } = req.body || {};
  if (!imageDataUrl) return res.status(400).json({ error: 'An image is required' });
  if (imageDataUrl.length > MAX_PRODUCT_IMAGE_BYTES) {
    return res.status(400).json({ error: 'Product image is too large — please use an image under ~500KB.' });
  }
  try {
    const existing = await db.getProductById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found' });
    if (existing.vendorId !== req.user.id) return res.status(403).json({ error: 'Not your product' });
    const currentCount = await db.countProductImages(req.params.id);
    if (currentCount >= MAX_EXTRA_PRODUCT_IMAGES) {
      return res.status(400).json({ error: `A product can have at most ${MAX_EXTRA_PRODUCT_IMAGES + 1} photos total (1 primary + ${MAX_EXTRA_PRODUCT_IMAGES} more).` });
    }
    const image = await db.addProductImage({ id: crypto.randomUUID(), productId: req.params.id, imageDataUrl });
    res.json({ ok: true, image });
  } catch (err) {
    console.error('POST /api/vendor/products/:id/images failed', err);
    res.status(500).json({ error: 'Failed to add photo' });
  }
});

app.delete('/api/vendor/products/:id/images/:imageId', requireAuth, requireVendor, async (req, res) => {
  try {
    const existing = await db.getProductById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found' });
    if (existing.vendorId !== req.user.id) return res.status(403).json({ error: 'Not your product' });
    const deleted = await db.deleteProductImage(req.params.imageId, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Photo not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/vendor/products/:id/images/:imageId failed', err);
    res.status(500).json({ error: 'Failed to remove photo' });
  }
});

// ============================================================
// Super Admin product moderation — until now Super Admin could only
// disable an entire vendor account, with no way to act on a single bad
// listing without taking down every other product that vendor sells.
// "Hide" (isActive=false) is the reversible default — it just removes
// the product from the storefront/deals feed (see
// getActiveProductsForStorefront's WHERE clause) without touching
// anything else about the vendor's account. "Remove" is a hard delete
// for content that shouldn't exist at all; purchase history is
// unaffected since purchase_items snapshots the product name/price and
// only SETs NULL its product_id link (see schema.sql).
// ============================================================
app.get('/api/super-admin/marketplace/products', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const products = await db.getAllProductsForModeration();
    res.json({ products });
  } catch (err) {
    console.error('GET /api/super-admin/marketplace/products failed', err);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

app.put('/api/super-admin/marketplace/products/:id/moderation', requireAuth, requireSuperAdmin, async (req, res) => {
  const { isActive } = req.body || {};
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive must be true or false' });
  }
  try {
    const existing = await db.getProductById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found' });
    const product = await db.updateProduct(req.params.id, { isActive });
    await logAudit(req, isActive ? 'product.reactivate' : 'product.hide', {
      targetType: 'product', targetId: product.id, targetLabel: product.name,
      details: { vendorId: product.vendorId },
    });
    res.json({ ok: true, product });
  } catch (err) {
    console.error('PUT /api/super-admin/marketplace/products/:id/moderation failed', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/super-admin/marketplace/products/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const existing = await db.getProductById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found' });
    await db.deleteProduct(req.params.id);
    await logAudit(req, 'product.remove', {
      targetType: 'product', targetId: existing.id, targetLabel: existing.name,
      details: { vendorId: existing.vendorId },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/super-admin/marketplace/products/:id failed', err);
    res.status(500).json({ error: 'Failed to remove product' });
  }
});

// ============================================================
// Storefront home-screen hero carousel — Super Admin manages up to 3
// slides; the public endpoint below is what the customer storefront
// actually renders (falls back to a single hardcoded slide client-side
// when this returns none — see loadHomeBanners() in index.html).
// ============================================================
const MAX_HOME_BANNERS = 3;

app.get('/api/super-admin/marketplace/home-banners', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const banners = await db.getAllHomeBanners();
    res.json({ banners });
  } catch (err) {
    console.error('GET /api/super-admin/marketplace/home-banners failed', err);
    res.status(500).json({ error: 'Failed to load banners' });
  }
});

app.post('/api/super-admin/marketplace/home-banners', requireAuth, requireSuperAdmin, async (req, res) => {
  const { eyebrow, headline, subtext, ctaText, ctaLink, imageDataUrl } = req.body || {};
  if (!headline || !headline.trim()) {
    return res.status(400).json({ error: 'A headline is required' });
  }
  if (imageDataUrl && imageDataUrl.length > MAX_PRODUCT_IMAGE_BYTES) {
    return res.status(400).json({ error: 'Banner image is too large — please use an image under ~500KB.' });
  }
  try {
    const count = await db.countHomeBanners();
    if (count >= MAX_HOME_BANNERS) {
      return res.status(400).json({ error: `You can have at most ${MAX_HOME_BANNERS} banner slides. Remove one before adding another.` });
    }
    const banner = await db.createHomeBanner({
      id: crypto.randomUUID(), eyebrow, headline: headline.trim(), subtext, ctaText, ctaLink, imageDataUrl,
    });
    await logAudit(req, 'banner.create', { targetType: 'home_banner', targetId: banner.id, targetLabel: banner.headline });
    res.json({ ok: true, banner });
  } catch (err) {
    console.error('POST /api/super-admin/marketplace/home-banners failed', err);
    res.status(500).json({ error: 'Failed to create banner' });
  }
});

app.put('/api/super-admin/marketplace/home-banners/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const { eyebrow, headline, subtext, ctaText, ctaLink, imageDataUrl, isActive } = req.body || {};
  if (headline !== undefined && !headline.trim()) {
    return res.status(400).json({ error: 'Headline cannot be empty' });
  }
  if (imageDataUrl && imageDataUrl.length > MAX_PRODUCT_IMAGE_BYTES) {
    return res.status(400).json({ error: 'Banner image is too large — please use an image under ~500KB.' });
  }
  try {
    const existing = await db.getHomeBannerById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Banner not found' });
    const fields = {};
    if (eyebrow !== undefined) fields.eyebrow = eyebrow;
    if (headline !== undefined) fields.headline = headline.trim();
    if (subtext !== undefined) fields.subtext = subtext;
    if (ctaText !== undefined) fields.ctaText = ctaText;
    if (ctaLink !== undefined) fields.ctaLink = ctaLink;
    if (imageDataUrl !== undefined) fields.imageDataUrl = imageDataUrl;
    if (isActive !== undefined) fields.isActive = !!isActive;
    const banner = await db.updateHomeBanner(req.params.id, fields);
    await logAudit(req, 'banner.update', { targetType: 'home_banner', targetId: banner.id, targetLabel: banner.headline });
    res.json({ ok: true, banner });
  } catch (err) {
    console.error('PUT /api/super-admin/marketplace/home-banners/:id failed', err);
    res.status(500).json({ error: 'Failed to update banner' });
  }
});

app.put('/api/super-admin/marketplace/home-banners/:id/move', requireAuth, requireSuperAdmin, async (req, res) => {
  const { direction } = req.body || {};
  if (direction !== 'up' && direction !== 'down') {
    return res.status(400).json({ error: 'direction must be "up" or "down"' });
  }
  try {
    const existing = await db.getHomeBannerById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Banner not found' });
    const banners = await db.moveHomeBanner(req.params.id, direction);
    res.json({ ok: true, banners });
  } catch (err) {
    console.error('PUT /api/super-admin/marketplace/home-banners/:id/move failed', err);
    res.status(500).json({ error: 'Failed to reorder banners' });
  }
});

app.delete('/api/super-admin/marketplace/home-banners/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const existing = await db.getHomeBannerById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Banner not found' });
    await db.deleteHomeBanner(req.params.id);
    await logAudit(req, 'banner.remove', { targetType: 'home_banner', targetId: existing.id, targetLabel: existing.headline });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/super-admin/marketplace/home-banners/:id failed', err);
    res.status(500).json({ error: 'Failed to remove banner' });
  }
});

// Public — no requireAuth. Empty result is a valid, expected response
// (fresh install / every slide removed) — the storefront falls back to
// its own hardcoded default slide in that case rather than treating it
// as an error.
app.get('/api/marketplace/home-banners', async (req, res) => {
  try {
    const banners = await db.getActiveHomeBanners();
    res.json({ banners });
  } catch (err) {
    console.error('GET /api/marketplace/home-banners failed', err);
    res.status(500).json({ error: 'Failed to load banners' });
  }
});

app.get('/api/vendor/sales-overview', requireAuth, requireVendor, async (req, res) => {
  try {
    const overview = await db.getVendorSalesOverview(req.user.id, 30);
    res.json(overview);
  } catch (err) {
    console.error('GET /api/vendor/sales-overview failed', err);
    res.status(500).json({ error: 'Failed to load sales overview' });
  }
});

app.get('/api/vendor/daily-sales', requireAuth, requireVendor, async (req, res) => {
  try {
    const days = await db.getVendorDailySales(req.user.id, 30);
    res.json({ days });
  } catch (err) {
    console.error('GET /api/vendor/daily-sales failed', err);
    res.status(500).json({ error: 'Failed to load sales chart' });
  }
});

// ============================================================
// Delivery Company (multi-provider) — a company's own dashboard.
// Every route below is scoped to req.user.id, mirroring the vendor
// pattern: a company can only ever see and manage its own fleet and
// orders, never another company's.
// ============================================================
app.get('/api/delivery-company/agents', requireAuth, requireDeliveryCompany, async (req, res) => {
  try {
    const agents = await db.getAgentsByCompany(req.user.id);
    res.json({ agents });
  } catch (err) {
    console.error('GET /api/delivery-company/agents failed', err);
    res.status(500).json({ error: 'Failed to load fleet' });
  }
});

app.get('/api/delivery-company/orders', requireAuth, requireDeliveryCompany, async (req, res) => {
  try {
    const orders = await db.getOrdersByCompany(req.user.id);
    res.json({ orders });
  } catch (err) {
    console.error('GET /api/delivery-company/orders failed', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

app.get('/api/delivery-company/pending-orders', requireAuth, requireDeliveryCompany, async (req, res) => {
  try {
    const orders = await db.getPendingOrders();
    res.json({ orders });
  } catch (err) {
    console.error('GET /api/delivery-company/pending-orders failed', err);
    res.status(500).json({ error: 'Failed to load pending orders' });
  }
});

app.get('/api/delivery-company/overview', requireAuth, requireDeliveryCompany, async (req, res) => {
  try {
    const [agents, orders] = await Promise.all([
      db.getAgentsByCompany(req.user.id),
      db.getOrdersByCompany(req.user.id),
    ]);
    const deliveredOrders = orders.filter(o => o.status === 'delivered');
    res.json({
      totalAgents: agents.length,
      onDutyAgents: agents.filter(a => a.dutyStatus === 'on_duty').length,
      totalOrders: orders.length,
      deliveredOrders: deliveredOrders.length,
      totalRevenue: deliveredOrders.reduce((sum, o) => sum + (o.amount || 0), 0),
    });
  } catch (err) {
    console.error('GET /api/delivery-company/overview failed', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

// Real, read-only dispute visibility for a delivery company — every
// dispute tied to one of its own deliveries (d.order_id). Mirrors
// GET /api/vendor/disputes above: before this, a delivery company had
// no way to know a dispute even happened, only a quieter lower payout
// once Super Admin resolved it with a refund. No resolution route
// here — only Super Admin can decide/refund a dispute; this is
// view-only.
app.get('/api/delivery-company/disputes', requireAuth, requireDeliveryCompany, async (req, res) => {
  try {
    const status = ['open', 'resolved', 'rejected'].includes(req.query.status) ? req.query.status : undefined;
    const disputes = await db.getDisputesForDeliveryCompany(req.user.id, { status });
    res.json({ disputes });
  } catch (err) {
    console.error('GET /api/delivery-company/disputes failed', err);
    res.status(500).json({ error: 'Failed to load disputes' });
  }
});


app.get('/api/vendor/purchases', requireAuth, requireVendor, async (req, res) => {
  try {
    const purchases = await db.getPurchasesByVendor(req.user.id);
    res.json({ purchases });
  } catch (err) {
    console.error('GET /api/vendor/purchases failed', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// The same approved-company list the Fleet Directory "Add Agent"
// picker already uses — a vendor just needs to know who's available to
// dispatch to, same list, same eligibility (approved, not disabled).
app.get('/api/vendor/delivery-companies', requireAuth, requireVendor, async (req, res) => {
  try {
    const deliveryCompanies = await db.getActiveDeliveryCompaniesForFleetPicker();
    res.json({ deliveryCompanies });
  } catch (err) {
    console.error('GET /api/vendor/delivery-companies failed', err);
    res.status(500).json({ error: 'Failed to load delivery companies' });
  }
});

// Vendor dispatches a ready order to a specific delivery company — a
// preference/highlight, not exclusive: the order stays in the open
// pending-orders pool too (see schema.sql's comment on orders.
// requested_delivery_company_id), so a company that doesn't respond
// never blocks the order from being picked up some other way.
app.post('/api/vendor/orders/:id/dispatch', requireAuth, requireVendor, async (req, res) => {
  const { deliveryCompanyId } = req.body || {};
  if (!deliveryCompanyId) return res.status(400).json({ error: 'A delivery company is required' });
  try {
    const eligible = await db.getActiveDeliveryCompaniesForFleetPicker();
    if (!eligible.some(c => c.id === deliveryCompanyId)) {
      return res.status(400).json({ error: 'That delivery company is not available' });
    }
    const order = await db.dispatchOrderToDeliveryCompany(req.params.id, req.user.id, deliveryCompanyId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found, not yours, or already accepted' });
    }
    // "admins" gets the normal order:updated everyone else already
    // listens for; the targeted company gets its own room too, so its
    // dashboard can highlight "Requested for you" without every other
    // delivery company's UI needing to guess from the same broadcast.
    orderRooms(order).forEach(r => io.to(r).emit('order:updated', order));
    io.to(`delivery-company:${deliveryCompanyId}`).emit('order:dispatch-requested', order);
    res.json({ ok: true, order });
  } catch (err) {
    console.error('POST /api/vendor/orders/:id/dispatch failed', err);
    res.status(500).json({ error: 'Failed to dispatch order' });
  }
});

// Vendor requests cancellation of their own not-yet-confirmed Mobile
// Money purchase — see schema.sql's comment on vendor_cancel_requested.
// This does NOT change payment_status or delete anything; it's a flag
// the Super Admin sees on the exact same confirm/reject queue that
// already exists (GET /api/super-admin/marketplace-payments/pending),
// where Reject already does what "approve the cancellation" needs.
app.post('/api/vendor/purchases/:id/request-cancel', requireAuth, requireVendor, async (req, res) => {
  const { reason } = req.body || {};
  try {
    const purchase = await db.requestVendorPurchaseCancellation(req.params.id, req.user.id, reason);
    if (!purchase) {
      return res.status(404).json({ error: 'Order not found, not yours, or no longer eligible for cancellation (already confirmed or rejected)' });
    }
    // Reuses the existing "a Mobile Money payment needs your attention"
    // live event/badge (see updateMarketplacePaymentsBadges client-
    // side) — a cancellation request is exactly that: something in the
    // queue changed and a Super Admin should look. `kind` lets the
    // client's bell notification say "cancellation" instead of the
    // generic "new payment" wording the other two emit sites use.
    io.to('admins').emit('marketplace_payment:new', { purchaseId: purchase.id, kind: 'cancel_request' });
    res.json({ ok: true, purchase });
  } catch (err) {
    console.error('POST /api/vendor/purchases/:id/request-cancel failed', err);
    res.status(500).json({ error: 'Failed to request cancellation' });
  }
});

// Vendor-initiated "please void this order's revenue" request — e.g.
// a customer sent the item back and it shouldn't count toward this
// vendor's (or the platform's) revenue anymore. This does NOT delete
// or void anything by itself: it only opens a dispute in the SAME
// queue Super Admin already reviews customer complaints in (see
// PUT /api/super-admin/disputes/:id/resolve's 'void' decision above),
// distinguished from an ordinary complaint by initiated_by/vendor_id.
// Ownership is verified server-side, and a second open request
// against the same purchase is blocked — same reasoning as the
// alreadyOpen check in POST /api/disputes below.
app.post('/api/vendor/purchases/:id/request-deletion', requireAuth, requireVendor, async (req, res) => {
  const { reason } = req.body || {};
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'Please explain why this order should be voided' });
  }
  try {
    const purchase = await db.getPurchaseById(req.params.id);
    if (!purchase || purchase.vendorId !== req.user.id) return res.status(404).json({ error: 'Order not found' });
    if (purchase.excludedFromRevenue) return res.status(409).json({ error: 'This order has already been voided' });
    const existing = await db.getDisputesForVendor(req.user.id);
    const alreadyOpen = existing.some(d => d.status === 'open' && d.purchaseId === purchase.id);
    if (alreadyOpen) return res.status(409).json({ error: 'There is already an open request for this order' });
    const dispute = await db.createDispute({
      id: crypto.randomUUID(),
      purchaseId: purchase.id,
      customerId: purchase.customerId,
      category: 'vendor_return',
      description: reason.trim(),
      initiatedBy: 'vendor',
      vendorId: req.user.id,
    });
    await logAudit(req, 'purchase.request-deletion', {
      targetType: 'purchase', targetId: purchase.id, targetLabel: purchase.id,
      details: { reason: reason.trim() },
    });
    // Same live "dispute:new" signal a customer's own complaint gets
    // (see POST /api/disputes above) — this is folded into the exact
    // same queue, so it should notify Super Admin the exact same way.
    io.to('admins').emit('dispute:new', dispute);
    res.json({ ok: true, dispute });
  } catch (err) {
    console.error('POST /api/vendor/purchases/:id/request-deletion failed', err);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// Vendor dismisses an already-rejected Mobile Money purchase from
// their own Orders view/stats — see schema.sql's comment on
// vendor_dismissed. No admin round-trip: the payment decision (reject)
// already happened, this only affects what the vendor sees.
app.post('/api/vendor/purchases/:id/dismiss', requireAuth, requireVendor, async (req, res) => {
  try {
    const purchase = await db.dismissVendorPurchase(req.params.id, req.user.id);
    if (!purchase) {
      return res.status(404).json({ error: 'Order not found, not yours, or not a rejected payment' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/vendor/purchases/:id/dismiss failed', err);
    res.status(500).json({ error: 'Failed to remove order' });
  }
});


// Every purchase this vendor has ever received, unbounded — feeds the
// vendor's own Monthly Report PDF (see generateVendorMonthlyReportPDF
// client-side), which needs a real month's worth of data, not just the
// most recent 50 the Orders tab list uses.
app.get('/api/vendor/purchases/report', requireAuth, requireVendor, async (req, res) => {
  try {
    const purchases = await db.getAllPurchasesByVendor(req.user.id);
    res.json({ purchases });
  } catch (err) {
    console.error('GET /api/vendor/purchases/report failed', err);
    res.status(500).json({ error: 'Failed to load report data' });
  }
});

// Every purchase across the whole platform, unbounded — feeds Super
// Admin's Platform Report PDF (see generatePlatformReportPDF
// client-side), which combines this with the already-loaded delivery
// `orders` array to cover the full business, not just Delivery.
app.get('/api/super-admin/purchases/report', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const purchases = await db.getAllPurchases();
    res.json({ purchases });
  } catch (err) {
    console.error('GET /api/super-admin/purchases/report failed', err);
    res.status(500).json({ error: 'Failed to load report data' });
  }
});

// Real customer-facing purchase history — what a customer actually
// bought on the marketplace, with real product images and real
// delivery status, distinct from the Delivery-side raw order list.
app.get('/api/marketplace/my-purchases', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers have purchase history' });
  try {
    const purchases = await db.getPurchasesByCustomer(req.user.id);
    res.json({ purchases });
  } catch (err) {
    console.error('GET /api/marketplace/my-purchases failed', err);
    res.status(500).json({ error: 'Failed to load purchase history' });
  }
});

// A customer reporting a problem with a delivery order or a
// marketplace purchase — see the disputes table comment in
// schema.sql for why it's one-or-the-other. Ownership is verified
// server-side (not just trusted from the client) before a dispute can
// be filed, and a second open dispute against the same order/purchase
// is blocked so the Super Admin queue doesn't fill up with duplicates
// for one problem.
app.post('/api/disputes', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers can report a problem' });
  const { orderId, purchaseId, category, description } = req.body || {};
  if (!orderId && !purchaseId) return res.status(400).json({ error: 'orderId or purchaseId is required' });
  if (!description || !description.trim()) return res.status(400).json({ error: 'Please describe the problem' });
  const finalCategory = DISPUTE_CATEGORIES.includes(category) ? category : 'other';
  try {
    if (orderId) {
      const order = await db.getOrder(orderId);
      if (!order || order.senderId !== req.user.id) return res.status(404).json({ error: 'Order not found' });
    }
    if (purchaseId) {
      const purchase = await db.getPurchaseById(purchaseId);
      if (!purchase || purchase.customerId !== req.user.id) return res.status(404).json({ error: 'Purchase not found' });
    }
    const existing = await db.getDisputesForCustomer(req.user.id);
    const alreadyOpen = existing.some(d => d.status === 'open'
      && ((orderId && d.orderId === orderId) || (purchaseId && d.purchaseId === purchaseId)));
    if (alreadyOpen) return res.status(409).json({ error: 'You already have an open dispute for this order' });
    const dispute = await db.createDispute({
      id: crypto.randomUUID(),
      orderId: orderId || null,
      purchaseId: purchaseId || null,
      customerId: req.user.id,
      category: finalCategory,
      description: description.trim(),
    });
    // Live-notify every connected Super Admin the same instant a
    // customer files a complaint — previously this queue only updated
    // whenever someone happened to open the Disputes modal. See the
    // client's socket.on('dispute:new', ...) for the bell/notification-
    // center side of this.
    io.to('admins').emit('dispute:new', dispute);
    res.json({ ok: true, dispute });
  } catch (err) {
    console.error('POST /api/disputes failed', err);
    res.status(500).json({ error: 'Failed to submit dispute' });
  }
});

// A customer's own dispute history/status — including anything
// already resolved, so they can see the outcome and any refund note.
app.get('/api/disputes/mine', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers have disputes' });
  try {
    const disputes = await db.getDisputesForCustomer(req.user.id);
    res.json({ disputes });
  } catch (err) {
    console.error('GET /api/disputes/mine failed', err);
    res.status(500).json({ error: 'Failed to load your disputes' });
  }
});

// ============================================================
// Self-service returns — distinct from disputes (see schema.sql):
// a customer requests directly, the vendor decides directly, no
// Super Admin step. Refund is recorded the same way disputes.
// refund_amount already is — a bookkeeping entry, not a real payment
// reversal (no card/refund-capable gateway is integrated yet).
// ============================================================

// Customer requests a return on one of their own delivered purchases.
app.post('/api/returns', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers can request a return' });
  const { purchaseId, reason, description } = req.body || {};
  if (!purchaseId) return res.status(400).json({ error: 'purchaseId is required' });
  const finalReason = RETURN_REASONS.includes(reason) ? reason : 'other';
  try {
    const purchase = await db.getPurchaseById(purchaseId);
    if (!purchase || purchase.customerId !== req.user.id) return res.status(404).json({ error: 'Purchase not found' });
    // A voided purchase (excludedFromRevenue, set via Super Admin dispute
    // resolution) is already settled outside the normal order lifecycle —
    // same reasoning as the vendor-side dispatch/deletion-request guards
    // (see canDispatch/canRequestDeletion in index.html), just never
    // applied to returns. Checked server-side too, not just hiding the
    // button, since the client-only check alone can always be bypassed by
    // a direct API call.
    if (purchase.excludedFromRevenue) {
      return res.status(400).json({ error: 'This purchase has already been voided and is not eligible for a return' });
    }
    if (purchase.deliveryOrderId) {
      const order = await db.getOrder(purchase.deliveryOrderId);
      if (!order || order.status !== 'delivered') {
        return res.status(400).json({ error: 'This purchase has not been delivered yet' });
      }
    }
    const existing = await db.getReturnRequestByPurchase(purchaseId);
    if (existing) return res.status(409).json({ error: 'A return has already been requested for this purchase' });
    const returnRequest = await db.createReturnRequest({
      id: crypto.randomUUID(),
      purchaseId,
      customerId: req.user.id,
      vendorId: purchase.vendorId,
      reason: finalReason,
      description: description && description.trim() ? description.trim() : null,
    });
    res.json({ ok: true, returnRequest });
  } catch (err) {
    console.error('POST /api/returns failed', err);
    res.status(500).json({ error: 'Failed to submit return request' });
  }
});

// Customer's own return history/status.
app.get('/api/returns/mine', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers have returns' });
  try {
    const returnRequests = await db.getReturnRequestsForCustomer(req.user.id);
    res.json({ returnRequests });
  } catch (err) {
    console.error('GET /api/returns/mine failed', err);
    res.status(500).json({ error: 'Failed to load your returns' });
  }
});

// Vendor's own review queue.
app.get('/api/vendor/returns', requireAuth, requireVendor, async (req, res) => {
  try {
    const status = ['requested', 'approved', 'rejected', 'refunded'].includes(req.query.status) ? req.query.status : undefined;
    const returnRequests = await db.getReturnRequestsForVendor(req.user.id, { status });
    res.json({ returnRequests });
  } catch (err) {
    console.error('GET /api/vendor/returns failed', err);
    res.status(500).json({ error: 'Failed to load returns' });
  }
});

// Vendor decides: approve or reject a requested return.
app.put('/api/vendor/returns/:id/decision', requireAuth, requireVendor, async (req, res) => {
  const { status, vendorNote } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected' });
  try {
    const existing = await db.getReturnRequestById(req.params.id);
    if (!existing || existing.vendorId !== req.user.id) return res.status(404).json({ error: 'Return request not found' });
    const updated = await db.resolveReturnRequest(req.params.id, { status, vendorNote: vendorNote || null });
    if (!updated) return res.status(409).json({ error: 'This return was already decided' });
    res.json({ ok: true, returnRequest: updated });
  } catch (err) {
    console.error('PUT /api/vendor/returns/:id/decision failed', err);
    res.status(500).json({ error: 'Failed to update return request' });
  }
});

// Vendor confirms a refund actually happened for an already-approved
// return — a real bookkeeping record, same caveat as dispute refunds.
app.put('/api/vendor/returns/:id/refund', requireAuth, requireVendor, async (req, res) => {
  const { refundAmount } = req.body || {};
  const numRefund = Number(refundAmount);
  if (!Number.isFinite(numRefund) || numRefund <= 0) return res.status(400).json({ error: 'refundAmount must be a positive number' });
  try {
    const existing = await db.getReturnRequestById(req.params.id);
    if (!existing || existing.vendorId !== req.user.id) return res.status(404).json({ error: 'Return request not found' });
    const updated = await db.resolveReturnRequest(req.params.id, { status: 'refunded', vendorNote: existing.vendorNote, refundAmount: numRefund });
    if (!updated) return res.status(409).json({ error: 'This return must be approved before it can be marked refunded' });
    res.json({ ok: true, returnRequest: updated });
  } catch (err) {
    console.error('PUT /api/vendor/returns/:id/refund failed', err);
    res.status(500).json({ error: 'Failed to record refund' });
  }
});

// "Rate your delivery" — a star rating for the real agent who
// delivered this order, plus an optional tip. Only the order's own
// sender, only once the order is actually delivered, and only when a
// real agent is linked (agent_id — see schema.sql; an order accepted
// before that column existed has nothing to rate). One rating per
// order, enforced by both this check and the UNIQUE(order_id)
// constraint underneath it.
app.post('/api/orders/:id/rate', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers can rate a delivery' });
  const { rating, comment, tipAmount } = req.body || {};
  const numRating = Number(rating);
  if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
    return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5' });
  }
  let numTip = null;
  if (tipAmount !== undefined && tipAmount !== null && tipAmount !== '') {
    numTip = Number(tipAmount);
    if (!Number.isFinite(numTip) || numTip < 0) return res.status(400).json({ error: 'Tip must be a positive amount' });
  }
  try {
    const order = await db.getOrder(req.params.id);
    if (!order || order.senderId !== req.user.id) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'delivered') return res.status(400).json({ error: 'This order has not been delivered yet' });
    if (!order.agentId) return res.status(400).json({ error: 'This delivery has no agent on file to rate' });
    const existing = await db.getAgentReviewForOrder(order.id);
    if (existing) return res.status(409).json({ error: 'You already rated this delivery' });
    const review = await db.rateDelivery({
      id: crypto.randomUUID(),
      orderId: order.id,
      agentId: order.agentId,
      customerId: req.user.id,
      rating: numRating,
      comment: comment && comment.trim() ? comment.trim() : null,
      tipAmount: numTip,
    });
    res.json({ ok: true, review });
  } catch (err) {
    console.error('POST /api/orders/:id/rate failed', err);
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

// Real customers — who has actually bought from this vendor, derived
// from purchase records. Not a "leads" concept (no such data exists).
app.get('/api/vendor/customers', requireAuth, requireVendor, async (req, res) => {
  try {
    const customers = await db.getVendorCustomers(req.user.id);
    res.json({ customers });
  } catch (err) {
    console.error('GET /api/vendor/customers failed', err);
    res.status(500).json({ error: 'Failed to load customers' });
  }
});

// Real, read-only dispute visibility for a vendor — every dispute tied
// to one of their own purchases. Before this, a vendor had no way to
// know a dispute even happened, only a quieter lower payout once Super
// Admin resolved it with a refund. No resolution route here — only
// Super Admin can decide/refund a dispute (see PUT
// /api/super-admin/disputes/:id/resolve above); this is view-only.
app.get('/api/vendor/disputes', requireAuth, requireVendor, async (req, res) => {
  try {
    const status = ['open', 'resolved', 'rejected'].includes(req.query.status) ? req.query.status : undefined;
    const disputes = await db.getDisputesForVendor(req.user.id, { status });
    res.json({ disputes });
  } catch (err) {
    console.error('GET /api/vendor/disputes failed', err);
    res.status(500).json({ error: 'Failed to load disputes' });
  }
});

// Real order-status breakdown — used for the dashboard's donut chart in
// place of the mockup's "Sales by Channel" (no traffic-source tracking
// exists in this app; status IS real, tracked data).
app.get('/api/vendor/order-status-breakdown', requireAuth, requireVendor, async (req, res) => {
  try {
    const breakdown = await db.getVendorOrderStatusBreakdown(req.user.id);
    res.json({ breakdown });
  } catch (err) {
    console.error('GET /api/vendor/order-status-breakdown failed', err);
    res.status(500).json({ error: 'Failed to load order status breakdown' });
  }
});

// ============================================================
// Marketplace — customer storefront + checkout
// ============================================================

// Public — no requireAuth. The marketplace homepage is the default
// landing page for guests, so browsing must work with no login at all.
// Checkout still requires a real sender account (checked below).
app.get('/api/marketplace/products', async (req, res) => {
  try {
    const products = await db.getActiveProductsForStorefront();
    res.json({ products });
  } catch (err) {
    console.error('GET /api/marketplace/products failed', err);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

// Public — real active deals feed (products with a currently-active
// promotion). No fake discounts here; if nothing's on sale, it's empty.
app.get('/api/marketplace/deals', async (req, res) => {
  try {
    const products = await db.getActiveDeals();
    res.json({ products });
  } catch (err) {
    console.error('GET /api/marketplace/deals failed', err);
    res.status(500).json({ error: 'Failed to load deals' });
  }
});

// Public — the Stores tab, real vendor list with real aggregate ratings.
app.get('/api/marketplace/stores', async (req, res) => {
  try {
    const stores = await db.getStorefrontVendors();
    res.json({ stores });
  } catch (err) {
    console.error('GET /api/marketplace/stores failed', err);
    res.status(500).json({ error: 'Failed to load stores' });
  }
});

// Public — Popular Restaurants, same real-data pattern as
// /api/marketplace/stores above, scoped to vendor_type = 'restaurant'.
app.get('/api/marketplace/restaurants', async (req, res) => {
  try {
    const restaurants = await db.getPopularRestaurants();
    res.json({ restaurants });
  } catch (err) {
    console.error('GET /api/marketplace/restaurants failed', err);
    res.status(500).json({ error: 'Failed to load restaurants' });
  }
});

// ONLib Delivery only — a restaurant's dishes. Deliberately not part of
// /api/marketplace/products (which now excludes restaurants entirely)
// so restaurant menus can never surface in Marketplace browsing/search.
app.get('/api/marketplace/restaurants/:id/menu', async (req, res) => {
  try {
    const dishes = await db.getRestaurantMenu(req.params.id);
    res.json({ dishes });
  } catch (err) {
    console.error('GET /api/marketplace/restaurants/:id/menu failed', err);
    res.status(500).json({ error: 'Failed to load menu' });
  }
});

app.get('/api/marketplace/products/:id/reviews', async (req, res) => {
  try {
    const reviews = await db.getProductReviews(req.params.id);
    res.json({ reviews });
  } catch (err) {
    console.error('GET /api/marketplace/products/:id/reviews failed', err);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

// Only a customer who actually bought this product can review it —
// verified server-side, not just hidden in the UI.
app.post('/api/marketplace/products/:id/reviews', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') {
    return res.status(403).json({ error: 'Only customers can leave reviews' });
  }
  const { rating, comment } = req.body || {};
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'A rating from 1 to 5 is required' });
  }
  try {
    const purchased = await db.hasCustomerPurchasedProduct(req.user.id, req.params.id);
    if (!purchased) {
      return res.status(403).json({ error: 'You can only review products you have purchased' });
    }
    const review = await db.upsertProductReview({
      id: crypto.randomUUID(), productId: req.params.id, customerId: req.user.id, rating, comment,
    });
    res.json({ ok: true, review });
  } catch (err) {
    console.error('POST reviews failed', err);
    res.status(500).json({ error: 'Failed to save review' });
  }
});

// Real per-vendor Marketplace storefront page ("Visit Store") — public,
// combines the vendor's public profile (with real follower/rating/
// listing-count aggregates, never fabricated) and their full active
// product grid in one call, so the Stores directory cards and PDP
// vendor pill (both of which already know the vendorId) have one real
// destination to route to instead of a generic, unscoped Stores tab.
app.get('/api/marketplace/vendors/:id/storefront', async (req, res) => {
  try {
    const profile = await db.getVendorStorefrontProfile(req.params.id);
    if (!profile || profile.vendorType !== 'store') {
      return res.status(404).json({ error: 'Store not found' });
    }
    const products = await db.getVendorStorefrontProducts(req.params.id);
    res.json({ vendor: profile, products });
  } catch (err) {
    console.error('GET /api/marketplace/vendors/:id/storefront failed', err);
    res.status(500).json({ error: 'Failed to load store' });
  }
});

// Vendor-level reviews (rating the store/restaurant as a whole, not one
// product) — same verified-purchase gate as product reviews above, just
// checked against purchases.vendor_id instead of a specific product.
app.get('/api/marketplace/vendors/:id/reviews', async (req, res) => {
  try {
    const reviews = await db.getVendorReviews(req.params.id);
    res.json({ reviews });
  } catch (err) {
    console.error('GET /api/marketplace/vendors/:id/reviews failed', err);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

app.post('/api/marketplace/vendors/:id/reviews', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') {
    return res.status(403).json({ error: 'Only customers can leave reviews' });
  }
  const { rating, comment } = req.body || {};
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'A rating from 1 to 5 is required' });
  }
  try {
    const purchased = await db.hasCustomerPurchasedFromVendor(req.user.id, req.params.id);
    if (!purchased) {
      return res.status(403).json({ error: 'You can only review a store or restaurant you have ordered from' });
    }
    const review = await db.upsertVendorReview({
      id: crypto.randomUUID(), vendorId: req.params.id, customerId: req.user.id, rating, comment,
    });
    res.json({ ok: true, review });
  } catch (err) {
    console.error('POST vendor reviews failed', err);
    res.status(500).json({ error: 'Failed to save review' });
  }
});

// ============================================================
// Product Q&A — any logged-in customer can ask, only the product's own
// vendor can answer (see db.answerProductQuestion's ownership-checked
// UPDATE). Unlike reviews, asking isn't gated on having purchased —
// matches how this kind of pre-purchase Q&A normally works.
// ============================================================

app.get('/api/marketplace/products/:id/qna', async (req, res) => {
  try {
    const questions = await db.getProductQuestions(req.params.id);
    res.json({ questions });
  } catch (err) {
    console.error('GET /api/marketplace/products/:id/qna failed', err);
    res.status(500).json({ error: 'Failed to load questions' });
  }
});

app.post('/api/marketplace/products/:id/qna', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') {
    return res.status(403).json({ error: 'Only customers can ask questions' });
  }
  const { question } = req.body || {};
  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'A question is required' });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: 'Keep questions under 500 characters' });
  }
  try {
    const product = await db.getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const created = await db.createProductQuestion({
      id: crypto.randomUUID(), productId: req.params.id, askerId: req.user.id,
      askerName: req.user.businessName, question: question.trim(),
    });
    res.json({ ok: true, question: created });
  } catch (err) {
    console.error('POST /api/marketplace/products/:id/qna failed', err);
    res.status(500).json({ error: 'Failed to submit question' });
  }
});

app.post('/api/vendor/products/:id/qna/:questionId/answer', requireAuth, requireVendor, async (req, res) => {
  const { answer } = req.body || {};
  if (!answer || !answer.trim()) {
    return res.status(400).json({ error: 'An answer is required' });
  }
  if (answer.length > 1000) {
    return res.status(400).json({ error: 'Keep answers under 1000 characters' });
  }
  try {
    // db.answerProductQuestion's UPDATE already scopes on product.vendor_id
    // = this vendor, so a null result here covers both "question doesn't
    // exist" and "it's not yours" — same 404-not-403 pattern already used
    // for products (e.g. GET /reviews) to avoid confirming what exists.
    const updated = await db.answerProductQuestion(req.params.questionId, req.user.id, answer.trim());
    if (!updated) return res.status(404).json({ error: 'Question not found' });
    res.json({ ok: true, question: updated });
  } catch (err) {
    console.error('POST .../qna/:questionId/answer failed', err);
    res.status(500).json({ error: 'Failed to save answer' });
  }
});

// Public — "Recommended by this store" on the product detail page. A
// real backend query rather than filtering the client's already-loaded
// storefront list, since that list isn't guaranteed loaded yet if a
// customer reaches a product page from Wishlist/Deals without visiting
// Home first (see db.getRelatedVendorProducts's comment).
app.get('/api/marketplace/products/:id/related', async (req, res) => {
  try {
    const product = await db.getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const products = await db.getRelatedVendorProducts(product.vendorId, product.id, 8);
    res.json({ products });
  } catch (err) {
    console.error('GET /api/marketplace/products/:id/related failed', err);
    res.status(500).json({ error: 'Failed to load recommended products' });
  }
});

// Real "customers who bought this also bought" — see
// db.getCoPurchasedProducts for the actual purchase_items query. Public,
// same as /related above, since the PDP itself is public.
app.get('/api/marketplace/products/:id/co-purchased', async (req, res) => {
  try {
    const product = await db.getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const products = await db.getCoPurchasedProducts(product.id, 8);
    res.json({ products });
  } catch (err) {
    console.error('GET /api/marketplace/products/:id/co-purchased failed', err);
    res.status(500).json({ error: 'Failed to load co-purchased products' });
  }
});

// Real per-variant stock counts, public (same reasoning as /related and
// /co-purchased above — the PDP itself is public, and stock numbers are
// already shown to anyone viewing a product). The PDP fetches this once,
// on open, for any product that declares colors/sizes, so it can enforce
// the correct per-combination stock instead of the pooled total once a
// customer actually picks a color/size. Empty array for a product with
// no variant rows (a plain pooled-stock product).
app.get('/api/marketplace/products/:id/variant-stock', async (req, res) => {
  try {
    const variants = await db.getProductVariants(req.params.id);
    res.json({ variants });
  } catch (err) {
    console.error('GET /api/marketplace/products/:id/variant-stock failed', err);
    res.status(500).json({ error: 'Failed to load stock' });
  }
});

// ============================================================
// Wishlist — real, customer-only (senders). Vendors previewing the
// marketplace "as customer" don't get a wishlist of their own here,
// same restriction as leaving a review.
// ============================================================
app.get('/api/wishlist', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers have a wishlist' });
  try {
    const products = await db.getWishlist(req.user.id);
    res.json({ products });
  } catch (err) {
    console.error('GET /api/wishlist failed', err);
    res.status(500).json({ error: 'Failed to load wishlist' });
  }
});

// Just the ids — cheap enough to fetch once when the marketplace loads
// so every product card/PDP can show the right heart state.
app.get('/api/wishlist/ids', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.json({ productIds: [] });
  try {
    const productIds = await db.getWishlistProductIds(req.user.id);
    res.json({ productIds });
  } catch (err) {
    console.error('GET /api/wishlist/ids failed', err);
    res.status(500).json({ error: 'Failed to load wishlist' });
  }
});

app.post('/api/wishlist/:productId', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers have a wishlist' });
  try {
    await db.addToWishlist(req.user.id, req.params.productId);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/wishlist failed', err);
    res.status(500).json({ error: 'Failed to add to wishlist' });
  }
});

app.delete('/api/wishlist/:productId', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers have a wishlist' });
  try {
    await db.removeFromWishlist(req.user.id, req.params.productId);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/wishlist failed', err);
    res.status(500).json({ error: 'Failed to remove from wishlist' });
  }
});

// ============================================================
// Leads — real high-intent buyer interaction tracking, matching the
// schema: PHONE_CLICK / MESSAGE_SENT / QUOTE_REQUEST / CHECKOUT_STARTED,
// with NEW / CONTACTED / CONVERTED / ARCHIVED status. MESSAGE_SENT is
// logged directly inside POST /api/conversations above (only on
// genuine first contact, not every reply) — the two endpoints below
// cover the other real trigger points.
// ============================================================

// CHECKOUT_STARTED — fired when a customer opens the checkout modal,
// "even if abandoned" per the spec: this logs intent, independent of
// whether POST /api/marketplace/checkout ever actually completes.
app.post('/api/leads/checkout-started', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers trigger this' });
  const { vendorId, productId } = req.body || {};
  if (!vendorId) return res.status(400).json({ error: 'vendorId is required' });
  try {
    await db.createLead({ id: crypto.randomUUID(), vendorId, buyerId: req.user.id, productId: productId || null, type: 'CHECKOUT_STARTED' });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/leads/checkout-started failed', err);
    res.status(500).json({ error: 'Failed to log lead' });
  }
});

// PHONE_CLICK — reveals a vendor's real phone number. Deliberately
// public: viewing contact info shouldn't require an account, so a
// guest lead (buyerId: null) is a real, expected case here, not an
// error condition — matching the schema's nullable buyer_id.
app.get('/api/vendors/:id/contact', async (req, res) => {
  try {
    const vendor = await db.getUserById(req.params.id);
    if (!vendor || vendor.role !== 'vendor') return res.status(404).json({ error: 'Vendor not found' });
    if (!vendor.phone) return res.status(404).json({ error: "This vendor hasn't added a phone number yet" });

    let buyerId = null;
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      try {
        const payload = verifyToken(token);
        if (payload.role === 'sender') buyerId = payload.id;
      } catch (err) { /* guest, or an expired/invalid token — still allow viewing contact info */ }
    }
    await db.createLead({
      id: crypto.randomUUID(), vendorId: vendor.id, buyerId, productId: req.query.productId || null, type: 'PHONE_CLICK',
    });
    res.json({ phone: vendor.phone, businessName: vendor.businessName });
  } catch (err) {
    console.error('GET /api/vendors/:id/contact failed', err);
    res.status(500).json({ error: 'Failed to load vendor contact info' });
  }
});

app.get('/api/vendor/leads', requireAuth, requireVendor, async (req, res) => {
  try {
    const [leads, summary] = await Promise.all([
      db.getVendorLeads(req.user.id),
      db.getVendorLeadsSummary(req.user.id),
    ]);
    res.json({ leads, summary });
  } catch (err) {
    console.error('GET /api/vendor/leads failed', err);
    res.status(500).json({ error: 'Failed to load leads' });
  }
});

app.patch('/api/vendor/leads/:id/status', requireAuth, requireVendor, async (req, res) => {
  const { status } = req.body || {};
  if (!['NEW', 'CONTACTED', 'CONVERTED', 'ARCHIVED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const updated = await db.updateLeadStatus(req.params.id, req.user.id, status);
    if (!updated) return res.status(404).json({ error: 'Lead not found' });
    res.json({ ok: true, lead: updated });
  } catch (err) {
    console.error('PATCH /api/vendor/leads/:id/status failed', err);
    res.status(500).json({ error: 'Failed to update lead status' });
  }
});

// ---- Store Follows (mirrors the wishlist endpoints, for stores) ----
app.get('/api/store-follows/ids', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.json({ vendorIds: [] });
  try {
    const vendorIds = await db.getFollowedStoreIds(req.user.id);
    res.json({ vendorIds });
  } catch (err) {
    console.error('GET /api/store-follows/ids failed', err);
    res.status(500).json({ error: 'Failed to load followed stores' });
  }
});

app.post('/api/store-follows/:vendorId', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers can follow stores' });
  try {
    await db.followStore(req.user.id, req.params.vendorId);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/store-follows failed', err);
    res.status(500).json({ error: 'Failed to follow store' });
  }
});

app.delete('/api/store-follows/:vendorId', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers can follow stores' });
  try {
    await db.unfollowStore(req.user.id, req.params.vendorId);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/store-follows failed', err);
    res.status(500).json({ error: 'Failed to unfollow store' });
  }
});

// ============================================================
// Saved Addresses — real, customer-only. Same restriction pattern as
// the wishlist and reviews above.
// ============================================================
app.get('/api/addresses', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers have saved addresses' });
  try {
    const addresses = await db.getSavedAddresses(req.user.id);
    res.json({ addresses });
  } catch (err) {
    console.error('GET /api/addresses failed', err);
    res.status(500).json({ error: 'Failed to load addresses' });
  }
});

app.post('/api/addresses', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers have saved addresses' });
  const { label, address, isDefault, zoneId } = req.body || {};
  if (!label || !label.trim() || !address || !address.trim()) {
    return res.status(400).json({ error: 'Label and address are both required' });
  }
  // Required, not just validated-if-present, as of the zone-pair delivery
  // fee feature — a saved address' zone now drives real checkout pricing
  // (see schema.sql's comment on zone_pair_fees), so a brand-new saved
  // address can no longer be created without one. Existing addresses
  // saved before this requirement keep working (see the PUT route below,
  // and Checkout's own dropoff picker, which simply hides a zoneless
  // saved address instead of breaking on it).
  if (!zoneId) return res.status(400).json({ error: 'A delivery zone is required' });
  if (!(await validateOptionalZoneId(zoneId))) {
    return res.status(400).json({ error: 'Selected delivery zone was not found' });
  }
  try {
    const saved = await db.createSavedAddress({
      id: crypto.randomUUID(), customerId: req.user.id, label: label.trim(), address: address.trim(), isDefault, zoneId,
    });
    res.json({ address: saved });
  } catch (err) {
    console.error('POST /api/addresses failed', err);
    res.status(500).json({ error: 'Failed to save address' });
  }
});

app.put('/api/addresses/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers have saved addresses' });
  const { label, address, isDefault, zoneId } = req.body || {};
  if (!label || !label.trim() || !address || !address.trim()) {
    return res.status(400).json({ error: 'Label and address are both required' });
  }
  // zoneId omitted entirely (e.g. the "Set as Default" quick action,
  // which only ever sends label/address/isDefault) still means "leave
  // whatever zone this address already has unchanged" — but once the
  // field IS included, same as the address-edit form always sends now,
  // it can no longer be cleared to empty (see the POST route's comment
  // above for why).
  if (zoneId !== undefined && !zoneId) return res.status(400).json({ error: 'A delivery zone is required' });
  if (zoneId !== undefined && !(await validateOptionalZoneId(zoneId))) {
    return res.status(400).json({ error: 'Selected delivery zone was not found' });
  }
  try {
    const updated = await db.updateSavedAddress(req.params.id, req.user.id, { label: label.trim(), address: address.trim(), isDefault, zoneId });
    if (!updated) return res.status(404).json({ error: 'Address not found' });
    res.json({ address: updated });
  } catch (err) {
    console.error('PUT /api/addresses/:id failed', err);
    res.status(500).json({ error: 'Failed to update address' });
  }
});

app.delete('/api/addresses/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers have saved addresses' });
  try {
    const deleted = await db.deleteSavedAddress(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Address not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/addresses/:id failed', err);
    res.status(500).json({ error: 'Failed to delete address' });
  }
});

// ============================================================
// Messages — real in-app messaging between a customer and a vendor.
// Works for both roles: a customer sees their conversations with
// vendors, a vendor sees their conversations with customers. Delivered
// live over Socket.io to both participants' existing rooms
// (`user:<id>` / `vendor:<id>`, same rooms used for order updates).
// ============================================================
app.get('/api/conversations', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender' && req.user.role !== 'vendor') {
    return res.status(403).json({ error: 'Messaging is only available to customers and vendors' });
  }
  try {
    const conversations = await db.getConversationsForUser(req.user.id, req.user.role);
    res.json({ conversations });
  } catch (err) {
    console.error('GET /api/conversations failed', err);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// Customer-initiated only — a customer starts a conversation with a
// vendor (e.g. from a product page); a vendor replies within it rather
// than starting new ones with customers who haven't reached out.
app.post('/api/conversations', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') return res.status(403).json({ error: 'Only customers can start a conversation' });
  const { vendorId, productId } = req.body || {};
  if (!vendorId) return res.status(400).json({ error: 'vendorId is required' });
  try {
    const vendor = await db.getUserById(vendorId);
    if (!vendor || vendor.role !== 'vendor') return res.status(404).json({ error: 'Vendor not found' });
    const { conversation, wasCreated } = await db.getOrCreateConversation(req.user.id, vendorId);
    if (wasCreated) {
      // A real lead — genuine first contact with this vendor, not
      // logged again for every reply within the same conversation.
      await db.createLead({
        id: crypto.randomUUID(), vendorId, buyerId: req.user.id, productId: productId || null, type: 'MESSAGE_SENT',
      });
    }
    res.json({ conversationId: conversation.id, vendorName: vendor.businessName });
  } catch (err) {
    console.error('POST /api/conversations failed', err);
    res.status(500).json({ error: 'Failed to start conversation' });
  }
});

// Vendor-initiated conversation — the counterpart to POST /api/conversations
// above, which only lets a customer start a thread. Used by the
// abandoned-checkout recovery view's "Message this customer" action, so
// a vendor can reach out first instead of waiting for the customer to.
// Reuses the same getOrCreateConversation as the customer-initiated
// path (a thread started either direction is the same conversation),
// just doesn't log a MESSAGE_SENT lead — that lead type tracks a
// customer's own outreach, not the vendor's.
app.post('/api/vendor/conversations', requireAuth, requireVendor, async (req, res) => {
  const { customerId } = req.body || {};
  if (!customerId) return res.status(400).json({ error: 'customerId is required' });
  try {
    const customer = await db.getUserById(customerId);
    if (!customer || customer.role !== 'sender') return res.status(404).json({ error: 'Customer not found' });
    const { conversation } = await db.getOrCreateConversation(customerId, req.user.id);
    res.json({ conversationId: conversation.id, customerName: customer.businessName });
  } catch (err) {
    console.error('POST /api/vendor/conversations failed', err);
    res.status(500).json({ error: 'Failed to start conversation' });
  }
});

app.get('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    const conversation = await db.getConversationById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (conversation.customer_id !== req.user.id && conversation.vendor_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your conversation' });
    }
    const messages = await db.getConversationMessages(req.params.id);
    await db.markConversationRead(req.params.id, req.user.id);
    res.json({ messages });
  } catch (err) {
    console.error('GET /api/conversations/:id/messages failed', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

app.post('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message cannot be empty' });
  try {
    const conversation = await db.getConversationById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (conversation.customer_id !== req.user.id && conversation.vendor_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your conversation' });
    }
    const message = await db.sendMessageToConversation({
      id: crypto.randomUUID(), conversationId: req.params.id, senderId: req.user.id, body: body.trim(),
    });
    // Real-time delivery to both participants — whichever one didn't
    // just send this gets it live; the sender's own other devices/tabs
    // get it too, same pattern as every other realtime event here.
    io.to(`user:${conversation.customer_id}`).to(`vendor:${conversation.vendor_id}`).emit('message:new', {
      conversationId: req.params.id, message,
    });
    // Push only to whichever participant didn't just send this.
    const recipientId = req.user.id === conversation.customer_id ? conversation.vendor_id : conversation.customer_id;
    sendPushToUser(db, recipientId, { title: 'New message', body: message.body, url: '/' }); // fire-and-forget
    res.json({ message });
  } catch (err) {
    console.error('POST /api/conversations/:id/messages failed', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ============================================================
// Live in-app support chat — one thread per user account, platform-run
// (not scoped to any one vendor, unlike the conversations above). See
// the support_messages comment in schema.sql.
// ============================================================

// A user's own thread with support. Reading it marks support's
// messages read, same pattern as GET /api/conversations/:id/messages.
app.get('/api/support/messages', requireAuth, async (req, res) => {
  try {
    const messages = await db.getSupportMessages(req.user.id);
    await db.markSupportMessagesRead(req.user.id, 'user');
    res.json({ messages });
  } catch (err) {
    console.error('GET /api/support/messages failed', err);
    res.status(500).json({ error: 'Failed to load your messages' });
  }
});

app.post('/api/support/messages', requireAuth, async (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message cannot be empty' });
  try {
    const message = await db.createSupportMessage({
      id: crypto.randomUUID(), userId: req.user.id, senderRole: 'user', body: body.trim(),
    });
    // Real-time delivery to the user's own other tabs and to every
    // connected admin/support staff member.
    io.to(`user:${req.user.id}`).to('admins').emit('support:new', { userId: req.user.id, message });
    res.json({ message });
  } catch (err) {
    console.error('POST /api/support/messages failed', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Support inbox (admin-facing) — every user who has ever messaged
// support, most-recently-active first.
app.get('/api/admin/support/threads', requireAuth, requireAdmin, requireFeature('support_inbox'), async (req, res) => {
  try {
    const threads = await db.getSupportThreadsForAdmin();
    res.json({ threads });
  } catch (err) {
    console.error('GET /api/admin/support/threads failed', err);
    res.status(500).json({ error: 'Failed to load support threads' });
  }
});

// A specific user's thread, from the support side. Reading it marks
// the user's messages read.
app.get('/api/admin/support/threads/:userId/messages', requireAuth, requireAdmin, requireFeature('support_inbox'), async (req, res) => {
  try {
    const messages = await db.getSupportMessages(req.params.userId);
    await db.markSupportMessagesRead(req.params.userId, 'support');
    res.json({ messages });
  } catch (err) {
    console.error('GET /api/admin/support/threads/:userId/messages failed', err);
    res.status(500).json({ error: 'Failed to load thread' });
  }
});

app.post('/api/admin/support/threads/:userId/messages', requireAuth, requireAdmin, requireFeature('support_inbox'), async (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message cannot be empty' });
  try {
    const user = await db.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const message = await db.createSupportMessage({
      id: crypto.randomUUID(), userId: req.params.userId, senderRole: 'support', body: body.trim(),
    });
    io.to(`user:${req.params.userId}`).to('admins').emit('support:new', { userId: req.params.userId, message });
    sendPushToUser(db, req.params.userId, { title: 'New message from Support', body: message.body, url: '/' }); // fire-and-forget
    res.json({ message });
  } catch (err) {
    console.error('POST /api/admin/support/threads/:userId/messages failed', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Roles an admin is allowed to message through this feature — kept as
// an explicit whitelist rather than trusting whatever the client
// sends, same reasoning as every other role-scoped query in this
// file. 'admin'/'super_admin' are deliberately excluded: this is for
// reaching customers/vendors/delivery companies, not staff-to-staff
// messaging (which has no product need here).
const MESSAGING_DIRECTORY_ROLES = ['sender', 'vendor', 'delivery_company'];

// Support Inbox's "New Message" recipient picker — search customers,
// vendors, or delivery companies by name/email/phone so an admin can
// start a conversation with someone who has never messaged support
// before (the existing POST .../threads/:userId/messages route above
// already works for any userId, thread or no thread — this route is
// what lets the frontend find that userId in the first place).
app.get('/api/admin/support/directory', requireAuth, requireAdmin, requireFeature('support_inbox'), async (req, res) => {
  const { role, search } = req.query;
  if (!MESSAGING_DIRECTORY_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    const results = await db.searchMessagingDirectory(role, search || '');
    res.json({ results });
  } catch (err) {
    console.error('GET /api/admin/support/directory failed', err);
    res.status(500).json({ error: 'Failed to search directory' });
  }
});

// Support Inbox's "Message everyone in this group" broadcast — one
// message, written into every matching user's own support thread
// (skipping disabled accounts). Real-time delivery mirrors the
// single-recipient route above: each recipient's own tabs get it live
// via their `user:<id>` room, and every connected admin/support staff
// member sees it too (a broadcast should show up in Support Inbox's
// thread list exactly like an individual reply would). Push
// notifications are fire-and-forget per recipient, same pattern used
// everywhere else in this file — not awaited, so a slow/failed push
// for one recipient can never delay or fail the response for the rest.
app.post('/api/admin/support/broadcast', requireAuth, requireAdmin, requireFeature('support_inbox'), async (req, res) => {
  const { role, body } = req.body || {};
  if (!MESSAGING_DIRECTORY_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message cannot be empty' });
  try {
    const messages = await db.broadcastSupportMessage({ role, body: body.trim() });
    messages.forEach((message) => {
      io.to(`user:${message.userId}`).to('admins').emit('support:new', { userId: message.userId, message });
      sendPushToUser(db, message.userId, { title: 'New message from Support', body: message.body, url: '/' }); // fire-and-forget
    });
    res.json({ recipientCount: messages.length });
  } catch (err) {
    console.error('POST /api/admin/support/broadcast failed', err);
    res.status(500).json({ error: 'Failed to send broadcast' });
  }
});

// ============================================================
// Web Push (VAPID) — no third-party account needed. See push.js for
// full setup instructions and the send side.
// ============================================================

// Public — the frontend needs this to call PushManager.subscribe().
app.get('/api/push/vapid-public-key', (req, res) => {
  if (!VAPID_PUBLIC_KEY) return res.status(503).json({ error: 'Push notifications are not configured on this server' });
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'A valid push subscription is required' });
  }
  try {
    await db.upsertPushSubscription({
      id: crypto.randomUUID(), userId: req.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/push/subscribe failed', err);
    res.status(500).json({ error: 'Failed to save push subscription' });
  }
});

app.post('/api/push/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
  try {
    await db.deletePushSubscriptionByEndpoint(endpoint);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/push/unsubscribe failed', err);
    res.status(500).json({ error: 'Failed to remove push subscription' });
  }
});

// Checkout — pay-on-delivery (no payment gateway integrated yet) and
// automatically creates a real delivery order for fulfillment. Both are
// defaults, not confirmed decisions — see README.
app.post('/api/marketplace/checkout', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') {
    return res.status(403).json({ error: 'Only customers can check out' });
  }
  // Maintenance mode pauses checkout platform-wide — same switch and
  // same message as the delivery-order path above.
  const platformSettings = await db.getPlatformSettings();
  if (platformSettings.maintenanceMode) {
    return res.status(503).json({ error: platformSettings.maintenanceMessage || 'Checkout is temporarily paused for maintenance. Please try again shortly.' });
  }
  const { vendorId, items, pickupAddress, dropoffAddress, couponCode } = req.body || {};
  if (!vendorId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'A vendor and at least one item are required' });
  }
  if (!pickupAddress || !dropoffAddress) {
    return res.status(400).json({ error: 'Pickup and dropoff addresses are required' });
  }
  try {
    const result = await db.checkout({
      customerId: req.user.id,
      customerName: req.user.businessName,
      vendorId,
      items,
      pickupAddress,
      dropoffAddress,
      createDeliveryOrder: true,
      couponCode,
    });
    io.to(`vendor:${vendorId}`).emit('purchase:created', result);
    if (result.deliveryOrderId) {
      const deliveryOrder = await db.getOrder(result.deliveryOrderId);
      if (deliveryOrder) {
        orderRooms(deliveryOrder).forEach((r) => io.to(r).emit('order:created', deliveryOrder));
        notifyNewOrder(deliveryOrder);
      }
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/marketplace/checkout failed', err);
    res.status(400).json({ error: err.message || 'Checkout failed' });
  }
});

// Multi-vendor Pay-on-Delivery checkout — one cart spanning several
// vendors becomes one checkout ACTION from the customer's side, but
// under the hood it's still one real db.checkout() call per vendor
// (that function's transaction/stock/coupon logic is untouched and
// still single-vendor — this just loops it). Each vendor group gets
// its own real delivery fee from its assigned zone (see schema.sql's
// comment on delivery_zones), looked up fresh here, never trusted
// from the client. A later group failing (e.g. out of stock) does
// NOT roll back groups that already succeeded — those are real,
// separate orders now — so this returns per-group results AND errors
// rather than one pass/fail, and the frontend is responsible for
// showing the customer exactly what did and didn't go through.
app.post('/api/marketplace/checkout/multi', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') {
    return res.status(403).json({ error: 'Only customers can check out' });
  }
  const platformSettings = await db.getPlatformSettings();
  if (platformSettings.maintenanceMode) {
    return res.status(503).json({ error: platformSettings.maintenanceMessage || 'Checkout is temporarily paused for maintenance. Please try again shortly.' });
  }
  const { vendorGroups, dropoffAddress, dropoffZoneId, customerName, customerPhone, couponCode } = req.body || {};
  if (!Array.isArray(vendorGroups) || vendorGroups.length === 0) {
    return res.status(400).json({ error: 'At least one vendor is required' });
  }
  if (!dropoffAddress) {
    return res.status(400).json({ error: 'Dropoff address is required' });
  }
  // A delivery zone is now required, not just a bonus that improves the
  // fee lookup — the frontend's Checkout no longer lets a customer type
  // a one-off address with no zone (see the Dropoff Address form-group's
  // comment in index.html), so this is a real server-side backstop, not
  // just belt-and-suspenders against a stale client.
  if (!dropoffZoneId) {
    return res.status(400).json({ error: 'A delivery zone is required — please select a saved address with a delivery zone' });
  }
  for (const g of vendorGroups) {
    if (!g.vendorId || !Array.isArray(g.items) || g.items.length === 0 || !g.pickupAddress) {
      return res.status(400).json({ error: 'Each vendor needs its own items and pickup address' });
    }
  }
  // Editable at Checkout, pre-filled from the account on the frontend —
  // falls back to the account's own name/phone here too (the JWT
  // payload itself doesn't carry phone, so a fresh row is fetched),
  // so a request that omits them (or an older client) behaves exactly
  // as before this feature.
  const accountUser = (!customerName || !customerName.trim() || !customerPhone || !customerPhone.trim())
    ? await db.getUserById(req.user.id) : null;
  const senderName = (customerName && customerName.trim()) ? customerName.trim() : req.user.businessName;
  const senderPhone = (customerPhone && customerPhone.trim()) ? customerPhone.trim() : (accountUser ? accountUser.phone : null);
  const checkoutBatchId = vendorGroups.length > 1 ? crypto.randomUUID() : null;
  const results = [];
  const errors = [];
  for (const g of vendorGroups) {
    try {
      const vendor = await db.getUserById(g.vendorId);
      const zone = vendor && vendor.deliveryZoneId ? await db.getDeliveryZoneById(vendor.deliveryZoneId) : null;
      // Priced by (this vendor's zone, the customer's dropoff zone) —
      // see schema.sql's comment on zone_pair_fees. Falls back to the
      // vendor's own flat zone fee when no pair price is set yet or the
      // customer's dropoff has no resolvable zone, so today's behavior
      // keeps working unchanged until the admin prices that pair.
      const deliveryFee = await db.resolveDeliveryFee(vendor && vendor.deliveryZoneId, dropoffZoneId);
      const result = await db.checkout({
        customerId: req.user.id,
        customerName: senderName,
        customerPhone: senderPhone,
        vendorId: g.vendorId,
        items: g.items,
        pickupAddress: g.pickupAddress,
        dropoffAddress,
        createDeliveryOrder: true,
        couponCode, // only applies to the vendor that actually owns the code; a no-op for every other group in the batch
        deliveryFee,
        checkoutBatchId,
      });
      io.to(`vendor:${g.vendorId}`).emit('purchase:created', result);
      if (result.deliveryOrderId) {
        const deliveryOrder = await db.getOrder(result.deliveryOrderId);
        if (deliveryOrder) {
          orderRooms(deliveryOrder).forEach((r) => io.to(r).emit('order:created', deliveryOrder));
          notifyNewOrder(deliveryOrder);
        }
      }
      results.push({ ...result, vendorId: g.vendorId, zoneName: zone ? zone.name : null, deliveryFee });
    } catch (err) {
      errors.push({ vendorId: g.vendorId, vendorName: g.vendorName || null, error: err.message || 'Checkout failed' });
    }
  }
  if (results.length === 0) {
    return res.status(400).json({ error: errors[0] ? errors[0].error : 'Checkout failed', errors });
  }
  const combinedGrandTotal = Math.round(results.reduce((sum, r) => sum + r.grandTotal, 0) * 100) / 100;
  res.json({ ok: true, checkoutBatchId, results, errors, combinedGrandTotal });
});

// ============================================================
// Mobile Money (MTN) checkout — an online-payment alternative to Pay
// on Delivery. Orange Money isn't wired up yet (see README → "Mobile
// Money (MTN)" for why); the frontend hides it behind a "coming soon"
// label rather than offering something that doesn't work.
//
// Flow: initiate (reserves stock + creates a pending purchase, sends
// the payment prompt to the customer's phone) -> the frontend polls
// the status route every few seconds -> once MTN confirms, the real
// delivery order gets created for the first time (see
// confirmMomoPaymentAndCreateOrder's comment for why it's deferred).
// A webhook is also wired up as a best-effort latency improvement, but
// polling is the mechanism this actually depends on being correct —
// MTN's callback payload shape isn't confidently documented (see
// momo.js's module comment), so treat anything it does is a bonus,
// never the only path to a confirmed payment.
// ============================================================

app.get('/api/marketplace/payment-methods', (req, res) => {
  res.json({ momoAvailable: momo.isConfigured, orangeAvailable: false });
});

app.post('/api/marketplace/checkout/momo', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') {
    return res.status(403).json({ error: 'Only customers can check out' });
  }
  if (!momo.isConfigured) {
    return res.status(503).json({ error: 'Mobile Money isn\'t available yet — please use Pay on Delivery.' });
  }
  const platformSettings = await db.getPlatformSettings();
  if (platformSettings.maintenanceMode) {
    return res.status(503).json({ error: platformSettings.maintenanceMessage || 'Checkout is temporarily paused for maintenance. Please try again shortly.' });
  }
  const { vendorId, items, pickupAddress, dropoffAddress, phone, couponCode } = req.body || {};
  if (!vendorId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'A vendor and at least one item are required' });
  }
  if (!pickupAddress || !dropoffAddress) {
    return res.status(400).json({ error: 'Pickup and dropoff addresses are required' });
  }
  const cleanPhone = String(phone || '').replace(/[^\d]/g, '');
  if (cleanPhone.length < 8 || cleanPhone.length > 15) {
    return res.status(400).json({ error: 'Enter a valid Mobile Money phone number, digits only (with country code, e.g. 231XXXXXXXXX).' });
  }

  let purchaseId = null;
  try {
    // Reserves stock and creates the purchase as 'pending' — see
    // checkout()'s own comment on why createDeliveryOrder is false
    // here specifically. A coupon (if any) is redeemed optimistically
    // right here too, same as stock — voidFailedMomoPayment() below
    // gives both back if the payment never actually completes.
    const result = await db.checkout({
      customerId: req.user.id,
      customerName: req.user.businessName,
      vendorId,
      items,
      pickupAddress,
      dropoffAddress,
      createDeliveryOrder: false,
      paymentMethod: 'momo',
      paymentStatus: 'pending',
      momoReferenceId: crypto.randomUUID(),
      momoPhone: cleanPhone,
      couponCode,
    });
    purchaseId = result.purchaseId;

    const purchase = await db.getPurchaseById(purchaseId);
    // Charge the grand total (items + platform service fee), not just
    // the item subtotal — otherwise the service fee would be
    // configured and displayed everywhere but never actually
    // collected on the one payment path that goes through ONLib
    // rather than being paid to the vendor in cash.
    await momo.requestToPay({
      referenceId: purchase.momoReferenceId,
      amount: result.grandTotal,
      externalId: purchaseId,
      payerMsisdn: cleanPhone,
      payerMessage: `Order from ONLib Marketplace`,
      payeeNote: `Purchase ${purchaseId}`,
    });

    io.to(`vendor:${vendorId}`).emit('purchase:created', result);
    res.json({ ok: true, purchaseId, referenceId: purchase.momoReferenceId, paymentStatus: 'pending' });
  } catch (err) {
    console.error('POST /api/marketplace/checkout/momo failed', err);
    // The purchase (and its stock reservation) was already created
    // before the failure — e.g. MTN's API rejected/timed out the
    // request-to-pay call itself, not just a later payment decline —
    // so it has to be voided/restocked rather than left dangling as a
    // permanently-pending purchase nobody will ever resolve.
    if (purchaseId) {
      try { await db.voidFailedMomoPayment(purchaseId); } catch (voidErr) { console.error('Failed to void purchase after momo initiation error', voidErr); }
    }
    res.status(400).json({ error: err.message || 'Mobile Money checkout failed — please try Pay on Delivery instead.' });
  }
});

// ============================================================
// Mobile Money (manual/reference-code) checkout — the customer's
// actual "Pay with Mobile Money" path (Orange Money or Lonestar Cell
// MTN). Unlike the automated push-and-poll route above (which depends
// on real MTN Open API credentials being configured, and never
// supported Orange Money at all), this needs no payment gateway
// integration: the customer transfers to the platform's own Mobile
// Money number themselves and types the generated reference code
// below into their own transfer, then a Super Admin matches it
// against a real received payment by hand (see the pending queue at
// GET /api/super-admin/marketplace-payments/pending below) — the same
// pending-then-admin-confirmed shape as Featured Placements'/Premium's
// 'direct' payment method, just with a generated code to match against
// instead of nothing. No stock-reservation failure mode to void here
// (unlike the momo route above) — db.checkout() either fully commits
// or fully rolls back in one transaction, with no external API call in
// between that could fail after the fact.
// ============================================================

app.post('/api/marketplace/checkout/momo-manual', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') {
    return res.status(403).json({ error: 'Only customers can check out' });
  }
  const platformSettings = await db.getPlatformSettings();
  if (platformSettings.maintenanceMode) {
    return res.status(503).json({ error: platformSettings.maintenanceMessage || 'Checkout is temporarily paused for maintenance. Please try again shortly.' });
  }
  const { vendorId, items, pickupAddress, dropoffAddress, provider, couponCode } = req.body || {};
  if (!vendorId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'A vendor and at least one item are required' });
  }
  if (!pickupAddress || !dropoffAddress) {
    return res.status(400).json({ error: 'Pickup and dropoff addresses are required' });
  }
  // Real, Super-Admin-managed provider — not a hardcoded 2-value check,
  // so a newly added provider works at checkout the moment it's saved,
  // and a disabled/removed one is rejected here too (not just hidden
  // client-side).
  const momoProvider = await db.getMomoProviderById(provider);
  if (!momoProvider || !momoProvider.isEnabled) {
    return res.status(400).json({ error: 'That Mobile Money provider is not available right now' });
  }
  try {
    const result = await db.checkout({
      customerId: req.user.id,
      customerName: req.user.businessName,
      vendorId,
      items,
      pickupAddress,
      dropoffAddress,
      createDeliveryOrder: false,
      paymentMethod: 'momo_manual',
      paymentStatus: 'pending',
      paymentProvider: provider,
      couponCode,
    });
    io.to(`vendor:${vendorId}`).emit('purchase:created', result);
    // Lets an open Super Admin Payouts panel refresh its pending queue
    // live rather than only on next visit — same "admins" room every
    // other admin-facing realtime event in this file uses.
    io.to('admins').emit('marketplace_payment:new', { purchaseId: result.purchaseId, kind: 'new_payment' });
    res.json({
      ok: true,
      purchaseId: result.purchaseId,
      paymentReference: result.paymentReference,
      grandTotal: result.grandTotal,
      // That specific provider's own receiving number (see
      // momo_providers in schema.sql) — fetched fresh above rather than
      // trusting the frontend's cached copy, in case a Super Admin
      // changed it since the page loaded.
      sendToPhone: momoProvider.phone,
    });
  } catch (err) {
    console.error('POST /api/marketplace/checkout/momo-manual failed', err);
    res.status(400).json({ error: err.message || 'Checkout failed' });
  }
});

// Multi-vendor Mobile Money checkout — same batching idea as
// /api/marketplace/checkout/multi above, but the customer sends ONE
// combined payment covering every vendor, using ONE shared reference
// code. That reference is generated by the FIRST vendor group's real
// checkout() call (same generation logic as a normal single-vendor
// Mobile Money checkout, unchanged); every subsequent group in the
// batch is checked out with skipReferenceGeneration so it stores no
// reference of its own (payment_reference has a real uniqueness
// constraint — see schema.sql) and is instead matched via
// checkout_batch_id when a Super Admin confirms or rejects the
// primary purchase (see confirmMomoPaymentAndCreateOrder /
// voidFailedMomoPayment's batch-cascade logic).
app.post('/api/marketplace/checkout/multi/momo-manual', requireAuth, async (req, res) => {
  if (req.user.role !== 'sender') {
    return res.status(403).json({ error: 'Only customers can check out' });
  }
  const platformSettings = await db.getPlatformSettings();
  if (platformSettings.maintenanceMode) {
    return res.status(503).json({ error: platformSettings.maintenanceMessage || 'Checkout is temporarily paused for maintenance. Please try again shortly.' });
  }
  const { vendorGroups, dropoffAddress, dropoffZoneId, customerName, customerPhone, provider, couponCode } = req.body || {};
  if (!Array.isArray(vendorGroups) || vendorGroups.length === 0) {
    return res.status(400).json({ error: 'At least one vendor is required' });
  }
  if (!dropoffAddress) {
    return res.status(400).json({ error: 'Dropoff address is required' });
  }
  // A delivery zone is now required, not just a bonus that improves the
  // fee lookup — the frontend's Checkout no longer lets a customer type
  // a one-off address with no zone (see the Dropoff Address form-group's
  // comment in index.html), so this is a real server-side backstop, not
  // just belt-and-suspenders against a stale client.
  if (!dropoffZoneId) {
    return res.status(400).json({ error: 'A delivery zone is required — please select a saved address with a delivery zone' });
  }
  for (const g of vendorGroups) {
    if (!g.vendorId || !Array.isArray(g.items) || g.items.length === 0 || !g.pickupAddress) {
      return res.status(400).json({ error: 'Each vendor needs its own items and pickup address' });
    }
  }
  const momoProvider = await db.getMomoProviderById(provider);
  if (!momoProvider || !momoProvider.isEnabled) {
    return res.status(400).json({ error: 'That Mobile Money provider is not available right now' });
  }
  // Editable at Checkout, pre-filled from the account on the frontend —
  // see the identical comment on /api/marketplace/checkout/multi above.
  const accountUser = (!customerName || !customerName.trim() || !customerPhone || !customerPhone.trim())
    ? await db.getUserById(req.user.id) : null;
  const senderName = (customerName && customerName.trim()) ? customerName.trim() : req.user.businessName;
  const senderPhone = (customerPhone && customerPhone.trim()) ? customerPhone.trim() : (accountUser ? accountUser.phone : null);
  const checkoutBatchId = vendorGroups.length > 1 ? crypto.randomUUID() : null;
  let sharedReference = null;
  const results = [];
  const errors = [];
  for (const g of vendorGroups) {
    try {
      const vendor = await db.getUserById(g.vendorId);
      const zone = vendor && vendor.deliveryZoneId ? await db.getDeliveryZoneById(vendor.deliveryZoneId) : null;
      // See /api/marketplace/checkout/multi above for the zone-pair fee
      // + fallback reasoning.
      const deliveryFee = await db.resolveDeliveryFee(vendor && vendor.deliveryZoneId, dropoffZoneId);
      const result = await db.checkout({
        customerId: req.user.id,
        customerName: senderName,
        customerPhone: senderPhone,
        vendorId: g.vendorId,
        items: g.items,
        pickupAddress: g.pickupAddress,
        dropoffAddress,
        createDeliveryOrder: false,
        paymentMethod: 'momo_manual',
        paymentStatus: 'pending',
        paymentProvider: provider,
        couponCode,
        deliveryFee,
        checkoutBatchId,
        skipReferenceGeneration: sharedReference !== null,
      });
      if (!sharedReference) sharedReference = result.paymentReference;
      io.to(`vendor:${g.vendorId}`).emit('purchase:created', result);
      results.push({ ...result, vendorId: g.vendorId, zoneName: zone ? zone.name : null, deliveryFee });
    } catch (err) {
      errors.push({ vendorId: g.vendorId, vendorName: g.vendorName || null, error: err.message || 'Checkout failed' });
    }
  }
  if (results.length === 0) {
    return res.status(400).json({ error: errors[0] ? errors[0].error : 'Checkout failed', errors });
  }
  io.to('admins').emit('marketplace_payment:new', { checkoutBatchId, purchaseId: results[0].purchaseId, kind: 'new_payment' });
  const combinedGrandTotal = Math.round(results.reduce((sum, r) => sum + r.grandTotal, 0) * 100) / 100;
  res.json({ ok: true, checkoutBatchId, paymentReference: sharedReference, results, errors, combinedGrandTotal, sendToPhone: momoProvider.phone });
});

app.get('/api/marketplace/purchases/:id/payment-status', requireAuth, async (req, res) => {
  try {
    const purchase = await db.getPurchaseById(req.params.id);
    if (!purchase || purchase.customerId !== req.user.id) {
      return res.status(404).json({ error: 'Purchase not found' });
    }
    if (purchase.paymentMethod !== 'momo' || purchase.paymentStatus !== 'pending') {
      return res.json({ paymentStatus: purchase.paymentStatus, deliveryOrderId: purchase.deliveryOrderId });
    }
    // Still pending as far as our own DB knows — ask MTN directly
    // rather than only waiting on the webhook (see the module comment
    // above on why polling is the reliable path here).
    const live = await momo.getRequestToPayStatus(purchase.momoReferenceId);
    if (live.status === 'SUCCESSFUL') {
      const confirmed = await db.confirmMomoPaymentAndCreateOrder(purchase.id);
      if (confirmed && confirmed.deliveryOrderId) {
        const deliveryOrder = await db.getOrder(confirmed.deliveryOrderId);
        if (deliveryOrder) {
          orderRooms(deliveryOrder).forEach((r) => io.to(r).emit('order:created', deliveryOrder));
          notifyNewOrder(deliveryOrder);
        }
      }
      return res.json({ paymentStatus: 'successful', deliveryOrderId: confirmed ? confirmed.deliveryOrderId : null });
    }
    if (live.status === 'FAILED') {
      await db.voidFailedMomoPayment(purchase.id);
      return res.json({ paymentStatus: 'failed', reason: live.reason });
    }
    // Still PENDING on MTN's side too — customer hasn't approved (or
    // declined) the prompt on their phone yet.
    res.json({ paymentStatus: 'pending' });
  } catch (err) {
    console.error('GET /api/marketplace/purchases/:id/payment-status failed', err);
    res.status(500).json({ error: 'Failed to check payment status' });
  }
});

// Customer-initiated cancel of their own still-pending Mobile Money
// payment — e.g. they backed out of approving it on their phone
// (automated 'momo'), or changed their mind before actually sending
// the transfer (manual 'momo_manual'). Restocks the reserved items the
// same way a failed/expired payment does; without this, walking away
// would leave the stock reservation in place indefinitely.
app.post('/api/marketplace/purchases/:id/cancel-payment', requireAuth, async (req, res) => {
  try {
    const purchase = await db.getPurchaseById(req.params.id);
    if (!purchase || purchase.customerId !== req.user.id) {
      return res.status(404).json({ error: 'Purchase not found' });
    }
    if (!['momo', 'momo_manual'].includes(purchase.paymentMethod) || purchase.paymentStatus !== 'pending') {
      return res.status(400).json({ error: 'This purchase is not a pending Mobile Money payment' });
    }
    await db.voidFailedMomoPayment(purchase.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/marketplace/purchases/:id/cancel-payment failed', err);
    res.status(500).json({ error: 'Failed to cancel payment' });
  }
});

// Best-effort webhook — see this file's module comment above. MTN's
// callback payload shape isn't confidently documented anywhere
// consulted while building this, so this tries a few plausible field
// names and always logs the raw body (check Railway logs after a real
// test payment to see what MTN actually sends, and adjust the field
// names here if needed) — and always responds 200 so MTN doesn't
// retry-storm an endpoint it thinks is failing.
app.post('/api/payments/momo/callback', async (req, res) => {
  console.log('[momo webhook] received:', JSON.stringify(req.body));
  try {
    const body = req.body || {};
    const referenceId = body.referenceId || body.reference_id || null;
    const externalId = body.externalId || body.external_id || null;
    const status = body.status;

    let purchase = null;
    if (referenceId) purchase = await db.getPurchaseByMomoReferenceId(referenceId);
    if (!purchase && externalId) purchase = await db.getPurchaseById(externalId);

    if (purchase && purchase.paymentMethod === 'momo' && purchase.paymentStatus === 'pending') {
      if (status === 'SUCCESSFUL') {
        const confirmed = await db.confirmMomoPaymentAndCreateOrder(purchase.id);
        if (confirmed && confirmed.deliveryOrderId) {
          const deliveryOrder = await db.getOrder(confirmed.deliveryOrderId);
          if (deliveryOrder) {
            orderRooms(deliveryOrder).forEach((r) => io.to(r).emit('order:created', deliveryOrder));
            notifyNewOrder(deliveryOrder);
          }
        }
      } else if (status === 'FAILED') {
        await db.voidFailedMomoPayment(purchase.id);
      }
    } else if (!purchase) {
      console.warn('[momo webhook] could not match a purchase to this callback — relying on polling instead.');
    }
  } catch (err) {
    console.error('[momo webhook] handling failed (polling will still resolve this)', err);
  }
  res.status(200).json({ ok: true });
});

// Super Admin's manual Mobile Money reconciliation queue — the
// confirm/reject side of the 'momo_manual' checkout flow above. Same
// shape as Featured Placements'/Premium's own Direct-payment queues
// further down this file (GET .../pending, POST .../:id/confirm, POST
// .../:id/reject), just for marketplace purchases: a Super Admin
// checks the platform's real Mobile Money account for a transfer
// matching the reference code and amount, then confirms (which creates
// the real delivery order for the first time — see
// confirmMomoPaymentAndCreateOrder's comment on why order creation is
// deferred until payment resolves) or rejects (which restocks the
// items, same as any other failed/cancelled Mobile Money payment).
app.get('/api/super-admin/marketplace-payments/pending', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const purchases = await db.getPendingManualMomoPurchases();
    res.json({ purchases });
  } catch (err) {
    console.error('GET /api/super-admin/marketplace-payments/pending failed', err);
    res.status(500).json({ error: 'Failed to load pending Mobile Money payments' });
  }
});

app.post('/api/super-admin/marketplace-payments/:id/confirm', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const existing = await db.getPurchaseById(req.params.id);
    if (!existing || existing.paymentMethod !== 'momo_manual') {
      return res.status(404).json({ error: 'Purchase not found' });
    }
    const confirmed = await db.confirmMomoPaymentAndCreateOrder(req.params.id, req.user.id);
    if (!confirmed) return res.status(409).json({ error: 'This payment was already resolved' });
    io.to(`vendor:${confirmed.purchase.vendorId}`).emit('purchase:updated', confirmed.purchase);
    io.to(`user:${confirmed.purchase.customerId}`).emit('purchase:updated', confirmed.purchase);
    if (confirmed.deliveryOrderId) {
      const deliveryOrder = await db.getOrder(confirmed.deliveryOrderId);
      if (deliveryOrder) {
        orderRooms(deliveryOrder).forEach((r) => io.to(r).emit('order:created', deliveryOrder));
        notifyNewOrder(deliveryOrder);
      }
    }
    sendPushToUser(db, confirmed.purchase.customerId, { title: 'Payment confirmed', body: `Your Mobile Money payment (${confirmed.purchase.paymentReference}) was confirmed — your order is on its way.`, url: '/' }); // fire-and-forget
    await logAudit(req, 'marketplace_payment.confirm', { targetType: 'purchase', targetId: existing.id, targetLabel: existing.paymentReference, details: { customerId: existing.customerId, vendorId: existing.vendorId, provider: existing.paymentProvider, amount: existing.grandTotal } });
    res.json({ ok: true, purchase: confirmed.purchase, deliveryOrderId: confirmed.deliveryOrderId });
  } catch (err) {
    console.error('POST /api/super-admin/marketplace-payments/:id/confirm failed', err);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

app.post('/api/super-admin/marketplace-payments/:id/reject', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const existing = await db.getPurchaseById(req.params.id);
    if (!existing || existing.paymentMethod !== 'momo_manual') {
      return res.status(404).json({ error: 'Purchase not found' });
    }
    const purchase = await db.voidFailedMomoPayment(req.params.id);
    if (!purchase) return res.status(409).json({ error: 'This payment was already resolved' });
    io.to(`user:${purchase.customerId}`).emit('purchase:updated', purchase);
    sendPushToUser(db, purchase.customerId, { title: 'Payment not confirmed', body: `We couldn't match a payment for reference ${purchase.paymentReference} — please try again or use Pay on Delivery.`, url: '/' }); // fire-and-forget
    await logAudit(req, 'marketplace_payment.reject', { targetType: 'purchase', targetId: existing.id, targetLabel: existing.paymentReference, details: { customerId: existing.customerId, vendorId: existing.vendorId, provider: existing.paymentProvider } });
    res.json({ ok: true, purchase });
  } catch (err) {
    console.error('POST /api/super-admin/marketplace-payments/:id/reject failed', err);
    res.status(500).json({ error: 'Failed to reject payment' });
  }
});

// ============================================================
// Featured Placements — a vendor pays to boost a product or their
// whole storefront's ranking for a limited window. See the long
// comment on featured_slots in schema.sql and on the db.js functions
// below for the full design (capacity/advisory-lock reasoning, why
// featured_until is always a plain timestamp compare, momo vs direct
// payment). Vendor-facing routes first, then Super Admin config +
// the Direct-payment confirmation queue.
// ============================================================

app.get('/api/vendor/featured/config', requireAuth, requireVendor, async (req, res) => {
  try {
    const [settings, availability, subscription, isPremium] = await Promise.all([
      db.getPlatformSettings(),
      db.getFeaturedSlotAvailability(),
      db.getVendorSubscription(req.user.id),
      db.isVendorPremiumActive(req.user.id),
    ]);
    res.json({
      productPackages: settings.featuredProductPackages,
      vendorPackages: settings.featuredVendorPackages,
      availability,
      momoAvailable: momo.isConfigured,
      // Premium pricing context — see db.getFeaturedPurchasePricing for
      // where this is actually applied at purchase time. Sent here too
      // so the vendor sees the perk (discounted price / free-credit
      // availability) before they even open the purchase form.
      premium: {
        isPremium,
        perk: settings.premiumFeaturingPerk,
        discountPercent: settings.premiumFeaturingDiscountPercent,
        creditsRemaining: subscription ? subscription.featuredBoostCreditsRemaining : 0,
      },
    });
  } catch (err) {
    console.error('GET /api/vendor/featured/config failed', err);
    res.status(500).json({ error: 'Failed to load Featured Placement options' });
  }
});

app.get('/api/vendor/featured/history', requireAuth, requireVendor, async (req, res) => {
  try {
    const slots = await db.getFeaturedSlotsForVendor(req.user.id);
    res.json({ slots });
  } catch (err) {
    console.error('GET /api/vendor/featured/history failed', err);
    res.status(500).json({ error: 'Failed to load your Featured Placement history' });
  }
});

app.post('/api/vendor/featured/purchase', requireAuth, requireVendor, async (req, res) => {
  const { scope, productId, packageId, paymentMethod, phone, useCredit } = req.body || {};
  if (!['product', 'vendor'].includes(scope)) {
    return res.status(400).json({ error: 'scope must be "product" or "vendor"' });
  }
  // useCredit redeems a Premium vendor's included free boost for this
  // period — no payment method needed at all in that case (see
  // db.getFeaturedPurchasePricing / createFeaturedSlotPurchase).
  if (!useCredit && !['momo', 'direct'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'paymentMethod must be "momo" or "direct"' });
  }
  if (scope === 'product' && !productId) {
    return res.status(400).json({ error: 'productId is required when scope is "product"' });
  }
  if (!useCredit && paymentMethod === 'momo' && !momo.isConfigured) {
    return res.status(503).json({ error: 'Mobile Money isn\'t available yet — please use the Direct payment option.' });
  }
  let cleanPhone = null;
  if (!useCredit && paymentMethod === 'momo') {
    cleanPhone = String(phone || '').replace(/[^\d]/g, '');
    if (cleanPhone.length < 8 || cleanPhone.length > 15) {
      return res.status(400).json({ error: 'Enter a valid Mobile Money phone number, digits only (with country code, e.g. 231XXXXXXXXX).' });
    }
  }
  try {
    if (scope === 'product') {
      const product = await db.getProductById(productId);
      if (!product) return res.status(404).json({ error: 'Product not found' });
      if (product.vendorId !== req.user.id) return res.status(403).json({ error: 'Not your product' });
    }
    const settings = await db.getPlatformSettings();
    const packages = scope === 'product' ? settings.featuredProductPackages : settings.featuredVendorPackages;
    const pkg = (packages || []).find(p => p.id === packageId);
    if (!pkg) return res.status(400).json({ error: 'That package is no longer available — reload the options and try again.' });

    // Premium perk pricing — free credit or a standing discount,
    // whichever mode the Super Admin currently has switched on. See
    // db.getFeaturedPurchasePricing for the full logic; non-Premium
    // vendors just get the package's plain price back unchanged.
    const pricing = await db.getFeaturedPurchasePricing(req.user.id, Number(pkg.price));
    if (useCredit && (pricing.perk !== 'credit' || !pricing.creditAvailable)) {
      return res.status(400).json({ error: 'No free Premium boost credit available right now.' });
    }
    const finalPrice = useCredit ? 0 : pricing.finalPrice;
    const effectivePaymentMethod = useCredit ? 'direct' : paymentMethod;

    const momoReferenceId = (!useCredit && paymentMethod === 'momo') ? crypto.randomUUID() : null;
    let slot;
    try {
      slot = await db.createFeaturedSlotPurchase({
        id: crypto.randomUUID(),
        vendorId: req.user.id,
        scope,
        productId: scope === 'product' ? productId : null,
        packageLabel: pkg.label,
        price: finalPrice,
        durationDays: Number(pkg.days),
        paymentMethod: effectivePaymentMethod,
        momoReferenceId,
        momoPhone: cleanPhone,
        useCredit: !!useCredit,
        creditSubscriptionId: useCredit ? pricing.subscriptionId : null,
      });
    } catch (capacityErr) {
      return res.status(409).json({ error: capacityErr.message });
    }

    if (!useCredit && paymentMethod === 'momo') {
      try {
        await momo.requestToPay({
          referenceId: momoReferenceId,
          amount: slot.price,
          externalId: slot.id,
          payerMsisdn: cleanPhone,
          payerMessage: `ONLib Featured Placement`,
          payeeNote: `Featured slot ${slot.id}`,
        });
      } catch (momoErr) {
        // The slot row was already created and is holding capacity —
        // void it the same way a failed checkout momo request is voided,
        // so it doesn't sit there occupying a slot nobody can ever pay.
        await db.voidFailedFeaturedSlotPayment(slot.id);
        console.error('POST /api/vendor/featured/purchase momo initiation failed', momoErr);
        return res.status(400).json({ error: momoErr.message || 'Mobile Money request failed — please try again or use Direct payment.' });
      }
    }

    res.json({ ok: true, slot });
  } catch (err) {
    console.error('POST /api/vendor/featured/purchase failed', err);
    res.status(500).json({ error: 'Failed to start Featured Placement purchase' });
  }
});

// Polling — same reasoning as GET /api/marketplace/purchases/:id/payment-status:
// polling is the reliable mechanism, the webhook below is a best-effort bonus.
app.get('/api/vendor/featured/:id/payment-status', requireAuth, requireVendor, async (req, res) => {
  try {
    const slot = await db.getFeaturedSlotById(req.params.id);
    if (!slot || slot.vendorId !== req.user.id) return res.status(404).json({ error: 'Featured Placement purchase not found' });
    if (slot.paymentMethod !== 'momo' || slot.paymentStatus !== 'pending') {
      return res.json({ paymentStatus: slot.paymentStatus, slot });
    }
    const live = await momo.getRequestToPayStatus(slot.momoReferenceId);
    if (live.status === 'SUCCESSFUL') {
      const confirmed = await db.confirmFeaturedSlotPayment(slot.id);
      return res.json({ paymentStatus: 'successful', slot: confirmed });
    }
    if (live.status === 'FAILED') {
      const voided = await db.voidFailedFeaturedSlotPayment(slot.id);
      return res.json({ paymentStatus: 'failed', reason: live.reason, slot: voided });
    }
    res.json({ paymentStatus: 'pending', slot });
  } catch (err) {
    console.error('GET /api/vendor/featured/:id/payment-status failed', err);
    res.status(500).json({ error: 'Failed to check payment status' });
  }
});

app.post('/api/vendor/featured/:id/cancel-payment', requireAuth, requireVendor, async (req, res) => {
  try {
    const slot = await db.getFeaturedSlotById(req.params.id);
    if (!slot || slot.vendorId !== req.user.id) return res.status(404).json({ error: 'Featured Placement purchase not found' });
    if (slot.paymentMethod !== 'momo' || slot.paymentStatus !== 'pending') {
      return res.status(400).json({ error: 'This purchase is not a pending Mobile Money payment' });
    }
    const voided = await db.voidFailedFeaturedSlotPayment(slot.id);
    res.json({ ok: true, slot: voided });
  } catch (err) {
    console.error('POST /api/vendor/featured/:id/cancel-payment failed', err);
    res.status(500).json({ error: 'Failed to cancel payment' });
  }
});

// ---- Super Admin: package/slot-cap settings + the Direct-payment queue ----

const MAX_FEATURED_PACKAGES = 8;
const MAX_FEATURED_LABEL_LENGTH = 60;

// Shared shape-validation for both package lists — used from the
// PUT /api/super-admin/settings/platform handler below, same endpoint
// every other platform setting already goes through.
function validateFeaturedPackages(packages) {
  if (!Array.isArray(packages) || packages.length === 0 || packages.length > MAX_FEATURED_PACKAGES) {
    return `must be an array of 1-${MAX_FEATURED_PACKAGES} packages`;
  }
  for (const p of packages) {
    if (!p || typeof p !== 'object') return 'each package must be an object';
    if (typeof p.id !== 'string' || !p.id.trim()) return 'each package needs a non-empty id';
    if (typeof p.label !== 'string' || !p.label.trim() || p.label.length > MAX_FEATURED_LABEL_LENGTH) return `each package label must be a non-empty string under ${MAX_FEATURED_LABEL_LENGTH} characters`;
    if (typeof p.days !== 'number' || !Number.isInteger(p.days) || p.days < 1 || p.days > 365) return 'each package days must be a whole number between 1 and 365';
    if (typeof p.price !== 'number' || isNaN(p.price) || p.price < 0 || p.price > 100000) return 'each package price must be a non-negative number';
  }
  return null;
}

app.get('/api/super-admin/featured/pending', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const slots = await db.getPendingDirectFeaturedSlots();
    res.json({ slots });
  } catch (err) {
    console.error('GET /api/super-admin/featured/pending failed', err);
    res.status(500).json({ error: 'Failed to load pending Featured Placement requests' });
  }
});

app.post('/api/super-admin/featured/:id/confirm', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const slot = await db.adminConfirmDirectFeaturedSlot(req.params.id, req.user.id);
    if (!slot) return res.status(409).json({ error: 'This request was already resolved or is not a pending Direct payment' });
    await logAudit(req, 'featured_slot.confirm', { targetType: 'featured_slot', targetId: slot.id, targetLabel: slot.packageLabel, details: { vendorId: slot.vendorId, scope: slot.scope, price: slot.price } });
    res.json({ ok: true, slot });
  } catch (err) {
    console.error('POST /api/super-admin/featured/:id/confirm failed', err);
    res.status(500).json({ error: 'Failed to confirm Featured Placement request' });
  }
});

app.post('/api/super-admin/featured/:id/reject', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const slot = await db.adminRejectDirectFeaturedSlot(req.params.id, req.user.id);
    if (!slot) return res.status(409).json({ error: 'This request was already resolved or is not a pending Direct payment' });
    await logAudit(req, 'featured_slot.reject', { targetType: 'featured_slot', targetId: slot.id, targetLabel: slot.packageLabel, details: { vendorId: slot.vendorId, scope: slot.scope } });
    res.json({ ok: true, slot });
  } catch (err) {
    console.error('POST /api/super-admin/featured/:id/reject failed', err);
    res.status(500).json({ error: 'Failed to reject Featured Placement request' });
  }
});

// ============================================================
// Premium subscription tier — account-wide, recurring vendor upgrade.
// Momo/direct payment machinery here deliberately mirrors the Featured
// Placements routes above line for line (same polling-not-webhook
// reasoning — see momo.js and the marketplace checkout momo flow this
// pattern originated from).
// ============================================================

app.get('/api/vendor/subscription', requireAuth, requireVendor, async (req, res) => {
  try {
    const [subscription, plans, charges, isPremium] = await Promise.all([
      db.getVendorSubscription(req.user.id),
      db.getActiveSubscriptionPlans(),
      db.getSubscriptionChargesForVendor(req.user.id),
      db.isVendorPremiumActive(req.user.id),
    ]);
    res.json({ subscription, plans, charges, isPremium, momoAvailable: momo.isConfigured });
  } catch (err) {
    console.error('GET /api/vendor/subscription failed', err);
    res.status(500).json({ error: 'Failed to load your Premium subscription' });
  }
});

async function startSubscriptionCharge(req, res, { planId }) {
  const { paymentMethod, phone } = req.body || {};
  if (!['momo', 'direct'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'paymentMethod must be "momo" or "direct"' });
  }
  if (paymentMethod === 'momo' && !momo.isConfigured) {
    return res.status(503).json({ error: 'Mobile Money isn\'t available yet — please use the Direct payment option.' });
  }
  let cleanPhone = null;
  if (paymentMethod === 'momo') {
    cleanPhone = String(phone || '').replace(/[^\d]/g, '');
    if (cleanPhone.length < 8 || cleanPhone.length > 15) {
      return res.status(400).json({ error: 'Enter a valid Mobile Money phone number, digits only (with country code, e.g. 231XXXXXXXXX).' });
    }
  }
  const momoReferenceId = paymentMethod === 'momo' ? crypto.randomUUID() : null;
  let result;
  try {
    result = await db.createSubscriptionCharge({
      id: crypto.randomUUID(),
      vendorId: req.user.id,
      planId,
      paymentMethod,
      momoReferenceId,
      momoPhone: cleanPhone,
    });
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }
  const { charge, plan } = result;

  if (paymentMethod === 'momo') {
    try {
      await momo.requestToPay({
        referenceId: momoReferenceId,
        amount: charge.price,
        externalId: charge.id,
        payerMsisdn: cleanPhone,
        payerMessage: `ONLib Premium (${plan.label})`,
        payeeNote: `Subscription charge ${charge.id}`,
      });
    } catch (momoErr) {
      await db.voidFailedSubscriptionCharge(charge.id);
      console.error('Premium subscription momo initiation failed', momoErr);
      return res.status(400).json({ error: momoErr.message || 'Mobile Money request failed — please try again or use Direct payment.' });
    }
  }

  res.json({ ok: true, charge, plan });
}

app.post('/api/vendor/subscription/subscribe', requireAuth, requireVendor, async (req, res) => {
  const { planId } = req.body || {};
  if (!planId) return res.status(400).json({ error: 'planId is required' });
  try {
    await startSubscriptionCharge(req, res, { planId });
  } catch (err) {
    console.error('POST /api/vendor/subscription/subscribe failed', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to start Premium subscription' });
  }
});

// Renews using the vendor's existing plan — no planId needed, so the
// vendor dashboard's "Renew" button can be a single click.
app.post('/api/vendor/subscription/renew', requireAuth, requireVendor, async (req, res) => {
  try {
    const existing = await db.getVendorSubscription(req.user.id);
    if (!existing || !existing.planId) {
      return res.status(404).json({ error: 'No previous subscription plan found to renew — subscribe to a plan first.' });
    }
    await startSubscriptionCharge(req, res, { planId: existing.planId });
  } catch (err) {
    console.error('POST /api/vendor/subscription/renew failed', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to renew Premium subscription' });
  }
});

// Polling — same reasoning as the Featured Placements / marketplace
// checkout momo flows: polling is the reliable mechanism.
app.get('/api/vendor/subscription/charges/:id/payment-status', requireAuth, requireVendor, async (req, res) => {
  try {
    const charge = await db.getSubscriptionChargeById(req.params.id);
    if (!charge) return res.status(404).json({ error: 'Subscription charge not found' });
    const subscription = await db.getVendorSubscription(req.user.id);
    if (!subscription || subscription.id !== charge.subscriptionId) return res.status(404).json({ error: 'Subscription charge not found' });
    if (charge.paymentMethod !== 'momo' || charge.paymentStatus !== 'pending') {
      return res.json({ paymentStatus: charge.paymentStatus, charge });
    }
    const live = await momo.getRequestToPayStatus(charge.momoReferenceId);
    if (live.status === 'SUCCESSFUL') {
      const result = await db.confirmSubscriptionChargePayment(charge.id);
      return res.json({ paymentStatus: 'successful', charge: result.charge, subscription: result.subscription });
    }
    if (live.status === 'FAILED') {
      const voided = await db.voidFailedSubscriptionCharge(charge.id);
      return res.json({ paymentStatus: 'failed', reason: live.reason, charge: voided });
    }
    res.json({ paymentStatus: 'pending', charge });
  } catch (err) {
    console.error('GET /api/vendor/subscription/charges/:id/payment-status failed', err);
    res.status(500).json({ error: 'Failed to check payment status' });
  }
});

app.post('/api/vendor/subscription/charges/:id/cancel-payment', requireAuth, requireVendor, async (req, res) => {
  try {
    const charge = await db.getSubscriptionChargeById(req.params.id);
    if (!charge) return res.status(404).json({ error: 'Subscription charge not found' });
    const subscription = await db.getVendorSubscription(req.user.id);
    if (!subscription || subscription.id !== charge.subscriptionId) return res.status(404).json({ error: 'Subscription charge not found' });
    if (charge.paymentMethod !== 'momo' || charge.paymentStatus !== 'pending') {
      return res.status(400).json({ error: 'This charge is not a pending Mobile Money payment' });
    }
    const voided = await db.voidFailedSubscriptionCharge(charge.id);
    res.json({ ok: true, charge: voided });
  } catch (err) {
    console.error('POST /api/vendor/subscription/charges/:id/cancel-payment failed', err);
    res.status(500).json({ error: 'Failed to cancel payment' });
  }
});

// ---- Super Admin: plan editor + the Direct-payment queue + comps ----

const MAX_SUBSCRIPTION_PLAN_LABEL_LENGTH = 60;

app.get('/api/super-admin/subscription-plans', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const plans = await db.getSubscriptionPlans();
    res.json({ plans });
  } catch (err) {
    console.error('GET /api/super-admin/subscription-plans failed', err);
    res.status(500).json({ error: 'Failed to load subscription plans' });
  }
});

app.post('/api/super-admin/subscription-plans', requireAuth, requireSuperAdmin, async (req, res) => {
  const { label, cycleDays, price } = req.body || {};
  if (typeof label !== 'string' || !label.trim() || label.length > MAX_SUBSCRIPTION_PLAN_LABEL_LENGTH) {
    return res.status(400).json({ error: `label must be a non-empty string under ${MAX_SUBSCRIPTION_PLAN_LABEL_LENGTH} characters` });
  }
  if (typeof cycleDays !== 'number' || !Number.isInteger(cycleDays) || cycleDays < 1 || cycleDays > 3650) {
    return res.status(400).json({ error: 'cycleDays must be a whole number between 1 and 3650' });
  }
  if (typeof price !== 'number' || isNaN(price) || price < 0 || price > 100000) {
    return res.status(400).json({ error: 'price must be a non-negative number' });
  }
  try {
    const plan = await db.createSubscriptionPlan({ id: crypto.randomUUID(), label: label.trim(), cycleDays, price });
    await logAudit(req, 'subscription_plan.create', { targetType: 'subscription_plan', targetId: plan.id, targetLabel: plan.label, details: { cycleDays, price } });
    res.json({ ok: true, plan });
  } catch (err) {
    console.error('POST /api/super-admin/subscription-plans failed', err);
    res.status(500).json({ error: 'Failed to create subscription plan' });
  }
});

app.put('/api/super-admin/subscription-plans/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const { label, cycleDays, price, isActive } = req.body || {};
  const fields = {};
  if (label !== undefined) {
    if (typeof label !== 'string' || !label.trim() || label.length > MAX_SUBSCRIPTION_PLAN_LABEL_LENGTH) {
      return res.status(400).json({ error: `label must be a non-empty string under ${MAX_SUBSCRIPTION_PLAN_LABEL_LENGTH} characters` });
    }
    fields.label = label.trim();
  }
  if (cycleDays !== undefined) {
    if (typeof cycleDays !== 'number' || !Number.isInteger(cycleDays) || cycleDays < 1 || cycleDays > 3650) {
      return res.status(400).json({ error: 'cycleDays must be a whole number between 1 and 3650' });
    }
    fields.cycleDays = cycleDays;
  }
  if (price !== undefined) {
    if (typeof price !== 'number' || isNaN(price) || price < 0 || price > 100000) {
      return res.status(400).json({ error: 'price must be a non-negative number' });
    }
    fields.price = price;
  }
  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be true or false' });
    fields.isActive = isActive;
  }
  try {
    const plan = await db.updateSubscriptionPlan(req.params.id, fields);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    await logAudit(req, 'subscription_plan.update', { targetType: 'subscription_plan', targetId: plan.id, targetLabel: plan.label, details: fields });
    res.json({ ok: true, plan });
  } catch (err) {
    console.error('PUT /api/super-admin/subscription-plans/:id failed', err);
    res.status(500).json({ error: 'Failed to update subscription plan' });
  }
});

app.get('/api/super-admin/subscriptions/pending', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const charges = await db.getPendingDirectSubscriptionCharges();
    res.json({ charges });
  } catch (err) {
    console.error('GET /api/super-admin/subscriptions/pending failed', err);
    res.status(500).json({ error: 'Failed to load pending Premium subscription requests' });
  }
});

app.post('/api/super-admin/subscriptions/charges/:id/confirm', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const result = await db.adminConfirmDirectSubscriptionCharge(req.params.id, req.user.id);
    if (!result) return res.status(409).json({ error: 'This request was already resolved or is not a pending Direct payment' });
    await logAudit(req, 'subscription_charge.confirm', { targetType: 'subscription_charge', targetId: result.charge.id, details: { vendorId: result.subscription.vendorId, price: result.charge.price } });
    res.json({ ok: true, charge: result.charge, subscription: result.subscription });
  } catch (err) {
    console.error('POST /api/super-admin/subscriptions/charges/:id/confirm failed', err);
    res.status(500).json({ error: 'Failed to confirm Premium subscription request' });
  }
});

app.post('/api/super-admin/subscriptions/charges/:id/reject', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const charge = await db.adminRejectDirectSubscriptionCharge(req.params.id, req.user.id);
    if (!charge) return res.status(409).json({ error: 'This request was already resolved or is not a pending Direct payment' });
    await logAudit(req, 'subscription_charge.reject', { targetType: 'subscription_charge', targetId: charge.id, details: {} });
    res.json({ ok: true, charge });
  } catch (err) {
    console.error('POST /api/super-admin/subscriptions/charges/:id/reject failed', err);
    res.status(500).json({ error: 'Failed to reject Premium subscription request' });
  }
});

// Free/comp Premium grants (formerly grant-comp / comp-dates / revoke-comp
// here) were removed platform-wide — see the "Free Premium removed
// entirely" README section for why (the vendor-facing status card could
// get permanently stuck reading "Free — granted by ONLib" even after a
// grant's end date had passed, since ending it only changed dates, not
// status). Premium is now paid-subscription-only; any pre-existing
// admin_comp grant is force-canceled by a one-time migration in
// schema.sql. See db.js's comment above isSubscriptionCurrentlyActive.

app.get('/health', (req, res) => res.json({ ok: true }));

async function seedAdminIfConfigured() {
  // Always ensure the admin account exists — defaults to
  // onlib231@gmail.com / 1Nigeria@ unless overridden via env vars,
  // so the app works immediately with no Railway config required.
  const existing = await db.getUserByEmail(ADMIN_EMAIL);
  if (existing) return; // already seeded
  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  await db.createUser({
    id: crypto.randomUUID(),
    businessName: 'ONLib',
    email: ADMIN_EMAIL,
    passwordHash,
    role: 'admin',
  });
  console.log(`[seed] Created admin account for ${ADMIN_EMAIL}`);
}

// ONLib rebrand — one-time migration for existing deployments. Verta
// used to BE the Manage Agent account; now Manage Agent represents
// ONLib's own operational staff, and Verta operates as an ordinary
// delivery_company account with no special access (see
// seedVertaDeliveryCompanyIfPossible further down — that's unaffected
// by this, Verta keeps its own separate account). This runs before
// seedAdminIfConfigured so that function finds the renamed account
// already in place instead of creating a duplicate at the new email.
async function migrateManageAgentToOnlib() {
  const alreadyMigrated = await db.getUserByEmail(ADMIN_EMAIL);
  if (alreadyMigrated) return; // nothing to do — already at the new email

  const legacy = await db.getUserByEmail(LEGACY_ADMIN_EMAIL);
  if (!legacy || legacy.role !== 'admin') return; // no old account to migrate

  await db.updateManageAgentAccount(legacy.id, {
    businessName: 'ONLib',
    email: ADMIN_EMAIL,
    phone: legacy.phone,
  });
  console.log(`[migrate] Renamed Manage Agent account from ${LEGACY_ADMIN_EMAIL} to ${ADMIN_EMAIL} (ONLib rebrand) — no manual steps required.`);
}

// Super Admin — a distinct role that oversees every Manage Agent
// (admin) account. Defaults to the requested credentials; override via
// env vars in Railway if you want to change them without redeploying
// code.
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'asfliberia@gmail.com';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || '1Liberia';

async function seedSuperAdminIfConfigured() {
  const existing = await db.getUserByEmail(SUPER_ADMIN_EMAIL);
  if (existing) return; // already seeded
  const passwordHash = await hashPassword(SUPER_ADMIN_PASSWORD);
  await db.createUser({
    id: crypto.randomUUID(),
    businessName: 'Super Admin',
    email: SUPER_ADMIN_EMAIL,
    passwordHash,
    role: 'super_admin',
  });
  console.log(`[seed] Created super admin account for ${SUPER_ADMIN_EMAIL}`);
}

// The five agents that used to be a hardcoded client-side constant — now
// real, editable rows. Seeded once so upgrading to this version doesn't
// change anything an admin currently sees; from then on the Fleet
// Directory is fully admin-managed (add/edit) via the UI.
const DEFAULT_AGENTS = [
  { name: 'Titus', phone: '0772558553' },
  { name: 'Emmanuel', phone: '0760566696' },
  { name: 'Augustine', phone: '0772558559' },
  { name: 'Boima', phone: '0778643650' },
  { name: 'Arthur', phone: '0772558557' },
];

async function seedAgentsIfEmpty() {
  const count = await db.countAgents();
  if (count > 0) return; // already seeded (or admin has since managed the list)
  for (const agent of DEFAULT_AGENTS) {
    await db.createAgent({ id: crypto.randomUUID(), name: agent.name, phone: agent.phone });
  }
  console.log(`[seed] Seeded ${DEFAULT_AGENTS.length} default agents`);
}

// Marketplace's first real vendor. Defaults to the requested name and a
// generated login; override via env vars before first boot if you want
// a different email/password.
const VENDOR_EMAIL = process.env.VENDOR_EMAIL || 'girleefashion@golib.test';
const VENDOR_PASSWORD = process.env.VENDOR_PASSWORD || 'GirleeFashion1';

async function seedVendorIfConfigured() {
  const existing = await db.getUserByEmail(VENDOR_EMAIL);
  if (existing) return; // already seeded
  const passwordHash = await hashPassword(VENDOR_PASSWORD);
  await db.createUser({
    id: crypto.randomUUID(),
    businessName: 'Girlee Fashion',
    email: VENDOR_EMAIL,
    passwordHash,
    role: 'vendor',
  });
  console.log(`[seed] Created vendor account "Girlee Fashion" for ${VENDOR_EMAIL}`);
}

// Backward compatibility for the new multi-provider delivery system:
// every agent that existed before this feature (or was added without
// an explicit company) gets linked to the primary admin account —
// Verta Delivery Service's own fleet becomes company #1 in a system
// that now supports more than one, rather than a special case that
// works differently from every company added after it. Safe to run
// on every boot: only touches agents that don't already have a
// delivery_company_id set.
async function migrateAgentsToDeliveryCompany() {
  const admin = await db.getUserByEmail(ADMIN_EMAIL);
  if (!admin) return; // shouldn't happen — seedAdminIfConfigured runs first
  const linkedCount = await db.linkOrphanedAgentsToCompany(admin.id);
  if (linkedCount > 0) {
    console.log(`[migrate] Linked ${linkedCount} existing agent(s) to Verta Delivery Service (${ADMIN_EMAIL}) as their delivery company.`);
  }
}

// Verta's own delivery_company account — "one of the delivery service
// providers," separate from the Manage Agent account, which continues
// to exist for business-level oversight: Reports, Order History,
// Expenses, Business Profile. Uses its own distinct email — no
// conflict with Manage Agent's existing email, no rename required
// first, no waiting for anything to free up. Creates immediately on
// the next restart.
async function seedVertaDeliveryCompanyIfPossible() {
  const existing = await db.getUserByEmail(VERTA_DC_EMAIL);
  if (existing) return; // already seeded

  const passwordHash = await hashPassword(VERTA_DC_PASSWORD);
  const company = await db.createUser({
    id: crypto.randomUUID(),
    businessName: 'Verta Delivery Service',
    email: VERTA_DC_EMAIL,
    passwordHash,
    role: 'delivery_company',
    approvalStatus: 'approved',
  });
  console.log(`[seed] Created Verta Delivery Service (delivery_company) account for ${VERTA_DC_EMAIL}`);

  // Moves the existing fleet (agents + their order history) from
  // whoever currently holds the Manage Agent account over to this new
  // one — works whether or not Manage Agent has been renamed to a
  // different email, since this looks up ADMIN_EMAIL's current holder
  // either way.
  const manageAgent = await db.getUserByEmail(ADMIN_EMAIL);
  if (manageAgent && manageAgent.id !== company.id) {
    const { agentsMoved, ordersMoved } = await db.reassignFleetToCompany(manageAgent.id, company.id);
    if (agentsMoved > 0 || ordersMoved > 0) {
      console.log(`[seed] Moved ${agentsMoved} agent(s) and ${ordersMoved} order(s) from Manage Agent to Verta Delivery Service.`);
    }
  }
}

// Storefront hero carousel's starting content — 3 generic slides (no
// real product photos were available at build time; see the comment
// in seed-data/default-home-banners.js) so the carousel launches with
// real, distinct visuals instead of empty. Same empty-table guard as
// seedAgentsIfEmpty above: runs once, only while home_banners is
// empty, so it never fights with anything Super Admin does afterward
// (editing, reordering, hiding, deleting — including deleting all 3,
// which is left empty rather than re-seeded, since that's a deliberate
// admin choice at that point, not an uninitialized table anymore).
async function seedHomeBannersIfEmpty() {
  const count = await db.countHomeBanners();
  if (count > 0) return; // already seeded (or admin has since managed the list)
  for (const banner of DEFAULT_HOME_BANNERS) {
    await db.createHomeBanner({ id: crypto.randomUUID(), ...banner });
  }
  console.log(`[seed] Seeded ${DEFAULT_HOME_BANNERS.length} default home banner slides`);
}

// Best-effort hourly scan for Premium subscriptions entering their
// renewal window — see db.getSubscriptionsNeedingReminder for the full
// reasoning on why this is safe to run as a plain in-process interval
// rather than a real cron/queue: reminders are advisory (a missed one
// because of a Railway restart just means the vendor gets it on the
// next hourly tick, or relies on the in-app "renews in Xd" badge
// instead), unlike current_period_end itself, which is never dependent
// on this process staying alive. Runs once at startup too, so a
// reminder due right after a deploy doesn't wait up to an hour.
const PREMIUM_REMINDER_INTERVAL_MS = 60 * 60 * 1000;
async function runPremiumReminderScan() {
  try {
    const due = await db.getSubscriptionsNeedingReminder();
    for (const sub of due) {
      try {
        await notifySubscriptionRenewalDue(
          { businessName: sub.vendorName, email: sub.vendorEmail, phone: sub.vendorPhone },
          sub
        );
      } catch (sendErr) {
        console.error(`[premium-reminder] Failed to notify vendor ${sub.vendorId}`, sendErr);
        continue; // don't mark as sent if it never actually went out
      }
      await db.markSubscriptionReminderSent(sub.id);
      await db.logPremiumReminderSent(sub.vendorId, sub.id);
    }
    if (due.length) console.log(`[premium-reminder] Sent ${due.length} renewal reminder(s)`);
  } catch (err) {
    console.error('[premium-reminder] Scan failed', err);
  }
}
function startPremiumReminderScheduler() {
  runPremiumReminderScan();
  setInterval(runPremiumReminderScan, PREMIUM_REMINDER_INTERVAL_MS);
}

// Best-effort periodic scan for products that have dropped to/below the
// vendor's own low-stock threshold — same in-process-interval reasoning
// as the Premium reminder scan above (advisory, not safety-critical; a
// missed tick just means the vendor is alerted on the next one, or sees
// the in-app low-stock badge in the meantime). Runs once at startup too.
const LOW_STOCK_SCAN_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes
async function runLowStockScan() {
  try {
    const due = await db.getProductsNeedingLowStockAlert();
    for (const product of due) {
      try {
        await notifyLowStock(
          { businessName: product.vendorName, email: product.vendorEmail, phone: product.vendorPhone },
          product
        );
      } catch (sendErr) {
        console.error(`[low-stock] Failed to notify vendor ${product.vendorId} about product ${product.id}`, sendErr);
        continue; // don't mark as sent if it never actually went out
      }
      await db.markLowStockAlertSent(product.id);
    }
    if (due.length) console.log(`[low-stock] Sent ${due.length} low-stock alert(s)`);
  } catch (err) {
    console.error('[low-stock] Scan failed', err);
  }
}
function startLowStockScheduler() {
  runLowStockScan();
  setInterval(runLowStockScan, LOW_STOCK_SCAN_INTERVAL_MS);
}

// Promotes due scheduled "Send a Package" orders to real, accept-ready
// 'pending' orders — see the design comment on scheduled_for/recurrence
// in schema.sql. Same in-process-interval reasoning as the two scans
// above: a missed tick just means the order goes live a minute later
// than scheduled, never earlier and never silently lost (getPendingOrders
// still won't see it until this promotes it). Runs once a minute, not
// once at startup like the other two, since a freshly-restarted server
// has nothing due in the first second it's up.
const SCHEDULED_ORDER_SWEEP_INTERVAL_MS = 60 * 1000;
async function runScheduledOrderSweep() {
  try {
    const due = await db.getScheduledOrdersDue();
    for (const order of due) {
      const promoted = await db.promoteScheduledOrder(order.id);
      if (!promoted) continue; // another tick already promoted it — stay safe, don't double-fire
      orderRooms(promoted).forEach((r) => io.to(r).emit('order:created', promoted));
      notifyNewOrder(promoted);
      // A recurring order re-schedules a fresh copy of itself, cycled
      // ahead from *this* occurrence's original scheduled_for (not
      // "now"), so a late sweep tick never compounds drift into future
      // occurrences.
      if (order.recurrence) {
        const nextScheduledFor = new Date(order.scheduledFor);
        nextScheduledFor.setDate(nextScheduledFor.getDate() + (order.recurrence === 'weekly' ? 7 : 1));
        const nextOrder = await db.createOrder({
          id: `ORD-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
          senderId: order.senderId,
          senderName: order.senderName,
          pickupAddress: order.pickupAddress,
          dropoffAddress: order.dropoffAddress,
          itemDescription: order.itemDescription,
          amount: null,
          status: 'scheduled',
          placedByAdmin: order.placedByAdmin,
          scheduledFor: nextScheduledFor,
          recurrence: order.recurrence,
        });
        io.to(`user:${nextOrder.senderId}`).to('admins').emit('order:created', nextOrder);
      }
    }
    if (due.length) console.log(`[scheduled-orders] Promoted ${due.length} scheduled order(s)`);
  } catch (err) {
    console.error('[scheduled-orders] Sweep failed', err);
  }
}
function startScheduledOrderScheduler() {
  setInterval(runScheduledOrderSweep, SCHEDULED_ORDER_SWEEP_INTERVAL_MS);
}

db.init()
  .then(migrateManageAgentToOnlib)
  .then(seedAdminIfConfigured)
  .then(seedSuperAdminIfConfigured)
  .then(seedVendorIfConfigured)
  .then(seedAgentsIfEmpty)
  .then(seedHomeBannersIfEmpty)
  .then(migrateAgentsToDeliveryCompany)
  .then(seedVertaDeliveryCompanyIfPossible)
  .then(() => {
    server.listen(PORT, () => console.log(`Verta Delivery server listening on :${PORT}`));
    startPremiumReminderScheduler();
    startLowStockScheduler();
    startScheduledOrderScheduler();
  })
  .catch((err) => {
    console.error('Failed to initialize database', err);
    process.exit(1);
  });
