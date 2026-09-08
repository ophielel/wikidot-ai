import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig, redactConfig } from '../src/config';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'wikidot-ai-config-'));
}

test('defaults are safe', () => {
  const config = loadConfig({ home: tempDir(), cwd: tempDir(), env: {} });
  assert.equal(config.mode, 'confirm');
  assert.equal(config.domain, 'wikidot.com');
  assert.equal(config.username, null);
  assert.equal(config.auditLog, true);
  assert.equal(config.allowedSites, null);
  assert.equal(config.llm.baseUrl, 'https://api.openai.com/v1');
  assert.equal(config.llm.apiKey, null);
  assert.equal(config.llm.model, null);
});

test('config files merge with cwd taking precedence over home', () => {
  const home = tempDir();
  const cwd = tempDir();
  writeFileSync(
    join(home, '.wikidot-ai.json'),
    JSON.stringify({ defaultSite: 'scp-wiki', mode: 'readonly', username: 'home-user' })
  );
  writeFileSync(
    join(cwd, '.wikidot-ai.json'),
    JSON.stringify({ defaultSite: 'scp-jp', username: 'cwd-user' })
  );

  const config = loadConfig({ home, cwd, env: {} });
  assert.equal(config.defaultSite, 'scp-jp');
  assert.equal(config.mode, 'readonly');
  assert.equal(config.username, 'cwd-user');
  assert.equal(config.sources.length, 2);

  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

test('environment variables override files and feed the LLM section', () => {
  const home = tempDir();
  const cwd = tempDir();
  writeFileSync(
    join(home, '.wikidot-ai.json'),
    JSON.stringify({ mode: 'readonly', llm: { model: 'file-model' } })
  );

  const config = loadConfig({
    home,
    cwd,
    env: {
      WIKIDOT_USERNAME: 'env-user',
      WIKIDOT_PASSWORD: 'env-pass',
      WIKIDOT_DEFAULT_SITE: 'scp-de',
      WIKIDOT_AI_MODE: 'auto',
      WIKIDOT_AI_LLM_MODEL: 'env-model',
      WIKIDOT_AI_LLM_API_KEY: 'env-key',
      WIKIDOT_AI_LLM_BASE_URL: 'https://example.test/v1',
      WIKIDOT_AI_LLM_TEMPERATURE: '0.7',
      WIKIDOT_AI_ALLOWED_SITES: 'scp-wiki, scp-jp',
    },
  });

  assert.equal(config.username, 'env-user');
  assert.equal(config.password, 'env-pass');
  assert.equal(config.defaultSite, 'scp-de');
  assert.equal(config.mode, 'auto');
  assert.equal(config.llm.model, 'env-model');
  assert.equal(config.llm.apiKey, 'env-key');
  assert.equal(config.llm.baseUrl, 'https://example.test/v1');
  assert.equal(config.llm.temperature, 0.7);
  assert.deepEqual(config.allowedSites, ['scp-wiki', 'scp-jp']);
  assert.ok(config.sources.includes('environment'));

  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

test('OPENAI_* env vars are a fallback for the LLM section', () => {
  const config = loadConfig({
    home: tempDir(),
    cwd: tempDir(),
    env: {
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-x',
      OPENAI_BASE_URL: 'http://localhost/v1',
    },
  });
  assert.equal(config.llm.apiKey, 'sk-test');
  assert.equal(config.llm.model, 'gpt-x');
  assert.equal(config.llm.baseUrl, 'http://localhost/v1');
});

test('an unknown mode is rejected', () => {
  assert.throws(() =>
    loadConfig({ home: tempDir(), cwd: tempDir(), env: { WIKIDOT_AI_MODE: 'yolo-mode' } })
  );
});

test('redactConfig hides both secrets', () => {
  const config = loadConfig({
    home: tempDir(),
    cwd: tempDir(),
    env: { WIKIDOT_PASSWORD: 'secret', WIKIDOT_AI_LLM_API_KEY: 'sk-secret' },
  });
  const redacted = redactConfig(config);
  assert.equal(redacted.password, '***');
  assert.deepEqual(redacted.llm, {
    baseUrl: 'https://api.openai.com/v1',
    model: null,
    apiKey: '***',
    temperature: 0.2,
  });
  assert.ok(!JSON.stringify(redacted).includes('secret'));
});
