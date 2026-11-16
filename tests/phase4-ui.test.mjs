// Phase 4 UI tests: the real app loaded in jsdom + fake-indexeddb, driven through its own dialogs/buttons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, addPages, tick } from './_app.mjs';

const click = (w, sel) => { const el = w.document.querySelector(sel); assert.ok(el, 'missing ' + sel); el.click(); return el; };
const texts = w => Array.from(w.__app.state.pages, p => p.text);   // Array.from: jsdom arrays have a different realm/prototype

const BOOK = Array.from({ length: 6 }, (_, i) => `কুয়েট পদার্থবিজ্ঞান\n${['প্রথম', 'দ্বিতীয়', 'তৃতীয়', 'চতুর্থ', 'পঞ্চম', 'ষষ্ঠ'][i]} অধ্যায়ের লেখা এখানে ভাত খাই |\n${i + 10}`);

test('Cleanup tab: preview lists changed pages with a diff, Apply changes them, Undo restores exactly', async () => {
  const w = await bootApp();
  addPages(w, BOOK);
  w.__app.renderAll();
  w.__app.openTextTools('clean');
  await tick(10);
  click(w, '#ttDlg [data-tt="preview"]');
  assert.equal(w.document.querySelectorAll('#ttPrev .tt-item').length, 6);
  assert.ok(w.document.querySelector('#ttPrev .df-del'), 'diff shows removed text');
  assert.match(w.document.getElementById('ttSum').textContent, /6/);
  const before = texts(w);
  click(w, '#ttDlg [data-tt="apply"]');
  assert.ok(texts(w).every(t => !t.includes('কুয়েট পদার্থবিজ্ঞান') && !/\n\d+$/.test(t)));
  click(w, '#ttDlg [data-tt="undo"]');
  assert.deepEqual(texts(w), before);
});

test('nothing changes without Apply, and unchecked pages are left alone', async () => {
  const w = await bootApp();
  addPages(w, BOOK);
  w.__app.renderAll();
  const before = texts(w);
  w.__app.openTextTools('clean');
  await tick(10);
  click(w, '#ttDlg [data-tt="preview"]');
  assert.deepEqual(texts(w), before);
  w.document.querySelector('#ttPrev [data-pick="0"]').click();       // untick page 1
  click(w, '#ttDlg [data-tt="apply"]');
  assert.equal(texts(w)[0], before[0]);
  assert.notEqual(texts(w)[1], before[1]);
});

test('Find & Replace: live count, preview, apply to all pages, undo', async () => {
  const w = await bootApp();
  addPages(w, ['আমি ভাত খাই', 'ভাত ভাত রান্না', 'কিছু নেই', 'ভাত']);
  w.__app.renderAll();
  w.__app.openTextTools('fr');
  await tick(10);
  const find = w.document.getElementById('frFind'), repl = w.document.getElementById('frRepl');
  find.value = 'ভাত'; find.dispatchEvent(new w.Event('input', { bubbles: true }));
  repl.value = 'রুটি'; repl.dispatchEvent(new w.Event('input', { bubbles: true }));
  await tick(300);
  assert.match(w.document.getElementById('ttSum').textContent, /4/);   // 4 matches
  find.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(w.document.querySelectorAll('#ttPrev .tt-item').length, 3);
  click(w, '#ttDlg [data-tt="apply"]');
  assert.deepEqual(texts(w), ['আমি রুটি খাই', 'রুটি রুটি রান্না', 'কিছু নেই', 'রুটি']);
  click(w, '#ttDlg [data-tt="undo"]');
  assert.deepEqual(texts(w), ['আমি ভাত খাই', 'ভাত ভাত রান্না', 'কিছু নেই', 'ভাত']);
});

test('Find & Replace: an invalid regex shows a message and does not throw or change text', async () => {
  const w = await bootApp();
  addPages(w, ['abc']);
  w.__app.renderAll();
  w.__app.openTextTools('fr');
  await tick(10);
  w.document.querySelector('#ttOpts [data-o="regex"]').click();
  const find = w.document.getElementById('frFind');
  find.value = '('; find.dispatchEvent(new w.Event('input', { bubbles: true }));
  await tick(300);
  assert.match(w.document.getElementById('ttSum').textContent, /⚠️/);
  click(w, '#ttDlg [data-tt="preview"]');
  assert.deepEqual(texts(w), ['abc']);
});

test('changing an option after Preview discards the stale preview (Apply disabled)', async () => {
  const w = await bootApp();
  addPages(w, BOOK);
  w.__app.renderAll();
  w.__app.openTextTools('clean');
  await tick(10);
  click(w, '#ttDlg [data-tt="preview"]');
  assert.equal(w.document.querySelector('#ttDlg [data-tt="apply"]').disabled, false);
  w.document.querySelector('#ttOpts [data-o="quotes"]').click();
  assert.equal(w.document.querySelector('#ttDlg [data-tt="apply"]').disabled, true);
  assert.equal(w.document.querySelectorAll('#ttPrev .tt-item').length, 0);
});

test('Bangla tab: default rules fix "|" and digits convert; rules persist in IndexedDB', async () => {
  const w = await bootApp();
  addPages(w, ['আমি ভাত খাই |', 'সাল ২০২৪']);
  w.__app.renderAll();
  w.__app.openTextTools('bn');
  await tick(20);
  assert.ok(w.document.querySelectorAll('#bnRules .bn-rule').length >= 8);
  const dig = w.document.getElementById('ttDigits');
  dig.value = 'bn2en'; dig.dispatchEvent(new w.Event('change', { bubbles: true }));
  click(w, '#ttDlg [data-tt="preview"]');
  click(w, '#ttDlg [data-tt="apply"]');
  assert.deepEqual(texts(w), ['আমি ভাত খাই।', 'সাল 2024']);
  // user rule added → saved to the settings store
  click(w, '#ttDlg [data-tt="rule-add"]');
  const last = [...w.document.querySelectorAll('#bnRules .bn-rule')].pop();
  const f = last.querySelector('[data-f="find"]'); f.value = 'ক্ষ'; f.dispatchEvent(new w.Event('input', { bubbles: true }));
  await tick(600);
  const db = await new Promise((res, rej) => { const r = indexedDB.open('textriva-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const rec = await new Promise(res => { const q = db.transaction('settings').objectStore('settings').get('bnFix'); q.onsuccess = () => res(q.result); });
  assert.equal(rec.digits, 'bn2en');
  assert.equal(rec.rules.at(-1).find, 'ক্ষ');
});

test('Esc closes the dialog; page shortcuts (B, Space) do nothing while it is open', async () => {
  const w = await bootApp();
  addPages(w, BOOK);
  w.__app.renderAll();
  w.__app.openTextTools('clean');
  await tick(10);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
  assert.ok(!w.__app.state.pages[0].bookmark);
  w.document.getElementById('ttDlg').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(w.document.getElementById('ttDlg'), null);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
  assert.ok(w.__app.state.pages[0].bookmark);
});

test('notes + bookmarks survive save → close → reopen from the Library; go-to-page works', async () => {
  const w = await bootApp();
  addPages(w, ['one', 'two', 'three']);
  const pid = w.__app.state.projectId;
  w.__app.renderAll();
  assert.equal(w.__app.gotoPage(3), true);
  assert.equal(w.__app.state.current, 2);
  assert.equal(w.__app.gotoPage(9), false);
  click(w, '#bookmarkBtn');
  click(w, '#noteBtn');
  const na = w.document.getElementById('noteArea');
  na.value = 'পরে দেখতে হবে'; na.dispatchEvent(new w.Event('input', { bubbles: true }));
  await w.__app.saveNow();
  w.__app.resetWorkspaceState();
  assert.equal(w.__app.state.pages.length, 0);
  await w.__app.openLocalProject(pid);
  const p = w.__app.state.pages[2];
  assert.equal(p.bookmark, true);
  assert.equal(p.note, 'পরে দেখতে হবে');
  assert.ok(w.document.querySelector('#strip .pt-badge.bm'));
  click(w, '#bmListBtn');
  assert.equal(w.document.querySelectorAll('#bmDlg .bm-row').length, 1);
});

test('Library search finds a word in ANOTHER project and opens it at that page', async () => {
  const w = await bootApp();
  addPages(w, ['প্রথম পাতা', 'ভেক্টর রাশির যোগ', 'শেষ'], 'physics.pdf');
  const physics = w.__app.state.projectId;
  await w.__app.saveNow();
  w.__app.resetWorkspaceState();
  addPages(w, ['hello world', 'nothing here'], 'english.pdf');
  await w.__app.saveNow();
  w.__app.renderAll();
  // search while the English project is open
  const res = await w.__app.searchLibrary('ভেক্টর');
  assert.equal(res.length, 1);
  assert.equal(res[0].name, 'physics');
  assert.deepEqual(Array.from(res[0].hits, h => h.page), [2]);
  // UI: type into the Library search box
  w.__app.openLib('local');
  await tick(50);
  const box = w.document.getElementById('libSearch');
  assert.ok(box, 'search box present');
  box.value = 'ভেক্টর'; box.dispatchEvent(new w.Event('input', { bubbles: true }));
  await tick(500);
  const hit = w.document.querySelector('#libSearchRes .lib-hit');
  assert.ok(hit, 'a result is listed');
  assert.match(hit.textContent, /ভেক্টর/);
  hit.click();
  await tick(100);
  assert.equal(w.__app.state.projectId, physics);
  assert.equal(w.__app.state.current, 1);
});

test('search index follows edits and project deletion', async () => {
  const w = await bootApp();
  addPages(w, ['alpha beta']);
  await w.__app.saveNow();
  assert.equal((await w.__app.searchLibrary('gamma')).length, 0);
  w.__app.state.pages[0].text = 'alpha gamma';
  await w.__app.saveNow();
  assert.equal((await w.__app.searchLibrary('gamma')).length, 1);
  w.__app.state.pages.length = 0;
  await w.__app.saveNow();                                  // empty project → deleted with its index
  assert.equal((await w.__app.searchLibrary('gamma')).length, 0);
});
