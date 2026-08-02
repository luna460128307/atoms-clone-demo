// ===========================================================================
// Runtime App —— 生成应用的「真实运行时」API
// ===========================================================================
// 每个 project 对应一个通过 Agent 生成的最小可用应用（Todo/留言板/投票/打卡）。
// 这里提供通用的 CRUD 接口，前端根据 project.template.fields 动态渲染表单和列表，
// 从而做到「一套运行时代码 + 数据驱动」支撑多种模板，同时保证是真实交互与持久化
// （所有记录都落盘在 data/store.json 中，而不是内存假数据）。
// ===========================================================================
const express = require('express');
const { nanoid } = require('nanoid');
const store = require('./db');

function ensureProjectAccess(req, res, next) {
  const project = store.findProjectById(req.params.projectId);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  req.project = project;
  next();
}

const router = express.Router();

router.get('/:projectId/records', ensureProjectAccess, (req, res) => {
  const records = store.getAppRecords(req.project.id);
  res.json({ records, template: req.project.template });
});

router.post('/:projectId/records', ensureProjectAccess, (req, res) => {
  const body = req.body || {};
  const fields = req.project.template.fields;
  const record = { id: nanoid(8), createdAt: Date.now() };
  for (const f of fields) {
    if (f.required && (body[f.name] === undefined || body[f.name] === '')) {
      return res.status(400).json({ error: `字段「${f.label}」为必填项` });
    }
    let value = body[f.name];
    if (value === undefined || value === null || value === '') {
      if (f.default !== undefined) value = f.default;
      else if (f.type === 'number') value = 0;
      else if (f.type === 'boolean') value = false;
      else if (f.type === 'select') value = (f.options && f.options[0]) || '';
      else value = '';
    }
    if (f.type === 'number') {
      value = Number(value) || 0;
      if (typeof f.min === 'number' && value < f.min) value = f.min;
    }
    if (f.type === 'boolean') value = Boolean(value);
    // select 类型：只信任预置的 options 枚举值，防止前端传入非法状态破坏状态机
    if (f.type === 'select' && Array.isArray(f.options) && !f.options.includes(value)) {
      value = f.options[0] || '';
    }
    record[f.name] = value;
  }
  store.addAppRecord(req.project.id, record);
  res.json({ record });
});

router.patch('/:projectId/records/:id', ensureProjectAccess, (req, res) => {
  const patch = req.body || {};
  const fields = req.project.template.fields;
  // 对 select 字段做枚举值校验，防止状态流转类应用（预约/CRM）被塞入非法状态
  for (const f of fields) {
    if (f.type === 'select' && patch[f.name] !== undefined) {
      if (!Array.isArray(f.options) || !f.options.includes(patch[f.name])) {
        return res.status(400).json({ error: `字段「${f.label}」的值不在允许的状态范围内` });
      }
    }
    if (f.type === 'number' && patch[f.name] !== undefined) {
      let numValue = Number(patch[f.name]) || 0;
      if (typeof f.min === 'number' && numValue < f.min) numValue = f.min;
      patch[f.name] = numValue;
    }
    if (f.type === 'boolean' && patch[f.name] !== undefined) {
      patch[f.name] = Boolean(patch[f.name]);
    }
  }
  const updated = store.updateAppRecord(req.project.id, req.params.id, patch);
  if (!updated) return res.status(404).json({ error: '记录不存在' });
  res.json({ record: updated });
});

router.delete('/:projectId/records/:id', ensureProjectAccess, (req, res) => {
  store.deleteAppRecord(req.project.id, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
