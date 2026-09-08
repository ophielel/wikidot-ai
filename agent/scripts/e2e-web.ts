/**
 * In-process integration test for the web console server.
 *
 *   npx tsx agent/scripts/e2e-web.ts
 *
 * Runs on 127.0.0.1 in the same Node process, so no browser or external tool is
 * needed. It never contacts Wikidot: only the unauthenticated paths are probed.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWebServer } from '../src/server/server';

interface Check {
  name: string;
  run: () => Promise<string>;
}

async function main(): Promise<void> {
  // Isolate from the developer's real ~/.wikidot-ai/config.json so the empty
  // form check cannot fall back to saved credentials and hit the real API.
  process.env.WIKIDOT_AI_CONFIG = join(tmpdir(), 'wikidot-ai-e2e-missing.json');
  const running = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    ...(process.argv[2] ? { staticDir: process.argv[2] } : {}),
  });
  const address = running.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const header = { 'x-wikidot-ai': '1', 'content-type': 'application/json' };

  const checks: Check[] = [
    {
      name: 'GET / serves the console HTML',
      run: async () => {
        const response = await fetch(`${base}/`);
        const body = await response.text();
        if (response.status !== 200) throw new Error(`status ${response.status}`);
        if (!body.includes('Wikidot Operator')) throw new Error('missing product name');
        if (!response.headers.get('content-type')?.includes('text/html')) {
          throw new Error('wrong content type');
        }
        return '200 text/html, contains product name';
      },
    },
    {
      name: 'GET /styles.css and /app.js are served',
      run: async () => {
        const css = await fetch(`${base}/styles.css`);
        const js = await fetch(`${base}/app.js`);
        if (css.status !== 200 || js.status !== 200) throw new Error('static file missing');
        if (!css.headers.get('content-type')?.includes('text/css')) throw new Error('css type');
        if (!js.headers.get('content-type')?.includes('javascript')) throw new Error('js type');
        return '200 text/css and text/javascript';
      },
    },
    {
      name: 'GET /api/session reports disconnected',
      run: async () => {
        const response = await fetch(`${base}/api/session`);
        const data = (await response.json()) as { connected: boolean };
        if (response.status !== 200 || data.connected !== false)
          throw new Error('unexpected state');
        return '200 {connected:false}';
      },
    },
    {
      name: 'POST without the custom header is rejected',
      run: async () => {
        const response = await fetch(`${base}/api/connect`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        if (response.status !== 403) throw new Error(`status ${response.status}`);
        return '403 (CSRF guard)';
      },
    },
    {
      name: 'POST /api/connect validates missing fields',
      run: async () => {
        const response = await fetch(`${base}/api/connect`, {
          method: 'POST',
          headers: header,
          body: JSON.stringify({ username: '', password: '' }),
        });
        const data = (await response.json()) as { error?: string };
        if (response.status !== 400) throw new Error(`status ${response.status}`);
        if (!data.error) throw new Error('no error message');
        return `400 "${data.error}"`;
      },
    },
    {
      name: 'POST /api/chat without a session is 401',
      run: async () => {
        const response = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: header,
          body: JSON.stringify({ message: 'hello' }),
        });
        if (response.status !== 401) throw new Error(`status ${response.status}`);
        return '401 (no session)';
      },
    },
    {
      name: 'path traversal is blocked',
      run: async () => {
        const response = await fetch(`${base}/..%2f..%2fpackage.json`);
        if (response.status === 200) throw new Error('traversal succeeded');
        return `${response.status} (traversal blocked)`;
      },
    },
    {
      name: 'unknown API route is 404',
      run: async () => {
        const response = await fetch(`${base}/api/nope`);
        if (response.status !== 404) throw new Error(`status ${response.status}`);
        return '404';
      },
    },
  ];

  let failed = 0;
  for (const check of checks) {
    try {
      const detail = await check.run();
      console.log(`PASS  ${check.name}  ->  ${detail}`);
    } catch (error) {
      failed += 1;
      console.log(
        `FAIL  ${check.name}  ->  ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  await running.close();
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${checks.length} web server checks passed.`);
  }
}

main().catch((error) => {
  console.error('E2E WEB FAILED:', error);
  process.exitCode = 1;
});
