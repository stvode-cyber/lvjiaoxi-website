# 决策台账 · Decisions

> 每条决策记录：选了什么 / 为什么 / 备选方案 / 关联文件

---

## D-001：前端技术栈

- **选择**：纯 HTML/CSS/JS，无构建工具，ES Module
- **为什么**：绿角犀官网定位极简安全形象，不依赖任何第三方框架，加载快、审计易、1KB 可检查
- **备选**：React + Vite（生态好但 200KB+ gzip）、Vue（同上）、Svelte（编译后小但需要构建）
- **关联**：AGENTS.md 红线 #5、frontend-component-spec/SKILL.md
- **日期**：2026-09-12

## D-002：后端技术栈

- **选择**：Node.js + Express + better-sqlite3（同步 API）
- **为什么**：单进程同步调用比异步 Promise 简单，better-sqlite3 性能比 sql.js 好，不需要数据库服务器
- **备选**：Fastify（更快但 Express 生态够用）、Koa（精简但要自己写中间件）、PostgreSQL（重了）
- **关联**：AGENTS.md 3.3 节、backend-dev.md
- **日期**：2026-09-12

## D-003：部署架构

- **选择**：PM2 fork 模式 + Nginx 反代 + .env 文件
- **为什么**：cluster 模式下 env.js 不注入 worker（踩过坑），fork 模式 + .env 双保险最可靠
- **备选**：Docker + Compose（更规范但阿里云轻量实例资源有限）、直接 node server.js（挂了没人拉）
- **关联**：docker-deploy-guide/SKILL.md、devops-engineer.md、ecosystem.config.js
- **日期**：2026-09-12

## D-004：Token 方案

- **选择**：HMAC-SHA256 自签名 Token，含 pwd_version，8 小时 TTL
- **为什么**：无状态不需要 Redis，pwd_version 确保改口令后旧 Token 立即失效，HMAC 比 JWT 更简单
- **备选**：JWT（标准但 payload 大 + 库复杂）、Session + Redis（需要额外服务）
- **关联**：AGENTS.md 3.4 节、security-audit-guide/SKILL.md、auth.js
- **日期**：2026-09-12

## D-005：数据库架构

- **选择**：SQLite 单文件 better-sqlite3 同步 API
- **为什么**：零运维、随代码走、备份就是 cp、10 万级数据无压力
- **备选**：PostgreSQL（重了）、MongoDB（不适合关系型数据）、JSON 文件（并发写锁）
- **关联**：AGENTS.md 红线 #1、db.js、backup.js
- **日期**：2026-09-12

## D-006：PWA 支持

- **选择**：Service Worker + Web App Manifest，离线 fallback 到 offline.html
- **为什么**：安全浏览器用户对离线可用性有期待，PWA 零成本提升体验
- **关联**：sw.js、manifest.webmanifest、offline.html、pwa-enhancement/SKILL.md
- **日期**：2026-09-12

## D-007：AI 团队架构

- **选择**：`.trae/agents/` 角色文件 + `.trae/skills/` 操作手册 + `tools/inspect-ai-team.js` 巡检脚本 + GitHub CI 自动巡检
- **为什么**：Agent 定义"是谁做什么"，Skill 定义"怎么做"，巡检脚本确保不漂移，CI 强制守卫
- **备选**：纯 Skill 无 Agent（角色边界模糊）、纯 Agent 无 Skill（踩坑经验丢失）
- **关联**：self-evolution-engineer.md、inspect-ai-team.js、ci.yml、cron.yml
- **日期**：2026-09-13

## D-008：Nginx 临时方案（ICP 备案前）

- **选择**：lvjiaoxi.conf 加 default_server + 精确匹配 IP 47.116.59.141
- **为什么**：阿里云 WAF 拦截 lvjiaoxi.com（未备案），IP 访问不受限，先让内测能用
- **备选**：等待备案（7-20 天太长）、用 Cloudflare Tunnel（额外成本）
- **关联**：docker-deploy-guide/SKILL.md、devops-engineer.md、rollback-nginx-https.sh
- **日期**：2026-09-12

## D-009：ICP 备案策略

- **选择**：同步进行 — DNS A 记录先加（5 分钟）+ 提交 ICP 备案（7-20 天）+ 备案期间用 IP 访问内测
- **为什么**：域名解析不需要备案，备案通过后 certbot 签 HTTPS 自动生效
- **关联**：AGENTS.md 部署流程、devops-engineer.md
- **日期**：2026-09-12

## D-010：冒烟测试架构

- **选择**：747 项 Node.js 原生 `--test` 冒烟测试，零依赖，`--spawn` 模式
- **为什么**：不需要 jest/vitest 等框架，直接用 Node 22 内置测试，CI 环境零配置
- **备选**：Jest（功能全但重）、Playwright（端到端但慢）
- **关联**：tools/smoke-test.js、AGENTS.md 测试命令速查、unit-test-spec/SKILL.md
- **日期**：2026-09-12
