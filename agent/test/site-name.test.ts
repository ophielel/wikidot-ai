import assert from 'node:assert/strict';
import test from 'node:test';
import { looksLikeUrl, normalizeSiteName } from '../src/site-name';

test('normalizeSiteName accepts a plain UNIX name', () => {
  assert.equal(normalizeSiteName('scp-wiki'), 'scp-wiki');
  assert.equal(normalizeSiteName('  SCP-JP  '), 'scp-jp');
});

test('normalizeSiteName strips a wikidot.com host', () => {
  assert.equal(normalizeSiteName('scp-wiki.wikidot.com'), 'scp-wiki');
  assert.equal(normalizeSiteName('www.scp-wiki.wikidot.com'), 'scp-wiki');
});

test('normalizeSiteName strips a full URL, path and port', () => {
  assert.equal(normalizeSiteName('https://scp-wiki.wikidot.com/'), 'scp-wiki');
  assert.equal(normalizeSiteName('http://scp-wiki.wikidot.com:8080/forum/t-1'), 'scp-wiki');
  assert.equal(normalizeSiteName('https://user@scp-wiki.wikidot.com/'), 'scp-wiki');
});

test('normalizeSiteName leaves a custom domain alone', () => {
  assert.equal(normalizeSiteName('example.org'), 'example.org');
});

test('looksLikeUrl distinguishes URLs from UNIX names', () => {
  assert.equal(looksLikeUrl('https://scp-wiki.wikidot.com/'), true);
  assert.equal(looksLikeUrl('scp-wiki.wikidot.com'), true);
  assert.equal(looksLikeUrl('scp-wiki'), false);
});
