// Phase 5 tests: markdown/json/docx builders+parsers, backup-zip round trip, wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { getModuleSource, extractDeclaration } from './_extract.mjs';

const source = getModuleSource();
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const names = ['BACKUP_FORMAT', 'DOCX_PAGE_BREAK', 'normNl', 'xmlEscape', 'xmlUnescape', 'buildMarkdown', 'buildProjectJson', 'parseProjectJson',
  'docxRuns', 'docxParagraph', 'buildDocxFiles', 'parseDocxPages', 'backupDirName', 'mimeForExt', 'imageExtFor', 'isImageName', 'naturalCompare',
  'buildBackupZip', 'readBackupZip'];
const decls = names.map(n => extractDeclaration(source, n)).join('\n');
const F = new Function(`${decls}\nreturn { ${names.join(', ')} };`)();

const BN1 = 'বাংলাদেশ একটি দক্ষিণ এশীয় রাষ্ট্র।\nএর রাজধানী ঢাকা।';
const BN2 = 'দ্বিতীয় পেজ: ক্ষুদ্র & "বৃহৎ" <tag> বিজ্ঞান\n\nতৃতীয় লাইন\tট্যাব সহ';
const EN3 = 'Third page in English.\n  Indented line kept.\n\nLast paragraph.';
const PAGES = [
  { name: 'p1.jpg', text: BN1, status: 'done', flags: [], reviewed: false, hash: 'aa', phash: '0f' },
  { name: 'p2.jpg', text: BN2, status: 'done', flags: ['short'], reviewed: true, hash: 'bb', phash: '1f' },
  { name: 'p3.jpg', text: EN3, status: 'done', flags: [], reviewed: false, hash: 'cc', phash: '2f' },
];

test('xmlEscape / xmlUnescape round-trip special chars and drop forbidden control chars', () => {
  const s = 'a & b < c > d "q" \u0001\u0008 ঢাকা';
  assert.equal(F.xmlEscape(s), 'a &amp; b &lt; c &gt; d &quot;q&quot;  ঢাকা');
  assert.equal(F.xmlUnescape(F.xmlEscape('x & <y> "z" ক')), 'x & <y> "z" ক');
  assert.equal(F.xmlUnescape('&#2453;&#x995;'), 'কক');
});

test('markdown: page-wise with headings, without headings, and merged', () => {
  const md = F.buildMarkdown('বই', PAGES, { pageLabel: 'পেজ' });
  assert.match(md, /^# বই\n\n## পেজ 1 — p1\.jpg\n\nবাংলাদেশ/);
  assert.ok(md.includes('\n\n---\n\n## পেজ 2 — p2.jpg'));
  assert.ok(!F.buildMarkdown('T', PAGES, { headings: false }).includes('## '));
  const merged = F.buildMarkdown('T', PAGES, { merged: true });
  assert.ok(!merged.includes('---') && merged.includes(BN1 + '\n\n' + BN2));
});

test('project JSON round-trips pages, flags, reviewed, hashes', () => {
  const json = F.buildProjectJson({ name: 'বই', sourceFileName: 'b.pdf', createdAt: 5, updatedAt: 6 }, PAGES);
  const back = F.parseProjectJson(json);
  assert.equal(back.name, 'বই');
  assert.equal(back.sourceFileName, 'b.pdf');
  assert.deepEqual(back.pages.map(p => p.text), PAGES.map(p => p.text));
  assert.deepEqual(back.pages[1].flags, ['short']);
  assert.equal(back.pages[1].reviewed, true);
  assert.equal(back.pages[2].phash, '2f');
});
test('parseProjectJson rejects non-Textriva JSON', () => {
  assert.throws(() => F.parseProjectJson('{"a":1}'), /Not a Textriva/);
  assert.throws(() => F.parseProjectJson('nope'), /Invalid JSON/);
});

test('docx: every part is well-formed XML (Bangla, & < > quotes, tabs, control chars)', () => {
  const dirty = PAGES.concat([{ name: 'x', text: 'ctrl\u0001char & more', status: 'done' }]);
  const { window } = new JSDOM('');
  const parser = new window.DOMParser();
  for (const opts of [{ headings: true }, { headings: false }, { merged: true }]) {
    const files = F.buildDocxFiles('শিরোনাম & "টাইটেল"', dirty, opts);
    assert.deepEqual(Object.keys(files)[0], '[Content_Types].xml');
    for (const [name, xml] of Object.entries(files)) {
      const doc = parser.parseFromString(xml, 'application/xml');
      assert.equal(doc.getElementsByTagName('parsererror').length, 0, `${name} not well-formed`);
    }
  }
});
test('docx page-wise round trip (with and without headings) restores identical page texts', () => {
  for (const headings of [true, false]) {
    const xml = F.buildDocxFiles('বই', PAGES, { headings })['word/document.xml'];
    assert.deepEqual(F.parseDocxPages(xml), PAGES.map(p => p.text), `headings=${headings}`);
  }
});
test('docx keeps an empty middle page as an empty page', () => {
  const pg = [{ name: 'a', text: 'one' }, { name: 'b', text: '' }, { name: 'c', text: 'three' }];
  assert.deepEqual(F.parseDocxPages(F.buildDocxFiles('', pg, {})['word/document.xml']), ['one', '', 'three']);
});
test('docx merged → a single page whose text is the pages joined by a blank line', () => {
  const xml = F.buildDocxFiles('বই', PAGES, { merged: true })['word/document.xml'];
  assert.deepEqual(F.parseDocxPages(xml), [PAGES.map(p => p.text.trim()).join('\n\n')]);
});
test('parseDocxPages reads Word-style XML (attributes on <w:p>, split runs, entities, self-closing empty paragraph)', () => {
  const xml = '<w:body><w:p w14:paraId="1A"><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>ঢা</w:t></w:r><w:r><w:t xml:space="preserve">কা &amp; </w:t></w:r><w:r><w:t>চট্টগ্রাম</w:t></w:r></w:p>'
    + '<w:p/><w:p><w:r><w:t>two</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>next page</w:t></w:r></w:p></w:body>';
  assert.deepEqual(F.parseDocxPages(xml), ['ঢাকা & চট্টগ্রাম\n\ntwo', 'next page']);
});

test('real ZIP: docx files zipped, re-opened, parsed → identical pages', async () => {
  const zip = new JSZip();
  const files = F.buildDocxFiles('বই', PAGES, { headings: true });
  Object.keys(files).forEach(k => zip.file(k, files[k]));
  const u8 = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const re = await JSZip.loadAsync(u8);
  assert.deepEqual(F.parseDocxPages(await re.file('word/document.xml').async('string')), PAGES.map(p => p.text));
});

test('backup ZIP round trip: export → (delete) → import gives identical pages, text, flags, images', async () => {
  const img1 = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 250, 251]);
  const img2 = new Uint8Array([255, 216, 255, 0, 9, 8, 7]);
  const projects = [
    { meta: { name: 'বই / খণ্ড:১', sourceFileName: 'book.pdf', createdAt: 100, updatedAt: 200 },
      pages: [
        { ...PAGES[0], data: img1, mime: 'image/png' },
        { ...PAGES[1], data: img2, mime: 'image/jpeg' },
        { name: 'imported.txt', text: EN3, status: 'done', txtOnly: true },
      ] },
    { meta: { name: 'Second', sourceFileName: '', createdAt: 1, updatedAt: 2 }, pages: [{ name: 'only', text: 'x', status: 'pending', data: img1, mime: 'image/webp' }] },
  ];
  const zip = F.buildBackupZip(new JSZip(), projects);
  const u8 = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const back = await F.readBackupZip(await JSZip.loadAsync(u8));
  assert.equal(back.length, 2);
  assert.equal(back[0].name, 'বই / খণ্ড:১');
  assert.equal(back[0].sourceFileName, 'book.pdf');
  assert.deepEqual(back[0].pages.map(p => p.text), [BN1, BN2, EN3]);
  assert.deepEqual(back[0].pages.map(p => p.name), ['p1.jpg', 'p2.jpg', 'imported.txt']);
  assert.deepEqual(back[0].pages[1].flags, ['short']);
  assert.equal(back[0].pages[1].reviewed, true);
  assert.equal(back[0].pages[0].hash, 'aa');
  assert.deepEqual(Array.from(back[0].pages[0].data), Array.from(img1));
  assert.deepEqual(Array.from(back[0].pages[1].data), Array.from(img2));
  assert.equal(back[0].pages[0].mime, 'image/png');
  assert.equal(back[0].pages[2].txtOnly, true);
  assert.equal(back[0].pages[2].data, undefined);
  assert.equal(back[1].pages[0].mime, 'image/webp');
});
test('readBackupZip rejects a ZIP that is not a Textriva backup', async () => {
  const z = new JSZip(); z.file('a.jpg', new Uint8Array([1]));
  await assert.rejects(() => F.readBackupZip(z), /manifest/);
  const z2 = new JSZip(); z2.file('manifest.json', '{"format":"other","projects":[]}');
  await assert.rejects(() => F.readBackupZip(z2), /Not a Textriva backup/);
});

test('helpers: dir names, image names, natural sort, ext/mime', () => {
  assert.equal(F.backupDirName(0, 'a/b:c*'), '01-a_b_c_');
  assert.ok(F.isImageName('x/Page 10.JPG') && !F.isImageName('notes.txt') && !F.isImageName('__MACOSX/a.jpg'));
  assert.deepEqual(['p10.jpg', 'p2.jpg', 'p1.jpg'].sort(F.naturalCompare), ['p1.jpg', 'p2.jpg', 'p10.jpg']);
  assert.equal(F.imageExtFor('image/jpeg', 'x'), 'jpg');
  assert.equal(F.imageExtFor('', 'scan.PNG'), 'png');
  assert.equal(F.mimeForExt('a.webp'), 'image/webp');
});

// ── wiring ──
test('Phase 5 is wired into the UI', () => {
  assert.match(html, /id="exportBtn"/);
  assert.match(html, /id="folderInput"[^>]*webkitdirectory/);
  assert.match(html, /id="backupInput"/);
  assert.match(html, /accept="image\/\*,\.pdf,\.txt,text\/plain,\.zip,\.docx,\.json"/);
  assert.match(source, /data-act="export-all"/);
  assert.match(source, /act === 'import-backup'/);
  assert.match(source, /\\\.docx\$/);
  assert.match(source, /loadZip\(file\)/);
  assert.match(source, /openExportDlg/);
  assert.match(source, /Copy as Markdown/);
});
test('JSZip is lazy-loaded from a pinned cdnjs URL (no unpinned/other hosts, never in the HTML <head>)', () => {
  assert.match(source, /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jszip\/3\.10\.1\/jszip\.min\.js/);
  assert.doesNotMatch(html.split('<script type="module">')[0], /jszip/i);
});
test('existing .txt download and Phase 1/2 features still wired', () => {
  assert.match(source, /\$\('downloadBtn'\)\.onclick/);
  assert.match(source, /function openDupCompare/);
  assert.match(source, /function startReview/);
});
