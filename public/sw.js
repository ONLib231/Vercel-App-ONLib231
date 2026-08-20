// sw.js — minimal service worker, just enough to satisfy PWA
// installability criteria (a registered SW with a fetch handler) and
// give a usable app shell if the network briefly drops. This is NOT a
// full offline-first architecture — API calls always go to the network
// first, since this app's data changes in real time and stale cached
// data would be actively misleading (an old order list, wrong stock
// counts, etc).
const CACHE_NAME = 'golib-shell-v1';
const APP_SHELL = ['/', '/manifest.json', '/assets/icon-192.png', '/assets/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls or the Socket.io connection — always real,
  // live data.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Web Push (VAPID) — real background notifications, distinct from the
// foreground-only Notification API used elsewhere in the app. See
// server/push.js for the send side. This is the only place a push
// message actually becomes a visible OS notification; everything the
// server sends is a plain JSON payload of { title, body, url }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    // Not valid JSON — fall back to a generic notification rather than
    // dropping it silently.
  }
  const title = data.title || 'ONLib';
  const options = {
    body: data.body || '',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking the notification focuses an already-open tab if one exists,
// rather than always opening a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
