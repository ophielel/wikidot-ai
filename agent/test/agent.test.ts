import assert from 'node:assert/strict';
import test from 'node:test';
import { WikidotAgent } from '../src/agent';
import type { AgentConfig } from '../src/config';
import { WikidotAgentError } from '../src/errors';
import type { ChatClient, LlmChatOptions, LlmChatResult, LlmMessage } from '../src/llm';
import type { WikidotSession } from '../src/session';
import type { AgentTool, ToolContext } from '../src/tools';

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    username: 'tester',
    password: 'secret',
    domain: 'wikidot.com',
    defaultSite: 'scp-wiki',
    mode: 'auto',
    auditLog: false,
    auditPath: '/tmp/audit.jsonl',
    allowedSites: null,
    maxIterations: 30,
    llm: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk',
      model: 'test',
      temperature: 0,
      maxTokens: null,
    },
    sources: [],
    ...overrides,
  };
}

function session(): WikidotSession {
  return {
    config: config(),
    account: async () => ({ username: 'tester', userId: 1, displayName: 'Tester' }),
  } as unknown as WikidotSession;
}

class ScriptedLlm implements ChatClient {
  public calls: LlmChatOptions[] = [];
  constructor(private readonly responses: LlmChatResult[]) {}

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    this.calls.push(options);
    const next = this.responses.shift();
    if (!next) throw new Error('No scripted LLM response left.');
    return next;
  }
}

function assistantText(text: string): LlmChatResult {
  return {
    message: { role: 'assistant', content: text },
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    finishReason: 'stop',
  };
}

function assistantTool(name: string, args: unknown, id = 'call_1'): LlmChatResult {
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    },
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    finishReason: 'tool_calls',
  };
}

const echoTool: AgentTool = {
  name: 'echo',
  description: 'Echo the value argument.',
  parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
  write: false,
  async execute(args) {
    return { content: `echo:${String(args.value)}` };
  },
};

const failTool: AgentTool = {
  name: 'fail',
  description: 'Always fails.',
  parameters: { type: 'object', properties: {} },
  write: false,
  async execute() {
    throw new WikidotAgentError('not_found', 'nothing here');
  },
};

function makeAgent(responses: LlmChatResult[], tools: AgentTool[] = [echoTool]) {
  const llm = new ScriptedLlm(responses);
  const agent = new WikidotAgent({
    session: session(),
    llm,
    tools,
    policy: { hasUI: false },
    maxIterations: 5,
  });
  return { agent, llm };
}

test('a plain answer needs no tool call', async () => {
  const { agent, llm } = makeAgent([assistantText('hello')]);
  const result = await agent.run('hi');
  assert.equal(result.text, 'hello');
  assert.equal(result.iterations, 1);
  assert.equal(result.invocations.length, 0);
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0]?.messages[0]?.role, 'system');
});

test('tool calls are executed and fed back to the model', async () => {
  const { agent, llm } = makeAgent([assistantTool('echo', { value: 'x' }), assistantText('done')]);
  const result = await agent.run('echo x');
  assert.equal(result.text, 'done');
  assert.equal(result.invocations.length, 1);
  assert.equal(result.invocations[0]?.ok, true);
  assert.equal(result.invocations[0]?.content, 'echo:x');

  const secondCall = llm.calls[1];
  const toolMessage = secondCall?.messages.find((message: LlmMessage) => message.role === 'tool');
  assert.equal(toolMessage?.content, 'echo:x');
  assert.equal(toolMessage?.tool_call_id, 'call_1');
});

test('tool failures are reported to the model instead of thrown', async () => {
  const { agent, llm } = makeAgent(
    [assistantTool('fail', {}), assistantText('recovered')],
    [failTool]
  );
  const result = await agent.run('fail');
  assert.equal(result.text, 'recovered');
  assert.equal(result.invocations[0]?.ok, false);
  assert.match(result.invocations[0]?.content ?? '', /nothing here/);
  const toolMessage = llm.calls[1]?.messages.find((m: LlmMessage) => m.role === 'tool');
  assert.match(toolMessage?.content ?? '', /nothing here/);
});

test('unknown tools produce a helpful tool result', async () => {
  const { agent } = makeAgent([assistantTool('nope', {}), assistantText('ok')]);
  const result = await agent.run('x');
  assert.equal(result.invocations[0]?.ok, false);
  assert.match(result.invocations[0]?.content ?? '', /Unknown tool "nope"/);
});

test('invalid tool arguments produce a tool result, not a crash', async () => {
  const response: LlmChatResult = {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'c', type: 'function', function: { name: 'echo', arguments: '{not json' } },
      ],
    },
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    finishReason: 'tool_calls',
  };
  const { agent } = makeAgent([response, assistantText('ok')]);
  const result = await agent.run('x');
  assert.equal(result.invocations[0]?.ok, false);
  assert.match(result.invocations[0]?.content ?? '', /invalid JSON/);
});

test('hitting maxIterations wraps up instead of throwing away the work', async () => {
  // 5 tool turns fill the budget, then the wrap-up call returns the summary.
  const responses = [
    ...Array.from({ length: 5 }, () => assistantTool('echo', { value: 'x' })),
    assistantText('已完成的阶段性总结。'),
  ];
  const { agent, llm } = makeAgent(responses);
  const result = await agent.run('loop');
  assert.equal(result.truncated, true);
  assert.equal(result.text, '已完成的阶段性总结。');
  assert.equal(result.invocations.length, 5);
  assert.equal(result.iterations, 5);
  // The wrap-up request must not offer tools.
  const lastCall = llm.calls[llm.calls.length - 1];
  assert.equal(lastCall?.tools, undefined);
  assert.match(lastCall?.messages[lastCall.messages.length - 1]?.content ?? '', /工具调用上限/);
});

test('a failed wrap-up call still returns the work done so far', async () => {
  const responses = Array.from({ length: 6 }, () => assistantTool('echo', { value: 'x' }));
  const { agent } = makeAgent(responses);
  const result = await agent.run('loop');
  assert.equal(result.truncated, true);
  assert.equal(result.invocations.length, 5);
});

test('history persists across runs and reset clears it', async () => {
  const { agent, llm } = makeAgent([assistantText('a'), assistantText('b')]);
  await agent.run('first');
  await agent.run('second');
  const secondMessages = llm.calls[1]?.messages ?? [];
  assert.ok(secondMessages.some((message) => message.content === 'first'));
  assert.ok(secondMessages.some((message) => message.content === 'a'));
  assert.ok(secondMessages.some((message) => message.content === 'second'));

  agent.reset();
  assert.equal(agent.history.length, 0);
});

test('tool context exposes dry-run and policy', async () => {
  const captured: { ctx?: ToolContext } = {};
  const spy: AgentTool = {
    name: 'spy',
    description: 'spy',
    parameters: { type: 'object', properties: {} },
    write: false,
    async execute(_args, ctx) {
      captured.ctx = ctx;
      return { content: 'ok' };
    },
  };
  const agent = new WikidotAgent({
    session: session(),
    llm: new ScriptedLlm([assistantTool('spy', {}), assistantText('done')]),
    tools: [spy],
    policy: { hasUI: true },
    dryRun: true,
  });
  await agent.run('x');
  assert.equal(captured.ctx?.dryRun, true);
  assert.equal(captured.ctx?.policy.hasUI, true);
});
