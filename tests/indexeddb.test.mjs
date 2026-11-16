// Smoke test for the IndexedDB schema the app relies on (textriva-db:
// projects, pages [index byProject], blobs). Uses fake-indexeddb so it runs
// under plain Node, matching the stores/indexes index.html's idb() creates.
// This is the harness Phase 0 asks for; later phases should extend these
// fixtures as new fields (hash, flags, order, reviewed...) are added.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

function openTextrivaDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('textriva-db', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('pages', { keyPath: 'id' }).createIndex('byProject', 'projectId');
      db.createObjectStore('blobs', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq(r) {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

test('creates projects/pages/blobs stores with byProject index', async () => {
  const db = await openTextrivaDb();
  assert.deepEqual([...db.objectStoreNames].sort(), ['blobs', 'pages', 'projects']);
  const tx = db.transaction('pages', 'readonly');
  const store = tx.objectStore('pages');
  assert.ok(store.indexNames.contains('byProject'));
  db.close();
  indexedDB.deleteDatabase('textriva-db');
});

test('page save/restore round-trip by project', async () => {
  const db = await openTextrivaDb();
  const projectId = 'proj-1';

  {
    const tx = db.transaction(['projects', 'pages'], 'readwrite');
    tx.objectStore('projects').put({ id: projectId, createdAt: Date.now() });
    tx.objectStore('pages').put({ id: 'page-1', projectId, order: 0, text: 'প্রথম পাতা' });
    tx.objectStore('pages').put({ id: 'page-2', projectId, order: 1, text: 'দ্বিতীয় পাতা' });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }

  const tx2 = db.transaction('pages', 'readonly');
  const idx = tx2.objectStore('pages').index('byProject');
  const pages = await idbReq(idx.getAll(projectId));

  assert.equal(pages.length, 2);
  assert.equal(pages.find(p => p.id === 'page-1').text, 'প্রথম পাতা');
  assert.equal(pages.find(p => p.id === 'page-2').text, 'দ্বিতীয় পাতা');

  db.close();
  indexedDB.deleteDatabase('textriva-db');
});

test('Bangla text is preserved exactly through IndexedDB (no normalisation)', async () => {
  const db = await openTextrivaDb();
  const sample = 'বাংলাদেশ একটি দক্ষিণ এশীয় রাষ্ট্র।  সংখ্যা: ১২৩৪৫৬৭৮৯০';

  const tx = db.transaction('pages', 'readwrite');
  tx.objectStore('pages').put({ id: 'p-bn', projectId: 'proj-bn', order: 0, text: sample });
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });

  const tx2 = db.transaction('pages', 'readonly');
  const got = await idbReq(tx2.objectStore('pages').get('p-bn'));
  assert.equal(got.text, sample);

  db.close();
  indexedDB.deleteDatabase('textriva-db');
});
