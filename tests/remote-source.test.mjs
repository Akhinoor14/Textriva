// /api/fetch-doc core: allow-list, SSRF guards, redirect re-check, type/size limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSourceUrl, fetchDoc } from '../api/_fetchdoc.js';

const req = (u, extra = {}) => new Request('https://textriva.vercel.app/api/fetch-doc?url=' + encodeURIComponent(u), { headers: extra });
const pdfRes = (body = '%PDF-1.4 x') => new Response(body, { status: 200, headers: { 'content-type': 'application/pdf' } });

test('allow-list accepts r2.dev / kuetx, rejects others', () => {
  assert.ok(checkSourceUrl('https://pub-abc.r2.dev/a/b.pdf', {}));
  assert.ok(checkSourceUrl('https://www.kuetx.com/x.pdf', {}));
  assert.equal(checkSourceUrl('https://evil.com/a.pdf', {}), null);
  assert.equal(checkSourceUrl('https://r2.dev.evil.com/a.pdf', {}), null);
  assert.equal(checkSourceUrl('http://pub-abc.r2.dev/a.pdf', {}), null);
  assert.equal(checkSourceUrl('https://127.0.0.1/a.pdf', {}), null);
  assert.equal(checkSourceUrl('https://u:p@pub-abc.r2.dev/a.pdf', {}), null);
  assert.equal(checkSourceUrl('https://pub-abc.r2.dev:8443/a.pdf', {}), null);
  assert.ok(checkSourceUrl('https://files.example.org/a.pdf', { FETCH_ALLOWED_HOSTS: 'files.example.org' }));
});

test('streams a PDF back with its name', async () => {
  const r = await fetchDoc(req('https://pub-abc.r2.dev/FESE/ME2213/Regular_2024.pdf'), {}, async () => pdfRes());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(decodeURIComponent(r.headers.get('x-name')), 'Regular_2024.pdf');
  assert.equal(await r.text(), '%PDF-1.4 x');
});

test('blocked host never calls fetch', async () => {
  let called = false;
  const r = await fetchDoc(req('https://evil.com/a.pdf'), {}, async () => { called = true; return pdfRes(); });
  assert.equal(r.status, 400); assert.equal(called, false);
});

test('redirect to a disallowed host is refused', async () => {
  const f = async () => new Response(null, { status: 302, headers: { location: 'https://evil.com/x.pdf' } });
  const r = await fetchDoc(req('https://pub-abc.r2.dev/a.pdf'), {}, f);
  assert.equal(r.status, 400);
});

test('html and oversized files are refused; non-GET and cross-site refused', async () => {
  let r = await fetchDoc(req('https://pub-abc.r2.dev/a.pdf'), {}, async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
  assert.equal(r.status, 415);
  r = await fetchDoc(req('https://pub-abc.r2.dev/a.pdf'), {}, async () => new Response('x', { headers: { 'content-type': 'application/pdf', 'content-length': String(200 * 1024 * 1024) } }));
  assert.equal(r.status, 413);
  r = await fetchDoc(new Request('https://textriva.vercel.app/api/fetch-doc?url=x', { method: 'POST' }), {}, async () => pdfRes());
  assert.equal(r.status, 405);
  r = await fetchDoc(req('https://pub-abc.r2.dev/a.pdf', { 'sec-fetch-site': 'cross-site' }), {}, async () => pdfRes());
  assert.equal(r.status, 403);
});
