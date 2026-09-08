import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentConfig } from '../src/config';
import { WikidotAgentError } from '../src/errors';
import { ensureWriteAllowed, isSiteAllowed } from '../src/policy';

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    username: null,
    password: null,
    domain: 'wikidot.com',
    defaultSite: null,
    mode: 'confirm',
    auditLog: false,
    auditPath: '/tmp/audit.jsonl',
    allowedSites: null,
    maxIterations: 30,
    llm: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: null,
      model: null,
      temperature: 0.2,
      maxTokens: null,
    },
    sources: [],
    ...overrides,
  };
}

const intent = { action: 'create page', site: 'scp-wiki', target: 'test-page', preview: 'body' };

test('readonly mode blocks every write', async () => {
  await assert.rejects(
    ensureWriteAllowed(config({ mode: 'readonly' }), intent, { hasUI: true }),
    (error: unknown) => error instanceof WikidotAgentError && error.code === 'write_blocked'
  );
});

test('allowedSites restricts writes to the listed sites', async () => {
  const cfg = config({ mode: 'auto', allowedSites: ['scp-jp'] });
  assert.equal(isSiteAllowed(cfg, 'scp-jp'), true);
  assert.equal(isSiteAllowed(cfg, 'scp-wiki'), false);
  await assert.rejects(
    ensureWriteAllowed(cfg, intent, { hasUI: false }),
    (error: unknown) => error instanceof WikidotAgentError && error.code === 'site_not_allowed'
  );
});

test('auto mode proceeds without any UI', async () => {
  await ensureWriteAllowed(config({ mode: 'auto' }), intent, { hasUI: false });
});

test('confirm mode asks the UI and honours approval', async () => {
  let asked = false;
  await ensureWriteAllowed(config({ mode: 'confirm' }), intent, {
    hasUI: true,
    ui: {
      confirm: async () => {
        asked = true;
        return true;
      },
    },
  });
  assert.equal(asked, true);
});

test('confirm mode refuses when the user declines', async () => {
  await assert.rejects(
    ensureWriteAllowed(config({ mode: 'confirm' }), intent, {
      hasUI: true,
      ui: { confirm: async () => false },
    }),
    (error: unknown) => error instanceof WikidotAgentError && error.code === 'user_declined'
  );
});

test('confirm mode refuses unattended sessions', async () => {
  await assert.rejects(
    ensureWriteAllowed(config({ mode: 'confirm' }), intent, { hasUI: false }),
    (error: unknown) => error instanceof WikidotAgentError && error.code === 'no_ui'
  );
});
