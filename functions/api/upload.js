// Cloudflare Worker Function — /api/upload
// Receives { image: base64string } from browser
// Uploads to imgbb using IMGBB_KEY secret (set in CF Dashboard → Settings → Variables → Encrypt)
// Returns { success: true, url: "https://i.ibb.co/..." }
//
// Setup:
//   Cloudflare Dashboard → Workers → textriva → Settings → Variables
//   → Add variable: IMGBB_KEY = your_api_key → click Encrypt → Save

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const { image } = await request.json();
    if (!image) {
      return new Response(JSON.stringify({ error: 'No image data' }), { status: 400, headers });
    }

    // Upload to imgbb
    const form = new FormData();
    form.append('image', image); // base64 string, no prefix needed
    form.append('expiration', '600'); // 10 min — enough for Google Lens, then auto-deleted

    const res = await fetch(`https://api.imgbb.com/1/upload?key=${env.IMGBB_KEY}`, {
      method: 'POST',
      body: form,
    });

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error?.message || 'imgbb upload failed');
    }

    return new Response(JSON.stringify({
      success: true,
      url: data.data.url,
    }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers,
    });
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
