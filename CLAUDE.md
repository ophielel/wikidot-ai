# CLAUDE.md - wikidot-ts Project Guide

This document is a project guide for AI agents.

## Project Overview

**wikidot-ts** is a utility library for interacting with Wikidot sites in TypeScript. It is a TypeScript port of wikidot.py.

- **Version**: 4.0.x
- **Node.js Support**: 18 or higher
- **License**: MIT
- **Package Name**: `@ukwhatn/wikidot`

### Main Features

- Site information retrieval and management
- Page creation, editing, deletion, and search (ListPagesModule support)
- User information retrieval and search
- Forum operations (categories, threads, posts)
- Private message sending and receiving
- Authentication (public information accessible without login)
- `agent/`: LLM tool-calling agent + CLI that operates a real account (`wikidot-ai`)

## Directory Structure

```
wikidot-ts/
├── src/
│   ├── index.ts              # Package entry point
│   ├── common/               # Common utilities
│   │   ├── decorators.ts     # @loginRequired decorator
│   │   ├── errors/           # Custom errors
│   │   ├── logger.ts         # Logging configuration
│   │   └── types/            # Common type definitions
│   ├── connector/            # HTTP communication
│   │   ├── amc-client.ts     # AjaxModuleConnectorClient
│   │   └── auth.ts           # Authentication handling
│   ├── module/               # Core modules
│   │   ├── client/           # Client (main entry point)
│   │   ├── site/             # Site (site management)
│   │   ├── page/             # Page (page operations)
│   │   ├── user/             # User hierarchy
│   │   ├── forum/            # Forum related
│   │   ├── private-message/  # Private messages
│   │   └── types.ts          # Module common types
│   └── util/                 # Utilities
│       ├── quick-module.ts   # QuickModule search
│       ├── string.ts         # String conversion
│       └── parser/           # HTML parser
├── tests/
│   ├── unit/                 # Unit tests
│   ├── integration/          # Integration tests
│   ├── fixtures/             # Test fixtures
│   └── mocks/                # Mocks
├── package.json              # Project configuration
├── tsconfig.json             # TypeScript configuration
└── biome.json                # Biome configuration
```

## Development Commands

```bash
# Install dependencies
bun install

# Format
bun run format

# Lint
bun run lint

# Fix lint issues
bun run lint:fix

# Type check
bun run typecheck

# Run tests
bun test              # All tests
bun test:cov          # With coverage

# Build
bun run build

# AI agent (works with npm too; does not require bun)
npm run agent -- --help          # CLI help
npm run agent -- setup           # write ~/.wikidot-ai/config.json
npm run agent -- doctor --llm    # verify Wikidot + LLM connectivity
npm run agent -- "<request>"     # one-shot request
npm run agent:typecheck          # tsc -p agent/tsconfig.json
npm run agent:test               # node --import tsx --test agent/test/*.test.ts
npm run agent:serve              # web console on 127.0.0.1:8787
npm run agent:build              # bundle to dist-agent/
```

## Architecture

### Design Patterns

1. **Facade Pattern**: `Client` provides a unified interface to multiple systems
2. **Accessor Pattern**: Groups functionality (`client.user`, `client.site`, `site.page`, etc.)
3. **Collection Pattern**: Bulk operations on multiple resources (`PageCollection`, `UserCollection`, etc.)
4. **Factory Pattern**: Static methods like `Page.fromName()`, `Site.fromUnixName()`

### Core Classes

All async methods return `WikidotResultAsync<T>`. Check with `isOk()`, then access the value with `.value`.

```typescript
import { Client } from '@ukwhatn/wikidot';

// Client - Main entry point
const clientResult = await Client.create({ username, password });
if (!clientResult.isOk()) throw new Error('Failed');
const client = clientResult.value;

// Site - Site operations
const siteResult = await client.site.get("scp-jp");
if (!siteResult.isOk()) throw new Error('Failed');
const site = siteResult.value;

// Page search
const pagesResult = await site.pages.search({ category: "*", tags: ["tag1"] });
if (!pagesResult.isOk()) throw new Error('Failed');
const pages = pagesResult.value;

// Page - Page operations
const pageResult = await site.page.get("page-name");
if (!pageResult.isOk()) throw new Error('Failed');
const page = pageResult.value;
await page.getSource();
await page.getVotes();
```

### User Hierarchy

```
AbstractUser (base)
├── User            # Regular user
├── DeletedUser     # Deleted user
├── AnonymousUser   # Anonymous user
├── GuestUser       # Guest user
└── WikidotUser     # Wikidot system user
```

### Error Handling

Errors are handled using Result type from the neverthrow library:

```typescript
type WikidotResult<T, E = WikidotError> = Result<T, E>;
type WikidotResultAsync<T, E = WikidotError> = ResultAsync<T, E>;
```

### Error Hierarchy

```
WikidotError (base)
├── UnexpectedError
├── SessionCreateError
├── LoginRequiredError
├── AMCError
│   ├── AMCHttpStatusError
│   ├── WikidotStatusError
│   └── ResponseDataError
├── NotFoundError
├── TargetExistsError
├── TargetError
├── ForbiddenError
└── NoElementError
```

## Code Quality Configuration

### Biome (Linter/Formatter)

- Line length: 120 characters
- Indent: Tabs (width 2)
- Semicolons: Required
- Quotes: Double

### TypeScript

- strict: true
- target: ESNext
- module: ESNext

### Bun Test

- Coverage target: 80% or higher

## Important Implementation Details

### Authentication Flow

1. Create client with `Client.create({ username, password })`
2. Internally calls `login()` -> POSTs to Wikidot login endpoint
3. Extracts `WIKIDOT_SESSION_ID` cookie
4. Validated by `@loginRequired` decorator

### HTML Parsing

- Uses cheerio library
- `odateParse()`: Converts Wikidot datetime elements to Date
- `userParse()`: Automatically determines User type from HTML elements

### SearchPagesQuery

Expresses complex ListPagesModule queries in TypeScript:

```typescript
interface SearchPagesQuery {
  pagetype?: string;
  category?: string;
  tags?: string | string[];
  parent?: string;
  createdBy?: User | string;
  rating?: string;
  order?: string;
  offset?: number;
  limit?: number;
}
```

## Environment Variables

```bash
WIKIDOT_USERNAME=your_username
WIKIDOT_PASSWORD=your_password
```

## Dependencies

### Required

- `cheerio` - HTML parsing
- `ky` - HTTP client
- `neverthrow` - Result type
- `p-limit` - Concurrency limiting
- `zod` - Schema validation

### Development

- `@biomejs/biome` - Linter/formatter
- `typescript` - Type checking
- `bunup` - Bundler

## CI/CD

### GitHub Actions

- **check_code_quality.yml**: On PR: format -> lint -> typecheck -> test
- **publish.yml**: On release: publish to npm

## Additional Information for Subagent Calls

### quality-checker / lint-runner / format-runner / typecheck-runner / test-runner

```
lint: bun run lint
format: bun run format
typecheck: bun run typecheck
test: bun test
```

### self-reviewer / pr-reviewer

```
Base branch: main
Architecture rules:
  - Facade pattern (Client)
  - Accessor pattern
  - Result-based error handling
Additional checks:
  - Proper use of neverthrow Result type
  - Avoid circular dependencies (use Ref types in types.ts)
```

## Notes

- Maintain TypeScript strict mode
- Use Ref type interfaces in `module/types.ts` to avoid circular dependencies
- Return errors using `neverthrow` Result type (avoid throwing exceptions)
- Public APIs should follow the Accessor pattern
- Maintain compatibility with Python version (wikidot.py)

## AI Agent Layer (`agent/`)

The agent is a separate application that consumes the library; `src/` must stay
free of agent-specific code. Key rules:

- `agent/src/agent.ts` owns the LLM tool-calling loop; `agent/src/tools/` defines
  the model-facing tools. `readTool` / `writeTool` builders in `tools/build.ts`
  enforce the shared contract: read-only `prepare()` → policy gate → execute → audit.
- Every mutating tool MUST go through `writeTool` so `dryRun`, `allowedSites`,
  confirmation and auditing cannot be bypassed by the model.
- Write policy is config-driven (`config.mode`), never model-driven.
- `agent/src/ops.ts` is the only place that calls the Wikidot SDK; it returns
  serializable plain objects and throws `WikidotAgentError`.
- Tests use Node's built-in runner (`node --import tsx --test`), not bun, so the
  agent stays runnable without bun. LLM behaviour is tested against a local
  `node:http` mock server, never the real API.
- `agent/src/server/` serves the web console: `server.ts` owns routing, SSE and
  static files; `sessions.ts` owns per-browser agent state, the conversation list
  (each conversation has its own `WikidotAgent` history) and the confirmation
  bridge. The browser never receives credentials.
- `agent/src/agent.ts` is budgeted: `maxIterations` (default 30) is a wrap-up
  threshold, not a failure. Hitting it triggers a tools-disabled summary call and
  returns `truncated: true`; never throw away finished tool work.
- `agent/static/` is the frontend (plain HTML/CSS/JS, no build step), served from
  the source tree in dev and copied into `dist-agent/` by tsup `publicDir`.
- `agent/DESIGN.md` holds the UI direction; follow the antislop skills for any UI
  change. UI behaviour is covered by `agent/test/web-ui.test.ts` (jsdom).
- Run `npx biome check --write agent/` before committing agent changes.

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, use the installed
antislop skills: `antislop` (core) plus the skill for the task,
one of `antislop-ui`, `antislop-copywriting`, `antislop-human`,
`antislop-layoutmobile`, `antislop-code`.

UI direction for the web console lives in `agent/DESIGN.md` (agent-authored; the
owner can replace it). Before starting UI work, ask the user when antislop
applies: during the work, or after it is done.
<!-- antislop:end -->
