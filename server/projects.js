// ===========================================================================
// Projects Router —— 「生成应用」主流程 + 项目管理（延展能力）
// ===========================================================================
const express = require('express');
const { nanoid } = require('nanoid');
const archiver = require('archiver');
const store = require('./db');
const { planWithAgents } = require('./agentEngine');
const { renderProjectSourceFiles } = require('./codeExport');

const router = express.Router();

// 抽取出的公共创建逻辑：给定 prompt + userId，重新计算一次生成计划并落库。
// /confirm 与旧版 /generate 都复用它，避免维护两份重复代码。
function createProjectFromPrompt(prompt, userId) {
  const { template, appName, trace } = planWithAgents(prompt);
  const project = {
    id: nanoid(10),
    ownerId: userId,
    name: appName,
    prompt,
    template,
    trace,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.createProject(project);
  store.setAppRecords(project.id, []); // 初始化空数据表
  return project;
}

// 两步式生成 · 第一步：仅做「需求分析 + 生成计划」预览，不落库、不产生副作用。
// 采用两步式交互（先给计划、用户确认后才真正创建）是为了让用户在看到 Agent
// 的理解结果（模板选型、字段设计、接口设计）之后，还有机会退回去调整需求描述，
// 而不是提交后才发现生成的应用文不对题。
router.post('/plan', (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: '请输入应用需求描述' });
  }
  const plan = planWithAgents(prompt.trim());
  res.json({ plan: { ...plan, prompt: prompt.trim() } });
});

// 两步式生成 · 第二步：用户在计划预览中点击「确认并生成」后，才真正创建项目并落库。
// 出于安全考虑，这里不信任前端回传的 template/trace，而是用同一个 prompt
// 在服务端重新计算一次（规则引擎是纯函数、无副作用，重算成本很低且结果确定），
// 避免客户端伪造模板字段绕过后端的数据结构校验。
router.post('/confirm', (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: '请输入应用需求描述' });
  }
  const project = createProjectFromPrompt(prompt.trim(), req.session.userId);
  res.json({ project });
});

// 兼容旧版一步式生成入口（内部直接复用两步式的创建逻辑），
// 避免破坏可能存在的旧客户端集成。
router.post('/generate', (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: '请输入应用需求描述' });
  }
  const project = createProjectFromPrompt(prompt.trim(), req.session.userId);
  res.json({ project });
});

router.get('/', (req, res) => {
  const userId = req.session.userId;
  const projects = store.listProjectsByOwner(userId);
  res.json({ projects });
});

router.get('/:id', (req, res) => {
  const project = store.findProjectById(req.params.id);
  if (!project || project.ownerId !== req.session.userId) {
    return res.status(404).json({ error: '项目不存在' });
  }
  res.json({ project });
});

router.delete('/:id', (req, res) => {
  const project = store.findProjectById(req.params.id);
  if (!project || project.ownerId !== req.session.userId) {
    return res.status(404).json({ error: '项目不存在' });
  }
  store.deleteProject(req.params.id);
  res.json({ ok: true });
});

// 延展能力：重新生成（换一种模板 / 迭代需求）
router.post('/:id/regenerate', (req, res) => {
  const project = store.findProjectById(req.params.id);
  if (!project || project.ownerId !== req.session.userId) {
    return res.status(404).json({ error: '项目不存在' });
  }
  const { prompt } = req.body || {};
  const newPrompt = (prompt && prompt.trim()) || project.prompt;
  const { template, appName, trace } = planWithAgents(newPrompt);
  const updated = store.updateProject(project.id, {
    name: appName,
    prompt: newPrompt,
    template,
    trace,
  });
  // 模板变化后，字段结构可能不同，清空旧数据避免脏数据
  store.setAppRecords(project.id, []);
  res.json({ project: updated });
});

// 延展能力：导出生成的源代码为 zip（体现“代码所有权”，可下载在本地运行）
router.get('/:id/export', (req, res) => {
  const project = store.findProjectById(req.params.id);
  if (!project || project.ownerId !== req.session.userId) {
    return res.status(404).json({ error: '项目不存在' });
  }
  const files = renderProjectSourceFiles(project);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${project.id}-source.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);
  for (const file of files) {
    archive.append(file.content, { name: file.path });
  }
  archive.finalize();
});

module.exports = router;
