import { mapWikidotError, WikidotAgentError } from './errors';
import type { ChatClient, LlmMessage, LlmToolSchema, LlmUsage } from './llm';
import type { PolicyContext } from './policy';
import { buildSystemPrompt } from './prompt';
import type { WikidotSession } from './session';
import { type AgentTool, createWikidotTools, type ToolContext } from './tools';

export interface WikidotAgentOptions {
  session: WikidotSession;
  llm: ChatClient;
  tools?: AgentTool[];
  policy: PolicyContext;
  /** Global dry-run: write tools only preview. */
  dryRun?: boolean;
  maxIterations?: number;
  /** Progress/log sink (stderr in the CLI). */
  log?: (message: string) => void;
  /** Called with the assistant's prose as soon as a turn completes. */
  onText?: (text: string) => void;
  /** Called before/after each tool execution, for CLI feedback. */
  onToolCall?: (event: {
    phase: 'start' | 'end';
    name: string;
    args?: unknown;
    ok?: boolean;
    content?: string;
  }) => void;
}

export interface ToolInvocation {
  name: string;
  args: unknown;
  ok: boolean;
  content: string;
}

export interface AgentRunResult {
  text: string;
  invocations: ToolInvocation[];
  iterations: number;
  usage: LlmUsage;
  /** True when the iteration cap was hit and the answer is a wrap-up summary. */
  truncated: boolean;
}

function emptyUsage(): LlmUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function addUsage(total: LlmUsage, next: LlmUsage): void {
  total.promptTokens = (total.promptTokens ?? 0) + (next.promptTokens ?? 0);
  total.completionTokens = (total.completionTokens ?? 0) + (next.completionTokens ?? 0);
  total.totalTokens = (total.totalTokens ?? 0) + (next.totalTokens ?? 0);
}

/**
 * Tool-calling agent loop.
 *
 * The conversation history persists between `run()` calls, so an interactive
 * session can refer back to earlier requests.
 */
export class WikidotAgent {
  public readonly session: WikidotSession;
  public readonly tools: AgentTool[];
  private readonly llm: ChatClient;
  private readonly policy: PolicyContext;
  private readonly dryRun: boolean;
  private readonly maxIterations: number;
  private readonly log: (message: string) => void;
  private readonly onText?: (text: string) => void;
  private readonly onToolCall?: WikidotAgentOptions['onToolCall'];
  private messages: LlmMessage[] = [];

  constructor(options: WikidotAgentOptions) {
    this.session = options.session;
    this.llm = options.llm;
    this.tools = options.tools ?? createWikidotTools();
    this.policy = options.policy;
    this.dryRun = options.dryRun ?? false;
    this.maxIterations = options.maxIterations ?? 12;
    this.log = options.log ?? (() => undefined);
    this.onText = options.onText;
    this.onToolCall = options.onToolCall;
  }

  /** Tool schemas in OpenAI function-calling format. */
  get toolSchemas(): LlmToolSchema[] {
    return this.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  get history(): LlmMessage[] {
    return this.messages;
  }

  reset(): void {
    this.messages = [];
  }

  /** Run one user turn to completion, executing any tool calls along the way. */
  async run(input: string, signal?: AbortSignal): Promise<AgentRunResult> {
    this.messages.push({ role: 'user', content: input });
    const invocations: ToolInvocation[] = [];
    const usage = emptyUsage();
    let iterations = 0;
    let text = '';

    for (;;) {
      if (signal?.aborted) throw new WikidotAgentError('unexpected', 'Aborted.');
      if (iterations >= this.maxIterations) {
        return this.finishTruncated(signal, invocations, usage, text);
      }
      iterations += 1;

      const systemPrompt = await this.systemPrompt();
      const response = await this.llm.chat({
        messages: [{ role: 'system', content: systemPrompt }, ...this.messages],
        tools: this.toolSchemas,
        signal,
      });
      addUsage(usage, response.usage);
      this.messages.push(response.message);

      if (response.message.content && response.message.content.trim().length > 0) {
        text = response.message.content;
        this.onText?.(text);
      }

      const calls = response.message.tool_calls ?? [];
      if (calls.length === 0) {
        return { text, invocations, iterations, usage, truncated: false };
      }

      for (const call of calls) {
        const name = call.function.name;
        const tool = this.tools.find((entry) => entry.name === name);
        this.onToolCall?.({ phase: 'start', name, args: call.function.arguments });

        let args: unknown;
        let parsedOk = true;
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch (error) {
          parsedOk = false;
          args = {};
          const message = `Tool "${name}" received invalid JSON arguments: ${String(error)}`;
          this.messages.push({ role: 'tool', tool_call_id: call.id, name, content: message });
          invocations.push({ name, args: call.function.arguments, ok: false, content: message });
          this.onToolCall?.({ phase: 'end', name, ok: false, content: message });
        }

        if (!parsedOk) continue;

        if (!tool) {
          const message = `Unknown tool "${name}". Available tools: ${this.tools.map((t) => t.name).join(', ')}`;
          this.messages.push({ role: 'tool', tool_call_id: call.id, name, content: message });
          invocations.push({ name, args, ok: false, content: message });
          this.onToolCall?.({ phase: 'end', name, ok: false, content: message });
          continue;
        }

        const context: ToolContext = {
          session: this.session,
          policy: this.policy,
          dryRun: this.dryRun,
          signal,
          log: this.log,
        };

        try {
          const result = await tool.execute(args as Record<string, unknown>, context);
          this.messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name,
            content: result.content,
          });
          invocations.push({ name, args, ok: true, content: result.content });
          this.onToolCall?.({ phase: 'end', name, ok: true, content: result.content });
        } catch (error) {
          const message = mapWikidotError(error, `Tool "${name}"`).toDisplay();
          this.messages.push({ role: 'tool', tool_call_id: call.id, name, content: message });
          invocations.push({ name, args, ok: false, content: message });
          this.onToolCall?.({ phase: 'end', name, ok: false, content: message });
        }
      }
    }
  }

  private async systemPrompt(): Promise<string> {
    const account = await this.session.account().catch(() => null);
    return buildSystemPrompt({
      config: this.session.config,
      account,
      tools: this.tools,
      dryRun: this.dryRun,
    });
  }

  /**
   * The iteration cap is a budget, not a failure. Ask the model for a wrap-up
   * with tools disabled so the work so far is reported instead of discarded.
   */
  private async finishTruncated(
    signal: AbortSignal | undefined,
    invocations: ToolInvocation[],
    usage: LlmUsage,
    lastText: string
  ): Promise<AgentRunResult> {
    this.messages.push({
      role: 'user',
      content:
        '系统提示：已达到本次工具调用上限，请不要再调用工具。用一段话总结已经完成的操作、当前状态和下一步。',
    });
    try {
      const response = await this.llm.chat({
        messages: [{ role: 'system', content: await this.systemPrompt() }, ...this.messages],
        signal,
      });
      addUsage(usage, response.usage);
      this.messages.push(response.message);
      const text = response.message.content?.trim();
      if (text) {
        this.onText?.(text);
        return { text, invocations, iterations: this.maxIterations, usage, truncated: true };
      }
    } catch {
      // Fall through to the last text we already have.
    }
    return {
      text: lastText,
      invocations,
      iterations: this.maxIterations,
      usage,
      truncated: true,
    };
  }
}
