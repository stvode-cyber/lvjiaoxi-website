# DevOps 工程师 · DevOps Engineer

## 角色

绿角犀官网部署与运维负责人，负责服务器、PM2、Nginx、备份和监控。

## 生产环境速查

| 项目 | 值 |
|------|-----|
| 服务器 | 阿里云 47.116.59.141 |
| SSH 密钥 | `C:\Users\Administrator\.ssh\greenrhino_deploy` |
| 应用路径 | `/opt/lvjiaoxi-web` |
| PM2 进程 | `lvjiaoxi-web`（fork，端口 3002，max_memory 256M） |
| Nginx 配置 | `/etc/nginx/conf.d/lvjiaoxi.conf` |
| 日志 | PM2: `/root/.pm2/logs/lvjiaoxi-web-*.log` / 应用: `data/server.log`, `data/error.log` |
| 数据库 | `data/app.db`（better-sqlite3，WAL 模式） |
| 备份 | `data/backups/lvjiaoxi-YYYYMMDD-HHMM.db` |

## 部署操作手册

### 日常重启
```bash
ssh -i C:\Users\Administrator\.ssh\greenrhino_deploy root@47.116.59.141
pm2 restart lvjiaoxi-web
```

### 冒烟验证
```bash
ADMIN_PASSWORD='KRcC!5AZYBCmaZta2S7G' node tools/smoke-test.js --url=http://127.0.0.1:3002
```

### 备份
```bash
node tools/maintain.js backup
# 或 PM2 环境变量方式
cd /opt/lvjiaoxi-web && node tools/maintain.js backup
```

### 恢复
```bash
node tools/maintain.js restore lvjiaoxi-20260912-0916.db
# 必须先停 PM2，恢复后再启动
pm2 stop lvjiaoxi-web && node tools/maintain.js restore xxx.db && pm2 start lvjiaoxi-web
```

### 上线新版本
```bash
# 1. 本地打包验证
npm run smoke

# 2. 上传（增量上传或全量）
scp -r -i C:\Users\Administrator\.ssh\greenrhino_deploy ./server/* root@47.116.59.141:/opt/lvjiaoxi-web/server/
scp -r -i C:\Users\Administrator\.ssh\greenrhino_deploy ./assets/* root@47.116.59.141:/opt/lvjiaoxi-web/assets/
scp -i C:\Users\Administrator\.ssh\greenrhino_deploy ./tools/* root@47.116.59.141:/opt/lvjiaoxi-web/tools/

# 3. 备份 + 重启 + 冒烟
node tools/maintain.js backup
pm2 restart lvjiaoxi-web
ADMIN_PASSWORD='KRcC!5AZYBCmaZta2S7G' node tools/smoke-test.js --url=http://127.0.0.1:3002
```

## Nginx 回滚（备案通过后）

详见 `deploy/rollback-nginx-https.sh`，一键切域名 + HTTPS。

## 踩坑记录

| 日期 | 问题 | 根因 | 解决 |
|------|------|------|------|
| 2026-09-12 | PM2 delete + start 后端口 3000 | `--update-env` 不生效，ecosystem.config.js 必须在项目根 | fork 模式 + `.env` 文件双保险 |
| 2026-09-12 | Nginx default_server 冲突 | greenrhino-cloud.conf 抢 IP 请求 | 去掉其 default_server 和 IP 精确匹配 |
| 2026-09-12 | 登录 401 但冒烟过 | curl 漏了 `username` 字段 | 登录必须 `{username:'admin', password:'xxx'}` |
| 2026-09-13 | 域名 403 | 阿里云 WAF 拦截未备案域名 | ICP 备案（7-20 天） |

## 禁止事项

- 不要在生产直接 `pm2 delete` 不确认备份
- 不要用 `pm2 start ecosystem.prod.js`（不是 ecosystem.config.js，PM2 当脚本执行）
- 不要忘记 `pm2 save`（重启服务器后进程丢失）
- 不要在生产跑 `npm install`（用 `--production`，锁版本）
- 不要忽略 502/504（Nginx 反代断了或 Node 崩了）
