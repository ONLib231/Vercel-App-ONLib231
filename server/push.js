// push.js — real Web Push (VAPID) notifications, no third-party account
// needed (unlike Firebase Cloud Messaging or a paid push provider — the
// user explicitly chose this option). Uses the standard `web-push`
// package, which just needs a VAPID keypair; it talks directly to each
// browser's push service (Chrome/Firefox/Edge's own infrastructure), no
// signup required.
//
// WHERE TO ADD YOUR KEYS:
// Set these in server/.env (local) or Railway's Variables tab
// (production). Same graceful-no-op pattern as notify.js — leave unset
// and push sends just quietly no-op with a console warning, nothing
// else in the app breaks.
//
//   VAPID_PUBLIC_KEY   — from `npx web-push generate-vapid-keys`
//   VAPID_PRIVATE_KEY  — from the same command
//   VAPID_SUBJECT       — a mailto: or https: URL push services can use
//                          to contact you if something's wrong (defaults
//                          to mailto:onlib231@gmail.com)
//
// See README.md → "Setting up Web Push notifications" for full,
// step-by-step setup instructions (generating keys, testing locally).

const webpush = require('web-push');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:onlib231@gmail.com';

const isConfigured = Boolean(PUBLIC_KEY && PRIVATE_KEY);

if (!isConfigured) {
  console.log(
    '[push] VAPID keys not set — Web Push notifications are disabled. ' +
    'Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable them (see README). ' +
    'Generate a pair with: npx web-push generate-vapid-keys'
  );
} else {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
}

// Sends one push message to every subscription a user has registered
// (they may have more than one — e.g. a phone and a laptop both
// subscribed). Takes db as a parameter rather than require()-ing it, to
// avoid a circular dependency (db.js doesn't need to know about push.js).
// A subscription that comes back 404/410 (Not Found/Gone) is dead — the
// browser or OS unregistered it on its own end — so it's deleted here
// rather than left to fail silently forever on every future send.
async function sendPushToUser(db, userId, { title, body, url }) {
  if (!isConfigured) return; // silently skip — nothing else in the app depends on this
  if (!userId) return;
  let subscriptions;
  try {
    subscriptions = await db.getPushSubscriptionsForUser(userId);
  } catch (err) {
    console.error('[push] Failed to load subscriptions for user', userId, err);
    return;
  }
  if (!subscriptions.length) return;

  const payload = JSON.stringify({ title, body: body || '', url: url || '/' });
  await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Dead subscription — the browser/OS dropped it on its own end.
        await db.deletePushSubscriptionByEndpoint(sub.endpoint).catch(() => {});
      } else {
        console.error(`[push] Send failed for user ${userId}`, err.statusCode || err.message);
      }
    }
  }));
}

module.exports = { sendPushToUser, isConfigured, publicKey: PUBLIC_KEY };
