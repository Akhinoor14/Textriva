// Phase 3 tests — page tools. Pure helpers first, then the real app in jsdom + fake-indexeddb
// (canvas does not exist in jsdom, so the image I/O seam `imgIO` is replaced by a fake that returns tagged blobs).
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { getModuleSource, extractDeclaration } from './_extract.mjs';
import { bootApp, addPages, tick } from './_app.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = getModuleSource();
const names = ['CROP_MIN', 'SPLIT_MIN', 'SPLIT_MAX', 'moveItem', 'normRotation', 'rotatedSize', 'cropRectFromMargins', 'spreadRects', 'parsePageRange', 'enhanceImageData'];
const api = new Function(`${names.map(n => extractDeclaration(source, n)).join('\n')}\nreturn { ${names.join(', ')} };`)();
const { moveItem, normRotation, rotatedSize, cropRectFromMargins, spreadRects, parsePageRange, enhanceImageData } = api;

// ── pure helpers ──
test('moveItem: moves, clamps, never mutates the input', () => {
  const a = [0, 1, 2, 3, 4];
  assert.deepEqual(moveItem(a, 1, 3), [0, 2, 3, 1, 4]);
  assert.deepEqual(moveItem(a, 4, 0), [4, 0, 1, 2, 3]);
  assert.deepEqual(moveItem(a, 2, 99), [0, 1, 3, 4, 2]);
  assert.deepEqual(moveItem(a, 2, 2), a);
  assert.deepEqual(moveItem(a, 9, 0), a);
  assert.deepEqual(a, [0, 1, 2, 3, 4]);
});
test('rotation helpers normalise to 0/90/180/270 and swap dimensions', () => {
  assert.equal(normRotation(-90), 270); assert.equal(normRotation(450), 90); assert.equal(normRotation(0), 0);
  assert.deepEqual(rotatedSize(100, 200, 90), { w: 200, h: 100 });
  assert.deepEqual(rotatedSize(100, 200, 270), { w: 200, h: 100 });
  assert.deepEqual(rotatedSize(100, 200, 180), { w: 100, h: 200 });
});
test('cropRectFromMargins: pixel rect, null when nothing to crop, never collapses', () => {
  assert.equal(cropRectFromMargins(1000, 2000, {}), null);
  assert.deepEqual(cropRectFromMargins(1000, 2000, { t: 0.1, b: 0.05, l: 0.2, r: 0 }), { x: 200, y: 200, w: 800, h: 1700 });
  const r = cropRectFromMargins(1000, 1000, { l: 0.9, r: 0.9, t: 0, b: 0 });
  assert.ok(r.w >= 50 && r.x + r.w <= 1000);
});
test('spreadRects: halves cover the page; rtl flips the reading order; position is clamped', () => {
  const [a, b] = spreadRects(1000, 700, 0.5, false);
  assert.deepEqual(a, { x: 0, y: 0, w: 500, h: 700 }); assert.deepEqual(b, { x: 500, y: 0, w: 500, h: 700 });
  const [r1, r2] = spreadRects(1000, 700, 0.5, true);
  assert.deepEqual(r1, b); assert.deepEqual(r2, a);
  const [c, d] = spreadRects(1000, 700, 0.01, false);
  assert.equal(c.w + d.w, 1000); assert.equal(c.w, 200);
});
test('parsePageRange: lists, ranges, Bangla digits, clamping, de-duplication', () => {
  assert.deepEqual(parsePageRange('3', 10), [2]);
  assert.deepEqual(parsePageRange('2-4, 9, 3', 10), [1, 2, 3, 8]);
  assert.deepEqual(parsePageRange('৩ - ৫', 10), [2, 3, 4]);
  assert.deepEqual(parsePageRange('8-20', 10), [7, 8, 9]);
  assert.deepEqual(parsePageRange('abc, 0', 10), []);
  assert.deepEqual(parsePageRange('5-3', 10), [2, 3, 4]);
});
test('enhanceImageData stretches a low-contrast image, leaves alpha alone, ignores flat images', () => {
  const W = 8, H = 8, d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const v = i % 2 ? 100 : 140; d.set([v, v, v, 255], i * 4); }
  const img = enhanceImageData({ data: d, width: W, height: H });
  const vals = Array.from(img.data).filter((_, i) => i % 4 === 0);
  assert.ok(Math.max(...vals) - Math.min(...vals) > 200, 'contrast widened');
  assert.ok(Array.from(img.data).filter((_, i) => i % 4 === 3).every(a => a === 255), 'alpha untouched');
  const flat = new Uint8ClampedArray(W * H * 4).fill(128);
  enhanceImageData({ data: flat, width: W, height: H });
  assert.ok(flat.every(v => v === 128), 'flat image unchanged');
});

// ── the real app ──
const blobOf = (w, tag) => new w.Blob([tag], { type: 'image/jpeg' });
function fakeIO(w) {
  const calls = [];
  w.__app.imgIO.size = async () => ({ w: 1000, h: 1400 });
  w.__app.imgIO.render = async (blob, spec) => { calls.push(spec); return blobOf(w, 'edit:' + JSON.stringify(spec)); };
  return calls;
}
const J = x => JSON.stringify(x);
const ids = w => Array.from(w.__app.state.pages, p => p.id);
const names2 = w => Array.from(w.__app.state.pages, p => p.name);

test('reorder: pages move, current page follows, order persists through the real IndexedDB save + reopen', async () => {
  const w = await bootApp();
  addPages(w, ['এক', 'দুই', 'তিন', 'চার', 'পাঁচ']);
  const { state } = w.__app;
  state.current = 1;                                     // "দুই"
  assert.equal(w.__app.movePage(1, 3), true);
  assert.deepEqual(Array.from(state.pages, p => p.text), ['এক', 'তিন', 'চার', 'দুই', 'পাঁচ']);
  assert.equal(state.pages[state.current].text, 'দুই');  // current page follows the moved page
  assert.equal(w.__app.movePage(0, 0), false);
  await w.__app.saveNow(); await tick(10);
  const pid = state.projectId, expected = Array.from(state.pages, p => p.text);
  w.__app.resetWorkspaceState();
  await w.__app.openLocalProject(pid);
  assert.deepEqual(Array.from(w.__app.state.pages, p => p.text), expected);
});

test('reorder changes the Drive sync signature (so a reorder is re-synced to project.json)', async () => {
  const w = await bootApp();
  addPages(w, ['a', 'b', 'c']);
  const before = w.__app.syncSig();
  w.__app.movePage(0, 2);
  assert.notEqual(w.__app.syncSig(), before);
});

test('drag & drop on thumbnails reorders (dragstart → dragover → drop)', async () => {
  const w = await bootApp();
  addPages(w, ['a', 'b', 'c', 'd']);
  w.__app.renderAll();
  const thumbs = w.document.querySelectorAll('#strip .page-thumb');
  assert.equal(thumbs.length, 4);
  assert.equal(thumbs[0].draggable, true);
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));
  fire(thumbs[0], 'dragstart'); fire(thumbs[2], 'dragover'); fire(thumbs[2], 'drop');
  assert.deepEqual(Array.from(w.__app.state.pages, p => p.text), ['b', 'c', 'a', 'd']);
});

test('rotate: image replaced, every cached link/Drive id invalidated, blobSaved reset, done pages stay done', async () => {
  const w = await bootApp();
  const calls = fakeIO(w);
  addPages(w, ['', 'লেখা আছে']);
  const [p0, p1] = w.__app.state.pages;
  Object.assign(p0, { remoteUrl: 'https://i.example/x.jpg', remoteAt: Date.now(), driveFileId: 'drv1', blobSaved: true, status: 'ready', hash: 'h', phash: 'ph' });
  Object.assign(p1, { remoteUrl: 'https://i.example/y.jpg', remoteAt: Date.now(), driveFileId: 'drv2', blobSaved: true });
  const old0 = p0.blob;
  assert.equal(await w.__app.rotatePages([0, 1], 90), 2);
  assert.deepEqual(calls.map(c => c.rotate), [90, 90]);
  for (const p of [p0, p1]) { assert.equal(p.remoteUrl, ''); assert.equal(p.remoteAt, 0); assert.equal(p.driveFileId, null); assert.equal(p.blobSaved, false); }
  assert.notEqual(p0.blob, old0);
  assert.notEqual(p0.status, 'ready');            // no stale 'ready' (a re-upload may already be running: pending/uploading/error)
  assert.equal(p1.status, 'done');
  assert.equal(p0.pdfPage, null);
});

test('rotated page is re-saved to the Library (blobSaved goes false → true) and loads back', async () => {
  const w = await bootApp();
  fakeIO(w);
  addPages(w, ['x']);
  await w.__app.saveNow(); await tick(10);
  await w.__app.rotatePages([0], 270);
  await w.__app.saveNow(); await tick(10);
  const pid = w.__app.state.projectId;
  const { blobs } = await w.__app.localLoad(pid);
  assert.ok(blobs[0] && blobs[0].blob, 'image is in the Library');
  assert.equal(w.__app.state.pages[0].blobSaved, true, 'the edited image was re-written to IndexedDB');
});

test('crop uses each page\'s own size; "nothing to crop" changes nothing and is not undoable', async () => {
  const w = await bootApp();
  const calls = fakeIO(w);
  addPages(w, ['', '']);
  assert.equal(await w.__app.cropPages([0, 1], { t: 0.1, b: 0, l: 0, r: 0.1 }), 2);
  assert.equal(J(calls[0].crop), J({ x: 0, y: 140, w: 900, h: 1260 }));
  assert.equal(await w.__app.cropPages([0], { t: 0, b: 0, l: 0, r: 0 }), 0);
  assert.equal(w.__app.state.imgUndo.length, 1);
});

test('split spread: page becomes two (first keeps text/note/bookmark), order and ids are right, undo restores', async () => {
  const w = await bootApp();
  const calls = fakeIO(w);
  addPages(w, ['', 'বাম পাতার লেখা', '']);
  const { state } = w.__app;
  state.pages[1].note = 'টীকা'; state.pages[1].bookmark = true;
  const orig = ids(w);
  assert.equal(await w.__app.splitSpreads([1], 0.5, false), 1);
  assert.equal(state.pages.length, 4);
  assert.equal(state.pages[1].id, orig[1]);
  assert.equal(state.pages[1].text, 'বাম পাতার লেখা'); assert.equal(state.pages[1].bookmark, true);
  assert.equal(state.pages[2].text, ''); assert.equal(state.pages[2].status, 'pending');
  assert.equal(J(calls.map(c => c.crop)), J([{ x: 0, y: 0, w: 500, h: 1400 }, { x: 500, y: 0, w: 500, h: 1400 }]));
  assert.deepEqual(names2(w).slice(1, 3), ['page-2.jpg (1)', 'page-2.jpg (2)']);
  assert.ok(w.__app.undoPageEdit());
  assert.deepEqual(ids(w), orig);
  assert.equal(state.pages[1].name, 'page-2.jpg');
});

test('split with RTL reads the right half first', async () => {
  const w = await bootApp();
  const calls = fakeIO(w);
  addPages(w, ['']);
  await w.__app.splitSpreads([0], 0.5, true);
  assert.equal(calls[0].crop.x, 500);
});

test('undo of a page edit restores the order, and refuses once the page list changed afterwards', async () => {
  const w = await bootApp();
  addPages(w, ['a', 'b', 'c']);
  const orig = ids(w);
  w.__app.movePage(0, 2);
  assert.ok(w.__app.undoPageEdit());
  assert.deepEqual(ids(w), orig);
  w.__app.movePage(0, 2);
  w.__app.cutPage(1);                                  // list changed after the edit
  assert.equal(w.__app.undoPageEdit(), false);
  assert.equal(w.__app.state.imgUndo.length, 0);
});

test('enhance affects only the copy sent to Lens, never the stored page', async () => {
  const w = await bootApp();
  const calls = fakeIO(w);
  addPages(w, ['']);
  const pg = w.__app.state.pages[0], before = pg.blob;
  assert.equal(await w.__app.lensCopyBlob(before), before);          // off → same blob, no work
  w.__app.setEnhance(true);
  const out = await w.__app.lensCopyBlob(before);
  assert.equal(J(calls.at(-1)), J({ enhance: true }));
  assert.notEqual(out, before); assert.equal(pg.blob, before);
  assert.equal(w.localStorage.getItem('textriva-enhance-lens'), '1');
});

test('toggling enhance drops stale Lens links so they are re-uploaded', async () => {
  const w = await bootApp();
  addPages(w, ['', '']);
  const [a, b] = w.__app.state.pages;
  Object.assign(a, { remoteUrl: 'https://x/a', remoteAt: Date.now(), status: 'ready' });
  Object.assign(b, { remoteUrl: 'https://x/b', remoteAt: Date.now(), status: 'done', text: 't' });
  w.__app.setEnhance(true);
  assert.equal(a.remoteUrl, ''); assert.notEqual(a.status, 'ready');   // pending → prefetch may already have restarted the upload
  assert.equal(b.remoteUrl, ''); assert.equal(b.status, 'done');
});

test('move pages to a new project: written first, then removed here; target keeps order, text, notes; search index updated', async () => {
  const w = await bootApp();
  addPages(w, ['এক', 'দুই', 'তিন', 'চার'], 'src.pdf');
  const { state } = w.__app;
  state.pages[2].note = 'গুরুত্বপূর্ণ'; state.pages[2].bookmark = true;
  await w.__app.saveNow(); await tick(10);
  const srcId = state.projectId;
  const res = await w.__app.movePagesToProject([1, 2], { name: 'অংশ ২' });
  assert.equal(res.count, 2);
  assert.deepEqual(Array.from(state.pages, p => p.text), ['এক', 'চার']);
  await tick(10);
  const t = await w.__app.localLoad(res.pid);
  assert.deepEqual(t.recs.map(r => r.text), ['দুই', 'তিন']);
  assert.equal(t.recs[1].note, 'গুরুত্বপূর্ণ'); assert.equal(t.recs[1].bookmark, true);
  assert.ok(t.recs.every(r => r.driveFileId === null));
  assert.equal(t.proj.name, 'অংশ ২'); assert.equal(t.proj.pageCount, 2);
  assert.equal(t.blobs.length, 2); assert.ok(t.blobs.every(b => b && b.blob));
  const src = await w.__app.localLoad(srcId);
  assert.deepEqual(src.recs.map(r => r.text), ['এক', 'চার']);
  const hits = await w.__app.searchLibrary('তিন');
  assert.ok(hits.some(h => h.pid === res.pid), 'moved text is searchable in the new project');
});

test('move into an existing project appends after its pages', async () => {
  const w = await bootApp();
  addPages(w, ['x1', 'x2'], 'target.pdf');
  await w.__app.saveNow(); await tick(10);
  const targetId = w.__app.state.projectId;
  w.__app.resetWorkspaceState();
  addPages(w, ['y1', 'y2', 'y3'], 'source.pdf');
  const res = await w.__app.movePagesToProject([0], { pid: targetId });
  await tick(10);
  const t = await w.__app.localLoad(targetId);
  assert.deepEqual(t.recs.map(r => r.text), ['x1', 'x2', 'y1']);
  assert.equal(t.proj.pageCount, 3);
  assert.equal(res.pid, targetId);
});

test('moving every page empties and removes the source project', async () => {
  const w = await bootApp();
  addPages(w, ['p', 'q'], 'whole.pdf');
  await w.__app.saveNow(); await tick(10);
  const srcId = w.__app.state.projectId;
  await w.__app.movePagesToProject([0, 1], { name: 'নতুন' });
  await tick(10);
  const list = await w.__app.localList();
  assert.equal(list.some(p => p.id === srcId), false);
  assert.ok(list.some(p => p.name === 'নতুন'));
});

test('merge a Library project into the open one (pages appended with fresh ids, source optionally deleted)', async () => {
  const w = await bootApp();
  addPages(w, ['m1', 'm2'], 'other.pdf');
  await w.__app.saveNow(); await tick(10);
  const otherId = w.__app.state.projectId;
  w.__app.resetWorkspaceState();
  addPages(w, ['a1'], 'main.pdf');
  const n = await w.__app.mergeProjectIntoCurrent(otherId);   // test harness confirm() → true → source deleted
  assert.equal(n, 2);
  assert.deepEqual(Array.from(w.__app.state.pages, p => p.text), ['a1', 'm1', 'm2']);
  await tick(10);
  assert.equal((await w.__app.localList()).some(p => p.id === otherId), false);
});

test('Page tools dialog: opens, rotates the range through the UI, Esc closes, and page shortcuts stay quiet behind it', async () => {
  const w = await bootApp();
  fakeIO(w);
  addPages(w, ['', '', '']);
  w.__app.renderAll();
  w.document.getElementById('pageToolsBtn').click();
  const dlg = w.document.getElementById('ptDlg');
  assert.ok(dlg);
  dlg.querySelector('#ptRange').value = '1-2';
  dlg.querySelector('[data-pt="rot"][data-deg="90"]').click();
  await tick(20);
  assert.equal(w.__app.state.imgUndo.length, 1);
  assert.equal(w.__app.state.pages[0].blobSaved, false);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
  assert.equal(w.__app.state.current, 0, 'no page shortcuts while the dialog is open');
  dlg.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(w.document.getElementById('ptDlg'), null);
});

test('Alt+→ moves the current page when no dialog is open', async () => {
  const w = await bootApp();
  addPages(w, ['a', 'b', 'c']);
  w.__app.renderAll();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
  assert.deepEqual(Array.from(w.__app.state.pages, p => p.text), ['b', 'a', 'c']);
});

test('an upload that finishes after the image was edited is discarded (Lens must never get the old image)', async () => {
  const w = await bootApp();
  fakeIO(w);
  let n = 0;
  w.fetch = () => { const id = ++n; return new Promise(r => setTimeout(() => r({ ok: true, json: async () => ({ success: true, url: 'https://i.example/up' + id + '.jpg' }) }), 30)); };
  addPages(w, ['']);
  const pg = w.__app.state.pages[0];
  w.__app.renderAll();                      // prefetch starts uploading page 1 (old image)
  await tick(5);
  assert.equal(pg.status, 'uploading');
  await w.__app.rotatePages([0], 90);       // edit while the first upload is in flight
  await tick(250);
  assert.notEqual(pg.remoteUrl, 'https://i.example/up1.jpg', 'link of the pre-edit image was dropped');
  assert.ok(n >= 2, 'the edited image was uploaded again');
});

// ── wiring (static) ──
test('wiring: every Lens upload path goes through lensCopyBlob; every image change goes through setPageBlob', () => {
  assert.match(source, /compressBlob\(await lensCopyBlob\(pg\.blob\)\)/);
  assert.match(source, /const lensBlob = await lensCopyBlob\(blob\)/);
  const setFn = extractDeclaration(source, 'setPageBlob');
  for (const f of ['remoteUrl', 'remoteAt', 'driveFileId', 'blobSaved', 'hash', 'pdfPage', 'imgRev']) assert.ok(setFn.includes(f), 'setPageBlob resets ' + f);
  assert.match(source, /'i' \+ \(p\.imgRev \|\| 0\)/, 'syncSig includes the image revision');
  assert.ok(/CACHE = 'textriva-v1[2-9]'/.test(readFileSync(new URL('../sw.js', import.meta.url), 'utf8')));
  assert.ok(html.includes('id="pageToolsBtn"'));
  assert.ok(source.includes('#ptDlg'));
});
