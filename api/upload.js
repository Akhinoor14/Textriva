// Vercel Serverless Function — /api/upload
// Receives { image: base64string } from the browser, uploads to imgbb using
// the IMGBB_KEY env var (never exposed to the client), returns { success, url }.
//
// Setup: Vercel Dashboard → Settings → Environment Variables → IMGBB_KEY (Sensitive)
//
// Hardening (Phase 0):
//  - origin check (only this site's own origin may call this endpoint)
//  - max body size (base64 image capped at ~12 MB to match client-side compression)
//  - simple in-memory rate limit (per IP, per serverless instance — best-effort only;
//    for strict limits put this behind Vercel's Edge Config / a KV store instead)

const MAX_BODY_BYTES = 12 * 1024 * 1024; // ~12MB base64 (client compresses before upload)
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 600; // per IP per window (একটানা parallel background upload)

// Best-effort in-memory store. Resets whenever the serverless instance recycles;
// this is a soft guard against runaway/looped clients, not a security boundary.
const rateBuckets = globalThis.__textrivaRateBuckets || (globalThis.__textrivaRateBuckets = new Map());

function isAllowedOrigin(req) {
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true; // not configured → skip check (set ALLOWED_ORIGINS to enable)
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  return allowed.some(a => origin.startsWith(a) || referer.startsWith(a));
}

// ── Multi-key failover ─────────────────────────────────────────────────────
// Env: IMGBB_KEY, IMGBB_KEY_2, IMGBB_KEY_3 ... (অথবা IMGBB_KEYS=k1,k2,k3)
// কোনো key rate-limit খেলে ৬০ সেকেন্ড "ঠান্ডা" থাকে, ততক্ষণ বাকি key ব্যবহার হয়।
const keyCooldown = globalThis.__textrivaKeyCooldown || (globalThis.__textrivaKeyCooldown = new Map());
let rrIndex = globalThis.__textrivaRR || 0;
const KEY_COOLDOWN_MS = 60 * 1000;

function getKeys() {
  const list = [];
  if (process.env.IMGBB_KEYS) list.push(...process.env.IMGBB_KEYS.split(','));
  list.push(process.env.IMGBB_KEY);
  for (let i = 2; i <= 10; i++) list.push(process.env['IMGBB_KEY_' + i]);
  return [...new Set(list.map(k => (k || '').trim()).filter(Boolean))];
}

function orderedKeys(keys) {
  // round-robin শুরু, তারপর cooldown-এ থাকা key সবার শেষে
  const now = Date.now();
  const start = rrIndex++ % keys.length;
  globalThis.__textrivaRR = rrIndex;
  const rotated = keys.map((_, i) => keys[(start + i) % keys.length]);
  const ready = rotated.filter(k => (keyCooldown.get(k) || 0) <= now);
  const cooling = rotated.filter(k => (keyCooldown.get(k) || 0) > now);
  return [...ready, ...cooling];
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ success: false, error: 'Forbidden origin' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ success: false, error: 'Too many requests, please slow down' });
  }

  try {
    const { image } = req.body || {};
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ success: false, error: 'No image data' });
    }
    if (image.length > MAX_BODY_BYTES) {
      return res.status(413).json({ success: false, error: 'Image too large' });
    }

    const keys = getKeys();
    if (keys.length === 0) {
      console.error('No IMGBB key is set');
      return res.status(500).json({ success: false, error: 'Upload service not configured' });
    }

    // expiration দেওয়া হয় না → link কখনো expire হয় না (client 7 দিন পর safety re-upload করে)
    let lastMsg = '', allRateLimited = true;

    for (const key of orderedKeys(keys)) {
      const form = new FormData();
      form.append('image', image);

      let imgbbRes, raw;
      try {
        imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${key}`,
          { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
        raw = await imgbbRes.text();
      } catch (e) {
        allRateLimited = false;
        lastMsg = 'network/timeout';
        console.error('imgbb fetch failed (key #' + (keys.indexOf(key) + 1) + '):', e.message || e);
        continue;   // পরের key-তে চেষ্টা
      }

      let data = null;
      try { data = JSON.parse(raw); } catch (_) { /* non-JSON */ }

      if (data && data.success) {
        return res.status(200).json({ success: true, url: data.data.url });
      }

      const msg = data?.error?.message || data?.status_txt || `HTTP ${imgbbRes.status}`;
      const rl = imgbbRes.status === 429 || data?.error?.code === 100 || /rate limit/i.test(msg);
      lastMsg = msg;
      console.error('imgbb failure (key #' + (keys.indexOf(key) + 1) + '/' + keys.length + '):',
        imgbbRes.status, msg, String(raw).slice(0, 200).replace(/key=[^&\s]+/g, 'key=***'));
      if (rl) keyCooldown.set(key, Date.now() + KEY_COOLDOWN_MS);
      else allRateLimited = false;
    }

    // সব key ফেল
    return res.status(allRateLimited ? 429 : 502)
      .json({ success: false, error: 'Image host error: ' + lastMsg });

  } catch (err) {
    console.error('Upload error:', err.message || err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
