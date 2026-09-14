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
| 生产口令 | ADMIN_PASSWORD=KRcC!5AZYBCmaZta2S7G | AUTH_SECRET=d9e34d83532f24dbf2015e4cb22b0cc0501b7df34b6e7d14bb498e687aed113b |
| Token | HMAC-SHA256 + pwd_version + 8h TTL | 改口令后旧 Token 立即失效 |
| 防爆破 | 5 次失败锁 5 分钟 | MAX_LOGIN_FAILS=5, LOGIN_LOCK_MS=300000 |
| 冒烟测试 | node tools/smoke-test.js | --spawn 模式零依赖 |
| AI 团队 | 11 Agent + 11 Skill + inspect-ai-team.js + CI 巡检 | |
| GitHub 仓库 | https://github.com/stvode-cyber/lvjiaoxi-website | main 分支 |

## 🟡 当前状态（2026-09-14 22:46 验证）

| 项目 | 状态 | 备注 |
|------|------|------|
| 服务器运行 | ✅ online | PM2 lvjiaoxi-web fork 模式，PID 587255，uptime ~36h |
| Nginx | ✅ default_server | lvjiaoxi.conf default_server + chattr +i 锁 |
| 守护脚本 | ✅ 运行中 | /usr/local/bin/lvjiaoxi-nginx-guard.sh |
| 守护 cron | ✅ 已加 | */5 * * * * |
| 外网 IP 访问 | ✅ http://47.116.59.141 通 | 临时方案，备案后切域名 |
| 域名访问 | ❌ 403 | 阿里云 WAF 拦截（ICP 备案未过） |
| DNS A 记录 | ❌ 未加 | lvjiaoxi.com + www → 47.116.59.141 |
| ICP 备案 | ❌ 未提交 | 阿里云 ICP 备案控制台 |
| SSL 证书 | ❌ 未签发 | certbot --nginx（DNS 生效后） |
| 下载安装包 | ❌ 未上传 | downloads/ 目录空 |
| CI 流水线 | ✅ 跑通 | ci.yml push/PR + cron.yml 每周一 10:00 |
| AI 台账 | ✅ 已建 | .trae/memory/ + memory-manager.js |

## 🟢 待办（按优先级）

| 优先级 | 任务 | 在哪做 | 详细 |
|--------|------|--------|------|
| 🔴 P0 | DNS A 记录 lvjiaoxi.com → 47.116.59.141 | 阿里云域名控制台 | 加两条：`@` 和 `www` |
| 🔴 P0 | 提交 ICP 备案 | 阿里云 ICP 备案控制台 | 需要主体信息、网站信息、上传证件 |
| 🟡 P1 | 备案通过后跑 rollback-nginx-https.sh | SSH 服务器 | 脚本在 deploy/rollback-nginx-https.sh |
| 🟡 P1 | 上传下载安装包到 downloads/ | SSH + 后台上架 | 客户端安装包放 /opt/lvjiaoxi-web/downloads/ |
| 🟢 P2 | 跑 UX 测试找一键化机会 | 本地 | 让 ux-experience-tester 跑 |
| 🟢 P2 | 替换品牌素材（Logo/og.jpg/配色） | 本地 + upload | — |

## ⚠️ 服务器多项目共存（重要！）

47.116.59.141 跑多个项目，绿角犀只是其中一个：

| PM2 进程 | 用途 | 端口 | 备注 |
|----------|------|------|------|
| **lvjiaoxi-web** | **绿角犀（我们的）** | 3002 | ✅ fork 模式，env 在 PM2 里 |
| erp-backend | zhiyun-erp | 3000 | 被 lvjiaoxi default_server 覆盖 |
| aie-backend | AIE 后端 | — | 独立项目 |
| rc-monitor | 健康巡检 | — | cron 每 5 分钟 |

| Nginx conf | listen | 用途 | 备注 |
|------------|--------|------|------|
| **lvjiaoxi.conf** | **80 default_server** | **绿角犀** | ✅ chattr +i 锁 |
| erp-web.conf | 80 | zhiyun-erp | 无 default_server，被我们抢 |
| greenrhino-cloud.conf | 8091 | greenrhino-cloud | 已改端口 |
| greenrhino-cloud-ssl.conf | 443 | greenrhino-cloud SSL | |
| lujax_cloud.conf | 80 | lujax | 无 default_server |
| lujax-cloud-https.conf | 443 | lujax SSL | |

**风险**：其他项目的部署脚本可能再动 Nginx 配置。我们已有三层防护：
1. chattr +i 文件锁
2. lvjiaoxi-nginx-guard.sh 守护脚本
3. cron 每 5 分钟检查恢复

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
| 台账管理器 | tools/memory-manager.js |
| CI | .github/workflows/ci.yml |
| 定期巡检 | .github/workflows/cron.yml |
| 回滚脚本 | deploy/rollback-nginx-https.sh |
| Nginx 守护 | deploy/lvjiaoxi-nginx-guard.sh |
| 部署指南 | .trae/skills/docker-deploy-guide/SKILL.md |
| GitHub 仓库 | https://github.com/stvode-cyber/lvjiaoxi-website |

## 📁 服务器关键路径

| 想找 | SSH 后路径 |
|------|-----------|
| 应用目录 | /opt/lvjiaoxi-web/ |
| Nginx conf | /etc/nginx/conf.d/lvjiaoxi.conf |
| Nginx conf 备份 | /etc/nginx/conf.d/lvjiaoxi.conf.bak.with-ip |
| 守护脚本 | /usr/local/bin/lvjiaoxi-nginx-guard.sh |
| 守护日志 | /var/log/lvjiaoxi-guard.log |
| PM2 日志 | /root/.pm2/logs/lvjiaoxi-web-*.log |
| 数据库备份 | /opt/lvjiaoxi-web/data/backups/ |

## 🔗 关联文件（改这里必须同步那里）

| 改了 | 必须同步 |
|------|---------|
| server/routes.js | backend-dev.md、api-doc-writer.md、inspect-ai-team.js |
| AGENTS.md 红线 | code-review-checklist/SKILL.md |
| Nginx 配置 | docker-deploy-guide/SKILL.md、rollback-nginx-https.sh、lvjiaoxi-nginx-guard.sh 备份 |
| .env 凭据 | ecosystem.config.js、deploy/lvjiaoxi.service |
| 冒烟测试新增断言 | code-review-checklist/SKILL.md |
| 加新页面 | frontend-dev.md、inspect-ai-team.js |

## 🔐 SSH 连接速查

```bash
ssh -i "C:\Users\Administrator\.ssh\greenrhino_deploy" root@47.116.59.141

# 常用操作
pm2 list lvjiaoxi-web                    # 看状态
pm2 logs lvjiaoxi-web --lines 50         # 看日志
nginx -t && nginx -s reload              # 重载 Nginx
chattr -i /etc/nginx/conf.d/lvjiaoxi.conf   # 解锁（改配置前）
chattr +i /etc/nginx/conf.d/lvjiaoxi.conf   # 加锁（改完后）
lsattr /etc/nginx/conf.d/lvjiaoxi.conf      # 查看锁状态
tail -f /var/log/lvjiaoxi-guard.log          # 看守护日志
*/5 * * * * /usr/local/bin/lvjiaoxi-nginx-guard.sh >> /var/log/lvjiaoxi-guard.log 2>&1  # cron
```

---

> **变更日志**
> - 2026-09-14：Nginx 守护机制上线（chattr +i + guard.sh + cron），服务器精确状态更新
> - 2026-09-14：Nginx 配置文件被删事故，加三层防护
> - 2026-09-14：初始化台账系统（decisions/issues/context/index + memory-manager.js）
> - 2026-09-12：生产部署完成，IP 访问可用
