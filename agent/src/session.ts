import { Client, type Site, type User } from '../../src/index';
import type { AgentConfig } from './config';
import { unwrap, WikidotAgentError } from './errors';
import { installProxyFetch } from './net';
import { looksLikeUrl, normalizeSiteName } from './site-name';

export interface AccountInfo {
  username: string;
  userId: number | null;
  displayName: string | null;
}

/**
 * Owns the Wikidot `Client` and caches `Site` handles.
 *
 * The client is created lazily so that a session that only reads public data
 * never needs credentials, and a configured account is only logged in on the
 * first call that actually needs it.
 */
export class WikidotSession {
  private _config: AgentConfig;
  private clientPromise: Promise<Client> | null = null;
  private readonly sites = new Map<string, Site>();

  constructor(config: AgentConfig) {
    this._config = config;
  }

  get config(): AgentConfig {
    return this._config;
  }

  /** Replace the config (used by `/wikidot-mode` style commands and CLI flags). */
  updateConfig(patch: Partial<AgentConfig>): AgentConfig {
    this._config = { ...this._config, ...patch };
    return this._config;
  }

  isLoggedIn(): boolean {
    return this.clientPromise !== null && this._cachedClient?.isLoggedIn() === true;
  }

  private _cachedClient: Client | null = null;

  /**
   * Get the client, creating and logging in on first use.
   * Without credentials an anonymous client is returned.
   */
  async getClient(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = this.createClient(this._config.username, this._config.password);
    }
    return this.clientPromise;
  }

  private async createClient(username: string | null, password: string | null): Promise<Client> {
    installProxyFetch();
    const options: Parameters<typeof Client.create>[0] = { domain: this._config.domain };
    if (username && password) {
      options.username = username;
      options.password = password;
    }
    const client = await unwrap(Client.create(options), 'Creating Wikidot client');
    this._cachedClient = client;
    return client;
  }

  /** Require an authenticated client; throws a helpful error otherwise. */
  async requireLoginClient(): Promise<Client> {
    const client = await this.getClient();
    if (!client.isLoggedIn()) {
      throw new WikidotAgentError(
        'not_logged_in',
        'This action needs a logged-in Wikidot account.',
        'Add "username" and "password" to ~/.wikidot-ai/config.json (or set WIKIDOT_USERNAME / WIKIDOT_PASSWORD), then retry.'
      );
    }
    return client;
  }

  /** Log in with explicit credentials, replacing any existing client. */
  async login(username: string, password: string): Promise<AccountInfo> {
    const client = await this.createClient(username, password);
    this.clientPromise = Promise.resolve(client);
    this.sites.clear();
    this._config = { ...this._config, username, password };
    return accountInfo(client);
  }

  /** Drop the current session (logout best-effort). */
  async logout(): Promise<void> {
    const client = this._cachedClient;
    this.clientPromise = null;
    this._cachedClient = null;
    this.sites.clear();
    if (client) {
      await client.close();
    }
  }

  /** Get (and cache) a site by UNIX name, host or full URL. */
  async getSite(unixName?: string | null): Promise<Site> {
    const raw = (unixName ?? this._config.defaultSite)?.trim();
    if (!raw) {
      throw new WikidotAgentError(
        'not_configured',
        'No site specified and no defaultSite configured.',
        'Pass "site" explicitly or set "defaultSite" in ~/.wikidot-ai/config.json.'
      );
    }
    const name = normalizeSiteName(raw);
    const cached = this.sites.get(name);
    if (cached) return cached;

    const client = await this.getClient();
    const site = await unwrap(
      client.site.get(name),
      looksLikeUrl(raw) ? `Fetching site "${name}" (from "${raw}")` : `Fetching site "${name}"`
    );
    this.sites.set(name, site);
    return site;
  }

  /** Account information for the current client, or null when anonymous. */
  async account(): Promise<AccountInfo | null> {
    const client = await this.getClient();
    if (!client.isLoggedIn()) return null;
    return accountInfo(client);
  }
}

function accountInfo(client: Client): AccountInfo {
  const me: User | null = client.me;
  return {
    username: client.username ?? 'unknown',
    userId: me?.id ?? null,
    displayName: me?.name ?? null,
  };
}
