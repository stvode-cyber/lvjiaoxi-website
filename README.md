# 绿角犀官网

公司官网 + 产品下载中心 + 后台数据管理。纯静态前端 + Node.js/Express/SQLite，零构建、可直接静态托管。

## 功能

- **官网首页**（`index.html`）：触达式滚动动画、公司介绍、实力数据、应用/游戏业务概览。
- **产品下载页**（`download.html`）：运行时从接口拉取「已上架」产品，分应用/游戏两区，支持分类、搜索与**排序切换（默认/最新/热门/名称）**。
- **后台**（`admin.html`）：多管理员（admin/viewer 角色门控）+ Bearer Token 登录，看板（浏览量/下载量/流量趋势（7/14/30 天可切换）/各产品下载/未处理留言提醒/**访问分析（浏览器/系统/语言/时区分布）**/**反馈概览（总数/未处理/平均分/按产品分布/近 7 天趋势）**）、产品上下架/编辑/删除/排序权重/**CSV 批量导入**/**批量上架·下架·改分类·删除**、留言处理、**产品用户反馈管理**、**反馈与访问分析数据 CSV 导出**、**站点维护模式开关（前台 503 维护页）**、审计日志（服务端分页/搜索/类型筛选）、访问日志（行数可切换）、管理员管理、**前台公告条维护**。
- **产品详情评分聚合**：详情页评价区展示**后台已审核**反馈的平均分（★ 星标）、有评分数与最新评价摘要（时间倒序，limit 1~20）；未审核反馈前台不可见。
- **产品更新动态页**（`changelog.html`）：聚合全系产品的版本与更新日志（`version`/`changelog`），按产品分组展示，点产品名进详情。
- **数据埋点**：页面浏览（含 UA/语言/时区）、下载点击自动上报至 SQLite，用于访问分析。
- **站点维护模式**：后台一键开启，前台页面与公开 API 统一返回 503 维护提示（后台/静态资源/探针保持可用，管理员可随时关闭）。
- **明暗主题**：全局 CSS 变量驱动，切换持久化于 localStorage，无闪烁（head 内联脚本提前应用）。
- **多语言（6 语言）**：轻量 i18n 引擎（`assets/js/i18n.js`），导航/页脚/按钮/后台面板等框架文案可一键切换（下拉选择器，含 zh/en/ja/ko/es/fr），长正文保持中文；选择持久化于 localStorage。
- **API 文档**（`api.html`）：后台与公开接口一览（按方法着色、鉴权等级标注），可从页脚/后台头部进入。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | 原生 HTML / CSS / JS（IntersectionObserver 触达动画，零构建） |
| 后端 | Node.js + Express + better-sqlite3（文件数据库，免安装） |
| 鉴权 | 多管理员（scrypt + 角色）+ Bearer Token（存于前端 localStorage，8h 有效期） |
| 部署 | 零构建静态 + Node 服务；提供 `Dockerfile` 与 GitHub Actions CI（冒烟自检 + 镜像构建校验） |

## 启动

```bash
npm install          # 安装依赖（express、better-sqlite3）
node server/server.js
```

- 官网： http://localhost:3000
- 下载页： http://localhost:3000/download.html
- 后台： http://localhost:3000/admin.html

> 端口可用环境变量覆盖：`PORT=8080 node server/server.js`
> 后台默认口令：`admin123`。**上线前务必修改**：编辑 `server/config.js` 的 `adminPassword`，或设置环境变量 `ADMIN_PASSWORD`（环境变量优先级更高）；端口同理由 `config.port` 或 `PORT` 控制。

`.env` 现已生效：可将 `ADMIN_PASSWORD` / `AUTH_SECRET`（Token 签名密钥，更换会使全部已签发 Token 失效）/ `PORT` / `SITE_URL` 写入项目根 `.env`（参考 `.env.example`），启动自动读取，无需手动 `export`。**注意：本地冒烟 `tools/smoke-test.js` 不加载 `.env`**，其登录口令直读 `process.env.ADMIN_PASSWORD` 兜底 `admin123`——本地 `.env` 若设置 `ADMIN_PASSWORD` 会使冒烟登录失败；生产口令应通过 PM2/systemd 环境变量注入。完整部署（PM2 / systemd / nginx 反代 / HTTPS / 备份 / 升级）见 **[部署手册 DEPLOY.md](./DEPLOY.md)**。

首次启动会自动在 `data/app.db` 建表并写入种子数据（4 款应用 + 4 款游戏）。如需重置内容，删除 `data/app.db*` 后重启服务即可重新写入种子。

### 容器化部署

```bash
docker build -t lvjiaoxi-website .
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data lvjiaoxi-website
```

`Dockerfile` 为多阶段构建（build 阶段编译 better-sqlite3 原生模块），运行时数据落在挂载卷 `/app/data`，TLS 由前置 nginx 负责。CI（`.github/workflows/ci.yml`）在每次推送时跑零依赖冒烟自检（`node tools/smoke-test.js --spawn`）并校验镜像可构建。

## 目录结构

```
.
├── index.html / download.html / admin.html
├── assets/
│   ├── css/style.css        # 样式 + 触达动画
│   ├── js/main.js           # 触达动画 + 埋点 + 拉取产品
│   ├── js/admin.js          # 后台逻辑
│   └── img/
├── server/
│   ├── server.js            # Express 入口
│   ├── db.js                # SQLite 建表 + 种子
│   ├── auth.js              # 口令 + Token
│   └── routes.js            # API 路由
├── data/app.db              # 自动生成
└── package.json
```

## API 速览

公开接口：
- `POST /api/views` — 浏览上报 `{ "page": "home|download", "ua": "…", "lang": "…", "tz": "…" }`（ua/lang/tz 用于访问分析，可缺省）
- `POST /api/downloads` — 下载上报 `{ "productId": 1 }`
- `GET  /api/products?type=app|game` — 已上架产品
- `GET  /api/products/:id/related?limit=4` — 相关推荐（同分类优先 → 同类型补充 → 其余兜底，均排除自身，limit 1~8 钳制）
- `GET  /api/products/:id/feedback?limit=5` — 前台评分聚合（仅后台已审核 status=done 的反馈）：`{count, ratedCount, avg, rows}`，limit 1~20 钳制；未审核反馈前台不可见
- `GET  /api/announcement` — 当前启用的公告（无则返回 null）
- `POST /api/feedback` — 产品反馈提交（仅上架产品；蜜罐字段 company/website 须留空；评分 0~5 可缺省；内容 1~500 字；邮箱可选须合法；按 IP 限流）

后台接口（需 `Authorization: Bearer <token>`）：
- `POST /api/admin/login` — `{ "username": "admin", "password": "..." }` → `{ token }`（**自多管理员改造后必须带 `username`**，仅发 `password` 会 401）
- `GET  /api/admin/stats` — 看板统计（浏览/下载、留言、产品、**访问分析分布**、**反馈概览 `feedback: {total, pending, ratedCount, avg, byProduct, week[7]}`**）
- `GET  /api/admin/stats/trend?days=7|14|30` — 流量趋势（按天浏览/下载 + 区间合计，days 钳制 1~90 默认 14）
- `GET  /api/admin/products`
- `POST /api/admin/products` — 上架
- `POST /api/admin/products/import` — CSV 批量导入（admin；RFC4180 解析 + 中英表头别名 + 整批校验通过后事务写入，任一行非法全部拒绝并返回逐行错误；单次 ≤100 行）
- `POST /api/admin/products/bulk/status` — 批量上/下架 `{ "ids": [1,2], "status": "on|off" }`（ids 1~500 个正整数）
- `POST /api/admin/products/bulk/category` — 批量改分类 `{ "ids": [1,2], "category": "工具" }`（空串=清空分类；须为枚举项）
- `POST /api/admin/products/bulk/delete` — 批量删除 `{ "ids": [1,2] }`
- `PUT  /api/admin/products/:id` — 编辑 / 上下架（`{ "status": "on|off" }`）
- `DELETE /api/admin/products/:id`
- `GET  /api/admin/announcements` / `POST /api/admin/announcements` / `PUT|DELETE /api/admin/announcements/:id` — 前台公告条维护（内容 ≤200 字符，仅最新一条启用中的展示在前台）
- `GET  /api/admin/maintenance` / `PUT /api/admin/maintenance` — 站点维护模式（读 `{enabled, message}`；写 `{ "enabled": 1, "message": "…" }`，message ≤200 字符）
- `GET  /api/admin/feedback` — 产品反馈列表（联表产品名；`product_id`/`keyword`/`status` 筛选；分页返回 `{rows,total}`）
- `PUT  /api/admin/feedback/:id` — 标记反馈状态（`{ "status": "new|done" }`）
- `DELETE /api/admin/feedback/:id` — 删除反馈

## 后续替换内容

- 公司名、Slogan、Logo、文案：当前已填充一套完整示例内容，可直接在 `index.html` / `download.html` 中替换为正式稿。
- 产品清单（名称/类型/简介/图标/下载链接）：后台 `admin.html` 可直接上架/下架/编辑/删除，种子数据已含 4 应用 + 4 游戏。
- 配色：改 `assets/css/style.css` 顶部 `:root` 变量即可整套换肤。
- 后台口令（上线前必改）：编辑 `server/config.js` 的 `adminPassword` 或设置环境变量 `ADMIN_PASSWORD`。
- 站点域名（上线前必配）：设置 `SITE_URL`（环境变量或 `server/config.js`），决定 `sitemap.xml` / `robots.txt` / OG / `canonical` / JSON-LD 中的真实域名（服务端中间件会把占位域名统一替换为真实域名）。
- OG 分享图：替换 `assets/img/og.jpg`（建议 1200×630，社交分享预览用），并同步四个页面里的 `og:image` 引用。
- 安装包投放：把安装包放入 `downloads/`，后台上架时 `download_url` 填 `/downloads/xxx` 相对路径；详见该目录 `README.md`。

### 静态资源缓存策略

`server/server.js` 按类型分级设置 `Cache-Control`：

| 类型 | 策略 | 说明 |
| --- | --- | --- |
| `sw.js` | `no-store` | 一旦被缓存会卡死 Service Worker 更新，必须禁用 |
| HTML | `no-cache` | 含服务端注入的真实域名，改版需即时生效 |
| CSS / JS / JSON | `max-age=3600, must-revalidate` | 配合 ETag 走 304，更新最多延迟一小时 |
| 图片 / 字体 | `max-age=604800, stale-while-revalidate=86400` | 文件名即版本 |
| 安装包 | `max-age=3600, must-revalidate` | 下载量由前端点击上报，缓存不影响统计 |

> 换图但保留同名文件（如 `og.jpg`）时，老访客最长 7 天才看到新图。**换图请改名或加版本号**（如 `og.jpg?v=2`），即可立即生效。

## 回归自检

改完代码（尤其是动到 `server.js` 的静态托管或中间件）后，务必跑一遍：

```bash
npm run smoke          # 探测已运行的 3000 端口；没在跑就临时拉起一个实例，结束自动关闭
npm run smoke:spawn    # 强制用临时实例，不干扰开发服务
node tools/smoke-test.js --url=https://www.your-domain.com   # 对已上线的站点跑一遍
```

零依赖，共 749 项断言，覆盖 45 组：

| 分组 | 覆盖内容 |
| --- | --- |
| 页面可用性 | 8 个页面全部 200 |
| API 契约 | `/api/health`、`/api/site`、`/api/products` 结构与 JSON 404 |
| 后台鉴权 | 正确口令登录、错误口令拒绝、无 token / 伪造 token 401 |
| **静态托管白名单** | 13 个敏感路径（数据库 / 源码 / 访问日志 / `.env` / `node_modules`）必须 404，并校验响应体不含 SQLite 文件头；**外加自动备份目录与真实备份文件不可下载** |
| 公开资源与缓存 | 静态资源 200 + 各类 `Cache-Control` 符合策略 |
| 安全响应头 | CSP、防嵌套、HSTS、不泄露 `X-Powered-By` |
| SEO 与结构化数据 | sitemap / robots / RSS / canonical / OG 图 / JSON-LD |
| 留言防滥用 | 蜜罐字段与非法邮箱被拦截 |
| **可观测性与排障** | 响应带 `X-Request-Id`、客户端 ID 透传、非法 ID 被丢弃（防日志注入）、畸形 JSON 返回结构化错误且 `requestId` 非占位符、错误响应不泄露堆栈、深度健康检查需鉴权且状态与 HTTP 码一致、**备份校验器能识别损坏文件与缺失文件** |
| **无障碍 (a11y) 护栏** | 8 页均含 skip-link + 主内容地标；`admin.html` 全部 `<label for>` 命中控件（无孤儿 label）；汉堡切换同步 `aria-expanded`；营销页恰 1 个 `aria-current="page"` |
| **结构化数据 (SEO 富媒体)** | 下载/联系页 `BreadcrumbList`、产品页 `SoftwareApplication`+`BreadcrumbList` `@graph`、首页 `Organization` 回归 |
| **后台危险操作二次确认** | `admin.html` 引入 `confirm-modal.js`；留言/产品删除改用 `showConfirm()` 弹窗（原生 `confirm()` 已移除）；`confirm-modal.js` 经 DOM 桩行为校验（A11y 结构/聚焦/点击·Enter 确认/Esc·点遮罩取消） |
| **产品表单双重校验** | 后台新增/编辑产品：服务端 `routes.js` 做 trim + 长度上限 + 下载链接协议白名单（拒 `javascript:`/`data:`/`vbscript:`）；客户端 `admin.js` 先做同名校验并**检查 `r.ok`**（此前校验失败也假成功），失败 `showToast` 报错；`admin.html` 表单加 `maxlength` 第一道防线 |
| **错误页增强与图片渲染** | 404/offline 含快捷导航与站内搜索（外置脚本，符合 CSP）；`sw.js` 预缓存新脚本；i18n 新增 5 key × 6 语言；全部 `<img>` 带 `decoding="async"` 与显式尺寸（防 CLS），首屏 logo 不懒加载（保 LCP） |
| **prefers-reduced-motion 降级** | `assets/js/motion.js` 提供 `window.prefersReducedMotion()`（matchMedia 缓存 + change 刷新），`main.js` 数字滚动在减弱动态下直接落终值、分类跳转与 `admin.js` 编辑表单滚动改即时跳转；`sw.js` 预缓存 |
| **404 搜索键盘导航与高亮** | 404 站内搜索为 combobox + listbox 模式：↑/↓ 键盘导航、Enter 选中、`aria-activedescendant`/`aria-expanded` 同步、`aria-live` 播报结果数量/空态；`.err-result.active` 高亮 + 全局 `.visually-hidden` 工具类 |
| **留言批量操作** | 后台留言支持勾选 + 全选本页（跨页保留选择集），批量「标记已处理 / 删除选中」（删除走二次确认）；后端 `batch-status` / `batch-delete` 端点（admin、单次上限 100、写审计） |
| **维度索引文件** | 根目录 `维度清单.md` 为维度追踪唯一索引（72 维总表 + 回归组映射） |
| **留言服务端分页/搜索/筛选** | 后台留言列表改为服务端分页（`page`/`pageSize`/`keyword`/`status`，LIMIT/OFFSET + LIKE），客户端 300ms 防抖搜索、跨页保留选择集；`/api/contact` 限流放宽至 30 次/10 分钟便于测试 |
| **404 搜索模糊匹配** | 404 站内搜索从「名称包含」扩展为「名称/分类/类型/描述」任一包含即命中（matchRank 名称优先排序、结果仍限 6 条）；非名称命中显示 `分类·X / 类型·Y / 描述·…上下文…` 提示（`.err-result-hint`）；i18n 新增 3 key × 6 语言 |
| **管理员角色编辑与账号删除** | 后台管理员列表支持改角色（下拉，二次确认）与删除（危险红键二次确认）；后端 `PUT/DELETE /api/admin/admins/:id`（白名单校验 + 审计），防锁死保护：最后一个 admin 不可降级/删除、不可删自己；i18n 新增 7 key × 6 语言 |
| **PWA 新版本更新提示** | `pwa.js` 检测 Service Worker 更新（updatefound + 旧 SW 控制判定）后弹出底部提示条「发现新版本，点击刷新」（SKIP_WAITING 立即接管）；暴露 `window.checkPWAUpdate()`、每小时自动探测、语言切换实时重译；后台系统信息面板新增「检查更新」按钮；i18n 新增 4 key × 6 语言 |
| **产品置顶/排序权重** | `products` 表新增 `sort` 权重（整数，越大越靠前 = 置顶），公开/后台产品接口按 `sort DESC` 排序；后台产品表单新增排序权重输入、表格新增排序列、CSV 导出含排序；服务端/客户端双重校验（整数 + -9999~9999）；i18n 新增 3 key × 6 语言 |
| **流量趋势（可切换天数）** | 新增 `GET /api/admin/stats/trend?days=` 端点（1~90 钳制、默认 14），`bucketDaily` 改为 SQL 聚合 + 本地时区补零；后台看板趋势图支持 7/14/30 天切换（`aria-pressed` 按钮组）、标题与区间合计（浏览/下载）动态渲染、窗口缩放重绘与语言切换重译；i18n 新增 3 key × 6 语言 |
| **审计/访问日志服务端分页** | `/api/admin/audit` 改服务端分页（`page`/`pageSize` 1~100 钳制）+ `keyword` 对操作/详情/IP 模糊 + `action` 精确筛选，返回 `{rows,total}`；后台审计面板加搜索防抖、类型筛选与分页（末页回退）；访问日志 `lines` 行数切换（100/300/500，非法回退 100）；i18n 新增 1 key × 6 语言 |
| **产品分类后台维护** | 分类从自由输入改为后台维护枚举：`categories` 表（name 唯一，启动迁移从现有产品回填 + 补齐常用分类）；后台「产品分类管理」面板支持新增/重命名/删除（重命名同步更新引用产品防孤儿、使用中分类禁止删除、写操作审计）；产品表单分类改为枚举下拉；公开 `GET /api/categories` 供下载页分类区自动生成（失败兜底从已加载产品收集）；服务端校验分类必须为枚举项；i18n 新增 7 key × 6 语言 |
| **产品大图/缩略图** | `products` 表新增 `image` 字段（幂等迁移回填 8 张种子产品图）；后台产品表单新增「产品图」输入（服务端 `validProductImage` + 客户端双重校验：http(s) 外链或站内 `/assets/img/…` 路径，空=回退 emoji，拒绝 `javascript:`/`data:`）；下载页/首页卡片与详情页/弹窗渲染大图（`loading="lazy"` + 固定尺寸防 CLS）；`sw.js` 预缓存产品图离线可用；i18n 新增 2 key × 6 语言 |
| **全站 img 响应式（srcset/sizes）** | 8 张 480w 产品缩略图（`-sm.jpg`，System.Drawing 生成，比原图省约 50% 流量）；`main.js` `srcsetList()` 智能生成 srcset（站内 480w/960w 双档、外链退回单图）；下载页/首页卡片、详情弹窗与详情页大图按视口输出 `sizes`（354px/384px/220px 断点）；`sw.js` 预缓存缩略图 |
| **合规基础页** | 新增 `privacy.html` / `terms.html` 法律文案页（隐私/条款，暗色主题 + a11y 地标）；`robots.txt` 增加 `Disallow: /downloads/` 与 `Sitemap:` 声明；`sitemap.xml` 增补 privacy/terms（含 lastmod） |
| **产品更新日志** | `products` 表幂等新增 `version`/`changelog` 字段（≤30/≤2000，8 种子回填）；后台产品表单/表格支持版本与日志维护（双重校验）；详情页标题旁 `v版本` 徽标 + 正文下方更新日志卡片（`.pd-changelog`，pre-line 换行）；`observeReveals()` 修复详情异步加载 reveal 不可见；i18n 新增 6 key × 6 语言 |
| **下载量展示+热门** | `downloads` 表 `product_id` 索引；公开 `/api/products` 列表/详情透出 `downloads`（相关子查询计数）；首页/下载页卡片右上角下载量胶囊徽标（`.pcard-dl`，`fmtCount` 1.2k/1.5M 简写）+ 详情页 `↓ n 次下载`（`.pd-dl`）；i18n 新增 1 key × 6 语言 |
| **导航栏全站搜索** | 9 个页面导航新增胶囊搜索框（`.nav-search`，原生 form GET → `download.html?q=…`，`#nav-q` 输入 + 圆形 🔍 按钮，≤900px 隐藏）；下载页读取 `?q=` 自动套用过滤/回填输入/滚动到筛选区，任意页面预填 `#nav-q`；i18n 新增 4 key × 6 语言 |
| **热门下载排行** | 新增公开 `GET /api/products/hot?limit=`（1~10 钳制，默认 5，仅上架产品，按下载量降序）；下载页/首页「热门下载」区（`.hot-strip`，TOP1 大卡 + 名次徽标 `.hot-rank`，IntersectionObserver 入场动效，空态提示）；点击进详情；i18n 新增 3 key × 6 语言 |
| **下载统计防刷去重** | `downloads` 表新增 `ip` 列 + `(ip, product_id, ts)` 去重索引（幂等迁移）；下载上报同 IP 24h 窗口内对同一产品只计 1 次（盗刷/重复点击不膨胀热门与总量） |
| **后台产品图片直传** | 新增 `POST /api/admin/upload`（admin 权限）：base64 图片 → 魔数嗅探（拒 SVG 伪装）+ 类型白名单（PNG/JPG/WebP/GIF）+ 大小 ≤2MB → 落盘 `assets/img/products/` 返回站内路径；后台产品表单新增「⬆ 上传图片」按钮自动回填 `image` 字段；i18n 新增 1 key × 6 语言 |
| **审计/留言数据导出** | 后台「留言 CSV / 产品 CSV / 审计 CSV」三键导出：留言/审计联动当前筛选（status/keyword、action/keyword）+ `fetchAllPages` 跨页全量拉取（pageSize=100 逐页直至拉完）；CSV 带 BOM + CRLF + 字段转义（Excel 打开不乱码）；i18n 新增 1 key × 6 语言 |
| **后台批量导入产品（CSV）** | `POST /api/admin/products/import`（admin）：RFC4180 解析（引号包裹/`""` 转义/CRLF/去 BOM）+ 中英表头别名 + 类型中文映射；逐行经 `normalizeProduct` 校验，**任一行非法整批拒绝并返回逐行错误**，全合法则事务写入（单次 ≤100 行、写审计）；后台「导入」按钮（隐藏 file 输入 + FileReader）；i18n 新增 1 key × 6 语言 |
| **下载页排序切换** | 下载页筛选区新增排序下拉（默认=后台权重+ID / 最新=created_at / 热门=downloads / 名称=localeCompare）；`main.js` `state.sort` + `sortProducts()` 对 app/game 两桶分别排序，切换即重渲染；公开 `/api/products` 已透出 `created_at`/`downloads` 支撑排序；i18n 新增 4 key × 6 语言 |
| **前台公告条（后台可维护）** | `announcements` 表（content/enabled）；公开 `GET /api/announcement` 返回最新一条启用公告（无则 null）；后台公告面板 CRUD（内容非空 + ≤200 字符校验、启停、审计）；6 个前台页面顶部公告条（`main.js`/`product.js` 拉取填充，关闭后 `localStorage` 记忆该条不再显示）；i18n 新增 9 key × 6 语言 |
| **详情页相关推荐** | 公开 `GET /api/products/:id/related?limit=`（1~8 钳制默认 4，404/400 处理）：**同分类优先 → 同类型补充 → 其余兜底**，均排除自身，按下载量/权重/ID 排序；详情页「更多产品」区改为「相关推荐」（`pd.related`）；i18n 新增 1 key × 6 语言 |
| **站点维护模式** | `settings` 表维护开关与提示语；后台维护面板（`maint-on`/`maint-off`/`maint-msg`，二次确认）；开启后前台 HTML → 503 维护页（注入提示语）、公开 API → 503 JSON；后台/静态资源/`/api/health*`/`/api/site` 放行（管理员可随时关闭）；审计 `maintenance_on/off`；维护中间件置于 HTML 服务之前（否则维护页被直接 200 服务）；i18n 新增 7 key × 6 语言 |
| **产品批量管理** | 后台产品表多选/全选当前筛选 + 批量操作条：`POST /api/admin/products/bulk/{status,category,delete}`（ids 1~500 个正整数、status 枚举、分类须枚举项、返回 `{ok,changed}`、写审计）；前端统一入口 `bulkProduct(op)` 分发，删除走二次确认；i18n 新增 6 key × 6 语言 |
| **访问分析可视化** | `POST /api/views` 上报 ua/lang/tz 入库；后台 stats 单次扫描聚合浏览器/系统/语言/时区四类分布（`parseUa` 零依赖解析 Chrome/Edge/Firefox 与 Windows/macOS/Android 等）；后台「访问分析」面板分布条 + 列表；i18n 新增 4 key × 6 语言 |
| **产品用户反馈** | 详情页反馈区（评分 + 内容 + 邮箱 + 蜜罐隐藏字段）；`POST /api/feedback` 仅上架产品、蜜罐非空/限流/内容 1~500/邮箱格式校验；后台 `/api/admin/feedback` 列表（联表产品名、按产品/关键词/状态筛选、分页）+ 标记已处理 + 删除；i18n 新增 7 key × 6 语言 |
| **H6 评分聚合与动态页** | 公开 `GET /api/products/:id/feedback` 仅统计已审核（status=done）反馈：未审核前台 count=0 → 审核后 count/ratedCount/avg 正确、含最新评价摘要、limit 钳制、无评分计入 count 不计均值、下架 404/非法 id 400；`changelog.html` + `changelog.js`（拉取 /api/products 按 version/changelog 过滤渲染）、导航入口、sw.js 预缓存；后台反馈概览 `stats.feedback {total,pending,avg,byProduct,week[7]}` + 反馈/访问分析 CSV 导出（admin.html/js）；i18n 新增 6 key × 6 语言；测试数据清理 |

失败时以**退出码 1** 结束，可直接作为 CI 门禁或发布前检查。

> 关于 CSP：`script-src` 严格限定 `'self'`（脚本执行是真正敏感的一项）。`style-src` 保留 `'unsafe-inline'` 是**刻意取舍**——页面有 31 处 `style=""` 属性，且 `admin.js` / `main.js` / `product.js` 通过 CSSOM 动态设置样式，移除会直接破坏后台面板与页面交互。详见 `server/server.js` 中的注释。

## 可观测性与排障

### 请求 ID 追踪

每个请求都会分配一个 `X-Request-Id`（响应头回写，同时记入访问日志与错误日志）。用户报错时只要提供这个 ID，就能在日志里精确定位到那一条请求。

- 客户端可自带 `X-Request-Id` 以便跨服务串联，但服务端会做**格式白名单校验**（`[A-Za-z0-9._-]` 且 ≤64 字符），不合法则丢弃重生成——否则攻击者可传入含换行的值**伪造日志行**。
- 中间件必须挂在 `express.json()` **之前**：否则请求体解析失败时会直接跳到错误处理器，`req.id` 尚未赋值，恰好在最需要追踪 ID 的场景丢失追踪能力（该问题由回归自检发现并已修复）。
- 访问日志格式：`时间 请求ID IP 方法 路径 状态码 字节数 耗时 Referer UA`。

### 健康检查

分两层，刻意区分用途：

| 接口 | 鉴权 | 用途 |
| --- | --- | --- |
| `GET /api/health` | 公开 | 存活探针，极轻量（只查库连通性），**不返回 Node 版本/路径等指纹信息** |
| `GET /api/health/detail` | 需登录 | 完整运维指标，任一关键项异常返回 **503**，可直接接告警 |

`detail` 检查项：数据库可读写与表数量、备份是否停摆（超 48 小时无新备份即告警）、**备份完整性校验结果**、磁盘可用空间（<512MB 告警）、进程内存（RSS >512MB 告警）、日志文件体积。任一异常返回 503，后台「系统信息」面板会直接展示这些结论。

### 错误处理

统一错误处理器（注册在所有路由之后）负责：把错误写入 `data/error.log`（含请求 ID 与堆栈），并返回**不带堆栈**的响应——API 路径返回 `{error, requestId}` 的 JSON（5xx 不回显内部错误详情），页面路径返回带请求 ID 的 HTML 错误页。

日志文件（`data/access.log`、`data/error.log`）超过 5MB 自动轮转，保留一份 `.1` 备份。

## 数据备份与维护

### 自动备份

服务启动后会自动启用备份调度：约**每天一份**，保留最近 **7 份**，落在 `data/backups/`（已加入 `.gitignore`，绝不入库）。

- 使用 `better-sqlite3` 在线备份 API，会把 WAL 合并进快照，**无需停服**即可得到一致数据。
- 重启不会重复备份（距上次备份不足 20 小时则跳过），避免开发环境刷屏。
- 备份全程 try/catch，失败只写日志，**绝不影响主服务**。
- 每次备份都会写入审计日志（动作 `db_autobackup`），后台「操作审计日志」面板可见。
- 需要关闭时设置环境变量 `DISABLE_AUTO_BACKUP=1`。

### 维护工具

```bash
npm run backup                              # 立即备份 + 轮转
npm run maintain                            # 查看数据库与备份概况
node tools/maintain.js list                 # 列出所有备份
node tools/maintain.js vacuum               # 整理数据库、回收空闲页
node tools/maintain.js clean-contacts --days=180   # 清理 180 天前「已处理」的留言
node tools/maintain.js clean-audit --days=365      # 清理 365 天前的审计日志
node tools/maintain.js verify            # 校验最新一份备份是否真的可用
node tools/maintain.js verify --all      # 校验全部备份（有坏档时退出码 1）
node tools/maintain.js restore --file=lvjiaoxi-20260901-0407.db   # 从备份恢复
```

> `restore` 的安全约定：**服务运行中拒绝恢复**（避免运行中覆盖数据库）；恢复前自动生成 `prerestore-<时间戳>.db` 快照以便回滚；校验备份时使用临时副本打开，不在备份目录产生 `-wal` / `-shm` 污染。备份不能恢复等于没备份，建议定期演练一次。

### 备份完整性校验

有备份文件 ≠ 能恢复。备份可能因磁盘故障、写入中断而损坏，而**损坏往往要到真正需要恢复的那一刻才暴露——那时已经晚了**。因此：

- **每次自动备份生成后立刻自证**：对该备份执行 `PRAGMA integrity_check` + 关键表齐全性 + 抽样行数统计，结果写入审计日志（动作 `db_verify`），失败会在控制台告警。
- 手动校验：`npm run maintain verify`（或加 `--all` 全量，有坏档时退出码 1，可作定时任务门禁）。
- 健康检查 `/api/health/detail` 暴露最近一次校验结果；**从未校验过也会告警**——没验证过的备份等同于没备份。
- 校验在**临时副本**上进行，不会在备份目录留下 `-wal` / `-shm` 副作用文件。

回归自检中专门包含负向用例：确保校验器本身能识别截断的备份、非 SQLite 文件与缺失文件——否则「校验通过」只是自我安慰。

安全约定：所有删除类操作**默认只预览**，必须显式加 `--yes` 才真正执行；且在**没有任何备份**的情况下会拒绝执行，强制先备份。清理留言只针对「已处理」状态，避免误删未跟进的客户线索。

### 操作审计覆盖

后台关键动作均写入 `audit_log`，审计面板可追溯：登录、修改口令、产品增删改、**留言删除（记录邮箱）**、留言状态变更、**数据库备份**、**备份完整性校验**。

> 其中留言删除与状态变更的审计、以及删除时的存在性校验（重复删除返回 404 而非 200）是后期补齐的——此前删除留言不留任何痕迹。

## 其他

- 部署上线：PM2 / systemd / nginx 反代 / HTTPS 完整流程见 **[DEPLOY.md](./DEPLOY.md)**。
- 运行时自检：公开 `GET /api/health` 用于存活探针；后台 `GET /api/admin/sysinfo`（需 Bearer Token）查看运行状态与数据计数。
- 图片优化：投放新素材后执行 `npm run optimize:images`（需先 `npm install --no-save sharp`）。
