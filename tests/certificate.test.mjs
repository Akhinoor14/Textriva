// Whole-document AI check + certificate: local arithmetic, JSON handling, certificate on top of the text, stale rules, big-document windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { bootApp, addPages, tick } from './_app.mjs';

const KEY = 'AIza' + 'x'.repeat(35);
const MODELS = { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] };
const gem = text => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 10 } }) });
function fakeAi(w, reply) {
  const calls = [];
  w.fetch = async (url, init) => {
    if (/\/models\?/.test(url)) return { ok: true, status: 200, headers: { get: () => null }, json: async () => MODELS };
    const body = JSON.parse(init.body); calls.push(body.contents[0].parts.map(p => p.text || '').join(''));
    return gem(typeof reply === 'function' ? reply(calls.length) : reply);
  };
  return calls;
}
const OK = JSON.stringify({ verdict: 'ok', summary: 'সব ঠিক', issues: [], calculationsChecked: 4, sequenceEnd: 'প্রশ্ন ৩' });

test('localArith recomputes simple sums, handles Bangla digits, and refuses to guess on units/chains/commas', async () => {
  const w = await bootApp(); const { localArith } = w.__app;
  const J = x => JSON.stringify(x);   // objects come from another (jsdom) realm
  assert.equal(J(localArith('F = ma = 5 × 6 = 30 N')), J({ checked: 1, bad: [] }));
  assert.equal(J(localArith('৫ × ৬ = ৩০')), J({ checked: 1, bad: [] }));
  assert.equal(J(localArith('10 ÷ 3 = 3.33')), J({ checked: 1, bad: [] }));
  const bad = localArith('2 + 3 = 6\n5 × 6 = 31');
  assert.equal(bad.checked, 2); assert.equal(bad.bad.length, 2);
  assert.equal(bad.bad[0].actual, '5'); assert.equal(bad.bad[1].claimed, '31');
  assert.equal(localArith('5 m × 6 s = 30').checked, 0);
  assert.equal(localArith('1,000 + 2 = 1002').checked, 0);
  assert.equal(localArith('2 + 3 = 5 + 1 = 6').bad.length, 0);
  w.close();
});

test('certificate: all-ok answer puts a certificate on TOP of the all-text box and downloads; editing text makes it stale', async () => {
  const w = await bootApp(); const a = w.__app;
  a.aiAddKey(KEY, 'A', true, 'gemini');
  addPages(w, ['প্রশ্ন ১: ৫ × ৬ = ৩০', 'প্রশ্ন ২: ২ + ৩ = ৫', 'প্রশ্ন ৩: শেষ']);
  a.renderAll();
  const calls = fakeAi(w, '```json\n' + OK + '\n```');
  const c = await a.aiCertifyDocument({});
  assert.equal(calls.length, 1, 'whole document in ONE request');
  assert.match(calls[0], /=== Page 1 ===[\s\S]*=== Page 2 ===[\s\S]*=== Page 3 ===/);
  assert.equal(c.verdict, 'ok'); assert.equal(c.pages, 3);
  const box = w.document.getElementById('allTextarea').value;
  assert.ok(box.startsWith('════'), 'certificate is the very first thing');
  assert.match(box, /AI যাচাই সনদ|AI VERIFICATION CERTIFICATE/);
  assert.match(box, /প্রশ্ন ১/);
  assert.ok(a.buildAllText().startsWith('════'));
  assert.match(w.document.getElementById('certPanel').className, /ok/);
  // text changes → certificate no longer valid, not in the box, not in downloads
  a.state.pages[1].text = 'প্রশ্ন ২: ২ + ৩ = ৬';
  a.updateStats();
  assert.equal(a.certValid(), false);
  assert.ok(!w.document.getElementById('allTextarea').value.includes('AI যাচাই সনদ'));
  assert.ok(!a.buildAllText().startsWith('════'));
  assert.match(w.document.getElementById('certPanel').className, /stale/);
  w.close();
});

test('certificate never says "all ok" when the AI reports issues or the local arithmetic disagrees', async () => {
  const w = await bootApp(); const a = w.__app;
  a.aiAddKey(KEY, 'A', true, 'gemini');
  addPages(w, ['১ম page', 'ঘ) ২ + ৩ = ৯']);
  a.renderAll();
  fakeAi(w, OK);   // AI is lenient…
  let c = await a.aiCertifyDocument({});
  assert.equal(c.verdict, 'review', '…but the local check still catches 2 + 3 = 9');
  assert.match(c.text, /2 \+ 3 = 9|2 \+ 3 = 9/);
  assert.ok(!/কোনো ত্রুটি পাওয়া যায়নি|no problems found/.test(c.text));
  fakeAi(w, JSON.stringify({ verdict: 'issues', summary: 'x', issues: [{ page: 1, type: 'sequence', detail: 'প্রশ্ন ২ নেই' }] }));
  c = await a.aiCertifyDocument({});
  assert.equal(c.verdict, 'review'); assert.match(c.text, /প্রশ্ন ২ নেই/);
  w.close();
});

test('unreadable AI answer → no certificate at all; big documents are checked in chained windows', async () => {
  const w = await bootApp(); const a = w.__app;
  a.aiAddKey(KEY, 'A', true, 'gemini');
  addPages(w, ['কিছু text']); a.renderAll();
  fakeAi(w, 'আমি পারছি না');
  assert.equal(await a.aiCertifyDocument({}), null);
  assert.equal(a.state.cert, null);
  // 10 pages × 10k chars = 100k > whole-document limit → windows of ≤ 26k, each told where the previous one ended
  addPages(w, Array.from({ length: 10 }, (_, i) => 'পাতা ' + i + ' ' + 'ক'.repeat(10000))); a.renderAll();
  const calls = fakeAi(w, OK);
  const c = await a.aiCertifyDocument({});
  assert.ok(c.parts >= 4); assert.equal(calls.length, c.parts);
  assert.ok(!/previous_part_ended_with/.test(calls[0]) && /previous_part_ended_with>প্রশ্ন ৩/.test(calls[1]));
  w.close();
});

test('auto mode: once every page is AI-fixed and the queue is empty, the whole-document check runs by itself', async () => {
  const w = await bootApp(); const a = w.__app;
  a.aiAddKey(KEY, 'A', true, 'gemini');
  addPages(w, ['প্রশ্ন ১: ৫ × ৬ = ৩০', 'প্রশ্ন ২: শেষ']); a.renderAll();
  const calls = fakeAi(w, OK);
  a.aiMaybeCertify();
  await new Promise(r => setTimeout(r, 1800));
  assert.equal(calls.length, 0, 'pages not AI-fixed yet → no certificate');
  a.state.pages.forEach(p => { p.aiFixedHash = a.hashStr(p.text); });
  a.aiMaybeCertify();
  await new Promise(r => setTimeout(r, 1800));
  for (let i = 0; i < 20 && a.state.certRun; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(calls.length, 1, 'all pages fixed → one whole-document request');
  assert.ok(a.certValid());
  w.close();
});
