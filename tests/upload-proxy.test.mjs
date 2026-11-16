// Exercises api/upload.js directly with a mock req/res (no real network).
// Confirms: method/origin/body-size/rate-limit guards and that failures never
// leak the imgbb key.
import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/upload.js';

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end() { return this; },
  };
  return res;
}

test('rejects non-POST methods', async () => {
  const req = { method: 'GET', headers: {}, socket: {} };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test('rejects missing image field', async () => {
  const req = { method: 'POST', headers: {}, socket: {}, body: {} };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
});

test('rejects oversized image payload', async () => {
  const req = {
    method: 'POST', headers: {}, socket: {},
    body: { image: 'A'.repeat(13 * 1024 * 1024) },
  };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 413);
});

test('500 response never contains the word "imgbb key" or an actual key value', async () => {
  // No IMGBB_KEY set in this test env -> handler should fail closed, safely.
  const originalKey = process.env.IMGBB_KEY;
  delete process.env.IMGBB_KEY;
  const req = { method: 'POST', headers: {}, socket: {}, body: { image: 'Zm9v' } };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.stringify(res.body).includes('IMGBB_KEY'), false);
  if (originalKey !== undefined) process.env.IMGBB_KEY = originalKey;
});

test('enforces per-IP rate limit after many rapid requests', async () => {
  const ip = '203.0.113.9';
  let lastStatus;
  for (let i = 0; i < 605; i++) {
    const req = {
      method: 'POST',
      headers: { 'x-forwarded-for': ip },
      socket: {},
      body: {}, // will 400 before reaching imgbb, but still counts toward rate limit
    };
    const res = mockRes();
    await handler(req, res);
    lastStatus = res.statusCode;
  }
  assert.equal(lastStatus, 429);
});

// ── multi-key failover ──
function withKeys(keys, fn) {
  return async () => {
    const saved = {}; for (const k of ['IMGBB_KEY', 'IMGBB_KEYS', ...Array.from({ length: 9 }, (_, i) => 'IMGBB_KEY_' + (i + 2))]) { saved[k] = process.env[k]; delete process.env[k]; }
    keys.forEach((k, i) => { process.env[i ? 'IMGBB_KEY_' + (i + 1) : 'IMGBB_KEY'] = k; });
    globalThis.__textrivaKeyCooldown?.clear(); globalThis.__textrivaKeyBad?.clear();
    const realFetch = globalThis.fetch;
    try { await fn(); } finally { globalThis.fetch = realFetch; for (const k in saved) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
  };
}
const post = async () => { const res = mockRes(); await handler({ method: 'POST', headers: { 'x-forwarded-for': '198.51.100.' + Math.floor(Math.random() * 200) }, socket: {}, body: { image: 'QUJD' } }, res); return res; };
const imgbb = (status, body) => ({ status, text: async () => JSON.stringify(body) });
const OK = imgbb(200, { success: true, data: { url: 'https://i.ibb.co/x.jpg' } });

test('failover: rate-limited key hands over to next key in the SAME request', withKeys(['AAAA1', 'BBBB1', 'CCCC1'], async () => {
  const seen = [];
  globalThis.fetch = async url => { const k = /key=([^&]+)/.exec(url)[1]; seen.push(k); return k === 'AAAA1' ? imgbb(429, { error: { message: 'Rate limit reached' } }) : OK; };
  let ok = 0;
  for (let i = 0; i < 4; i++) { if ((await post()).statusCode === 200) ok++; }
  assert.equal(ok, 4);
  assert.equal(seen.filter(k => k === 'AAAA1').length, 1, 'limited key left alone during cooldown');
}));

test('all keys rate-limited → 429 + Retry-After, imgbb not hammered during cooldown', withKeys(['AAAA2', 'BBBB2'], async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return imgbb(429, { error: { message: 'Rate limit reached' } }); };
  const r1 = await post();
  assert.equal(r1.statusCode, 429); assert.ok(r1.headers['Retry-After']);
  const before = calls;
  const r2 = await post();
  assert.equal(r2.statusCode, 429);
  assert.equal(calls, before, 'no extra imgbb calls while all keys cooling');
}));

test('INVALID key is reported as invalid (not rate limit), skipped, good key works', withKeys(['BAD3', 'GOOD3'], async () => {
  globalThis.fetch = async url => /key=BAD3/.test(url) ? imgbb(400, { error: { message: 'Invalid API v1 key.', code: 100 } }) : OK;
  for (let i = 0; i < 3; i++) assert.equal((await post()).statusCode, 200);
}));

test('only invalid keys → 502 with clear message (not 429)', withKeys(['BAD4'], async () => {
  globalThis.fetch = async () => imgbb(400, { error: { message: 'Invalid API v1 key.', code: 100 } });
  const r = await post();
  assert.equal(r.statusCode, 502); assert.match(r.body.error, /invalid/i);
}));

test('GET ?status reports key counts, never key values', withKeys(['SECRETKEY5', 'SECRETKEY6'], async () => {
  const res = mockRes();
  await handler({ method: 'GET', url: '/api/upload?status', headers: {}, socket: {} }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.keysConfigured, 2);
  assert.ok(!JSON.stringify(res.body).includes('SECRET'));
}));

test('status: per-key name/state/counters, no key values; STATUS_TOKEN protects it', withKeys(['SECRETKEY7', 'BADKEY7'], async () => {
  globalThis.fetch = async url => /key=BADKEY7/.test(url) ? imgbb(400, { error: { message: 'Invalid API v1 key.', code: 100 } }) : OK;
  for (let i = 0; i < 3; i++) await post();
  const res = mockRes();
  await handler({ method: 'GET', url: '/api/upload?status', headers: {}, socket: {} }, res);
  const names = res.body.keys.map(k => k.name);
  assert.deepEqual(names.sort(), ['IMGBB_KEY', 'IMGBB_KEY_2']);
  const bad = res.body.keys.find(k => k.name === 'IMGBB_KEY_2');
  assert.equal(bad.state, 'invalid');
  const good = res.body.keys.find(k => k.name === 'IMGBB_KEY');
  assert.ok(good.uploaded >= 1);
  assert.ok(!JSON.stringify(res.body).includes('SECRETKEY') && !JSON.stringify(res.body).includes('BADKEY'));
  process.env.STATUS_TOKEN = 'tok123';
  try {
    const r1 = mockRes(); await handler({ method: 'GET', url: '/api/upload?status', headers: {}, socket: {} }, r1);
    assert.equal(r1.statusCode, 401);
    const r2 = mockRes(); await handler({ method: 'GET', url: '/api/upload?status&token=tok123', headers: {}, socket: {} }, r2);
    assert.equal(r2.statusCode, 200);
  } finally { delete process.env.STATUS_TOKEN; }
}));
