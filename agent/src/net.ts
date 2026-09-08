import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';

let installed = false;

export function hasProxyEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.HTTPS_PROXY ||
      env.https_proxy ||
      env.HTTP_PROXY ||
      env.http_proxy ||
      env.ALL_PROXY ||
      env.all_proxy
  );
}

/**
 * Make the global `fetch` honour HTTP_PROXY / HTTPS_PROXY / NO_PROXY.
 *
 * Node's built-in fetch ignores those variables while curl and most CLIs honour
 * them. On machines that only reach the internet through a local proxy (common
 * in WSL and Clash/Surge setups) every Wikidot request fails with a bare
 * "fetch failed" until this is installed. When no proxy env var is set the
 * original fetch is left untouched.
 *
 * Safe to call repeatedly; returns true when a proxy-aware fetch is active.
 */
export function installProxyFetch(): boolean {
  if (installed) return true;
  if (!hasProxyEnv()) return false;
  try {
    const dispatcher = new EnvHttpProxyAgent();
    const patched = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      undiciFetch(input as never, { ...(init as object), dispatcher } as never)) as typeof fetch;
    globalThis.fetch = patched;
    installed = true;
    return true;
  } catch {
    return false;
  }
}

installProxyFetch();
