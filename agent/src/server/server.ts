import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDoctor } from '../doctor';
import {
  activeConversation,
  type ConnectInput,
  connectSession,
  conversationView,
  createConversation,
  deleteConversation,
  publicState,
  pushDisplay,
  releasePending,
  resolveConfirm,
  SessionStore,
  selectConversation,
  type WebSession,
} from './sessions';

export interface ServeOptions {
  host?: string;
  port?: number;
  staticDir?: string;
}

export interface RunningServer {
  server: Server;
  url: string;
  close: () => Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const MAX_BODY = 1_000_000;
const COOKIE = 'wdai_sid';
const AUTHENTICATED_PATHS = new Set([
  '/api/doctor',
  '/api/confirm',
  '/api/chat',
  '/api/conversations',
  '/api/conversations/select',
  '/api/conversations/delete',
]);

function staticDir(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const candidates = [
    join(here, 'static'),
    join(here, '..', '..', 'static'),
    join(here, '..', 'static'),
    here,
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) return candidate;
  }
  return candidates[0] as string;
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    let raw = '';
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        rejectBody(new Error('请求体过大。'));
        request.destroy();
        return;
      }
      raw += chunk.toString('utf8');
    });
    request.on('end', () => {
      if (!raw) {
        resolveBody({});
        return;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        resolveBody(
          parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
        );
      } catch {
        rejectBody(new Error('请求体不是合法 JSON。'));
      }
    });
    request.on('error', rejectBody);
  });
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  const host = request.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function serveStatic(root: string, urlPath: string, response: ServerResponse): void {
  const relative = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const target = resolve(root, normalize(relative));
  if (!target.startsWith(resolve(root))) {
    json(response, 403, { error: '非法路径。' });
    return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    json(response, 404, { error: '未找到。' });
    return;
  }
  response.writeHead(200, {
    'content-type': MIME[extname(target)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(target).pipe(response);
}

function startSse(response: ServerResponse): (event: string, data: unknown) => void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  response.write(': connected\n\n');
  return (event, data) => {
    if (response.writableEnded) return;
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

/**
 * Local HTTP server for the web console. Binds to loopback by default and
 * requires a custom header on every state-changing request, so a random page in
 * the same browser cannot drive the agent.
 */
export function createWebServer(options: ServeOptions = {}): RunningServer {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8787;
  const root = options.staticDir ?? staticDir();
  const store = new SessionStore();

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (!response.headersSent) {
        json(response, 500, { error: error instanceof Error ? error.message : String(error) });
      } else if (!response.writableEnded) {
        response.end();
      }
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    if (path === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (!path.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        json(response, 405, { error: '方法不被允许。' });
        return;
      }
      serveStatic(root, path, response);
      return;
    }

    if (method === 'POST') {
      if (!sameOrigin(request) || request.headers['x-wikidot-ai'] !== '1') {
        json(response, 403, { error: '请求被拒绝：来源校验失败。' });
        return;
      }
    }

    const session = store.get(parseCookies(request.headers.cookie)[COOKIE]);

    if (path === '/api/session' && method === 'GET') {
      json(response, 200, publicState(session));
      return;
    }

    if (path === '/api/connect' && method === 'POST') {
      const body = (await readJson(request)) as ConnectInput;
      if (session) await store.delete(session.id);
      let created: WebSession;
      try {
        created = await connectSession(body);
      } catch (error) {
        json(response, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      store.set(created.id, created);
      response.setHeader(
        'set-cookie',
        `${COOKIE}=${created.id}; HttpOnly; SameSite=Strict; Path=/`
      );
      json(response, 200, publicState(created));
      return;
    }

    if (path === '/api/disconnect' && method === 'POST') {
      if (session) await store.delete(session.id);
      response.setHeader('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      json(response, 200, publicState(undefined));
      return;
    }

    if (!AUTHENTICATED_PATHS.has(path)) {
      json(response, 404, { error: '未知接口。' });
      return;
    }

    if (!session) {
      json(response, 401, { error: '还没有连接 Wikidot 账号。' });
      return;
    }

    if (path === '/api/doctor' && method === 'GET') {
      const report = await runDoctor(session.wikidot, session.config, {
        checkLlm: url.searchParams.get('llm') === '1',
      });
      json(response, 200, report);
      return;
    }

    if (path === '/api/confirm' && method === 'POST') {
      const body = await readJson(request);
      const id = typeof body.id === 'string' ? body.id : '';
      const approved = body.approved === true;
      const found = resolveConfirm(session, id, approved);
      json(response, found ? 200 : 404, { resolved: found });
      return;
    }

    if (path === '/api/conversations' && method === 'POST') {
      const conversation = createConversation(session);
      session.activeId = conversation.id;
      json(response, 200, {
        state: publicState(session),
        conversation: conversationView(conversation),
      });
      return;
    }

    if (path === '/api/conversations/select' && method === 'POST') {
      const body = await readJson(request);
      const id = typeof body.id === 'string' ? body.id : '';
      const conversation = selectConversation(session, id);
      if (!conversation) {
        json(response, 404, { error: '对话不存在。' });
        return;
      }
      json(response, 200, {
        state: publicState(session),
        conversation: conversationView(conversation),
      });
      return;
    }

    if (path === '/api/conversations/delete' && method === 'POST') {
      const body = await readJson(request);
      const id = typeof body.id === 'string' ? body.id : '';
      if (!deleteConversation(session, id)) {
        json(response, 404, { error: '对话不存在。' });
        return;
      }
      json(response, 200, {
        state: publicState(session),
        conversation: conversationView(activeConversation(session)),
      });
      return;
    }

    if (path === '/api/chat' && method === 'POST') {
      const body = await readJson(request);
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message) {
        json(response, 400, { error: '请输入要让 agent 执行的请求。' });
        return;
      }
      if (session.busy) {
        json(response, 409, { error: 'agent 正在处理上一条请求，请等它结束。' });
        return;
      }
      await runChat(session, message, request, response);
      return;
    }

    json(response, 404, { error: '未知接口。' });
  }

  async function runChat(
    session: WebSession,
    message: string,
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const conversation = activeConversation(session);
    pushDisplay(conversation, { role: 'user', text: message, at: Date.now() });
    const emit = startSse(response);
    session.emit = emit;
    session.busy = true;
    session.abort = new AbortController();
    const keepAlive = setInterval(() => {
      if (!response.writableEnded) response.write(': ping\n\n');
    }, 15_000);

    const onClose = (): void => {
      clearInterval(keepAlive);
      session.abort?.abort();
      releasePending(session);
      session.emit = null;
      session.busy = false;
    };
    request.on('close', onClose);

    try {
      const result = await conversation.agent.run(message, session.abort.signal);
      emit('final', {
        text: result.text,
        truncated: result.truncated,
        conversationId: conversation.id,
        state: publicState(session),
        invocations: result.invocations.map((entry) => ({
          name: entry.name,
          ok: entry.ok,
          content: entry.content,
        })),
      });
    } catch (error) {
      emit('error', { message: error instanceof Error ? error.message : String(error) });
    } finally {
      clearInterval(keepAlive);
      emit('done', {});
      if (!response.writableEnded) response.end();
      session.emit = null;
      session.busy = false;
    }
  }

  return {
    server,
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
    close: async () => {
      await store.closeAll();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    },
  };
}

/** Start the server and resolve once it is listening. */
export async function startWebServer(options: ServeOptions = {}): Promise<RunningServer> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8787;
  const running = createWebServer(options);
  await new Promise<void>((resolveListen, rejectListen) => {
    running.server.once('error', rejectListen);
    running.server.listen(port, host, () => {
      running.server.off('error', rejectListen);
      resolveListen();
    });
  });
  return running;
}
