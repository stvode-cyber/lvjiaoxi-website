#!/usr/bin/env node
/**
 * AI 团队巡检脚本 · self-evolution-engineer
 * 用法：node tools/inspect-ai-team.js
 * 输出：Skill 健康度 + Agent 对齐度 + 关键知识点覆盖
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(ROOT, '.trae', 'agents');
const SKILLS_DIR = path.join(ROOT, '.trae', 'skills');

let pass = 0, warn = 0, fail = 0;
const results = [];

function log(level, msg) {
  const icons = { ok: '✅', warn: '⚠️ ', fail: '❌', info: 'ℹ️ ' };
  const counters = { ok: 'pass', warn: 'warn', fail: 'fail' };
  if (counters[level]) eval(`++${counters[level]}`);
  results.push({ level, msg });
  console.log(`${icons[level] || ''} ${msg}`);
}

// ========== 1. Skill 健康度 ==========
console.log('\n' + '='.repeat(60));
console.log('📊 Skill 健康度检查');
console.log('='.repeat(60));

const skills = fs.readdirSync(SKILLS_DIR).filter(d => {
  const p = path.join(SKILLS_DIR, d);
  return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'SKILL.md'));
});

let skillTrigger = 0, skillForbid = 0, skillPitfall = 0;
for (const skill of skills) {
  const content = fs.readFileSync(path.join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
  const hasTrigger = content.includes('触发条件');
  const hasForbid = content.includes('禁止事项');
  const hasPitfall = /踩坑|速查|常见坑/.test(content);

  if (hasTrigger) skillTrigger++;
  else log('fail', `Skill ${skill} 缺「触发条件」`);

  if (hasForbid) skillForbid++;
  else log('fail', `Skill ${skill} 缺「禁止事项」`);

  if (hasPitfall) skillPitfall++;
  else log('warn', `Skill ${skill} 缺「踩坑速查」（新 Skill 可接受，但积累后需补）`);
}

console.log(`\nSkill 汇总: 触发 ${skillTrigger}/${skills.length} | 禁止 ${skillForbid}/${skills.length} | 踩坑 ${skillPitfall}/${skills.length}`);

// ========== 2. Agent 文件存在性 ==========
console.log('\n' + '='.repeat(60));
console.log('📋 Agent 文件存在性');
console.log('='.repeat(60));

const REQUIRED_AGENTS = [
  'frontend-dev', 'backend-dev', 'code-reviewer', 'test-engineer',
  'e2e-test-engineer', 'security-auditor', 'devops-engineer',
  'api-doc-writer', 'market-researcher', 'self-evolution-engineer',
  'core/ux-experience-tester'
];

for (const agent of REQUIRED_AGENTS) {
  const p = path.join(AGENTS_DIR, `${agent}.md`);
  if (fs.existsSync(p)) log('ok', `Agent ${agent}.md 存在`);
  else log('fail', `Agent ${agent}.md 缺失`);
}

// ========== 3. 前端文件对齐 ==========
console.log('\n' + '='.repeat(60));
console.log('🔍 frontend-dev Agent vs 实际文件');
console.log('='.repeat(60));

// HTML
const actualHtmls = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
const frontendAgent = fs.readFileSync(path.join(AGENTS_DIR, 'frontend-dev.md'), 'utf8');
const agentHtmls = [...frontendAgent.matchAll(/`([a-z0-9-]+\.html)`/g)].map(m => m[1]);

for (const html of actualHtmls) {
  if (agentHtmls.includes(html)) log('ok', `HTML ${html} 在 Agent 中有记录`);
  else log('fail', `HTML ${html} 在 Agent 中缺失！`);
}
for (const html of [...new Set(agentHtmls)]) {
  if (!actualHtmls.includes(html)) log('warn', `Agent 里列了不存在的 HTML ${html}`);
}

// JS
const actualJs = fs.readdirSync(path.join(ROOT, 'assets', 'js')).filter(f => f.endsWith('.js'));
const agentJs = [...frontendAgent.matchAll(/`assets\/js\/([a-z0-9-]+\.js)`/g)].map(m => m[1]);

for (const js of actualJs) {
  if (agentJs.includes(js)) log('ok', `JS ${js} 在 Agent 中有记录`);
  else log('fail', `JS ${js} 在 Agent 中缺失！`);
}
for (const js of [...new Set(agentJs)]) {
  if (!actualJs.includes(js)) log('warn', `Agent 里列了不存在的 JS ${js}`);
}

// ========== 4. API 路由对齐 ==========
console.log('\n' + '='.repeat(60));
console.log('🔌 backend-dev Agent vs 实际路由');
console.log('='.repeat(60));

const routesContent = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
const backendAgent = fs.readFileSync(path.join(AGENTS_DIR, 'backend-dev.md'), 'utf8');
const apiDocAgent = fs.readFileSync(path.join(AGENTS_DIR, 'api-doc-writer.md'), 'utf8');

// 提取实际路由（routes.js 里的路径自动挂载在 /api 下）
const actualRoutes = [];
const routeRegex = /router\.(get|post|put|delete|patch)\(\s*'([^']+)'/g;
let m;
while ((m = routeRegex.exec(routesContent)) !== null) {
  actualRoutes.push({ method: m[1].toUpperCase(), path: '/api' + m[2] });
}

// 提取 Agent 里的路由
const agentRoutes = [];
const agentRouteRegex = /\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*`?(\/[^`|]+)`?/g;
for (const agentContent of [backendAgent, apiDocAgent]) {
  while ((m = agentRouteRegex.exec(agentContent)) !== null) {
    agentRoutes.push({ method: m[1], path: m[2].trim() });
  }
}

// 比较：Agent 里的每条路由是否在实际中存在
for (const ar of agentRoutes) {
  const found = actualRoutes.some(r =>
    r.method === ar.method &&
    (r.path === ar.path ||
     r.path.replace(/\/:\w+/g, '/:id') === ar.path.replace(/\/:\w+/g, '/:id') ||
     r.path.startsWith(ar.path.split(':')[0]))
  );
  if (!found && !ar.path.includes('批量') && !ar.path.includes('导入')) {
    // 跳过表格里的说明文字
    if (!ar.path.startsWith('/api')) continue;
    log('warn', `Agent 里有但实际可能没有: ${ar.method} ${ar.path}`);
  }
}

// 比较：实际每条路由是否在 Agent 里存在
for (const rr of actualRoutes) {
  const found = agentRoutes.some(a =>
    a.method === rr.method &&
    (a.path === rr.path ||
     a.path.replace(/\/:\w+/g, '/:id') === rr.path.replace(/\/:\w+/g, '/:id'))
  );
  if (found) log('ok', `路由 ${rr.method} ${rr.path} 在 Agent 中有记录`);
  else log('fail', `路由 ${rr.method} ${rr.path} 在 Agent 中缺失！`);
}

console.log(`\n实际路由 ${actualRoutes.length} 条 | Agent 覆盖 ${actualRoutes.length - actualRoutes.filter(r => !agentRoutes.some(a => a.method === r.method && (a.path === r.path || a.path.replace(/\/:\w+/g, '/:id') === r.path.replace(/\/:\w+/g, '/:id')))).length} 条`);

// ========== 5. AGENTS.md 项目画像对齐 ==========
console.log('\n' + '='.repeat(60));
console.log('🏷️  AGENTS.md 项目画像数字校验');
console.log('='.repeat(60));

const agentsMd = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');

// 检查 HTML 数
const htmlCount = actualHtmls.length;
const htmlMatch = agentsMd.match(/(\d+)\s*个\s*HTML/);
if (htmlMatch) {
  const stated = parseInt(htmlMatch[1]);
  if (stated === htmlCount) log('ok', `AGENTS.md HTML 数 ${stated} = 实际 ${htmlCount}`);
  else log('fail', `AGENTS.md HTML 数 ${stated} ≠ 实际 ${htmlCount}`);
}

// 检查 JS 数
const jsCount = actualJs.length;
const jsMatch = agentsMd.match(/(\d+)\s*个\s*原生\s*JS/);
if (jsMatch) {
  const stated = parseInt(jsMatch[1]);
  if (stated === jsCount) log('ok', `AGENTS.md JS 数 ${stated} = 实际 ${jsCount}`);
  else log('fail', `AGENTS.md JS 数 ${stated} ≠ 实际 ${jsCount}`);
}

// 检查后端文件数
const backendFiles = fs.readdirSync(path.join(ROOT, 'server')).filter(f => f.endsWith('.js'));
const beMatch = agentsMd.match(/(\d+)\s*个\s*文件.*server/);
if (beMatch) {
  const stated = parseInt(beMatch[1]);
  if (stated === backendFiles.length) log('ok', `AGENTS.md 后端文件数 ${stated} = 实际 ${backendFiles.length}`);
  else log('fail', `AGENTS.md 后端文件数 ${stated} ≠ 实际 ${backendFiles.length}`);
}

// 检查路由数
const routeMatch = agentsMd.match(/(\d+)\s*条\s*Express/);
if (routeMatch) {
  const stated = parseInt(routeMatch[1]);
  if (stated === actualRoutes.length) log('ok', `AGENTS.md 路由数 ${stated} = 实际 ${actualRoutes.length}`);
  else log('fail', `AGENTS.md 路由数 ${stated} ≠ 实际 ${actualRoutes.length}`);
}

// ========== 6. 关键知识点交叉覆盖 ==========
console.log('\n' + '='.repeat(60));
console.log('🔗 关键知识点交叉覆盖');
console.log('='.repeat(60));

const KNOWLEDGE_POINTS = [
  { name: '登录必须带 username', keywords: ['username', '登录', 'login'] },
  { name: 'PM2 fork 模式', keywords: ['fork', 'cluster', 'ecosystem'] },
  { name: 'Nginx default_server', keywords: ['default_server', 'Nginx', 'nginx'] },
  { name: 'ensureAdmins 空表种子', keywords: ['ensureAdmins', '空表', 'seed'] },
  { name: 'motion.js 加载顺序', keywords: ['motion', '加载顺序'] },
  { name: 'sw.js 预缓存', keywords: ['sw.js', '预缓存', 'PRECACHE'] },
  { name: 'CSP style-src unsafe-inline', keywords: ['unsafe-inline', 'CSP', 'style-src'] },
  { name: 'env.js 不覆盖已存在变量', keywords: ['env.js', '不覆盖', 'process.env'] },
  { name: '阿里云 WAF / ICP 备案', keywords: ['阿里云', 'WAF', 'ICP', '备案'] },
];

const allDocs = {};
for (const agent of REQUIRED_AGENTS) {
  const p = path.join(AGENTS_DIR, `${agent}.md`);
  if (fs.existsSync(p)) allDocs[`agent:${agent}`] = fs.readFileSync(p, 'utf8');
}
for (const skill of skills) {
  allDocs[`skill:${skill}`] = fs.readFileSync(path.join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
}
allDocs['AGENTS.md'] = agentsMd;

for (const kp of KNOWLEDGE_POINTS) {
  const hits = [];
  for (const [doc, content] of Object.entries(allDocs)) {
    if (kp.keywords.some(kw => content.includes(kw))) hits.push(doc);
  }
  if (hits.length >= 2) log('ok', `「${kp.name}」覆盖 ${hits.length} 处: ${hits.join(', ')}`);
  else if (hits.length === 1) log('warn', `「${kp.name}」只在 1 处: ${hits[0]}`);
  else log('fail', `「${kp.name}」0 处覆盖！`);
}

// ========== 汇总 ==========
console.log('\n' + '='.repeat(60));
console.log('📊 巡检汇总');
console.log('='.repeat(60));
console.log(`✅ 通过: ${pass}  ⚠️  警告: ${warn}  ❌ 失败: ${fail}`);
const health = fail === 0 ? (warn === 0 ? '🟢 优秀' : '🟡 良好') : '🔴 需修复';
console.log(`整体健康度: ${health}`);
if (fail > 0) {
  console.log('\n❌ 需立即修复的问题:');
  results.filter(r => r.level === 'fail').forEach(r => console.log(`  - ${r.msg}`));
}
if (warn > 0) {
  console.log('\n⚠️  建议改进:');
  results.filter(r => r.level === 'warn').forEach(r => console.log(`  - ${r.msg}`));
}
