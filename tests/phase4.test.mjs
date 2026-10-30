// Phase 4 tests: cleanup pipeline + diff, Bangla fix rules, Find & Replace, search index,
// DB schema v2 (real upgrade with fake-indexeddb), and wiring checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { getModuleSource, extractDeclaration } from './_extract.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = getModuleSource();

const names = [
  'CLEAN_JOIN_RATIO', 'CLEAN_HEADER_RATIO', 'CLEAN_HEADER_MIN_PAGES', 'CLEAN_EDGE_LINES', 'DIFF_MAX_CELLS', 'CLEAN_DEFAULTS',
  'normNl', 'esc', 'PAGE_NUM_RE', 'isPageNumberLine', 'headerKey', 'edgeLineIdx', 'detectRepeatedLines', 'joinWrappedLines',
  'cleanPageText', 'planCleanup', 'diffTokens', 'diffToHtml',
  'BN_DEFAULT_RULES', 'BN_DIGITS', 'escapeRegex', 'unescapeRepl', 'compileRule', 'applyRules', 'convertDigits', 'planBangla',
  'buildFindRegex', 'matchSnippets', 'planReplace',
  'normSearch', 'tokenizeForSearch', 'buildSearchIndex', 'searchIndexQuery', 'makeSnippet',
  'DB_VERSION', 'upgradeSchema', 'parseProjectJson', 'buildProjectJson', 'xmlEscape',
];
const decls = names.map(n => extractDeclaration(source, n)).join('\n');
const api = new Function(`${decls}\nreturn { ${names.join(', ')} };`)();
const {
  isPageNumberLine, headerKey, detectRepeatedLines, joinWrappedLines, cleanPageText, planCleanup, diffTokens, diffToHtml,
  BN_DEFAULT_RULES, applyRules, convertDigits, planBangla, buildFindRegex, matchSnippets, planReplace,
  normSearch, tokenizeForSearch, buildSearchIndex, searchIndexQuery, makeSnippet, DB_VERSION, upgradeSchema, parseProjectJson, buildProjectJson,
} = api;

// ── cleanup ──
test('page-number lines are recognised in English and Bangla, body numbers are not', () => {
  for (const l of ['12', ' - 7 - ', 'Page 3', 'p. 45', '১২', 'পৃষ্ঠা ৫', '— ২৩ —']) assert.ok(isPageNumberLine(l), l);
  for (const l of ['12 apples', 'Chapter 3', 'আমি ১২ জন', '', '12345']) assert.ok(!isPageNumberLine(l), l);
});
test('headerKey ignores digits and case', () => {
  assert.equal(headerKey('  Textriva Handbook  – 12 '), headerKey('textriva handbook – 99'));
});
test('repeated header/footer lines are detected only above 40 % of pages (and ≥3 pages)', () => {
  const W = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
  const mk = (i, withHeader) => (withHeader ? 'Physics Book\n' : '') + `${W[i]} first line\n${W[i]} second line\n${W[i]} third line\n${W[i]} fourth line\n${W[i]} fifth line`;
  const many = Array.from({ length: 10 }, (_, i) => mk(i, i < 5));      // 5/10 = 50 % → header
  assert.deepEqual(detectRepeatedLines(many).samples, ['Physics Book']);
  const few = Array.from({ length: 10 }, (_, i) => mk(i, i < 4));       // 4/10 = 40 % → NOT more than 40 %
  assert.equal(detectRepeatedLines(few).keys.size, 0);
  const two = Array.from({ length: 3 }, (_, i) => mk(i, i < 2));        // only 2 pages
  assert.equal(detectRepeatedLines(two).keys.size, 0);
});
test('cleanup removes repeated headers, footers and page numbers but keeps body text', () => {
  const BNW = ['প্রথম', 'দ্বিতীয়', 'তৃতীয়', 'চতুর্থ', 'পঞ্চম', 'ষষ্ঠ'];
  const pages = Array.from({ length: 6 }, (_, i) => `কুয়েট পদার্থবিজ্ঞান\n${BNW[i]} অধ্যায়ের মূল লেখা। দ্বিতীয় বাক্য এখানে আছে।\n${i + 10}`);
  const plan = planCleanup(pages, { joinLines: false });
  assert.equal(plan.changes.length, 6);
  assert.equal(plan.changes[0].after, 'প্রথম অধ্যায়ের মূল লেখা। দ্বিতীয় বাক্য এখানে আছে।');
  assert.deepEqual(plan.headers, ['কুয়েট পদার্থবিজ্ঞান']);
});
test('a page that is only a header is never emptied', () => {
  const keys = new Set([headerKey('Book Title')]);
  assert.equal(cleanPageText('Book Title', {}, keys), 'Book Title');
});
test('wrapped lines are joined; headings, sentence ends and list items are kept', () => {
  const t = 'This is a long paragraph line that wraps in the\nmiddle of a sentence and goes on for a while until it\nends here.\nHeading\n1. First item is a little bit longer than a heading\n2. Second item';
  const r = joinWrappedLines(t);
  assert.equal(r, 'This is a long paragraph line that wraps in the middle of a sentence and goes on for a while until it ends here.\nHeading\n1. First item is a little bit longer than a heading\n2. Second item');
});
test('Bangla paragraphs: wrap joined, sentence end (।) respected', () => {
  const t = 'বাংলাদেশ দক্ষিণ এশিয়ার একটি দেশ এবং এর রাজধানী ঢাকা\nশহরেই অবস্থিত। এই দেশের জনসংখ্যা অনেক বেশি এবং ঘনবসতিপূর্ণ।\nনতুন অনুচ্ছেদ শুরু হলো এখানে এবং আরও কিছু শব্দ আছে।';
  const r = joinWrappedLines(t).split('\n');
  assert.equal(r.length, 2);
  assert.ok(r[0].includes('ঢাকা শহরেই'));
});
test('de-hyphenation joins split English words only when the next part is lower-case', () => {
  assert.equal(cleanPageText('The informa-\ntion is here', { joinLines: false }), 'The information is here');
  assert.equal(cleanPageText('Anglo-\nSaxon people', { joinLines: false }), 'Anglo-\nSaxon people');
});
test('spaces and quotes are normalised; Bangla letters are untouched', () => {
  const r = cleanPageText('আমি   ভাত\tখাই  \n  “quote”  ‘x’', { joinLines: false, quotes: true });
  assert.equal(r, 'আমি ভাত খাই\n"quote" \'x\'');
});
test('cleanup never changes pages that are already clean (CRLF alone is not a change)', () => {
  const plan = planCleanup(['ঠিক আছে।\r\nআরেকটি লাইন।', 'Clean text.'], { headers: false });
  assert.equal(plan.changes.length, 0);
});

// ── diff ──
test('diffTokens: identical → one eq; edits are marked del/add and reconstruct both sides', () => {
  assert.deepEqual(diffTokens('a b c', 'a b c'), [{ t: 'eq', s: 'a b c' }]);
  const a = 'আমি ভাত খাই আজ', b = 'আমি রুটি খাই';
  const d = diffTokens(a, b);
  assert.equal(d.filter(x => x.t !== 'add').map(x => x.s).join(''), a);
  assert.equal(d.filter(x => x.t !== 'del').map(x => x.s).join(''), b);
  assert.ok(d.some(x => x.t === 'del' && x.s.includes('ভাত')) && d.some(x => x.t === 'add' && x.s.includes('রুটি')));
});
test('diffTokens handles empty sides', () => {
  assert.deepEqual(diffTokens('', 'x'), [{ t: 'add', s: 'x' }]);
  assert.deepEqual(diffTokens('x', ''), [{ t: 'del', s: 'x' }]);
});
test('diffToHtml escapes markup, marks whitespace changes and shortens long unchanged runs', () => {
  const h = diffToHtml(diffTokens('a <b>  c', 'a <i> c'));
  assert.ok(!h.includes('<b>') && h.includes('&lt;b&gt;'));
  assert.match(diffToHtml(diffTokens('x  y', 'x y')), /<del class="df-del">··<\/del>/);
  const long = 'word '.repeat(100);
  assert.ok(diffToHtml(diffTokens(long + 'A', long + 'B')).includes(' … '));
});

// ── Bangla fixes ──
test('default Bangla rules: | → ।, space before ।, zero-width junk, recomposition', () => {
  const run = s => applyRules(s, BN_DEFAULT_RULES).text;
  assert.equal(run('আমি ভাত খাই |'), 'আমি ভাত খাই।');
  assert.equal(run('আমি ভাত খাই ।'), 'আমি ভাত খাই।');
  assert.equal(run('ক​খ﻿গ'), 'কখগ');
  assert.equal(run('কোো'.replace('কো', 'ক')), 'কো');            // ে + া → ো
  assert.equal(run('কৌ'), 'কৌ');                                  // ে + ৗ → ৌ
  assert.equal(run('য় ড় ঢ়'), 'য় ড় ঢ়'); // য় ড় ঢ়
});
test('legit ZWJ/ZWNJ between Bangla letters is kept; stray ones next to Latin/space are removed', () => {
  const keep = 'র‍্য';                 // র‍্য
  assert.equal(applyRules(keep, BN_DEFAULT_RULES).text, keep);
  assert.equal(applyRules('abc‍কখ', BN_DEFAULT_RULES).text, 'abcকখ');
  assert.equal(applyRules('কখ‌ abc', BN_DEFAULT_RULES).text, 'কখ abc');
  assert.equal(applyRules('‍কখ', BN_DEFAULT_RULES).text, 'কখ');
});
test('rules: disabled rules are skipped, invalid regexes are reported not thrown, plain rules treat $ literally', () => {
  const r = applyRules('a.b', [{ id: 'x', find: '.', replace: '$&$', regex: false, enabled: true }, { id: 'off', find: 'a', replace: 'Z', enabled: false }, { id: 'bad', name: 'broken', find: '(', replace: '', regex: true, enabled: true }]);
  assert.equal(r.text, 'a$&$b');
  assert.deepEqual(r.bad, ['broken']);
});
test('digit conversion both ways leaves Latin-attached digits alone', () => {
  assert.equal(convertDigits('১২৩ ৪৫', 'bn2en'), '123 45');
  assert.equal(convertDigits('সাল 2024, MP3, A4, 3rd', 'en2bn'), 'সাল ২০২৪, MP3, A4, 3rd');
  assert.equal(convertDigits('১২ 34', 'none'), '১২ 34');
});
test('planBangla returns only pages that change', () => {
  const p = planBangla(['ঠিক আছে।', 'ভুল |', ''], BN_DEFAULT_RULES, 'none');
  assert.equal(p.changes.length, 1);
  assert.equal(p.changes[0].i, 1);
});

// ── Find & Replace ──
test('plain find escapes regex characters; case-insensitive by default', () => {
  const re = buildFindRegex('a.b', {});
  assert.equal('xA.B a-b'.match(re).length, 1);
  assert.equal(buildFindRegex('a.b', { caseSensitive: true }).test('A.B'), false);
});
test('whole word works for Bangla (Unicode-aware, \\b would not)', () => {
  const re = buildFindRegex('বই', { wholeWord: true });
  assert.equal('বই বইটি বইয়ের বই।'.match(re).length, 2);
});
test('regex mode: invalid pattern throws, $1 and \\n work in the replacement', () => {
  assert.throws(() => buildFindRegex('(', { regex: true }));
  const r = planReplace(['2024-05-01'], '(\\d+)-(\\d+)-(\\d+)', '$3/$2/$1\\nx', { regex: true });
  assert.equal(r.changes[0].after, '01/05/2024\nx');
});
test('replace-all counts per page and in total; plain replacement keeps $ literal', () => {
  const r = planReplace(['cat cat', 'dog', 'cat'], 'cat', 'co$&w', {});
  assert.equal(r.total, 3);
  assert.deepEqual(r.changes.map(c => [c.i, c.n]), [[0, 2], [2, 1]]);
  assert.equal(r.changes[0].after, 'co$&w co$&w');
});
test('matchSnippets returns context around matches and a capped list', () => {
  const m = matchSnippets('one two three two', buildFindRegex('two', {}), 1, 4);
  assert.equal(m.count, 2);
  assert.deepEqual(m.snippets, [{ before: 'one ', match: 'two', after: ' thr' }]);
});
test('undo of replace-all: restoring the stored "before" texts gives the originals back', () => {
  const texts = ['আমি ভাত খাই', 'ভাত ভাত'];
  const r = planReplace(texts, 'ভাত', 'রুটি', {});
  const restored = texts.slice();
  r.changes.forEach(c => { restored[c.i] = c.after; });
  assert.deepEqual(restored, ['আমি রুটি খাই', 'রুটি রুটি']);
  r.changes.forEach(c => { restored[c.i] = c.before; });
  assert.deepEqual(restored, texts);
});

// ── search index ──
test('tokenizer: Bangla words keep their vowel signs, danda/punctuation split, zero-width joiners ignored', () => {
  assert.deepEqual(tokenizeForSearch('আমি ভাত খাই। ভাত!').sort(), ['আমি', 'খাই', 'ভাত'].sort());
  assert.deepEqual(tokenizeForSearch('র‍্য'), tokenizeForSearch('র্য'));
});
test('search is encoding-insensitive: decomposed and precomposed য় / ো match', () => {
  assert.deepEqual(tokenizeForSearch('য়'), tokenizeForSearch('য়'));
  assert.deepEqual(tokenizeForSearch('কো'), tokenizeForSearch('কো'));
});
test('inverted index: prefix match, AND across tokens, page numbers 1-based', () => {
  const idx = buildSearchIndex([tokenizeForSearch('Physics of waves'), tokenizeForSearch('waves and sound'), tokenizeForSearch('ভেক্টর রাশি পদার্থবিজ্ঞান')]);
  assert.deepEqual(searchIndexQuery(idx, ['wav']), [1, 2]);
  assert.deepEqual(searchIndexQuery(idx, ['waves', 'sound']), [2]);
  assert.deepEqual(searchIndexQuery(idx, ['ভেক্টর']), [3]);
  assert.deepEqual(searchIndexQuery(idx, ['nothing']), []);
});
test('index tolerates words like "constructor" / "toString" (no prototype collisions)', () => {
  const idx = buildSearchIndex([tokenizeForSearch('constructor toString hasOwnProperty')]);
  assert.deepEqual(searchIndexQuery(idx, ['constructor']), [1]);
  assert.deepEqual(searchIndexQuery(idx, ['tostring']), [1]);
});
test('snippet highlights the first match with context', () => {
  const s = makeSnippet('The quick brown fox jumps over the lazy dog', ['fox'], 8);
  assert.equal(s.match, 'fox');
  assert.ok(s.before.endsWith('brown ') && s.after.startsWith(' jumps'));
});
test('normSearch never changes stored text rules: lower-case + NFC + zero-width removal only', () => {
  assert.equal(normSearch('AbC​'), 'abc');
});

// ── DB schema v2 (real upgrade path) ──
const idbReq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function open(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = e => upgrade(req.result, e.oldVersion);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
test('fresh install creates all five stores at version 2', async () => {
  assert.equal(DB_VERSION, 2);
  const db = await open('p4-fresh', DB_VERSION, upgradeSchema);
  assert.deepEqual([...db.objectStoreNames].sort(), ['blobs', 'pages', 'projects', 'search', 'settings']);
  assert.ok(db.transaction('pages').objectStore('pages').indexNames.contains('byProject'));
  db.close();
});
test('upgrading a v1 database keeps existing projects/pages and adds search + settings', async () => {
  const v1 = await open('p4-up', 1, (db, old) => upgradeSchema(db, old === 0 ? 0 : old) || null);
  // upgradeSchema(…, 0) would create v2 stores too; emulate a genuine v1 file instead:
  v1.close(); indexedDB.deleteDatabase('p4-up');
  const old = await new Promise((res, rej) => {
    const rq = indexedDB.open('p4-up', 1);
    rq.onupgradeneeded = () => { const db = rq.result; db.createObjectStore('projects', { keyPath: 'id' }); db.createObjectStore('pages', { keyPath: 'id' }).createIndex('byProject', 'projectId'); db.createObjectStore('blobs', { keyPath: 'id' }); };
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
  await idbReq(old.transaction('pages', 'readwrite').objectStore('pages').put({ id: 'a', projectId: 'p', order: 0, text: 'বাংলা লেখা' }));
  old.close();
  const db = await open('p4-up', DB_VERSION, upgradeSchema);
  assert.deepEqual([...db.objectStoreNames].sort(), ['blobs', 'pages', 'projects', 'search', 'settings']);
  assert.equal((await idbReq(db.transaction('pages').objectStore('pages').get('a'))).text, 'বাংলা লেখা');
  const w = buildSearchIndex([tokenizeForSearch('বাংলা লেখা')]);
  await idbReq(db.transaction('search', 'readwrite').objectStore('search').put({ id: 'p', words: w }));
  assert.deepEqual(searchIndexQuery((await idbReq(db.transaction('search').objectStore('search').get('p'))).words, ['বাংলা']), [1]);
  db.close();
});

// ── notes / bookmarks persistence ──
test('project JSON round-trips note and bookmark; old files without them still parse', () => {
  const j = buildProjectJson({ name: 'N' }, [{ name: 'p1', text: 'x', note: 'নোট', bookmark: true }, { name: 'p2', text: 'y' }]);
  const p = parseProjectJson(j);
  assert.equal(p.pages[0].note, 'নোট'); assert.equal(p.pages[0].bookmark, true);
  assert.equal(p.pages[1].note, ''); assert.equal(p.pages[1].bookmark, false);
});

// ── wiring ──
test('every place that persists pages carries note + bookmark', () => {
  const saveIdx = source.indexOf('function saveNow');
  assert.match(source.slice(saveIdx, saveIdx + 2800), /note: p\.note \|\| '', bookmark: !!p\.bookmark/);
  assert.match(source, /note: typeof o\.note === 'string' \? o\.note : '', bookmark: !!o\.bookmark/);        // pushRestoredPage
  assert.match(source, /reviewed: !!p\.reviewed, note: p\.note \|\| '', bookmark: !!p\.bookmark \}\)\),\n    \};/); // Drive meta
  assert.match(source, /note: m\.note, bookmark: m\.bookmark/);                                                // Drive open
  assert.match(source, /note: r\.note \|\| '', bookmark: !!r\.bookmark/);                                       // backup export
  assert.match(source, /syncSig = [^\n]*p\.bookmark[^\n]*hashStr\(p\.note/);                                    // sync signature
});
test('search index is written in saveNow and removed with the project', () => {
  assert.match(source, /transaction\(\['projects', 'pages', 'blobs', 'search'\], 'readwrite'\)/);
  assert.match(source, /tx\.objectStore\('search'\)\.delete\(pid\)/);
  assert.match(source, /await indexProject\(pid\)/); // imports
});
test('apply never touches a page edited since the preview (before-text is verified)', () => {
  const i = source.indexOf('function applyTextChanges');
  assert.match(source.slice(i, i + 600), /\(pg\.text \|\| ''\) !== c\.before/);
});
test('global shortcuts are suspended while a dialog is open; G and B shortcuts exist', () => {
  assert.match(source, /querySelector\('#ttDlg, #bmDlg, #exportDlg, #dupCompare(, #ptDlg)?'\)\) return;/);
  assert.match(source, /e\.key === 'g' \|\| e\.key === 'G'/);
  assert.match(source, /e\.key === 'b' \|\| e\.key === 'B'/);
});
test('UI elements exist and are bilingual-safe (no raw strings without L())', () => {
  for (const id of ['textToolsBtn', 'gotoPage', 'bookmarkBtn', 'noteBtn', 'noteArea', 'bmListBtn']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(source, /openTextTools/);
  assert.match(source, /open-hit/);
});
