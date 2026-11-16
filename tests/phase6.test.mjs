// Phase 6 tests — optional Tesseract OCR. The real engine (browser-only) is replaced by a fake via the ocrIO seam.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { getModuleSource } from './_extract.mjs';
import { bootApp, addPages, tick } from './_app.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = getModuleSource();
const BN = 'আমি বাংলায় গান গাই। আমার সোনার বাংলা, আমি তোমায় ভালোবাসি।';
const fake = (seq) => { let i = 0; return async () => seq[i++] || { text: '', confidence: 0 }; };   // results by call order

test('sanitizeOcr clamps confidence and rejects other engines', async () => {
  const w = await bootApp(); const { sanitizeOcr } = w.__app;
  assert.deepEqual(JSON.parse(JSON.stringify(sanitizeOcr({ engine: 'tesseract', conf: 140.6, hash: 7 }))), { engine: 'tesseract', conf: 100, hash: 7 });
  assert.equal(sanitizeOcr({ engine: 'tesseract', conf: -5, hash: 1 }).conf, 0);
  assert.equal(sanitizeOcr({ engine: 'lens', conf: 90 }), null);
  assert.equal(sanitizeOcr(null), null);
});

test('pagesForOcr: Auto = only pages without text; Redo = all with an image', async () => {
  const w = await bootApp(); const { pagesForOcr } = w.__app;
  const pages = [{ text: 'x' }, { text: '' }, { text: '  ' }, { text: '', txtOnly: true }];
  assert.deepEqual(pagesForOcr(pages, [0, 1, 2, 3], 'empty'), [1, 2]);
  assert.deepEqual(pagesForOcr(pages, [0, 1, 2, 3], 'all'), [0, 1, 2]);
});

test('runOcr: saves text + engine + confidence, flags low confidence, Bangla kept exactly, undo works', async () => {
  const w = await bootApp(); const a = w.__app;
  addPages(w, ['', '', 'kept text']);
  a.ocrIO.recognize = fake([{ text: BN + '\r\n\r\n\r\n', confidence: 91.4 }, { text: 'blurry txt here, long enough to pass', confidence: 42 }]);
  const res = await a.runOcr([0, 1], {});
  assert.deepEqual({ d: res.done, l: res.low, f: res.failed }, { d: 2, l: 1, f: 0 });
  const [p0, p1, p2] = a.state.pages;
  assert.equal(p0.text, BN); assert.equal(p0.status, 'done'); assert.equal(p0.ocr.conf, 91);
  assert.equal(p2.text, 'kept text'); assert.equal(p2.ocr || null, null);
  a.refreshFlags();
  assert.ok(!p0.flags.includes('lowconf')); assert.ok(p1.flags.includes('lowconf'));
  // changing the text (e.g. a Lens paste) drops the OCR info → flag disappears
  p1.text = 'now pasted from lens, a good long text'; a.refreshFlags();
  assert.ok(!p1.flags.includes('lowconf'));
  // undo restores the empty page
  assert.equal(a.undoPage(p0), true); assert.equal(p0.text, '');
});

test('runOcr: blank result, edited image, cancel and engine errors leave pages alone', async () => {
  const w = await bootApp(); const a = w.__app;
  addPages(w, ['', '', '']);
  let n = 0;
  a.ocrIO.recognize = async () => { n++; if (n === 1) return { text: '   ', confidence: 10 };
    if (n === 2) { a.state.pages[1].blob = new w.Blob([new Uint8Array([9])]); return { text: 'old image text', confidence: 99 }; }
    throw new Error('boom'); };
  const res = await a.runOcr([0, 1, 2], {});
  assert.equal(res.done, 0); assert.equal(res.failed, 2);
  assert.ok(a.state.pages.every(p => !p.text && !p.ocr));
  assert.equal(a.state.ocrRun, null);
  // cancel
  a.ocrIO.recognize = async () => ({ text: 'some text that is long enough', confidence: 90 });
  const r2 = await a.runOcr([0, 1, 2], { onProgress: (i) => { if (i === 2) a.state.ocrRun.cancel = true; } });
  assert.equal(r2.cancelled, true); assert.equal(r2.done, 2);   // Stop takes effect after the page being processed
});

test('OCR info survives IndexedDB save + reopen and project JSON round trip', async () => {
  const w = await bootApp(); const a = w.__app;
  addPages(w, ['', '']);
  a.ocrIO.recognize = async () => ({ text: BN, confidence: 55 });
  await a.runOcr([0], {});
  await a.saveNow(); await tick(10);
  const pid = a.state.projectId;
  await a.openLocalProject(pid); await tick(20);
  const pg = a.state.pages[0];
  assert.equal(pg.text, BN); assert.equal(pg.ocr.conf, 55);
  a.refreshFlags(); assert.ok(pg.flags.includes('lowconf'));
  assert.equal(a.state.pages[1].ocr || null, null);
});

test('dialog: Start runs the engine on the range; nothing is loaded before Start', async () => {
  const w = await bootApp(); const a = w.__app;
  addPages(w, ['', '', 'has text']);
  assert.equal(w.Tesseract, undefined);
  assert.equal(w.document.querySelector('script[src*="tesseract"]'), null);   // lazy: never loaded on boot
  let calls = 0; a.ocrIO.recognize = async () => { calls++; return { text: 'recognised text, long enough here', confidence: 88 }; };
  a.openOcrDlg();
  const dlg = w.document.getElementById('ocrDlg'); assert.ok(dlg);
  assert.match(dlg.querySelector('#ocInfo').textContent, /2/);                 // pages 1-2 have no text
  dlg.querySelector('[data-oc="start"]').click();
  for (let i = 0; i < 50 && calls < 2; i++) await tick(10);
  await tick(20);
  assert.equal(calls, 2); assert.equal(a.state.pages[2].text, 'has text');
});

test('wiring: engine is optional + lazy, pinned cdnjs URL, CSP allows only what Tesseract needs, imgbb untouched', () => {
  assert.match(source, /TESS_URL = 'https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/tesseract\.js\/5\.1\.1\//);
  assert.match(html, /id="ocrBtn"/);
  const vj = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
  assert.match(vj, /tessdata\.projectnaptha\.com/); assert.match(vj, /wasm-unsafe-eval/);
  assert.match(source, /fetch\('\/api\/upload'/);            // imgbb proxy path unchanged
  assert.equal(source.includes('r2.cloudflarestorage'), false);
});
