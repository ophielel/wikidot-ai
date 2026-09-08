import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentConfig } from '../src/config';
import type { WriteResult } from '../src/ops';
import type { WikidotSession } from '../src/session';
import { readTool, writeTool } from '../src/tools/build';
import type { ToolContext } from '../src/tools/types';

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    username: null,
    password: null,
    domain: 'wikidot.com',
    defaultSite: null,
    mode: 'auto',
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

function context(mode: AgentConfig['mode'] = 'auto', dryRun = false): ToolContext {
  const session = {
    config: config({ mode }),
    requireLoginClient: async () => ({}),
  } as unknown as WikidotSession;
  return {
    session,
    policy: { hasUI: false },
    dryRun,
    log: () => undefined,
  };
}

const result: WriteResult = {
  action: 'create page',
  site: 'scp-wiki',
  target: 'test-page',
  url: 'https://scp-wiki.wikidot.com/test-page',
  dryRun: false,
  message: 'Created page "test-page".',
};

function tool(execute: () => Promise<WriteResult>) {
  return writeTool({
    name: 'test_write',
    description: 'test',
    parameters: { type: 'object', properties: {} },
    async prepare() {
      return {
        intent: {
          action: 'create page',
          site: 'scp-wiki',
          target: 'test-page',
          preview: 'PREVIEW BODY',
        },
        preview: 'PREVIEW BODY',
        auditDetail: 'body',
        execute,
      };
    },
  });
}

test('write tools are marked as writes', () => {
  assert.equal(tool(async () => result).write, true);
  assert.equal(
    readTool({
      name: 'r',
      description: 'r',
      parameters: { type: 'object', properties: {} },
      run: async () => ({ content: 'ok' }),
    }).write,
    false
  );
});

test('dryRun returns the preview and never executes', async () => {
  let executed = false;
  const output = await tool(async () => {
    executed = true;
    return result;
  }).execute({ dryRun: true }, context());
  assert.equal(executed, false);
  assert.match(output.content, /\[DRY RUN\]/);
  assert.match(output.content, /PREVIEW BODY/);
});

test('global dry-run also prevents execution', async () => {
  let executed = false;
  const output = await tool(async () => {
    executed = true;
    return result;
  }).execute({}, context('auto', true));
  assert.equal(executed, false);
  assert.match(output.content, /\[DRY RUN\]/);
});

test('dryRun works without a logged-in account', async () => {
  const session = { config: config() } as unknown as WikidotSession; // no requireLoginClient at all
  const output = await tool(async () => result).execute(
    { dryRun: true },
    { session, policy: { hasUI: false }, dryRun: false, log: () => undefined }
  );
  assert.match(output.content, /\[DRY RUN\]/);
});

test('real writes require a logged-in account', async () => {
  const session = {
    config: config(),
    requireLoginClient: async () => {
      throw new Error('not logged in');
    },
  } as unknown as WikidotSession;
  await assert.rejects(
    tool(async () => result).execute(
      {},
      { session, policy: { hasUI: false }, dryRun: false, log: () => undefined }
    ),
    /not logged in/
  );
});

test('auto mode executes and formats the result', async () => {
  const output = await tool(async () => result).execute({}, context('auto'));
  assert.match(output.content, /Created page "test-page"/);
  assert.match(output.content, /https:\/\/scp-wiki\.wikidot\.com\/test-page/);
  assert.deepEqual(output.data, { result });
});

test('readonly mode blocks execution', async () => {
  let executed = false;
  await assert.rejects(
    tool(async () => {
      executed = true;
      return result;
    }).execute({}, context('readonly')),
    /readonly/
  );
  assert.equal(executed, false);
});

test('confirm mode without UI refuses execution', async () => {
  await assert.rejects(tool(async () => result).execute({}, context('confirm')), /no UI/);
});
