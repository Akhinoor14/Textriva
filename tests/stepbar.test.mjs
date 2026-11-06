// Sticky Auto Step bar (same action as Space), "More" menu, and a calm, emoji-free UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootApp, addPages } from './_app.mjs';

const doc = w => w.document, $ = (w, id) => w.document.getElementById(id);

test('Auto Step button lives in the sticky bar and runs the very same function as Space', async () => {
  const w = await bootApp(); const A = w.__app;
  const bar = $(w, 'stepBar'), btn = $(w, 'flowBtn');
  assert.ok(bar.contains(btn));
  assert.ok(!$(w, 'actionRow').contains(btn), 'not buried in the tool row any more');
  assert.equal(btn.onclick, A.runWorkflowStep, 'button and Space call the same runWorkflowStep');
  w.close();
});

test('step bar is hidden without pages, then shows progress and a state-based label', async () => {
  const w = await bootApp(); const A = w.__app;
  A.renderAll();
  assert.ok($(w, 'stepBar').classList.contains('hidden'));
  addPages(w, ['done text', '', ''], 'book.pdf'); A.state.pages[0].status = 'done';
  A.renderAll();
  assert.ok(!$(w, 'stepBar').classList.contains('hidden'));
  assert.equal($(w, 'stepCount').textContent, '1 / 3');
  const start = $(w, 'flowBtnTxt').textContent;
  A.state.kWorkflowStarted = true; A.updateStepBar();
  const running = $(w, 'flowBtnTxt').textContent;
  assert.notEqual(start, running, 'label changes once the workflow has started');
  A.state.kWorkflowComplete = true; A.updateStepBar();
  assert.ok($(w, 'flowBtn').classList.contains('is-complete'));
  w.close();
});

test('less-used tools sit in a More menu that opens, closes on pick, and keeps every button', async () => {
  const w = await bootApp();
  const menu = $(w, 'moreMenu'), more = $(w, 'moreBtn');
  for (const id of ['textToolsBtn', 'pageToolsBtn', 'cameraBtn', 'ocrBtn', 'allClearBtn', 'copyAllBtn', 'downloadBtn', 'copyAllMergedBtn']) assert.ok(menu.contains($(w, id)), id + ' in menu');
  for (const id of ['driveSaveBtn', 'exportBtn', 'moreBtn']) assert.ok($(w, 'actionRow').contains($(w, id)), id + ' visible in row');
  assert.ok(menu.classList.contains('hidden'));
  more.click(); assert.ok(!menu.classList.contains('hidden')); assert.equal(more.getAttribute('aria-expanded'), 'true');
  $(w, 'cameraBtn').click(); assert.ok(menu.classList.contains('hidden'), 'closes after choosing');
  more.click(); doc(w).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(menu.classList.contains('hidden'), 'Esc closes');
  w.close();
});

test('markup has no decorative emoji and no endless pulsing animations', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const body = html.slice(html.indexOf('<body>'), html.indexOf('<script type="module">'));
  assert.doesNotMatch(body, /[\u{1F300}-\u{1FAFF}\u2728\u26A1]/u, 'no pictographic emoji in static markup');
  const css = html.slice(0, html.indexOf('</head>'));
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /#flowBtn\.waiting-copy,[^}]*animation:none/);
});
