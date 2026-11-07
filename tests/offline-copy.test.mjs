// A project opened from Drive lives on the device afterwards: opens offline, never re-downloads, never loses local edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { bootApp, addPages } from './_app.mjs';
import { installFakeDrive } from './_fakedrive.mjs';

async function setup(texts = ['one', 'two', 'three']) {
  const w = await bootApp({ drive: true });
  const drive = installFakeDrive(w); const a = w.__app;
  a.gdrive.token = 'tok'; a.gdrive.exp = Date.now() + 3600e3;
  addPages(w, texts, 'book.pdf');
  await a.syncToDrive();
  const folder = drive.folders()[0];
  const rev = () => drive.files.get(folder.id).appProperties.rev;
  return { w, a, drive, folder, rev };
}
const media = drive => drive.state.calls.filter(c => /alt=media/.test(c)).length;

test('same Drive revision → opens straight from the device with zero network', async () => {
  const { a, drive, folder, rev } = await setup();
  a.resetWorkspaceState(); drive.state.calls.length = 0;
  await a.openFromDriveTab(folder.id, rev());
  assert.equal(a.state.pages.length, 3);
  assert.equal(drive.state.calls.length, 0, 'not a single request');
});

test('offline → the device copy opens even though Drive cannot be reached', async () => {
  const { w, a, drive, folder } = await setup();
  a.resetWorkspaceState(); drive.state.calls.length = 0;
  Object.defineProperty(w.navigator, 'onLine', { value: false, configurable: true });
  await a.openFromDriveTab(folder.id, 'whatever');
  assert.equal(a.state.pages.length, 3); assert.equal(drive.state.calls.length, 0);
  const html = await a.offlineDriveHtml();
  assert.match(html, /book/); assert.match(html, /data-act="open-local"/, 'Drive tab can list device copies while offline');
});

test('Drive is newer and nothing is unsynced here → update from Drive, reusing every page already on the device', async () => {
  const { a, drive, folder } = await setup();
  drive.remoteEdit(folder.id, m => { m.pages[1].text = 'edited elsewhere'; });
  const newRev = drive.files.get(folder.id).appProperties.rev;
  a.resetWorkspaceState(); drive.state.calls.length = 0;
  await a.openFromDriveTab(folder.id, newRev);
  assert.equal(a.state.pages[1].text, 'edited elsewhere');
  assert.equal(media(drive), 1, 'only project.json — no page image downloaded again');
});

test('Drive is newer AND this device has unsynced edits → local work is kept and the merge dialog opens', async () => {
  const { w, a, drive, folder } = await setup();
  a.state.pages[0].text = 'my offline edit'; await a.saveNow();
  drive.remoteEdit(folder.id, m => { m.pages[1].text = 'edited elsewhere'; });
  const newRev = drive.files.get(folder.id).appProperties.rev;
  a.resetWorkspaceState();
  await a.openFromDriveTab(folder.id, newRev);
  assert.equal(a.state.pages[0].text, 'my offline edit', 'not overwritten by the Drive copy');
  assert.ok(a.state.syncConflict);
  assert.ok(w.document.getElementById('syncDlg'), 'user chooses: this device / Drive / merge');
});

test('a dropped connection mid-download resumes: finished pages are not fetched again', async () => {
  const { a, drive, folder } = await setup();
  for (const p of await a.localListAll()) await a.dbDeleteProject(p.id);       // brand-new device
  a.resetWorkspaceState();
  const third = drive.readJson(drive.child(folder.id, 'project.json')).pages[2].fileId;
  drive.state.failMatching = new RegExp('files/' + third + '\\?alt=media');
  await assert.rejects(a.openDriveProject(folder.id));
  assert.equal(a.state.pages.length, 0, 'workspace untouched after the failed attempt');
  drive.state.failMatching = null; drive.state.calls.length = 0;
  await a.openDriveProject(folder.id);
  assert.equal(a.state.pages.length, 3);
  assert.equal(media(drive), 2, 'project.json + the one page that was missing');
});

test('a failed device save is reported loudly instead of silently', async () => {
  const w = await bootApp({ drive: true }); const a = w.__app;
  a.noteSaveFailure(Object.assign(new Error('x'), { name: 'QuotaExceededError' }));
  const t = [...w.document.querySelectorAll('.toast')].pop();
  assert.match(t.textContent, /storage|জায়গা/);
  assert.equal(a.state._saveFailed, true);
  w.close();
});
