// AI rescue: pages whose OCR is empty / garbage / rejected by the safety guard are read by the AI from the page IMAGE,
// with the neighbouring pages as context. Network is replaced by a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { bootApp, addPages, tick } from './_app.mjs';

const KEY = 'AIza' + 'x'.repeat(35);
const MODELS = { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] };
const reply = txt => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: txt }] }, finishReason: 'STOP' }] } });
function mock(w, gen) {
  const calls = [];
  w.fetch = async (url, init) => {
    calls.push({ url, init });
    const r = /\/models\?/.test(url) ? { status: 200, body: MODELS } : gen(url, init, calls.filter(c => /generateContent/.test(c.url)).length);
    return { ok: r.status === 200, status: r.status, headers: { get: () => null }, json: async () => r.body };
  };
  return calls;
}
const isGen = c => /generateContent/.test(c.url);
function fakeImage(w) {
  w.createImageBitmap = async () => ({ width: 100, height: 100 });
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(['jpegbytes'], { type: 'image/jpeg' })); };
}
const GOOD = 'নিউটনের দ্বিতীয় সূত্র F = ma। এখানে m হলো বস্তুর ভর এবং a হলো তার ত্বরণ।';
const READ = 'গতির প্রথম সূত্র অনুযায়ী বাহ্যিক বল না থাকলে বস্তু স্থির বা সমবেগে চলে। ' + 'x'.repeat(40);

test('aiBadOcr: empty / tiny / noisy → bad; normal text and text-only pages → fine', async () => {
  const w = await bootApp(); const a = w.__app;
  addPages(w, ['', 'ab', GOOD, 'আ�বc���দ ঙ চ ছ জ ঝ ঞ ট ঠ ড ঢ', GOOD]);
  const P = a.state.pages;
  assert.deepEqual([0, 1, 2, 3, 4].map(i => a.aiBadOcr(P[i]).bad), [true, true, false, true, false]);
  P[0].txtOnly = true; assert.equal(a.aiBadOcr(P[0]).bad, false);
});

test('empty page: sent to the AI as an IMAGE with "read from image" prompt, page info and the previous page tail', async () => {
  const w = await bootApp(); const a = w.__app; fakeImage(w);
  const calls = mock(w, () => reply(READ));
  addPages(w, [GOOD, '', GOOD]); a.aiAddKey(KEY, 'k1', true);
  const r = await a.aiFixPage(a.state.pages[1], { useImage: false, math: 'unicode' }, 'x');
  assert.equal(r.ocr, true); assert.equal(r.withImage, true); assert.equal(r.after, READ);
  const b = JSON.parse(calls.filter(isGen)[0].init.body);
  const parts = b.contents[0].parts;
  assert.ok(parts.some(p => p.inlineData && p.inlineData.mimeType === 'image/jpeg'), 'image attached');
  assert.match(b.systemInstruction.parts[0].text, /READ THIS PAGE FROM THE IMAGE/);
  const txt = parts.at(-1).text;
  assert.match(txt, /Page 2 of 3/); assert.match(txt, /<previous_page_tail>\nনিউটনের/); assert.match(txt, /<next_page_head>\nনিউটনের/);
});

test('guard fallback: a "fix" that changes far too much is not dropped — the page is re-read from the image', async () => {
  const w = await bootApp(); const a = w.__app; fakeImage(w);
  const calls = mock(w, (u, i, n) => reply(n === 1 ? 'ছোট' : READ));
  addPages(w, [GOOD + ' ' + GOOD]); a.aiAddKey(KEY, 'k1', true);
  const r = await a.aiFixPage(a.state.pages[0], { useImage: true, math: 'unicode', verify: false }, 'x');
  assert.equal(calls.filter(isGen).length, 2); assert.equal(r.ocr, true); assert.equal(r.after, READ);
});

test('no image can be made → the old guard error is kept (nothing silently lost)', async () => {
  const w = await bootApp(); const a = w.__app;
  mock(w, () => reply('ছোট'));
  addPages(w, [GOOD + ' ' + GOOD]); a.aiAddKey(KEY, 'k1', true);
  await assert.rejects(() => a.aiFixPage(a.state.pages[0], { useImage: false, math: 'unicode', verify: false }, 'x'), e => e.code === 'guard');
});

test('sweep: a skipped (empty) page behind the reader and a garbage page are queued and fixed automatically', async () => {
  const w = await bootApp(); const a = w.__app; fakeImage(w);
  const calls = mock(w, () => reply(READ));
  addPages(w, [GOOD, '', GOOD, '�'.repeat(24), '']);
  a.aiAddKey(KEY, 'k1', true); a.state.current = 4;
  a.aiSweep();
  await tick(1500);
  const P = a.state.pages;
  assert.equal(P[1].text, READ); assert.equal(P[3].text, READ);
  assert.equal(P[0].text, GOOD); assert.equal(P[2].text, GOOD);
  assert.equal(P[4].text, '');
  assert.ok(calls.filter(isGen).length >= 2);
});
