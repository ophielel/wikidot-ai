import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { WikidotAgent } from '../agent';
import { type AgentConfig, type AgentMode, loadConfig, type RawAgentConfig } from '../config';
import { LlmClient } from '../llm';
import type { PolicyContext } from '../policy';
import { type AccountInfo, WikidotSession } from '../session';
import { normalizeSiteName } from '../site-name';

export interface ConnectInput {
  username?: string;
  password?: string;
  site?: string;
  mode?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  remember?: boolean;
}

export interface SiteInfo {
  unixName: string;
  title: string;
  url: string;
}

export interface DisplayEntry {
  role: 'user' | 'agent' | 'tool' | 'error';
  text: string;
  name?: string;
  ok?: boolean;
  at: number;
}

export interface Conversation {
  id: string;
  title: string;
  display: DisplayEntry[];
  agent: WikidotAgent;
  createdAt: number;
  updatedAt: number;
}

export interface WebSession {
  id: string;
  config: AgentConfig;
  wikidot: WikidotSession;
  policy: PolicyContext;
  conversations: Map<string, Conversation>;
  activeId: string;
  account: AccountInfo | null;
  site: SiteInfo | null;
  busy: boolean;
  abort: AbortController | null;
  emit: ((event: string, data: unknown) => void) | null;
  pending: Map<string, (approved: boolean) => void>;
}

export interface PublicConversation {
  id: string;
  title: string;
  messages: number;
  updatedAt: number;
  active: boolean;
}

export interface PublicSessionState {
  connected: boolean;
  account: { username: string; userId: number | null } | null;
  site: SiteInfo | null;
  mode: AgentMode | null;
  model: string | null;
  busy: boolean;
  activeId: string | null;
  conversations: PublicConversation[];
}

const CONFIG_PATH = join(homedir(), '.wikidot-ai', 'config.json');

function newId(): string {
  return randomBytes(18).toString('base64url');
}

function asMode(value: string | undefined, fallback: AgentMode): AgentMode {
  if (value === 'readonly' || value === 'confirm' || value === 'auto') return value;
  return fallback;
}

function makeAgent(session: WebSession, conversation: Conversation): WikidotAgent {
  return new WikidotAgent({
    session: session.wikidot,
    llm: new LlmClient(session.config.llm),
    policy: session.policy,
    maxIterations: session.config.maxIterations,
    onText: (text) => {
      pushDisplay(conversation, { role: 'agent', text, at: Date.now() });
      session.emit?.('text', { text });
    },
    onToolCall: (event) => {
      if (event.phase === 'end') {
        pushDisplay(conversation, {
          role: 'tool',
          name: event.name,
          ok: event.ok,
          text: event.content ?? '',
          at: Date.now(),
        });
      }
      session.emit?.('tool', {
        phase: event.phase,
        name: event.name,
        ok: event.ok,
        content: event.content,
      });
    },
  });
}

/** Append a display entry, dropping an immediately repeated agent text. */
export function pushDisplay(conversation: Conversation, entry: DisplayEntry): void {
  const last = conversation.display[conversation.display.length - 1];
  if (entry.role === 'agent' && last?.role === 'agent' && last.text === entry.text) return;
  conversation.display.push(entry);
  conversation.updatedAt = Date.now();
  if (entry.role === 'user' && conversation.title === '新对话') {
    conversation.title = entry.text.replace(/\s+/g, ' ').trim().slice(0, 24) || '新对话';
  }
}

export function createConversation(session: WebSession): Conversation {
  const id = newId();
  const conversation: Conversation = {
    id,
    title: '新对话',
    display: [],
    agent: undefined as unknown as WikidotAgent,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  conversation.agent = makeAgent(session, conversation);
  session.conversations.set(id, conversation);
  return conversation;
}

export function activeConversation(session: WebSession): Conversation {
  const current = session.conversations.get(session.activeId);
  if (current) return current;
  const next = createConversation(session);
  session.activeId = next.id;
  return next;
}

export function selectConversation(session: WebSession, id: string): Conversation | null {
  const conversation = session.conversations.get(id);
  if (!conversation) return null;
  session.activeId = id;
  return conversation;
}

export function deleteConversation(session: WebSession, id: string): boolean {
  if (!session.conversations.delete(id)) return false;
  if (session.activeId === id) {
    const next = [...session.conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    session.activeId = next ? next.id : createConversation(session).id;
  }
  return true;
}

export function conversationView(conversation: Conversation): {
  id: string;
  title: string;
  display: DisplayEntry[];
} {
  return { id: conversation.id, title: conversation.title, display: conversation.display };
}

/**
 * Build the per-browser agent bundle. The Wikidot password and LLM key live only
 * in this server-side object (and, if `remember` was checked, on disk at 0600);
 * they are never sent back to the browser.
 */
export async function connectSession(input: ConnectInput): Promise<WebSession> {
  const base = loadConfig();
  const mode = asMode(input.mode, base.mode);
  const config: AgentConfig = {
    ...base,
    username: input.username?.trim() || base.username,
    password: input.password || base.password,
    defaultSite: input.site?.trim() ? normalizeSiteName(input.site) : base.defaultSite,
    mode,
    llm: {
      ...base.llm,
      baseUrl: input.baseUrl?.trim() || base.llm.baseUrl,
      apiKey: input.apiKey || base.llm.apiKey,
      model: input.model?.trim() || base.llm.model,
    },
  };

  if (!config.username || !config.password) {
    throw new Error('请输入 Wikidot 用户名和密码。');
  }
  if (!config.llm.model) {
    throw new Error('请输入大模型名称，例如 deepseek-chat。');
  }
  if (!config.llm.apiKey) {
    throw new Error('请输入大模型 API Key。');
  }

  const wikidot = new WikidotSession(config);
  const account = await wikidot.login(config.username, config.password);

  let site: SiteInfo | null = null;
  if (config.defaultSite) {
    const resolved = await wikidot.getSite(config.defaultSite);
    site = { unixName: resolved.unixName, title: resolved.title, url: resolved.getBaseUrl() };
  }

  const session: WebSession = {
    id: newId(),
    config,
    wikidot,
    policy: { hasUI: true },
    conversations: new Map(),
    activeId: '',
    account,
    site,
    busy: false,
    abort: null,
    emit: null,
    pending: new Map(),
  };

  session.policy = {
    hasUI: true,
    ui: {
      confirm: (title, message) =>
        new Promise<boolean>((resolve) => {
          if (!session.emit) {
            resolve(false);
            return;
          }
          const id = newId();
          session.pending.set(id, resolve);
          session.emit('confirm', { id, title, message });
        }),
    },
  };

  session.activeId = createConversation(session).id;

  if (input.remember) {
    persist(config);
  }

  return session;
}

function persist(config: AgentConfig): void {
  const raw: RawAgentConfig = {
    username: config.username ?? undefined,
    password: config.password ?? undefined,
    domain: config.domain,
    defaultSite: config.defaultSite ?? undefined,
    mode: config.mode,
    allowedSites: config.allowedSites ?? undefined,
    maxIterations: config.maxIterations,
    llm: {
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey ?? undefined,
      model: config.llm.model ?? undefined,
      temperature: config.llm.temperature,
    },
  };
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(raw, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function publicState(session: WebSession | undefined): PublicSessionState {
  if (!session) {
    return {
      connected: false,
      account: null,
      site: null,
      mode: null,
      model: null,
      busy: false,
      activeId: null,
      conversations: [],
    };
  }
  return {
    connected: true,
    account: session.account
      ? { username: session.account.username, userId: session.account.userId }
      : null,
    site: session.site,
    mode: session.config.mode,
    model: session.config.llm.model,
    busy: session.busy,
    activeId: session.activeId,
    conversations: [...session.conversations.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        messages: conversation.display.length,
        updatedAt: conversation.updatedAt,
        active: conversation.id === session.activeId,
      })),
  };
}

/** Release every pending confirmation so a disconnected client cannot hang a tool. */
export function releasePending(session: WebSession): void {
  for (const resolve of session.pending.values()) resolve(false);
  session.pending.clear();
}

export function resolveConfirm(session: WebSession, id: string, approved: boolean): boolean {
  const resolve = session.pending.get(id);
  if (!resolve) return false;
  session.pending.delete(id);
  resolve(approved);
  return true;
}

export class SessionStore {
  private readonly sessions = new Map<string, WebSession>();

  get(id: string | undefined): WebSession | undefined {
    return id ? this.sessions.get(id) : undefined;
  }

  set(id: string, session: WebSession): void {
    this.sessions.set(id, session);
  }

  async delete(id: string | undefined): Promise<void> {
    if (!id) return;
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    if (session) {
      releasePending(session);
      session.abort?.abort();
      await session.wikidot.logout().catch(() => undefined);
    }
  }

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.delete(id)));
  }
}
