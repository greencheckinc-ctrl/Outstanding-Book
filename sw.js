/* ══════════════════════════════════════════════════════════════════════
   SERVICE WORKER — NETWORK-FIRST STRATEGY
   ─────────────────────────────────────────────────────────────────────
   WHY THIS MATTERS:
   The old caching strategy (whatever it was) let the installed PWA keep
   serving an OLD cached copy of the app even after a new index.html was
   uploaded to hosting — because the browser only re-checks for updates
   when THIS FILE (sw.js) changes byte-for-byte, and a plain "upload a new
   index.html" deploy doesn't touch sw.js at all. Result: some devices kept
   running old, buggy JS indefinitely — including the very Firebase-login
   bug we'd already fixed — because they never actually received the fix.

   THE FIX:
   This version always tries the NETWORK FIRST for every request. If the
   device is online, it ALWAYS gets the latest deployed files — no manual
   cache-busting, no version bumps to remember on every deploy. The cache
   is only ever used as an OFFLINE FALLBACK (when there's no internet).
   ══════════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'ugharani-offline-cache-v1';
// Only bump this if you ever want to force-wipe every device's offline
// cache from scratch. You do NOT need to bump it for normal app updates —
// network-first already handles that automatically.

const OFFLINE_FALLBACK_URLS = [
  './',
  './index.html',
  './manifest.json'
];

// ── INSTALL: pre-warm the offline cache, activate immediately ──
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(OFFLINE_FALLBACK_URLS))
      .catch(() => {}) // don't block install if one of these fails
  );
});

// ── ACTIVATE: clean up any old-named caches from previous versions ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Allow index.html to force-activate a waiting worker instantly ──
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── FETCH: network-first, cache as offline fallback only ──
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Don't try to cache/intercept cross-origin API calls (Firebase, Supabase,
  // etc.) — only handle same-origin app files. Let those go straight through.
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Fresh copy from network — always prefer this. Update the offline
        // cache in the background so offline mode stays reasonably current.
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, copy).catch(() => {});
          }).catch(() => {});
        }
        return networkResponse;
      })
      .catch(() => {
        // Offline, or network request failed — fall back to cache.
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline — no cached copy available', {
            status: 503,
            statusText: 'Offline'
          });
        });
      })
  );
});
