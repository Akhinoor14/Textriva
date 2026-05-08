// Vercel Serverless Function — /api/upload
// Receives { image: base64string } from browser
// Forwards to imgbb.com API server-side (no CORS issues)
// Returns { success: true, url: "https://..." }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'No image data' });

    // imgbb.com free public API key (32MB limit, permanent storage)
    // Get your own free key at: https://api.imgbb.com/
    const KEY = process.env.IMGBB_KEY || '6d207e02198a847aa98d0a2a901485a2';

    const params = new URLSearchParams();
    params.append('key', KEY);
    params.append('image', image);
    // Set expiration to 0 = keep forever (free tier)
    params.append('expiration', '0');

    const response = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await response.json();
    console.log('imgbb response status:', response.status, 'success:', data.success);

    if (data.success) {
      return res.status(200).json({
        success: true,
        url: data.data.url,
        display_url: data.data.display_url,
        thumb: data.data.thumb?.url || data.data.url,
      });
    }

    // imgbb failed — return error with details
    const errMsg = data.error?.message || data.status_txt || `imgbb error (${response.status})`;
    console.error('imgbb error:', JSON.stringify(data));
    return res.status(502).json({ error: errMsg, imgbb_response: data });

  } catch (err) {
    console.error('Upload handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
