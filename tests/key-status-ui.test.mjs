// Main-page "Keys" button: shows imgbb key state from /api/upload?status, no upload needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, tick } from './_app.mjs';

const payload = {
  success: true, keysConfigured: 4, ready: 2, coolingDown: 1, invalid: 1,
  keys: [
    { name: 'IMGBB_KEY', state: 'ready', retryInSec: 0, uploaded: 5, rateLimited: 0, invalidHits: 0, otherErrors: 0, lastOkAgoSec: 12, lastError: null, lastErrorAgoSec: null },
    { name: 'IMGBB_KEY_2', state: 'invalid', retryInSec: 500, uploaded: 0, rateLimited: 0, invalidHits: 3, otherErrors: 0, lastOkAgoSec: null, lastError: 'Invalid API v1 key.', lastErrorAgoSec: 30 },
    { name: 'IMGBB_KEY_3', state: 'cooling', retryInSec: 40, uploaded: 2, rateLimited: 4, invalidHits: 0, otherErrors: 0, lastOkAgoSec: 300, lastError: 'Rate limit reached.', lastErrorAgoSec: 20 },
    { name: 'IMGBB_KEY_4', state: 'ready', retryInSec: 0, uploaded: 1, rateLimited: 0, invalidHits: 0, otherErrors: 0, lastOkAgoSec: 5, lastError: null, lastErrorAgoSec: null },
  ],
};

test('Keys button opens a modal listing every key (incl. newly added ones) with state and counters', async () => {
  const w = await bootApp();
  w.fetch = async url => { assert.match(String(url), /\/api\/upload\?status/); return { status: 200, json: async () => payload }; };
  w.document.getElementById('keyBtn').click();
  await tick(20);
  assert.ok(w.document.getElementById('keyModal').classList.contains('open'));
  const html = w.document.getElementById('keyContent').innerHTML;
  for (const n of ['IMGBB_KEY', 'IMGBB_KEY_2', 'IMGBB_KEY_3', 'IMGBB_KEY_4']) assert.ok(html.includes(n), n);
  assert.match(html, /Rate limit reached/);
  assert.equal(w.document.getElementById('keyBadge').textContent, '2/4');
  assert.ok(w.document.getElementById('keyBadge').classList.contains('k-warn'));
  w.document.getElementById('keyClose').click();
  assert.ok(!w.document.getElementById('keyModal').classList.contains('open'));
  w.close();
});

test('status 401 (STATUS_TOKEN set) shows a clear message instead of breaking', async () => {
  const w = await bootApp();
  w.fetch = async () => ({ status: 401, json: async () => ({ success: false }) });
  w.document.getElementById('keyBtn').click();
  await tick(20);
  assert.match(w.document.getElementById('keyContent').textContent, /STATUS_TOKEN/);
  w.close();
});
