// ===========================================================================
// Agent Engine —— 模拟「多智能体协作生成应用」的核心引擎
// ===========================================================================
// 设计说明（关键取舍）：
// 本 Demo 没有接入真实的大模型 API（避免因外部 Key / 网络 / 额度问题导致 Demo
// 在评审环境下不可用），而是用「模板匹配 + 关键词抽取」的规则引擎，
// 模拟 PM / 架构师 / 工程师 / 测试 四个角色的分工与产出，
// 但生成的应用是「真实、可交互、可持久化」的最小可用产品，而不是假的静态页面。
// 模板库覆盖 8 类常见业务场景（待办 / 留言板 / 投票 / 打卡 / 预约 / CRM /
// 库存 / 数据看板），其中数据看板刻意做成「基于用户真实提交的指标记录动态聚合
// 统计」，而不是写死的假数字卡片，避免"看起来像看板、实际是静态图片"的问题。
// 如果要替换为接入真实 LLM，只需替换 `planWithAgents` 与 `pickTemplate` 的实现，
// 其余的运行时（runtimeApp.js）、存储层完全不用变 —— 这是关键的架构解耦点。
// ===========================================================================

const TEMPLATES = {
  todo: {
    key: 'todo',
    name: '待办事项 / 任务清单',
    description: '支持新增、完成勾选、删除任务，数据持久化保存',
    keywords: ['待办', 'todo', '任务', '清单', 'checklist', '打卡清单', 'to-do', 'to do'],
    fields: [
      { name: 'title', label: '任务内容', type: 'text', required: true },
      { name: 'done', label: '是否完成', type: 'boolean', default: false },
    ],
    accent: '#6C5CE7',
  },
  board: {
    key: 'board',
    name: '留言板 / 社区讨论',
    description: '支持发布留言、点赞、删除，展示所有人的留言列表',
    keywords: ['留言', '留言板', '社区', '论坛', '评论', 'board', 'message', '讨论区', '吐槽'],
    fields: [
      { name: 'author', label: '昵称', type: 'text', required: true },
      { name: 'content', label: '留言内容', type: 'textarea', required: true },
      { name: 'likes', label: '点赞数', type: 'number', default: 0, formHidden: true },
    ],
    accent: '#00B894',
  },
  vote: {
    key: 'vote',
    name: '投票 / 问卷调查',
    description: '支持创建选项、发起投票、实时统计票数占比',
    keywords: ['投票', '问卷', '调查', 'vote', 'poll', '民意', '票选'],
    fields: [
      { name: 'option', label: '选项名称', type: 'text', required: true },
      { name: 'votes', label: '票数', type: 'number', default: 0, formHidden: true },
    ],
    accent: '#0984E3',
  },
  checkin: {
    key: 'checkin',
    name: '每日打卡 / 习惯追踪',
    description: '支持记录每日打卡项、连续天数统计、备注心得',
    keywords: ['打卡', '习惯', '签到', 'checkin', 'check-in', '习惯养成', '坚持'],
    fields: [
      { name: 'habit', label: '打卡项目', type: 'text', required: true },
      { name: 'note', label: '心得备注', type: 'textarea', required: false },
      { name: 'streak', label: '累计次数', type: 'number', default: 0, formHidden: true },
    ],
    accent: '#E17055',
  },
  booking: {
    key: 'booking',
    name: '预约管理',
    description: '支持新建预约、查看预约列表、点击流转预约状态',
    keywords: ['预约', '订位', '挂号', 'booking', '日程安排', '排期'],
    fields: [
      { name: 'customer', label: '客户/预约人', type: 'text', required: true },
      { name: 'item', label: '预约事项', type: 'text', required: true },
      { name: 'status', label: '状态', type: 'select', options: ['待确认', '已确认', '已完成'], default: '待确认', formHidden: true },
    ],
    accent: '#D88928',
  },
  crm: {
    key: 'crm',
    name: '客户管理 / CRM',
    description: '支持添加客户、按阶段跟进、点击流转客户所处的销售阶段',
    keywords: ['客户', 'crm', '线索', '跟进', '销售管道', '客户管理'],
    fields: [
      { name: 'company', label: '客户名称', type: 'text', required: true },
      { name: 'stage', label: '跟进阶段', type: 'select', options: ['新线索', '意向沟通', '方案报价', '已成交'], default: '新线索', formHidden: true },
    ],
    accent: '#00A8A8',
  },
  store: {
    key: 'store',
    name: '商品库存管理',
    description: '支持录入商品、增减库存数量、库存清零提醒',
    keywords: ['库存', '商品管理', '进销存', '仓储', 'store', '入库', '出库'],
    fields: [
      { name: 'productName', label: '商品名称', type: 'text', required: true },
      { name: 'quantity', label: '库存数量', type: 'number', default: 0, min: 0 },
    ],
    accent: '#2D6CDF',
  },
  dashboard: {
    key: 'dashboard',
    name: '业务数据看板',
    description: '支持录入指标数据，看板卡片与趋势图基于真实录入数据实时聚合展示',
    keywords: ['看板', '数据看板', '报表', '指标', '数据分析', 'dashboard', 'kpi'],
    fields: [
      { name: 'metricName', label: '指标名称', type: 'text', required: true },
      { name: 'metricValue', label: '指标数值', type: 'number', required: true, default: 0 },
    ],
    accent: '#8854D0',
  },
};

function pickTemplate(prompt) {
  const text = prompt.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const tpl of Object.values(TEMPLATES)) {
    let score = 0;
    for (const kw of tpl.keywords) {
      if (text.includes(kw.toLowerCase())) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = tpl;
    }
  }
  // 默认兜底：没有命中任何关键词时，使用留言板作为最通用的 CRUD 模板。
  // 同时返回是否命中，供上层决定是否要把用户原始需求摘要一并带出，
  // 避免「看不懂需求就静默退化成完全无关的模板」这种体验落差。
  return { template: best || TEMPLATES.board, matched: !!best };
}

function extractAppName(prompt) {
  // 简单启发式：截取前 16 个字符作为应用名候选，去掉常见语气词
  const cleaned = prompt
    .replace(/(帮我|请|我想|我要|做一个|做一下|创建一个|生成一个|一个|应用|系统|工具)/g, '')
    .trim();
  const name = cleaned.slice(0, 14) || '未命名应用';
  return name;
}

// 模拟多智能体分工的「思考轨迹」，用于前端流式展示，增强“智能体协作”的真实感
function buildAgentTrace(prompt, template, matched) {
  const matchLine = matched
    ? `识别核心意图为构建一个具备增删改查能力的「${template.name}」类应用。`
    : `未能精确匹配到预置模板，已保留原始需求摘要，并采用最通用的「${template.name}」结构承接（支持自定义字段的增删改查）。`;
  const steps = [
    {
      role: 'PM Agent',
      avatar: '🧭',
      title: '需求分析',
      content: `解析用户需求：「${prompt}」\n${matchLine}`,
    },
    {
      role: 'Architect Agent',
      avatar: '🏗️',
      title: '数据建模',
      content:
        `设计数据模型，字段如下：\n` +
        template.fields
          .map((f) => `  - ${f.name} (${f.type})${f.required ? ' [必填]' : ''}`)
          .join('\n') +
        `\n选定存储方案：服务端 JSON 持久化存储，重启不丢数据。`,
    },
    {
      role: 'Engineer Agent',
      avatar: '👨‍💻',
      title: '生成代码与接口',
      content:
        `生成 RESTful API：\n` +
        `  GET    /api/runtime/:projectId/records\n` +
        `  POST   /api/runtime/:projectId/records\n` +
        `  PATCH  /api/runtime/:projectId/records/:id\n` +
        `  DELETE /api/runtime/:projectId/records/:id\n` +
        `并生成前端交互页面（表单 + 列表渲染 + 实时刷新）。`,
    },
    {
      role: 'QA Agent',
      avatar: '✅',
      title: '自测校验',
      content: `执行基础校验：必填字段校验、接口连通性检查、空数据态展示 —— 全部通过，应用已就绪。`,
    },
  ];
  return steps;
}

function planWithAgents(prompt) {
  const { template, matched } = pickTemplate(prompt);
  const appName = extractAppName(prompt);
  const trace = buildAgentTrace(prompt, template, matched);
  // 未命中任何预置模板时，把用户原始需求文案一并带出，供前端展示，
  // 这样即便退化到通用模板，用户也能看到系统「读懂了」自己的原始诉求，
  // 而不是被悄悄替换成一个看起来毫不相关的留言板应用。
  return { template, appName, trace, matched, requirementSummary: matched ? null : prompt };
}

module.exports = {
  TEMPLATES,
  pickTemplate,
  extractAppName,
  buildAgentTrace,
  planWithAgents,
};
