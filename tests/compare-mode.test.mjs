// Compare mode: before/after a fix, line by line, one scroller; closing it restores the normal layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, addPages, tick } from './_app.mjs';

const BEFORE = 'প্রথম লাইন\nবল F = ma\nতৃতীয় লাইন ভুল\nশেষ লাইন';
const AFTER = 'প্রথম লাইন\nবল F = ma\nতৃতীয় লাইন ঠিক\nনতুন লাইন\nশেষ লাইন';

test('Diff mode shows before/after rows with changed/added markers; closing restores the layout', async () => {
  const w = await bootApp();
  addPages(w, [BEFORE, 'অন্য page']);
  const { state, applyTextChanges, renderAll } = w.__app;
  renderAll();
  const pg = state.pages[0];
  const r = applyTextChanges([{ id: pg.id, before: BEFORE, after: AFTER }], 'AI fix', {});
  assert.equal(r.applied, 1);
  const doc = w.document, ws = doc.getElementById('workspace');
  assert.ok(doc.getElementById('cmpBtn').classList.contains('has-fix'));
  doc.getElementById('cmpBtn').click();
  assert.ok(ws.classList.contains('cmp-on'));
  assert.ok(!doc.getElementById('cmpPanel').classList.contains('hidden'));
  const rows = [...doc.querySelectorAll('#cmpBody .cmp-row')].map(x => x.className.replace('cmp-row', '').trim());
  assert.deepEqual(rows, ['eq', 'eq', 'chg', 'add', 'eq']);
  assert.match(doc.getElementById('cmpBody').innerHTML, /cmp-w-del/);
  assert.match(doc.getElementById('cmpBody').innerHTML, /cmp-w-add/);
  assert.match(doc.getElementById('cmpSum').textContent, /\+2/);
  // one scroller holds both sides → they cannot drift apart
  assert.equal(doc.querySelectorAll('#cmpBody .cmp-scroll, .cmp-scroll').length, 1);
  doc.getElementById('cmpOff').click();
  assert.ok(!ws.classList.contains('cmp-on'));
  assert.ok(doc.getElementById('cmpPanel').classList.contains('hidden'));
  assert.equal(doc.getElementById('textArea').value, AFTER);
  w.close();
});

test('Diff mode on a page with no fix explains itself; stepping to a fixed page works; undo-bulk drops the trail', async () => {
  const w = await bootApp();
  addPages(w, ['কিছু text', BEFORE]);
  const { state, applyTextChanges, renderAll, undoBulk } = w.__app;
  renderAll();
  const doc = w.document;
  doc.getElementById('cmpBtn').click();
  assert.match(doc.getElementById('cmpBody').textContent, /কোনো fix|no fix/i);
  const p1 = state.pages[1];
  applyTextChanges([{ id: p1.id, before: BEFORE, after: AFTER }], 'Cleanup', {});
  doc.getElementById('cmpNextFixed').click();
  assert.equal(state.current, 1);
  assert.ok(doc.querySelectorAll('#cmpBody .cmp-row.chg').length >= 1);
  undoBulk();
  assert.equal((p1._fixTrail || []).length, 0);
  w.close();
});
