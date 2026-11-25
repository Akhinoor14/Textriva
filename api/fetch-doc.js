// Vercel Edge Function — GET /api/fetch-doc?url=<allow-listed document url>&title=<name>
// (Edge runtime streams the body, so Vercel's 4.5 MB Node-function response limit does not apply.)
import { fetchDoc } from './_fetchdoc.js';

export const config = { runtime: 'edge' };

export default function handler(request) {
  return fetchDoc(request, {
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    FETCH_ALLOWED_HOSTS: process.env.FETCH_ALLOWED_HOSTS,
  });
}
