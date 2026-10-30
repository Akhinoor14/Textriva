// Confirms Phase 1 additions are actually wired into the app, and that the
// pre-existing lastClip check (global rule #3: never break working features)
// is still present and runs before the new similarity check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getModuleSource } from './_extract.mjs';

const source = getModuleSource();

test('lastClip consecutive-duplicate check is still present', () => {
  assert.match(source, /clip === state\.lastClip/);
});

test('runWorkflowStep checks text similarity against saved pages before pasting', () => {
  const idx = source.indexOf('function runWorkflowStep');
  assert.ok(idx !== -1, 'runWorkflowStep not found');
  const body = source.slice(idx, idx + 3000);
  assert.match(body, /findSimilarSavedPage/);
  // lastClip check must come before the similarity check (cheap check first)
  const lastClipPos = body.indexOf('state.lastClip');
  const simPos = body.indexOf('findSimilarSavedPage');
  assert.ok(lastClipPos < simPos, 'lastClip check should run before the similarity check');
});

test('addPage computes page hashes in the background (hash + phash fields exist)', () => {
  const idx = source.indexOf('async function addPage');
  assert.ok(idx !== -1);
  const body = source.slice(idx, idx + 600);
  assert.match(body, /hash:\s*null/);
  assert.match(body, /phash:\s*null/);
  assert.match(body, /computePageHashes/);
});

test('saveNow persists hash/phash/possibleDupOf for later duplicate checks', () => {
  const idx = source.indexOf('function saveNow');
  const body = source.slice(idx, idx + 2800);
  assert.match(body, /hash:\s*p\.hash/);
  assert.match(body, /phash:\s*p\.phash/);
  assert.match(body, /firstPageHash/);
});

test('Auto Step button gets a visible "waiting for new copy" state', () => {
  assert.match(source, /setWaitingForNewCopy/);
  assert.match(source, /waiting-copy/);
});

test('textSimilarity uses character-bigram Dice (not word 3-gram Jaccard)', () => {
  assert.match(source, /function charBigrams/);
  const i = source.indexOf('function textSimilarity');
  const body = source.slice(i, i + 800);
  assert.match(body, /charBigrams/);
  assert.doesNotMatch(body, /wordNGrams/);
});

test('toast() supports an optional action button; cross-project duplicate banner has an Open action', () => {
  const t = source.slice(source.indexOf('function toast('), source.indexOf('function toast(') + 900);
  assert.match(t, /action/);
  assert.match(t, /toast-action/);
  const d = source.slice(source.indexOf('async function checkExactDuplicate'), source.indexOf('function checkNearDuplicates'));
  assert.match(d, /openLocalProject\(otherId\)/);
});

test('near-duplicate compare dialog exists with Keep both / Remove options, opened from badge and toast', () => {
  assert.match(source, /function openDupCompare/);
  assert.match(source, /data-dc="keep"/);
  assert.match(source, /data-dc="rm-a"/);
  assert.match(source, /data-dc="rm-b"/);
  assert.match(source, /classList\.contains\('possible-dup'\)/);
  const n = source.slice(source.indexOf('function checkNearDuplicates'), source.indexOf('function openDupCompare'));
  assert.match(n, /openDupCompare\(pg\)/);
});

test('Library duplicate button is honestly labelled as removal (it deletes, it does not merge)', () => {
  assert.match(source, /Remove duplicate/);
  assert.doesNotMatch(source, /\$\{L\('Merge', 'Merge'\)\}<\/button>`\s*:/);
});
