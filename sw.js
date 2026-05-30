/* ─────────────────────────────────────────────────────────────
   Outstanding Record Book — Service Worker
   Strategy:
     • App shell (index.html, manifest, icons) → Cache-first
     • Firebase API calls                      → Network-only (never cache)
     • Everything else                         → Network-first, fallback to cache
   ───────────────────────────────────────────────────────────── */

const CACHE_NAME   = 'record-book-v3';
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// URLs that must NEVER be served from cache
const NETWORK_ONLY_PATTERNS = [
  'firebaseio.com',
  'identitytoolkit.googleapis.com',
  'googleapis.com',
  'api.anthropic.com'
];

/* ── INSTALL: pre-cache the app shell ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())   // activate immediately, don't wait for old SW to die
  );
});

/* ── ACTIVATE: delete old caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())  // take control of all open tabs immediately
  );
});

/* ── FETCH: smart routing ── */
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // 1. Skip non-GET requests (POST to Firebase, etc.)
  if (event.request.method !== 'GET') return;

  // 2. Network-only: Firebase & external APIs — never cache, always fresh
  if (NETWORK_ONLY_PATTERNS.some(p => url.includes(p))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. App shell assets — Cache-first (instant load, works offline)
  const isShell = SHELL_ASSETS.some(asset => {
    const assetPath = asset.replace('./', '');
    return url.endsWith(assetPath) || url.endsWith('/') || url.endsWith('/index.html');
  });

  if (isShell) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) {
          // Serve from cache immediately, revalidate in background
          const networkFetch = fetch(event.request).then(response => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
          }).catch(() => {});
          return cached;
        }
        // Not in cache yet — fetch and cache
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200) return response;
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // 4. Everything else — Network-first, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

/* ── MESSAGE: force update from UI ── */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
