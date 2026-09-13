# 安全审计指南

## 触发条件
上线前、重大变更后、或用户说"查一下安全"时使用。

## 快速审计（10 分钟）
1. `grep -r "password\|secret\|token\|key" --include="*.js" server/` — 看有没有硬编码
2. `grep -r "\.env\|\.db\|\.git" server/server.js` — 静态守卫是否覆盖
3. curl 测试登录防爆破（错误口令 5 次，第 6 次应 429）
4. curl 测试静态守卫（访问 /.env / /server.js / /data/app.db）
5. `pm2 env 4 | grep -i password` — 确认口令不是默认 admin123

## 详细审计

### 1. 认证体系
- [ ] `ensureAdmins()` 幂等建表，空表时种 admin 用户
- [ ] 口令 scrypt + 随机盐（不是 md5/bcrypt/sha）
- [ ] Token HMAC-SHA256 签名，密钥非默认
- [ ] Token 含 `pwd_version`（改口令旧 token 失效）
- [ ] 登录防爆破：5 次失败锁 5 分钟
- [ ] 最后一个 admin 不可降级/删除

### 2. 输入校验
- [ ] 留言 name ≤ 100 字符，message ≤ 500 字符
- [ ] 下载 URL 白名单（http/https），禁止 file:// / javascript: / data:
- [ ] 产品名 / 分类名无 HTML 标签（防 XSS）
- [ ] SQL 全部参数化（express-validator 或自定义校验）

### 3. 静态托管
- [ ] 白名单守卫覆盖：`.env` / `.db` / `.git` / `server/` / `node_modules/` / `backups/`
- [ ] 守卫在 `express.static` 之前注册
- [ ] `client_max_body_size` 限制（当前 1MB）

### 4. 传输安全
- [ ] CSP 有 `default-src 'self'`（或更严格）
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] Nginx 80 → 443 跳转（HTTPS 落地后）

### 5. 部署安全
- [ ] `.env` 在 `.gitignore`
- [ ] PM2 env 不打印到日志（pm2-docker 或 fork 模式）
- [ ] 服务器防火墙只开 22/80/443
- [ ] SSH 密钥登录，禁止密码登录

### 6. PWA 安全
- [ ] Service Worker scope 不超过网站根目录
- [ ] manifest.json 的 `start_url` 在同源
- [ ] 无敏感数据存 localStorage

## 工具
```bash
# 测试静态守卫
curl -s http://47.116.59.141/.env
curl -s http://47.116.59.141/server/config.js
curl -s http://47.116.59.141/data/app.db
# 全部应返回 404 或空

# 测试防爆破
for i in 1 2 3 4 5 6; do curl -s -X POST -H 'Content-Type: application/json' -d '{"username":"admin","password":"wrong"}' http://127.0.0.1:3002/api/admin/login; echo; done
# 第 6 次应返回 429
```

## 输出模板
```
## 安全审计报告 · YYYY-MM-DD
| 等级 | 数量 |
|------|------|
| 🔴 严重 | N |
| 🟠 高   | N |
| 🟡 中   | N |
| 🟢 低   | N |

### 🔴 严重
- [位置] 风险 + 修复

### 🟠 高
- ...
```

## 禁止事项

- **不要为了"安全"引入不必要的复杂度**（项目走极简路线）
- **不要忽略 CSP `style-src 'unsafe-inline'` 的必要性标记**（31 处 inline style + CSSOM 依赖）
- **不要夸大风险等级**（标 🔴 必须真的能被利用）
- **不要在报告里泄露真实口令/密钥**（用占位符）
- **不要假设云厂商 WAF 会放行**（ICP 未备案的域名阿里云 WAF 直接 403）

## 常见坑速查

| 现象 | 根因 | 检查方法 |
|------|------|---------|
| 外网访问 403 "Non-compliance ICP Filing" | 阿里云 WAF 在域名层面拦截未备案域名 | 不是服务器问题！查 DNS + 查备案状态 |
| curl 登录 401 但密码对 | curl 漏了 `username` 字段 | 必须 `{username:'admin', password:'xxx'}` |
| ensureAdmins 用新口令 seed 但登录还是旧密码 | 数据库里已有 admin 用户，seed 只在空表时执行 | 用 scrypt 重置数据库里的 hash，或清空表 |
| PM2 cluster 模式 env 不注入 worker | Node 进程里 process.env.ADMIN_PASSWORD undefined | 改 fork 模式 + `.env` 文件双保险 |
| Nginx 外网 502 但服务器内部 curl 正常 | default_server 被 greenrhino-cloud.conf 抢了 | 去掉其 default_server + IP 精确匹配 |
