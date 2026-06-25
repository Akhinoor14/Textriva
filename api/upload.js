// Vercel Serverless Function — /api/upload
// Receives { image: base64string } from browser
// Uploads to imgbb using IMGBB_KEY env variable
// Returns { success: true, url: "https://i.ibb.co/..." }
//
// Setup: Vercel Dashboard → Settings → Environment Variables → IMGBB_KEY (Sensitive)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'No image data' });

    const form = new FormData();
    form.append('image', image);
    form.append('expiration', '600'); // 10 min, then auto-deleted

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
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
