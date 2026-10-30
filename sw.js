// Textriva Service Worker — v1.6 (Phase 1: duplicate protection)
const CACHE = 'textriva-v12';

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
async function handleFetch(request) {
  const url = new URL(request.url);
  const isAppShell = request.mode === 'navigate' || url.pathname === '/index.html';

  if (isAppShell) {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, clone));
      }
      return response;
    } catch {
      return (await caches.match(request)) || caches.match('/index.html');
    }
  }

  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, clone));
    }
    return response;
  } catch {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) return;

  event.respondWith(handleFetch(event.request));
});