// ── Outstanding Record Book — Service Worker ──
const CACHE_NAME = 'ugharani-v3';

// Files to pre-cache on install
const PRECACHE_URLS = [
  './',
  './index.html'
];

// ── INSTALL: pre-cache app shell ──
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE_URLS).catch(function(err) {
        // If index.html not found (e.g. named differently), just open cache
        console.warn('[SW] Pre-cache partial fail:', err.message);
      });
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE: delete old caches ──
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ── FETCH: network-first with cache fallback ──
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;

  var url = e.request.url;

  // Never intercept Firebase, Supabase, Google APIs, Anthropic — always live
  if (
    url.includes('firebaseio.com') ||
    url.includes('googleapis.com') ||
    url.includes('supabase.co') ||
    url.includes('anthropic.com') ||
    url.includes('fonts.gstatic.com') ||
    url.includes('fonts.googleapis.com')
  ) return;

  e.respondWith(
    fetch(e.request).then(function(response) {
      // Cache successful responses
      if (response && response.status === 200) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(e.request, clone);
        });
      }
      return response;
    }).catch(function() {
      // Network failed — serve from cache
      return caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        // Fallback to app shell for navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('./') || caches.match('./index.html');
        }
      });
    })
  );
});
