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

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    // DEBUG: key পাচ্ছে কিনা চেক
    const keyPresent = !!env.IMGBB_KEY;
    const keyLength = env.IMGBB_KEY ? env.IMGBB_KEY.length : 0;
    const keyPreview = env.IMGBB_KEY ? env.IMGBB_KEY.slice(0, 4) + '...' : 'MISSING';

    const { image } = await request.json();
    if (!image) {
      return new Response(JSON.stringify({
        error: 'No image data',
        debug: { keyPresent, keyLength, keyPreview }
      }), { status: 400, headers });
    }

    const form = new FormData();
    form.append('image', image);
    form.append('expiration', '600');

    const imgbbUrl = `https://api.imgbb.com/1/upload?key=${env.IMGBB_KEY}`;
    const res = await fetch(imgbbUrl, { method: 'POST', body: form });
    const data = await res.json();

    // DEBUG: imgbb raw response
    if (!data.success) {
      return new Response(JSON.stringify({
        error: data.error?.message || 'imgbb upload failed',
        debug: { keyPresent, keyLength, keyPreview, imgbbStatus: res.status, imgbbResponse: data }
      }), { status: 500, headers });
    }

    return new Response(JSON.stringify({
      success: true,
      url: data.data.url,
    }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message || 'Internal server error',
      debug: { keyPresent: !!env.IMGBB_KEY, stack: err.stack }
    }), { status: 500, headers });
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