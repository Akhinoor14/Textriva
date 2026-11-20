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
  a.state.certInclude = true;   // the certificate text is opt-in now (documents stay clean by default)
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

test('background safety: PDF split renders with intent "print" (no requestAnimationFrame) and the certificate step holds a keep-alive', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const loadPdf = src.slice(src.indexOf('async function loadPdf'), src.indexOf('PHASE 9 — PWA'));
  assert.match(loadPdf, /render\(\{[^}]*intent: 'print'/, 'rAF is paused in hidden tabs');
  const cert = src.slice(src.indexOf('async function aiCertifyDocument'), src.indexOf("document.getElementById('certBtn')"));
  assert.match(cert, /bgKeep\.start\(\)/); assert.match(cert, /finally \{ stopKeep\(\); \}/);
});

test('doc-fix: the audit finding is repaired by the AI itself, re-checked, text stays clean, one Undo restores it', async () => {
  const w = await bootApp(); const a = w.__app;
  a.aiAddKey(KEY, 'A', true, 'gemini');
  addPages(w, ['প্রশ্ন ১: ৫ × ৬ = ৩০', 'প্রশ্ন ২: ২ + ৩ = ৬', 'প্রশ্ন ৩: শেষ']);
  a.renderAll();
  const ISSUE = JSON.stringify({ verdict: 'issues', summary: 'x', issues: [{ page: 2, type: 'calculation', detail: '2 + 3 = 6 ভুল', fix: '2 + 3 = 5' }], calculationsChecked: 3, sequenceEnd: 'প্রশ্ন ৩' });
  const FIXED = '=== Page 1 ===\nপ্রশ্ন ১: ৫ × ৬ = ৩০\n\n=== Page 2 ===\nপ্রশ্ন ২: ২ + ৩ = ৫\n\n=== Page 3 ===\nপ্রশ্ন ৩: শেষ';
  const calls = fakeAi(w, n => n === 1 ? ISSUE : n === 2 ? FIXED : OK);
  const c = await a.aiCertifyDocument({});
  assert.equal(calls.length, 3, 'audit → fix → re-audit');
  assert.match(calls[1], /<issues>[\s\S]*page 2[\s\S]*CORRECT: 2 \+ 3 = 5/);
  assert.equal(c.verdict, 'ok'); assert.equal(c.fixedPages, 1);
  assert.equal(a.state.pages[1].text, 'প্রশ্ন ২: ২ + ৩ = ৫');
  assert.equal(a.state.pages[0].text, 'প্রশ্ন ১: ৫ × ৬ = ৩০', 'untouched pages stay as they were');
  assert.ok(!a.buildAllText().startsWith('════'), 'no certificate/comment block in the document by default');
  assert.equal(a.undoBulk(), true);
  assert.equal(a.state.pages[1].text, 'প্রশ্ন ২: ২ + ৩ = ৬', 'one Undo restores everything the doc-fix changed');
  w.close();
});

test('doc-fix: a fix that makes a sum worse, or drops most of the text, is refused', async () => {
  const w = await bootApp(); const a = w.__app;
  a.aiAddKey(KEY, 'A', true, 'gemini');
  addPages(w, ['প্রশ্ন ১: ৫ × ৬ = ৩০', 'প্রশ্ন ২: ২ + ৩ = ৬', 'প্রশ্ন ৩: শেষ']);
  a.renderAll();
  const ISSUE = JSON.stringify({ verdict: 'issues', summary: 'x', issues: [{ page: 2, type: 'text', detail: 'd', fix: 'f' }], calculationsChecked: 0, sequenceEnd: '' });
  const WORSE = '=== Page 1 ===\nপ্রশ্ন ১: ৫ × ৬ = ৩১\n\n=== Page 2 ===\nপ্রশ্ন ২: ২ + ৩ = ৬\n\n=== Page 3 ===\nপ্রশ্ন ৩: শেষ';
  fakeAi(w, n => n === 1 ? ISSUE : WORSE);
  await a.aiCertifyDocument({});
  assert.equal(a.state.pages[0].text, 'প্রশ্ন ১: ৫ × ৬ = ৩০', 'the sum was not made worse');
  w.close();
});

test('manual "পুরো text AI Fix": fixes even when the auto option is off, and the AI board in the dialog shows the same stage', async () => {
  const w = await bootApp(); const a = w.__app;
  a.aiAddKey(KEY, 'A', true, 'gemini');
  w.localStorage.setItem(a.LS_AI_OPTS, JSON.stringify({ docfix: false, auto: true, autoV2: true, certify: true }));
  addPages(w, ['প্রশ্ন ১: ৫ × ৬ = ৩০', 'প্রশ্ন ২: ২ + ৩ = ৬', 'প্রশ্ন ৩: শেষ']);
  a.renderAll();
  const ISSUE = JSON.stringify({ verdict: 'issues', summary: 'x', issues: [{ page: 2, type: 'calculation', detail: 'd', fix: '2 + 3 = 5' }], calculationsChecked: 3, sequenceEnd: '' });
  const FIXED = '=== Page 1 ===\nপ্রশ্ন ১: ৫ × ৬ = ৩০\n\n=== Page 2 ===\nপ্রশ্ন ২: ২ + ৩ = ৫\n\n=== Page 3 ===\nপ্রশ্ন ৩: শেষ';
  // automatic run with the option off → report only
  let calls = fakeAi(w, n => n === 1 ? ISSUE : OK);
  await a.aiCertifyDocument({ auto: true });
  assert.equal(calls.length, 1); assert.equal(a.state.pages[1].text, 'প্রশ্ন ২: ২ + ৩ = ৬');
  // the button pressed by hand → always fixes
  a.state.cert = null;
  calls = fakeAi(w, n => n === 1 ? ISSUE : n === 2 ? FIXED : OK);
  const f0 = w.fetch; w.fetch = async (u, i) => { if (!/\/models\?/.test(u)) await tick(40); return f0(u, i); };   // slow AI so the running state can be looked at
  // open the AI dialog first so the board can be seen
  a.openTextTools('ai'); await tick(30);
  const p = a.aiCertifyDocument({ manual: true });
  await tick(5);
  assert.ok(w.document.getElementById('docBoard'), 'the AI dialog shows the whole-document stage while it runs');
  assert.match(w.document.getElementById('docBoard').textContent, /পুরো document|whole document/i);
  assert.match(w.document.getElementById('certPanel').className, /running/);
  const c = await p;
  assert.equal(c.verdict, 'ok'); assert.equal(a.state.pages[1].text, 'প্রশ্ন ২: ২ + ৩ = ৫');
  assert.match(w.document.getElementById('docBoard').className, /ok/);
  w.close();
});

test('uploaded formatted .txt: headers with or without a name become pages; a long text with no headers is split into page-sized parts', async () => {
  const w = await bootApp(); const a = w.__app;
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
  const mk = txt => ({ name: 'book.txt', type: 'text/plain', text: async () => txt });
  await a.loadTxt(mk('════ সনদ ════\n\n=== পেজ 1 — a.jpg ===\nএক\n\n=== Page 2 ===\nদুই\n\n=== Page 3 — c.jpg · AI ✓ ===\nতিন'));
  assert.equal(a.state.pages.length, 3);
  assert.equal(a.state.pages[1].text, 'দুই'); assert.equal(a.state.pages[0].text, 'এক');
  a.resetWorkspaceState && a.resetWorkspaceState();
  const para = 'প্রশ্ন: ' + 'ক'.repeat(500);
  const big = Array.from({ length: 40 }, () => para).join('\n\n');
  const parts = a.splitBigText(big);
  assert.ok(parts.length >= 4 && parts.every(x => x.length <= 4600), 'parts stay page-sized');
  assert.equal(parts.join('\n\n').replace(/\s+/g, ''), big.replace(/\s+/g, ''), 'nothing is lost');
  assert.equal(a.splitBigText('ছোট লেখা').length, 1);
  w.close();
});
