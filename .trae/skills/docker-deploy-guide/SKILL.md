# 部署手册

## 触发条件
需要部署到生产、回滚、或用户说"帮我上线"时使用。

## 快速部署（5 步）
```bash
# 1. 本地验证
cd c:\Users\Administrator\Desktop\绿角犀官网
node tools/smoke-test.js

# 2. 上传（增量）
scp -r -i C:\Users\Administrator\.ssh\greenrhino_deploy ./server/* root@47.116.59.141:/opt/lvjiaoxi-web/server/
scp -r -i C:\Users\Administrator\.ssh\greenrhino_deploy ./assets/* root@47.116.59.141:/opt/lvjiaoxi-web/assets/
scp -i C:\Users\Administrator\.ssh\greenrhino_deploy ./tools/* root@47.116.59.141:/opt/lvjiaoxi-web/tools/

# 3. 备份 + 重启
ssh -i C:\Users\Administrator\.ssh\greenrhino_deploy root@47.116.59.141
cd /opt/lvjiaoxi-web
node tools/maintain.js backup
pm2 restart lvjiaoxi-web

# 4. 冒烟验证
ADMIN_PASSWORD='KRcC!5AZYBCmaZta2S7G' node tools/smoke-test.js --url=http://127.0.0.1:3002

# 5. 外网验证
curl -s http://47.116.59.141/api/health
```

## 完整部署（含 PM2/Nginx 调整）

### PM2 配置
```javascript
// /opt/lvjiaoxi-web/ecosystem.config.js
module.exports = {
  apps: [{
    name: 'lvjiaoxi-web',
    script: 'server/server.js',
    cwd: '/opt/lvjiaoxi-web',
    instances: 1,
    exec_mode: 'fork',           // 必须 fork，cluster 模式 env 不注入 worker
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
      PORT: '3002',
      SITE_URL: 'https://lvjiaoxi.com',
      ADMIN_PASSWORD: 'KRcC!5AZYBCmaZta2S7G',
      AUTH_SECRET: 'd9e34d83532f24dbf2015e4cb22b0cc0501b7df34b6e7d14bb498e687aed113b',
    },
  }],
};
```

### .env 文件（双保险）
```
# /opt/lvjiaoxi-web/.env
NODE_ENV=production
PORT=3002
SITE_URL=https://lvjiaoxi.com
ADMIN_PASSWORD=KRcC!5AZYBCmaZta2S7G
AUTH_SECRET=d9e34d83532f24dbf2015e4cb22b0cc0501b7df34b6e7d14bb498e687aed113b
```

### Nginx 配置
```nginx
# /etc/nginx/conf.d/lvjiaoxi.conf
server {
    listen 80 default_server;
    server_name lvjiaoxi.com www.lvjiaoxi.com 47.116.59.141;
    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 启动
```bash
cd /opt/lvjiaoxi-web
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd   # 开机自启（按提示复制 systemd 命令执行）
```

## 回滚

### 数据库回滚
```bash
pm2 stop lvjiaoxi-web
node tools/maintain.js restore lvjiaoxi-YYYYMMDD-HHMM.db
pm2 start lvjiaoxi-web
ADMIN_PASSWORD='KRcC!5AZYBCmaZta2S7G' node tools/smoke-test.js --url=http://127.0.0.1:3002
```

### 代码回滚
```bash
# 用 git 或重新上传上一个版本
```

### Nginx 回滚
备案通过后切回域名 + HTTPS：
```bash
bash /opt/lvjiaoxi-web/deploy/rollback-nginx-https.sh
```

## 踩坑速查

| 现象 | 原因 | 解决 |
|------|------|------|
| 进程 online 但 curl 000 | 端口被占或 env 没注入 | `pm2 delete` → fork 模式重启 → 确认 `.env` |
| 登录 401 但冒烟过 | curl 漏了 `username` | 必须 `{username:'admin', password:'xxx'}` |
| 外网 502 | Nginx 反代的 Node 崩了 | `pm2 logs lvjiaoxi-web` 看 err |
| 外网 403 "Non-compliance ICP" | 阿里云 WAF 拦截 | ICP 备案通过后自动恢复 |
| HTTPS 签不了 | DNS 未生效 | 等 DNS 生效后 certbot |

## 禁止事项

- **不要在生产跑 `npm install`**（用 `--production`，锁版本）
- **不要用 `pm2 start ecosystem.prod.js`**（PM2 只认 ecosystem.config.js，其他当普通脚本执行）
- **不要忘记 `pm2 save`**（重启服务器后进程丢失）
- **不要在生产直接 `pm2 delete`**（先确认有备份 + 冒烟通过）
- **不要忽略 502/504**（Nginx 反代断了或 Node 崩了）
- **不要在 `.env` 里留占位符**（`__CHANGE_ME__` 必须替换）
