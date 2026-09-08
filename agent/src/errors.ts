import type { Result } from 'neverthrow';
import {
  ForbiddenError,
  LoginRequiredError,
  NotFoundException,
  TargetExistsError,
  WikidotError,
  WikidotStatusError,
} from '../../src/errors';

/** Machine-readable reason codes surfaced to the model and the audit log. */
export type WikidotAgentErrorCode =
  | 'not_configured'
  | 'not_logged_in'
  | 'write_blocked'
  | 'site_not_allowed'
  | 'user_declined'
  | 'no_ui'
  | 'not_found'
  | 'forbidden'
  | 'already_exists'
  | 'wikidot_error'
  | 'unexpected';

export class WikidotAgentError extends Error {
  public readonly code: WikidotAgentErrorCode;
  public readonly hint: string | null;

  constructor(code: WikidotAgentErrorCode, message: string, hint: string | null = null) {
    super(message);
    this.name = 'WikidotAgentError';
    this.code = code;
    this.hint = hint;
  }

  toDisplay(): string {
    return this.hint ? `${this.message}\nHint: ${this.hint}` : this.message;
  }
}

function causeCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return typeof code === 'string' ? code : cause.message;
  }
  return null;
}

const NETWORK_HINT =
  '网络请求失败。如果这台机器通过代理上网，请设置 HTTPS_PROXY / HTTP_PROXY（例如 http://127.0.0.1:7890），agent 会自动使用；本地地址可用 NO_PROXY 排除。Windows 上也可以设置 NODE_OPTIONS=--use-env-proxy。';

function isNetworkFailure(message: string, code: string | null): boolean {
  const text = `${message} ${code ?? ''}`.toLowerCase();
  return (
    text.includes('fetch failed') ||
    text.includes('connect timeout') ||
    text.includes('econnrefused') ||
    text.includes('enotfound') ||
    text.includes('etimedout') ||
    text.includes('econnreset') ||
    text.includes('und_err') ||
    text.includes('network')
  );
}

/** Map a library error onto an agent error with an actionable hint. */
export function mapWikidotError(error: unknown, label: string): WikidotAgentError {
  if (error instanceof WikidotAgentError) return error;

  if (error instanceof LoginRequiredError) {
    return new WikidotAgentError(
      'not_logged_in',
      `${label}: Wikidot rejected the request because no account is logged in.`,
      'Set username/password in ~/.wikidot-ai/config.json or the WIKIDOT_USERNAME / WIKIDOT_PASSWORD environment variables.'
    );
  }
  if (error instanceof NotFoundException) {
    return new WikidotAgentError('not_found', `${label}: ${error.message}`);
  }
  if (error instanceof TargetExistsError) {
    return new WikidotAgentError(
      'already_exists',
      `${label}: ${error.message}`,
      'Use wikidot_edit_page to modify the existing page instead.'
    );
  }
  if (error instanceof ForbiddenError) {
    return new WikidotAgentError(
      'forbidden',
      `${label}: ${error.message}`,
      'The logged-in account lacks permission for this action on that site.'
    );
  }
  if (error instanceof WikidotStatusError) {
    return new WikidotAgentError('wikidot_error', `${label}: ${error.message}`);
  }
  if (error instanceof WikidotError) {
    if (isNetworkFailure(error.message, causeCode(error))) {
      return new WikidotAgentError('wikidot_error', `${label}: ${error.message}`, NETWORK_HINT);
    }
    return new WikidotAgentError('wikidot_error', `${label}: ${error.message}`);
  }
  if (error instanceof Error) {
    const code = causeCode(error);
    if (isNetworkFailure(error.message, code)) {
      const detail = code && code !== error.message ? `${error.message} (${code})` : error.message;
      return new WikidotAgentError('unexpected', `${label}: ${detail}`, NETWORK_HINT);
    }
    return new WikidotAgentError('unexpected', `${label}: ${error.message}`);
  }
  return new WikidotAgentError('unexpected', `${label}: ${String(error)}`);
}

/** Await a library `ResultAsync`, throwing a mapped agent error on failure. */
export async function unwrap<T>(
  result: Result<T, WikidotError> | PromiseLike<Result<T, WikidotError>>,
  label: string
): Promise<T> {
  const settled = await result;
  if (settled.isErr()) {
    throw mapWikidotError(settled.error, label);
  }
  return settled.value;
}
