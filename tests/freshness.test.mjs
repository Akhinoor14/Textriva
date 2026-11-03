import test from 'node:test';
import assert from 'node:assert/strict';
import { getModuleSource, extractDeclaration } from './_extract.mjs';

const source = getModuleSource();

test('REMOTE_TTL is 11 hours (server expiry is 12h)', () => {
  const decl = extractDeclaration(source, 'REMOTE_TTL');
  assert.match(decl, /7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
});

test('isFresh: true for a page uploaded moments ago', () => {
  const ttlDecl = extractDeclaration(source, 'REMOTE_TTL');
  const freshDecl = extractDeclaration(source, 'isFresh');
  const fn = new Function(`${ttlDecl}\n${freshDecl}\nreturn isFresh;`)();
  const pg = { remoteUrl: 'https://i.ibb.co/x.jpg', remoteAt: Date.now() - 1000 };
  assert.equal(fn(pg), true);
});

test('isFresh: false once past REMOTE_TTL', () => {
  const ttlDecl = extractDeclaration(source, 'REMOTE_TTL');
  const freshDecl = extractDeclaration(source, 'isFresh');
  const fn = new Function(`${ttlDecl}\n${freshDecl}\nreturn isFresh;`)();
  const pg = { remoteUrl: 'https://i.ibb.co/x.jpg', remoteAt: Date.now() - 8 * 24 * 60 * 60 * 1000 };
  assert.equal(fn(pg), false);
});

test('isFresh: false with no remoteUrl at all', () => {
  const ttlDecl = extractDeclaration(source, 'REMOTE_TTL');
  const freshDecl = extractDeclaration(source, 'isFresh');
  const fn = new Function(`${ttlDecl}\n${freshDecl}\nreturn isFresh;`)();
  assert.equal(fn({ remoteUrl: '', remoteAt: 0 }), false);
});
