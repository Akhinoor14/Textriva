import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { getModuleSource, extractDeclaration } from './_extract.mjs';

const src = getModuleSource();
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Read mode markup + self-hosted KaTeX assets exist', () => {
  for (const id of ['modeEditBtn', 'modeReadBtn', 'readView', 'readFsUp', 'readFsDown']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(existsSync(new URL('../assets/katex/katex.min.js', import.meta.url)));
  assert.ok(existsSync(new URL('../assets/katex/katex.min.css', import.meta.url)));
});

test('splitMath finds display, inline and ignores currency', () => {
  const re = extractDeclaration(src, 'MATH_RE'), fn = extractDeclaration(src, 'splitMath');
  const splitMath = new Function(`${re}\n${fn}\nreturn splitMath;`)();
  const a = splitMath('x $E=mc^2$ and $$\\int_0^1 x\\,dx$$ and \\(a^2\\) \\[b\\]');
  assert.deepEqual(a.filter(p => p.k === 'm').map(p => [p.v, p.disp]), [['E=mc^2', false], ['\\int_0^1 x\\,dx', true], ['a^2', false], ['b', true]]);
  assert.equal(splitMath('cost $5 and $10 total').filter(p => p.k === 'm').length, 0);
});

test('splitMath: bare \\begin env is display math; escaped \\$ is not math', () => {
  const re = extractDeclaration(src, 'MATH_RE'), fn = extractDeclaration(src, 'splitMath');
  const splitMath = new Function(`${re}\n${fn}\nreturn splitMath;`)();
  const a = splitMath('x \\begin{vmatrix}1&2\\\\3&4\\end{vmatrix} y');
  assert.equal(a.filter(p => p.k === 'm').length, 1);
  assert.equal(a.find(p => p.k === 'm').disp, true);
  assert.equal(splitMath('price \\$5 and \\$10 ok').filter(p => p.k === 'm').length, 0);
});

test('AI prompt carries the rendering contract the Read view relies on', () => {
  assert.match(src, /RENDERING CONTRACT/);
  assert.match(src, /\$\$\.\.\.\$\$ \(display\)/);
});

const katex = (() => { const m = { exports: {} }; new Function('module', 'exports', readFileSync(new URL('../assets/katex/katex.min.js', import.meta.url), 'utf8'))(m, m.exports); return m.exports; })();
const decl = n => extractDeclaration(src, n);
const mathKit = () => new Function('katex', `${['MATH_RE','splitMath','aiNormalizeMath','aiMathOpts','aiBadMath','aiMathStray','aiDigitsOf'].map(decl).join('\n')}
return { aiNormalizeMath, aiBadMath, aiMathStray, splitMath };`)(katex);

test('aiNormalizeMath → canonical $ / $$', () => {
  const { aiNormalizeMath } = mathKit();
  assert.equal(aiNormalizeMath('a \\(x^2\\) b \\[y\\] c'), 'a $x^2$ b $$y$$ c');
  assert.equal(aiNormalizeMath('\\begin{equation}z=1\\end{equation}'), '$$z=1$$');
  assert.equal(aiNormalizeMath('\\begin{vmatrix}1&2\\\\3&4\\end{vmatrix}'), '$$\\begin{vmatrix}1&2\\\\3&4\\end{vmatrix}$$');
  assert.equal(aiNormalizeMath('দাম $5 আর \\$10 ok $v=2$'), 'দাম $5 আর \\$10 ok $v=2$');
});

test('aiBadMath finds only formulas KaTeX rejects; aiMathStray finds an unpaired $', () => {
  const { aiBadMath, aiMathStray } = mathKit();
  const bad = aiBadMath('ok $x^2$ bad $\\frac{1}{2$ and $$\\sqrt{$$', katex);
  assert.equal(bad.length, 2);
  assert.equal(aiBadMath('$\\dfrac{a}{b}$ $\\text{m s}^{-2}$', katex).length, 0);
  assert.equal(aiMathStray('cost $5 and $x'), true);
  assert.equal(aiMathStray('cost $5, \\$10 and $x$'), false);
});

test('aiRepairMath fixes only broken formulas and refuses number changes', async () => {
  const kit = new Function('katex', 'reply', 'AiError', `${['MATH_RE','splitMath','aiMathOpts','aiBadMath','aiDigitsOf','AI_MATH_FIX_SYS','aiRepairMath'].map(decl).join('\n')}
    const loadKatex = async () => katex; const aiParseJson = s => JSON.parse(s);
    const aiGenerateAnyKey = async () => ({ text: JSON.stringify(reply()) });
    return aiRepairMath;`);
  const o = { math: 'latex' };
  let reply = () => ({ 3: '\\frac{1}{2}' });
  const text = 'a $x^2$ b $\\frac{1}{2$ c';
  const r1 = await kit(katex, () => reply(), Error)(text, o, null, null);
  assert.equal(r1.fixed, 1); assert.equal(r1.bad, 0); assert.equal(r1.text, 'a $x^2$ b $\\frac{1}{2}$ c');
  reply = () => ({ 3: '\\frac{9}{2}' });                      // changes a number → rejected
  const r2 = await kit(katex, () => reply(), Error)(text, o, null, null);
  assert.equal(r2.fixed, 0); assert.equal(r2.bad, 1); assert.equal(r2.text, text);
  const r3 = await kit(katex, () => reply(), Error)(text, { math: 'unicode' }, null, null);
  assert.equal(r3.text, text);
});

test('text pane has prev/next and mobile ⋯ menus wired', () => {
  for (const id of ['txtPrevBtn', 'txtNextBtn', 'txtMoreBtn', 'txtMenu', 'imgMoreBtn', 'imgMenu']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(src, /\$\('txtNextBtn'\)\.addEventListener\('click', \(\) => \$\('nextPage'\)\.click\(\)\)/);
  assert.match(html, /ids: \['cmpBtn', 'undoPageBtn', 'redoPageBtn', 'bookmarkBtn', 'noteBtn', 'bmListBtn', 'clearTxtBtn', 'cutTxtBtn'\]/);
});
