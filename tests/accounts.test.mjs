// Multi-user safety, persisted sign-in state in the top bar, and the welcome card for guests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp as boot, addPages } from './_app.mjs';

// fake-indexeddb is shared by every boot in this process → empty the Library before each test
async function bootApp(opts) {
  const w = await boot(opts);
  for (const p of await w.__app.localListAll()) await w.__app.dbDeleteProject(p.id);
  return w;
}

const A = { sub: 'sub-A', email: 'a@example.com', name: 'Alice Doe', given_name: 'Alice', picture: '' };
const B = { sub: 'sub-B', email: 'b@example.com', name: 'Bob Roe', given_name: 'Bob', picture: '' };
const login = (w, u) => w.localStorage.setItem(w.__app.LS_USER, JSON.stringify(u));

test('top bar shows the remembered account after a reload, and "Sign in" for guests', async () => {
  const w = await bootApp({ drive: true });
  const lab = w.document.getElementById('acctLabel'), btn = w.document.getElementById('acctBtn');
  w.__app.refreshAcctUi();
  assert.equal(lab.textContent, 'Sign in'); assert.equal(btn.dataset.state, 'out');
  login(w, A); w.__app.refreshAcctUi();
  assert.equal(lab.textContent, 'Alice');
  assert.equal(btn.dataset.state, 'stale', 'account known but Drive token expired → reconnect hint');
  assert.ok(btn.title.includes('a@example.com'));
  w.close();
});

test('another account on the same device never sees my projects', async () => {
  const w = await bootApp({ drive: true }); const X = w.__app;
  login(w, A);
  addPages(w, ['one', 'two'], 'alice-book.pdf'); X.state.proj.owner = 'sub-A';
  await X.saveNow();
  assert.equal((await X.localList()).length, 1);
  // Bob signs in on the same browser
  login(w, B); await X.handleOwnerSwitch('sub-A', 'sub-B');
  assert.equal((await X.localList()).length, 0, 'Bob sees nothing of Alice');
  assert.equal(X.state.pages.length, 0, 'screen cleared');
  assert.equal(X.state.projectId, null);
  assert.equal((await X.localListAll()).length, 1, 'Alice\'s data is kept, just hidden');
  login(w, A); await X.handleOwnerSwitch('sub-B', 'sub-A');
  assert.equal((await X.localList()).length, 1, 'Alice gets it back');
  w.close();
});

test('work started as a guest follows the person into their account on sign-in', async () => {
  const w = await bootApp({ drive: true }); const X = w.__app;
  addPages(w, ['x'], 'guest.pdf'); X.state.proj.owner = '';
  await X.saveNow();
  assert.equal((await X.localList()).length, 1);
  login(w, A); await X.handleOwnerSwitch('', 'sub-A');
  assert.equal(X.state.pages.length, 1, 'current work stays on screen');
  assert.equal(X.state.proj.owner, 'sub-A');
  assert.equal((await X.localList()).length, 1);
  w.close();
});

test('older guest projects are only moved when the user asks', async () => {
  const w = await bootApp({ drive: true }); const X = w.__app;
  addPages(w, ['g'], 'old.pdf'); X.state.proj.owner = ''; await X.saveNow(); X.resetWorkspaceState();
  login(w, A);
  assert.equal((await X.localList()).length, 0, 'not auto-merged');
  assert.equal(await X.claimGuestProjects(), 1);
  assert.equal((await X.localList()).length, 1);
  w.close();
});

test('sign out saves, clears the screen, and hides that account\'s projects', async () => {
  const w = await bootApp({ drive: true }); const X = w.__app;
  login(w, A);
  addPages(w, ['a', 'b'], 'mine.pdf'); X.state.proj.owner = 'sub-A';
  await X.gSignOut();
  assert.equal(X.storedUser(), null);
  assert.equal(X.state.pages.length, 0);
  assert.equal((await X.localList()).length, 0, 'guest view is empty');
  assert.equal((await X.localListAll()).length, 1, 'work was saved before sign out');
  assert.equal(w.document.getElementById('acctLabel').textContent, 'Sign in');
  w.close();
});

test('welcome card: shown to guests, skippable, and not repeated straight away', async () => {
  const w = await bootApp({ drive: true, welcome: true }); const X = w.__app;
  assert.equal(X.shouldShowWelcome(), true);
  X.openWelcome();
  const dlg = w.document.getElementById('welcomeDlg');
  assert.ok(dlg); assert.equal(dlg.getAttribute('role'), 'dialog');
  assert.equal(dlg.querySelectorAll('.wl-list li').length, 4);
  assert.ok(dlg.querySelector('[data-wl="signin"]') && dlg.querySelector('[data-wl="skip"]'));
  dlg.querySelector('[data-wl="skip"]').click();
  assert.equal(w.document.getElementById('welcomeDlg'), null);
  assert.equal(X.shouldShowWelcome(), false, 'cooldown after skipping');
  w.close();
});

test('welcome card never shows to a signed-in user or when Drive is not configured', async () => {
  const w = await bootApp({ drive: true, welcome: true }); login(w, A);
  assert.equal(w.__app.shouldShowWelcome(), false); w.close();
  const w2 = await bootApp({ welcome: true });
  assert.equal(w2.__app.shouldShowWelcome(), false); w2.close();
});
