import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentConfig } from '../src/config';
import { runDoctor } from '../src/doctor';
import type { WikidotSession } from '../src/session';

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

const unusedSession = {} as unknown as WikidotSession;

test('doctor fails when the LLM is not configured', async () => {
  const report = await runDoctor(unusedSession, config());
  assert.equal(report.ok, false);
  assert.match(report.lines.join('\n'), /\[fail\] model/);
});

test('doctor reports a healthy account without posting', async () => {
  const session = {
    account: async () => ({ username: 'alice', userId: 42, displayName: 'Alice' }),
    getSite: async () => ({
      title: 'Test Wiki',
      getBaseUrl: () => 'https://scp-wiki.wikidot.com',
      member: {
        getAll: async () => ({
          isErr: () => false,
          value: [{ user: { name: 'alice' }, joinedAt: new Date('2020-01-02T00:00:00Z') }],
        }),
      },
    }),
  } as unknown as WikidotSession;

  const report = await runDoctor(
    session,
    config({
      username: 'alice',
      defaultSite: 'scp-wiki',
      llm: { ...config().llm, model: 'test-model', apiKey: 'sk' },
    })
  );

  const text = report.lines.join('\n');
  assert.equal(report.ok, true);
  assert.match(text, /\[ok\]\s+login as alice/);
  assert.match(text, /\[ok\]\s+fetch site scp-wiki/);
  assert.match(text, /member since 2020-01-02/);
  assert.match(text, /\[ok\]\s+model - test-model/);
});

test('doctor flags a non-member account', async () => {
  const session = {
    account: async () => ({ username: 'alice', userId: 42, displayName: 'Alice' }),
    getSite: async () => ({
      title: 'Test Wiki',
      getBaseUrl: () => 'https://scp-wiki.wikidot.com',
      member: {
        getAll: async () => ({ isErr: () => false, value: [] }),
      },
    }),
  } as unknown as WikidotSession;

  const report = await runDoctor(
    session,
    config({
      username: 'alice',
      defaultSite: 'scp-wiki',
      llm: { ...config().llm, model: 'test-model', apiKey: 'sk' },
    })
  );

  assert.match(report.lines.join('\n'), /not a member/);
  // Membership failure is informational: it does not make the whole report fail.
  assert.equal(report.ok, true);
});
