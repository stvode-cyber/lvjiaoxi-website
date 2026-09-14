# 项目当前状态 · Context

> 别再问我"这项目用什么技术栈""部署在哪""口令是什么"——这里都有。
> 规则已定就不要再讨论，有变更先更新本文件。

---

## 🔴 绝对已定（不要再问）

| 项目 | 值 | 备注 |
|------|-----|------|
| 前端技术栈 | 纯 HTML/CSS/JS + ES Module | 禁止 React/Vue/webpack |
| 后端技术栈 | Node.js + Express + better-sqlite3 | 同步 API，不是异步 |
| 数据库 | SQLite 单文件 data/app.db | 禁止删除，备份用 cp |
| 部署 | 阿里云 47.116.59.141，PM2 fork，端口 3002 | SSH 密钥 C:\Users\Administrator\.ssh\greenrhino_deploy |
| 生产口令 | ADMIN_PASSWORD=KRcC!5AZYBCmaZta2S7G | AUTH_SECRET=d9e34d83...(完整在 .env) |
| Token | HMAC-SHA256 + pwd_version + 8h TTL | 改口令后旧 Token 立即失效 |
| 防爆破 | 5 次失败锁 5 分钟 | MAX_LOGIN_FAILS=5, LOGIN_LOCK_MS=300000 |
| 冒烟测试 | node tools/smoke-test.js | --spawn 模式零依赖 |
| AI 团队 | 11 Agent + 11 Skill + inspect-ai-team.js + CI 巡检 | |

## 🟡 当前状态（会变，关注）

| 项目 | 状态 | 备注 |
|------|------|------|
| 服务器运行 | ✅ online | PM2 lvjiaoxi-web fork 模式 |
| Nginx | ✅ default_server 修复 | lvjiaoxi.conf default_server + IP 匹配 |
| 外网 IP 访问 | ✅ http://47.116.59.141 通 | 临时方案，备案后切域名 |
| 域名访问 | ❌ 403 | 阿里云 WAF 拦截（ICP 备案未过） |
| DNS A 记录 | ❌ 未加 | lvjiaoxi.com + www → 47.116.59.141 |
| ICP 备案 | ❌ 未提交 | 阿里云 ICP 备案控制台 |
| SSL 证书 | ❌ 未签发 | certbot --nginx（DNS 生效后） |
| 下载安装包 | ❌ 未上传 | downloads/ 目录空 |
| GitHub 仓库 | ✅ 已创建 | https://github.com/stvode-cyber/lvjiaoxi-website |
| CI 流水线 | ✅ 跑通 | ci.yml push/PR + cron.yml 每周一 10:00 |
| AI 台账 | ✅ 已建 | .trae/memory/ + memory-manager.js |

## 🟢 待办（按优先级）

| 优先级 | 任务 | 在哪做 |
|--------|------|--------|
| 🔴 P0 | DNS A 记录 lvjiaoxi.com → 47.116.59.141 | 阿里云域名控制台 |
| 🔴 P0 | 提交 ICP 备案 | 阿里云 ICP 备案控制台 |
| 🟡 P1 | 备案通过后跑 rollback-nginx-https.sh | SSH 服务器 |
| 🟡 P1 | 上传下载安装包到 downloads/ | SSH + 后台上架 |
| 🟢 P2 | 跑 UX 测试找一键化机会 | 本地 |
| 🟢 P2 | 替换品牌素材（Logo/og.jpg/配色） | 本地 + upload |

## 📁 关键路径速查

| 想找 | 路径 |
|------|------|
| 首页 | index.html |
| 产品页 | product.html |
| 下载页 | download.html |
| 后台 | admin.html |
| 后端入口 | server/server.js |
| 路由 | server/routes.js |
| 数据库 | data/app.db |
| AI Agent | .trae/agents/ |
| AI Skill | .trae/skills/ |
| AI 台账 | .trae/memory/ |
| 巡检脚本 | tools/inspect-ai-team.js |
| 冒烟测试 | tools/smoke-test.js |
| CI | .github/workflows/ci.yml |
| 定期巡检 | .github/workflows/cron.yml |
| 部署指南 | .trae/skills/docker-deploy-guide/SKILL.md |

## 🔗 关联文件（改这里必须同步那里）

| 改了 | 必须同步 |
|------|---------|
| server/routes.js | backend-dev.md、api-doc-writer.md、inspect-ai-team.js |
| AGENTS.md 红线 | code-review-checklist/SKILL.md |
| Nginx 配置 | docker-deploy-guide/SKILL.md、rollback-nginx-https.sh |
| .env 凭据 | ecosystem.config.js、deploy/lvjiaoxi.service |
| 冒烟测试新增断言 | code-review-checklist/SKILL.md |
| 加新页面 | frontend-dev.md、inspect-ai-team.js |

---

> **变更日志**
> - 2026-09-14：初始化，提炼前两个 session 决策和坑
> - 2026-09-12：生产部署完成，IP 访问可用
