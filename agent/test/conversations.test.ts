import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config';
import {
  activeConversation,
  createConversation,
  deleteConversation,
  publicState,
  pushDisplay,
  selectConversation,
  type WebSession,
} from '../src/server/sessions';
import { WikidotSession } from '../src/session';

function makeSession(): WebSession {
  const config = loadConfig({ envOnly: true });
  return {
    id: 's1',
    config,
    wikidot: new WikidotSession(config),
    policy: { hasUI: false },
    conversations: new Map(),
    activeId: '',
    account: { username: 'alice', userId: 1, displayName: 'Alice' },
    site: { unixName: 'scp-wiki', title: 'SCP', url: 'https://scp-wiki.wikidot.com' },
    busy: false,
    abort: null,
    emit: null,
    pending: new Map(),
  } as WebSession;
}

test('a conversation is created lazily and becomes active', () => {
  const session = makeSession();
  const conversation = activeConversation(session);
  assert.equal(session.conversations.size, 1);
  assert.equal(session.activeId, conversation.id);
  assert.equal(conversation.title, '新对话');
});

test('the first user message titles the conversation', () => {
  const session = makeSession();
  const conversation = createConversation(session);
  pushDisplay(conversation, { role: 'user', text: '读取 scp-173 的标签和评分', at: 1 });
  assert.equal(conversation.title, '读取 scp-173 的标签和评分');
  assert.equal(conversation.display.length, 1);
});

test('consecutive identical agent text is de-duplicated', () => {
  const session = makeSession();
  const conversation = createConversation(session);
  pushDisplay(conversation, { role: 'agent', text: '同样的话', at: 1 });
  pushDisplay(conversation, { role: 'agent', text: '同样的话', at: 2 });
  pushDisplay(conversation, { role: 'agent', text: '不同的话', at: 3 });
  assert.deepEqual(
    conversation.display.map((entry) => entry.text),
    ['同样的话', '不同的话']
  );
});

test('selecting and deleting conversations keeps an active one', () => {
  const session = makeSession();
  const first = createConversation(session);
  session.activeId = first.id;
  const second = createConversation(session);
  session.activeId = second.id;

  assert.equal(selectConversation(session, first.id)?.id, first.id);
  assert.equal(session.activeId, first.id);

  assert.equal(deleteConversation(session, first.id), true);
  assert.equal(session.conversations.size, 1);
  assert.equal(session.activeId, second.id);

  assert.equal(deleteConversation(session, 'missing'), false);

  // Deleting the last conversation creates a fresh one so the UI is never empty.
  assert.equal(deleteConversation(session, second.id), true);
  assert.equal(session.conversations.size, 1);
  assert.ok(session.conversations.has(session.activeId));
});

test('publicState lists conversations with an active flag', () => {
  const session = makeSession();
  const first = createConversation(session);
  session.activeId = first.id;
  const second = createConversation(session);
  session.activeId = second.id;
  pushDisplay(second, { role: 'user', text: 'hello', at: 1 });

  const state = publicState(session);
  assert.equal(state.connected, true);
  assert.equal(state.activeId, second.id);
  assert.equal(state.conversations.length, 2);
  const active = state.conversations.find((entry) => entry.active);
  assert.equal(active?.id, second.id);
  assert.equal(active?.title, 'hello');
  assert.equal(active?.messages, 1);
});
