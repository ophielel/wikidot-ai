import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Interface } from 'node:readline/promises';
import test from 'node:test';
import { runSetup } from '../src/setup';

/** Minimal readline stand-in: returns the scripted answers in order. */
function fakeRl(answers: string[]): Interface {
  const queue = [...answers];
  return {
    question: async () => queue.shift() ?? '',
  } as unknown as Interface;
}

test('setup writes a complete config file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wikidot-ai-setup-'));
  const path = join(dir, 'config.json');

  await runSetup(
    fakeRl([
      'alice', // username
      'hunter2', // password
      'scp-wiki', // default site
      'auto', // mode
      'scp-wiki, scp-jp', // allowed sites
      'https://api.deepseek.com/v1', // base url
      'sk-llm', // api key
      'deepseek-chat', // model
      '0.3', // temperature
    ]),
    path
  );

  const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  assert.equal(config.username, 'alice');
  assert.equal(config.password, 'hunter2');
  assert.equal(config.defaultSite, 'scp-wiki');
  assert.equal(config.mode, 'auto');
  assert.deepEqual(config.allowedSites, ['scp-wiki', 'scp-jp']);
  assert.deepEqual(config.llm, {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-llm',
    model: 'deepseek-chat',
    temperature: 0.3,
  });

  if (process.platform !== 'win32') {
    assert.equal(statSync(path).mode & 0o777, 0o600);
  }

  rmSync(dir, { recursive: true, force: true });
});

test('setup keeps existing values when answers are empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wikidot-ai-setup-'));
  const path = join(dir, 'config.json');

  await runSetup(
    fakeRl([
      'alice',
      'hunter2',
      'scp-wiki',
      'confirm',
      '',
      'https://api.openai.com/v1',
      'sk-1',
      'gpt-4o-mini',
      '0.2',
    ]),
    path
  );

  await runSetup(fakeRl(['', '', '', '', '', '', '', '', '']), path);

  const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  assert.equal(config.username, 'alice');
  assert.equal(config.password, 'hunter2');
  assert.equal(config.defaultSite, 'scp-wiki');
  assert.equal(config.mode, 'confirm');
  assert.equal((config.llm as { model: string }).model, 'gpt-4o-mini');

  rmSync(dir, { recursive: true, force: true });
});

test('setup re-prompts on an invalid mode', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wikidot-ai-setup-'));
  const path = join(dir, 'config.json');

  await runSetup(
    fakeRl([
      'bob',
      'pw',
      'scp-jp',
      'nonsense', // rejected
      'auto', // accepted
      '',
      'https://api.openai.com/v1',
      'sk',
      'm',
      '0.2',
    ]),
    path
  );

  const config = JSON.parse(readFileSync(path, 'utf8')) as { mode: string };
  assert.equal(config.mode, 'auto');

  rmSync(dir, { recursive: true, force: true });
});
