import type { AgentConfig } from './config';
import { unwrap } from './errors';
import { LlmClient } from './llm';
import { describeMode } from './policy';
import type { WikidotSession } from './session';

export interface DoctorOptions {
  /** Also send a tiny request to the LLM to verify the endpoint. */
  checkLlm?: boolean;
}

export interface DoctorReport {
  lines: string[];
  ok: boolean;
}

async function check(lines: string[], label: string, fn: () => Promise<string>): Promise<boolean> {
  try {
    const detail = await fn();
    lines.push(`  [ok]   ${label}${detail ? ` - ${detail}` : ''}`);
    return true;
  } catch (error) {
    lines.push(`  [fail] ${label} - ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Verify that the agent can actually reach Wikidot and the LLM with the
 * current configuration. Never posts anything.
 */
export async function runDoctor(
  session: WikidotSession,
  config: AgentConfig,
  options: DoctorOptions = {}
): Promise<DoctorReport> {
  const lines: string[] = ['Wikidot AI doctor', ''];
  let ok = true;

  lines.push('Configuration');
  lines.push(`  mode: ${config.mode} (${describeMode(config.mode)})`);
  lines.push(`  default site: ${config.defaultSite ?? '(not set)'}`);
  lines.push(`  allowed sites: ${config.allowedSites?.join(', ') ?? '(any)'}`);
  lines.push(`  config sources: ${config.sources.join(', ') || '(defaults only)'}`);
  lines.push(`  account: ${config.username ?? '(not configured - reads only)'}`);
  lines.push('');

  lines.push('Wikidot');
  if (config.username) {
    const loginOk = await check(lines, `login as ${config.username}`, async () => {
      const account = await session.account();
      return account ? `user id ${account.userId ?? '?'}` : 'logged in';
    });
    ok = ok && loginOk;
  } else {
    lines.push('  [skip] login - no username configured');
  }

  if (config.defaultSite) {
    const siteOk = await check(lines, `fetch site ${config.defaultSite}`, async () => {
      const site = await session.getSite(config.defaultSite);
      return `${site.title} (${site.getBaseUrl()})`;
    });
    ok = ok && siteOk;

    if (config.username) {
      await check(lines, `membership on ${config.defaultSite}`, async () => {
        const site = await session.getSite(config.defaultSite);
        const members = await unwrap(
          site.member.getAll(),
          `Listing members of ${config.defaultSite}`
        );
        const me = members.find((member) => member.user.name === config.username);
        if (!me) throw new Error('account is not a member of this site');
        return me.joinedAt ? `member since ${me.joinedAt.toISOString().slice(0, 10)}` : 'member';
      });
    }
  } else {
    lines.push('  [skip] default site - not configured');
  }

  lines.push('');
  lines.push('LLM');
  if (!config.llm.model) {
    lines.push('  [fail] model - not configured');
    ok = false;
  } else if (!config.llm.apiKey) {
    lines.push('  [fail] api key - not configured');
    ok = false;
  } else if (options.checkLlm) {
    const llmOk = await check(lines, `chat completion via ${config.llm.baseUrl}`, async () => {
      const client = new LlmClient(config.llm);
      const result = await client.chat({
        messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
      });
      return `model replied "${(result.message.content ?? '').trim().slice(0, 40)}"`;
    });
    ok = ok && llmOk;
  } else {
    lines.push(`  [ok]   model - ${config.llm.model} (pass --llm to test the endpoint)`);
  }

  return { lines, ok };
}
