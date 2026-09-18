# HANDOVER · 绿角犀官网 交接文档

> **读完这个文件 + `.trae/memory/context.md` + `.trae/memory/issues.md`，你就能直接接手干活。**
> 所有决策、踩坑、架构规则、AI 团队定义都已经沉淀好——不要重复造轮子。

**交接时间**：2026-09-18
**最新 commit**：`be2aaf6 fix: UX 修复 + 域名统一 + Service Worker 补全`

---

## 0. 30 秒速读卡

| 项目 | 值 |
|------|-----|
| **这是什么** | 绿角犀安全浏览器官网（静态前端 + Node 后端 + SQLite） |
| **技术栈** | 纯 HTML/CSS/JS + Express + better-sqlite3，**无任何构建工具** |
| **服务器** | 阿里云 `47.116.59.141`（与 2 个其他项目共享！） |
| **部署路径** | `/opt/lvjiaoxi-web`，PM2 fork 模式，端口 3002 |
| **Nginx 状态** | HTTP 反代（80 端口），HTTPS 待签证书 |
| **SSH 密钥** | `C:\Users\Administrator\.ssh\greenrhino_deploy` |
| **内网口令** | `ADMIN_PASSWORD=KRcC!5AZYBCmaZta2S7G` |
| **Git 仓库** | https://github.com/stvode-cyber/lvjiaoxi-website |
| **GitHub Action** | push/PR → 冒烟 + AI 巡检 + Docker；每周一 10:00 → AI 巡检周报 |
| **冒烟测试** | **748/748 通过**（本地 `node tools/smoke-test.js`；生产 `node tools/smoke-test.js --url=http://127.0.0.1:3002`） |
| **AI 团队** | 11 个 Agent + 11 个 Skill + 巡检脚本，`node tools/inspect-ai-team.js` 可检查健康度 |
| **当前阻塞** | DNS 未生效（用户称已配置，但全球 DNS 查不到 `lvjiaoxi.com`）→ HTTPS 签不了证书 |

---

## 1. 接手时的第一步（5 条命令确认一切正常）

```bash
# ① 读台账（最重要！新会话必跑）
node tools/memory-manager.js remind

# ② AI 团队巡检
node tools/inspect-ai-team.js

# ③ 服务器健康检查（本地 PowerShell）
ssh -i "C:\Users\Administrator\.ssh\greenrhino_deploy" root@47.116.59.141 "pm2 list lvjiaoxi-web --no-color; curl -s http://127.0.0.1:3002/api/health"

# ④ 本地冒烟测试
node tools/smoke-test.js

# ⑤ 读全量上下文
cat .trae/memory/context.md
```

---

## 2. 项目结构（按职责分区）

```
绿角犀官网/
│
├── ═══ 入口 ═══
├── server/server.js                 # Express 入口 + 中间件链 + HTML 域名替换中间件
├── server/routes.js                 # 【67KB 巨文件】所有 52 条路由都在这里！
│                                    #   admin/products CRUD + contact + feedback + site + health
│                                    #   登录防暴力破解：5 次失败锁 5 分钟
│
├── ═══ 后端模块 ═══
├── server/auth.js                   # HMAC-SHA256 Token + pwd_version + 防爆破
├── server/db.js                     # better-sqlite3 同步 API + ensureAdmins() 种子
├── server/config.js                 # 【关键】siteUrl=https://lvjiaoxi.com（中间件替换 HTML 里的占位符）
├── server/env.js                    # 读 .env，不覆盖已存在变量
├── server/backup.js                 # 数据库备份/恢复
│
├── ═══ 前端静态 ═══
├── *.html                           # 12 个 HTML 页面（index/product/download/contact/changelog/privacy/terms/admin/api/offline/404/maintenance）
├── assets/js/                       # 12 个原生 ES Module（main/admin/product/contact/theme/i18n/pwa/changelog/offline/confirm-modal/err-search/motion）
├── assets/css/style.css             # 60KB 主样式
├── assets/img/                      # Logo、产品图（8 个产品 + 各 @2x/@sm）、og.jpg、hero-bg.jpg、icon-512.png
├── sw.js                            # Service Worker（CACHE v5，预缓存所有 12 页面 + 静态资源）
├── manifest.json                    # PWA manifest
│
├── ═══ 工具链 ═══
├── tools/smoke-test.js              # 冒烟测试（748 项，零依赖，Node --spawn）
├── tools/maintain.js                # 数据库备份/恢复/校验
├── tools/inspect-ai-team.js         # AI 团队巡检脚本
├── tools/memory-manager.js          # 台账管理器（remind/before-edit/archive/weekly/stats）
│
├── ═══ 部署 ═══
├── deploy/nginx.conf                # HTTPS 版 Nginx 模板（备案后 certbot --nginx 用）
├── deploy/rollback-nginx-https.sh   # HTTPS 切换脚本
├── deploy/lvjiaoxi-nginx-guard.sh   # Nginx 配置守护脚本
├── deploy/ecosystem.config.js       # PM2 配置（fork，端口 3002）
├── deploy/lvjiaoxi.service          # systemd 服务配置
│
├── ═══ AI 团队 ═══
├── .trae/agents/                    # 11 个 AI 员工（角色定义 + 职责 + 红线）
├── .trae/skills/                    # 11 个 Skill 手册（踩坑 + 流程 + 判断标准）
├── .trae/memory/                    # 台账系统
│   ├── decisions.md                 # 10 条已定决策（不要再讨论！）
│   ├── issues.md                    # 9 条已踩坑（I-001~I-009，带预防方法）
│   ├── context.md                   # 当前状态 + 待办 + 服务器共存关系
│   └── index.md                     # 按模块索引
│
├── ═══ 数据库（gitignore！） ═══
├── data/app.db                      # SQLite 主文件（约 300KB，wal 模式）
├── data/backups/                    # 历史备份（从 09-02 到 09-14 共 7 份）
├── data/access.log / error.log      # Express 日志
│
├── ═══ CI ═══
├── .github/workflows/ci.yml         # push/PR → 冒烟 + AI 巡检 + Docker build
├── .github/workflows/cron.yml       # 每周一 10:00 → AI 巡检周报
│
└── ═══ 文档 ═══
├── AGENTS.md                        # 全局红线 + 编码约定 + 部署/测试速查
├── HANDOVER.md                      # ← 你正在读的
└── README.md                        # 项目概览（30KB 详细）
```

---

## 3. 服务器实时状态（2026-09-18 采集）

### 端口监听

| 端口 | 服务 | 备注 |
|------|------|------|
| 80 | Nginx → 127.0.0.1:3002 | HTTP 反代，default_server 抢 IP |
| 443 | Nginx | 监听但无证书，转发 docker 里的其他项目 |
| 3002 | Node.js（lvjiaoxi-web） | PM2 fork |
| 8091 | Nginx（其他项目） | 别碰 |
| 8443 | Docker（其他项目） | 别碰 |
| 3001 | socat（其他项目） | 别碰 |

### PM2 进程

```
lvjiaoxi-web  online  pid 892299  uptime 3D  restart 3  mem ~80MB  fork mode
aie-backend   online  pid 1536076  restart 15  ← 同服务器其他项目
erp-backend   online  pid 817998   restart 333  ← 同服务器其他项目
```

### Nginx 三层防护（**改配置必须解锁**）

```
第一层：chattr +i 不可变锁
       lsattr /etc/nginx/conf.d/lvjiaoxi.conf
       输出: ----i---------e------

第二层：守护脚本
       /usr/local/bin/lvjiaoxi-nginx-guard.sh
       检查 → 从 .bak.with-ip 恢复 → 加锁 → reload

第三层：cron 每 5 分钟
       */5 * * * * /usr/local/bin/lvjiaoxi-nginx-guard.sh >> /var/log/lvjiaoxi-guard.log 2>&1
```

### 改 Nginx 配置的**唯一正确姿势**

```bash
# 1. 解锁（不改这步会报 Read-only file system）
chattr -i /etc/nginx/conf.d/lvjiaoxi.conf

# 2. 改配置
vim /etc/nginx/conf.d/lvjiaoxi.conf
# 或者本地 scp 上去：
# scp deploy/nginx.conf root@47.116.59.141:/etc/nginx/conf.d/lvjiaoxi.conf

# 3. 验证 + 重载（nginx -t 必须过！）
nginx -t && nginx -s reload

# 4. 加锁回去
chattr +i /etc/nginx/conf.d/lvjiaoxi.conf

# 5. 更新守护脚本用的备份（不更新的话下次恢复就回到旧版了）
cp /etc/nginx/conf.d/lvjiaoxi.conf /etc/nginx/conf.d/lvjiaoxi.conf.bak.with-ip
```

---

## 4. 部署流程（更新代码到生产）

### 开发环境准备

```bash
# 本地 Windows
cd c:\Users\Administrator\Desktop\绿角犀官网
node tools/smoke-test.js           # 冒烟测试（748 项）
```

### 提交代码

```bash
git add -A
git commit -m "feat: 描述你做了什么"
git push                           # 推到 main，GitHub CI 自动跑
# 注意：如果 push 报 proxy 错误 → git config --global --unset http.proxy; git config --global --unset https.proxy
```

### 推到生产（服务器上没有 git，只能 scp）

```bash
# 方式一：用 PowerShell 批量 scp（推荐）
$key = "C:\Users\Administrator\.ssh\greenrhino_deploy"
$server = "root@47.116.59.141"
$remote = "/opt/lvjiaoxi-web"

# 先本地跑冒烟确认没问题
node tools/smoke-test.js | Select-Object -Last 3

# scp 改动的文件（按 git status 确定哪些改了）
scp -i $key server/config.js "$server`:$remote/server/config.js"
scp -i $key assets/js/main.js "$server`:$remote/assets/js/main.js"
scp -i $key sw.js "$server`:$remote/sw.js"
# ... 其他改动文件

# 重启 PM2 + 生产冒烟测试
ssh -i $key $server "pm2 restart lvjiaoxi-web --update-env && pm2 save && sleep 2 && curl -s http://127.0.0.1:3002/api/health"

# 生产冒烟测试（服务器上跑，注意用 --url 指定端口）
ssh -i $key $server "cd /opt/lvjiaoxi-web && ADMIN_PASSWORD='KRcC!5AZYBCmaZta2S7G' node tools/smoke-test.js --url=http://127.0.0.1:3002 2>&1 | tail -5"
```

### 重要细节

> **server.js 有 HTML 域名自动替换中间件**（约第 136 行）：所有 HTML 文件里的 `lvjiaoxi.example.com` 占位符会被中间件自动替换成 `config.siteUrl`。
>
> 所以改域名**只需要改 `server/config.js` 里的 `siteUrl` 一行**，不要手动改 HTML 文件！

---

## 5. 已知坑速查（9 条，别再踩！）

| ID | 坑 | 一句话 | 预防 |
|----|-----|--------|------|
| I-001 | PM2 cluster env 不注入 | fork 模式没问题，cluster 不行 | **强制 fork**，`ecosystem.config.js` 已配 |
| I-002 | Nginx default_server 冲突 | `greenrhino-cloud.conf` 抢 IP 请求 | 我们的 conf 写 `default_server`，其他项目去掉 |
| I-003 | 登录必须带 username | `{username:'admin', password:'xxx'}` | 冒烟测试里别漏了，漏了必 401 |
| I-004 | ensureAdmins 只在空表种子 | 生产改口令不会种种子 | 改口令后不要指望 ensureAdmins |
| I-005 | git proxy 残留 | push 报 connection refused → unset | `git config --global --unset http.proxy` |
| I-006 | CI grep 误匹配汇总行 | 冒烟统计行 `148 通过 0 失败` 会被当失败 | grep 必须排除统计行 |
| I-007 | gh CLI token scope 不够 | 没 repo scope 会 403 | `gh auth status` 先查 |
| I-008 | 阿里云 WAF 拦未备案域名 | 备案前用 IP 访问 | HTTPS 证书也签不了，必须先备案 |
| I-009 | lvjiaoxi.conf 被同服务器其他项目覆盖 | chattr +i + 守护脚本 + cron 三层 | **改配置前必须 `chattr -i` 解锁！** |

**详情见 `.trae/memory/issues.md`，每条都有根因 + 场景 + 预防。**

---

## 6. 已确定的 10 条决策（不要再讨论！）

| ID | 决策 |
|----|------|
| D-001 | 前端纯 HTML/CSS/JS，**禁止引入任何构建工具**（React/Vue/webpack 等） |
| D-002 | 后端 Node.js + Express + better-sqlite3 **同步** API |
| D-003 | PM2 **fork** + `.env` 双保险，不用 cluster |
| D-004 | Token 用 HMAC-SHA256 + `pwd_version`（改口令后旧 token 立即失效） |
| D-005 | SQLite 单文件 better-sqlite3，不考虑迁移 |
| D-006 | PWA Service Worker + offline.html，必须预缓存所有页面 |
| D-007 | Agent + Skill + 巡检 + CI 四层 AI 团队架构 |
| D-008 | Nginx default_server 临时方案（备案前 HTTP） |
| D-009 | DNS + ICP 同步推进 |
| D-010 | 冒烟测试 Node 原生 `--spawn`（零依赖） |

**详情见 `.trae/memory/decisions.md`。**

---

## 7. 当前待办任务清单（按优先级）

### 🔴 P0 — 阻塞性（必须用户手动操作，AI 帮不上）

| # | 任务 | 谁做 | 在哪做 | 备注 |
|---|------|------|--------|------|
| P0-1 | **DNS 生效验证** | 用户 | 阿里云域名控制台 | 用户说已配置，但全球 DNS 查不到。需要确认域名是否真的注册了、A 记录是否指向 `@` + `www` → `47.116.59.141` |
| P0-2 | ICP 备案 | 用户 | 阿里云 ICP 备案控制台 | 7-20 天 |
| P0-3 | 上传安装包 | 用户 | 提供客户端 exe/dmg/apk | `downloads/` 目录目前空的 |

### 🟡 P1 — DNS 生效后立即执行（AI 能做）

| # | 任务 | 操作 | 关键命令 |
|---|------|------|----------|
| P1-1 | **签 HTTPS 证书** | certbot HTTP-01 验证 | `certbot --nginx -d lvjiaoxi.com -d www.lvjiaoxi.com` |
| P1-2 | **切 HTTPS** | 改 Nginx 配置 + reload | 解锁 → 改 conf → nginx -t → reload → 加锁 → 备份 |
| P1-3 | **加 ICP 备案号到页脚** | 用户给备案号后改 HTML | footer 加一行 `© 2026 绿角犀 · 粤ICP备xxxxxx号` |
| P1-4 | **cdn.waf 白名单** | 阿里云 WAF 控制台 | 备案后提交域名 |

### 🟢 P2 — 开发待办（随时能做）

| # | 任务 | 复杂度 | 备注 |
|---|------|--------|------|
| P2-1 | 产品页 skeleton 加载态 | 中 | 白屏等 JS 渲染体验差 |
| P2-2 | 联系表单草稿自动保存 | 低 | localStorage 存，提交后清 |
| P2-3 | 产品图片懒加载 | 低 | loading="lazy" + IntersectionObserver |
| P2-4 | 后台批量操作 | 中 | 批量上架/下架/删除产品 |
| P2-5 | SEO 结构化数据（Schema.org） | 低 | 产品页加 JSON-LD |
| P2-6 | 品牌素材替换 | — | 需要用户提供 Logo/og.jpg/真实邮箱地址 |

### ✅ 刚完成（2026-09-14 部署）

| 任务 | 改动 |
|------|------|
| Service Worker ASSETS 补全 | sw.js v4 → v5，补 privacy/terms/admin/api/maintenance |
| product.html title 修正 | 产品详情 → 产品中心（title/og/twitter 同步） |
| 删除不存在的 /rss.xml link | 7 个 HTML 都清掉 |
| 域名统一 | config.js siteUrl example.com → lvjiaoxi.com |
| 新增 `/` 键搜索快捷键 | main.js 加 keydown 监听，输入框内不拦截 |
| 新增后台记住用户名 | admin.js showLogin() 回填 localStorage |

---

## 8. 紧急恢复 Runbook

### Nginx 挂了（配置被删）

```bash
ssh root@47.116.59.141

# ① 先看守护脚本有没有自动恢复
tail -20 /var/log/lvjiaoxi-guard.log

# ② 如果没恢复，手动跑
/usr/local/bin/lvjiaoxi-nginx-guard.sh

# ③ 如果备份也没了，从本地 scp
# 在本地执行：
scp -i "C:\Users\Administrator\.ssh\greenrhino_deploy" deploy/nginx.conf root@47.116.59.141:/etc/nginx/conf.d/lvjiaoxi.conf
# 然后在服务器：
chattr +i /etc/nginx/conf.d/lvjiaoxi.conf
nginx -t && nginx -s reload
```

### PM2 挂了

```bash
ssh root@47.116.59.141
pm2 restart lvjiaoxi-web
pm2 save
pm2 status lvjiaoxi-web
```

### 数据库坏了

```bash
ssh root@47.116.59.141
ls -lt /opt/lvjiaoxi-web/data/backups/ | head -5
cp /opt/lvjiaoxi-web/data/backups/<最新备份文件> /opt/lvjiaoxi-web/data/app.db
# 先备份当前的坏库！
```

### HTTPS 切换失败回滚

```bash
ssh root@47.116.59.141
chattr -i /etc/nginx/conf.d/lvjiaoxi.conf
cp /etc/nginx/conf.d/lvjiaoxi.conf.bak.with-ip /etc/nginx/conf.d/lvjiaoxi.conf
nginx -t && nginx -s reload
chattr +i /etc/nginx/conf.d/lvjiaoxi.conf
```

---

## 9. AI 团队使用指南

### 什么时候调谁

```
改前端（HTML/CSS/JS）？  → frontend-dev
改后端 API？             → backend-dev + api-doc-writer
写测试？                 → test-engineer（单元）/ e2e-test-engineer（端到端）
审查代码？               → code-reviewer
查安全？                 → security-auditor
部署/服务器？            → devops-engineer
想 UX 优化？             → ux-experience-tester
想竞品调研？             → market-researcher
AI 团队自己进化？        → self-evolution-engineer
```

### 台账管理命令

```bash
node tools/memory-manager.js remind              # 新会话读台账（必跑！）
node tools/memory-manager.js before-edit <path>  # 改文件前扫相关坑
node tools/memory-manager.js archive             # 会话结束提炼
node tools/memory-manager.js weekly              # 生成周报
node tools/memory-manager.js stats               # 统计台账
```

---

## 10. 环境变量速查（服务器 .env）

```
NODE_ENV=production
PORT=3002
SITE_URL=https://lvjiaoxi.com
ADMIN_PASSWORD=KRcC!5AZYBCmaZta2S7G
AUTH_SECRET=d9e34d83532f24dbf2015e4cb22b0cc0501b7df34b6e7d14bb498e687aed113b
```

> ⚠️ `.env` 已 gitignore，**禁止提交到 git**。生产改动必须手动 ssh 上去改。

---

## 11. 每周自动发生的事

| 频率 | 事件 |
|------|------|
| 每 5 分钟 | `lvjiaoxi-nginx-guard.sh` 检查 Nginx 配置（自愈） |
| 每周一 10:00 北京 | GitHub cron.yml 跑 AI 团队巡检周报 |
| push/PR main | GitHub ci.yml 跑冒烟 + AI 巡检 + Docker build |
| PM2 进程 | `pm2 save` 已执行 + `pm2 startup systemd` 已配，**开机自启** |

---

## 12. DNS 验证正确姿势

当前阻塞点是 DNS。确认域名生效的正确步骤：

```bash
# 本地 PowerShell（用公共 DNS 查最权威）
nslookup lvjiaoxi.com 8.8.8.8
# 应该返回：47.116.59.141

# 或者 node 脚本
node -e "require('dns').resolve4('lvjiaoxi.com',(e,a)=>console.log(e?'FAIL: '+e.message:'✅ → '+a))"

# 三个都查不到 = DNS 还没生效
node -e "require('dns').resolve4('www.lvjiaoxi.com',(e,a)=>console.log(e?'FAIL www: '+e.message:'✅ www → '+a))"
```

**三个都返回 47.116.59.141 后，才能跑 certbot 签证书。**

---

## 13. 最后几句忠告

1. **不要碰 SQLite 数据库**（红线 #1）—— 里面有真实产品数据 + 管理员口令快照
2. **不要手动改 HTML 里的域名** —— 用 `config.js` + 中间件自动替换
3. **改 Nginx 先解锁后加锁** —— 三层防护是因为被同服务器其他项目坑过
4. **跑生产冒烟必须带 `--url=http://127.0.0.1:3002`** —— 默认端口是 3000
5. **所有踩过的坑都在 `.trae/memory/issues.md`** —— 新会话第一件事 `node tools/memory-manager.js remind`
6. **改了 routes.js 记得同步 Agent 文件** —— 巡检脚本会检查路由对齐

欢迎接手，祝你好运！🚀
