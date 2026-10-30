// Phase 2 tests: undo/redo history, page validation flags, script detection, wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getModuleSource, extractDeclaration } from './_extract.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const source = getModuleSource();
const names = ['UNDO_LIMIT', 'MIN_TEXT_CHARS', 'GARBAGE_RATIO', 'MAX_CHAR_RUN', 'SCRIPT_MIN_LETTERS', 'SCRIPT_MIN_PAGES', 'RUN_RE',
  'newHist', 'histPush', 'histUndo', 'histRedo', 'detectScript', 'projectScriptOf', 'baseTextFlags'];
const decls = names.map(n => extractDeclaration(source, n)).join('\n');
const f = new Function(`${decls}\nreturn { UNDO_LIMIT, newHist, histPush, histUndo, histRedo, detectScript, projectScriptOf, baseTextFlags };`)();
const { UNDO_LIMIT, newHist, histPush, histUndo, histRedo, detectScript, projectScriptOf, baseTextFlags } = f;

const BN = 'বাংলাদেশ একটি দক্ষিণ এশীয় রাষ্ট্র। এর রাজধানী ঢাকা। জনসংখ্যা প্রায় আঠারো কোটি। প্রধান ভাষা বাংলা।';
const EN = 'The quick brown fox jumps over the lazy dog near the river bank today.';

// ── history ──
test('undo restores the exact previous text (incl. whitespace and Bangla)', () => {
  const h = newHist();
  const prev = '  আগের লেখা\n\nদুই লাইন  ';
  histPush(h, { text: prev });
  const snap = histUndo(h, { text: 'new' });
  assert.equal(snap.text, prev);
});
test('undo on an empty history returns null; empty-string snapshot is still a valid undo', () => {
  const h = newHist();
  assert.equal(histUndo(h, { text: 'x' }), null);
  histPush(h, { text: '' });
  assert.deepEqual(histUndo(h, { text: 'x' }), { text: '' });
});
test('history keeps at most 20 entries (oldest dropped)', () => {
  const h = newHist();
  for (let i = 0; i < 30; i++) histPush(h, { text: 't' + i });
  assert.equal(UNDO_LIMIT, 20);
  assert.equal(h.undo.length, 20);
  assert.equal(h.undo[0].text, 't10');
  assert.equal(h.undo.at(-1).text, 't29');
});
test('redo returns what undo replaced; a new change clears redo', () => {
  const h = newHist();
  histPush(h, { text: 'A' });
  assert.equal(histUndo(h, { text: 'B' }).text, 'A');
  assert.equal(histRedo(h, { text: 'A' }).text, 'B');
  histUndo(h, { text: 'B' });
  histPush(h, { text: 'C' });
  assert.equal(histRedo(h, { text: 'x' }), null);
});

// ── validation ──
test('flags: empty and whitespace-only', () => {
  assert.deepEqual(baseTextFlags(''), ['empty']);
  assert.deepEqual(baseTextFlags('   \n '), ['empty']);
});
test('flags: too short (< 20 chars), but normal Bangla/English pages are clean', () => {
  assert.ok(baseTextFlags('ঢাকা').includes('short'));
  assert.deepEqual(baseTextFlags(BN), []);
  assert.deepEqual(baseTextFlags(EN), []);
});
test('flags: garbled characters (� / □)', () => {
  assert.ok(baseTextFlags('এটি ঠিক আছে � � � কিন্তু এখানে ভাঙা অক্ষর আছে ঢাকা শহর').includes('garbage'));
  assert.ok(baseTextFlags('□□□□ some text that is long enough to pass the length check').includes('garbage'));
  assert.ok(!baseTextFlags(EN + ' �').includes('garbage')); // a single stray char is tolerated
});
test('flags: long runs of the same char, but dot/dash leaders are allowed', () => {
  assert.ok(baseTextFlags('This page has a problem: aaaaaaaaaaaa and then more text follows here').includes('repeat'));
  assert.ok(!baseTextFlags('Chapter 1 ............................ 5 and some more words here ok').includes('repeat'));
  assert.ok(!baseTextFlags('--------------------------------------------- end of the section text').includes('repeat'));
});

// ── script detection ──
test('detectScript: Bangla, English, mixed, too little text', () => {
  assert.equal(detectScript(BN), 'bn');
  assert.equal(detectScript(EN), 'en');
  assert.equal(detectScript(BN + ' ' + EN), 'mixed');
  assert.equal(detectScript('ঢাকা 123'), null);
});
test('projectScriptOf: needs >= 3 judged pages and a clear majority', () => {
  assert.equal(projectScriptOf(['bn', 'bn']), null);
  assert.equal(projectScriptOf(['bn', 'bn', 'bn', 'en']), 'bn');
  assert.equal(projectScriptOf(['en', 'en', 'en', 'bn']), 'en');
  assert.equal(projectScriptOf(['bn', 'bn', 'en', 'en']), null);
  assert.equal(projectScriptOf(['mixed', 'bn', 'bn']), null); // 'mixed' is ignored → only 2 judged
});

// ── wiring ──
test('Phase 2 is wired: undo recorded before workflow paste, Undo toast, flags persisted, Ctrl+Z handled', () => {
  const wf = source.slice(source.indexOf('function runWorkflowStep'), source.indexOf("$('flowBtn').onclick"));
  assert.ok(wf.indexOf('recordUndo(pg)') !== -1);
  assert.ok(wf.indexOf('recordUndo(pg)') < wf.indexOf('textArea.value = clipText'), 'undo snapshot must precede the paste');
  assert.match(wf, /UNDO_TOAST_MS, undoAction/);
  assert.match(source, /flags: p\.flags \|\| \[\], reviewed: !!p\.reviewed/);      // IndexedDB + Drive
  assert.match(source, /Array\.isArray\(o\.flags\)/);                                       // restore
  assert.match(source, /flags: m\.flags, reviewed: m\.reviewed/);                  // Drive reopen
  assert.match(source, /k === 'z' && !e\.shiftKey\) \{ e\.preventDefault\(\); undoLast\(\)/);
  assert.match(source, /state\.review && \(e\.key === 'ArrowLeft'/);
  assert.match(html, /id="reviewBtn"/);      // markup lives outside the module script
  assert.match(html, /id="reviewBar"/);
  assert.match(html, /id="undoPageBtn"/);
});
test('Ctrl+Z check runs before the plain Z (zoom) shortcut', () => {
  const kd = source.slice(source.indexOf("document.addEventListener('keydown'"));
  assert.ok(kd.indexOf('undoLast()') < kd.indexOf("e.key === 'z' || e.key === 'Z'"));
});
test('lastClip duplicate check and Phase 1 similarity guard are still intact', () => {
  assert.match(source, /clip === state\.lastClip/);
  assert.match(source, /findSimilarSavedPage\(clip, state\.current\)/);
});
