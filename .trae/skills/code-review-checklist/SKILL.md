# 代码审查 Checklist

## 触发条件
每次提交代码后、合入前、或用户说"帮我审查一下"时使用。

## 快速通道（5 分钟过一遍）
1. 冒烟测试是否通过？→ `node tools/smoke-test.js`
2. git diff 里有没有敏感信息（口令/密钥/IP）？
3. 新增/修改的路由有没有鉴权？
4. i18n key 是否补全 7 种语言？
5. `sw.js` 是否预缓存新增资源？

## 详细 Checklist

### 前端
- [ ] HTML 结构：语义化标签 `<header>/<main>/<section>/<nav>/<footer>`
- [ ] JS 模块：ES Module（`import/export`），无 CommonJS
- [ ] JS 加载顺序：`motion.js` → `main.js` / `admin.js`
- [ ] i18n：所有用户可见文案走 `t('key')`，7 语言补全
- [ ] PWA：`sw.js` 预缓存新增页面/JS/CSS
- [ ] 图片：`assets/img/products/` 有原图 + `*-sm.jpg` 缩略图
- [ ] CSP：`style-src 'unsafe-inline'` 未被移除
- [ ] 无 inline `<script>` 标签（除 `sw.js` 注册）

### 后端
- [ ] SQL：全部参数化（`db.prepare(sql).run(?)`），无字符串拼接
- [ ] DB 操作：同步 API（`.run/.get/.all`），无 async 包裹
- [ ] 字段迁移：幂等（`PRAGMA table_info` 先查）
- [ ] 路由：express.json → 请求ID → 日志 → 静态 → 路由 → 404 → 错误处理
- [ ] 错误响应：`{ error: '中文', requestId: 'xxx' }`
- [ ] 后台接口：有 `Authorization: Bearer` 校验
- [ ] 登录防爆破：`MAX_LOGIN_FAILS=5`，`LOGIN_LOCK_MS=5min`
- [ ] 静态守卫：db/auth/server/.env/backups 一律 404

### 安全
- [ ] 口令：scrypt + 随机盐，**禁止明文**
- [ ] Token：HMAC-SHA256 + `pwd_version`，8h TTL
- [ ] `.env` 在 `.gitignore`
- [ ] 无硬编码密钥/口令
- [ ] admin 最后一个不会被降级/删除

### 部署
- [ ] PM2 用 fork 模式（非 cluster）
- [ ] 端口：开发 3000，生产 3002
- [ ] Nginx：default_server 冲突已解决
- [ ] `pm2 save` 已执行
- [ ] 生产冒烟带真实口令

## 输出模板
```
## 代码审查结果
### ✅ 通过项
- [文件:行号] 符合规范
### ⚠️ 建议改进
- [文件:行号] 说明 + 建议改法
### ❌ 阻塞问题
- [文件:行号] 风险 + 修复方案
```

## 禁止事项

- **不要只说 "LGTM"** — 必须逐文件过
- **不要跳过安全相关审查**（认证/输入校验/静态守卫）
- **不要把冒烟测试当万能药**（冒烟通过 ≠ 代码没问题）
- **不要为了让冒烟通过而修改冒烟代码**（应该改业务代码）
- **不要假设 i18n 只加了 zh 就够了**（必须补全 7 种语言）
- **不要忽略 sw.js 预缓存**（新页面必须加进去）

## 常见坑速查

| 现象 | 根因 | 检查方法 |
|------|------|---------|
| 改了 API 冒烟断言失败 | 忘了同步改 smoke-test.js | `git diff` 看 routes.js + smoke-test.js 是否一起变 |
| i18n 新增 key 只加了 zh | 其他语言显示 key 原文 | 搜 `i18n.js` 里的语言对象，看新 key 是否全覆盖 |
| 新页面离线 404 | sw.js 没加预缓存 | Chrome DevTools → Application → Cache Storage 检查 |
| 登录接口 401 但密码对 | curl 漏了 `username` 字段 | 必须 `{username:'admin', password:'xxx'}` |
| Node 进程 online 但 curl 不通 | PM2 cluster 模式 env 没注入 worker | 改 fork + `.env` 双保险 |
