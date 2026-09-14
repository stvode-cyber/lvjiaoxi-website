# 踩坑台账 · Issues

> 每条坑记录：问题 / 解决方法 / 根因 / 预防 / 严重程度 / 关联文件
> 同一个坑解决 ≥3 次且已入 Skill → 自动移到 archive/

---

## I-001：PM2 cluster 模式 env 不注入 worker

| 字段 | 内容 |
|------|------|
| **问题** | `pm2 start ecosystem.config.js` 用 cluster 模式时，ecosystem 里的 env 变量不注入 worker 进程 |
| **解决方法** | 改用 fork 模式 + .env 文件双保险，env.js 不覆盖已存在变量 |
| **根因** | PM2 cluster 模式下 env 只在 master 进程生效，worker 进程继承环境变量但不读 ecosystem 里的 env 配置 |
| **预防** | 部署脚本强制 fork 模式，.env 文件必须存在且有生产凭据 |
| **严重程度** | 🔴 高（生产服务直接不可用） |
| **关联** | ecosystem.config.js、env.js、docker-deploy-guide/SKILL.md |
| **日期** | 2026-09-12 |
| **已入 Skill** | ✅ docker-deploy-guide 踩坑速查第 1 条 |

## I-002：Nginx default_server 冲突

| 字段 | 内容 |
|------|------|
| **问题** | greenrhino-cloud.conf 的 `listen 80 default_server` 抢了 lvjiaoxi 的 IP 请求，导致 404 |
| **解决方法** | 去掉 greenrhino-cloud.conf 的 default_server，给 lvjiaoxi.conf 加 default_server |
| **根因** | Nginx 多个 server{} 时 default_server 只有一个能生效，后加载的 .conf 可能覆盖 |
| **预防** | 生产改 Nginx 前必须 `nginx -t`，多站点时显式声明 default_server 归属 |
| **严重程度** | 🔴 高（IP 访问 404） |
| **关联** | /etc/nginx/conf.d/lvjiaoxi.conf、greenrhino-cloud.conf、docker-deploy-guide/SKILL.md |
| **日期** | 2026-09-12 |
| **已入 Skill** | ✅ docker-deploy-guide 踩坑速查 |

## I-003：登录接口必须带 username

| 字段 | 内容 |
|------|------|
| **问题** | 用 `{password:'xxx'}` 不带 username 登录返回 401，测试脚本以为密码错了 |
| **解决方法** | 冒烟测试里统一传 `{username:'admin', password:'xxx'}` |
| **根因** | routes.js 登录路由硬校验 username 字段存在性，不是 bcrypt 校验密码 |
| **预防** | 所有登录测试必须显式带 username 字段 |
| **严重程度** | 🟡 中（测试阻塞，生产没影响） |
| **关联** | routes.js POST /api/admin/login、backend-dev.md、api-doc-writer.md |
| **日期** | 2026-09-12 |
| **已入 Skill** | ✅ backend-dev.md + api-doc-writer.md + devops-engineer.md（3 处交叉验证） |

## I-004：ensureAdmins 只在空表种种子

| 字段 | 内容 |
|------|------|
| **问题** | 数据库有 admin 记录时 `ensureAdmins()` 不执行，快照里的口令是旧的，用新口令登不上 |
| **解决方法** | 用独立脚本重置 admin 口令，不依赖 ensureAdmins |
| **根因** | ensureAdmins 设计为初始化脚本，只在 SELECT COUNT(*)=0 时 INSERT |
| **预防** | 生产部署后必须重置 admin 口令，不要假设 ensureAdmins 会覆盖 |
| **严重程度** | 🟡 中（后台登不上） |
| **关联** | db.js ensureAdmins、backend-dev.md |
| **日期** | 2026-09-12 |
| **已入 Skill** | ✅ backend-dev.md + devops-engineer.md |

## I-005：git proxy 未运行导致 push 失败

| 字段 | 内容 |
|------|------|
| **问题** | `git push` 报 "proxy 127.0.0.1:7890 not responding"，本地没开代理但 git config 有 |
| **解决方法** | `git config --global --unset http(s).proxy` |
| **根因** | 之前用过代理软件，git config 写了 proxy，软件关了但配置残留 |
| **预防** | push 前先 `git config --global --get http.proxy` 确认 |
| **严重程度** | 🟢 低（阻塞推送） |
| **关联** | ~/.gitconfig |
| **日期** | 2026-09-13 |
| **已入 Skill** | ❌ 还没（等第三次踩坑） |

## I-006：CI grep 误匹配汇总行

| 字段 | 内容 |
|------|------|
| **问题** | `grep -c "❌ 失败"` 匹配到汇总行 "❌ 失败: 0"，把 0 当 1 个失败项 |
| **解决方法** | 改用 `grep -E "❌" | grep -vE "通过:\|警告:\|失败:"` 排除统计行 |
| **根因** | 巡检脚本输出汇总行也含 ❌ 关键字，grep 模式没排除 |
| **预防** | CI 里 grep 必须排除汇总统计行 |
| **严重程度** | 🟡 中（PR 被误阻塞） |
| **关联** | .github/workflows/ci.yml、inspect-ai-team.js |
| **日期** | 2026-09-13 |
| **已入 Skill** | ❌ 还没（等第三次踩坑） |

## I-007：GitHub gh CLI 没创建仓库权限

| 字段 | 内容 |
|------|------|
| **问题** | `gh repo create` 返回 403 Resource not accessible by integration |
| **解决方法** | 用浏览器扩展在 GitHub 网页上手动创建空仓库 |
| **根因** | gh token scope 不够，没 repo:create 权限 |
| **预防** | 初始化 GitHub 前先 `gh auth status` 确认 scope，不够就换 token 或手动创建 |
| **严重程度** | 🟢 低（只是多一步） |
| **关联** | ~/.config/gh/hosts.yml |
| **日期** | 2026-09-13 |
| **已入 Skill** | ❌ 还没（等第三次踩坑） |

## I-008：阿里云 WAF 拦截未备案域名

| 字段 | 内容 |
|------|------|
| **问题** | 带 `Host: lvjiaoxi.com` 的请求返回 403 "Non-compliance ICP Filing"，响应头 Server: Beaver |
| **解决方法** | 用 IP 直接访问（带 default_server），同时提交 ICP 备案 |
| **根因** | 阿里云对未备案 .com 域名在 WAF 层直接拦截，请求没到服务器 |
| **预防** | 买阿里云域名后第一时间提交 ICP 备案，备案前用 IP 访问 |
| **严重程度** | 🟡 中（域名不可用） |
| **关联** | docker-deploy-guide/SKILL.md、security-audit-guide/SKILL.md、AGENTS.md |
| **日期** | 2026-09-12 |
| **已入 Skill** | ✅ docker-deploy-guide + security-audit-guide + AGENTS.md |
