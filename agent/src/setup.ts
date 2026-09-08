import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Interface } from 'node:readline/promises';
import type { RawAgentConfig } from './config';

export const DEFAULT_CONFIG_PATH = join(homedir(), '.wikidot-ai', 'config.json');

async function ask(rl: Interface, label: string, fallback = ''): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || fallback;
}

async function askChoice(
  rl: Interface,
  label: string,
  choices: string[],
  fallback: string
): Promise<string> {
  for (;;) {
    const answer = await ask(rl, `${label} (${choices.join('/')})`, fallback);
    if (choices.includes(answer)) return answer;
    process.stderr.write(`  please choose one of: ${choices.join(', ')}\n`);
  }
}

function readExisting(path: string): RawAgentConfig {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RawAgentConfig;
  } catch {
    return {};
  }
}

/**
 * Interactive setup wizard. Writes `~/.wikidot-ai/config.json` (0600).
 *
 * Passwords are stored in plain text because a headless bot must be able to
 * read them; the file permission is the protection.
 */
export async function runSetup(rl: Interface, path = DEFAULT_CONFIG_PATH): Promise<string> {
  process.stderr.write(
    [
      '',
      'Wikidot AI setup',
      `Config file: ${path}`,
      'Press Enter to keep the current value shown in brackets.',
      '',
    ].join('\n')
  );

  const existing = readExisting(path);
  const username = await ask(rl, 'Wikidot username', existing.username ?? '');
  const password = await ask(rl, 'Wikidot password', existing.password ?? '');
  const defaultSite = await ask(
    rl,
    'Default site UNIX name (e.g. scp-wiki)',
    existing.defaultSite ?? ''
  );
  const mode = await askChoice(
    rl,
    'Write policy (readonly = never post, confirm = ask first, auto = post immediately)',
    ['readonly', 'confirm', 'auto'],
    existing.mode ?? 'confirm'
  );
  const allowedSitesRaw = await ask(
    rl,
    'Restrict writes to these sites (comma separated, empty = any)',
    existing.allowedSites?.join(',') ?? ''
  );

  process.stderr.write('\nLLM (OpenAI-compatible chat completions)\n');
  const baseUrl = await ask(
    rl,
    'LLM base URL (e.g. https://api.deepseek.com/v1)',
    existing.llm?.baseUrl ?? 'https://api.openai.com/v1'
  );
  const apiKey = await ask(rl, 'LLM API key', existing.llm?.apiKey ?? '');
  const model = await ask(rl, 'LLM model id (e.g. deepseek-chat)', existing.llm?.model ?? '');
  const temperature = await ask(rl, 'LLM temperature', String(existing.llm?.temperature ?? 0.2));

  const config: RawAgentConfig = {
    ...existing,
    username: username || undefined,
    password: password || undefined,
    defaultSite: defaultSite || undefined,
    mode,
    allowedSites: allowedSitesRaw
      ? allowedSitesRaw
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : undefined,
    llm: {
      ...existing.llm,
      baseUrl,
      apiKey: apiKey || undefined,
      model: model || undefined,
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
    },
  };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ignores POSIX permissions.
  }

  process.stderr.write(`\nWrote ${path}\n`);
  if (mode === 'auto') {
    process.stderr.write(
      'Write policy is "auto": the agent will post without asking. Use --mode confirm to change this per run.\n'
    );
  }
  return path;
}
