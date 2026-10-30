// Phase 9 tests — PWA / mobile / performance: big-PDF guard, virtualised strip, offline sync queue, share target, camera.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { bootApp, addPages, tick } from './_app.mjs';
import { installFakeDrive } from './_fakedrive.mjs';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../site.webmanifest', import.meta.url), 'utf8'));

test('planPdfPages: ≤300 pages load all; >300 needs a range; cancel/garbage → null', async () => {
  const w = await bootApp(); const { planPdfPages } = w.__app;
  assert.equal(planPdfPages(120, 'all').length, 120);
  assert.equal(planPdfPages(300, 'all').length, 300);
  assert.equal(planPdfPages(500, 'all').length, 500);                       // user chose "load all"
  assert.deepEqual([...planPdfPages(500, '1-3, 10')], [0, 1, 2, 9]);
  assert.deepEqual([...planPdfPages(500, '১-৩')], [0, 1, 2]);                // Bangla digits
  assert.equal(planPdfPages(500, 'abc'), null);
  assert.equal(planPdfPages(500, '900-950'), null);                          // outside the document
});

test('stripWindow: small projects render everything; large ones only a window', async () => {
  const w = await bootApp(); const { stripWindow } = w.__app;
  assert.deepEqual({ ...stripWindow(40, 0, 800, 0) }, { from: 0, to: 40, virtual: false });
  const a = stripWindow(600, 0, 800, 0);
  assert.equal(a.virtual, true); assert.equal(a.from, 0); assert.ok(a.to < 100);
  const b = stripWindow(600, 90 * 300, 800, null);
  assert.ok(b.from > 250 && b.from < 300 && b.to > 300 && b.to < 360 && b.to <= 600);
  const c = stripWindow(600, 0, 800, 590);
  assert.equal(c.to, 600); assert.ok(c.from > 500);
});

test('renderStrip: 500 pages → only a window of thumbnails + spacers; active page is always rendered', async () => {
  const w = await bootApp(); const { state, renderStrip } = w.__app;
  addPages(w, Array.from({ length: 500 }, () => ''));
  state.current = 400; renderStrip();
  const strip = w.document.getElementById('strip');
  const thumbs = strip.querySelectorAll('.page-thumb');
  assert.ok(thumbs.length > 0 && thumbs.length < 140, 'rendered ' + thumbs.length);
  assert.ok(strip.querySelector('.page-thumb.active'));
  assert.equal(strip.querySelector('.page-thumb.active').dataset.i, '400');
  assert.ok(strip.querySelectorAll('.strip-spacer').length >= 1);
  state.current = 0; renderStrip();
  assert.equal(strip.querySelector('.page-thumb').dataset.i, '0');
});

test('renderStrip: small projects are untouched (no spacers, every page present)', async () => {
  const w = await bootApp(); const { state, renderStrip } = w.__app;
  addPages(w, ['a', 'b', 'c']); renderStrip();
  const strip = w.document.getElementById('strip');
  assert.equal(strip.querySelectorAll('.page-thumb').length, 3);
  assert.equal(strip.querySelectorAll('.strip-spacer').length, 0);
});

test('offline: chip shows "queued" and auto-sync waits; back online → syncs', async () => {
  const w = await bootApp({ drive: true });
  const drive = installFakeDrive(w); const a = w.__app;
  a.gdrive.token = 'tok'; a.gdrive.exp = Date.now() + 3600e3;
  addPages(w, ['one', 'two'], 'book.pdf');
  await a.syncToDrive();
  const folder = drive.folders()[0];
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => false });
  a.state.pages[0].text = 'edited offline';
  a.refreshDriveChip();
  const chip = w.document.getElementById('driveChip');
  assert.equal(chip.dataset.mode, 'offline');
  w.dispatchEvent(new w.Event('offline'));
  a.queueDriveSync(); await tick(30);
  assert.equal(drive.readJson(drive.child(folder.id, 'project.json')).pages[0].text, 'one');   // nothing sent while offline
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => true });
  a.refreshDriveChip();
  assert.notEqual(chip.dataset.mode, 'offline');
  await a.syncToDrive({ silent: true });                                      // what the 8 s timer does after the 'online' event
  assert.equal(drive.readJson(drive.child(folder.id, 'project.json')).pages[0].text, 'edited offline');
});

test('share target: files parked by the service worker become pages and the cache is emptied', async () => {
  const w = await bootApp(); const { state, consumeSharedFiles } = w.__app;
  const store = new Map();
  const cache = {
    keys: async () => [...store.keys()],
    match: async k => store.get(k),
    delete: async k => store.delete(k),
  };
  const mk = (name, type) => ({ headers: new Map([['x-name', encodeURIComponent(name)], ['content-type', type]]), blob: async () => new w.Blob([new Uint8Array([1, 2, 3])], { type }) });
  const hdr = r => ({ ...r, headers: { get: k => r.headers.get(k) } });
  store.set('/__share/0', hdr(mk('গ্যালারি ১.jpg', 'image/jpeg')));
  store.set('/__share/1', hdr(mk('b.jpg', 'image/jpeg')));
  const n = await consumeSharedFiles({ open: async () => cache });
  assert.equal(n, 2); assert.equal(store.size, 0);
  assert.equal(state.pages.length, 2);
  assert.ok(state.pages.some(p => p.name === 'গ্যালারি ১.jpg'));
  assert.equal(await consumeSharedFiles({ open: async () => cache }), 0);   // nothing left → no-op
  assert.equal(await consumeSharedFiles(null), 0 );                          // no Cache API → no-op
});

test('camera: scan names are unique-ish image names; button + hidden capture input exist', async () => {
  const w = await bootApp(); const { scanName } = w.__app;
  assert.match(scanName(0), /^scan-\d{14}\.jpg$/); assert.match(scanName(1), /^scan-\d{14}-2\.jpg$/);
  const inp = w.document.getElementById('cameraInput');
  assert.equal(inp.getAttribute('capture'), 'environment'); assert.equal(inp.getAttribute('accept'), 'image/*');
  assert.ok(w.document.getElementById('cameraBtn'));
});

test('wiring: manifest share_target, SW share + CDN caching, share cache survives activation, memory guard in loadPdf', () => {
  assert.equal(manifest.share_target.action, '/share-target'); assert.equal(manifest.share_target.method, 'POST');
  assert.equal(manifest.share_target.enctype, 'multipart/form-data');
  assert.equal(manifest.share_target.params.files[0].name, 'files');
  assert.match(sw, /\/share-target/); assert.match(sw, /cdnjs\.cloudflare\.com/);
  assert.match(sw, /k !== 'textriva-share'/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /pdfPagesToLoad\(numPages\)/); assert.match(html, /page\.cleanup\(\)/);
  assert.match(sw, /textriva-v15/);
});
