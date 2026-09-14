#!/usr/bin/env node
/**
 * memory-manager.js · 台账管理器
 *
 * 用法：
 *   node tools/memory-manager.js remind                # 新会话启动前：读台账 + 主动提醒
 *   node tools/memory-manager.js before-edit <path>    # 改文件前：扫路径匹配的坑 + 提醒
 *   node tools/memory-manager.js archive               # 会话结束：.session-memory → 长期台账 → 清空
 *   node tools/memory-manager.js weekly                # 生成周报
 *   node tools/memory-manager.js write <type> <entry>  # 手动写入 (decision|issue)
 *   node tools/memory-manager.js stats                 # 统计
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const MEM_DIR = path.join(ROOT, '.trae', 'memory');
const ARCHIVE_DIR = path.join(MEM_DIR, 'archive');
const DECISIONS = path.join(MEM_DIR, 'decisions.md');
const ISSUES = path.join(MEM_DIR, 'issues.md');
const CONTEXT = path.join(MEM_DIR, 'context.md');
const INDEX = path.join(MEM_DIR, 'index.md');
const SESSION = path.join(MEM_DIR, '.session-memory.md');

// 用户级跨项目台账
const USER_MEM = path.join(os.homedir(), '.trae-cn', 'memory');
const USER_ISSUES = path.join(USER_MEM, 'shared-issues.md');
const USER_DECISIONS = path.join(USER_MEM, 'shared-decisions.md');

// ============================================================
// 通用工具
// ============================================================

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function readLine(p) {
  return fs.readFileSync(p, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
}

function now() {
  return new Date().toISOString().slice(0, 10);
}

function log(title, content) {
  console.log(`\n${title}`);
  console.log('─'.repeat(title.length));
  console.log(content);
}

// ============================================================
// remind —— 新会话启动前
// ============================================================

function cmdRemind() {
  const ctx = readFile(CONTEXT);
  const issues = readFile(ISSUES);
  const decisions = readFile(DECISIONS);

  // 提取待办
  const todos = [...ctx.matchAll(/\| (🔴|🟡|🟢) P[0-9] \| (.+?) \| (.+?) \|/g)]
    .map(m => `${m[1]} ${m[2]} — ${m[3]}`);

  // 提取高严重度坑
  const highPits = [...issues.matchAll(/\| \*\*严重程度\*\* \| (🔴|🟡)/g)];

  // 提取已定关键决策（前 5 条）
  const keyDecisions = [...decisions.matchAll(/^## D-(\d+).*\n.*?\*\*选择\*\*：(.+)/gm)]
    .slice(-5).reverse().map(m => `D-${m[1]}: ${m[2].trim()}`);

  const output = [
    `📅 ${now()} · 绿角犀官网 AI 台账提醒`,
    '',
    '━━━ 🎯 已定规则（不要再问）━━━',
    '前端：纯 HTML/CSS/JS + ES Module，禁止 React/Vue/webpack',
    '后端：Node.js + Express + better-sqlite3 同步 API',
    '部署：阿里云 47.116.59.141，PM2 fork，端口 3002',
    '口令：ADMIN_PASSWORD=KRcC!5AZYBCmaZta2S7G',
    '',
    '━━━ 📋 待办（按优先级）━━━',
    ...(todos.length ? todos : ['（context.md 里没有待办）']),
    '',
    '━━━ 🕳️ 高优先级坑（别再踩）━━━',
    ...extractHighPits(issues),
    '',
    '━━━ 💡 最近决策 ━━━',
    ...keyDecisions,
    '',
    '━━━ ⚠️  风险提醒 ━━━',
    '- 外网域名 lvjiaoxi.com 被阿里云 WAF 拦截（ICP 备案未过）',
    '- Nginx 当前用 IP default_server 临时方案，备案后要跑 rollback-nginx-https.sh',
    '- 改 routes.js 必须同步 backend-dev.md + inspect-ai-team.js',
    '',
    '💾 完整台账：.trae/memory/',
  ].join('\n');

  console.log(output);
  return output;
}

function extractHighPits(content) {
  // 按 ## I-xxx 分块，提取🔴/🟡 严重度的坑
  const blocks = content.split(/^## I-\d+/m).slice(1);
  const headers = content.match(/^## I-\d+.*$/gm) || [];
  const result = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].includes('🔴') || blocks[i].includes('🟡')) {
      const match = blocks[i].match(/\*\*问题\*\*\s*\|\s*([^|]+)/);
      const sev = blocks[i].match(/\*\*严重程度\*\*\s*\|\s*([^|]+)/);
      const id = headers[i] || `I-???`;
      if (match) result.push(`  ${id}: ${(sev ? sev[1].trim() + ' ' : '')}${match[1].trim().slice(0, 60)}`);
    }
  }
  return result.length ? result : ['（没有高优先级坑）'];
}

// ============================================================
// before-edit —— 改文件前扫坑
// ============================================================

function cmdBeforeEdit(filePath) {
  const target = path.resolve(filePath);
  const rel = path.relative(ROOT, target).replace(/\\/g, '/');
  const issues = readFile(ISSUES);
  const sharedIssues = readFile(USER_ISSUES);
  const allIssues = issues + '\n' + sharedIssues;

  const matches = [];
  const patterns = [
    // 关联文件路径
    new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
    // 路径片段（server/routes.js → 也匹配 routes.js）
    new RegExp(path.basename(rel).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
  ];

  const issueBlocks = allIssues.split(/^## I-\d+/m).slice(1);
  const issueHeaders = (allIssues.match(/^## I-\d+.*$/gm) || []);

  for (let i = 0; i < issueBlocks.length; i++) {
    for (const pat of patterns) {
      if (pat.test(issueBlocks[i])) {
        const qMatch = issueBlocks[i].match(/\*\*问题\*\*\s*\|\s*([^|]+)/);
        const sevMatch = issueBlocks[i].match(/\*\*严重程度\*\*\s*\|\s*([^|]+)/);
        const title = issueHeaders[i]?.trim() || 'I-???';
        const q = qMatch ? qMatch[1].trim().slice(0, 80) : '（无描述）';
        const sev = sevMatch ? sevMatch[1].trim() : '';
        matches.push({ title, q, sev, fromUser: i >= issueBlocks.length - (sharedIssues ? sharedIssues.split(/^## I-\d+/m).length - 1 : 0) });
        break;
      }
    }
  }

  if (matches.length === 0) {
    console.log(`✅ ${rel} — 没有匹配的坑，可以放心改`);
    return;
  }

  console.log(`\n⚠️  改 ${rel} 前注意！发现 ${matches.length} 个关联坑：`);
  console.log('─'.repeat(50));
  for (const m of matches) {
    console.log(`  ${m.title} ${m.sev}`);
    console.log(`    ${m.q}`);
    console.log(`    → 详见 .trae/memory/issues.md`);
    if (m.fromUser) console.log(`    （来自用户级 shared-issues.md）`);
  }
  console.log('');
}

// ============================================================
// archive —— 会话结束提炼归档
// ============================================================

function cmdArchive() {
  const session = readFile(SESSION);

  // 提取临时约定
  const todos = [...session.matchAll(/\*\*会话进行中的临时约定\*\*[\s\S]*?(?=\n## |$)/g)];
  const pending = [...session.matchAll(/\*\*待提炼归档\*\*[\s\S]*?(?=\n## |$)/g)];

  if (todos.length === 0 && pending.length === 0) {
    console.log('✅ .session-memory.md 没有需要提炼的内容');
  } else {
    // 简单提示（实际提炼需要人工判断）
    console.log('📋 提炼提示：');
    console.log('  - 新决策 → decisions.md');
    console.log('  - 新坑 → issues.md');
    console.log('  - 项目状态变更 → context.md');
    console.log('  - 跨项目通用坑 → 用户级 shared-issues.md');
  }

  // 检查归档条件：同一坑 ≥3 次且已入 Skill
  const issues = readFile(ISSUES);
  const blocks = issues.split(/^## (I-\d+)/m).filter(Boolean);
  let archived = 0;

  for (let i = 0; i < blocks.length; i += 2) {
    const id = blocks[i].trim();
    const body = blocks[i + 1] || '';
    const skillMatch = body.includes('✅') && body.includes('已入 Skill');
    const countMatch = body.match(/重复解决次数.*?(\d+)/);
    const count = countMatch ? parseInt(countMatch[1], 10) : 0;
    const inSkill = body.includes('已入 Skill');

    if (skillMatch && inSkill) {
      // 移到 archive
      const archivePath = path.join(ARCHIVE_DIR, `${id}-archived-${now()}.md`);
      fs.writeFileSync(archivePath, `# ${id}（已归档）\n\n${body}`, 'utf8');
      // 从 issues.md 移除
      const newIssues = issues.replace(new RegExp(`^## ${id}[\\s\\S]*?(?=\\n## I-|$)`, 'm'), '').trim();
      fs.writeFileSync(ISSUES, newIssues, 'utf8');
      archived++;
      console.log(`  📦 归档 ${id} → archive/${id}-archived-${now()}.md`);
    }
  }

  // 清空会话临时记忆（保留头部）
  const header = session.match(/^## Session 起始时间[\s\S]*?## 会话进行中的临时约定/m);
  if (header) {
    fs.writeFileSync(SESSION, `# 会话临时记忆 · Session Memory\n\n> 本文件只在当前会话有效，会话结束前自动提炼进 .trae/memory/ 长期台账然后清空。\n\n---\n\n## Session 起始时间\n${now()}\n\n## 会话进行中的临时约定\n（还没有）\n\n## 待提炼归档\n（还没有）\n`, 'utf8');
  }

  console.log(`\n✅ 提炼完成，归档 ${archived} 个坑，会话临时记忆已清空`);
}

// ============================================================
// weekly —— 生成周报
// ============================================================

function cmdWeekly() {
  const decisions = readFile(DECISIONS);
  const issues = readFile(ISSUES);
  const ctx = readFile(CONTEXT);

  const thisWeek = new Date();
  const weekStart = new Date(thisWeek);
  weekStart.setDate(thisWeek.getDate() - 7);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  // 本周新增决策
  const newDecisions = [...decisions.matchAll(/^## D-(\d+)[\s\S]*?\*\*日期\*\*：(\d{4}-\d{2}-\d{2})/gm)]
    .filter(m => m[2] >= weekStartStr)
    .map(m => `  D-${m[1]}（${m[2]}）`);

  // 本周新增坑
  const newIssues = [...issues.matchAll(/^## (I-\d+)[\s\S]*?\*\*日期\*\*：(\d{4}-\d{2}-\d{2})[\s\S]*?\*\*严重程度\*\*\s*\|\s*([^|]+)/gm)]
    .filter(m => m[2] >= weekStartStr)
    .map(m => `  ${m[1]} ${m[3].trim()}（${m[2]}）`);

  // 待办
  const todos = [...ctx.matchAll(/\| (🔴|🟡|🟢) P[0-9] \| (.+?) \|/g)]
    .map(m => `${m[1]} ${m[2].trim()}`);

  const report = [
    `📊 绿角犀官网 AI 台账周报 · ${weekStartStr} ~ ${now()}`,
    '',
    '━━━ 🎯 已定规则（不要再问）━━━',
    '前端：纯 HTML/CSS/JS + ES Module，禁止 React/Vue/webpack',
    '后端：Node.js + Express + better-sqlite3 同步 API',
    '部署：阿里云 47.116.59.141，PM2 fork，端口 3002',
    '',
    '━━━ 📋 待办 ━━━',
    ...todos.length ? todos.map(t => `  ${t}`) : ['（暂无）'],
    '',
    '━━━ 🆕 本周新增决策 ━━━',
    ...newDecisions.length ? newDecisions : ['（无）'],
    '',
    '━━━ 🕳️ 本周新增坑 ━━━',
    ...newIssues.length ? newIssues : ['（无）'],
    '',
    '━━━ ⚠️  风险提醒 ━━━',
    '- 外网域名 lvjiaoxi.com 被阿里云 WAF 拦截（ICP 备案未过）',
    '- 改 routes.js 必须同步 backend-dev.md + inspect-ai-team.js',
    '',
    '💾 完整台账：.trae/memory/',
  ].join('\n');

  console.log(report);

  // 也写一份到 archive 留档
  const weeklyPath = path.join(ARCHIVE_DIR, `weekly-${now()}.md`);
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  fs.writeFileSync(weeklyPath, `# 周报 ${now()}\n\n${report}\n`, 'utf8');
  console.log(`\n📁 周报已归档 → archive/weekly-${now()}.md`);
}

// ============================================================
// write —— 手动写入
// ============================================================

function cmdWrite(type, entry) {
  if (type === 'decision') {
    const content = readFile(DECISIONS);
    const lastId = [...content.matchAll(/^## D-(\d+)/gm)].pop();
    const nextId = lastId ? parseInt(lastId[1], 10) + 1 : 1;
    const block = `\n## D-${nextId}：${entry}\n\n- **日期**：${now()}\n- **手动添加**\n`;
    fs.appendFileSync(DECISIONS, block, 'utf8');
    console.log(`✅ 已写入 decisions.md → D-${nextId}`);
  } else if (type === 'issue') {
    const content = readFile(ISSUES);
    const lastId = [...content.matchAll(/^## I-(\d+)/gm)].pop();
    const nextId = lastId ? parseInt(lastId[1], 10) + 1 : 1;
    const block = `\n## I-${nextId}：${entry}\n\n| 字段 | 内容 |\n|------|------|\n| **日期** | ${now()} |\n| **手动添加** | |\n`;
    fs.appendFileSync(ISSUES, block, 'utf8');
    console.log(`✅ 已写入 issues.md → I-${nextId}`);
  } else {
    console.log('❌ type 必须是 decision 或 issue');
  }
}

// ============================================================
// stats —— 统计
// ============================================================

function cmdStats() {
  const decisions = readFile(DECISIONS);
  const issues = readFile(ISSUES);
  const ctx = readFile(CONTEXT);
  const index = readFile(INDEX);
  const session = readFile(SESSION);

  const dCount = (decisions.match(/^## D-\d+/gm) || []).length;
  const iCount = (issues.match(/^## I-\d+/gm) || []).length;
  const iHigh = (issues.match(/🔴/g) || []).length;
  const iMid = (issues.match(/🟡/g) || []).length;
  const todoCount = (ctx.match(/^- \[ \]/gm) || []).length;
  const todoDone = (ctx.match(/^- \[x\]/gm) || []).length;

  console.log(`
📊 台账统计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 决策总数     ${dCount} 条
🕳️  踩坑总数     ${iCount} 条（🔴 ${iHigh} / 🟡 ${iMid}）
📋 待办         ${todoDone} 已完成 / ${todoCount} 待办
🗂️  归档         ${fs.readdirSync(ARCHIVE_DIR).length} 个
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💾 台账位置：.trae/memory/
🔗 跨项目台账：${USER_MEM}/
`);
}

// ============================================================
// 入口
// ============================================================

const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case 'remind': cmdRemind(); break;
  case 'before-edit': cmdBeforeEdit(args[1]); break;
  case 'archive': cmdArchive(); break;
  case 'weekly': cmdWeekly(); break;
  case 'write': cmdWrite(args[1], args[2]); break;
  case 'stats': cmdStats(); break;
  default:
    console.log(`用法：
  node tools/memory-manager.js remind              新会话提醒
  node tools/memory-manager.js before-edit <path>  改文件前扫坑
  node tools/memory-manager.js archive             会话结束归档
  node tools/memory-manager.js weekly              生成周报
  node tools/memory-manager.js write <type> <msg>  手动写入 (decision|issue)
  node tools/memory-manager.js stats               统计`);
}
