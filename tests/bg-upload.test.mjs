// Background auto-upload: every page gets uploaded without clicking anything,
// a few at a time, failures retry on their own, nothing is uploaded twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, addPages, tick } from './_app.mjs';

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await tick(20); }
  return false;
}

test('all pages upload automatically, in parallel but capped', async () => {
  const w = await bootApp({ bgUpload: true });
  const A = w.__app;
  let inFlight = 0, maxInFlight = 0, calls = 0;
  w.fetch = async (url) => {
    calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await tick(15);
    inFlight--;
    return { ok: true, status: 200, json: async () => ({ success: true, url: 'https://i.ibb.co/p' + calls + '.jpg' }) };
  };
  addPages(w, Array(30).fill(''), 'big.pdf');
  A.pumpUploads();
  const ok = await waitFor(() => A.state.pages.every(p => p.status === 'ready' && p.remoteUrl));
  assert.ok(ok, 'not every page reached ready');
  assert.equal(calls, 30, 'each page uploaded exactly once');
  assert.ok(maxInFlight > 3, 'should upload many pages at once, not just 3');
  assert.ok(maxInFlight <= A.UPLOAD_CONCURRENCY, 'must respect concurrency cap');
  w.close();
});

test('failed uploads are retried automatically and never block the rest', async () => {
  const w = await bootApp({ bgUpload: true });
  const A = w.__app;
  const seen = {};
  w.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body).image;
    seen[body] = (seen[body] || 0) + 1;
    await tick(5);
    if (body === btoa(String.fromCharCode(1, 2, 3, 2)) && seen[body] <= 3) {   // page 3 fails its first attempts
      return { ok: false, status: 500, json: async () => ({ success: false, error: 'boom' }) };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, url: 'https://i.ibb.co/' + Math.random() + '.jpg' }) };
  };
  addPages(w, Array(5).fill(''), 'x.pdf');
  A.pumpUploads();
  // the other 4 pages finish while page 3 is failing/cooling down
  const others = await waitFor(() => A.state.pages.filter(p => p.status === 'ready').length >= 4, 20000);
  assert.ok(others, 'healthy pages must not wait for the failing one');
  w.close();
});

test('pages that already have text (done) and fresh links are skipped', async () => {
  const w = await bootApp({ bgUpload: true });
  const A = w.__app;
  let calls = 0;
  w.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ success: true, url: 'https://i.ibb.co/z.jpg' }) }; };
  addPages(w, ['text one', '', 'text three', ''], 'mix.pdf');
  A.state.pages[3].remoteUrl = 'https://i.ibb.co/fresh.jpg'; A.state.pages[3].remoteAt = Date.now(); A.state.pages[3].status = 'ready';
  A.pumpUploads();
  await waitFor(() => A.state.pages[1].status === 'ready');
  await tick(100);
  assert.equal(calls, 1, 'only the one page that needs an upload is uploaded');
  w.close();
});

test('upload order starts at the current page and wraps around', async () => {
  const w = await bootApp({ bgUpload: true });
  const A = w.__app;
  addPages(w, Array(6).fill(''), 'o.pdf');
  A.state.current = 4;
  assert.equal(A.pickNextUpload(), 4);
  A.state.pages[4].status = 'ready'; A.state.pages[4].remoteUrl = 'u'; A.state.pages[4].remoteAt = Date.now();
  assert.equal(A.pickNextUpload(), 5);
  A.state.pages[5].status = 'done';
  assert.equal(A.pickNextUpload(), 0, 'wraps to the first page');
  w.close();
});
