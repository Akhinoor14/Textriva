// Textriva Service Worker — v1.3
const CACHE = 'textriva-v4';

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

// ── Fetch: network-first for the app shell, cache-first for static assets ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept API calls
  if (url.pathname.startsWith('/api/')) return;

  // External origins (Google Fonts, CDNs) — network only
  if (url.origin !== self.location.origin) return;

  // Only handle GET
  if (e.request.method !== 'GET') return;

  e.respondWith(
    (e.request.mode === 'navigate' || url.pathname === '/index.html'
      ? fetch(e.request)
          .then(res => {
            if (res && res.status === 200 && res.type !== 'opaque') {
              const clone = res.clone();
              caches.open(CACHE).then(c => c.put(e.request, clone));
            }
            return res;
          })
          .catch(() => caches.match(e.request).then(cached => cached || caches.match('/index.html')))
      : caches.match(e.request).then(cached => {
          if (cached) return cached;

          return fetch(e.request)
            .then(res => {
              if (res && res.status === 200 && res.type !== 'opaque') {
                const clone = res.clone();
                caches.open(CACHE).then(c => c.put(e.request, clone));
              }
              return res;
            })
            .catch(() => new Response('', { status: 503, statusText: 'Offline' }));
        })
    )
  );
});