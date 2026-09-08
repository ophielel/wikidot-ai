import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * How much freedom the agent has when performing write operations.
 *
 * - `readonly`: every write tool fails, reads still work.
 * - `confirm`: writes require an interactive confirmation (TUI). Without a UI
 *   they are refused, because there is nobody to ask.
 * - `auto`: writes are executed without asking. Intended for unattended
 *   flows (chat bots, RPC) where the user already opted in.
 */
export type AgentMode = 'readonly' | 'confirm' | 'auto';

export const AGENT_MODES: readonly AgentMode[] = ['readonly', 'confirm', 'auto'];

/** Raw shape of a config file / env-derived overrides. */
export interface RawLlmConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface RawAgentConfig {
  username?: string;
  password?: string;
  domain?: string;
  defaultSite?: string;
  mode?: string;
  auditLog?: boolean;
  auditPath?: string;
  allowedSites?: string[];
  maxIterations?: number;
  llm?: RawLlmConfig;
}

/** Resolved LLM settings (OpenAI-compatible chat completions). */
export interface LlmSettings {
  baseUrl: string;
  apiKey: string | null;
  model: string | null;
  temperature: number;
  maxTokens: number | null;
}

/** Fully resolved configuration used by the agent. */
export interface AgentConfig {
  username: string | null;
  password: string | null;
  domain: string;
  defaultSite: string | null;
  mode: AgentMode;
  auditLog: boolean;
  auditPath: string;
  allowedSites: string[] | null;
  /** Maximum LLM turns per user request before the agent wraps up. */
  maxIterations: number;
  llm: LlmSettings;
  /** Files/env sources that contributed to this config, for diagnostics. */
  sources: string[];
}

export interface LoadConfigOptions {
  cwd?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  /** Skip reading files entirely; env only. Useful in tests. */
  envOnly?: boolean;
}

function readJsonIfExists(path: string): RawAgentConfig | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('config root must be a JSON object');
    }
    return parsed as RawAgentConfig;
  } catch (error) {
    throw new Error(`Invalid Wikidot agent config at ${path}: ${String(error)}`);
  }
}

function asTrimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asMode(value: unknown): AgentMode | undefined {
  const raw = asTrimmed(value)?.toLowerCase();
  if (!raw) return undefined;
  if (raw === 'readonly' || raw === 'read-only' || raw === 'read_only') return 'readonly';
  if (raw === 'confirm' || raw === 'ask') return 'confirm';
  if (raw === 'auto' || raw === 'automatic' || raw === 'yolo') return 'auto';
  throw new Error(`Unknown Wikidot agent mode "${value}" (expected readonly, confirm or auto)`);
}

function asBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const raw = asTrimmed(value)?.toLowerCase();
  if (!raw) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value
    .map((entry) => asTrimmed(entry))
    .filter((entry): entry is string => entry !== undefined);
  return list.length > 0 ? list : undefined;
}

function merge(target: RawAgentConfig, source: RawAgentConfig): RawAgentConfig {
  const merged: RawAgentConfig = { ...target };
  if (source.username !== undefined) merged.username = source.username;
  if (source.password !== undefined) merged.password = source.password;
  if (source.domain !== undefined) merged.domain = source.domain;
  if (source.defaultSite !== undefined) merged.defaultSite = source.defaultSite;
  if (source.mode !== undefined) merged.mode = source.mode;
  if (source.auditLog !== undefined) merged.auditLog = source.auditLog;
  if (source.auditPath !== undefined) merged.auditPath = source.auditPath;
  if (source.allowedSites !== undefined) merged.allowedSites = source.allowedSites;
  if (source.maxIterations !== undefined) merged.maxIterations = source.maxIterations;
  if (source.llm !== undefined) merged.llm = { ...merged.llm, ...source.llm };
  return merged;
}

/**
 * Resolve the agent configuration.
 *
 * Precedence (lowest to highest):
 *   `~/.wikidot-ai.json` → `~/.wikidot-ai/config.json` →
 *   `~/.pi/wikidot-ai/config.json` → `<cwd>/.wikidot-ai.json` → env vars.
 *
 * `WIKIDOT_AI_CONFIG` points at a single file and replaces the search above.
 * `WIKIDOT_USERNAME` / `WIKIDOT_PASSWORD` / `WIKIDOT_DOMAIN` /
 * `WIKIDOT_DEFAULT_SITE` / `WIKIDOT_AI_MODE` / `WIKIDOT_AI_ALLOWED_SITES` /
 * `WIKIDOT_AI_AUDIT` / `WIKIDOT_AI_AUDIT_PATH` override file values.
 */
export function loadConfig(options: LoadConfigOptions = {}): AgentConfig {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const cwd = resolve(options.cwd ?? process.cwd());
  const sources: string[] = [];

  let raw: RawAgentConfig = {};
  const explicitPath = asTrimmed(env.WIKIDOT_AI_CONFIG);

  if (explicitPath) {
    const resolved = resolve(cwd, explicitPath);
    raw = merge(raw, readJsonIfExists(resolved) ?? {});
    sources.push(resolved);
  } else if (!options.envOnly) {
    const candidates = [
      join(home, '.wikidot-ai.json'),
      join(home, '.wikidot-ai', 'config.json'),
      join(home, '.pi', 'wikidot-ai', 'config.json'),
      join(cwd, '.wikidot-ai.json'),
    ];
    for (const candidate of candidates) {
      const loaded = readJsonIfExists(candidate);
      if (loaded) {
        raw = merge(raw, loaded);
        sources.push(candidate);
      }
    }
  }

  const envOverrides: RawAgentConfig = {};
  if (asTrimmed(env.WIKIDOT_USERNAME)) envOverrides.username = env.WIKIDOT_USERNAME;
  if (asTrimmed(env.WIKIDOT_PASSWORD)) envOverrides.password = env.WIKIDOT_PASSWORD;
  if (asTrimmed(env.WIKIDOT_DOMAIN)) envOverrides.domain = env.WIKIDOT_DOMAIN;
  if (asTrimmed(env.WIKIDOT_DEFAULT_SITE)) envOverrides.defaultSite = env.WIKIDOT_DEFAULT_SITE;
  if (asTrimmed(env.WIKIDOT_AI_MODE)) envOverrides.mode = env.WIKIDOT_AI_MODE;
  if (asTrimmed(env.WIKIDOT_AI_AUDIT)) envOverrides.auditLog = asBool(env.WIKIDOT_AI_AUDIT);
  if (asTrimmed(env.WIKIDOT_AI_AUDIT_PATH)) envOverrides.auditPath = env.WIKIDOT_AI_AUDIT_PATH;
  const maxIterationsEnv = asNumber(env.WIKIDOT_AI_MAX_ITERATIONS);
  if (maxIterationsEnv !== undefined) envOverrides.maxIterations = maxIterationsEnv;
  const allowedSitesEnv = asTrimmed(env.WIKIDOT_AI_ALLOWED_SITES);
  if (allowedSitesEnv) {
    envOverrides.allowedSites = allowedSitesEnv
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  const envLlm: RawLlmConfig = {};
  const llmBaseUrl = asTrimmed(env.WIKIDOT_AI_LLM_BASE_URL) ?? asTrimmed(env.OPENAI_BASE_URL);
  const llmApiKey = asTrimmed(env.WIKIDOT_AI_LLM_API_KEY) ?? asTrimmed(env.OPENAI_API_KEY);
  const llmModel = asTrimmed(env.WIKIDOT_AI_LLM_MODEL) ?? asTrimmed(env.OPENAI_MODEL);
  const llmTemperature = asNumber(env.WIKIDOT_AI_LLM_TEMPERATURE);
  if (llmBaseUrl) envLlm.baseUrl = llmBaseUrl;
  if (llmApiKey) envLlm.apiKey = llmApiKey;
  if (llmModel) envLlm.model = llmModel;
  if (llmTemperature !== undefined) envLlm.temperature = llmTemperature;
  if (Object.keys(envLlm).length > 0) envOverrides.llm = envLlm;

  if (Object.keys(envOverrides).length > 0) {
    raw = merge(raw, envOverrides);
    sources.push('environment');
  }

  const mode = asMode(raw.mode) ?? 'confirm';
  const auditPath = asTrimmed(raw.auditPath) ?? join(home, '.wikidot-ai', 'audit.jsonl');

  return {
    username: asTrimmed(raw.username) ?? null,
    password: asTrimmed(raw.password) ?? null,
    domain: asTrimmed(raw.domain) ?? 'wikidot.com',
    defaultSite: asTrimmed(raw.defaultSite) ?? null,
    mode,
    auditLog: asBool(raw.auditLog) ?? true,
    auditPath,
    allowedSites: asStringList(raw.allowedSites) ?? null,
    maxIterations: asNumber(raw.maxIterations) ?? 30,
    llm: {
      baseUrl: asTrimmed(raw.llm?.baseUrl) ?? 'https://api.openai.com/v1',
      apiKey: asTrimmed(raw.llm?.apiKey) ?? null,
      model: asTrimmed(raw.llm?.model) ?? null,
      temperature: asNumber(raw.llm?.temperature) ?? 0.2,
      maxTokens: asNumber(raw.llm?.maxTokens) ?? null,
    },
    sources,
  };
}

/** Config with secrets replaced, safe to print or persist into tool output. */
export function redactConfig(config: AgentConfig): Record<string, unknown> {
  return {
    username: config.username,
    password: config.password === null ? null : '***',
    domain: config.domain,
    defaultSite: config.defaultSite,
    mode: config.mode,
    auditLog: config.auditLog,
    auditPath: config.auditPath,
    allowedSites: config.allowedSites,
    maxIterations: config.maxIterations,
    llm: {
      baseUrl: config.llm.baseUrl,
      model: config.llm.model,
      apiKey: config.llm.apiKey === null ? null : '***',
      temperature: config.llm.temperature,
    },
    sources: config.sources,
  };
}
