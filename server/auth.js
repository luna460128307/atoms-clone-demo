const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const store = require('./db');

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: '请先登录' });
}

function register(req, res) {
  const { username, password, nickname } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: '用户名至少3位，密码至少6位' });
  }
  if (store.findUserByUsername(username)) {
    return res.status(409).json({ error: '用户名已被注册' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const user = {
    id: nanoid(10),
    username,
    nickname: nickname || username,
    passwordHash: hash,
    createdAt: Date.now(),
  };
  store.createUser(user);
  req.session.userId = user.id;
  return res.json({ id: user.id, username: user.username, nickname: user.nickname });
}

function login(req, res) {
  const { username, password } = req.body || {};
  const user = store.findUserByUsername(username);
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  req.session.userId = user.id;
  return res.json({ id: user.id, username: user.username, nickname: user.nickname });
}

function logout(req, res) {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
}

function me(req, res) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  const user = store.findUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: '未登录' });
  return res.json({ id: user.id, username: user.username, nickname: user.nickname });
}

module.exports = { requireAuth, register, login, logout, me };
