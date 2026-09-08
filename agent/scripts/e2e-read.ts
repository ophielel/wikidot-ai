/**
 * End-to-end smoke test: a mock OpenAI-compatible server drives the real
 * `wikidot_*` tools against a live Wikidot site (read-only).
 *
 *   npx tsx agent/scripts/e2e-read.ts [site] [page]
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WikidotAgent } from '../src/agent';
import { loadConfig } from '../src/config';
import { LlmClient } from '../src/llm';
import { WikidotSession } from '../src/session';
import { createWikidotTools } from '../src/tools';

function mockLlmServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const state = { calls: 0 };
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      state.calls += 1;
      const payload =
        state.calls === 1
          ? {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'call_1',
                        type: 'function',
                        function: {
                          name: 'wikidot_get_page',
                          arguments: JSON.stringify({
                            fullname: process.argv[3] ?? 'scp-173',
                            withSource: false,
                          }),
                        },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            }
          : {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: `FINAL: page fetched (prompt had ${raw.length} bytes of tool output).`,
                  },
                  finish_reason: 'stop',
                },
              ],
            };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

async function main(): Promise<void> {
  const siteName = process.argv[2] ?? 'scp-wiki';
  const server = await mockLlmServer();

  const config = loadConfig({ envOnly: true });
  const session = new WikidotSession({ ...config, defaultSite: siteName, mode: 'readonly' });
  const agent = new WikidotAgent({
    session,
    llm: new LlmClient({ ...config.llm, baseUrl: server.url, apiKey: 'mock', model: 'mock' }),
    tools: createWikidotTools(),
    policy: { hasUI: false },
    log: (message) => console.log(`[log] ${message}`),
  });

  const result = await agent.run(`Read page ${process.argv[3] ?? 'scp-173'} on ${siteName}.`);
  await server.close();

  console.log('--- tool invocations ---');
  for (const invocation of result.invocations) {
    console.log(`  ${invocation.ok ? 'OK ' : 'ERR'} ${invocation.name}`);
    console.log(`    ${invocation.content.split('\n')[0]}`);
  }
  console.log('--- final answer ---');
  console.log(result.text);

  const pageInvocation = result.invocations.find((entry) => entry.name === 'wikidot_get_page');
  if (!pageInvocation?.ok || !pageInvocation.content.includes('SCP-173')) {
    throw new Error('wikidot_get_page did not return the expected page content.');
  }
  console.log('\nE2E OK');
}

main().catch((error) => {
  console.error('E2E FAILED:', error);
  process.exitCode = 1;
});
