// Phase 1 unit tests: the pure, DOM-free duplicate-detection helpers
// (normaliseTextForCompare, wordNGrams, charBigrams, textSimilarity [Dice on char bigrams], hammingDistanceHex).
// hashBlobSHA256/computePHash are not unit-tested here since they need
// crypto.subtle + canvas/createImageBitmap, which is an integration concern
// (manual test checklist covers it) rather than a pure-function one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getModuleSource, extractDeclaration } from './_extract.mjs';

const source = getModuleSource();

function loadSimilarityFns() {
  const decls = [
    'normaliseTextForCompare',
    'wordNGrams',
    'charBigrams',
    'textSimilarity',
    'hammingDistanceHex',
  ].map(name => extractDeclaration(source, name)).join('\n');
  return new Function(`${decls}\nreturn { normaliseTextForCompare, wordNGrams, textSimilarity, hammingDistanceHex };`)();
}

const { normaliseTextForCompare, wordNGrams, textSimilarity, hammingDistanceHex } = loadSimilarityFns();

test('TEXT_SIMILARITY_THRESHOLD is 0.90', () => {
  const decl = extractDeclaration(source, 'TEXT_SIMILARITY_THRESHOLD');
  assert.match(decl, /0\.90|0\.9\b/);
});

test('PHASH_HAMMING_THRESHOLD is 5', () => {
  const decl = extractDeclaration(source, 'PHASH_HAMMING_THRESHOLD');
  assert.match(decl, /=\s*5\s*;/);
});

test('normaliseTextForCompare: lowercases, strips punctuation, collapses whitespace', () => {
  assert.equal(normaliseTextForCompare('Hello,   World!!'), 'hello world');
  assert.equal(normaliseTextForCompare('  multiple   spaces  '), 'multiple spaces');
});

test('normaliseTextForCompare: strips Bangla danda/double-danda, keeps Bangla letters intact', () => {
  const input = 'আমি ভাত খাই। সে বাজারে যায়।।';
  const out = normaliseTextForCompare(input);
  assert.equal(out.includes('।'), false);
  assert.match(out, /আমি ভাত খাই/);
  assert.match(out, /সে বাজারে যায়/);
});

test('wordNGrams: builds word 3-grams', () => {
  const grams = wordNGrams('the quick brown fox jumps');
  assert.ok(grams.has('the quick brown'));
  assert.ok(grams.has('quick brown fox'));
  assert.ok(grams.has('brown fox jumps'));
  assert.equal(grams.size, 3);
});

test('wordNGrams: short text (fewer than n words) still produces something comparable', () => {
  const grams = wordNGrams('hello world');
  assert.equal(grams.size, 1);
  assert.ok(grams.has('hello world'));
});

test('textSimilarity: identical text -> 1.0', () => {
  const text = 'This is a page of OCR text with several words in it for testing.';
  assert.equal(textSimilarity(text, text), 1);
});

test('textSimilarity: identical Bangla text -> 1.0', () => {
  const text = 'বাংলাদেশ একটি দক্ষিণ এশীয় রাষ্ট্র। এর রাজধানী ঢাকা।';
  assert.equal(textSimilarity(text, text), 1);
});

test('textSimilarity: slightly edited text (one word changed out of many) stays above threshold', () => {
  // Realistic page-length OCR text with a single word typo-corrected — the
  // scenario Phase 1 targets ("same page scanned/OCR'd twice, near-identical").
  const a = 'বাংলাদেশ একটি দক্ষিণ এশীয় রাষ্ট্র। এর রাজধানী ঢাকা। জনসংখ্যা প্রায় সতেরো কোটি। প্রধান ভাষা বাংলা। দেশের প্রধান নদী পদ্মা মেঘনা ও যমুনা। কৃষি অর্থনীতির একটি বড় অংশ।';
  const b = 'বাংলাদেশ একটি দক্ষিণ এশীয় রাষ্ট্র। এর রাজধানী ঢাকা। জনসংখ্যা প্রায় আঠারো কোটি। প্রধান ভাষা বাংলা। দেশের প্রধান নদী পদ্মা মেঘনা ও যমুনা। কৃষি অর্থনীতির একটি বড় অংশ।';
  const sim = textSimilarity(a, b);
  assert.ok(sim >= 0.90, `expected >= 0.90, got ${sim}`);
});

test('textSimilarity: a short line with one word changed can legitimately fall below threshold', () => {
  // Documents the flip side: on very short text, a single word change moves
  // the Dice score a lot (there are few bigrams to begin with). This is
  // expected behaviour, not a bug — short pastes need the lastClip check too.
  const a = 'এর রাজধানী ঢাকা শহর।';
  const b = 'এর রাজধানী চট্টগ্রাম শহর।';
  const sim = textSimilarity(a, b);
  assert.ok(sim < 0.90, `expected < 0.90 for a short, meaningfully different line, got ${sim}`);
});

test('textSimilarity: completely different text stays well below threshold', () => {
  const a = 'বাংলাদেশ একটি দক্ষিণ এশীয় রাষ্ট্র। এর রাজধানী ঢাকা।';
  const b = 'আজকের আবহাওয়া খুব ভালো, সূর্য উজ্জ্বল এবং বাতাস মৃদু বইছে।';
  const sim = textSimilarity(a, b);
  assert.ok(sim < 0.90, `expected < 0.90, got ${sim}`);
});

test('textSimilarity: English near-duplicate (reworded) stays below threshold (genuinely different wording)', () => {
  const a = 'The quick brown fox jumps over the lazy dog near the river.';
  const b = 'A fast brown fox leaps above a sleepy dog by the stream.';
  const sim = textSimilarity(a, b);
  assert.ok(sim < 0.90, `expected < 0.90, got ${sim}`);
});

test('textSimilarity: one empty, one non-empty -> 0', () => {
  assert.equal(textSimilarity('', 'some text here'), 0);
  assert.equal(textSimilarity('some text here', ''), 0);
});

test('textSimilarity: both empty -> 1 (no text vs no text is not a mismatch)', () => {
  assert.equal(textSimilarity('', ''), 1);
});

test('hammingDistanceHex: identical hashes -> 0', () => {
  assert.equal(hammingDistanceHex('a3f29c1b', 'a3f29c1b'), 0);
});

test('hammingDistanceHex: one bit different', () => {
  // 'a' = 1010, 'b' = 1011 -> differ in last bit only
  assert.equal(hammingDistanceHex('a', 'b'), 1);
});

test('hammingDistanceHex: mismatched lengths -> Infinity (never a false match)', () => {
  assert.equal(hammingDistanceHex('abcd', 'abc'), Infinity);
});

test('hammingDistanceHex: within PHASH_HAMMING_THRESHOLD counts as a near-duplicate', () => {
  const threshold = Number(extractDeclaration(source, 'PHASH_HAMMING_THRESHOLD').match(/=\s*(\d+)/)[1]);
  // 'ffffffff' vs '7fffffff' differs only in the top bit of the first hex digit (f=1111 vs 7=0111) -> distance 1
  const dist = hammingDistanceHex('ffffffff', '7fffffff');
  assert.ok(dist <= threshold, `expected <= ${threshold}, got ${dist}`);
});
