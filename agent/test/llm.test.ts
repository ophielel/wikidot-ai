import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { LlmSettings } from '../src/config';
import { LlmClient, LlmError } from '../src/llm';

type Handler = (request: IncomingMessage, response: ServerResponse, count: number) => void;

async function withServer(
  handler: Handler,
  fn: (baseUrl: string, requests: Array<{ body: unknown; count: number }>) => Promise<void>
): Promise<void> {
  const requests: Array<{ body: unknown; count: number }> = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      let body: unknown = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        // keep raw
      }
      const count = requests.length + 1;
      requests.push({ body, count });
      handler(request, response, count);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}/v1`, requests);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function settings(baseUrl: string, overrides: Partial<LlmSettings> = {}): LlmSettings {
  return {
    baseUrl,
    apiKey: 'sk-test',
    model: 'test-model',
    temperature: 0,
    maxTokens: null,
    ...overrides,
  };
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

test('parses a plain assistant reply', async () => {
  await withServer(
    (_request, response) =>
      json(response, 200, {
        choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }),
    async (baseUrl, requests) => {
      const client = new LlmClient(settings(baseUrl));
      const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
      assert.equal(result.message.content, 'hello');
      assert.equal(result.usage.totalTokens, 7);
      assert.equal(requests.length, 1);
      const body = requests[0]?.body as { model: string; messages: unknown[] };
      assert.equal(body.model, 'test-model');
    }
  );
});

test('parses tool calls and sends tool schemas', async () => {
  await withServer(
    (_request, response) =>
      json(response, 200, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc',
                  type: 'function',
                  function: { name: 'wikidot_get_page', arguments: '{"fullname":"scp-173"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    async (baseUrl, requests) => {
      const client = new LlmClient(settings(baseUrl));
      const result = await client.chat({
        messages: [{ role: 'user', content: 'read scp-173' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'wikidot_get_page',
              description: 'x',
              parameters: { type: 'object' },
            },
          },
        ],
      });
      assert.equal(result.message.tool_calls?.[0]?.id, 'call_abc');
      assert.equal(result.message.tool_calls?.[0]?.function.name, 'wikidot_get_page');
      const body = requests[0]?.body as { tools?: unknown[]; tool_choice?: string };
      assert.equal(body.tools?.length, 1);
      assert.equal(body.tool_choice, 'auto');
    }
  );
});

test('retries on 5xx and eventually succeeds', async () => {
  await withServer(
    (_request, response, count) => {
      if (count === 1) {
        json(response, 500, { error: { message: 'boom' } });
        return;
      }
      json(response, 200, { choices: [{ message: { role: 'assistant', content: 'ok' } }] });
    },
    async (baseUrl, requests) => {
      const client = new LlmClient(settings(baseUrl));
      const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
      assert.equal(result.message.content, 'ok');
      assert.equal(requests.length, 2);
    }
  );
});

test('does not retry on 401 and surfaces the status', async () => {
  await withServer(
    (_request, response) => json(response, 401, { error: { message: 'invalid key' } }),
    async (baseUrl, requests) => {
      const client = new LlmClient(settings(baseUrl));
      await assert.rejects(
        client.chat({ messages: [{ role: 'user', content: 'hi' }] }),
        (error: unknown) =>
          error instanceof LlmError && error.status === 401 && /invalid key/.test(error.message)
      );
      assert.equal(requests.length, 1);
    }
  );
});

test('missing api key or model fails before any request', async () => {
  const client = new LlmClient(settings('http://127.0.0.1:1/v1', { apiKey: null }));
  await assert.rejects(
    client.chat({ messages: [] }),
    (error: unknown) => error instanceof LlmError && /API key/.test(error.message)
  );

  const noModel = new LlmClient(settings('http://127.0.0.1:1/v1', { model: null }));
  await assert.rejects(
    noModel.chat({ messages: [] }),
    (error: unknown) => error instanceof LlmError && /model/i.test(error.message)
  );
});

test('invalid JSON is reported', async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('not json');
    },
    async (baseUrl) => {
      const client = new LlmClient(settings(baseUrl));
      await assert.rejects(
        client.chat({ messages: [] }),
        (error: unknown) => error instanceof LlmError && /invalid JSON/.test(error.message)
      );
    }
  );
});
