import type { AgentConfig, AgentMode } from './config';
import { WikidotAgentError } from './errors';

/** Minimal view of the pi UI used for confirmations. */
export interface ConfirmUi {
  confirm(title: string, message: string): Promise<boolean>;
  notify?(message: string, level?: 'info' | 'warning' | 'error'): void;
}

export interface WriteIntent {
  /** Operation name shown in prompts and audit entries, e.g. `create page`. */
  action: string;
  site: string;
  /** Short one-line summary, e.g. `scp-9999 "Title"`. */
  target: string;
  /** Body / diff preview shown in the confirmation prompt. */
  preview?: string;
}

export interface PolicyContext {
  hasUI: boolean;
  ui?: ConfirmUi;
}

/** True when the site passes the optional `allowedSites` allow-list. */
export function isSiteAllowed(config: AgentConfig, site: string): boolean {
  if (!config.allowedSites) return true;
  const normalized = site.trim().toLowerCase();
  return config.allowedSites.some((entry) => entry.toLowerCase() === normalized);
}

/**
 * Gate a write operation according to `config.mode`.
 *
 * Throws `WikidotAgentError` when the write must not proceed. Callers run this
 * *after* computing the preview so the user sees exactly what will be posted.
 */
export async function ensureWriteAllowed(
  config: AgentConfig,
  intent: WriteIntent,
  policy: PolicyContext
): Promise<void> {
  if (!isSiteAllowed(config, intent.site)) {
    throw new WikidotAgentError(
      'site_not_allowed',
      `Refusing to ${intent.action} on "${intent.site}": it is not in the allowedSites list.`,
      `Allowed sites: ${(config.allowedSites ?? []).join(', ')}`
    );
  }

  if (config.mode === 'readonly') {
    throw new WikidotAgentError(
      'write_blocked',
      `Refusing to ${intent.action}: the agent is in "readonly" mode.`,
      'Set "mode" to "confirm" or "auto" in ~/.wikidot-ai/config.json to allow writes.'
    );
  }

  if (config.mode === 'auto') return;

  if (!policy.hasUI || !policy.ui) {
    throw new WikidotAgentError(
      'no_ui',
      `Refusing to ${intent.action}: "confirm" mode needs an interactive prompt, but this session has no UI.`,
      'Set "mode": "auto" in ~/.wikidot-ai/config.json to allow unattended writes.'
    );
  }

  const message = intent.preview ? `${intent.target}\n\n${intent.preview}` : intent.target;
  const approved = await policy.ui.confirm(`Wikidot: ${intent.action}?`, message);
  if (!approved) {
    throw new WikidotAgentError('user_declined', `User declined to ${intent.action}.`);
  }
}

/** Human-readable description of the current mode. */
export function describeMode(mode: AgentMode): string {
  switch (mode) {
    case 'readonly':
      return 'readonly - no writes are possible';
    case 'confirm':
      return 'confirm - every write asks for approval first';
    case 'auto':
      return 'auto - writes are executed without asking';
  }
}
