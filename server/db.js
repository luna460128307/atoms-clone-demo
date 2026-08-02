// 极简 JSON 文件数据库（无原生依赖，便于任意 Node 环境部署）
// 采用「读时全量加载 + 写时原子替换 + 内存写队列串行化」策略，
// 对于 Demo 级别的并发量完全够用，且真实落盘、重启不丢数据。
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILE = path.join(DATA_DIR, 'store.json');

function loadRaw() {
  if (!fs.existsSync(FILE)) {
    const initial = { users: [], projects: [], appRecords: {} };
    fs.writeFileSync(FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const content = fs.readFileSync(FILE, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    console.error('[db] failed to parse store.json, resetting', e);
    const initial = { users: [], projects: [], appRecords: {} };
    fs.writeFileSync(FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}

let writeChain = Promise.resolve();

function saveRaw(data) {
  // 串行化写入，避免并发写导致文件损坏
  writeChain = writeChain.then(() => {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, FILE);
  });
  return writeChain;
}

class Store {
  constructor() {
    this.data = loadRaw();
  }

  persist() {
    return saveRaw(this.data);
  }

  // ---------- users ----------
  findUserByUsername(username) {
    return this.data.users.find((u) => u.username === username);
  }

  findUserById(id) {
    return this.data.users.find((u) => u.id === id);
  }

  createUser(user) {
    this.data.users.push(user);
    this.persist();
    return user;
  }

  // ---------- projects ----------
  listProjectsByOwner(ownerId) {
    return this.data.projects
      .filter((p) => p.ownerId === ownerId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  findProjectById(id) {
    return this.data.projects.find((p) => p.id === id);
  }

  createProject(project) {
    this.data.projects.push(project);
    this.persist();
    return project;
  }

  updateProject(id, patch) {
    const p = this.findProjectById(id);
    if (!p) return null;
    Object.assign(p, patch, { updatedAt: Date.now() });
    this.persist();
    return p;
  }

  deleteProject(id) {
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    delete this.data.appRecords[id];
    this.persist();
  }

  // ---------- generated app runtime records (真实业务数据，如待办事项条目) ----------
  getAppRecords(projectId) {
    if (!this.data.appRecords[projectId]) {
      this.data.appRecords[projectId] = [];
    }
    return this.data.appRecords[projectId];
  }

  setAppRecords(projectId, records) {
    this.data.appRecords[projectId] = records;
    this.persist();
  }

  addAppRecord(projectId, record) {
    const list = this.getAppRecords(projectId);
    list.unshift(record);
    this.persist();
    return record;
  }

  updateAppRecord(projectId, recordId, patch) {
    const list = this.getAppRecords(projectId);
    const rec = list.find((r) => r.id === recordId);
    if (!rec) return null;
    Object.assign(rec, patch);
    this.persist();
    return rec;
  }

  deleteAppRecord(projectId, recordId) {
    const list = this.getAppRecords(projectId);
    this.data.appRecords[projectId] = list.filter((r) => r.id !== recordId);
    this.persist();
  }
}

module.exports = new Store();
