// Every slow click must give visible feedback, lock against double-clicks, and never hang silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootApp } from './_app.mjs';

const $ = (w, id) => w.document.getElementById(id);

test('runBusy: acknowledges at once, locks the button, ignores double clicks, always cleans up', async () => {
  const w = await bootApp({ drive: true }); const A = w.__app;
  const btn = $(w, 'driveSaveBtn'); let calls = 0, release;
  const gate = new Promise(r => { release = r; });
  const first = A.runBusy(btn, 'Working…', async () => { calls++; await gate; });
  assert.ok(!$(w, 'workBar').classList.contains('hidden'), 'indicator visible immediately');
  assert.equal($(w, 'workMsg').textContent, 'Working…');
  assert.equal(btn.getAttribute('aria-busy'), 'true'); assert.ok(btn.classList.contains('is-busy'));
  await A.runBusy(btn, 'Working…', async () => { calls++; });          // second click while busy
  assert.equal(calls, 1, 'double click ignored');
  release(); await first;
  assert.ok($(w, 'workBar').classList.contains('hidden'));
  assert.ok(!btn.classList.contains('is-busy') && !btn.hasAttribute('aria-busy'));
  await assert.rejects(A.runBusy(btn, 'x', async () => { throw new Error('boom'); }), /boom/);
  assert.ok($(w, 'workBar').classList.contains('hidden'), 'cleans up after an error too');
  assert.ok(!btn.classList.contains('is-busy'));
  w.close();
});

test('work indicator shows a determinate progress bar and hides it again', async () => {
  const w = await bootApp({ drive: true }); const A = w.__app;
  A.work.start('Downloading…'); A.work.update('Page 2 / 4', 50);
  assert.equal($(w, 'workFill').style.width, '50%'); assert.ok(!$(w, 'workProg').classList.contains('hidden'));
  A.work.update('Preparing…', null); assert.ok($(w, 'workProg').classList.contains('hidden'));
  A.work.end(); assert.ok($(w, 'workBar').classList.contains('hidden'));
  w.close();
});

test('Drive requests time out with a readable message instead of hanging forever', async () => {
  const w = await bootApp({ drive: true }); const A = w.__app;
  A.gdrive.token = 'tok'; A.gdrive.exp = Date.now() + 3600e3;
  w.fetch = (url, o) => new Promise((_, rej) => { o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const t0 = Date.now();
  await assert.rejects(A.dfetch('https://www.googleapis.com/drive/v3/files/x', { method: 'POST', timeoutMs: 40 }), /সাড়া দিচ্ছে না|not responding/);
  assert.ok(Date.now() - t0 < 2000);
  w.close();
});

test('a dropped connection on a read is retried before the user ever sees an error', async () => {
  const w = await bootApp({ drive: true }); const A = w.__app;
  A.gdrive.token = 'tok'; A.gdrive.exp = Date.now() + 3600e3;
  let n = 0;
  w.fetch = async () => { if (++n < 2) throw new TypeError('Failed to fetch'); return { ok: true, status: 200, json: async () => ({ ok: 1 }) }; };
  const r = await A.dfetch('https://www.googleapis.com/drive/v3/files/x');
  assert.equal(n, 2); assert.equal((await r.json()).ok, 1);
  w.close();
});

test('wiring: Drive open reports each step; Library actions are guarded; sign-in cannot hang', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(src, /Downloading page \$\{i \+ 1\} of \$\{total\}/);
  assert.match(src, /const guard = BUSY\[act\]/);
  assert.match(src, /did not open or was closed/);          // sign-in timeout
  assert.match(src, /addEventListener\('unhandledrejection'/);
});
