# 绿角犀官网 · 部署手册

本文档覆盖从「零」到「线上可访问」的完整部署流程。项目为**纯静态前端 + Node/Express/SQLite**，零构建、无外部服务依赖，单机即可运行。

---

## 一、环境要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | Linux（推荐 Ubuntu 22.04+）/ Windows Server / macOS |
| Node.js | **18 LTS 或 20 LTS**（better-sqlite3 为原生模块，需对应版本编译；用 `node -v` 确认） |
| 内存 | ≥ 256 MB（含 SQLite） |
| 端口 | 默认 3000（可经 `PORT` 修改；生产建议由 nginx 反代 80/443） |
| 权限 | 运行用户对项目目录（含 `data/`）有读写权限 |

> 首次 `npm install` 时 `better-sqlite3` 可能需本地编译；若离线或编译失败，可改用预编译二进制或对应 Node 版本的预构建包。

---

## 二、安装与本地启动

```bash
# 1. 安装依赖（express / better-sqlite3 / compression）
npm install

# 2. （可选）创建 .env 注入配置，参考 .env.example
cp .env.example .env
#   编辑 .env 填写 ADMIN_PASSWORD / PORT / SITE_URL

# 3. 启动
npm start            # 等价于 node server/server.js
```

- 官网： http://localhost:3000
- 下载页： http://localhost:3000/download.html
- 后台： http://localhost:3000/admin.html（默认口令 `admin123`，**上线前必改**）

`.env` 由项目内零依赖加载器读取，**无需额外安装 dotenv**；系统/进程管理器已注入的环境变量优先级更高。

---

## 三、生产部署方式

### 方式 A：PM2（推荐，最简单）

已提供 `deploy/ecosystem.config.js`（单实例、崩溃自启、`max_memory_restart 256M`、环境变量注入）。

```bash
npm install -g pm2
pm2 start deploy/ecosystem.config.js
pm2 save                        # 开机自启：pm2 startup（按提示执行生成命令）
```

ecosystem 中已配置 `ADMIN_PASSWORD` / `PORT` / `SITE_URL`，**请勿将真实口令写入仓库**。

### 方式 B：systemd（Linux 服务）

已提供 `deploy/lvjiaoxi.service`。按需修改 `User` / `WorkingDirectory` / `Environment` 后：

```bash
sudo cp deploy/lvjiaoxi.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lvjiaoxi
journalctl -u lvjiaoxi -f     # 查看日志
```

---

## 四、反向代理与 HTTPS（nginx）

已提供 `deploy/nginx.conf` 示例（443 + HTTP/2 + HSTS + 反代 + 透传 `X-Forwarded-*`）。要点：

1. 将 `server_name lvjiaoxi.example.com;` 改为真实域名，并放置证书路径。
2. 证书可用 Let's Encrypt 免费签发：
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d lvjiaoxi.example.com
   ```
3. nginx 已开启 gzip，因此 Node 端 `compression` 与 nginx 不必重复（保留其一即可，当前 Node 端已开启）。
4. 反代需透传 `X-Forwarded-For` / `X-Forwarded-Proto`，配合 `server.js` 中 `app.set('trust proxy', 1)`，使限流/防爆破按真实客户端 IP 生效。
5. 重启 nginx：`sudo nginx -t && sudo systemctl reload nginx`。

---

## 五、站点域名（务必配置）

`SITE_URL` 决定下列对外链接的正确性与 SEO：

- `sitemap.xml` 中的 `<loc>`
- `robots.txt` 中的 `Sitemap:` 地址
- 各页面 `og:url` / `canonical` / JSON-LD 中的站点域名（服务端中间件会把占位域名 `https://lvjiaoxi.example.com` 统一替换为真实域名）

配置位置（优先级从高到低）：

1. 环境变量 `SITE_URL=https://www.lvjiaoxi.com`（PM2 / systemd / .env）
2. 或 `server/config.js` 的 `siteUrl`

配置完成后访问任意页面，查看源码中 `og:url` / `canonical` 应已变为真实域名。

---

## 六、数据库备份与恢复

SQLite 文件位于 `data/app.db`（含 `-wal` / `-shm` 附属文件）。

**方式一（推荐，在线备份）：** 后台登录后访问 `GET /api/admin/backup`，下载一致性快照（已合并 WAL）。

**方式二（停机拷贝）：**
```bash
# 停止服务后拷贝整个 data/ 目录（务必连同 -wal / -shm 一起）
cp -r data/ /backup/lvjiaoxi-data-$(date +%F)/
```
恢复：把备份的 `data/app.db*` 整体覆盖回项目 `data/` 并重启。

> 建议结合 cron 每日定时拷贝 `data/` 目录；WAL 模式下单拷 `app.db` 会丢失未落盘事务，务必整目录拷贝。

---

## 七、升级流程

```bash
# 1. 备份 data/（见上）
# 2. 拉取/替换代码
git pull            # 或手动覆盖文件
npm install         # 依赖变更时

# 3. 重启
pm2 restart lvjiaoxi            # PM2
#   或
sudo systemctl restart lvjiaoxi # systemd
```

`server/db.js` 启动时会**幂等迁移**表结构（自动补齐缺失字段）并仅在 `products` 为空时写入种子数据，**升级不会清空现有数据**。

---

## 八、健康检查与监控

- 公开探针：`GET /api/health` → `{ "status": "ok", "uptime": ..., "db": "ok" }`
  - PM2 / systemd / 容器存活探针均可周期性请求该端点。
- 后台自检：`GET /api/admin/sysinfo`（需 Bearer Token）查看运行时/数据库/计数。

---

## 九、故障排查

| 现象 | 排查 |
| --- | --- |
| 端口占用 `EADDRINUSE` | 旧进程未退出：`pkill -f "node server/server.js"` 后重试 |
| 限流/防爆破全部归到 127.0.0.1 | 检查 nginx 是否透传 `X-Forwarded-For`；确认 `trust proxy` 已开启 |
| 数据库只读 / 写入失败 | 运行用户对 `data/` 无写权限；检查目录权限 |
| OG/分享链接仍为占位域名 | 未配置 `SITE_URL`；在 .env / 进程管理器 / config.js 中设置 |
| 升级后页面样式错乱 | 浏览器缓存；硬刷新或 `Ctrl+Shift+R` |
| 后台登录即刻 429 | 同一 IP 连续失败触发 15 分钟锁定（防爆破）；稍后重试或用其他网络 |
