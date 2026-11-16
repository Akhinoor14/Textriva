// AI key usage stats + encrypted Drive key backup. Network and Drive are fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { bootApp } from './_app.mjs';
import { installFakeDrive } from './_fakedrive.mjs';

const KEY = 'AIza' + 'x'.repeat(35), GROQ = 'gsk_' + 'g'.repeat(30);
const MODELS = { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] };
const withCrypto = w => { for (const [k, v] of [['crypto', globalThis.crypto], ['TextEncoder', TextEncoder], ['TextDecoder', TextDecoder]]) Object.defineProperty(w, k, { value: v, configurable: true, writable: true }); return w; };
const mk = () => ({ system: 's', text: 'hello world hello world' });

test('usage: success adds requests + tokens to today, failures count too, 14-day cap, summary + row html', async () => {
  const w = withCrypto(await bootApp()); const a = w.__app;
  const k = a.aiAddKey(KEY, 'Gmail A', true, 'gemini');
  w.fetch = async url => /\/models\?/.test(url)
    ? { ok: true, status: 200, headers: { get: () => null }, json: async () => MODELS }
    : { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [{ text: 'hello world hello world' }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 1234 } }) };
  await a.aiGenerateAnyKey(mk, false, k.id);
  await a.aiGenerateAnyKey(mk, false, k.id);
  const t = a.aiUsageToday(k.id);
  assert.equal(t.calls, 2); assert.equal(t.ok, 2); assert.equal(t.tok, 2468);
  a.aiUsageNote(k.id, { ok: false, code: 'rate' });
  assert.equal(a.aiUsageToday(k.id).rate, 1); assert.equal(a.aiUsageToday(k.id).calls, 3);
  assert.match(a.aiUsageSumHtml(), /2<\/b>\/3 request/);
  const html = a.aiKeyRowHtml(a.aiKeyList()[0], 0);
  assert.match(html, /class="ai-use"/); assert.match(html, /2k<\/b> token/);
  // history older than 14 days is dropped
  const all = a.aiUsageAll(); for (let i = 1; i <= 20; i++) all[k.id].days['2020-01-' + String(i).padStart(2, '0')] = { calls: 1, ok: 1, rate: 0, tok: 1 };
  w.localStorage.setItem('textriva-ai-usage', JSON.stringify(all));
  a.aiUsageNote(k.id, { ok: true, tok: 1 });
  assert.ok(Object.keys(a.aiUsageAll()[k.id].days).length <= 14);
});

test('usage: a bad key is flagged, removing or clearing a key forgets its usage', async () => {
  const w = withCrypto(await bootApp()); const a = w.__app;
  const k = a.aiAddKey(GROQ, 'G', true, 'groq');
  a.aiUsageNote(k.id, { ok: false, code: 'key' });
  assert.match(a.aiKeyRowHtml(a.aiKeyList()[0], 0), /Key ঠিক নেই|Key invalid/);
  assert.match(a.aiKeyRowHtml(a.aiKeyList()[0], 0), /class="ai-bar"/);   // Groq has an approximate daily cap bar
  a.aiRemoveKey(k.id);
  assert.equal(a.aiUsageAll()[k.id], undefined);
});

test('encrypt/decrypt: round trip, wrong passphrase rejected, ciphertext hides the key', async () => {
  const w = withCrypto(await bootApp()); const a = w.__app;
  const list = [{ id: 'k1', name: 'A', key: KEY, provider: 'gemini' }, { id: 'k2', name: 'B', key: GROQ, provider: 'groq' }];
  const env = await a.aiEncryptKeys(list, 'correct horse battery');
  assert.equal(env.n, 2); assert.ok(!JSON.stringify(env).includes(KEY) && !JSON.stringify(env).includes('gsk_'));
  assert.equal(JSON.stringify(await a.aiDecryptKeys(env, 'correct horse battery')), JSON.stringify(list));
  await assert.rejects(() => a.aiDecryptKeys(env, 'wrong passphrase!'), /Passphrase/);
  await assert.rejects(() => a.aiDecryptKeys({ v: 9 }, 'x'), /backup/);
});

test('Drive backup: save, then restore on a fresh device merges without duplicates', async () => {
  const w = withCrypto(await bootApp({ drive: true })); const a = w.__app; installFakeDrive(w);
  a.gdrive.token = 't'; a.gdrive.exp = Date.now() + 3e6;
  a.aiAddKey(KEY, 'A', true, 'gemini'); a.aiAddKey(GROQ, 'B', true, 'groq');
  assert.equal(await a.aiKeysToDrive('my passphrase'), 2);
  assert.equal(await a.aiKeysToDrive('my passphrase'), 2);                       // second save overwrites the same file
  w.localStorage.clear(); a.aiRemoveKey && a.aiKeyList().forEach(k => a.aiRemoveKey(k.id));
  assert.equal(a.aiKeyList().length, 0);
  await assert.rejects(() => a.aiKeysFromDrive('nope nope nope'), /Passphrase/);
  assert.equal(JSON.stringify(await a.aiKeysFromDrive('my passphrase')), JSON.stringify({ added: 2, total: 2 }));
  assert.equal(a.aiKeyList().map(k => k.provider).sort().join(), 'gemini,groq');
  assert.equal(JSON.stringify(await a.aiKeysFromDrive('my passphrase')), JSON.stringify({ added: 0, total: 2 }));   // nothing duplicated
});
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> ac623b98f00479a83be99addbaba6c4b29681fb2

test('pause: a paused key is never used, stays in the list, can be switched on again; "at once" limits the workers', async () => {
  const w = withCrypto(await bootApp()); const a = w.__app;
  const k1 = a.aiAddKey(KEY, 'A', true, 'gemini'), k2 = a.aiAddKey('AIza' + 'y'.repeat(35), 'B', true, 'gemini');
  const used = [];
  w.fetch = async (url, init) => {
    if (/\/models\?/.test(url)) return { ok: true, status: 200, headers: { get: () => null }, json: async () => MODELS };
    used.push(String(url));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [{ text: 'hello world hello world' }] }, finishReason: 'STOP' }] }) };
  };
  a.aiSetKeyOff(k1.id, true);
  assert.equal(a.aiActiveKeys().length, 1); assert.equal(a.aiKeyList().length, 2);
  assert.match(a.aiKeyRowHtml(a.aiKeyList()[0], 0), /is-off/);
  await a.aiGenerateAnyKey(mk, false, k1.id);                       // even when asked for the paused key's worker …
  assert.equal(a.aiUsageToday(k1.id).calls, 0, '… the paused key is not called');
  assert.equal(a.aiUsageToday(k2.id).calls, 1);
  a.aiSetKeyOff(k1.id, false); assert.equal(a.aiActiveKeys().length, 2);
  a.aiSetKeyOff(k1.id, true); a.aiSetKeyOff(k2.id, true);
  await assert.rejects(() => a.aiGenerateAnyKey(mk, false), e => e.code === 'key');
  assert.equal(a.aiPar({ par: 2 }), 2); assert.equal(a.aiPar({ par: 9 }), 3); assert.equal(a.aiPar({}), 3);
});
<<<<<<< HEAD
=======
=======
>>>>>>> fe3f85c1d6a5546699d04c7806e629ada4ae3510
>>>>>>> ac623b98f00479a83be99addbaba6c4b29681fb2
