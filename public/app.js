// ===========================================================================
// 前端主逻辑：认证、项目列表、对话式生成流程、预览联动
// ===========================================================================
let currentUser = null;
let currentProjectId = null;
let projects = [];
let isRegisterMode = false;

// ---------------- Auth ----------------
function toggleAuthMode() {
  isRegisterMode = !isRegisterMode;
  document.getElementById('authSub').textContent = isRegisterMode
    ? '注册一个新账号，开始生成你的第一个应用'
    : '登录以开始用 AI 智能体生成你的应用';
  document.getElementById('authNickname').style.display = isRegisterMode ? 'block' : 'none';
  document.getElementById('authSubmitBtn').textContent = isRegisterMode ? '注册' : '登录';
  document.getElementById('authToggleText').textContent = isRegisterMode ? '已经有账号？' : '还没有账号？';
  document.getElementById('authToggleLink').textContent = isRegisterMode ? '去登录' : '立即注册';
  document.getElementById('authError').textContent = '';
}

async function submitAuth() {
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  const nickname = document.getElementById('authNickname').value.trim();
  const errorEl = document.getElementById('authError');
  errorEl.textContent = '';

  const url = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, nickname }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || '操作失败';
      return;
    }
    currentUser = data;
    enterApp();
  } catch (e) {
    errorEl.textContent = '网络错误，请重试';
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  currentProjectId = null;
  document.getElementById('appLayout').classList.remove('active');
  document.getElementById('authWrap').style.display = 'flex';
}

// 演示账号一键登录，方便评审者快速体验而无需注册
async function loginAsDemo() {
  const errorEl = document.getElementById('authError');
  errorEl.textContent = '';
  try {
    const res = await fetch('/api/auth/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (!res.ok) { errorEl.textContent = data.error || '演示登录失败'; return; }
    currentUser = data;
    enterApp();
  } catch (e) {
    errorEl.textContent = '网络错误，请重试';
  }
}

async function checkSession() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      currentUser = await res.json();
      enterApp();
      return;
    }
  } catch (e) {}
  document.getElementById('authWrap').style.display = 'flex';
}

function enterApp() {
  document.getElementById('authWrap').style.display = 'none';
  document.getElementById('appLayout').classList.add('active');
  document.getElementById('userNick').textContent = '👤 ' + (currentUser.nickname || currentUser.username);
  loadProjects();
}

// ---------------- Projects Sidebar ----------------
async function loadProjects() {
  const res = await fetch('/api/projects');
  const data = await res.json();
  projects = data.projects || [];
  renderProjList();
}

function renderProjList() {
  const list = document.getElementById('projList');
  if (!projects.length) {
    list.innerHTML = '<div style="color:#666;font-size:12px;padding:8px;">暂无历史项目</div>';
    return;
  }
  list.innerHTML = projects
    .map(
      (p) => `
    <div class="proj-item ${p.id === currentProjectId ? 'active' : ''}" onclick="openProject('${p.id}')">
      <span class="name">${escapeHtml(p.name)}</span>
      <span class="del-icon" onclick="event.stopPropagation(); deleteProject('${p.id}')">✕</span>
    </div>`
    )
    .join('');
}

function startNewProject() {
  currentProjectId = null;
  document.getElementById('chatHistory').innerHTML = `
    <div class="empty-hint">
      👋 用一句话描述你想要的应用，AI 智能体团队会帮你分析、建模、编码并生成一个可以真实交互的应用。
      <div class="examples">
        <div class="example-chip" onclick="fillExample('帮我做一个待办事项清单')">待办事项清单</div>
        <div class="example-chip" onclick="fillExample('我想要一个团队留言板')">团队留言板</div>
        <div class="example-chip" onclick="fillExample('做一个投票调查工具')">投票调查工具</div>
        <div class="example-chip" onclick="fillExample('每日健身打卡应用')">每日打卡应用</div>
        <div class="example-chip" onclick="fillExample('做一个门店预约管理系统')">预约管理</div>
        <div class="example-chip" onclick="fillExample('简单的CRM客户跟进工具')">CRM客户管理</div>
        <div class="example-chip" onclick="fillExample('商品库存管理小工具')">库存管理</div>
        <div class="example-chip" onclick="fillExample('业务数据看板')">数据看板</div>
      </div>
    </div>`;
  showPreviewPlaceholder();
  renderProjList();
}

async function openProject(id) {
  currentProjectId = id;
  renderProjList();
  const res = await fetch('/api/projects/' + id);
  if (!res.ok) return;
  const { project } = await res.json();
  renderProjectInChat(project, false);
  loadPreview(project);
}

async function deleteProject(id) {
  if (!confirm('确定删除这个应用及其数据吗？')) return;
  await fetch('/api/projects/' + id, { method: 'DELETE' });
  if (currentProjectId === id) startNewProject();
  loadProjects();
}

// ---------------- Chat / Generation Flow ----------------
function fillExample(text) {
  document.getElementById('promptInput').value = text;
}

function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 两步式生成交互：先向 /api/projects/plan 请求「生成计划」并以卡片形式展示
// （模板选型、字段设计、接口设计），用户确认无误后再点击按钮调用
// /api/projects/confirm 真正创建。这样即便 Agent 理解错了需求，用户也能
// 在真正生成前发现问题并重新描述，而不是生成完才发现文不对题。
let pendingPlanPrompt = null;

async function sendPrompt() {
  const input = document.getElementById('promptInput');
  const prompt = input.value.trim();
  if (!prompt) return;
  input.value = '';
  document.getElementById('sendBtn').disabled = true;

  const history = document.getElementById('chatHistory');
  const emptyHint = document.getElementById('emptyHint');
  if (emptyHint) emptyHint.remove();

  const userMsg = document.createElement('div');
  userMsg.className = 'msg-user';
  userMsg.textContent = prompt;
  history.appendChild(userMsg);
  history.scrollTop = history.scrollHeight;

  try {
    const res = await fetch('/api/projects/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '生成计划失败');
      document.getElementById('sendBtn').disabled = false;
      return;
    }
    pendingPlanPrompt = prompt;
    await playAgentTrace(data.plan, { asPlan: true });
  } catch (e) {
    alert('网络错误，请重试');
  } finally {
    document.getElementById('sendBtn').disabled = false;
  }
}

// 用户在计划确认卡片中点击「确认并生成」后触发：调用 /confirm 真正创建项目。
async function confirmPlan() {
  if (!pendingPlanPrompt) return;
  const history = document.getElementById('chatHistory');
  const confirmCard = document.getElementById('planConfirmCard');
  if (confirmCard) confirmCard.remove();

  try {
    const res = await fetch('/api/projects/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: pendingPlanPrompt }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '生成失败');
      return;
    }
    currentProjectId = data.project.id;
    appendResultCard(data.project);
    history.scrollTop = history.scrollHeight;
    loadProjects();
    loadPreview(data.project);
  } catch (e) {
    alert('网络错误，请重试');
  } finally {
    pendingPlanPrompt = null;
  }
}

// 用户觉得计划不对，点击「重新描述」：撤回待确认卡片，让用户修改输入重新发起。
function discardPlan() {
  const confirmCard = document.getElementById('planConfirmCard');
  if (confirmCard) confirmCard.remove();
  pendingPlanPrompt = null;
  document.getElementById('promptInput').focus();
}

function playAgentTrace(projectOrPlan, options) {
  const asPlan = options && options.asPlan;
  const history = document.getElementById('chatHistory');
  return new Promise((resolve) => {
    let i = 0;
    function next() {
      if (i >= projectOrPlan.trace.length) {
        if (asPlan) appendPlanConfirmCard(projectOrPlan);
        else appendResultCard(projectOrPlan);
        resolve();
        return;
      }
      const step = projectOrPlan.trace[i];
      const el = document.createElement('div');
      el.className = 'agent-step';
      el.innerHTML = `
        <div class="head"><span>${step.avatar}</span><span class="role">${escapeHtml(step.role)}</span><span>· ${escapeHtml(step.title)}</span></div>
        <div class="body">${escapeHtml(step.content)}</div>`;
      history.appendChild(el);
      history.scrollTop = history.scrollHeight;
      i += 1;
      setTimeout(next, 500);
    }
    next();
  });
}

// 两步式交互的关键 UI：在真正创建项目之前，先用一张「待确认」卡片展示
// Agent 给出的生成计划（模板、字段清单），并列出两个动作按钮。
function appendPlanConfirmCard(plan) {
  const history = document.getElementById('chatHistory');
  const el = document.createElement('div');
  el.className = 'result-card plan-confirm-card';
  el.id = 'planConfirmCard';
  const fieldList = plan.template.fields
    .map((f) => `${escapeHtml(f.label)}${f.required ? '（必填）' : ''}`)
    .join('、');
  el.innerHTML = `
    <div class="title">📋 生成计划：「${escapeHtml(plan.appName)}」</div>
    <div class="desc">模板：${escapeHtml(plan.template.name)} —— ${escapeHtml(plan.template.description)}</div>
    <div class="desc">字段设计：${fieldList}</div>
    <div class="actions">
      <button class="btn-open" onclick="confirmPlan()">✅ 确认并生成</button>
      <button class="btn-export" onclick="discardPlan()">✏️ 重新描述</button>
    </div>`;
  history.appendChild(el);
  history.scrollTop = history.scrollHeight;
}

function appendResultCard(project) {
  const history = document.getElementById('chatHistory');
  const el = document.createElement('div');
  el.className = 'result-card';
  el.innerHTML = `
    <div class="title">✨ 「${escapeHtml(project.name)}」已生成</div>
    <div class="desc">模板：${escapeHtml(project.template.name)} —— ${escapeHtml(project.template.description)}</div>
    <div class="actions">
      <button class="btn-open" onclick="loadPreview(${JSON.stringify(project).replace(/"/g, '&quot;')})">在右侧预览</button>
      <button class="btn-export" onclick="exportCode()">下载源码</button>
    </div>`;
  history.appendChild(el);
  history.scrollTop = history.scrollHeight;
}

function renderProjectInChat(project, animate) {
  const history = document.getElementById('chatHistory');
  history.innerHTML = '';
  const userMsg = document.createElement('div');
  userMsg.className = 'msg-user';
  userMsg.textContent = project.prompt;
  history.appendChild(userMsg);

  project.trace.forEach((step) => {
    const el = document.createElement('div');
    el.className = 'agent-step';
    el.innerHTML = `
      <div class="head"><span>${step.avatar}</span><span class="role">${escapeHtml(step.role)}</span><span>· ${escapeHtml(step.title)}</span></div>
      <div class="body">${escapeHtml(step.content)}</div>`;
    history.appendChild(el);
  });
  appendResultCard(project);
}

// ---------------- Preview ----------------
function showPreviewPlaceholder() {
  document.getElementById('previewTitle').textContent = '尚未生成应用';
  document.getElementById('previewActions').style.display = 'none';
  document.getElementById('previewFrameWrap').innerHTML = `
    <div class="preview-placeholder">
      <div class="big">🧩</div>
      <div>生成的应用将在这里实时预览，可直接交互</div>
    </div>`;
}

function loadPreview(project) {
  currentProjectId = project.id;
  document.getElementById('previewTitle').textContent = project.name + '（' + project.template.name + '）';
  document.getElementById('previewActions').style.display = 'flex';
  document.getElementById('previewFrameWrap').innerHTML = `<iframe src="/preview/${project.id}" id="previewIframe"></iframe>`;
  renderProjList();
}

function openPreviewNewTab() {
  if (!currentProjectId) return;
  window.open('/preview/' + currentProjectId, '_blank');
}

async function exportCode() {
  if (!currentProjectId) return;
  window.location.href = '/api/projects/' + currentProjectId + '/export';
}

async function regenerate() {
  if (!currentProjectId) return;
  const note = prompt('可以补充/调整你的需求描述（留空则用原描述重新生成）：', '');
  const res = await fetch('/api/projects/' + currentProjectId + '/regenerate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: note }),
  });
  if (!res.ok) {
    const data = await res.json();
    alert(data.error || '重新生成失败');
    return;
  }
  const { project } = await res.json();
  renderProjectInChat(project);
  loadPreview(project);
  loadProjects();
}

// ---------------- Init ----------------
checkSession();
