// Drive keeps ONE original pdf (not a JPEG per page); opening it elsewhere downloads the pdf and splits it again, with visible progress.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { bootApp, addPages } from './_app.mjs';
import { installFakeDrive } from './_fakedrive.mjs';

const J = x => JSON.stringify(x);   // arrays from the jsdom realm
const PDF = [37, 80, 68, 70, 45, 49, 46, 52, 10, 1, 2, 3];
async function setup(n = 3) {
  const w = await bootApp({ drive: true });
  const drive = installFakeDrive(w); const a = w.__app;
  w.XMLHttpRequest = undefined;                                               // fake Drive speaks fetch only → dUploadProgress falls back to dUpload
  w.HTMLCanvasElement.prototype.getContext = () => ({});
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob([new Uint8Array([9, 9, this.width & 255])], { type: 'image/jpeg' })); };
  if (!w.Blob.prototype.arrayBuffer) w.Blob.prototype.arrayBuffer = function () { return new Promise(r => { const fr = new w.FileReader(); fr.onload = () => r(fr.result); fr.readAsArrayBuffer(this); }); };
  const rendered = [];
  w.__pdfjsGetDocument = () => ({ promise: Promise.resolve({ numPages: n, cleanup() {}, getPage: async k => ({ getViewport: () => ({ width: 10 + k, height: 10 }), render: o => { rendered.push([k, o.intent]); return { promise: Promise.resolve() }; }, cleanup() {} }) }) });
  a.gdrive.token = 'tok'; a.gdrive.exp = Date.now() + 3600e3;
  addPages(w, Array.from({ length: n }, (_, i) => 'text ' + (i + 1)), 'book.pdf');
  a.state.srcPdf = { blob: new w.Blob([new Uint8Array(PDF)], { type: 'application/pdf' }), name: 'book.pdf', scale: 2, saved: false };
  a.state.pages.forEach((p, i) => { p.pdfRef = i + 1; });
  return { w, a, drive, rendered };
}
const names = (drive, folder) => [...drive.files.values()].filter(f => (f.parents || []).includes(folder.id) && !f.trashed).map(f => f.name).sort();

test('sync uploads source.pdf once and NO page images; project.json records pdf + page numbers', async () => {
  const { a, drive } = await setup();
  await a.syncToDrive();
  const folder = drive.folders()[0];
  assert.deepEqual(names(drive, folder), ['project.json', 'source.pdf', 'text.txt']);
  assert.deepEqual([...drive.child(folder.id, 'source.pdf').bytes], PDF);
  const meta = drive.readJson(drive.child(folder.id, 'project.json'));
  assert.equal(meta.pdf.name, 'book.pdf'); assert.ok(meta.pdf.fileId);
  assert.equal(J(meta.pages.map(p => p.pdfPage)), J([1, 2, 3])); assert.ok(meta.pages.every(p => !p.fileId));
  const before = drive.state.calls.length;
  await a.syncToDrive({ force: true });
  assert.equal(drive.state.calls.slice(before).filter(c => /source\.pdf|POST .*upload/.test(c) && /POST/.test(c)).length, 0, 'the pdf is not uploaded again');
});

test('an edited page leaves the pdf: it travels as an image, the others stay pdf-backed', async () => {
  const { w, a, drive } = await setup();
  await a.syncToDrive();
  const folder = drive.folders()[0];
  a.setPageBlob(a.state.pages[1], new w.Blob([new Uint8Array([7, 7])], { type: 'image/jpeg' }), 'blob:edited');
  assert.equal(a.state.pages[1].pdfRef, null);
  await a.syncToDrive({ force: true });
  assert.deepEqual(names(drive, folder), ['page-002.jpg', 'project.json', 'source.pdf', 'text.txt']);
  const meta = drive.readJson(drive.child(folder.id, 'project.json'));
  assert.equal(J(meta.pages.map(p => p.pdfPage)), J([1, null, 3])); assert.ok(meta.pages[1].fileId);
});

test('opening on a new device: pdf downloaded once, split again (intent print), pages come back with text and pdfRef; second open uses the device copy', async () => {
  const { a, drive, rendered } = await setup();
  await a.syncToDrive();
  const folder = drive.folders()[0];
  for (const p of await a.localListAll()) await a.dbDeleteProject(p.id);       // brand-new device
  a.resetWorkspaceState(); rendered.length = 0; drive.state.calls.length = 0;
  await a.openDriveProject(folder.id);
  assert.equal(a.state.pages.length, 3);
  assert.equal(J(a.state.pages.map(p => p.text)), J(['text 1', 'text 2', 'text 3']));
  assert.equal(J(a.state.pages.map(p => p.pdfRef)), J([1, 2, 3]));
  assert.ok(a.state.pages.every(p => p.blob && p.blob.size > 0));
  assert.equal(J(rendered.map(r => r[0])), J([1, 2, 3])); assert.ok(rendered.every(r => r[1] === 'print'));
  assert.equal(drive.state.calls.filter(c => /alt=media/.test(c)).length, 2, 'project.json + the pdf — no page images');
  assert.ok(a.state.srcPdf && a.state.srcPdf.blob.size === PDF.length);
  await a.saveNow();
  assert.ok(await a.readSrcBlob(a.state.projectId), 'pdf kept on the device');
  // again: nothing to download except project.json
  a.resetWorkspaceState(); rendered.length = 0; drive.state.calls.length = 0;
  await a.openDriveProject(folder.id);
  assert.equal(a.state.pages.length, 3);
  assert.equal(drive.state.calls.filter(c => /alt=media/.test(c)).length, 1, 'only project.json');
  assert.equal(rendered.length, 0, 'pages reused from the device, nothing re-rendered');
});

test('progress is painted for the pdf download and upload', async () => {
  const { w, a, drive } = await setup();
  await a.syncToDrive();
  const folder = drive.folders()[0];
  for (const p of await a.localListAll()) await a.dbDeleteProject(p.id);
  a.resetWorkspaceState();
  const seen = [];
  const mo = new w.MutationObserver(() => seen.push(w.document.getElementById('uploadDetail').textContent));
  mo.observe(w.document.getElementById('uploadDetail'), { childList: true, characterData: true, subtree: true });
  await a.openDriveProject(folder.id);
  await new Promise(r => setTimeout(r, 10));
  assert.ok(seen.some(t => /PDF/.test(t)), 'download progress text was shown: ' + JSON.stringify(seen));
});
