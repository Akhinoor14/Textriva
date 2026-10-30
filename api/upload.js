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
const RATE_LIMIT_MAX_REQUESTS = 30; // per IP per window

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

    if (!process.env.IMGBB_KEY) {
      console.error('IMGBB_KEY is not set');
      return res.status(500).json({ success: false, error: 'Upload service not configured' });
    }

    const form = new FormData();
    form.append('image', image);
    form.append('expiration', '1800'); // 30 min — matches client REMOTE_TTL expectations

    const imgbbRes = await fetch(
      `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_KEY}`,
      { method: 'POST', body: form }
    );

    const data = await imgbbRes.json();

    if (!data.success) {
      throw new Error(data.error?.message || 'imgbb upload failed');
    }

    return res.status(200).json({ success: true, url: data.data.url });

  } catch (err) {
    console.error('Upload error:', err.message || err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
