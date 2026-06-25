// Textriva Service Worker — v1.0
const CACHE = 'textriva-v1';

// Files to cache on install (app shell)
const SHELL = [
  '/',
  '/index.html',
  '/site.webmanifest',
  '/assets/brand/favicon.svg',
  '/assets/brand/icon-192.png',
  '/assets/brand/icon-512.png',
];

// ── Install: cache shell ──────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  self.skipWaiting();
});

// ── Activate: delete old caches ───────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: cache-first for shell, network-first for API ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache API calls
  if (url.pathname.startsWith('/api/')) return;

  // Google Fonts / external — network only
  if (!url.origin.includes(self.location.origin)) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;

      return fetch(e.request)
        .then(res => {
          // Cache successful GET responses
          if (e.request.method === 'GET' && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => {
          // Offline fallback — serve index.html for navigation
          if (e.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
    })
  );
});
