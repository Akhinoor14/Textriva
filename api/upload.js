// Vercel Serverless Function — /api/upload
// Receives { image: base64string } from browser
// Stores via @vercel/blob (vercel-storage.com — never ISP-blocked)
// Returns { success: true, url: "https://...vercel-storage.com/..." }
//
// Setup:
//   1. Vercel Dashboard → Storage → Blob → Create Store
//   2. vercel env add BLOB_READ_WRITE_TOKEN  (or paste in Dashboard → Settings → Env Vars)
//   3. npm i @vercel/blob  (add to package.json)

import { put } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'No image data' });

    const buf = Buffer.from(image, 'base64');
    const filename = `textriva/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

    const blob = await put(filename, buf, {
      access: 'public',
      contentType: 'image/jpeg',
    });

    return res.status(200).json({ success: true, url: blob.url });

  } catch (err) {
    console.error('Upload handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
