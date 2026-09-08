import { WikidotAgent, type WikidotAgentOptions } from './src/agent';
import { type AgentConfig, loadConfig } from './src/config';
import { LlmClient } from './src/llm';
import type { PolicyContext } from './src/policy';
import { WikidotSession } from './src/session';

export type { AgentRunResult, ToolInvocation, WikidotAgentOptions } from './src/agent';
export { WikidotAgent } from './src/agent';
export { appendAudit } from './src/audit';
export type { AgentConfig, AgentMode, LlmSettings, RawAgentConfig } from './src/config';
export { loadConfig, redactConfig } from './src/config';
export { mapWikidotError, WikidotAgentError } from './src/errors';
export type { ChatClient, LlmChatResult, LlmMessage, LlmToolCall, LlmToolSchema } from './src/llm';
export { LlmClient, LlmError } from './src/llm';
export { hasProxyEnv, installProxyFetch } from './src/net';
export * from './src/ops';
export type { ConfirmUi, PolicyContext, WriteIntent } from './src/policy';
export { describeMode, ensureWriteAllowed, isSiteAllowed } from './src/policy';
export type { AccountInfo } from './src/session';
export { WikidotSession } from './src/session';
export { looksLikeUrl, normalizeSiteName } from './src/site-name';
export type { AgentTool, JsonSchema, ToolContext, ToolResult } from './src/tools';
export { createWikidotTools } from './src/tools';

export interface CreateAgentOptions {
  config?: AgentConfig;
  session?: WikidotSession;
  policy?: PolicyContext;
  dryRun?: boolean;
  maxIterations?: number;
  log?: (message: string) => void;
  onText?: WikidotAgentOptions['onText'];
  onToolCall?: WikidotAgentOptions['onToolCall'];
}

export interface WikidotAgentBundle {
  agent: WikidotAgent;
  session: WikidotSession;
  config: AgentConfig;
}

/**
 * Wire config → session → LLM → agent.
 *
 * ```ts
 * const { agent } = createAgent({ policy: { hasUI: false } });
 * const result = await agent.run('在 scp-wiki 的 scp-173 页面评论：写得好');
 * console.log(result.text);
 * ```
 */
export function createAgent(options: CreateAgentOptions = {}): WikidotAgentBundle {
  const config = options.config ?? loadConfig();
  const session = options.session ?? new WikidotSession(config);
  const policy: PolicyContext = options.policy ?? { hasUI: false };
  const agent = new WikidotAgent({
    session,
    llm: new LlmClient(config.llm),
    policy,
    dryRun: options.dryRun,
    maxIterations: options.maxIterations,
    log: options.log,
    onText: options.onText,
    onToolCall: options.onToolCall,
  });
  return { agent, session, config };
}
