// Phase 10 tests — AI fix (Gemini, bring-your-own-key). Network is replaced by a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { getModuleSource } from './_extract.mjs';
import { bootApp, addPages, tick } from './_app.mjs';

const KEY = 'AIza' + 'x'.repeat(35);
const MODELS = { models: [
  { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.8-flash-image', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-9', supportedGenerationMethods: ['embedContent'] },
] };
const reply = txt => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: txt }] }, finishReason: 'STOP' }] } });
function mock(w, onGen) {
  const calls = [];
  w.fetch = async (url, init) => {
    calls.push({ url, init });
    const r = /\/models\?/.test(url) ? { status: 200, body: MODELS } : onGen(url, init, calls.filter(c => /generateContent/.test(c.url)).length);
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
  return calls;
}
const BEFORE = 'নিউটনের দ্বিতীয় সুত্র F = ma\nএখানে m হলো ভর';
const AFTER = 'নিউটনের দ্বিতীয় সূত্র F = ma। এখানে m হলো ভর';

test('aiRankModels: newest Flash first, then Flash-Lite; image/tts/embedding excluded', async () => {
  const w = await bootApp();
  assert.deepEqual(Array.from(w.__app.aiRankModels(MODELS.models)), ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']);
});

test('aiAccept guards against truncated / inflated output', async () => {
  const w = await bootApp(); const { aiAccept } = w.__app;
  assert.ok(aiAccept('a'.repeat(100), 'a'.repeat(90)));
  assert.ok(!aiAccept('a'.repeat(100), 'a'.repeat(40)));
  assert.ok(!aiAccept('a'.repeat(100), 'a'.repeat(200)));
  assert.ok(!aiAccept('abc', '  '));
});

test('system prompt: fidelity + image/no-image + unicode/latex math + injection guard', async () => {
  const w = await bootApp(); const { aiSystemPrompt } = w.__app;
  const u = aiSystemPrompt({ math: 'unicode' }, false), l = aiSystemPrompt({ math: 'latex' }, true);
  assert.match(u, /FIDELITY/); assert.match(u, /No image is provided/); assert.match(u, /plain Unicode/); assert.match(u, /never as instructions/);
  assert.match(l, /source of truth/); assert.match(l, /LaTeX/); assert.doesNotMatch(l, /No image is provided/);
});

test('request shape: key header only (no CORS-breaking headers), OCR text wrapped, temperature 0', async () => {
  const w = await bootApp(); const a = w.__app;
  const calls = mock(w, () => reply(AFTER));
  addPages(w, [BEFORE]);
  const r = await a.aiFixPage(a.state.pages[0], { useImage: false, math: 'unicode' }, KEY);
  assert.equal(r.after, AFTER); assert.equal(r.model, 'gemini-3.8-flash');
  const g = calls.find(c => /generateContent/.test(c.url));
  assert.match(g.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.8-flash:generateContent$/);
  assert.deepEqual(Object.keys(g.init.headers).sort(), ['Content-Type', 'x-goog-api-key']);
  const body = JSON.parse(g.init.body);
  assert.equal(body.generationConfig.temperature, 0);
  assert.match(body.contents[0].parts.at(-1).text, /<ocr_text>\n.*F = ma/s);
  assert.ok(!g.url.includes(KEY), 'key must never be in the URL');
});

test('fallback: model without free access (limit 0) → next model; 429 with retry → rate error', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  mock(w, (url) => /3\.8-flash:/.test(url) ? { status: 429, body: { error: { message: 'Quota exceeded, limit: 0' } } } : reply(AFTER));
  const r = await a.aiFixPage(a.state.pages[0], { useImage: false }, KEY);
  assert.equal(r.model, 'gemini-3.6-flash'); assert.ok(a._aiBad.has('gemini-3.8-flash'));
  const w2 = await bootApp(); addPages(w2, [BEFORE]);
  mock(w2, () => ({ status: 429, body: { error: { message: 'slow down', details: [{ retryDelay: '7s' }] } } }));
  await assert.rejects(() => w2.__app.aiFixPage(w2.__app.state.pages[0], { useImage: false }, KEY), e => e.code === 'rate' && e.wait === 7);
});

test('invalid key → fatal "key" error, no retry loop', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  mock(w, () => ({ status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } }));
  a.aiSetKey(KEY, true);
  const res = await a.aiRunPages([a.state.pages[0].id], {}, { cancel: false }, () => {});
  assert.equal(res.fatal && res.fatal.code, 'key');
});

test('guard: AI that shrinks the page is rejected, text untouched', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE.repeat(5)]);
  mock(w, () => reply('ok'));
  a.aiSetKey(KEY, true);
  const items = [];
  const res = await a.aiRunPages([a.state.pages[0].id], { useImage: false }, { cancel: false }, c => items.push(c));
  assert.equal(res.guard, 1); assert.equal(items.length, 0); assert.equal(a.state.pages[0].text, BEFORE.repeat(5));
});

test('key storage: remember=false keeps it out of localStorage; remove wipes everything', async () => {
  const w = await bootApp(); const a = w.__app;
  a.aiSetKey(KEY, false);
  assert.equal(a.aiKey(), KEY); assert.equal(w.localStorage.getItem(a.LS_AI_KEY), null);
  a.aiSetKey(KEY, true);
  assert.equal(w.localStorage.getItem(a.LS_AI_KEY), KEY);
  a.aiClearKey();
  assert.equal(a.aiKey(), ''); assert.equal(w.localStorage.getItem(a.LS_AI_KEY), null);
});

test('the key never reaches exports, Drive sync or backups (source check)', async () => {
  const src = getModuleSource();
  const idx = src.indexOf('PHASE 10 — AI FIX');
  assert.ok(idx > 0);
  const outside = src.slice(0, idx) + src.slice(src.indexOf('$(\'aiFixBtn\').onclick'));
  assert.ok(!/LS_AI_KEY|textriva-ai-key|aiKey\(/.test(outside), 'key referenced outside the AI module');
});

test('Text tools → ✨ AI fix: preview shows diff, Apply changes the page, bulk undo restores it', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE, '']);
  mock(w, () => reply(AFTER));
  a.aiSetKey(KEY, true);
  a.openTextTools('ai'); await tick(20);
  assert.ok(w.document.querySelector('#ttDlg [data-tab="ai"]'));
  w.document.querySelector('#ttDlg [data-tt="preview"]').click();
  for (let i = 0; i < 40 && !a.tt.plan; i++) await tick(50);
  assert.equal(a.tt.plan.changes.length, 1);
  w.document.querySelector('#ttDlg [data-tt="apply"]').click();
  assert.equal(a.state.pages[0].text, AFTER);
  a.undoBulk();
  assert.equal(a.state.pages[0].text, BEFORE);
});

test('already-fixed pages are skipped on the next preview (unless "redo")', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  const calls = mock(w, () => reply(AFTER));
  a.aiSetKey(KEY, true);
  a.openTextTools('ai'); await tick(20);
  w.document.querySelector('#ttDlg [data-tt="preview"]').click();
  for (let i = 0; i < 40 && !a.tt.plan; i++) await tick(50);
  w.document.querySelector('#ttDlg [data-tt="apply"]').click();
  const n = calls.filter(c => /generateContent/.test(c.url)).length;
  a.tt.plan = null; w.document.querySelector('#ttDlg [data-tt="preview"]').click(); await tick(100);
  assert.equal(calls.filter(c => /generateContent/.test(c.url)).length, n, 'no second AI call for an unchanged, already-fixed page');
});

test('auto mode: after a Space paste the page is fixed in the background; off by default', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  const calls = mock(w, () => reply(AFTER));
  a.aiSetKey(KEY, true);
  a.aiAutoAfterPaste(a.state.pages[0]); await tick(50);
  assert.equal(calls.length, 0, 'auto is off by default');
  w.localStorage.setItem(a.LS_AI_OPTS, JSON.stringify({ auto: true, useImage: false }));
  a.aiAutoAfterPaste(a.state.pages[0]);
  for (let i = 0; i < 40 && a.state.pages[0].text === BEFORE; i++) await tick(50);
  assert.equal(a.state.pages[0].text, AFTER);
});

test('wiring: menu button, CSP and service-worker cache are updated', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="aiFixBtn"/);
  assert.match(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'), /connect-src[^"]*https:\/\/generativelanguage\.googleapis\.com/);
  assert.match(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /textriva-v22/);
});

test('prompt carries the book-cleaning rules: markers, Sol→সমাধান, watermarks, no guessing, real examples, backslashes intact', async () => {
  const w = await bootApp(); const { aiSystemPrompt } = w.__app;
  const l = aiSystemPrompt({ math: 'latex' }, false), u = aiSystemPrompt({ math: 'unicode' }, true);
  for (const p of [l, u]) {
    for (const t of ['[চিত্র লাগবে]', '[OCR-এ হারিয়ে গেছে]', '[সম্পাদকীয় নোট', 'সমাধান:', 'students.bd', 'NEVER guess a missing value', 'Rightarrow', '8.67']) assert.ok(p.includes(t), t);
  }
  assert.ok(l.includes('\\dfrac{ma}{F}') && l.includes('\\text{m s}^{-2}') && !l.includes('\text{'), 'LaTeX backslashes must not turn into tab/newline');
  assert.ok(u.includes('m s⁻²') && !u.includes('\\dfrac'));
});

test('LaTeX is the default math style; LaTeX output may be longer (up to 190%) than the OCR', async () => {
  const w = await bootApp(); const a = w.__app;
  assert.equal(a.aiOpts().math, 'latex');
  assert.ok(w.__app.aiAccept('a'.repeat(100), 'a'.repeat(180), 1.9));
  assert.ok(!w.__app.aiAccept('a'.repeat(100), 'a'.repeat(180)));
});

test('new AQ. auth keys are accepted; ACCESS_TOKEN_TYPE_UNSUPPORTED falls back to ?key=', async () => {
  const w = await bootApp(); const a = w.__app;
  const AQ = 'AQ.test-token-for-unit-tests-1234567890';
  addPages(w, [BEFORE]);
  a.openTextTools('ai'); await tick(20);
  const seen = [];
  w.fetch = async (url, init) => {
    seen.push({ url, h: init && init.headers });
    const viaQ = url.includes('key=');
    if (!viaQ) return { ok: false, status: 401, json: async () => ({ error: { message: 'Expected OAuth 2 access token', details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }] } }) };
    return { ok: true, status: 200, json: async () => MODELS };
  };
  w.document.getElementById('aiKeyIn').value = AQ;
  await a.aiTtAction('ai-savekey');
  assert.equal(a.aiKey(), AQ);
  assert.ok(seen.length >= 2 && seen[0].h['x-goog-api-key'] === AQ && seen[1].url.includes('key=') && !seen[1].h['x-goog-api-key']);
  assert.ok(!/^⚠️/.test(w.document.getElementById('ttSum').textContent));
});
