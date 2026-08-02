// ===========================================================================
// Code Export —— 把生成的应用「模板 + 数据结构」渲染成一套独立可运行的
// 单文件 Node.js 源码（server.js，内置 express + 内存存储 + 前端页面），
// 用户下载后可以直接 `node server.js` 在本地运行，体现「代码所有权」。
// ===========================================================================

function renderProjectSourceFiles(project) {
  const { template, name, prompt } = project;

  const fieldsJson = JSON.stringify(template.fields, null, 2);

  const serverJs = `/**
 * ${name} —— 由 Agent 自动生成的应用
 * 原始需求描述：${prompt}
 * 模板类型：${template.name}
 *
 * 运行方式：
 *   npm install express
 *   node server.js
 * 然后访问 http://localhost:4000
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = path.join(__dirname, 'data.json');
const FIELDS = ${fieldsJson};

function load() {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}
function save(records) {
  fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2));
}

app.get('/api/records', (req, res) => {
  res.json({ records: load(), fields: FIELDS });
});

app.post('/api/records', (req, res) => {
  const records = load();
  const record = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: Date.now() };
  for (const f of FIELDS) {
    let value = req.body[f.name];
    if (value === undefined || value === '') value = f.default !== undefined ? f.default : '';
    record[f.name] = value;
  }
  records.unshift(record);
  save(records);
  res.json({ record });
});

app.patch('/api/records/:id', (req, res) => {
  const records = load();
  const rec = records.find((r) => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  Object.assign(rec, req.body);
  save(records);
  res.json({ record: rec });
});

app.delete('/api/records/:id', (req, res) => {
  let records = load();
  records = records.filter((r) => r.id !== req.params.id);
  save(records);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log('App running at http://localhost:' + PORT));
`;

  const indexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${name}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f6fa; margin: 0; padding: 40px 16px; }
  .card { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); padding: 24px; }
  h1 { font-size: 20px; color: ${template.accent}; margin-top: 0; }
  input, textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 10px; font-size: 14px; }
  button { background: ${template.accent}; color: #fff; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-size: 14px; }
  .item { padding: 12px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .item small { color: #999; }
  .del { color: #d63031; cursor: pointer; font-size: 12px; }
</style>
</head>
<body>
  <div class="card">
    <h1>${name}</h1>
    <div id="form"></div>
    <button onclick="submitForm()">提交</button>
    <div id="list" style="margin-top:20px;"></div>
  </div>
<script>
let FIELDS = [];
async function loadRecords() {
  const res = await fetch('/api/records');
  const data = await res.json();
  FIELDS = data.fields;
  renderForm();
  renderList(data.records);
}
function renderForm() {
  const form = document.getElementById('form');
  // 与 preview.html 保持一致的判断依据：按字段类型/formHidden 标记决定是否进表单，
  // 而不是硬编码字段名单，这样新增模板（如 select 类型的预约/CRM 状态）也能正确处理。
  form.innerHTML = FIELDS.filter(f => f.type !== 'boolean' && f.type !== 'select' && !f.formHidden).map(f => {
    if (f.type === 'textarea') return '<textarea id="f_' + f.name + '" placeholder="' + f.label + '"></textarea>';
    if (f.type === 'number') return '<input type="number" id="f_' + f.name + '" placeholder="' + f.label + '" />';
    return '<input id="f_' + f.name + '" placeholder="' + f.label + '" />';
  }).join('');
}
async function submitForm() {
  const payload = {};
  FIELDS.forEach(f => {
    const el = document.getElementById('f_' + f.name);
    if (el) payload[f.name] = el.value;
  });
  await fetch('/api/records', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  loadRecords();
}
function renderList(records) {
  const list = document.getElementById('list');
  if (!records.length) { list.innerHTML = '<p style="color:#999">暂无数据，快去添加第一条吧～</p>'; return; }
  list.innerHTML = records.map(r => {
    const main = FIELDS.map(f => r[f.name] !== undefined ? (f.label + ': ' + r[f.name]) : '').filter(Boolean).join(' · ');
    return '<div class="item"><span>' + main + '</span><span class="del" onclick="del(\\'' + r.id + '\\')">删除</span></div>';
  }).join('');
}
async function del(id) {
  await fetch('/api/records/' + id, { method: 'DELETE' });
  loadRecords();
}
loadRecords();
</script>
</body>
</html>
`;

  const packageJson = JSON.stringify(
    {
      name: 'generated-' + template.key,
      version: '1.0.0',
      description: name,
      main: 'server.js',
      scripts: { start: 'node server.js' },
      dependencies: { express: '^4.19.2' },
    },
    null,
    2
  );

  const readme = `# ${name}

由 Atoms Clone Demo 的 Agent 引擎自动生成。

- 原始需求：${prompt}
- 模板类型：${template.name}（${template.description}）

## 本地运行

\`\`\`bash
npm install
npm start
\`\`\`

访问 http://localhost:4000
`;

  return [
    { path: 'server.js', content: serverJs },
    { path: 'package.json', content: packageJson },
    { path: 'README.md', content: readme },
    { path: 'public/index.html', content: indexHtml },
  ];
}

module.exports = { renderProjectSourceFiles };
