// Phase 10 tests — AI fix (bring-your-own-key, multi-key, multi-provider). Network is replaced by a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { getModuleSource } from './_extract.mjs';
import { bootApp, addPages, tick } from './_app.mjs';

const KEY = 'AIza' + 'x'.repeat(35);
const KEY2 = 'AIza' + 'y'.repeat(35);
const GROQ = 'gsk_' + 'g'.repeat(30);
const MODELS = { models: [
  { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.8-flash-image', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-9', supportedGenerationMethods: ['embedContent'] },
] };
const OA_MODELS = {
  'api.groq.com': { data: [{ id: 'llama-4-maverick-17b-128e-instruct' }, { id: 'whisper-large-v3' }, { id: 'llama-4-scout-17b-16e-instruct' }, { id: 'openai/gpt-oss-120b' }, { id: 'llama-3.1-8b-instant' }, { id: 'meta-llama/llama-guard-4-12b' }] },
  'api.cerebras.ai': { data: [{ id: 'llama3.1-8b' }, { id: 'gpt-oss-120b' }, { id: 'zai-glm-4.6' }, { id: 'qwen-3-235b-a22b-instruct-2507' }] },
};
const reply = txt => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: txt }] }, finishReason: 'STOP' }] } });
const oaReply = txt => ({ status: 200, body: { choices: [{ message: { content: txt }, finish_reason: 'stop' }] } });
// Fake network. gen(url, init, n) answers Gemini generateContent; oa(url, init, n) answers chat/completions. r.delay = ms latency.
function mock(w, gen, oa) {
  const calls = []; let live = 0, max = 0;
  w.fetch = async (url, init) => {
    calls.push({ url, init });
    let r;
    if (/generativelanguage/.test(url)) r = /\/models\?/.test(url) ? { status: 200, body: MODELS } : gen(url, init, calls.filter(c => /generateContent/.test(c.url)).length);
    else if (/\/models$/.test(url)) r = { status: 200, body: OA_MODELS[new URL(url).host] || { data: [] } };
    else r = (oa || gen)(url, init, calls.filter(c => /chat\/completions/.test(c.url)).length);
    if (r.delay) { live++; max = Math.max(max, live); await new Promise(res => setTimeout(res, r.delay)); live--; }
    return { ok: r.status === 200, status: r.status, headers: { get: h => (r.headers || {})[String(h).toLowerCase()] ?? null }, json: async () => r.body };
  };
  calls.maxLive = () => max;
  return calls;
}
const isGen = c => /generateContent|chat\/completions/.test(c.url);
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

test('system prompt: calculation audit always on; neighbour-page rules only when neighbours are sent', async () => {
  const w = await bootApp(); const { aiSystemPrompt } = w.__app;
  const a = aiSystemPrompt({ math: 'latex' }, false, false), b = aiSystemPrompt({ math: 'latex' }, false, true);
  for (const p of [a, b]) { assert.match(p, /CALCULATIONS — VERIFY, NEVER SOLVE/); assert.match(p, /FINAL CHECKLIST/); assert.match(p, /1S0/); assert.match(p, /12 × 5 = 60/); }
  assert.doesNotMatch(a, /NEIGHBOURING PAGES/); assert.doesNotMatch(a, /previous_page_tail/);
  assert.match(b, /NEIGHBOURING PAGES/); assert.match(b, /<previous_page_tail>/); assert.match(b, /COMPLETING A CUT-OFF ITEM/);
  assert.match(a, /never see the neighbouring pages/); assert.match(b, /read-only excerpt of the neighbouring pages/);
});

test('provider detection from the key shape', async () => {
  const w = await bootApp(); const d = w.__app.aiDetectProvider;
  assert.equal(d(KEY), 'gemini'); assert.equal(d('AQ.test-token-for-unit-tests-1234567890'), 'gemini');
  assert.equal(d(GROQ), 'groq'); assert.equal(d('sk-or-v1-' + 'a'.repeat(30)), 'openrouter');
  assert.equal(d('csk-' + 'c'.repeat(30)), 'cerebras'); assert.equal(d('A'.repeat(32)), 'mistral');
  assert.equal(d('hello'), null);
});

test('aiRankOA: keeps suitable chat models per provider; vision first; junk excluded', async () => {
  const w = await bootApp(); const r = w.__app.aiRankOA;
  const groq = r('groq', OA_MODELS['api.groq.com']);
  assert.deepEqual(Array.from(groq, x => x.name), ['llama-4-scout-17b-16e-instruct', 'llama-4-maverick-17b-128e-instruct', 'openai/gpt-oss-120b']);
  assert.deepEqual(Array.from(groq, x => x.vision), [true, true, false]);
  const cer = r('cerebras', OA_MODELS['api.cerebras.ai']);
  assert.deepEqual(Array.from(cer, x => x.name), ['gpt-oss-120b', 'qwen-3-235b-a22b-instruct-2507', 'llama3.1-8b']);
  assert.ok(cer.every(x => !x.vision));
  const mis = r('mistral', { data: [
    { id: 'mistral-small-latest', capabilities: { vision: true } }, { id: 'mistral-large-latest', capabilities: { vision: false } }, { id: 'codestral-latest' },
    { id: 'mistral-embed' }, { id: 'pixtral-large-latest', capabilities: { vision: true } }, { id: 'mistral-medium-latest', capabilities: { vision: true } }, { id: 'mistral-moderation-latest' }] });
  assert.deepEqual(Array.from(mis, x => x.name), ['mistral-medium-latest', 'pixtral-large-latest', 'mistral-small-latest', 'mistral-large-latest']);
  const or = r('openrouter', { data: [
    { id: 'a/text-model:free', context_length: 200000, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
    { id: 'b/vision:free', context_length: 32000, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
    { id: 'c/paid-model', context_length: 9e5, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
    { id: 'd/draw:free', context_length: 9e5, architecture: { input_modalities: ['text'], output_modalities: ['image'] } }] });
  assert.deepEqual(Array.from(or, x => x.name), ['b/vision:free', 'a/text-model:free']);
});

test('aiRetryWait: Retry-After header, "try again in 1m30s", ms, fallback', async () => {
  const w = await bootApp(); const f = w.__app.aiRetryWait;
  assert.equal(f('12', ''), 12); assert.equal(f(null, 'Please try again in 1m30.5s.'), 91); assert.equal(f(null, 'try again in 7.2s'), 8);
  assert.equal(f(null, 'try again in 250ms'), 1); assert.equal(f(null, 'whatever'), 30);
});

test('Gemini request shape: key header only (no CORS-breaking headers), OCR text wrapped, temperature 0', async () => {
  const w = await bootApp(); const a = w.__app;
  const calls = mock(w, () => reply(AFTER));
  addPages(w, [BEFORE]); a.aiAddKey(KEY, 'k1', true);
  const r = await a.aiFixPage(a.state.pages[0], { useImage: false, math: 'unicode' }, 'none');
  assert.equal(r.after, AFTER); assert.equal(r.model, 'gemini-3.8-flash'); assert.equal(r.keyName, 'k1');
  const g = calls.find(isGen);
  assert.match(g.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.8-flash:generateContent$/);
  assert.deepEqual(Object.keys(g.init.headers).sort(), ['Content-Type', 'x-goog-api-key']);
  const body = JSON.parse(g.init.body);
  assert.equal(body.generationConfig.temperature, 0);
  assert.match(body.contents[0].parts.at(-1).text, /<ocr_text>\n.*F = ma/s);
  assert.ok(!g.url.includes(KEY), 'key must never be in the URL');
});

test('cross-page context: neighbours are sent as read-only tail/head; off with context:false; first page has no previous', async () => {
  const w = await bootApp(); const a = w.__app;
  const calls = mock(w, () => reply(AFTER));
  addPages(w, ['PAGE-ZERO-TEXT ' + BEFORE, BEFORE, 'PAGE-TWO-TEXT ' + BEFORE]); a.aiAddKey(KEY, 'k1', true);
  await a.aiFixPage(a.state.pages[1], { useImage: false, math: 'unicode' }, 'x');
  let b = JSON.parse(calls.filter(isGen)[0].init.body);
  const t = b.contents[0].parts.at(-1).text;
  assert.match(t, /<previous_page_tail>\nPAGE-ZERO-TEXT/); assert.match(t, /<next_page_head>\nPAGE-TWO-TEXT/);
  assert.match(b.systemInstruction.parts[0].text, /NEIGHBOURING PAGES/);
  assert.ok(t.indexOf('<previous_page_tail>') < t.indexOf('<ocr_text>') && t.indexOf('<ocr_text>') < t.indexOf('<next_page_head>'));
  await a.aiFixPage(a.state.pages[0], { useImage: false, math: 'unicode' }, 'x');
  b = JSON.parse(calls.filter(isGen)[1].init.body);
  assert.doesNotMatch(b.contents[0].parts.at(-1).text, /previous_page_tail/);
  await a.aiFixPage(a.state.pages[1], { useImage: false, math: 'unicode', context: false }, 'x');
  b = JSON.parse(calls.filter(isGen)[2].init.body);
  assert.doesNotMatch(b.contents[0].parts.at(-1).text, /previous_page_tail|next_page_head/);
  assert.doesNotMatch(b.systemInstruction.parts[0].text, /NEIGHBOURING PAGES/);
});

test('number check: a number the AI invented triggers ONE auditor call that restores the author\'s text; verify:false skips it', async () => {
  const w = await bootApp(); const a = w.__app;
  const NEW = AFTER + ' 99';
  const calls = mock(w, (u, init, n) => reply(n === 1 ? NEW : AFTER));
  addPages(w, [BEFORE]); a.aiAddKey(KEY, 'k1', true);
  const r = await a.aiFixPage(a.state.pages[0], { useImage: false, math: 'unicode' }, 'x');
  assert.equal(calls.filter(isGen).length, 2); assert.equal(r.after, AFTER); assert.ok(r.reviewed); assert.deepEqual(Array.from(r.flags.added), []);
  const b2 = JSON.parse(calls.filter(isGen)[1].init.body);
  assert.match(b2.systemInstruction.parts[0].text, /AUDIT RULES/); assert.match(b2.contents[0].parts.at(-1).text, /<flagged_numbers>\nadded: 99/);
  const w2 = await bootApp(); const a2 = w2.__app;
  const c2 = mock(w2, () => reply(NEW)); addPages(w2, [BEFORE]); a2.aiAddKey(KEY, 'k1', true);
  const r2 = await a2.aiFixPage(a2.state.pages[0], { useImage: false, math: 'unicode', verify: false }, 'x');
  assert.equal(c2.filter(isGen).length, 1); assert.equal(r2.after, NEW); assert.deepEqual(Array.from(r2.flags.added), ['99']); assert.ok(!r2.reviewed);
});

test('aiVerify: Bangla/English digits and LaTeX re-spelling are NOT new numbers; a changed digit is', async () => {
  const w = await bootApp(); const v = w.__app.aiVerify;
  assert.deepEqual(Array.from(v('I = MK2 = 5 x (0.2)2 m * s ^ - 2 জড় ১২', String.raw`$I = MK^2 = 5 \times (0.2)^2\ \text{m s}^{-2}$ জড় 12`).added), []);
  const d = v('F = 12 x 5 = 65 N', String.raw`$F = 12 \times 5 = 60\ \text{N}$`);
  assert.deepEqual(Array.from(d.added), ['60']); assert.deepEqual(Array.from(d.lost), ['65']);
});

test('fallback: model without free access (limit 0) → next model; 429 with retry → rate error', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]); a.aiAddKey(KEY, 'k1', true);
  mock(w, (url) => /3\.8-flash:/.test(url) ? { status: 429, body: { error: { message: 'Quota exceeded, limit: 0' } } } : reply(AFTER));
  const r = await a.aiFixPage(a.state.pages[0], { useImage: false }, 'x');
  assert.equal(r.model, 'gemini-3.6-flash'); assert.ok(a._aiBad.has(KEY.slice(-8) + '::gemini-3.8-flash'));
  const w2 = await bootApp(); addPages(w2, [BEFORE]); w2.__app.aiAddKey(KEY, 'k1', true);
  mock(w2, () => ({ status: 429, body: { error: { message: 'slow down', details: [{ retryDelay: '7s' }] } } }));
  await assert.rejects(() => w2.__app.aiFixPage(w2.__app.state.pages[0], { useImage: false }, 'x'), e => e.code === 'rate' && e.wait === 7);
});

test('invalid key → fatal "key" error, no retry loop', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  mock(w, () => ({ status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } }));
  a.aiAddKey(KEY, 'k1', true);
  const res = await a.aiRunPages([a.state.pages[0].id], {}, { cancel: false }, () => {});
  assert.equal(res.failed, 1); assert.equal(res.lastErr && res.lastErr.code, 'key');
});

test('guard: AI that shrinks the page is rejected, text untouched', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE.repeat(5)]);
  mock(w, () => reply('ok'));
  a.aiAddKey(KEY, 'k1', true);
  const items = [];
  const res = await a.aiRunPages([a.state.pages[0].id], { useImage: false }, { cancel: false }, c => items.push(c));
  assert.equal(res.guard, 1); assert.equal(items.length, 0); assert.equal(a.state.pages[0].text, BEFORE.repeat(5));
});

test('key storage: remember=false keeps it out of localStorage; remove wipes everything; old records get a provider', async () => {
  const w = await bootApp(); const a = w.__app;
  a.aiAddKey(KEY, 'mem', false);
  assert.equal(a.aiKey(), KEY); assert.equal(w.localStorage.getItem(a.LS_AI_KEYS), null);
  const rec = a.aiAddKey(GROQ, 'gq', true);
  assert.equal(rec.provider, 'groq');
  assert.ok(w.localStorage.getItem(a.LS_AI_KEYS).includes(GROQ)); assert.ok(!w.localStorage.getItem(a.LS_AI_KEYS).includes(KEY));
  w.localStorage.setItem(a.LS_AI_KEYS, JSON.stringify([{ id: 'old', name: 'old', key: KEY2 }]));       // saved by an older version (no provider)
  assert.equal(a.aiKeyList().find(k => k.key === KEY2).provider, 'gemini');
  a.aiClearKey();
  assert.equal(a.aiKey(), ''); assert.equal(w.localStorage.getItem(a.LS_AI_KEYS), null);
});

test('the key never reaches exports, Drive sync or backups (source check)', async () => {
  const src = getModuleSource();
  const idx = src.indexOf('PHASE 10 — AI FIX');
  assert.ok(idx > 0);
  const outside = src.slice(0, idx) + src.slice(src.indexOf('$(\'aiFixBtn\').onclick'));
  assert.ok(!/LS_AI_KEY|textriva-ai-key|aiKey\(|aiKeyList\(/.test(outside), 'key referenced outside the AI module');
});

test('free providers: OpenAI-style request (Bearer, messages, temperature 0); image only to vision models; text-only model gets a no-image prompt', async () => {
  const w = await bootApp(); const a = w.__app;
  const calls = mock(w, () => reply(AFTER), () => oaReply(AFTER));
  const gq = a.aiAddKey(GROQ, 'gq', true), cs = a.aiAddKey('csk-' + 'c'.repeat(30), 'cs', true);
  const IMG = { mimeType: 'image/jpeg', data: 'AAAA' };
  const seen = [];
  const mk = withImg => { seen.push(withImg); return { system: 'SYS' + (withImg ? '-IMG' : ''), text: 'TXT', img: withImg ? IMG : null }; };
  const r1 = await a.aiGenerateAnyKey(mk, true, gq.id);
  assert.equal(r1.provider, 'groq'); assert.equal(r1.withImage, true); assert.equal(r1.model, 'llama-4-scout-17b-16e-instruct');
  const g = calls.find(c => /chat\/completions/.test(c.url));
  assert.equal(g.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.deepEqual(Object.keys(g.init.headers).sort(), ['Authorization', 'Content-Type']); assert.equal(g.init.headers.Authorization, 'Bearer ' + GROQ);
  const body = JSON.parse(g.init.body);
  assert.equal(body.temperature, 0); assert.equal(body.messages[0].role, 'system'); assert.equal(body.messages[0].content, 'SYS-IMG');
  assert.equal(body.messages[1].content[0].type, 'image_url'); assert.match(body.messages[1].content[0].image_url.url, /^data:image\/jpeg;base64,AAAA$/);
  const r2 = await a.aiGenerateAnyKey(mk, true, cs.id);                 // Cerebras: text only
  assert.equal(r2.provider, 'cerebras'); assert.equal(r2.withImage, false);
  const c = calls.filter(x => /api\.cerebras\.ai\/v1\/chat\/completions/.test(x.url)).at(-1), cb = JSON.parse(c.init.body);
  assert.equal(cb.messages[0].content, 'SYS'); assert.equal(typeof cb.messages[1].content, 'string');
  assert.deepEqual(seen, [true, false]);
});

test('reasoning models: <think>…</think> blocks are stripped from the output', async () => {
  const w = await bootApp(); const a = w.__app;
  mock(w, () => reply(AFTER), () => oaReply('<think>hmm, let me check</think>\n' + AFTER));
  addPages(w, [BEFORE]); a.aiAddKey(GROQ, 'gq', true);
  const r = await a.aiFixPage(a.state.pages[0], { useImage: false, math: 'unicode' }, 'x');
  assert.equal(r.after, AFTER);
});

test('daily quota gone (Retry-After in hours): model is skipped for the session and the run fails fast instead of waiting', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  mock(w, () => reply(AFTER), () => ({ status: 429, headers: { 'retry-after': '3600' }, body: { error: { message: 'Rate limit reached ... requests per day' } } }));
  a.aiAddKey(GROQ, 'gq', true);
  const t0 = Date.now();
  const res = await a.aiRunPages([a.state.pages[0].id], { useImage: false }, { cancel: false }, () => {});
  assert.ok(Date.now() - t0 < 5000, 'must not sit through retry sleeps');
  assert.equal(res.failed, 0); assert.equal(res.fatal.code, 'rate'); assert.equal(res.fatal.wait, 3600);   // every key's daily quota is gone → stop cleanly, page left untouched
  assert.equal(a.state.pages[0].aiFixedHash || null, null);
  assert.ok(a._aiBad.has(GROQ.slice(-8) + '::llama-4-scout-17b-16e-instruct'));
});

test('mixed pool: a dead/limited provider key falls through to the next key (other provider)', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  mock(w, () => reply(AFTER), () => ({ status: 401, body: { error: { message: 'Invalid API Key' } } }));
  a.aiAddKey(GROQ, 'gq', true); a.aiAddKey(KEY, 'gem', true);
  const r = await a.aiFixPage(a.state.pages[0], { useImage: false, math: 'unicode' }, 'x');
  assert.equal(r.keyName, 'gem'); assert.equal(r.after, AFTER);
});

test('parallel + live board: 2 keys × 3 slots = 6 pages at once; every page shows which key did it (letter + colour)', async () => {
  const w = await bootApp(); const a = w.__app;
  const pages = Array.from({ length: 6 }, (_, i) => BEFORE + ' ' + (i + 1));
  const calls = mock(w, () => ({ ...reply(AFTER), delay: 900 }), () => ({ ...oaReply(AFTER), delay: 900 }));
  addPages(w, pages);
  a.aiAddKey(KEY, 'আমার Gmail', true); a.aiAddKey(GROQ, 'Groq key', true);
  const run = { cancel: false }, items = []; let midBoard = '';
  const p = a.aiRunPages(a.state.pages.map(x => x.id), { useImage: false, math: 'unicode', verify: false }, run, c => items.push(c), () => {});
  await tick(1300); midBoard = a.aiBoardHtml(run);
  const res = await p;
  assert.equal(res.ok, 6); assert.equal(items.length, 6);
  assert.ok(calls.maxLive() >= 4 && calls.maxLive() <= 6, 'concurrency ' + calls.maxLive());
  assert.match(midBoard, /ai-live-hdr/); assert.match(midBoard, /ai-lane busy/); assert.match(midBoard, /st-run/); assert.match(midBoard, /আমার Gmail/); assert.match(midBoard, /Groq/);
  const end = a.aiBoardHtml(run);
  assert.match(end, /AI শেষ|AI finished/); assert.match(end, /100%/);
  assert.equal((end.match(/class="ai-cell st-ok"/g) || []).length, 6);
  assert.match(end, /<sup>A<\/sup>/); assert.match(end, /<sup>B<\/sup>/);
  assert.match(end, /--kc:#3b82f6/); assert.match(end, /--kc:#f59e0b/);
  assert.equal(run.stat.keys.reduce((n, k) => n + k.done, 0), 6);
  assert.ok(items.every(c => c.note && /Gmail|Groq key/.test(c.note)), 'each preview item names its key');
});

test('Text tools → ✨ AI fix: live board while running, page is written in DIRECTLY (no Apply), one bulk undo restores it', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE, '']);
  mock(w, () => ({ ...reply(AFTER), delay: 700 }));
  a.aiAddKey(KEY, 'k1', true);
  a.openTextTools('ai'); await tick(20);
  assert.ok(w.document.querySelector('#ttDlg [data-tab="ai"]'));
  assert.ok(w.document.getElementById('aiProv'), 'provider picker');
  assert.ok(w.document.querySelector('#ttDlg [data-tt="apply"]').classList.contains('hidden'), 'no Apply step on the AI tab');
  assert.match(w.document.querySelector('#ttDlg [data-tt="preview"]').textContent, /AI চালান|Run AI/);
  w.document.querySelector('#ttDlg [data-tt="preview"]').click();
  await tick(300);
  const board = w.document.getElementById('aiBoard');
  assert.ok(board && /ai-lane/.test(board.innerHTML) && /✨/.test(board.innerHTML), 'board visible while AI works');
  for (let i = 0; i < 60 && a.state.pages[0].text === BEFORE; i++) await tick(50);
  assert.equal(a.state.pages[0].text, AFTER, 'applied by itself');
  assert.ok(a.state.pages[0].aiFixedHash);
  await tick(50);
  assert.match(w.document.getElementById('ttSum').textContent, /1.*(ঠিক|fixed)/);
  a.undoBulk();
  assert.equal(a.state.pages[0].text, BEFORE);
});

test('manual run: many pages → each applied the moment it finishes, ONE undo step for the whole run, already-fixed pages skipped', async () => {
  const w = await bootApp(); const a = w.__app;
  const texts = Array.from({ length: 7 }, (_, i) => BEFORE + ' ' + (i + 1));
  addPages(w, texts);
  a.state.pages[0].aiFixedHash = a.hashStr(a.state.pages[0].text);          // fixed earlier → must be skipped
  const calls = mock(w, () => reply(AFTER));
  a.aiAddKey(KEY, 'k1', true);
  a.openTextTools('ai'); await tick(20);
  const before = a.state.bulkUndo.length;
  w.document.querySelector('#ttDlg [data-tt="preview"]').click();
  for (let i = 0; i < 100 && a.state.pages.slice(1).some(p => p.text !== AFTER); i++) await tick(50);
  assert.equal(calls.filter(isGen).length, 6, 'page 1 (already fixed) is not sent');
  assert.equal(a.state.pages[0].text, texts[0]);
  assert.ok(a.state.pages.slice(1).every(p => p.text === AFTER));
  await tick(100);
  assert.equal(a.state.bulkUndo.length, before + 1, 'one undo step for the run');
  a.undoBulk();
  assert.ok(a.state.pages.slice(1).every((p, i) => p.text === texts[i + 1]));
});

test('closing the dialog does NOT stop a manual AI run; the page is still fixed and a summary waits for the next open', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  mock(w, () => ({ ...reply(AFTER), delay: 400 }));
  a.aiAddKey(KEY, 'k1', true);
  a.openTextTools('ai'); await tick(20);
  w.document.querySelector('#ttDlg [data-tt="preview"]').click(); await tick(100);
  w.document.querySelector('#ttDlg [data-tt="close"]').click();
  for (let i = 0; i < 60 && a.state.pages[0].text === BEFORE; i++) await tick(50);
  assert.equal(a.state.pages[0].text, AFTER);
  await tick(100);
  assert.ok(a.tt.aiHold && /1/.test(a.tt.aiHold.sum));
});

test('rate limit in the middle of a big run: pages WAIT and retry, none are dropped or marked failed', async () => {
  const w = await bootApp(); const a = w.__app;
  addPages(w, Array.from({ length: 6 }, (_, i) => BEFORE + ' ' + (i + 1)));
  let n = 0;
  mock(w, () => (++n <= 2 ? { status: 429, headers: { 'retry-after': '1' }, body: { error: { message: 'quota' } } } : reply(AFTER)));
  a.aiAddKey(KEY, 'k1', true);
  const res = await a.aiRunPages(a.state.pages.map(p => p.id), { useImage: false }, { cancel: false }, c => a.applyTextChanges([{ id: c.id, before: c.before, after: c.after }], 'AI fix'));
  assert.equal(res.failed, 0); assert.equal(res.fatal, null); assert.equal(res.ok, 6);
  assert.ok(a.state.pages.every(p => p.text === AFTER));
});

test('temporary network errors are retried later (page goes back in the queue), not reported as failed', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE, BEFORE + ' 2']);
  const seen = new Set(); let gen = 0;
  w.fetch = async (url, init) => {
    if (/\/models\?/.test(url)) return { ok: true, status: 200, headers: { get: () => null }, json: async () => MODELS };
    gen++;
    if (gen <= 2) throw new Error('network gone (phone was in the background)');
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => reply(AFTER).body };
  };
  a.aiAddKey(KEY, 'k1', true);
  const res = await a.aiRunPages(a.state.pages.map(p => p.id), { useImage: false }, { cancel: false }, c => a.applyTextChanges([{ id: c.id, before: c.before, after: c.after }], 'AI fix'));
  assert.equal(res.failed, 0); assert.equal(res.ok, 2);
  assert.ok(a.state.pages.every(p => p.text === AFTER));
});

test('Stop cancels a run that is waiting on a cooldown (no hang)', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  mock(w, () => reply(AFTER));
  const k = a.aiAddKey(KEY, 'k1', true);
  a._aiCoolingUntil.set(k.key, Date.now() + 60000);                    // 60 s cooldown on the only key
  const run = { cancel: false };
  const p = a.aiRunPages([a.state.pages[0].id], { useImage: false }, run, () => {});
  await tick(150); run.cancel = true;
  const t0 = Date.now(); await p;
  assert.ok(Date.now() - t0 < 2500, 'stops promptly');
  assert.equal(a.state.pages[0].text, BEFORE);
});

test('background-proof timers: bgSleep works, bgKeep holds/releases a Web Lock only while work runs, per-key gate widens after a rate limit', async () => {
  const w = await bootApp(); const a = w.__app;
  const t0 = Date.now(); await a.bgSleep(30); assert.ok(Date.now() - t0 >= 25);
  await a.bgYield();
  let held = 0, released = 0;
  Object.defineProperty(w.navigator, 'locks', { configurable: true, value: { request: (name, cb) => { held++; return Promise.resolve(cb()).then(() => { released++; }); } } });
  const stop1 = a.bgKeep.start(), stop2 = a.bgKeep.start(); await tick(10);
  assert.equal(held, 1, 'one lock for any number of jobs'); assert.equal(a.bgKeep.active, true);
  stop1(); stop1(); assert.equal(a.bgKeep.active, true, 'still one job running');
  stop2(); await tick(10);
  assert.equal(a.bgKeep.active, false); assert.equal(released, 1);
  w.__textrivaNoGate = false;
  await a.aiGate('K1', 'gemini'); const g0 = a._aiGate.get('K1').gap; a.aiGateSlow('K1');
  assert.ok(a._aiGate.get('K1').gap > g0);
});

test('source: no plain setTimeout is left in the AI worker / PDF split / upload retry paths (they would crawl in a hidden tab)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(src, /const aiSleep = bgSleep/);
  assert.match(src, /await bgYield\(\);\s*\/\/ let the UI breathe/);
  assert.ok(!/AI_GAP_MS\)/.test(src.slice(src.indexOf('async function aiRunPages'), src.indexOf('function aiNote'))), 'no fixed per-page sleep');
  assert.match(src, /bgTimer\.set\(pumpUploads, delay\)/);
});

test('floating "AI is working" chip appears for a background (auto) run and disappears afterwards; no timer is left running', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  mock(w, () => ({ ...reply(AFTER), delay: 600 }));
  a.aiAddKey(KEY, 'k1', true);
  w.localStorage.setItem(a.LS_AI_OPTS, JSON.stringify({ auto: true, useImage: false }));
  a.aiAutoAfterPaste(a.state.pages[0]); await tick(250);
  const chip = w.document.getElementById('aiChip');
  assert.ok(chip && !chip.classList.contains('hidden') && /AI/.test(chip.textContent), 'chip visible while working');
  for (let i = 0; i < 60 && a.state.pages[0].text === BEFORE; i++) await tick(50);
  await tick(50);
  assert.ok(w.document.getElementById('aiChip').classList.contains('hidden'));
});

test('already-fixed pages are skipped on the next preview (unless "redo")', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  const calls = mock(w, () => reply(AFTER));
  a.aiAddKey(KEY, 'k1', true);
  a.openTextTools('ai'); await tick(20);
  w.document.querySelector('#ttDlg [data-tt="preview"]').click();
  for (let i = 0; i < 60 && a.state.pages[0].text === BEFORE; i++) await tick(50);
  await tick(100);
  const n = calls.filter(isGen).length;
  w.document.querySelector('#ttDlg [data-tt="preview"]').click(); await tick(100);
  assert.equal(calls.filter(isGen).length, n, 'no second AI call for an unchanged, already-fixed page');
});

test('auto mode is ON by default: a fresh paste/OCR page is fixed in the background; turning it off stops it', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  const calls = mock(w, () => reply(AFTER));
  a.aiAddKey(KEY, 'k1', true);
  w.localStorage.setItem(a.LS_AI_OPTS, JSON.stringify({ auto: false, autoV2: true, useImage: false }));
  a.aiAutoAfterPaste(a.state.pages[0]); await tick(50);
  assert.equal(calls.length, 0, 'explicitly turned off → nothing runs');
  w.localStorage.setItem(a.LS_AI_OPTS, JSON.stringify({ useImage: false }));        // old saved options (no marker) → on
  a.aiAutoAfterPaste(a.state.pages[0]);
  for (let i = 0; i < 60 && a.state.pages[0].text === BEFORE; i++) await tick(50);
  assert.equal(a.state.pages[0].text, AFTER);
});

test('auto mode: a ✨ AI page is never re-run (Save keeps human edits), but a fresh paste on it is fixed again; queue does not double up', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  const calls = mock(w, () => reply(AFTER));
  a.aiAddKey(KEY, 'k1', true);
  w.localStorage.setItem(a.LS_AI_OPTS, JSON.stringify({ useImage: false }));
  const pg = a.state.pages[0];
  a.aiAutoAfterPaste(pg); a.aiAutoAfterPaste(pg);                                    // double trigger → one run
  for (let i = 0; i < 60 && pg.text === BEFORE; i++) await tick(50);
  await tick(100);
  const n = calls.filter(isGen).length; assert.ok(n >= 1 && n <= 2, 'one fix (plus at most one audit call)');
  pg.text = AFTER + ' edited by hand';                                                 // person edits, presses Save
  a.aiAutoAfterPaste(pg, false); await tick(150);
  assert.equal(calls.filter(isGen).length, n, 'Save on a certified page does not call the AI');
  assert.equal(pg.text, AFTER + ' edited by hand');
  pg.text = BEFORE;                                                                  // fresh OCR text arrives
  a.aiAutoAfterPaste(pg);
  for (let i = 0; i < 60 && pg.text === BEFORE; i++) await tick(50);
  assert.equal(pg.text, AFTER, 'fresh text is fixed again');
});

test('visible progress: while the AI works on the page you are on, a solid banner shows and the thumbnail carries a labelled veil; both clear afterwards', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  mock(w, () => ({ ...reply(AFTER), delay: 1800 }));
  a.aiAddKey(KEY, 'k1', true);
  w.localStorage.setItem(a.LS_AI_OPTS, JSON.stringify({ auto: true, autoV2: true, useImage: false }));
  a.renderAll(); a.aiAutoAfterPaste(a.state.pages[0]);
  for (let i = 0; i < 20 && w.document.getElementById('aiPageBanner').classList.contains('hidden'); i++) await tick(100);
  const bn = w.document.getElementById('aiPageBanner');
  assert.ok(bn && !bn.classList.contains('hidden') && /AI/.test(bn.textContent) && /Key A/.test(bn.textContent), 'banner on the current page');
  const th = w.document.querySelector('.page-thumb[data-i="0"]');
  assert.ok(th.classList.contains('ai-busy') && th.getAttribute('data-ai') === 'A', 'thumbnail veil + key letter');
  for (let i = 0; i < 60 && a.state.pages[0].text === BEFORE; i++) await tick(50);
  await tick(900);
  assert.ok(w.document.getElementById('aiPageBanner').classList.contains('hidden'), 'banner cleared');
  assert.ok(!w.document.querySelector('.page-thumb.ai-busy'), 'veil cleared');
});

test('auto mode works in PARALLEL: 4 keys x 3 = up to 12 pages at once, spread over all keys; extra pages wait in the queue', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, Array.from({ length: 14 }, () => BEFORE));
  const keys = ['AIza' + 'a'.repeat(35), 'AIza' + 'b'.repeat(35), 'AIza' + 'c'.repeat(35), 'AIza' + 'd'.repeat(35)];
  const calls = mock(w, () => ({ ...reply(AFTER), delay: 700 }));
  keys.forEach((k, i) => a.aiAddKey(k, 'k' + i, true));
  w.localStorage.setItem(a.LS_AI_OPTS, JSON.stringify({ auto: true, autoV2: true, useImage: false, context: false, verify: false }));
  a.state.pages.forEach(pg => a.aiAutoAfterPaste(pg));                         // 14 pages arrive at once
  for (let i = 0; i < 120 && a.state.pages.some(pg => pg.text === BEFORE); i++) await tick(100);
  assert.ok(a.state.pages.every(pg => pg.text === AFTER), 'every page fixed');
  assert.ok(calls.maxLive() >= 10, 'many pages at the same time, got ' + calls.maxLive());
  assert.ok(calls.maxLive() <= 12, 'never more than keys x per-key, got ' + calls.maxLive());
  const used = keys.map(k => calls.filter(c => isGen(c) && (String(c.url) + JSON.stringify(c.init && c.init.headers || {})).includes(k)).length);
  assert.ok(used.every(n => n >= 2), 'all four keys did work: ' + used);
});

test('auto mode: single pages arriving one by one are spread round-robin over the keys, and "at once = 1" is respected', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, Array.from({ length: 8 }, () => BEFORE));
  const keys = ['AIza' + 'a'.repeat(35), 'AIza' + 'b'.repeat(35)];
  const calls = mock(w, () => ({ ...reply(AFTER), delay: 300 }));
  keys.forEach((k, i) => a.aiAddKey(k, 'k' + i, true));
  w.localStorage.setItem(a.LS_AI_OPTS, JSON.stringify({ auto: true, autoV2: true, useImage: false, context: false, verify: false, par: 1 }));
  a.state.pages.forEach(pg => a.aiAutoAfterPaste(pg));
  for (let i = 0; i < 120 && a.state.pages.some(pg => pg.text === BEFORE); i++) await tick(100);
  assert.ok(calls.maxLive() <= 2, '2 keys x 1 = at most 2 at once, got ' + calls.maxLive());
  const used = keys.map(k => calls.filter(c => isGen(c) && (String(c.url) + JSON.stringify(c.init && c.init.headers || {})).includes(k)).length);
  assert.ok(used[0] >= 2 && used[1] >= 2, 'both keys used: ' + used);
});

test('wiring: menu button, CSP (all providers) and service-worker cache are updated', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="aiFixBtn"/);
  const csp = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
  for (const h of ['generativelanguage.googleapis.com', 'api.groq.com', 'openrouter.ai', 'api.mistral.ai', 'api.cerebras.ai']) assert.match(csp, new RegExp('connect-src[^"]*https://' + h.replace(/\./g, '\\.')), h);
  assert.match(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /textriva-v35/);
});

test('prompt carries the book-cleaning rules: markers, Sol→সমাধান, watermarks, no guessing, real examples, backslashes intact', async () => {
  const w = await bootApp(); const { aiSystemPrompt } = w.__app;
  const l = aiSystemPrompt({ math: 'latex' }, false), u = aiSystemPrompt({ math: 'unicode' }, true);
  for (const p of [l, u]) {
    for (const t of ['[চিত্র লাগবে]', '[OCR-এ হারিয়ে গেছে]', '[সম্পাদকীয় নোট', 'সমাধান:', 'students.bd', 'NEVER guess a missing value', 'Rightarrow', '8.67']) assert.ok(p.includes(t), t);
  }
  assert.ok(l.includes('\\dfrac{ma}{F}') && l.includes('\\text{m s}^{-2}') && !l.includes('\text{'), 'LaTeX backslashes must not turn into tab/newline');
  assert.ok(u.includes('m s⁻²') && !u.includes('\\dfrac'));
  assert.ok(!w.__app.aiReviewPrompt({ math: 'latex' }, true).includes('\text{'));
});

test('LaTeX is the default math style; LaTeX output may be longer (up to 190%) than the OCR; context + verify default on', async () => {
  const w = await bootApp(); const a = w.__app;
  assert.equal(a.aiOpts().math, 'latex'); assert.equal(a.aiOpts().context, true); assert.equal(a.aiOpts().verify, true);
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
  assert.ok(!/^⚠️|^❌/.test(w.document.getElementById('ttSum').textContent));
});

test('adding a Groq key through the UI: provider detected, models listed, saved with its provider; unreachable provider → clear hint', async () => {
  const w = await bootApp(); const a = w.__app; addPages(w, [BEFORE]);
  mock(w, () => reply(AFTER));
  a.openTextTools('ai'); await tick(20);
  w.document.getElementById('aiKeyIn').value = GROQ;
  await a.aiTtAction('ai-savekey');
  const rec = a.aiKeyList()[0];
  assert.equal(rec.provider, 'groq'); assert.match(w.document.getElementById('ttSum').textContent, /Groq/); assert.match(w.document.getElementById('ttSum').textContent, /llama-4-scout/);
  const w2 = await bootApp(); const a2 = w2.__app; addPages(w2, [BEFORE]);
  w2.fetch = async () => { throw new TypeError('Failed to fetch'); };
  a2.openTextTools('ai'); await tick(20);
  w2.document.getElementById('aiKeyIn').value = GROQ;
  await a2.aiTtAction('ai-savekey');
  assert.equal(a2.aiKeyList().length, 0); assert.match(w2.document.getElementById('ttSum').textContent, /Groq.*(browser|ধরা)/);
  w2.document.getElementById('aiKeyIn').value = 'not-a-key';
  await a2.aiTtAction('ai-savekey');
  assert.match(w2.document.getElementById('ttSum').textContent, /key-এর মতো|does not look like a key/);
});
