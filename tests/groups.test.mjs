// Library groups: user-made nested folders on both Library tabs (This device + Google Drive).
// The real app runs in jsdom + fake-indexeddb and is driven through its own buttons and dialogs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp as bootRaw, addPages, tick } from './_app.mjs';
import { installFakeDrive } from './_fakedrive.mjs';

// fake-indexeddb is process-global (other suites live with that): empty every store so each test starts from a blank Library.
async function clearDb() {
  const db = await new Promise((res, rej) => { const r = globalThis.indexedDB.open('textriva-db', 2); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const stores = Array.from(db.objectStoreNames);
  await new Promise((res, rej) => { const tx = db.transaction(stores, 'readwrite'); tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); stores.forEach(s => tx.objectStore(s).clear()); });
  db.close();
}
const bootApp = async o => { const w = await bootRaw(o); await w.__app.localList().catch(() => {}); await clearDb(); return w; };
const $ = (w, sel) => w.document.querySelector(sel);
const $$ = (w, sel) => Array.from(w.document.querySelectorAll(sel));
const click = (w, sel) => { const el = $(w, sel); assert.ok(el, 'missing ' + sel); el.click(); return el; };
const names = w => $$(w, '#libContent .lib-item .lib-name').map(e => e.childNodes[0].textContent.trim());   // first text node = name (tags follow)
const cardNames = w => $$(w, '#libContent .grp-card .grp-name').map(e => e.textContent.trim());
const crumbs = w => $$(w, '#libContent .grp-crumbs .grp-crumb:not(.grp-up)').map(e => e.textContent.trim());

// save a project to the Library (IndexedDB) and leave the workspace empty again
async function addProject(w, name) {
  addPages(w, ['hello', 'world'], name + '.pdf');
  await w.__app.saveNow();
  await tick(20);
  w.__app.resetWorkspaceState();
}
async function openLib(w, tab) { w.__app.openLib(tab || 'local'); await tick(60); }
async function dialogType(w, value) {
  const inp = $(w, '.grp-dlg input'); assert.ok(inp, 'dialog input missing');
  inp.value = value; click(w, '.grp-dlg [data-d="ok"]'); await tick(60);
}
async function pickAndConfirm(w, gid) {
  const row = $(w, `.grp-dlg .grp-pk[data-gid="${gid}"]`); assert.ok(row && !row.disabled, 'pick row missing/disabled: ' + gid);
  row.click(); click(w, '.grp-dlg [data-d="ok"]'); await tick(80);
}

// ── data model ──
test('model: create / rename / duplicate-name / depth rules', async () => {
  const w = await bootApp(); const g = w.__app.grpApi; await g.load();
  const a = await g.create('Semester 1'), b = await g.create('Physics', a.id);
  assert.equal(b.parent, a.id);
  await assert.rejects(() => g.create('semester 1'), /একই নাম|already exists/);           // case-insensitive sibling clash
  await assert.rejects(() => g.create('   '), /নাম দিন|Enter a name/);
  await assert.rejects(() => g.create('x'.repeat(61)), /60/);
  assert.ok(await g.create('Physics'));                                                    // same name under a different parent is fine
  await g.rename(b.id, 'Optics'); assert.equal(g.state().groups.find(x => x.id === b.id).name, 'Optics');
  let p = b.id; for (let i = 0; i < g.MAX - 2; i++) p = (await g.create('L' + i, p)).id;   // fill to MAX levels
  await assert.rejects(() => g.create('too deep', p), /স্তর|levels/);
});

test('model: a group cannot move into itself or its own descendants; depth is re-checked on move', async () => {
  const w = await bootApp(); const g = w.__app.grpApi; await g.load();
  const a = await g.create('A'), b = await g.create('B', a.id), c = await g.create('C', b.id);
  await assert.rejects(() => g.move(a.id, c.id), /নিজের ভিতরে|itself/);
  await assert.rejects(() => g.move(a.id, a.id), /নিজের ভিতরে|itself/);
  await g.move(c.id, '');                                                                  // out to the top level
  assert.equal(g.state().groups.find(x => x.id === c.id).parent, '');
  await g.move(b.id, c.id);                                                                // B (now empty of C) into C
  assert.deepEqual(Array.from(g.path(b.id), x => x.name), ['C', 'B']);
});

test('model: deleting a group moves its projects and sub-groups up — nothing is lost', async () => {
  const w = await bootApp(); const g = w.__app.grpApi; await g.load();
  const a = await g.create('A'), b = await g.create('B', a.id), x = await g.create('B');   // root already has a "B" → clash on lift
  await g.setItems(['p1'], a.id); await g.setItems(['p2'], b.id);
  await g.del(a.id);
  const st = g.state();
  assert.equal(st.groups.find(q => q.id === b.id).parent, '');
  assert.notEqual(st.groups.find(q => q.id === b.id).name.toLowerCase(), 'b');             // renamed "B (2)" instead of clashing
  assert.equal(st.assign.p1, undefined);                                                   // was in A → back to root
  assert.equal(st.assign.p2, b.id);
  assert.ok(st.groups.find(q => q.id === x.id));
});

test('model: groups persist across reloads and are separate per account', async () => {
  const w = await bootApp(); const g = w.__app.grpApi; await g.load();
  await g.create('Guest group');
  await g.load(); assert.deepEqual(Array.from(g.state().groups, x => x.name), ['Guest group']);
  w.localStorage.setItem(w.__app.LS_USER, JSON.stringify({ sub: 'u1', email: 'a@b.c' }));
  await g.load(); assert.deepEqual(Array.from(g.state().groups), [], 'a signed-in account does not see the guest\'s groups');
  await g.create('Mine');
  w.localStorage.removeItem(w.__app.LS_USER);
  await g.load(); assert.deepEqual(Array.from(g.state().groups, x => x.name), ['Guest group']);
});

test('model: claiming guest projects brings the guest groups along', async () => {
  const w = await bootApp(); const g = w.__app.grpApi; await g.load();
  const a = await g.create('Notes'); await g.setItems(['p1'], a.id);
  w.localStorage.setItem(w.__app.LS_USER, JSON.stringify({ sub: 'u1', email: 'a@b.c' }));
  await g.load(); await g.create('Existing');
  await g.adoptGuest(); await g.load();
  assert.deepEqual(Array.from(g.state().groups, x => x.name).sort(), ['Existing', 'Notes']);
  assert.equal(g.state().assign.p1, a.id);
  w.localStorage.removeItem(w.__app.LS_USER); await g.load();
  assert.deepEqual(Array.from(g.state().groups), [], 'guest record is cleared after adoption');
});

// ── This device tab ──
test('device tab: create group → open card → breadcrumb → move project in → up → tree', async () => {
  const w = await bootApp();
  await addProject(w, 'Alpha'); await addProject(w, 'Beta');
  await openLib(w);
  assert.deepEqual(names(w).sort(), ['Alpha', 'Beta']);
  assert.equal($$(w, '.grp-card').length, 0);
  assert.equal($(w, '.grp-tree'), null, 'no tree until a group exists');

  click(w, '[data-act="grp-new"]'); await tick(20);
  await dialogType(w, 'Semester 1');
  assert.deepEqual(cardNames(w), ['Semester 1']);
  assert.ok($(w, '.grp-tree'), 'tree appears once a group exists');

  // move Alpha into the group via the Move dialog
  const alphaMove = $$(w, '.lib-item').find(e => /Alpha/.test(e.textContent)).querySelector('[data-act="grp-move-item"]');
  alphaMove.click(); await tick(20);
  await pickAndConfirm(w, w.__app.grpApi.state().groups[0].id);
  assert.deepEqual(names(w), ['Beta'], 'Alpha left the root list');
  assert.match($(w, '.grp-card .grp-meta').textContent, /1/);

  // enter the group by clicking its card
  click(w, '.grp-card'); await tick(60);
  assert.deepEqual(crumbs(w), ['Library', 'Semester 1'].map(x => x));
  assert.deepEqual(names(w), ['Alpha']);
  assert.equal($(w, '.lib-note.lib-row'), null, 'root-only notes are hidden inside a group');

  // sub-group inside it, then enter that too
  click(w, '[data-act="grp-new"]'); await tick(20);
  assert.match($(w, '.grp-dlg-body').textContent, /Semester 1/);
  await dialogType(w, 'Physics');
  assert.deepEqual(cardNames(w), ['Physics']);
  click(w, '.grp-card'); await tick(60);
  assert.deepEqual(crumbs(w), ['Library', 'Semester 1', 'Physics']);
  assert.match($(w, '.grp-main .lib-empty').textContent, /খালি|empty/i);

  // up button, then breadcrumb jump to root
  click(w, '.grp-up'); await tick(60);
  assert.deepEqual(crumbs(w), ['Library', 'Semester 1']);
  assert.ok($$(w, '.grp-tl').length >= 3, 'tree lists Library + both groups');
  $$(w, '.grp-crumb').find(e => /Library/.test(e.textContent)).click(); await tick(60);
  assert.deepEqual(names(w), ['Beta']);
  // tree click navigates too
  $$(w, '.grp-tl').find(e => /Physics/.test(e.textContent)).click(); await tick(60);
  assert.deepEqual(crumbs(w), ['Library', 'Semester 1', 'Physics']);
});

test('device tab: dialog validation, Escape cancels, rename + delete keep projects', async () => {
  const w = await bootApp();
  await addProject(w, 'Alpha'); await openLib(w);
  click(w, '[data-act="grp-new"]'); await tick(20);
  $(w, '.grp-dlg input').value = '   '; click(w, '.grp-dlg [data-d="ok"]');
  assert.ok($(w, '.grp-dlg'), 'dialog stays open on invalid name');
  assert.match($(w, '#grpErr').textContent, /নাম|name/i);
  $(w, '.grp-dlg input').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick(20); assert.equal($(w, '.grp-dlg'), null, 'Escape closes the dialog');
  assert.equal(cardNames(w).length, 0);

  click(w, '[data-act="grp-new"]'); await tick(20); await dialogType(w, 'Temp');
  const gid = w.__app.grpApi.state().groups[0].id;
  await w.__app.grpApi.setItems([w.__app.state.projectId || (await w.__app.localList())[0].id], gid);
  await openLib(w);
  click(w, '[data-act="grp-rename"]'); await tick(20); await dialogType(w, 'Renamed');
  assert.deepEqual(cardNames(w), ['Renamed']);
  assert.deepEqual(names(w), [], 'project is inside the group, not on the root list');
  click(w, '[data-act="grp-del"]'); await tick(20);
  assert.match($(w, '.grp-dlg-body').textContent, /মুছবে না|not deleted/);
  click(w, '.grp-dlg [data-d="ok"]'); await tick(80);
  assert.equal(cardNames(w).length, 0);
  assert.deepEqual(names(w), ['Alpha'], 'project survives group deletion and returns to the root');
  assert.equal((await w.__app.localList()).length, 1);
});

test('device tab: move dialog disables the current spot, the group itself and its descendants', async () => {
  const w = await bootApp(); const g = w.__app.grpApi; await g.load();
  const a = await g.create('A'), b = await g.create('B', a.id), c = await g.create('C');
  await addProject(w, 'Alpha'); await openLib(w);
  click(w, `.grp-card[data-gid="${a.id}"] [data-act="grp-move"]`); await tick(20);
  const dis = id => $(w, `.grp-dlg .grp-pk[data-gid="${id}"]`).disabled;
  assert.equal(dis(''), true, 'already at root');
  assert.equal(dis(a.id), true); assert.equal(dis(b.id), true, 'own descendant');
  assert.equal(dis(c.id), false);
  await pickAndConfirm(w, c.id);
  assert.deepEqual(Array.from(g.path(a.id), x => x.name), ['C', 'A']);
  assert.deepEqual(cardNames(w), ['C']);
});

test('device tab: keyboard (Enter) opens a group card; collapsed tree branches hide children', async () => {
  const w = await bootApp(); const g = w.__app.grpApi; await g.load();
  const a = await g.create('A'); await g.create('B', a.id);
  await addProject(w, 'Alpha'); await openLib(w);
  const card = $(w, '.grp-card');
  card.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(60);
  assert.deepEqual(crumbs(w), ['Library', 'A']);
  assert.equal($$(w, '.grp-tl').length, 3);
  click(w, '.grp-tog'); await tick(40);
  assert.equal($$(w, '.grp-tl').length, 2, 'collapsing A hides B in the tree');
});

test('device tab: phone "Tree" opens a full-screen page (not inline); tapping a group goes there and closes it', async () => {
  const w = await bootApp(); const g = w.__app.grpApi; await g.load();
  const a = await g.create('A'); await g.create('B', a.id);
  await addProject(w, 'Alpha'); await openLib(w);
  assert.ok($(w, '.grp-tree-btn'));
  const listBefore = $(w, '.grp-main').innerHTML;
  click(w, '.grp-tree-btn'); await tick(40);
  const page = $(w, '.grp-dlg-bg.full'); assert.ok(page, 'tree opens as its own page');
  assert.equal($(w, '.grp-dlg-bg.full [data-d="ok"]'), null, 'no OK button: one tap navigates');
  assert.equal($(w, '.grp-grid').classList.contains('tree-open'), false, 'nothing expands inline under the list');
  assert.equal($(w, '.grp-main').innerHTML, listBefore, 'the list underneath is not pushed or changed');
  const rowNames = $$(w, '.grp-dlg-bg.full .grp-pk').map(e => e.querySelector('.nm').textContent);
  assert.equal(rowNames.length, 3); assert.deepEqual(rowNames.slice(1), ['A', 'B']);
  $$(w, '.grp-dlg-bg.full .grp-pk').find(e => /^B/.test(e.textContent.trim())).click(); await tick(80);
  assert.equal($(w, '.grp-dlg-bg'), null, 'page closes after the tap');
  assert.deepEqual(crumbs(w), ['Library', 'A', 'B']);
  // Close button leaves everything as it was
  click(w, '.grp-tree-btn'); await tick(40); click(w, '.grp-dlg-bg.full [data-d="x"]'); await tick(40);
  assert.equal($(w, '.grp-dlg-bg'), null); assert.deepEqual(crumbs(w), ['Library', 'A', 'B']);
});

// ── Google Drive tab ──
async function driveSetup() {
  const w = await bootApp({ drive: true });
  const drive = installFakeDrive(w); const a = w.__app;
  a.gdrive.token = 'tok'; a.gdrive.exp = Date.now() + 3600e3;
  addPages(w, ['one', 'two'], 'Chem.pdf'); await a.syncToDrive(); await tick(50);   // project now exists locally AND on Drive
  return { w, a, drive };
}

test('drive tab: same group UI; navigating groups does not re-fetch the Drive list', async () => {
  const { w, a, drive } = await driveSetup();
  await openLib(w, 'drive'); await tick(80);
  assert.deepEqual(names(w), ['Chem']);
  click(w, '[data-act="grp-new"]'); await tick(20); await dialogType(w, 'Labs');
  assert.deepEqual(cardNames(w), ['Labs']);
  const key = 'd:' + drive.folders()[0].id;
  $(w, '[data-act="grp-move-item"]').click(); await tick(20);
  await pickAndConfirm(w, a.grpApi.state().groups[0].id);
  assert.deepEqual(names(w), []);
  const before = drive.state.calls.length;
  click(w, '.grp-card'); await tick(80);
  assert.deepEqual(names(w), ['Chem']);
  assert.deepEqual(crumbs(w), ['Library', 'Labs']);
  assert.equal(drive.state.calls.length, before, 'group navigation used the cached Drive list (no network)');
  assert.ok(a.grpApi.state().assign[key], 'Drive item keyed by folder id');
});

test('drive + device share one grouping: moving a synced project in either tab moves it in both', async () => {
  const { w, a } = await driveSetup();
  const g = a.grpApi; await g.load();
  const grp = await g.create('Shared');
  await openLib(w, 'drive'); await tick(80);
  $(w, '[data-act="grp-move-item"]').click(); await tick(20); await pickAndConfirm(w, grp.id);
  await openLib(w, 'local'); await tick(80);
  const projName = names(w);                                   // local list: project is inside "Shared" → not at root
  assert.ok(!projName.includes('Chem'));
  click(w, '.grp-card'); await tick(60);
  assert.deepEqual(names(w), ['Chem']);
});
