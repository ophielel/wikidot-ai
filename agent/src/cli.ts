#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface, type Interface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { WikidotAgent } from './agent';
import { type AgentConfig, type AgentMode, loadConfig } from './config';
import { runDoctor } from './doctor';
import { LlmClient } from './llm';
import { describeMode, type PolicyContext } from './policy';
import { startWebServer } from './server/server';
import { WikidotSession } from './session';
import { runSetup } from './setup';
import { normalizeSiteName } from './site-name';

interface CliOptions {
  request: string | null;
  site: string | null;
  mode: AgentMode | null;
  dryRun: boolean;
  yes: boolean;
  model: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  configPath: string | null;
  maxIterations: number | null;
  verbose: boolean;
  checkLlm: boolean;
  port: number;
  host: string;
  help: boolean;
  version: boolean;
}

const HELP = `wikidot-ai - an autonomous agent that operates a Wikidot account

Usage:
  wikidot-ai [options] "<request>"
  wikidot-ai [options]                 # interactive REPL
  wikidot-ai setup                     # write ~/.wikidot-ai/config.json
  wikidot-ai doctor [--llm]            # verify Wikidot login and LLM endpoint
  wikidot-ai serve [--port 8787]       # local web console

Examples:
  wikidot-ai "在 scp-wiki 的 scp-173 页面评论：写得很好"
  wikidot-ai --site scp-jp "给我在 9999 页面上追加一段测试段落"
  wikidot-ai --dry-run "把 scp-173 的正文改成 xxx"

Options:
  --site <unixName>        Target site; accepts a UNIX name, host or full URL
  --mode <mode>            readonly | confirm | auto (overrides config)
  --dry-run                Preview writes, never post
  -y, --yes                Shorthand for --mode auto
  --model <id>             LLM model id
  --base-url <url>         OpenAI-compatible base URL, e.g. https://api.deepseek.com/v1
  --api-key <key>          LLM API key
  --config <path>          Config file path
  --max-iterations <n>     Max LLM turns per request (default 30, or config maxIterations)
  --verbose                Print tool arguments and results
  --llm                    (doctor) send a test chat completion
  --port <n>               (serve) port for the web console, default 8787
  --host <ip>              (serve) bind address, default 127.0.0.1
  -h, --help               Show this help
  -v, --version            Show version

Config (highest precedence last):
  ~/.wikidot-ai.json
  ~/.wikidot-ai/config.json
  ./.wikidot-ai.json
  environment (WIKIDOT_USERNAME, WIKIDOT_PASSWORD, WIKIDOT_DEFAULT_SITE,
               WIKIDOT_AI_MODE, WIKIDOT_AI_LLM_BASE_URL, WIKIDOT_AI_LLM_API_KEY,
               WIKIDOT_AI_LLM_MODEL, or OPENAI_* equivalents)

Interactive commands: /new  /status  /mode <mode>  /exit`;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    request: null,
    site: null,
    mode: null,
    dryRun: false,
    yes: false,
    model: null,
    baseUrl: null,
    apiKey: null,
    configPath: null,
    maxIterations: null,
    verbose: false,
    checkLlm: false,
    port: 8787,
    host: '127.0.0.1',
    help: false,
    version: false,
  };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`Option ${arg} requires a value.`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--site':
        options.site = next();
        break;
      case '--mode': {
        const value = next().toLowerCase();
        if (!['readonly', 'confirm', 'auto'].includes(value)) {
          throw new Error(`Invalid --mode "${value}" (expected readonly, confirm or auto).`);
        }
        options.mode = value as AgentMode;
        break;
      }
      case '--dry-run':
        options.dryRun = true;
        break;
      case '-y':
      case '--yes':
        options.yes = true;
        break;
      case '--model':
        options.model = next();
        break;
      case '--base-url':
        options.baseUrl = next();
        break;
      case '--api-key':
        options.apiKey = next();
        break;
      case '--config':
        options.configPath = next();
        break;
      case '--max-iterations':
        options.maxIterations = Number.parseInt(next(), 10);
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--llm':
        options.checkLlm = true;
        break;
      case '--port':
        options.port = Number.parseInt(next(), 10);
        break;
      case '--host':
        options.host = next();
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-v':
      case '--version':
        options.version = true;
        break;
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
        rest.push(arg);
    }
  }

  if (rest.length > 0) options.request = rest.join(' ');
  return options;
}

function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, '..', '..', 'package.json'),
    join(here, '..', 'package.json'),
  ]) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // try the next candidate
    }
  }
  return '0.0.0';
}

function applyOverrides(config: AgentConfig, options: CliOptions): AgentConfig {
  const next: AgentConfig = { ...config, llm: { ...config.llm } };
  if (options.site) next.defaultSite = normalizeSiteName(options.site);
  if (options.mode) next.mode = options.mode;
  if (options.yes) next.mode = 'auto';
  if (options.model) next.llm.model = options.model;
  if (options.baseUrl) next.llm.baseUrl = options.baseUrl;
  if (options.apiKey) next.llm.apiKey = options.apiKey;
  return next;
}

interface CliPolicy extends PolicyContext {
  confirm: (title: string, message: string) => Promise<boolean>;
}

function createPolicy(rl: Interface | null): CliPolicy {
  const hasUI = Boolean(rl) && process.stdin.isTTY === true;
  const confirm = async (_title: string, message: string): Promise<boolean> => {
    if (!rl) return false;
    process.stderr.write(`\n${message}\n`);
    const answer = await rl.question('Approve? [y/N] ');
    return ['y', 'yes'].includes(answer.trim().toLowerCase());
  };
  return { hasUI, confirm, ui: { confirm } };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (options.version) {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }
  if (options.configPath) {
    process.env.WIKIDOT_AI_CONFIG = options.configPath;
  }

  const config = applyOverrides(loadConfig(), options);
  const session = new WikidotSession(config);
  const llm = new LlmClient(config.llm);

  const subcommand = options.request?.trim();
  if (subcommand === 'setup') {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      await runSetup(rl, options.configPath ?? undefined);
    } finally {
      rl.close();
    }
    return;
  }
  if (subcommand === 'doctor') {
    const report = await runDoctor(session, config, { checkLlm: options.checkLlm });
    process.stdout.write(`${report.lines.join('\n')}\n`);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (subcommand === 'serve') {
    const running = await startWebServer({ host: options.host, port: options.port });
    process.stdout.write(`Wikidot Operator 运行在 ${running.url}\n`);
    process.stdout.write('按 Ctrl+C 停止。\n');
    const shutdown = async (): Promise<void> => {
      await running.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  const interactive = options.request === null;
  // Keep a readline handle in one-shot mode too, so `confirm` can prompt on a TTY.
  const rl =
    interactive || process.stdin.isTTY === true
      ? createInterface({ input: process.stdin, output: process.stderr })
      : null;

  try {
    if (!interactive && !config.llm.model) {
      throw new Error(
        'No LLM model configured. Pass --model, or set llm.model / WIKIDOT_AI_LLM_MODEL / OPENAI_MODEL.'
      );
    }

    const agent = new WikidotAgent({
      session,
      llm,
      policy: createPolicy(rl),
      dryRun: options.dryRun,
      maxIterations: options.maxIterations ?? config.maxIterations,
      log: (message) => process.stderr.write(`${message}\n`),
      onToolCall: (event) => {
        if (event.phase === 'start') {
          const args = typeof event.args === 'string' ? event.args : JSON.stringify(event.args);
          process.stderr.write(`  → ${event.name}(${args.slice(0, 240)})\n`);
        } else if (options.verbose && event.content) {
          process.stderr.write(`  ← ${event.content.slice(0, 800)}\n`);
        }
      },
    });

    if (!interactive) {
      const result = await agent.run(options.request as string);
      if (result.text) process.stdout.write(`${result.text}\n`);
      else if (result.invocations.length > 0) {
        process.stdout.write(
          `Done (${result.invocations.length} tool call${result.invocations.length === 1 ? '' : 's'}).\n`
        );
      }
      if (result.truncated) {
        process.stderr.write(
          '\n已达到本轮工具调用上限，上面是阶段性总结。回复“继续”可以接着做。\n'
        );
      }
      return;
    }

    process.stderr.write(
      [
        'wikidot-ai interactive mode',
        `  account: ${config.username ?? '(not configured)'}  site: ${config.defaultSite ?? '(none)'}`,
        `  mode: ${config.mode} (${describeMode(config.mode)})${options.dryRun ? '  dry-run: on' : ''}`,
        '  type /help for commands, /exit to quit',
        '',
      ].join('\n')
    );

    for (;;) {
      const line = (await rl?.question('wikidot> ')) ?? '';
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (['/exit', '/quit', 'exit', 'quit', ':q'].includes(trimmed)) break;
      if (trimmed === '/help') {
        process.stderr.write('Commands: /new /status /mode <readonly|confirm|auto> /exit\n');
        continue;
      }
      if (trimmed === '/new' || trimmed === '/reset') {
        agent.reset();
        process.stderr.write('Started a new conversation.\n');
        continue;
      }
      if (trimmed.startsWith('/mode ')) {
        const value = trimmed.slice(6).trim().toLowerCase();
        if (!['readonly', 'confirm', 'auto'].includes(value)) {
          process.stderr.write('Usage: /mode <readonly|confirm|auto>\n');
          continue;
        }
        session.updateConfig({ mode: value as AgentMode });
        process.stderr.write(`Mode set to ${value}.\n`);
        continue;
      }
      if (trimmed === '/status') {
        const account = await session.account().catch(() => null);
        process.stderr.write(
          `${account ? `logged in as ${account.username}` : 'not logged in'} | site ${
            session.config.defaultSite ?? '(none)'
          } | mode ${session.config.mode}\n`
        );
        continue;
      }

      try {
        const result = await agent.run(trimmed);
        if (result.text) process.stdout.write(`\n${result.text}\n\n`);
        else process.stdout.write('\n(no text response)\n\n');
        if (result.truncated) {
          process.stderr.write(
            '达到本轮工具调用上限，上面是阶段性总结。回复“继续”可以接着做，/new 开新对话。\n'
          );
        }
      } catch (error) {
        process.stderr.write(
          `\nError: ${error instanceof Error ? error.message : String(error)}\n\n`
        );
      }
    }
  } finally {
    rl?.close();
    await session.logout().catch(() => undefined);
  }
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
