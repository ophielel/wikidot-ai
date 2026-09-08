import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeTags, normalizeTags } from '../src/ops';

test('normalizeTags trims, splits and de-duplicates', () => {
  assert.deepEqual(normalizeTags('scp euclid scp'), ['scp', 'euclid']);
  assert.deepEqual(normalizeTags('a, b , a'), ['a', 'b']);
  assert.deepEqual(normalizeTags([' x ', '', 'y']), ['x', 'y']);
});

test('add keeps existing tags and appends the new ones', () => {
  assert.deepEqual(mergeTags(['scp', 'euclid'], ['euclid', 'safe'], 'add'), [
    'scp',
    'euclid',
    'safe',
  ]);
});

test('set replaces the whole tag list', () => {
  assert.deepEqual(mergeTags(['scp', 'euclid'], ['safe', 'keter'], 'set'), ['safe', 'keter']);
});

test('remove drops only the listed tags', () => {
  assert.deepEqual(mergeTags(['scp', 'euclid', 'safe'], ['safe', 'missing'], 'remove'), [
    'scp',
    'euclid',
  ]);
});

test('remove is a no-op when nothing matches', () => {
  assert.deepEqual(mergeTags(['scp'], ['nope'], 'remove'), ['scp']);
});

test('the tag tool is registered', async () => {
  const { createWikidotTools } = await import('../src/tools');
  const names = createWikidotTools().map((tool) => tool.name);
  assert.ok(names.includes('wikidot_set_tags'));
  assert.ok(names.includes('wikidot_comment'));
});
