import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { type DOMWindow, JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'static', 'index.html'), 'utf8');
const appSource = readFileSync(join(here, '..', 'static', 'app.js'), 'utf8');

interface FakeResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  body?: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } };
}

type Route = (url: string, init: RequestInit) => FakeResponse;

function jsonResponse(status: number, data: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
  };
}

function sseResponse(events: Array<[string, unknown]>): FakeResponse {
  const payload = events
    .map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
  const bytes = new TextEncoder().encode(payload);
  let sent = false;
  return {
    ok: true,
    status: 200,
    text: async () => payload,
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: bytes };
        },
      }),
    },
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface TestWindow extends DOMWindow {
  __wdai: {
    state: {
      view: string;
      connected: boolean;
      busy: boolean;
      activeId: string | null;
      conversations: Array<{ id: string; title: string; active: boolean; messages: number }>;
    };
  };
}

interface Harness {
  dom: JSDOM;
  window: TestWindow;
  calls: Array<{ url: string; init: RequestInit; body: unknown }>;
  submit: (id: string) => void;
}

async function setup(route: Route): Promise<Harness> {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const window = dom.window as unknown as TestWindow;
  const calls: Harness['calls'] = [];

  window.Element.prototype.scrollIntoView = () => undefined;
  (window as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
  (window as unknown as { fetch: unknown }).fetch = async (url: string, init: RequestInit = {}) => {
    let body: unknown;
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, init, body });
    return route(url, init) as unknown as Response;
  };

  window.eval(appSource);
  await tick();

  const submit = (id: string): void => {
    const form = window.document.getElementById(id);
    if (!form) throw new Error(`missing form #${id}`);
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  };

  return { dom, window, calls, submit };
}

function fill(window: TestWindow, id: string, value: string): void {
  const input = window.document.getElementById(id) as HTMLInputElement;
  input.value = value;
}

const connectRoute: Route = (url) => {
  if (url === '/api/session') return jsonResponse(200, { connected: false });
  if (url === '/api/connect') {
    return jsonResponse(200, {
      connected: true,
      account: { username: 'alice', userId: 7 },
      site: { title: 'SCP 中文分部', unixName: 'scp-wiki' },
      mode: 'confirm',
      model: 'deepseek-chat',
      busy: false,
      activeId: 'c1',
      conversations: [{ id: 'c1', title: '新对话', messages: 0, updatedAt: 1, active: true }],
    });
  }
  return jsonResponse(404, { error: 'unexpected' });
};

test('starts on the connect view with the console hidden', async () => {
  const { window } = await setup(connectRoute);
  assert.equal(window.__wdai.state.view, 'connect');
  assert.equal((window.document.getElementById('view-connect') as HTMLElement).hidden, false);
  assert.equal((window.document.getElementById('view-console') as HTMLElement).hidden, true);
});

test('the view tabs switch panes and update aria-current', async () => {
  const { window } = await setup(connectRoute);
  const consoleTab = window.document.querySelector('[data-view="console"]') as HTMLButtonElement;
  consoleTab.click();
  assert.equal((window.document.getElementById('view-console') as HTMLElement).hidden, false);
  assert.equal(consoleTab.getAttribute('aria-current'), 'page');
  const connectTab = window.document.querySelector('[data-view="connect"]') as HTMLButtonElement;
  assert.equal(connectTab.hasAttribute('aria-current'), false);
});

test('an empty form reports a text error and marks fields invalid', async () => {
  const { window, submit } = await setup(connectRoute);
  submit('connect-form');
  await tick();
  assert.equal(window.document.getElementById('connect-status')?.textContent, '请填写所有必填项。');
  assert.equal(window.document.getElementById('username')?.getAttribute('aria-invalid'), 'true');
  assert.equal(window.document.activeElement?.id, 'username');
});

test('a filled form connects and moves to the console', async () => {
  const { window, submit, calls } = await setup(connectRoute);
  fill(window, 'username', 'alice');
  fill(window, 'password', 'hunter2');
  fill(window, 'site', 'scp-wiki');
  fill(window, 'base-url', 'https://api.deepseek.com/v1');
  fill(window, 'api-key', 'sk-test');
  fill(window, 'model', 'deepseek-chat');
  submit('connect-form');
  await tick();
  await tick();

  assert.equal(window.__wdai.state.connected, true);
  assert.equal((window.document.getElementById('view-console') as HTMLElement).hidden, false);
  assert.equal(window.document.getElementById('fact-account')?.textContent, 'alice');
  assert.equal(window.document.getElementById('fact-mode')?.textContent, '每次确认');
  assert.equal(window.document.getElementById('conn-text')?.textContent, '已连接');

  const connectCall = calls.find((call) => call.url === '/api/connect');
  assert.ok(connectCall);
  assert.deepEqual(connectCall.body, {
    username: 'alice',
    password: 'hunter2',
    site: 'scp-wiki',
    mode: 'confirm',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test',
    model: 'deepseek-chat',
    remember: false,
  });
});

test('a failed connect shows the server error text', async () => {
  const route: Route = (url) => {
    if (url === '/api/session') return jsonResponse(200, { connected: false });
    return jsonResponse(400, { error: '登录失败：用户名或密码错误。' });
  };
  const { window, submit } = await setup(route);
  fill(window, 'username', 'alice');
  fill(window, 'password', 'wrong');
  fill(window, 'site', 'scp-wiki');
  fill(window, 'base-url', 'https://api.deepseek.com/v1');
  fill(window, 'api-key', 'sk-test');
  fill(window, 'model', 'deepseek-chat');
  submit('connect-form');
  await tick();
  await tick();
  assert.equal(
    window.document.getElementById('connect-status')?.textContent,
    '登录失败：用户名或密码错误。'
  );
  assert.equal(window.document.getElementById('connect-status')?.dataset.state, 'error');
  assert.equal(window.__wdai.state.connected, false);
});

test('sending a message renders agent text and tool activity', async () => {
  const route: Route = (url) => {
    if (url === '/api/session') return jsonResponse(200, { connected: false });
    if (url === '/api/connect') {
      return jsonResponse(200, {
        connected: true,
        account: { username: 'alice', userId: 7 },
        site: { title: 'SCP', unixName: 'scp-wiki' },
        mode: 'confirm',
        model: 'm',
      });
    }
    return sseResponse([
      ['tool', { phase: 'start', name: 'wikidot_get_page' }],
      [
        'tool',
        { phase: 'end', name: 'wikidot_get_page', ok: true, content: '# scp-173 - SCP-173' },
      ],
      ['text', { text: '页面读到了。' }],
      ['final', { text: '页面读到了，标签里有 euclid。', invocations: [] }],
      ['done', {}],
    ]);
  };
  const { window, submit } = await setup(route);
  fill(window, 'username', 'alice');
  fill(window, 'password', 'hunter2');
  fill(window, 'site', 'scp-wiki');
  fill(window, 'base-url', 'https://api.deepseek.com/v1');
  fill(window, 'api-key', 'sk-test');
  fill(window, 'model', 'deepseek-chat');
  submit('connect-form');
  await tick();
  await tick();

  fill(window, 'message', '读一下 scp-173');
  submit('composer');
  await tick();
  await tick();

  const log = window.document.getElementById('log') as HTMLElement;
  assert.match(log.textContent ?? '', /读一下 scp-173/);
  assert.match(log.textContent ?? '', /wikidot_get_page/);
  assert.match(log.textContent ?? '', /页面读到了，标签里有 euclid。/);
  const toolRow = log.querySelector('.tool') as HTMLElement;
  assert.equal(toolRow.dataset.ok, 'true');
  assert.equal(toolRow.querySelector('.tool-state')?.textContent, '完成');
  assert.equal((window.document.getElementById('send-btn') as HTMLButtonElement).disabled, false);
});

test('a confirm event opens the modal and approving posts the decision', async () => {
  const route: Route = (url) => {
    if (url === '/api/session') return jsonResponse(200, { connected: false });
    if (url === '/api/connect') {
      return jsonResponse(200, {
        connected: true,
        account: { username: 'alice', userId: 7 },
        site: { title: 'SCP', unixName: 'scp-wiki' },
        mode: 'confirm',
        model: 'm',
      });
    }
    if (url === '/api/confirm') return jsonResponse(200, { resolved: true });
    return sseResponse([
      ['confirm', { id: 'c1', title: 'Wikidot: create page?', message: 'PREVIEW BODY' }],
      ['final', { text: '已发布。', invocations: [] }],
      ['done', {}],
    ]);
  };
  const { window, submit, calls } = await setup(route);
  fill(window, 'username', 'alice');
  fill(window, 'password', 'hunter2');
  fill(window, 'site', 'scp-wiki');
  fill(window, 'base-url', 'https://api.deepseek.com/v1');
  fill(window, 'api-key', 'sk-test');
  fill(window, 'model', 'deepseek-chat');
  submit('connect-form');
  await tick();
  await tick();

  fill(window, 'message', '发一条评论');
  submit('composer');
  await tick();

  const layer = window.document.getElementById('modal-layer') as HTMLElement;
  assert.equal(layer.hidden, false);
  assert.equal(window.document.getElementById('modal-body')?.textContent, 'PREVIEW BODY');
  assert.equal(window.document.activeElement?.id, 'modal-approve');

  (window.document.getElementById('modal-approve') as HTMLButtonElement).click();
  await tick();
  await tick();

  const confirmCall = calls.find((call) => call.url === '/api/confirm');
  assert.ok(confirmCall);
  assert.deepEqual(confirmCall.body, { id: 'c1', approved: true });
  assert.equal(layer.hidden, true);
  assert.match(
    (window.document.getElementById('log') as HTMLElement).textContent ?? '',
    /已发布。/
  );
});

test('Escape declines a confirmation', async () => {
  const route: Route = (url) => {
    if (url === '/api/session') return jsonResponse(200, { connected: false });
    if (url === '/api/connect') {
      return jsonResponse(200, {
        connected: true,
        account: { username: 'alice', userId: 7 },
        site: { title: 'SCP', unixName: 'scp-wiki' },
        mode: 'confirm',
        model: 'm',
      });
    }
    if (url === '/api/confirm') return jsonResponse(200, { resolved: true });
    return sseResponse([
      ['confirm', { id: 'c2', title: 'x', message: 'PREVIEW' }],
      ['done', {}],
    ]);
  };
  const { window, submit, calls } = await setup(route);
  fill(window, 'username', 'alice');
  fill(window, 'password', 'hunter2');
  fill(window, 'site', 'scp-wiki');
  fill(window, 'base-url', 'https://api.deepseek.com/v1');
  fill(window, 'api-key', 'sk-test');
  fill(window, 'model', 'deepseek-chat');
  submit('connect-form');
  await tick();
  await tick();

  fill(window, 'message', '发一条评论');
  submit('composer');
  await tick();

  window.document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  await tick();
  await tick();

  const confirmCall = calls.find((call) => call.url === '/api/confirm');
  assert.ok(confirmCall);
  assert.deepEqual(confirmCall.body, { id: 'c2', approved: false });
});

test('the empty state offers example prompts that fill the composer', async () => {
  const { window } = await setup(connectRoute);
  const example = window.document.querySelector('.example') as HTMLButtonElement;
  assert.ok(example);
  example.click();
  const message = window.document.getElementById('message') as HTMLTextAreaElement;
  assert.equal(message.value, example.textContent);
});

async function connectFilled(route: Route): Promise<Harness> {
  const harness = await setup(route);
  fill(harness.window, 'username', 'alice');
  fill(harness.window, 'password', 'hunter2');
  fill(harness.window, 'site', 'scp-wiki');
  fill(harness.window, 'base-url', 'https://api.deepseek.com/v1');
  fill(harness.window, 'api-key', 'sk-test');
  fill(harness.window, 'model', 'deepseek-chat');
  harness.submit('connect-form');
  await tick();
  await tick();
  return harness;
}

test('the remember checkbox is sent to the server', async () => {
  const { window, submit, calls } = await setup(connectRoute);
  fill(window, 'username', 'alice');
  fill(window, 'password', 'hunter2');
  fill(window, 'site', 'scp-wiki');
  fill(window, 'base-url', 'https://api.deepseek.com/v1');
  fill(window, 'api-key', 'sk-test');
  fill(window, 'model', 'deepseek-chat');
  (window.document.getElementById('remember') as HTMLInputElement).checked = true;
  submit('connect-form');
  await tick();
  await tick();
  const call = calls.find((entry) => entry.url === '/api/connect');
  assert.ok(call);
  assert.equal((call.body as { remember: boolean }).remember, true);
});

test('the doctor button renders the report', async () => {
  const route: Route = (url) => {
    if (url === '/api/session') return jsonResponse(200, { connected: false });
    if (url === '/api/connect') {
      return jsonResponse(200, {
        connected: true,
        account: { username: 'alice', userId: 7 },
        site: { title: 'SCP', unixName: 'scp-wiki' },
        mode: 'confirm',
        model: 'm',
      });
    }
    if (url.startsWith('/api/doctor')) return jsonResponse(200, { ok: true, lines: ['LLM [ok]'] });
    return jsonResponse(404, { error: 'unexpected' });
  };
  const { window } = await connectFilled(route);
  (window.document.getElementById('doctor-btn') as HTMLButtonElement).click();
  await tick();
  await tick();
  const log = window.document.getElementById('doctor-log') as HTMLElement;
  assert.equal(log.hidden, false);
  assert.equal(log.textContent, 'LLM [ok]');
});

test('the disconnect button returns to the connect view', async () => {
  const route: Route = (url) => {
    if (url === '/api/session') return jsonResponse(200, { connected: false });
    if (url === '/api/connect') {
      return jsonResponse(200, {
        connected: true,
        account: { username: 'alice', userId: 7 },
        site: { title: 'SCP', unixName: 'scp-wiki' },
        mode: 'confirm',
        model: 'm',
      });
    }
    if (url === '/api/disconnect') return jsonResponse(200, { connected: false });
    return jsonResponse(404, { error: 'unexpected' });
  };
  const { window } = await connectFilled(route);
  (window.document.getElementById('disconnect-btn') as HTMLButtonElement).click();
  await tick();
  await tick();
  assert.equal(window.__wdai.state.connected, false);
  assert.equal((window.document.getElementById('view-connect') as HTMLElement).hidden, false);
  assert.equal(window.document.getElementById('conn-text')?.textContent, '未连接');
});

test('the decline button refuses the confirmation', async () => {
  const route: Route = (url) => {
    if (url === '/api/session') return jsonResponse(200, { connected: false });
    if (url === '/api/connect') {
      return jsonResponse(200, {
        connected: true,
        account: { username: 'alice', userId: 7 },
        site: { title: 'SCP', unixName: 'scp-wiki' },
        mode: 'confirm',
        model: 'm',
      });
    }
    if (url === '/api/confirm') return jsonResponse(200, { resolved: true });
    return sseResponse([
      ['confirm', { id: 'c3', title: 'x', message: 'PREVIEW' }],
      ['done', {}],
    ]);
  };
  const { window, calls, submit } = await connectFilled(route);
  fill(window, 'message', '发一条评论');
  submit('composer');
  await tick();
  (window.document.getElementById('modal-decline') as HTMLButtonElement).click();
  await tick();
  await tick();
  const call = calls.find((entry) => entry.url === '/api/confirm');
  assert.deepEqual(call?.body, { id: 'c3', approved: false });
});

function conversationRoute(extra: (url: string) => FakeResponse | null): Route {
  return (url) => {
    if (url === '/api/session') return jsonResponse(200, { connected: false });
    if (url === '/api/connect') {
      return jsonResponse(200, {
        connected: true,
        account: { username: 'alice', userId: 7 },
        site: { title: 'SCP', unixName: 'scp-wiki' },
        mode: 'confirm',
        model: 'm',
        busy: false,
        activeId: 'c1',
        conversations: [
          { id: 'c1', title: '旧对话', messages: 2, updatedAt: 1, active: true },
          { id: 'c2', title: '新对话', messages: 0, updatedAt: 2, active: false },
        ],
      });
    }
    const custom = extra(url);
    if (custom) return custom;
    return jsonResponse(404, { error: 'unexpected' });
  };
}

test('the new conversation button creates and selects an empty conversation', async () => {
  const route = conversationRoute((url) => {
    if (url === '/api/conversations') {
      return jsonResponse(200, {
        state: {
          conversations: [
            { id: 'c3', title: '新对话', messages: 0, updatedAt: 3, active: true },
            { id: 'c1', title: '旧对话', messages: 2, updatedAt: 1, active: false },
            { id: 'c2', title: '新对话', messages: 0, updatedAt: 2, active: false },
          ],
        },
        conversation: { id: 'c3', title: '新对话', display: [] },
      });
    }
    return null;
  });
  const { window } = await connectFilled(route);
  assert.equal(window.document.querySelectorAll('#convo-list li').length, 2);
  (window.document.getElementById('new-conversation') as HTMLButtonElement).click();
  await tick();
  await tick();
  assert.equal(window.document.querySelectorAll('#convo-list li').length, 3);
  assert.equal(window.__wdai.state.activeId, 'c3');
  assert.ok(window.document.querySelector('#log .empty'));
});

test('selecting a conversation renders its stored history', async () => {
  const route = conversationRoute((url) => {
    if (url === '/api/conversations/select') {
      return jsonResponse(200, {
        state: {
          conversations: [
            { id: 'c1', title: '旧对话', messages: 2, updatedAt: 1, active: false },
            { id: 'c2', title: '新对话', messages: 2, updatedAt: 2, active: true },
          ],
        },
        conversation: {
          id: 'c2',
          title: '新对话',
          display: [
            { role: 'user', text: '旧问题', at: 1 },
            { role: 'agent', text: '旧回答', at: 2 },
          ],
        },
      });
    }
    return null;
  });
  const { window } = await connectFilled(route);
  const button = window.document.querySelector('.convo-select[data-id="c2"]') as HTMLButtonElement;
  assert.ok(button);
  button.click();
  await tick();
  await tick();
  const log = window.document.getElementById('log') as HTMLElement;
  assert.match(log.textContent ?? '', /旧问题/);
  assert.match(log.textContent ?? '', /旧回答/);
  assert.equal(window.__wdai.state.activeId, 'c2');
});

test('deleting a conversation asks first and updates the list', async () => {
  const route = conversationRoute((url) => {
    if (url === '/api/conversations/delete') {
      return jsonResponse(200, {
        state: {
          conversations: [{ id: 'c1', title: '旧对话', messages: 2, updatedAt: 1, active: true }],
        },
        conversation: { id: 'c1', title: '旧对话', display: [] },
      });
    }
    return null;
  });
  const { window } = await connectFilled(route);
  (window as unknown as { confirm: () => boolean }).confirm = () => true;
  const rows = window.document.querySelectorAll('#convo-list .convo');
  assert.equal(rows.length, 2);
  const button = rows[1]?.querySelector('.convo-delete');
  assert.ok(button);
  (button as HTMLButtonElement).click();
  await tick();
  await tick();
  assert.equal(window.document.querySelectorAll('#convo-list li').length, 1);
});
