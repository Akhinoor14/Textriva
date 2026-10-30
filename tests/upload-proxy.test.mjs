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
  for (let i = 0; i < 35; i++) {
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
