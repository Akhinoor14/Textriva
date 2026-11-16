import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getModuleSource } from './_extract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// The two keys that used to be hard-coded in the client (Phase 0 removed them).
const OLD_LEAKED_KEYS = [
  '67cd74715bea46c247e48155e2c6d8e6',
  '4ef55f2fecee8424ce5a46bc1ee6ceac',
];

test('no hard-coded imgbb API key string anywhere in index.html', () => {
  for (const key of OLD_LEAKED_KEYS) {
    assert.equal(html.includes(key), false, `leaked key ${key} still present in index.html`);
  }
  assert.equal(html.includes('IMGBB_KEYS'), false, 'IMGBB_KEYS constant should be removed from client');
});

test('client uploads go through the /api/upload proxy, not api.imgbb.com directly', () => {
  const source = getModuleSource();
  assert.match(source, /fetch\('\/api\/upload'/);
  assert.equal(source.includes('api.imgbb.com'), false, 'client should never call imgbb directly');
});

test('Cloudflare function does not leak key length/preview/stack to the client', () => {
  const fnSrc = readFileSync(path.join(__dirname, '..', 'functions', 'api', 'upload.js'), 'utf8');
  assert.equal(fnSrc.includes('keyPreview'), false);
  assert.equal(fnSrc.includes('keyLength'), false);
  assert.equal(fnSrc.includes('err.stack'), false);
});

test('Vercel proxy reads the key only from process.env, never a literal', () => {
  const fnSrc = readFileSync(path.join(__dirname, '..', 'api', 'upload.js'), 'utf8');
  assert.match(fnSrc, /process\.env\.IMGBB_KEY/);
  for (const key of OLD_LEAKED_KEYS) {
    assert.equal(fnSrc.includes(key), false);
  }
});

test('vercel.json declares a Content-Security-Policy header', () => {
  const vercelJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const headerBlocks = vercelJson.headers.flatMap(h => h.headers);
  const csp = headerBlocks.find(h => h.key === 'Content-Security-Policy');
  assert.ok(csp, 'CSP header missing from vercel.json');
  assert.match(csp.value, /cdnjs\.cloudflare\.com/);
  assert.match(csp.value, /accounts\.google\.com/);
  assert.match(csp.value, /www\.googleapis\.com/);
  assert.match(csp.value, /lens\.google\.com/);
});
