// Textriva Service Worker — v1.1
const CACHE = 'textriva-v2';

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

  // Never intercept API calls — let them pass through
  if (url.pathname.startsWith('/api/')) return;

  // External origins (Google Fonts, CDNs etc.) — network only, don't intercept
  if (url.origin !== self.location.origin) return;

  // Only handle GET requests
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;

      return fetch(e.request)
        .then(res => {
          // Cache only valid responses
          if (res && res.status === 200 && res.type !== 'opaque') {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => {
          // Offline fallback
          if (e.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          // For other resources (images, SVGs etc.) — return empty 503
          return new Response('', {
            status: 503,
            statusText: 'Offline',
          });
        });
    })
  );
});