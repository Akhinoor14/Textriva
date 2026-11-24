// Export with equations: KaTeX MathML → Word OMML, .docx round trip, rendered PDF/HTML body, standalone-HTML font inlining.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { getModuleSource, extractDeclaration } from './_extract.mjs';

const src = getModuleSource();
const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
const katex = (() => { const m = { exports: {} }; new Function('module', 'exports', readFileSync(new URL('../assets/katex/katex.min.js', import.meta.url), 'utf8'))(m, m.exports); return m.exports; })();

const names = ['DOCX_PAGE_BREAK', 'normNl', 'xmlEscape', 'xmlUnescape', 'MATH_RE', 'splitMath', 'docxRuns', 'docxParagraph', 'buildDocxFiles', 'parseDocxPages',
  'OMML_NARY', 'OMML_INT', 'OMML_ACC', 'OMML_BREAK', 'OMML_OPEN', 'OMML_CLOSE', 'OMML_ALPHA', 'ommKids', 'ommTag', 'ommText', 'ommAlpha', 'ommRun', 'ommLeaf', 'ommArg',
  'ommIsBreak', 'ommDelta', 'ommNaryOf', 'ommNary', 'ommSeq', 'ommFenced', 'ommTable', 'ommLimits', 'ommNode', 'latexToOmml', 'textHasMath', 'docxHiddenRun', 'docxTextParas',
  'RENDER_CSS', 'buildRenderedBody', 'katexNeededFonts', 'katexCssFor', 'buildStandaloneHtml', 'esc', 'formatBlocks', 'inlineFmt', 'renderReadHtml'];
const F = new Function(`${names.map(n => extractDeclaration(src, n)).join('\n')}\nreturn { ${names.join(', ')} };`)();

const wellFormed = xml => !new dom.window.DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror').length;
const omml = (tex, disp) => F.latexToOmml(katex, tex, disp);

test('OMML: fraction, root, scripts, big operators, accents, fences, matrices, cases', () => {
  assert.match(omml('\\frac{a+b}{2}'), /<m:f><m:num>.*<\/m:num><m:den>.*<\/m:den><\/m:f>/);
  assert.match(omml('\\sqrt{x}'), /<m:rad><m:radPr><m:degHide m:val="1"\/><\/m:radPr>/);
  assert.match(omml('\\sqrt[3]{x}'), /<m:rad><m:deg>.*<\/m:deg><m:e>/);
  assert.match(omml('x^2'), /<m:sSup>/);
  assert.match(omml('x_i'), /<m:sSub>/);
  assert.match(omml('x_i^2'), /<m:sSubSup>/);
  const sum = omml('\\sum_{i=1}^{n} a_i = b', true);
  assert.match(sum, /<m:nary><m:naryPr><m:chr m:val="∑"\/><m:limLoc m:val="undOvr"\/>/);
  assert.match(sum, /<m:e>.*<m:sSub>.*<\/m:e><\/m:nary>/);
  assert.match(sum, /<\/m:nary><m:r>(<m:rPr>.*?<\/m:rPr>)?(<w:rPr>.*?<\/w:rPr>)?<m:t[^>]*>=<\/m:t>/, 'operand stops before "="');
  assert.match(omml('\\int_0^1 x\\,dx'), /<m:nary><m:naryPr><m:chr m:val="∫"\/><m:limLoc m:val="subSup"\/>/);
  assert.match(omml('\\hat{x}'), /<m:acc><m:accPr><m:chr m:val="\u0302"\/>/);
  assert.match(omml('\\vec{v}'), /<m:acc><m:accPr><m:chr m:val="\u20D7"\/>/);
  assert.match(omml('\\overline{AB}'), /<m:bar><m:barPr><m:pos m:val="top"\/>/);
  assert.match(omml('\\left(\\frac{1}{2}\\right)'), /<m:d><m:dPr><m:begChr m:val="\("\/><m:endChr m:val="\)"\/>/);
  assert.match(omml('\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}'), /<m:d>.*<m:m><m:mr><m:e>.*<\/m:e><m:e>.*<\/m:mr><m:mr>/);
  assert.match(omml('\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}'), /<m:begChr m:val="\|"\/>/);
  assert.match(omml('\\begin{cases}x&a\\\\y&b\\end{cases}', true), /<m:begChr m:val="\{"\/><m:endChr m:val=""\/>.*<m:eqArr><m:e>/);
  assert.match(omml('\\binom{n}{k}'), /<m:type m:val="noBar"\/>/);
  assert.match(omml('\\mathbb{R}'), /ℝ/);
  assert.match(omml('\\text{মিটার} x'), /<m:nor\/>.*মিটার/);
});

test('OMML output is well-formed XML for real physics / maths formulas', () => {
  const formulas = ['E=mc^2', '\\vec{F}=m\\vec{a}', 'v=\\frac{dx}{dt}', '\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}', '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx=\\sqrt{\\pi}',
    '\\sum_{n=1}^{\\infty}\\frac{1}{n^2}=\\frac{\\pi^2}{6}', '\\begin{vmatrix}1&2\\\\3&4\\end{vmatrix}', '\\oint \\vec{E}\\cdot d\\vec{l}', '\\Delta x \\geq \\frac{\\hbar}{2\\Delta p}',
    '\\left[\\frac{a}{b}\\right]^2', '\\underbrace{a+b}_{n}', '\\boxed{x=1}', '\\mathcal{L}\\{f\\}', '\\prod_{k=1}^{n}k=n!', 'a_{n+1}=\\left(1+\\frac1n\\right)a_n'];
  for (const f of formulas) {
    const o = omml(f, true);
    assert.ok(o, f);
    assert.ok(wellFormed('<r xmlns:m="m" xmlns:w="w">' + o + '</r>'), f);
  }
  assert.equal(omml('\\frac{1}{2'), null);
});

const PAGES = ['বেগ $v=\\frac{dx}{dt}$ এবং\n$$E=mc^2$$\nশেষ লাইন', 'cost $5 and $10 — no math here', '$$\\int_0^1 x\\,dx$$', 'a\n\n$$x^2$$\n\nb $y_1$ c'];
const pg = a => a.map((text, i) => ({ name: 'p' + (i + 1), text }));
const opts = { math: (tex, d) => F.latexToOmml(katex, tex, d) };

test('docx with equations: native equations, well-formed, LaTeX restored on re-import', () => {
  const xml = F.buildDocxFiles('বই', pg(PAGES), { ...opts, headings: true })['word/document.xml'];
  assert.ok(wellFormed(xml));
  assert.match(xml, /xmlns:m="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/math"/);
  assert.equal((xml.match(/<m:oMathPara>/g) || []).length, 3);
  assert.equal((xml.match(/<m:oMath>/g) || []).length, 5);
  assert.deepEqual(F.parseDocxPages(xml), PAGES);
});

test('docx without opts.math keeps equations as LaTeX text', () => {
  const xml = F.buildDocxFiles('x', pg(PAGES), {})['word/document.xml'];
  assert.ok(!xml.includes('<m:oMath'));
  assert.deepEqual(F.parseDocxPages(xml), PAGES);
});

test('docx: a formula KaTeX rejects stays as its LaTeX text', () => {
  const bad = ['good $x^2$ bad $\\frac{1}{2$ ok'];
  const xml = F.buildDocxFiles('', pg(bad), opts)['word/document.xml'];
  assert.ok(wellFormed(xml));
  assert.deepEqual(F.parseDocxPages(xml), bad);
});

test('rendered body (PDF / HTML): equations typeset, headings + tables formatted', () => {
  const body = F.buildRenderedBody('বই', pg(['# শিরোনাম\nমান $x^2$ ও\n$$E=mc^2$$', 'a | b\nc | d']), { headings: true, pageLabel: 'পেজ', cert: 'CERT' }, katex);
  assert.match(body, /<h1>বই<\/h1>/);
  assert.match(body, /class="katex"/);
  assert.match(body, /katex-display/);
  assert.ok(!/class="katex-mathml"/.test(body));
  assert.match(body, /<span class="rd-h">শিরোনাম<\/span>/);
  assert.match(body, /<table class="rd-tbl">/);
  assert.match(body, /<pre class="cert">CERT<\/pre>/);
  assert.match(F.buildRenderedBody('t', pg(['$x^2$']), {}, null), /rd-err/);
});

test('standalone .html: only the needed KaTeX fonts are inlined as data URIs', () => {
  const css = readFileSync(new URL('../assets/katex/katex.min.css', import.meta.url), 'utf8');
  const body = F.buildRenderedBody('t', pg(['$\\mathbb{R}$ $\\frac{a}{b}$']), {}, katex);
  const need = F.katexNeededFonts(body);
  assert.ok(need.includes('KaTeX_Main-Regular') && need.includes('KaTeX_Math-Italic') && need.includes('KaTeX_AMS-Regular'));
  assert.ok(!need.includes('KaTeX_Fraktur-Regular') && !need.includes('KaTeX_Typewriter-Regular'));
  const out = F.katexCssFor(css, Object.fromEntries(need.map(n => [n, 'QUJD'])));
  assert.equal((out.match(/@font-face/g) || []).length, need.length);
  assert.ok(out.includes('url(data:font/woff2;base64,QUJD)') && !out.includes('url(fonts/'));
  const html = F.buildStandaloneHtml('শিরোনাম & "x"', body, out + F.RENDER_CSS);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>শিরোনাম &amp; &quot;x&quot;<\/title>/);
});

test('export wiring: html option + math-aware docx / pdf paths exist', () => {
  assert.match(src, /option value="html"/);
  assert.match(src, /fmt === 'html'/);
  assert.match(src, /math: kx \? \(tex, disp\) => latexToOmml\(kx, tex, disp\) : null/);
  assert.match(src, /buildRenderedBody\(title, pages/);
});

test('PDF/HTML output: no empty lines around display equation; Read view unchanged', () => {
  const t = 'আগে\n$$x^2$$\nপরে $5';
  const out = F.renderReadHtml(t, katex, 'html');
  assert.match(out, /আগে<span class="katex-display"/);
  assert.ok(!/<\/span>\nপরে/.test(out), out);
  const read = F.renderReadHtml(t, katex);
  assert.match(read, /আগে\n<span class="katex-display"/);
  assert.match(read, /katex-mathml/);
});
