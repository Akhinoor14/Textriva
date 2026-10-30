// Textriva Service Worker — v1.7 (Phase 9: share target + offline CDN cache)
const CACHE = 'textriva-v15';

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
      Promise.all(keys.filter(k => k !== CACHE && k !== 'textriva-share').map(k => caches.delete(k)))
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

// ── Web Share Target: POST /share-target → park the files in a cache, redirect to the app ──
const SHARE_CACHE = 'textriva-share';
async function handleShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter(f => f && typeof f === 'object' && 'size' in f);
    const cache = await caches.open(SHARE_CACHE);
    for (const k of await cache.keys()) await cache.delete(k);
    let i = 0;
    for (const f of files) {
      await cache.put('/__share/' + (i++), new Response(f, { headers: { 'x-name': encodeURIComponent(f.name || 'shared'), 'content-type': f.type || 'application/octet-stream' } }));
    }
    return Response.redirect('/?shared=' + files.length, 303);
  } catch (e) {
    return Response.redirect('/', 303);
  }
}

// CDN libraries (pdf.js, JSZip, Tesseract, fonts) are cached after the first online use so the app also starts offline.
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
async function handleCdn(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') { const clone = response.clone(); caches.open(CACHE).then(c => c.put(request, clone)); }
    return response;
  } catch { return new Response('', { status: 503, statusText: 'Offline' }); }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share-target') {
    event.respondWith(handleShare(event.request));
    return;
  }
  if (event.request.method === 'GET' && CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(handleCdn(event.request));
    return;
  }

  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) return;

  event.respondWith(handleFetch(event.request));
});