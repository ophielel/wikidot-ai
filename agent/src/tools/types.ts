import type { PolicyContext } from '../policy';
import type { WikidotSession } from '../session';

/** Minimal JSON Schema subset used for OpenAI-style function calling. */
export interface JsonSchema {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  additionalProperties?: boolean;
}

export interface ToolContext {
  session: WikidotSession;
  /** Interactive confirmation channel, or a no-UI stub. */
  policy: PolicyContext;
  /** Global dry-run flag (CLI `--dry-run`); OR-ed with the tool's own `dryRun`. */
  dryRun: boolean;
  signal?: AbortSignal;
  /** Progress/log sink (stderr in the CLI). */
  log: (message: string) => void;
}

export interface ToolResult {
  /** Text handed back to the model as the tool result. */
  content: string;
  /** Structured payload, kept out of the model context. */
  data?: unknown;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** True for tools that mutate the Wikidot account; they go through the policy gate. */
  write: boolean;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export type Args = Record<string, unknown>;

export function asString(args: Args, key: string, required = true): string {
  const value = args[key];
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (required) throw new Error(`Missing required string argument "${key}".`);
  return '';
}

export function asOptionalString(args: Args, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function asOptionalBoolean(args: Args, key: string): boolean | undefined {
  const value = args[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (['true', '1', 'yes'].includes(value.toLowerCase())) return true;
    if (['false', '0', 'no'].includes(value.toLowerCase())) return false;
  }
  return undefined;
}

export function asOptionalInteger(args: Args, key: string): number | undefined {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }
  return undefined;
}

export function asStringArray(args: Args, key: string): string[] | undefined {
  const value = args[key];
  if (Array.isArray(value)) {
    const list = value.filter((entry): entry is string => typeof entry === 'string');
    return list.length > 0 ? list : undefined;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return undefined;
}

/* ------------------------------ schema helpers ----------------------------- */

export function str(description: string, extra: Partial<JsonSchema> = {}): JsonSchema {
  return { type: 'string', description, ...extra };
}

export function int(description: string, extra: Partial<JsonSchema> = {}): JsonSchema {
  return { type: 'integer', description, ...extra };
}

export function bool(description: string, extra: Partial<JsonSchema> = {}): JsonSchema {
  return { type: 'boolean', description, ...extra };
}

export function arr(description: string, items: JsonSchema): JsonSchema {
  return { type: 'array', description, items };
}

export function obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

/** `site` argument shared by every site-scoped tool. */
export function siteField(): JsonSchema {
  return str(
    'Wikidot site UNIX name, e.g. "scp-wiki" or "scp-jp". Defaults to the configured defaultSite.'
  );
}

export function dryRunField(): JsonSchema {
  return bool('Preview the change without performing it (default false).');
}
