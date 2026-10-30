// Phase 8 tests — sync hardening, run against an in-memory fake Google Drive (tests/_fakedrive.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { getModuleSource } from './_extract.mjs';
import { bootApp, addPages, tick } from './_app.mjs';
import { installFakeDrive } from './_fakedrive.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = getModuleSource();

async function setup(texts = ['one', 'two', 'three']) {
  const w = await bootApp({ drive: true });
  const drive = installFakeDrive(w); const a = w.__app;
  a.gdrive.token = 'tok'; a.gdrive.exp = Date.now() + 3600e3;
  addPages(w, texts, 'book.pdf');
  await a.syncToDrive();                                       // first, non-silent sync creates the Drive project
  const folder = drive.folders()[0];
  return { w, a, drive, folder };
}
const texts = a => a.state.pages.map(p => p.text);

// ── pure merge helpers ──
test('planMerge: pairs by Drive file id, then unique name; classifies every page', async () => {
  const w = await bootApp(); const { planMerge } = w.__app;
  const local = [{ name: 'a', text: 'same', driveFileId: 'F1' }, { name: 'b', text: '', driveFileId: 'F2' }, { name: 'c', text: 'mine', driveFileId: 'F3' }, { name: 'd', text: 'only here' }, { name: 'e', text: 'x', driveFileId: 'OLD' }];
  const remote = [{ name: 'a', text: 'same', fileId: 'F1' }, { name: 'b', text: 'theirs', fileId: 'F2' }, { name: 'c', text: 'theirs2', fileId: 'F3' }, { name: 'z', text: 'new', fileId: 'F9' }, { name: 'e', text: 'x', fileId: 'NEW' }];
  const p = planMerge(local, remote);
  assert.deepEqual([...p.rows.map(r => r.kind)], ['same', 'remote', 'conflict', 'same']);   // 'e' matched by its unique name after the image was re-uploaded
  assert.deepEqual([...p.localOnly], [3]); assert.deepEqual([...p.remoteOnly], [3]);
});

// ── conflict detection ──
test('no false conflict: repeated edits + syncs from the same device just upload', async () => {
  const { a, drive, folder } = await setup();
  a.state.pages[0].text = 'one edited'; await a.syncToDrive({ silent: true });
  a.state.pages[1].text = 'two edited'; await a.syncToDrive({ silent: true });
  assert.equal(a.state.syncConflict, null);
  assert.equal(drive.readJson(drive.child(folder.id, 'project.json')).pages[1].text, 'two edited');
  assert.equal(drive.folders().length, 1);
});

test('another device saved first → silent sync does NOT overwrite, conflict chip appears', async () => {
  const { w, a, drive, folder } = await setup();
  drive.remoteEdit(folder.id, m => { m.pages[1].text = 'edited on phone'; });
  a.state.pages[0].text = 'edited on laptop';
  await a.syncToDrive({ silent: true });
  assert.ok(a.state.syncConflict);
  const remote = drive.readJson(drive.child(folder.id, 'project.json'));
  assert.equal(remote.pages[1].text, 'edited on phone');        // Drive copy untouched
  assert.equal(remote.pages[0].text, 'one');
  a.refreshDriveChip();
  const chip = w.document.getElementById('driveChip');
  assert.equal(chip.dataset.mode, 'conflict'); assert.equal(chip.classList.contains('hidden'), false);
  a.state.pages[0].text = 'more'; a.queueDriveSync(); await tick(30);     // auto-sync stays paused while a conflict is open
  assert.equal(drive.readJson(drive.child(folder.id, 'project.json')).pages[0].text, 'one');
});

test('Use this device: forced sync overwrites Drive and clears the conflict', async () => {
  const { a, drive, folder } = await setup();
  drive.remoteEdit(folder.id, m => { m.pages[1].text = 'edited on phone'; });
  a.state.pages[0].text = 'edited on laptop';
  await a.syncToDrive({ silent: true }); assert.ok(a.state.syncConflict);
  await a.syncToDrive({ force: true });
  assert.equal(a.state.syncConflict, null);
  assert.deepEqual(drive.readJson(drive.child(folder.id, 'project.json')).pages.map(p => p.text), ['edited on laptop', 'two', 'three']);
  a.state.pages[2].text = 'next'; await a.syncToDrive({ silent: true });   // and normal syncing works again
  assert.equal(drive.readJson(drive.child(folder.id, 'project.json')).pages[2].text, 'next');
});

test('Use Drive: opening the Drive copy replaces local text and adopts the new revision', async () => {
  const { a, drive, folder } = await setup();
  drive.remoteEdit(folder.id, m => { m.pages[1].text = 'edited on phone'; });
  a.state.pages[0].text = 'edited on laptop';
  await a.syncToDrive({ silent: true }); assert.ok(a.state.syncConflict);
  await a.openDriveProject(folder.id);
  assert.deepEqual([...texts(a)], ['one', 'edited on phone', 'three']);
  assert.equal(a.state.syncConflict, null);
  a.state.pages[0].text = 'again'; await a.syncToDrive({ silent: true });
  assert.equal(drive.readJson(drive.child(folder.id, 'project.json')).pages[0].text, 'again');
});

test('Merge page by page: auto-merges one-sided edits, honours choices on conflicts, adds Drive-only pages', async () => {
  const { a, drive, folder } = await setup(['p1', '', 'p3', '']);
  const imgId = drive.addImage(folder.id, 'page-005.jpg', [7, 7, 7, 7]);
  drive.remoteEdit(folder.id, m => {
    m.pages[1].text = 'p2 from phone';          // local empty, remote has text → 'remote'
    m.pages[2].text = 'p3 from phone';          // both have text, differ → 'conflict'
    m.pages[3].text = 'p4 from phone';          // local empty, remote has text → 'remote'
    m.pages.splice(2, 0, { name: 'new-on-phone.jpg', text: 'brand new', status: 'done', fileId: imgId });
  });
  a.state.pages[2].text = 'p3 from laptop';     // only this page is edited on both sides
  await a.syncToDrive({ silent: true }); assert.ok(a.state.syncConflict);
  const remote = drive.readJson(drive.child(folder.id, 'project.json')).pages;
  const plan = a.planMerge(a.state.pages, remote);
  assert.deepEqual([...plan.rows.map(r => r.kind)], ['same', 'remote', 'conflict', 'remote']);
  assert.equal(plan.remoteOnly.length, 1);
  await a.applyMerge(plan, remote, { 2: 'remote' });
  assert.deepEqual([...texts(a)], ['p1', 'p2 from phone', 'brand new', 'p3 from phone', 'p4 from phone']);   // new page sits after its Drive predecessor
  assert.equal(a.state.pages[2].blob.size, 4);                  // its image was downloaded
  await a.syncToDrive({ force: true });
  assert.deepEqual([...drive.readJson(drive.child(folder.id, 'project.json')).pages.map(p => p.text)], [...texts(a)]);
  assert.equal(a.state.syncConflict, null);
});

test('conflict dialog: shows both versions and Merge applies the chosen side', async () => {
  const { w, a, drive, folder } = await setup();
  drive.remoteEdit(folder.id, m => { m.pages[0].text = 'phone version'; });
  a.state.pages[0].text = 'laptop version';
  await a.syncToDrive({ silent: true });
  const open = a.openSyncConflict(); await open; await tick(20);
  const dlg = w.document.getElementById('syncDlg'); assert.ok(dlg);
  assert.match(dlg.textContent, /phone version/); assert.match(dlg.textContent, /laptop version/);
  dlg.querySelector('[data-sc="mergeshow"]').click();
  dlg.querySelector('input[value="remote"]').checked = true;
  dlg.querySelector('[data-sc="mergeapply"]').click();
  for (let i = 0; i < 100 && a.state.syncConflict; i++) await tick(10);
  await tick(50);
  assert.equal(a.state.pages[0].text, 'phone version');
  assert.equal(a.state.syncConflict, null); assert.equal(w.document.getElementById('syncDlg'), null);
});

// ── robustness ──
test('a network error while checking the Drive folder never creates a duplicate folder', async () => {
  const { a, drive } = await setup();
  drive.state.failMatching = /GET .*\/files\/f\d+\?fields=id,trashed/;
  a.state.pages[0].text = 'edit'; await a.syncToDrive({ silent: true });
  drive.state.failMatching = null;
  assert.equal(drive.folders().length, 1);
  await a.syncToDrive({ silent: true });
  assert.equal(drive.folders().length, 1);
  assert.equal(drive.readJson(drive.child(drive.folders()[0].id, 'project.json')).pages[0].text, 'edit');
});

test('trashed Drive folder still starts a fresh one (existing behaviour kept)', async () => {
  const { a, drive, folder } = await setup();
  drive.files.get(folder.id).trashed = true;
  a.state.pages[0].text = 'edit'; await a.syncToDrive();
  assert.equal(drive.folders().filter(f => !f.trashed).length, 1);
  assert.notEqual(a.state.proj.driveFolderId, folder.id);
});

test('opening a Drive project that fails half-way leaves the open project and its local copy intact', async () => {
  const { a, drive, folder } = await setup();
  await a.saveNow(); await tick(10);
  const pid = a.state.projectId;
  drive.state.failMatching = /GET .*\/files\/f\d+\?alt=media/;      // every download fails
  await assert.rejects(() => a.openDriveProject(folder.id));
  drive.state.failMatching = null;
  assert.equal(a.state.pages.length, 3); assert.equal(a.state.projectId, pid);
  await a.saveNow(); await tick(10);
  const { recs } = await a.localLoad(pid); assert.equal(recs.length, 3);
});

// ── reconnect chip ──
test('Reconnect chip: only when signed-out/expired, Drive-linked, unsynced and this device signed in before', async () => {
  const { w, a } = await setup();
  const chip = w.document.getElementById('driveChip');
  a.refreshDriveChip(); assert.equal(chip.classList.contains('hidden'), true);              // token valid
  a.state.pages[0].text = 'changed'; a.gdrive.exp = 0;
  a.refreshDriveChip(); assert.equal(chip.classList.contains('hidden'), true);              // never signed in on this device
  w.localStorage.setItem('textriva-g-hint', 'me@example.com');
  a.refreshDriveChip(); assert.equal(chip.dataset.mode, 'reconnect'); assert.equal(chip.classList.contains('hidden'), false);
  a.gdrive.exp = Date.now() + 3600e3; a.state.pages[0].text = 'one';
  await a.syncToDrive({ silent: true }); a.refreshDriveChip();
  assert.equal(chip.classList.contains('hidden'), true);                                    // synced → hidden
});

// ── storage meter / free up space ──
// fake-indexeddb clones stored values with Node's built-in structuredClone, which cannot clone a
// jsdom-realm Blob (addPages' default) — it silently becomes {}. Swap in Node's own Blob so a
// round-trip through IndexedDB keeps real byte content; only this test reads blob bytes back.
function useRealBlobs(w) {
  w.__app.state.pages.forEach((p, i) => { p.blob = new Blob([new Uint8Array([1, 2, 3, i])], { type: 'image/jpeg' }); p.blobSaved = false; });
}

test('free up space: finished Drive-linked projects lose images (text stays); open/unsynced ones are kept; opening restores from Drive', async () => {
  const { w, a, drive, folder } = await setup(['t1', 't2', 't3']);
  useRealBlobs(w);
  await a.saveNow(); await tick(10);
  const doneId = a.state.projectId;
  // a second, unsynced project becomes the open one
  addPages(w, ['x', 'y'], 'other.pdf'); useRealBlobs(w); await a.saveNow(); await tick(10);
  const otherId = a.state.projectId;
  // fake-indexeddb is shared process-wide across this file's tests, so other finished/synced projects
  // from earlier tests may still be sitting in textriva-db. Delete every project this test didn't create
  // so freeUpSpace() (which scans ALL local projects, as it does in the real app) only sees these two.
  for (const p of await a.localList()) if (p.id !== doneId && p.id !== otherId) await a.dbDeleteProject(p.id);
  const list = await a.localList();
  assert.deepEqual([...list.filter(a.isFreeable).map(p => p.id)], [doneId]);                      // not synced / open → not freeable
  const res = await a.freeUpSpace();
  assert.equal(res.projects, 1); assert.ok(res.freed > 0);
  const after = await a.localLoad(doneId);
  assert.equal(after.proj.blobsFreed, true); assert.ok(after.blobs.every(b => !b));
  assert.deepEqual([...after.recs.map(r => r.text)], ['t1', 't2', 't3']);                        // text kept
  const other = await a.localLoad(otherId); assert.ok(other.blobs.every(b => b && b.blob));
  // merging a freed project is refused (it would silently drop its pages)
  const before = a.state.pages.length; assert.equal(await a.mergeProjectIntoCurrent(doneId), 0); assert.equal(a.state.pages.length, before);
  // opening it brings the images back from Drive
  await a.openLocalProject(doneId);
  assert.equal(a.state.projectId, doneId); assert.equal(a.state.pages.length, 3);
  assert.ok(a.state.pages.every(p => p.blob && p.blob.size > 0));
  await a.saveNow(); await tick(10);
  const back = await a.localLoad(doneId); assert.equal(back.proj.blobsFreed, false); assert.ok(back.blobs.every(b => b && b.blob));
});

test('storage meter renders usage and the free-up button only when something is freeable', async () => {
  const w = await bootApp(); const { storageMeterHtml, isFreeable } = w.__app;
  assert.equal(storageMeterHtml(null, []), '');
  const h = storageMeterHtml({ usage: 5 * 1048576, quota: 1073741824 }, [{ id: 'p', driveFolderId: 'F', pageCount: 2, doneCount: 2 }]);
  assert.match(h, /5 MB/); assert.match(h, /1\.0 GB/); assert.match(h, /data-act="free-space"/);
  assert.doesNotMatch(storageMeterHtml({ usage: 1, quota: 100 }, [{ id: 'p', pageCount: 2, doneCount: 2 }]), /free-space/);
  assert.equal(isFreeable({ id: 'p', driveFolderId: 'F', pageCount: 2, doneCount: 1 }), false);
  assert.equal(isFreeable({ id: 'p', driveFolderId: 'F', pageCount: 2, doneCount: 2, blobsFreed: true }), false);
});

test('wiring: Drive stays off without a Client ID, imgbb path untouched, chip + dialog markup present', () => {
  assert.match(html, /id="driveChip"/);
  assert.match(source, /const GOOGLE_CLIENT_ID = '[^']*';/);
  assert.match(source, /fetch\('\/api\/upload'/);
  assert.match(source, /scheduleTokenRefresh\(\);\s*\n\s*refreshAcctUi\(\);/);
});
