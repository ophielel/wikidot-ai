(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    connected: false,
    busy: false,
    view: 'connect',
    activeId: null,
    conversations: [],
    runningRows: [],
    lastFocus: null,
  };

  /* ------------------------------------------------------------------ api */

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        'content-type': 'application/json',
        'x-wikidot-ai': '1',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text };
    }
    if (!response.ok) {
      throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
    }
    return data;
  }

  /* ---------------------------------------------------------------- views */

  function setView(name) {
    state.view = name;
    for (const view of document.querySelectorAll('.view')) {
      view.hidden = view.id !== `view-${name}`;
    }
    for (const tab of document.querySelectorAll('.view-tab')) {
      const active = tab.dataset.view === name;
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    if (name === 'console') $('message').focus();
  }

  function setConn(stateName, text) {
    $('conn').querySelector('.dot').dataset.state = stateName;
    $('conn-text').textContent = text;
  }

  function setFormStatus(text, stateName) {
    const el = $('connect-status');
    el.textContent = text;
    if (stateName) el.dataset.state = stateName;
    else delete el.dataset.state;
  }

  /* ------------------------------------------------------------- connect */

  function formValue(id) {
    return $(id).value.trim();
  }

  function markInvalid(id, invalid) {
    const field = $(id);
    if (invalid) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  }

  async function connect(event) {
    if (event) event.preventDefault();
    const required = ['username', 'password', 'site', 'base-url', 'api-key', 'model'];
    const missing = required.filter((id) => formValue(id) === '');
    for (const id of required) markInvalid(id, missing.includes(id));
    if (missing.length > 0) {
      setFormStatus('请填写所有必填项。', 'error');
      $(missing[0]).focus();
      return;
    }

    const button = $('connect-btn');
    button.disabled = true;
    setFormStatus('正在登录 Wikidot 并检查大模型…', 'busy');
    setConn('busy', '连接中');

    try {
      const payload = {
        username: formValue('username'),
        password: $('password').value,
        site: formValue('site'),
        mode: document.querySelector('input[name="mode"]:checked').value,
        baseUrl: formValue('base-url'),
        apiKey: $('api-key').value,
        model: formValue('model'),
        remember: $('remember').checked,
      };
      const data = await api('/api/connect', { method: 'POST', body: JSON.stringify(payload) });
      state.connected = true;
      setConn('on', '已连接');
      setFormStatus('连接成功，可以切到控制台发指令了。', 'ok');
      renderFacts(data);
      renderConversations(data.conversations || []);
      renderDisplay([]);
      setView('console');
    } catch (error) {
      state.connected = false;
      setConn('error', '连接失败');
      setFormStatus(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function renderFacts(data) {
    $('fact-account').textContent = data.account ? data.account.username : '未知';
    $('fact-site').textContent = data.site
      ? `${data.site.title}（${data.site.unixName}）`
      : '未设置';
    $('fact-mode').textContent = modeLabel(data.mode);
    $('fact-model').textContent = data.model || '未设置';
  }

  function modeLabel(mode) {
    if (mode === 'readonly') return '只读';
    if (mode === 'confirm') return '每次确认';
    if (mode === 'auto') return '自动发布';
    return '未知';
  }

  /* --------------------------------------------------------- conversations */

  function renderConversations(list) {
    state.conversations = list || [];
    state.activeId = state.conversations.find((item) => item.active)?.id || state.activeId;
    const ul = $('convo-list');
    ul.textContent = '';
    for (const conversation of state.conversations) {
      const li = document.createElement('li');
      li.className = 'convo';

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'convo-select';
      select.dataset.id = conversation.id;
      if (conversation.active) select.setAttribute('aria-current', 'true');

      const title = document.createElement('span');
      title.className = 'convo-title';
      title.textContent = conversation.title;
      const meta = document.createElement('span');
      meta.className = 'convo-meta';
      meta.textContent = `${conversation.messages} 条`;
      select.append(title, meta);
      select.addEventListener('click', () => selectConversation(conversation.id));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'convo-delete';
      remove.textContent = '删除';
      remove.setAttribute('aria-label', `删除对话：${conversation.title}`);
      remove.addEventListener('click', () => deleteConversation(conversation.id));

      li.append(select, remove);
      ul.append(li);
    }
  }

  async function selectConversation(id) {
    if (state.busy || id === state.activeId) return;
    try {
      const data = await api('/api/conversations/select', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      state.activeId = data.conversation.id;
      renderConversations(data.state.conversations);
      renderDisplay(data.conversation.display);
      $('message').focus();
    } catch (error) {
      appendNotice(`切换对话失败：${error.message}`);
    }
  }

  async function newConversation() {
    if (state.busy) return;
    try {
      const data = await api('/api/conversations', { method: 'POST', body: '{}' });
      state.activeId = data.conversation.id;
      renderConversations(data.state.conversations);
      renderDisplay([]);
      $('message').focus();
    } catch (error) {
      appendNotice(`新建对话失败：${error.message}`);
    }
  }

  async function deleteConversation(id) {
    if (state.busy) return;
    const target = state.conversations.find((item) => item.id === id);
    const label = target ? target.title : '这个对话';
    if (!window.confirm(`删除「${label}」？这个对话的记录会从本页消失。`)) return;
    try {
      const data = await api('/api/conversations/delete', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      state.activeId = data.conversation.id;
      renderConversations(data.state.conversations);
      renderDisplay(data.conversation.display);
    } catch (error) {
      appendNotice(`删除对话失败：${error.message}`);
    }
  }

  /* ---------------------------------------------------------------- log */

  function clearEmpty() {
    const empty = $('log').querySelector('.empty');
    if (empty) empty.remove();
  }

  function renderEmpty() {
    const log = $('log');
    log.textContent = '';
    const box = document.createElement('div');
    box.className = 'empty';
    box.innerHTML = `
      <h3>还没有对话</h3>
      <p>输入一句话，agent 会自己判断要调用哪些工具，再回到这里报告结果。下面几条可以直接改。</p>
      <div class="examples"></div>
    `;
    const examples = [
      '读取 scp-wiki 的 scp-173，告诉我它的标签和评分',
      '在 scp-wiki 的 scp-173 页面评论：写得很好',
      '列出 scp-wiki 的论坛分类',
    ];
    const wrap = box.querySelector('.examples');
    for (const text of examples) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'example';
      button.textContent = text;
      button.addEventListener('click', () => {
        $('message').value = text;
        $('message').focus();
      });
      wrap.append(button);
    }
    log.append(box);
  }

  function appendEntry(role, text) {
    clearEmpty();
    const entry = document.createElement('article');
    entry.className = `entry entry-${role}`;
    const label = document.createElement('span');
    label.className = 'entry-role';
    label.textContent = role === 'user' ? '你' : role === 'agent' ? 'agent' : '错误';
    const body = document.createElement('p');
    body.className = 'entry-text';
    if (role === 'error') body.classList.add('error');
    body.textContent = text;
    entry.append(label, body);
    $('log').append(entry);
    $('log').scrollIntoView({ block: 'end' });
    return entry;
  }

  function appendNotice(text) {
    clearEmpty();
    const notice = document.createElement('p');
    notice.className = 'notice';
    notice.textContent = text;
    $('log').append(notice);
    $('log').scrollIntoView({ block: 'end' });
  }

  /** Append agent prose unless it repeats the previous agent entry verbatim. */
  function appendAgentText(text) {
    const agents = $('log').querySelectorAll('.entry-agent .entry-text');
    const last = agents[agents.length - 1];
    if (last && last.textContent === text) return;
    appendEntry('agent', text);
  }

  function createToolRow(name) {
    clearEmpty();
    const entry = document.createElement('article');
    entry.className = 'entry tool tool-running';
    entry.dataset.ok = 'pending';

    const head = document.createElement('div');
    head.className = 'tool-head';
    const toolName = document.createElement('span');
    toolName.className = 'tool-name';
    toolName.textContent = name;
    const toolState = document.createElement('span');
    toolState.className = 'tool-state';
    toolState.textContent = '执行中';
    head.append(toolName, toolState);

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '查看返回内容';
    const pre = document.createElement('pre');
    details.append(summary, pre);
    details.hidden = true;

    entry.append(head, details);
    $('log').append(entry);
    $('log').scrollIntoView({ block: 'end' });
    return { entry, pre, details, toolState };
  }

  function addToolRow(name) {
    const row = createToolRow(name);
    state.runningRows.push({ name, ...row });
    return row.entry;
  }

  function finishToolRow(name, ok, content) {
    let index = -1;
    for (let i = state.runningRows.length - 1; i >= 0; i -= 1) {
      if (state.runningRows[i].name === name) {
        index = i;
        break;
      }
    }
    if (index === -1) {
      const row = createToolRow(name);
      finalizeRow(row, ok, content);
      return row.entry;
    }
    const row = state.runningRows.splice(index, 1)[0];
    finalizeRow(row, ok, content);
    return row.entry;
  }

  function finalizeRow(row, ok, content) {
    row.entry.classList.remove('tool-running');
    row.entry.dataset.ok = String(Boolean(ok));
    row.toolState.textContent = ok ? '完成' : '失败';
    if (content) {
      row.pre.textContent = content;
      row.details.hidden = false;
    }
  }

  function appendToolEntry(name, ok, content) {
    const row = createToolRow(name);
    finalizeRow(row, ok, content);
  }

  function renderDisplay(entries) {
    state.runningRows = [];
    $('log').textContent = '';
    if (!entries || entries.length === 0) {
      renderEmpty();
      return;
    }
    for (const entry of entries) {
      if (entry.role === 'tool') appendToolEntry(entry.name, entry.ok, entry.text);
      else appendEntry(entry.role, entry.text);
    }
  }

  /* -------------------------------------------------------------- modal */

  function showConfirm(message) {
    const layer = $('modal-layer');
    state.lastFocus = document.activeElement;
    $('modal-body').textContent = message;
    layer.hidden = false;
    $('modal-approve').focus();
    return new Promise((resolve) => {
      const finish = (approved) => {
        layer.hidden = true;
        document.removeEventListener('keydown', onKey);
        $('modal-approve').removeEventListener('click', approve);
        $('modal-decline').removeEventListener('click', decline);
        if (state.lastFocus?.focus) state.lastFocus.focus();
        resolve(approved);
      };
      const approve = () => finish(true);
      const decline = () => finish(false);
      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
          return;
        }
        if (event.key === 'Tab') {
          const focusables = layer.querySelectorAll('button');
          if (focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      };
      $('modal-approve').addEventListener('click', approve);
      $('modal-decline').addEventListener('click', decline);
      document.addEventListener('keydown', onKey);
    });
  }

  /* ---------------------------------------------------------------- chat */

  function parseBlock(raw) {
    let event = 'message';
    const dataLines = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    let data = {};
    if (dataLines.length > 0) {
      try {
        data = JSON.parse(dataLines.join('\n'));
      } catch {
        data = {};
      }
    }
    return { event, data };
  }

  async function handleEvent(event, data) {
    if (event === 'text') {
      appendAgentText(data.text);
    } else if (event === 'tool') {
      if (data.phase === 'start') addToolRow(data.name);
      else finishToolRow(data.name, data.ok, data.content);
    } else if (event === 'confirm') {
      const approved = await showConfirm(data.message);
      await api('/api/confirm', {
        method: 'POST',
        body: JSON.stringify({ id: data.id, approved }),
      }).catch(() => undefined);
    } else if (event === 'final') {
      if (data.text) appendAgentText(data.text);
      else if (!data.invocations || data.invocations.length === 0) {
        appendNotice('agent 没有返回内容，请换一种说法再试。');
      }
      if (data.truncated) {
        appendNotice('已达到本轮工具调用上限，上面是阶段性总结。回复“继续”可以接着做。');
      }
      if (data.state) renderConversations(data.state.conversations);
    } else if (event === 'error') {
      appendEntry('error', data.message || 'agent 执行失败。');
    }
  }

  async function sendMessage(event) {
    if (event) event.preventDefault();
    const input = $('message');
    const message = input.value.trim();
    if (!message) {
      input.focus();
      return;
    }
    if (state.busy) return;

    if (!state.connected) {
      appendEntry('error', '还没有连接 Wikidot 账号，请先回到连接页填写凭据。');
      setView('connect');
      return;
    }

    state.busy = true;
    $('send-btn').disabled = true;
    setConn('busy', 'agent 正在工作');
    input.value = '';
    appendEntry('user', message);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-wikidot-ai': '1' },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) {
        const text = await response.text();
        let detail = text;
        try {
          detail = JSON.parse(text).error || text;
        } catch {
          /* keep raw */
        }
        throw new Error(detail || `请求失败（HTTP ${response.status}）`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let split = buffer.indexOf('\n\n');
        while (split !== -1) {
          const raw = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const { event: name, data } = parseBlock(raw);
          await handleEvent(name, data);
          split = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      appendEntry('error', error.message);
    } finally {
      state.busy = false;
      $('send-btn').disabled = false;
      setConn('on', '已连接');
      input.focus();
    }
  }

  function resetLog() {
    state.runningRows = [];
    renderEmpty();
  }

  /* -------------------------------------------------------------- doctor */

  async function runDoctor() {
    const button = $('doctor-btn');
    const log = $('doctor-log');
    button.disabled = true;
    log.hidden = false;
    log.textContent = '正在检查…';
    try {
      const report = await api('/api/doctor?llm=1');
      log.textContent = report.lines.join('\n');
    } catch (error) {
      log.textContent = `体检失败：${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  async function disconnect() {
    try {
      await api('/api/disconnect', { method: 'POST', body: '{}' });
    } catch {
      /* the cookie is cleared server-side either way */
    }
    state.connected = false;
    state.activeId = null;
    setConn('idle', '未连接');
    $('doctor-log').hidden = true;
    renderConversations([]);
    resetLog();
    setFormStatus('已断开连接。', 'busy');
    setView('connect');
  }

  /* ----------------------------------------------------------------- init */

  async function loadSession() {
    try {
      const data = await api('/api/session');
      if (!data.connected) return;
      state.connected = true;
      setConn('on', '已连接');
      renderFacts(data);
      renderConversations(data.conversations || []);
      if (data.activeId) {
        const active = await api('/api/conversations/select', {
          method: 'POST',
          body: JSON.stringify({ id: data.activeId }),
        });
        renderConversations(active.state.conversations);
        renderDisplay(active.conversation.display);
      }
      setView('console');
    } catch {
      /* stay on the connect view */
    }
  }

  function init() {
    $('connect-form').addEventListener('submit', connect);
    $('composer').addEventListener('submit', sendMessage);
    $('doctor-btn').addEventListener('click', runDoctor);
    $('disconnect-btn').addEventListener('click', disconnect);
    $('new-conversation').addEventListener('click', newConversation);
    for (const tab of document.querySelectorAll('.view-tab')) {
      tab.addEventListener('click', () => setView(tab.dataset.view));
    }
    $('message').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    renderEmpty();
    setView('connect');
    loadSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__wdai = {
    state,
    setView,
    connect,
    sendMessage,
    runDoctor,
    disconnect,
    handleEvent,
    showConfirm,
    appendEntry,
    appendNotice,
    appendAgentText,
    appendToolEntry,
    renderDisplay,
    renderConversations,
    selectConversation,
    newConversation,
    deleteConversation,
    renderEmpty,
    resetLog,
  };
})();
