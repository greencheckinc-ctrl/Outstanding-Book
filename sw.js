/* ════════════════════════════════════════════════════════════════════════
   sw.js — Outstanding Record Book Service Worker
   Version: 3.0 (PWA Real-time Sync Fix)

   STRATEGY:
   ─────────
   • Firebase REST / SSE URLs → NETWORK ONLY (never cached)
     Firebase Realtime Database URLs contain firebaseio.com,
     googleapis.com (Identity Toolkit), identitytoolkit.googleapis.com.
     Caching these causes Device B to read Device A's old data from cache
     instead of getting live data — the #1 cause of PWA sync mismatch.

   • App Shell (index.html, icons, manifest) → NETWORK FIRST, fallback cache
     Always try to fetch a fresh copy; serve cached version only when offline.

   • Google Fonts → CACHE FIRST (stable CDN, safe to cache)

   • Everything else → NETWORK FIRST with cache fallback

   KEY PWA FIX: The old sw.js (if any existed) may have used Cache-First or
   StaleWhileRevalidate for ALL requests, causing Firebase responses to be
   served from cache and never updating — making real-time sync impossible
   in the installed PWA even though the browser worked fine.
   ════════════════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'ug-v3';
const CACHE_NAME    = CACHE_VERSION;

// App shell files — cached for offline use
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ── Domains that must NEVER be cached ──
// These are live Firebase / Google API endpoints.
// ANY caching here breaks real-time sync.
const NEVER_CACHE_HOSTS = [
  'firebaseio.com',              // Firebase Realtime Database REST + SSE
  'googleapis.com',              // Firebase Identity Toolkit auth
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',  // Token refresh
  'firebasestorage.googleapis.com',
  'firebaseapp.com',
];

// ── Install: pre-cache app shell ──
self.addEventListener('install', event => {
  console.log('[SW] Installing v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache app shell — failures are non-fatal (offline install is best-effort)
      return cache.addAll(APP_SHELL).catch(err => {
        console.warn('[SW] App shell pre-cache partial failure:', err);
      });
    }).then(() => self.skipWaiting()) // activate immediately
  );
});

// ── Activate: delete old caches ──
self.addEventListener('activate', event => {
  console.log('[SW] Activating v' + CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim()) // take control of all open tabs immediately
  );
});

// ── Fetch: routing logic ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ── 1. Firebase / Google API → NETWORK ONLY — never touch cache ──
  const isFirebase = NEVER_CACHE_HOSTS.some(host => url.hostname.includes(host));
  if (isFirebase) {
    // Pass through with no-store to bypass any upstream caches too
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(err => {
        // Offline: return a minimal JSON error so app can handle gracefully
        return new Response(JSON.stringify({ error: 'offline', message: err.message }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // ── 2. EventSource (SSE) — must NOT be intercepted by SW ──
  // EventSource connections to Firebase must bypass the SW entirely.
  // If the SW intercepts them, the browser can't keep the streaming
  // connection alive properly in installed PWA mode.
  if (event.request.headers.get('Accept') === 'text/event-stream') {
    event.respondWith(fetch(event.request));
    return;
  }

  // ── 3. POST / PUT / DELETE → NETWORK ONLY ──
  // Mutations must always go to the network. Never serve from cache.
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // ── 4. Google Fonts → CACHE FIRST (stable, safe) ──
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // ── 5. App Shell → NETWORK FIRST, cache fallback ──
  // Always try network first so PWA gets the latest version.
  // Only fall back to cache when truly offline.
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then(res => {
        // Cache successful responses for offline fallback
        if (res && res.ok && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => {
        // Network failed — serve from cache (offline mode)
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Return offline fallback for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// ── Message handler: SKIP_WAITING from main app ──
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING received — activating immediately');
    self.skipWaiting();
  }
});

// ── Background Sync (Future-proofing) ──
// When online event fires and background sync is supported, the app
// can register 'firebase-sync' to flush offline queue automatically
// even when the app tab is closed.
self.addEventListener('sync', event => {
  if (event.tag === 'firebase-sync') {
    // Notify all open clients to run SyncManager.syncPendingChanges()
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => client.postMessage({ type: 'BG_SYNC_FIRE' }));
      })
    );
  }
});
