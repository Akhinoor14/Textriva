// All Clear: two confirmations, then everything (pages, text, library copy, upload queue) is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, addPages, tick } from './_app.mjs';

function setup(w, answers) {
  let asked = 0;
  w.confirm = () => { const a = answers[asked++]; return a === undefined ? true : a; };
  return () => asked;
}

test('All Clear button exists in the action row and is wired', async () => {
  const w = await bootApp();
  assert.ok(w.document.getElementById('allClearBtn'));
  assert.equal(w.document.getElementById('allClearBtnTxt').textContent.trim(), 'All Clear');
  w.close();
});

test('cancelling the FIRST confirmation changes nothing', async () => {
  const w = await bootApp(); const A = w.__app;
  const asked = setup(w, [false]);
  addPages(w, ['hello', 'world'], 'keep.pdf');
  await A.allClear();
  assert.equal(asked(), 1);
  assert.equal(A.state.pages.length, 2);
  w.close();
});

test('cancelling the SECOND confirmation changes nothing', async () => {
  const w = await bootApp(); const A = w.__app;
  const asked = setup(w, [true, false]);
  addPages(w, ['hello', 'world'], 'keep.pdf');
  await A.allClear();
  assert.equal(asked(), 2);
  assert.equal(A.state.pages.length, 2);
  assert.equal(A.state.pages[0].text, 'hello');
  w.close();
});

test('two confirmations → workspace, text box, project name and Library copy are all cleared', async () => {
  const w = await bootApp(); const A = w.__app;
  const asked = setup(w, [true, true]);
  addPages(w, ['hello', 'world', ''], 'wipe.pdf');
  A.renderAll();
  await A.saveNow();
  assert.equal((await A.localList()).length, 1, 'project is in the Library before clearing');
  w.document.getElementById('textArea').value = 'typed text';
  await A.allClear();
  assert.equal(asked(), 2);
  assert.equal(A.state.pages.length, 0);
  assert.equal(A.state.projectId, null);
  assert.equal(A.state.sourceFileName, '');
  assert.equal(w.document.getElementById('textArea').value, '');
  assert.equal((await A.localList()).length, 0, 'Library copy removed');
  assert.ok(w.document.getElementById('workspace').classList.contains('hidden'), 'back to the start screen');
  w.close();
});

test('All Clear stops the upload queue (nothing left to upload, nothing re-created)', async () => {
  const w = await bootApp({ bgUpload: true }); const A = w.__app;
  setup(w, [true, true]);
  let calls = 0;
  w.fetch = async () => { calls++; await tick(30); return { ok: true, status: 200, json: async () => ({ success: true, url: 'https://i.ibb.co/q.jpg' }) }; };
  addPages(w, Array(20).fill(''), 'run.pdf');
  A.pumpUploads();
  await tick(40);
  await A.allClear();
  const before = calls;
  await tick(300);
  assert.equal(A.state.pages.length, 0);
  assert.ok(calls - before <= A.UPLOAD_CONCURRENCY, 'only already in-flight requests may finish');
  assert.equal((await A.localList()).length, 0);
  w.close();
});
