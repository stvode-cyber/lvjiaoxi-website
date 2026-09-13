# 绿角犀官网 · 项目长期记忆

## 技术栈
Node + Express + better-sqlite3（文件库 `data/app.db`，WAL）；零构建前端；PWA。后台单/多管理员（默认用户 `admin`，口令 `admin123`，存 `admins` 表 scrypt 哈希）。

## 回归自检 `tools/smoke-test.js`（零依赖，核心护栏）
- 用法：`npm run smoke`（探 3000，没跑则临时拉起随机端口实例，结束自动关）/ `--spawn`（CI 用，强制临时实例）/ `--url=...`（线上）。
- 架构：每个维度加一个 `section('[N] ...')`，内部用 `ok(name, cond, detail)`。HTTP 检查走 `req()/status()`；**纯前端不变量（a11y/SEO 标记）直接 `fs.readFileSync` 读仓库文件做正则断言**，不依赖运行实例。
- 当前覆盖 13 组共 **145 项**（页面/API/鉴权/静态白名单/资源缓存/安全头/SEO/留言防滥用/可观测性/a11y/结构化数据/后台二次确认弹窗/产品表单双重校验）。改完前端必跑一遍。

## 关键约定与坑（跨会话复用）
1. **登录接口契约 = 用户名 + 口令**：`POST /api/admin/login` 需 `{username, password}`，默认 `username:'admin'`。冒烟用例曾只发 `{password}` 导致 `--spawn` 长期假性 401——加断言时务必带 `username`。
2. **域名单一来源**：HTML 硬编码占位 `https://lvjiaoxi.example.com`，由 `server/server.js` 中间件在响应时替换为 `config.siteUrl`（env `SITE_URL`）。结构化数据/O元信息里写占位域名即可，会被自动替换。
3. **`--spawn` 与运行实例共用 `data/app.db`**：读操作无碍；不要在临时实例里做写库后依赖运行实例看到。
4. **Windows 路径**：给 node 传路径一律 Windows 正斜杠 `C:/Users/...`，反斜杠会被 Git Bash 吞。
5. **静态托管白名单守卫**挂在 `express.static` 前，敏感路径（db/auth/server/节点模块/.env/backups）一律 404。

## 外部依赖（仍待用户提供，切勿 mock）
真实安装包（放 `downloads/`，后台填 `/downloads/xxx` 即生效）、品牌素材、SMTP 凭据（留言通知）、服务器+域名（按 `DEPLOY.md` 上线）。

## 维度演进速查（近期）
- 维度 42：多语言 中英二元 → **6 语言下拉**（zh/en/ja/ko/es/fr），`i18n.js` 重写 + 8 页按钮替换 + 下拉样式。
- 维度 43：a11y 断言固化（[10] 组）+ 修复冒烟登录契约 bug（缺 `username` 致 `--spawn` 长期假性 401）+ 结构化数据收尾（download/contact 加 BreadcrumbList，product.js 注入 SoftwareApplication+BreadcrumbList @graph）。
- 维度 44：后台危险操作二次确认弹窗（新建 `confirm-modal.js` UMD 模块 + `admin.js` 改用 `showConfirm`、移除原生 `confirm` + 6 语言 4 key + 弹窗样式 + `_verify_confirm.js` 行为桩）。
- 维度 45：产品表单双重校验（服务端 trim/长度/URL 协议白名单 + 客户端 `r.ok` 检查 + `admin.html` maxlength）。
- 维度清单无单一索引文件，分散在 `.workbuddy/memory/` 每日日志与 README「回归自检」表；README「功能」章为特性总览。
