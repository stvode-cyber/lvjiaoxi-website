# 台账索引 · Index

> 按模块索引决策/坑/规则，快速定位

---

## 后端（server/）

| 模块 | 决策 | 坑 | 规则 |
|------|------|-----|------|
| Token/auth | D-004 HMAC-SHA256 + pwd_version | I-003 登录必须带 username | auth.js、AGENTS.md 3.4 |
| 数据库 | D-005 SQLite + better-sqlite3 同步 | I-004 ensureAdmins 空表种子 | db.js、AGENTS.md 红线 #1 |
| 路由 | D-002 Express 单文件路由 | I-003 | routes.js、backend-dev.md |
| 环境变量 | D-003 .env + ecosystem 双保险 | I-001 PM2 cluster env 不注入 | env.js、AGENTS.md 3.3 |

## 前端（assets/）

| 模块 | 决策 | 坑 | 规则 |
|------|------|-----|------|
| 技术栈 | D-001 纯 HTML/CSS/JS 无构建 | — | AGENTS.md 红线 #5、frontend-component-spec |
| PWA | D-006 Service Worker + Manifest | — | sw.js、offline.html、pwa-enhancement |
| 国际化 | — | — | i18n.js、AGENTS.md 3.2 |
| 动效 | — | — | motion.js 加载顺序、AGENTS.md 3.2 |

## 部署

| 模块 | 决策 | 坑 | 规则 |
|------|------|-----|------|
| 架构 | D-003 PM2 fork + Nginx | I-001、I-002、I-008 | docker-deploy-guide、devops-engineer.md |
| 域名 | D-009 同步 DNS + ICP | I-008 | AGENTS.md 部署流程 |
| Nginx | D-008 default_server 临时方案 | I-002 | rollback-nginx-https.sh |
| 部署脚本 | — | I-005 git proxy、I-007 gh CLI 权限 | — |

## 安全

| 模块 | 决策 | 坑 | 规则 |
|------|------|-----|------|
| 防爆破 | — | — | MAX_LOGIN_FAILS=5、AGENTS.md 3.4 |
| CSP | — | — | style-src unsafe-inline 刻意取舍 |
| ICP 备案 | — | I-008 | 阿里云 WAF 拦截 |

## AI 团队

| 模块 | 决策 | 坑 | 规则 |
|------|------|-----|------|
| 架构 | D-007 Agent + Skill + 巡检 + CI | I-006 CI grep 误匹配 | self-evolution-engineer.md |
| 巡检 | — | — | inspect-ai-team.js、ci.yml、cron.yml |

## 测试

| 模块 | 决策 | 坑 | 规则 |
|------|------|-----|------|
| 冒烟 | D-010 Node 原生 --test | I-003 登录必须带 username | smoke-test.js、AGENTS.md 5 |

---

## 快速搜索

想找 XXX？Ctrl+F 搜关键词：
- "口令" → decisions.md D-003、context.md
- "PM2" → decisions.md D-003、issues.md I-001
- "Nginx" → decisions.md D-008、issues.md I-002
- "ICP" → issues.md I-008、context.md
- "登录" → issues.md I-003
- "AI 团队" → decisions.md D-007
- "部署" → decisions.md D-003、docker-deploy-guide/SKILL.md
