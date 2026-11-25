// Cloudflare Pages Function — GET /api/fetch-doc (same core as the Vercel edge function)
import { fetchDoc } from '../../api/_fetchdoc.js';

export async function onRequestGet(context) {
  return fetchDoc(context.request, context.env || {});
}
