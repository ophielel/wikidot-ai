/**
 * End-to-end dry-run test: the mock LLM asks for a page edit and a page comment
 * with dryRun=true. No credentials are needed and nothing is posted.
 *
 *   npx tsx agent/scripts/e2e-dryrun.ts [site] [page]
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WikidotAgent } from '../src/agent';
import { loadConfig } from '../src/config';
import { LlmClient } from '../src/llm';
import { WikidotSession } from '../src/session';
import { createWikidotTools } from '../src/tools';

function mockLlmServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let calls = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      calls += 1;
      const payload =
        calls === 1
          ? {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'call_edit',
                        type: 'function',
                        function: {
                          name: 'wikidot_edit_page',
                          arguments: JSON.stringify({
                            fullname: process.argv[3] ?? 'scp-173',
                            append: '> test append from wikidot-ai',
                            comment: 'dry run',
                            dryRun: true,
                          }),
                        },
                      },
                      {
                        id: 'call_comment',
                        type: 'function',
                        function: {
                          name: 'wikidot_comment',
                          arguments: JSON.stringify({
                            fullname: process.argv[3] ?? 'scp-173',
                            source: 'test comment from wikidot-ai',
                            dryRun: true,
                          }),
                        },
                      },
                      {
                        id: 'call_tags',
                        type: 'function',
                        function: {
                          name: 'wikidot_set_tags',
                          arguments: JSON.stringify({
                            fullname: process.argv[3] ?? 'scp-173',
                            mode: 'add',
                            tags: ['wikidot-ai-dry-run'],
                            dryRun: true,
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
                  message: { role: 'assistant', content: 'Both previews are ready.' },
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
  });

  const result = await agent.run('Preview an edit and a comment.');
  await server.close();

  for (const invocation of result.invocations) {
    console.log(`${invocation.ok ? 'OK ' : 'ERR'} ${invocation.name}`);
    console.log(invocation.content.split('\n').slice(0, 4).join('\n'));
    console.log('');
  }

  const failed = result.invocations.filter((entry) => !entry.ok);
  if (failed.length > 0) {
    throw new Error(`Dry-run tools failed: ${failed.map((entry) => entry.name).join(', ')}`);
  }
  if (!result.invocations.every((entry) => entry.content.includes('[DRY RUN]'))) {
    throw new Error('Expected every invocation to be a dry run.');
  }
  console.log('E2E DRY-RUN OK (nothing was posted)');
}

main().catch((error) => {
  console.error('E2E DRY-RUN FAILED:', error);
  process.exitCode = 1;
});
