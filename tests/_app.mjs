// Loads the whole app (index.html) into jsdom + fake-indexeddb so UI flows can be driven for real.
// The pdf.js import is stubbed (it is a remote ES-module import that cannot load under Node).
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { getModuleSource } from './_extract.mjs';

export async function bootApp(opts) {
  opts = opts || {};
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script type="module">[\s\S]*?<\/script>/, '');
  const dom = new JSDOM(html, { url: 'https://textriva.test/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.indexedDB = globalThis.indexedDB; w.IDBKeyRange = globalThis.IDBKeyRange;
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
  w.navigator.storage = { persist: async () => true };
  w.confirm = () => true;
  w.fetch = async () => { throw new Error('no network in tests'); };
  let src = getModuleSource()
    .replace(/^import \* as pdfjs from [^\n]*\n/m, 'const pdfjs = { GlobalWorkerOptions: {} };\n')
    .replace(/const GOOGLE_CLIENT_ID = '[^']*';/, opts.drive ? "const GOOGLE_CLIENT_ID = 'test-client';" : "const GOOGLE_CLIENT_ID = '';")
    // expose internals for the test
    + '\n;window.__app = { state, openTextTools, undoBulk, saveNow, searchLibrary, runLibSearch, renderAll, openLib, localList, openLocalProject, toggleBookmark, gotoPage, applyTextChanges, resetWorkspaceState, newId, movePage, rotatePages, cropPages, splitSpreads, undoPageEdit, movePagesToProject, mergeProjectIntoCurrent, imgIO, setEnhance, lensCopyBlob, syncSig, openPageTools, setPageBlob, localLoad, cutPage, runOcr, ocrIO, pagesForOcr, sanitizeOcr, cleanOcrText, refreshFlags, openOcrDlg, hashStr, undoPage, ocrIsLowConf, gdrive, syncToDrive, openDriveProject, queueDriveSync, refreshDriveChip, planMerge, matchPagesForMerge, applyMerge, openSyncConflict, freeUpSpace, isFreeable, storageMeterHtml, deviceId, mergeProjectIntoCurrent, dbDeleteProject, planPdfPages, stripWindow, renderStrip, consumeSharedFiles, scanName, isOffline, handleFiles, STRIP_VIRT_MIN, PDF_WARN_PAGES };';
  w.eval(src);
  return w;
}
export const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
export function addPages(w, texts, name) {
  const { state, newId } = w.__app;
  state.sourceFileName = name || 'book.pdf';
  state.projectId = newId();
  state.proj = { createdAt: Date.now(), driveFolderId: null, driveMetaId: null, driveTextId: null, driveRev: '', lastSig: '' };
  state.pages.length = 0; state.current = 0;
  texts.forEach((t, i) => {
    const blob = new w.Blob([new Uint8Array([1, 2, 3, i])], { type: 'image/jpeg' });
    state.pages.push({ id: 'pg' + i + Math.random().toString(36).slice(2, 5), name: `page-${i + 1}.jpg`, blob, url: 'blob:x' + i, status: t ? 'done' : 'pending', remoteUrl: '', remoteAt: 0, text: t, flags: [], reviewed: false, blobSaved: false });
  });
}
