import { appendAudit, truncate } from '../audit';
import { WikidotAgentError } from '../errors';
import { formatWriteResult } from '../format';
import type { WriteResult } from '../ops';
import { ensureWriteAllowed, type WriteIntent } from '../policy';
import {
  type AgentTool,
  type Args,
  asOptionalBoolean,
  type JsonSchema,
  type ToolContext,
  type ToolResult,
} from './types';

export interface WritePlan {
  intent: WriteIntent;
  /** Rendered preview shown for `dryRun` and confirmations. */
  preview: string;
  /** Optional audit detail (usually the body that will be posted). */
  auditDetail?: string;
  execute(): Promise<WriteResult>;
}

export interface WriteToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
  prepare(args: Args, ctx: ToolContext): Promise<WritePlan>;
}

export interface ReadToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
  run(args: Args, ctx: ToolContext): Promise<ToolResult>;
}

/** Read-only tool: no policy gate, no audit entry. */
export function readTool(spec: ReadToolSpec): AgentTool {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    write: false,
    execute: spec.run,
  };
}

/**
 * Mutating tool. Always runs prepare (read-only) first so the confirmation
 * prompt and `dryRun` output show the exact content that will be posted.
 */
export function writeTool(spec: WriteToolSpec): AgentTool {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    write: true,
    async execute(args: Args, ctx: ToolContext): Promise<ToolResult> {
      const plan = await spec.prepare(args, ctx);
      const config = ctx.session.config;
      const dryRun = asOptionalBoolean(args, 'dryRun') === true || ctx.dryRun;

      if (dryRun) {
        await appendAudit(config, {
          action: spec.name,
          site: plan.intent.site,
          target: plan.intent.target,
          outcome: 'dry-run',
          detail: truncate(plan.auditDetail),
        });
        return { content: `[DRY RUN] ${plan.preview}`, data: { dryRun: true } };
      }

      // Real writes need an authenticated account; fail before asking the user
      // to approve something that cannot be submitted.
      await ctx.session.requireLoginClient();

      try {
        await ensureWriteAllowed(config, plan.intent, ctx.policy);
      } catch (error) {
        if (error instanceof WikidotAgentError && error.code === 'user_declined') {
          await appendAudit(config, {
            action: spec.name,
            site: plan.intent.site,
            target: plan.intent.target,
            outcome: 'declined',
          });
        }
        throw error;
      }

      const result = await plan.execute();
      await appendAudit(config, {
        action: spec.name,
        site: result.site,
        target: result.target,
        outcome: 'ok',
        detail: truncate(plan.auditDetail),
      });
      return { content: formatWriteResult(result), data: { result } };
    },
  };
}
