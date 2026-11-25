// Shared core of /api/fetch-doc (Vercel Edge + Cloudflare Pages both use it).
//
// Job: KUETx (or any allow-listed site) sends the browser to
//   https://textriva.vercel.app/?src=<document url>&title=<name>
// The page then calls  GET /api/fetch-doc?url=<document url>  and this function
// fetches the file SERVER-SIDE (so no CORS problem, nothing is saved to the
// user's disk) and streams the bytes back. The page turns them into a File and
// runs the normal upload flow.
//
// Security (this is an open-proxy-shaped endpoint, so it is locked down):
//  - https only, port 443 only, no user:pass@, no IP-literal hosts
//  - host must be on the allow-list (defaults below + env FETCH_ALLOWED_HOSTS)
//  - every redirect hop is re-checked against the same rules (max 3 hops)
//  - only PDF / image / text-ish content types are passed through
//  - hard size cap (streamed, so it is enforced even without Content-Length)
//  - same-origin / ALLOWED_ORIGINS check, like /api/upload

export const DEFAULT_ALLOWED_HOSTS = [
  '*.r2.dev',          // KUETx question-bank PDFs (pub-xxxx.r2.dev)
  'kuetx.com', '*.kuetx.com',
  'xiedu.kuetx.com',
  'i.ibb.co',          // imgbb page images (legacy ?img= links)
];
export const MAX_BYTES = 60 * 1024 * 1024;   // 60 MB
const MAX_HOPS = 3;
const OK_TYPES = /^(application\/pdf|application\/octet-stream|binary\/octet-stream|image\/(png|jpe?g|webp|gif)|text\/plain)(;|$)/i;

export function allowedHosts(env) {
  const extra = String((env && env.FETCH_ALLOWED_HOSTS) || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return [...DEFAULT_ALLOWED_HOSTS, ...extra];
}

function hostMatches(host, pattern) {
  if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1;
  return host === pattern;
}

// Returns the parsed URL if it may be fetched, otherwise null.
export function checkSourceUrl(raw, env) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '443') return null;
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost') return null; // IP literals / localhost
  if (!allowedHosts(env).some(p => hostMatches(host, p))) return null;
  return u;
}

function originOk(request, env) {
  const allowed = String((env && env.ALLOWED_ORIGINS) || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('origin') || '';
  const referer = request.headers.get('referer') || '';
  const self = new URL(request.url).origin;
  // Browser same-origin GETs carry no Origin header but do carry Sec-Fetch-Site.
  const sfs = request.headers.get('sec-fetch-site');
  if (sfs && sfs !== 'same-origin') return false;
  if (!allowed.length) return true;
  return [self, ...allowed].some(a => origin.startsWith(a) || referer.startsWith(a));
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

function niceName(u, title) {
  let n = (title || '').trim();
  if (!n) { try { n = decodeURIComponent(u.pathname.split('/').pop() || ''); } catch { n = ''; } }
  n = (n || 'document').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
  return n;
}

export async function fetchDoc(request, env = {}, fetchImpl = fetch) {
  if (request.method !== 'GET') return json(405, { success: false, error: 'Method not allowed' });
  if (!originOk(request, env)) return json(403, { success: false, error: 'Forbidden origin' });

  const reqUrl = new URL(request.url);
  let target = checkSourceUrl(reqUrl.searchParams.get('url'), env);
  if (!target) return json(400, { success: false, error: 'This source is not allowed' });

  let res;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    try {
      res = await fetchImpl(target.href, { redirect: 'manual', headers: { 'user-agent': 'Textriva-fetch/1.0', accept: 'application/pdf,image/*,*/*;q=0.5' } });
    } catch {
      return json(502, { success: false, error: 'Could not reach the source' });
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = checkSourceUrl(new URL(res.headers.get('location'), target).href, env);
      if (!next) return json(400, { success: false, error: 'Redirect target not allowed' });
      target = next; res = null; continue;
    }
    break;
  }
  if (!res) return json(508, { success: false, error: 'Too many redirects' });
  if (!res.ok) return json(res.status === 404 ? 404 : 502, { success: false, error: 'Source answered ' + res.status });

  const type = res.headers.get('content-type') || '';
  if (!OK_TYPES.test(type)) return json(415, { success: false, error: 'Unsupported file type' });
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return json(413, { success: false, error: 'File too large' });

  // Stream through a byte counter so the cap holds even with no Content-Length.
  let seen = 0;
  const limiter = new TransformStream({
    transform(chunk, ctl) {
      seen += chunk.byteLength;
      if (seen > MAX_BYTES) ctl.error(new Error('too large')); else ctl.enqueue(chunk);
    },
  });
  const isPdf = /pdf/i.test(type) || /\.pdf$/i.test(target.pathname);
  const headers = new Headers({
    'content-type': isPdf ? 'application/pdf' : type,
    'x-name': encodeURIComponent(niceName(target, reqUrl.searchParams.get('title'))),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  if (declared) headers.set('content-length', String(declared));
  return new Response(res.body.pipeThrough(limiter), { status: 200, headers });
}
