const path = require('path');
const express = require('express');
const session = require('express-session');
const { nanoid } = require('nanoid');
const bcrypt = require('bcryptjs');
const store = require('./db');
const authRouter = require('./auth');
const projectsRouter = require('./projects');
const runtimeRouter = require('./runtimeApp');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

// ---------- Session ----------
const isProd = process.env.NODE_ENV === 'production';
app.use(
  session({
    name: 'atoms.sid',
    secret: process.env.SESSION_SECRET || 'atoms-clone-demo-secret-key-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

// ---------- Auth ----------
app.post('/api/auth/register', require('./auth').register);
app.post('/api/auth/login', require('./auth').login);
app.post('/api/auth/logout', require('./auth').logout);
app.get('/api/auth/me', require('./auth').me);

// ---------- 演示账号 / Guest 快速体验 ----------
app.post('/api/auth/demo', (req, res) => {
  let demoUser = store.findUserByUsername('demo');
  if (!demoUser) {
    const hash = bcrypt.hashSync('demo123456', 10);
    demoUser = {
      id: nanoid(10),
      username: 'demo',
      nickname: '演示用户',
      passwordHash: hash,
      createdAt: Date.now(),
    };
    store.createUser(demoUser);
    // 预置几个示例项目，让新用户一进来就能看到效果
    seedDemoProjects(demoUser.id);
  }
  req.session.userId = demoUser.id;
  return res.json({ id: demoUser.id, username: demoUser.username, nickname: demoUser.nickname });
});

function seedDemoProjects(userId) {
  const { planWithAgents } = require('./agentEngine');
  const seeds = [
    { prompt: '帮我做一个待办事项清单', records: [
      { title: '学习 atoms.dev 的产品设计', done: true },
      { title: '完成智能体引擎的架构文档', done: false },
      { title: '给团队做一次技术分享', done: false },
    ]},
    { prompt: '做一个投票调查工具', records: [
      { option: 'React', votes: 12 },
      { option: 'Vue', votes: 8 },
      { option: 'Svelte', votes: 3 },
    ]},
  ];
  seeds.forEach(({ prompt, records }) => {
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
    // 填充示例数据
    const seededRecords = records.map((r) => ({ id: nanoid(8), createdAt: Date.now(), ...r }));
    store.setAppRecords(project.id, seededRecords);
  });
}

// ---------- Health Check ----------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), version: require('../package.json').version });
});

// ---------- Business APIs (需要登录) ----------
const { requireAuth } = require('./auth');
app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/runtime', requireAuth, runtimeRouter);

// ---------- 预览页（生成应用的独立可访问页面，仍需登录以保护数据）----------
app.get('/preview/:projectId', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'preview.html'));
});

// ---------- 静态前端 ----------
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Atoms Clone Demo server running at http://localhost:${PORT}`);
});

module.exports = app;
