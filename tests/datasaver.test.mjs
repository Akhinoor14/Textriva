// Mobile-data savings for Drive transfers + the "project switched" cue.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { bootApp, addPages } from './_app.mjs';
import { installFakeDrive } from './_fakedrive.mjs';

async function setup(texts = ['one', 'two', 'three']) {
  const w = await bootApp({ drive: true });
  const drive = installFakeDrive(w); const a = w.__app;
  a.gdrive.token = 'tok'; a.gdrive.exp = Date.now() + 3600e3;
  addPages(w, texts, 'book.pdf');
  await a.syncToDrive();
  return { w, a, drive, folder: drive.folders()[0] };
}
const media = drive => drive.state.calls.filter(c => /alt=media/.test(c)).length;

test('re-opening a Drive project on a device that already has its pages downloads no images again', async () => {
  const { a, drive, folder } = await setup();
  drive.state.calls.length = 0;
  await a.openDriveProject(folder.id);
  assert.equal(a.state.pages.length, 3);
  assert.equal(media(drive), 1, 'only project.json is fetched — the 3 page images come from this device');
});

test('a brand-new device still downloads every page', async () => {
  const { a, drive, folder } = await setup();
  for (const p of await a.localListAll()) await a.dbDeleteProject(p.id);      // simulate: nothing stored locally
  a.resetWorkspaceState();
  drive.state.calls.length = 0;
  await a.openDriveProject(folder.id);
  assert.equal(a.state.pages.length, 3);
  assert.equal(media(drive), 1 + 3, 'project.json + 3 images');
});

test('Data saver: big downloads show the size and can be cancelled before anything is fetched', async () => {
  const { w, a, drive, folder } = await setup(['one']);
  const imgId = drive.addImage(folder.id, 'page-002.jpg', new Uint8Array(3 * 1048576));
  drive.remoteEdit(folder.id, m => { m.pages.push({ name: 'big.jpg', text: '', status: 'pending', fileId: imgId }); });
  for (const p of await a.localListAll()) await a.dbDeleteProject(p.id);
  a.resetWorkspaceState();
  w.localStorage.setItem('textriva-datasaver', '1');
  assert.equal(a.dataSaverOn(), true);
  let asked = '';
  w.confirm = msg => { asked = msg; return false; };
  drive.state.calls.length = 0;
  await a.openDriveProject(folder.id);
  assert.match(asked, /3\.\d MB|3 MB/);
  assert.equal(a.state.pages.length, 0, 'cancelled — nothing opened');
  assert.equal(drive.state.calls.filter(c => /alt=media/.test(c) && !/project/.test(c)).length <= 1, true, 'no page image was downloaded');
  w.confirm = () => true;
  await a.openDriveProject(folder.id);
  assert.equal(a.state.pages.length, 2);
});

test('mobile-data detection and thresholds', async () => {
  const w = await bootApp({ drive: true }); const a = w.__app;
  assert.equal(a.isMetered(), false); assert.equal(a.bigTransferNeedsAsk(50e6), false, 'unknown connection + saver off → never nags');
  Object.defineProperty(w.navigator, 'connection', { value: { type: 'cellular' }, configurable: true });
  assert.equal(a.isMetered(), true);
  assert.equal(a.bigTransferNeedsAsk(5e6), false, 'small transfer on mobile data: no prompt');
  assert.equal(a.bigTransferNeedsAsk(20e6), true, 'large transfer on mobile data: ask');
  w.localStorage.setItem('textriva-datasaver', '1');
  assert.equal(a.bigTransferNeedsAsk(3e6), true, 'Data saver lowers the threshold');
  w.localStorage.setItem('textriva-datasaver', '0');
  assert.equal(a.dataSaverOn(), false, 'explicit Off wins over the browser hint');
  w.close();
});

test('switching projects: highlighted name, short fade, and a one-tap way back', async () => {
  const w = await bootApp({ drive: true }); const a = w.__app;
  addPages(w, ['x'], 'second-book.pdf'); a.renderAll();
  assert.equal(w.document.getElementById('projName').textContent, 'second-book');
  assert.match(w.document.getElementById('projWhere').textContent, /device|এই/);
  a.announceSwitch({ id: 'old-id', name: 'First book' }, 'Second book');
  const t = [...w.document.querySelectorAll('.toast')].pop();
  assert.ok(t.textContent.includes('First book'), 'mentions the project that was replaced');
  assert.ok(t.querySelector('.toast-action'), 'has a Switch back action');
  assert.ok(w.document.getElementById('workspace').classList.contains('switch-in'));
  assert.ok(w.document.getElementById('projChip').classList.contains('flash'));
  a.announceSwitch(null, 'Third');
  assert.ok(![...w.document.querySelectorAll('.toast')].pop().querySelector('.toast-action'), 'first project: nothing to switch back to');
  w.close();
});

test('wiring: Data saver pauses background sync on mobile data and shrinks Drive copies', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(src, /dataSaverOn\(\) && isMetered\(\)\) return;/);
  assert.match(src, /compressBlob\(p\.blob, dataSaverOn\(\) \? 1500 : 4500\)/);
  assert.match(src, /data-act="toggle-datasaver"/);
});
