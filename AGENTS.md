# AGENTS.md · 绿角犀官网 AI 团队协作规则

> 本文件注入给所有 AI 员工，作为项目级全局约束。
> 每个 Agent 还有自己的角色定义（见 `.trae/agents/`），遇到具体任务时优先看角色文件。

---

## 1. 项目画像

| 维度 | 值 |
|------|-----|
| 名称 | 绿角犀安全浏览器官网 |
| 技术栈 | 纯 HTML/CSS/JS 前端 + Node.js/Express 后端 + SQLite |
| 前端 | 12 个 HTML 页面（index/product/download/contact/changelog/admin/api/privacy/terms/offline/404/maintenance），12 个原生 JS 模块，PWA 支持 |
| 后端 | 7 个文件（server.js / routes.js / auth.js / db.js / config.js / env.js / backup.js），Express + better-sqlite3 |
| 路由 | 52 条 Express 路由（公开 13 + 后台 39） |
| 部署 | 阿里云 47.116.59.141，PM2（fork 模式，端口 3002），Nginx 反代 |
| 测试 | `tools/smoke-test.js`（747 项冒烟），`tools/maintain.js`（备份/恢复） |
| 数据 | SQLite `data/app.db`，备份在 `data/backups/` |

## 2. 红线（绝对不能碰）

| # | 规则 | 后果 |
|---|------|------|
| 1 | **禁止删除或清空 SQLite 数据库** `data/app.db` | 数据丢失不可恢复 |
| 2 | **禁止修改生产 PM2 / Nginx 配置除非明确授权** | 服务中断 |
| 3 | **禁止提交口令、密钥到 git** | 安全泄漏 |
| 4 | **禁止绕过登录接口** | 安全漏洞 |
| 5 | **禁止引入新的前端框架/构建工具**（React/Vue/webpack 等） | 破坏项目极简架构 |
| 6 | **禁止修改 `.env` 文件里的生产凭据**（本地 `.env` 已 gitignore） | 凭据泄漏或服务不可用 |
| 7 | **admin 用户最后一个不能降级/删除** | 后台无人可写 |

## 3. 编码约定

### 3.1 通用

- 缩进：2 空格，不用 tab
- 引号：JS 优先单引号，JSON 双引号
- 换行：LF（`.gitattributes` 已配）
- 注释：中文，面向接手者

### 3.2 前端（`assets/js/`）

- 原生 ES Module，无构建步骤
- `motion.js` 必须在 `main.js` / `admin.js` 之前加载
- 样式类名：kebab-case（`.feature-card`）
- 国际化：所有用户可见文案走 `i18n.js` 的 `t('key')`，`zh` 为默认

### 3.3 后端（`server/`）

- Express 中间件按顺序：`json → 请求ID → 日志 → 静态 → 路由 → 404 → 错误处理`
- 路由文件：`routes.js` 一个文件搞定所有路由（当前架构），不要拆分
- 数据库操作：**同步** `db.prepare().run/get/all`（better-sqlite3 同步 API）
- 口令存储：scrypt + 随机盐，**禁止明文**
- 环境变量：`.env` 文件 + `ecosystem.config.js` 双保险；`env.js` 不覆盖已存在变量

### 3.4 安全

- 登录防爆破：`MAX_LOGIN_FAILS=5`，`LOGIN_LOCK_MS=5min`
- Token：HMAC-SHA256 签名，含 `pwd_version`（改口令后旧 token 立即失效），8 小时 TTL
- CSP：`style-src 'unsafe-inline'` 是刻意取舍（31 处 inline style + CSSOM 动态设样式）
- 静态托管白名单守卫：db/auth/server/节点模块/.env/backups 一律 404

## 4. 部署流程

```
本地开发 → npm run smoke（冒烟测试）→ git commit → scp 上传 → pm2 restart lvjiaoxi-web
                                                          ↓
                                              ADMIN_PASSWORD=<口令> node tools/smoke-test.js --url=http://127.0.0.1:3002
```

生产服务器：
- SSH 密钥：`C:\Users\Administrator\.ssh\greenrhino_deploy`
- 应用路径：`/opt/lvjiaoxi-web`
- PM2 进程：`lvjiaoxi-web`（fork，端口 3002）
- Nginx 配置：`/etc/nginx/conf.d/lvjiaoxi.conf`

## 5. 测试命令速查

| 场景 | 命令 |
|------|------|
| 本地冒烟 | `node tools/smoke-test.js` |
| 生产冒烟 | `ADMIN_PASSWORD='KRcC!5AZYBCmaZta2S7G' node tools/smoke-test.js --url=http://127.0.0.1:3002` |
| 外网冒烟 | `ADMIN_PASSWORD='KRcC!5AZYBCmaZta2S7G' node tools/smoke-test.js --url=http://47.116.59.141` |
| 备份 | `node tools/maintain.js backup` |
| 恢复 | `node tools/maintain.js restore <备份文件名>` |
| 校验备份 | `node tools/maintain.js verify <备份文件名>` |

## 6. AI 员工协作方式

| 场景 | 调谁 |
|------|------|
| 要加新功能页面 | frontend-dev + backend-dev |
| 要改 API | backend-dev + api-doc-writer |
| 要写测试 | test-engineer（单元）/ e2e-test-engineer（端到端） |
| 要审查代码 | code-reviewer |
| 要查安全问题 | security-auditor |
| 要部署/运维 | devops-engineer |

**重要**：每个 Agent 的角色文件里有更细的职责边界和禁止事项，先看角色再动手。
