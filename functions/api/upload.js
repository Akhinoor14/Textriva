// Cloudflare Pages Function — /api/upload
// Receives { image: base64string } from the browser, uploads to imgbb using
// the IMGBB_KEY secret (set in CF Dashboard → Settings → Variables → Encrypt).
// Returns { success: true, url } on success, { success: false, error } on failure.
//
// Hardening (Phase 0):
//  - origin check via ALLOWED_ORIGINS env var (comma-separated)
//  - max body size check
//  - simple in-memory rate limit (per IP, per isolate — best-effort only)
//  - no debug fields (key length/preview/stack) ever returned to the client

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;

const rateBuckets = globalThis.__textrivaRateBuckets || (globalThis.__textrivaRateBuckets = new Map());

function isAllowedOrigin(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  const origin = request.headers.get('origin') || '';
  const referer = request.headers.get('referer') || '';
  return allowed.some(a => origin.startsWith(a) || referer.startsWith(a));
}

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  return bucket.count <= RATE_LIMIT_MAX_REQUESTS;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  };

  if (!isAllowedOrigin(request, env)) {
    return new Response(JSON.stringify({ success: false, error: 'Forbidden origin' }), { status: 403, headers });
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(ip)) {
    return new Response(JSON.stringify({ success: false, error: 'Too many requests, please slow down' }), { status: 429, headers });
  }

  try {
    const bodyText = await request.text();
    if (bodyText.length > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ success: false, error: 'Image too large' }), { status: 413, headers });
    }

    let image;
    try {
      ({ image } = JSON.parse(bodyText));
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), { status: 400, headers });
    }

    if (!image || typeof image !== 'string') {
      return new Response(JSON.stringify({ success: false, error: 'No image data' }), { status: 400, headers });
    }

    if (!env.IMGBB_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'Upload service not configured' }), { status: 500, headers });
    }

    const form = new FormData();
    form.append('image', image);
    form.append('expiration', '1800');

    const imgbbUrl = `https://api.imgbb.com/1/upload?key=${env.IMGBB_KEY}`;
    const res = await fetch(imgbbUrl, { method: 'POST', body: form });
    const data = await res.json();

    if (!data.success) {
      return new Response(JSON.stringify({ success: false, error: data.error?.message || 'imgbb upload failed' }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ success: true, url: data.data.url }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), { status: 500, headers });
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
