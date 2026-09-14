# HANDOVER · 新 AI 接手即懂

> 读完这个文件 + `.trae/memory/context.md` + `.trae/memory/issues.md`，你就能接手。
> 其他所有决策、坑、规则都在 `.trae/memory/` 和 `.trae/agents/` `.trae/skills/` 里。

---

## 0. 30 秒速读

| 项目 | 值 |
|------|-----|
| 这是什么 | 绿角犀安全浏览器官网（纯前端 Node 后端 SQLite） |
| 技术栈 | HTML/CSS/JS + Express + better-sqlite3，**无构建工具** |
| 服务器 | 阿里云 47.116.59.141，PM2 fork，端口 3002 |
| 内网口令 | ADMIN_PASSWORD=KRcC!5AZYBCmaZta2S7G |
| 当前访问 | http://47.116.59.141（IP 直访，域名被阿里云 WAF 拦） |
| 主要待办 | DNS 解析 + ICP 备案（都要用户去阿里云控制台） |
| 最大风险 | Nginx 配置被同服务器其他项目覆盖（已有三层防护） |
| GitHub | https://github.com/stvode-cyber/lvjiaoxi-website |

---

## 1. 你接手时的第一步

```bash
# 1. 读台账（最重要！）
node tools/memory-manager.js remind

# 2. 跑巡检确认 AI 团队健康
node tools/inspect-ai-team.js

# 3. 查服务器状态
ssh -i "C:\Users\Administrator\.ssh\greenrhino_deploy" root@47.116.59.141 "pm2 list lvjiaoxi-web --no-color; curl -s http://127.0.0.1:3002/api/health"

# 4. 跑冒烟测试
node tools/smoke-test.js

# 5. 读 context.md（全量状态）
cat .trae/memory/context.md
```

---

## 2. 项目结构

```
绿角犀官网/
├── AGENTS.md                          # 全局规则（红线/编码/部署/测试速查）
├── HANDOVER.md                        # ← 你正在读的
├── .trae/
│   ├── agents/                        # 11 个 AI 员工（角色定义）
│   │   ├── frontend-dev.md
│   │   ├── backend-dev.md
│   │   ├── code-reviewer.md
│   │   ├── test-engineer.md
│   │   ├── e2e-test-engineer.md
│   │   ├── security-auditor.md
│   │   ├── devops-engineer.md
│   │   ├── api-doc-writer.md
│   │   ├── market-researcher.md
│   │   ├── self-evolution-engineer.md
│   │   └── core/
│   │       └── ux-experience-tester.md
│   ├── skills/                        # 11 个 Skill 手册（踩坑+流程）
│   │   ├── code-review-checklist/SKILL.md
│   │   ├── security-audit-guide/SKILL.md
│   │   ├── unit-test-spec/SKILL.md
│   │   ├── docker-deploy-guide/SKILL.md       ← 部署/服务器操作必读
│   │   ├── frontend-component-spec/SKILL.md
│   │   ├── competitor-feature-matrix/SKILL.md
│   │   ├── pwa-enhancement/SKILL.md
│   │   ├── conversion-optimization/SKILL.md
│   │   ├── seo-structured-data/SKILL.md
│   │   ├── ai-feature-design/SKILL.md
│   │   └── ux-test-playbook/SKILL.md
│   └── memory/                        # 台账（决策/坑/状态/索引）
│       ├── decisions.md               # 10 条关键决策
│       ├── issues.md                  # 9 条踩坑（I-001~I-009）
│       ├── context.md                 # 当前状态 + 待办 + 服务器共存
│       ├── index.md                   # 按模块索引
│       ├── .session-memory.md         # 会话临时记忆
│       └── archive/                   # 归档（周报/已沉淀的坑）
├── server/                            # 后端
│   ├── server.js                      # Express 入口
│   ├── routes.js                      # 52 条路由（全部在这里！）
│   ├── auth.js                        # HMAC-SHA256 Token + 防爆破
│   ├── db.js                          # better-sqlite3 同步 API + ensureAdmins
│   ├── config.js
│   ├── env.js                         # 读 .env，不覆盖已存在变量
│   └── backup.js
├── assets/                            # 前端
│   ├── js/                            # 12 个原生 ES Module
│   ├── css/
│   └── img/
├── *.html                             # 12 个 HTML 页面
├── tools/
│   ├── smoke-test.js                  # 冒烟测试（747 项，--spawn 零依赖）
│   ├── maintain.js                    # 数据库备份/恢复
│   ├── inspect-ai-team.js             # AI 团队巡检脚本
│   └── memory-manager.js              # 台账管理器（remind/before-edit/archive/weekly/stats）
├── deploy/
│   ├── ecosystem.config.js            # PM2 配置（fork 模式）
│   ├── rollback-nginx-https.sh         # 备案后切 HTTPS 的回滚脚本
│   ├── lvjiaoxi-nginx-guard.sh         # Nginx 守护脚本
│   └── lvjiaoxi.service               # systemd 服务
├── .github/workflows/
│   ├── ci.yml                         # push/PR 触发：冒烟 + AI 巡检 + Docker
│   └── cron.yml                       # 每周一 10:00：AI 团队巡检周报
└── data/
    ├── app.db                         # SQLite 数据库（gitignore！）
    └── backups/                       # 数据库备份
```

---

## 3. 服务器多项目共存（最容易踩的坑！）

47.116.59.141 是共享服务器，绿角犀只是其中一个项目。**其他项目的部署脚本会动 Nginx 配置**。

### Nginx 三层防护

```
第一层：chattr +i 不可变锁
        /etc/nginx/conf.d/lvjiaoxi.conf
        （改配置前必须先 chattr -i 解锁！）

第二层：守护脚本
        /usr/local/bin/lvjiaoxi-nginx-guard.sh
        发现配置文件丢失 → 自动从 .bak.with-ip 恢复 → 加锁 → reload

第三层：cron 每 5 分钟
        */5 * * * * /usr/local/bin/lvjiaoxi-nginx-guard.sh
        （最多 5 分钟内自愈）
```

### 我们的 Nginx 配置

```nginx
# /etc/nginx/conf.d/lvjiaoxi.conf （已 chattr +i）
server {
    listen 80 default_server;          # 抢 IP 请求
    server_name lvjiaoxi.com www.lvjiaoxi.com;

    location / {
        proxy_pass http://127.0.0.1:3002;
        # ... 标准反代头
    }
}
```

### 改 Nginx 配置的正确姿势

```bash
# 1. 解锁
chattr -i /etc/nginx/conf.d/lvjiaoxi.conf

# 2. 改配置（本地 scp 上去或直接 vim）
vim /etc/nginx/conf.d/lvjiaoxi.conf

# 3. 验证 + 重载
nginx -t && nginx -s reload

# 4. 加锁
chattr +i /etc/nginx/conf.d/lvjiaoxi.conf

# 5. 备份也要更新（guard 脚本用这个恢复）
cp /etc/nginx/conf.d/lvjiaoxi.conf /etc/nginx/conf.d/lvjiaoxi.conf.bak.with-ip
```

---

## 4. 已知坑速查（9 条，别再踩！）

| ID | 坑 | 一句话 |
|----|-----|--------|
| I-001 | PM2 cluster env 不注入 | **强制 fork 模式**，不要用 cluster |
| I-002 | Nginx default_server 冲突 | **只有我们有 default_server**，其他项目的 conf 都去掉 |
| I-003 | 登录必须带 username | 冒烟测试里必须 `{username:'admin', password:'xxx'}` |
| I-004 | ensureAdmins 只在空表种子 | 生产部署后手动重置口令 |
| I-005 | git proxy 残留 | push 失败先 `git config --global --unset http(s).proxy` |
| I-006 | CI grep 误匹配汇总行 | grep 失败项必须排除统计行 |
| I-007 | gh CLI token scope 不够 | 初始化 GitHub 前先 `gh auth status` |
| I-008 | 阿里云 WAF 拦未备案域名 | 备案前用 IP 访问 |
| I-009 | lvjiaoxi.conf 被删 | 三层防护，改配置前必须解锁 |

**详情见 `.trae/memory/issues.md`，每条都有预防方法。**

---

## 5. 已确定的 10 条决策

| ID | 决策 |
|----|------|
| D-001 | 前端纯 HTML/CSS/JS，禁止构建工具 |
| D-002 | 后端 Node.js + Express + better-sqlite3 同步 |
| D-003 | PM2 fork + .env 双保险 |
| D-004 | Token 用 HMAC-SHA256 + pwd_version |
| D-005 | SQLite 单文件 better-sqlite3 |
| D-006 | PWA Service Worker + offline.html |
| D-007 | Agent + Skill + 巡检 + CI 四层 AI 团队架构 |
| D-008 | Nginx default_server 临时方案（备案前） |
| D-009 | DNS + ICP 同步推进 |
| D-010 | 冒烟测试 Node 原生 --test |

**详情见 `.trae/memory/decisions.md`。不要再讨论这些决策！**

---

## 6. AI 团队使用指南

### 11 个 Agent

```
前端改了？ → frontend-dev
后端改 API？ → backend-dev + api-doc-writer
写测试？ → test-engineer / e2e-test-engineer
审查代码？ → code-reviewer
查安全？ → security-auditor
部署？ → devops-engineer
想 UX 优化？ → ux-experience-tester
想竞品调研？ → market-researcher
AI 团队自己？ → self-evolution-engineer
```

### 台账自动管理

```bash
node tools/memory-manager.js remind              # 新会话读台账
node tools/memory-manager.js before-edit <path>  # 改文件前扫坑
node tools/memory-manager.js archive             # 会话结束提炼
node tools/memory-manager.js weekly              # 生成周报
node tools/memory-manager.js stats               # 统计
```

### 跨项目共享台账

`%userprofile%/.trae-cn/memory/shared-issues.md` + `shared-decisions.md`
所有项目的 memory-manager 都会自动加载。

---

## 7. 常用命令速查

### 本地

```bash
node tools/memory-manager.js remind              # 读台账
node tools/inspect-ai-team.js                    # AI 巡检
node tools/smoke-test.js                         # 冒烟测试
git push                                         # CI 自动触发
```

### SSH 服务器

```bash
ssh -i "C:\Users\Administrator\.ssh\greenrhino_deploy" root@47.116.59.141

pm2 list lvjiaoxi-web                            # 看状态
pm2 logs lvjiaoxi-web --lines 50                 # 看日志
pm2 restart lvjiaoxi-web                         # 重启
nginx -t && nginx -s reload                      # 重载 Nginx
chattr -i /etc/nginx/conf.d/lvjiaoxi.conf       # 解锁 Nginx
chattr +i /etc/nginx/conf.d/lvjiaoxi.conf       # 加锁 Nginx
tail -f /var/log/lvjiaoxi-guard.log              # 守护日志
ls -la /etc/nginx/conf.d/lvjiaoxi.conf.bak.*    # 所有备份
```

### 改 Nginx 后别忘了

```bash
# 更新守护脚本用的备份
cp /etc/nginx/conf.d/lvjiaoxi.conf /etc/nginx/conf.d/lvjiaoxi.conf.bak.with-ip
# 本地也更新 deploy/lvjiaoxi-nginx-guard.sh 的备份路径引用
```

---

## 8. 每周自动发生的事

| 时间 | 事件 |
|------|------|
| 每 5 分钟 | lvjiaoxi-nginx-guard.sh 检查配置 |
| 每天 | acme.sh 自动续 SSL（如果有） |
| 每周一 10:00 北京 | GitHub cron.yml 跑 AI 团队巡检周报 |
| push/PR 到 main | GitHub ci.yml 跑冒烟 + AI 巡检 + Docker |

---

## 9. 什么需要用户手动做（你帮不上）

| 任务 | 在哪做 | 备注 |
|------|--------|------|
| DNS A 记录 | 阿里云域名控制台 | `@` + `www` → 47.116.59.141 |
| ICP 备案 | 阿里云 ICP 备案控制台 | 需主体信息、上传证件，7-20 天 |
| 上传安装包 | 你手头有安装包才行 | 客户端 exe/dmg/apk |
| 品牌素材 | 你手头有 Logo/og.jpg/配色 | — |

---

## 10. 紧急恢复 Runbook

### Nginx 全挂了

```bash
ssh root@47.116.59.141
# 1. 先看是不是被删了
ls -la /etc/nginx/conf.d/lvjiaoxi.conf
# 2. 如果没了，跑守护脚本（应该自动恢复了，手动跑一遍也行）
/usr/local/bin/lvjiaoxi-nginx-guard.sh
# 3. 如果备份也没了，从本地 scp
scp deploy/lvjiaoxi.conf root@47.116.59.141:/etc/nginx/conf.d/lvjiaoxi.conf
chattr +i /etc/nginx/conf.d/lvjiaoxi.conf
nginx -t && nginx -s reload
```

### PM2 挂了

```bash
ssh root@47.116.59.141
pm2 restart lvjiaoxi-web
pm2 save
```

### 数据库坏了

```bash
ssh root@47.116.59.141
ls -lt /opt/lvjiaoxi-web/data/backups/ | head -1
# 用最新备份恢复
cp /opt/lvjiaoxi-web/data/backups/<最新文件> /opt/lvjiaoxi-web/data/app.db
```

---

## 11. 最后一句

**不要害怕踩坑——所有踩过的坑都在 `.trae/memory/issues.md` 里，都有预防方法。**
**不要重复造轮子——所有已定决策都在 `.trae/memory/decisions.md` 里。**
**不要忘了同步——改了 routes.js 记得同步 Agent 文件，巡检脚本会检查。**

欢迎接手，祝你好运！
