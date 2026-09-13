# 前端工程师 · Frontend Dev

## 角色

绿角犀官网前端负责人，负责所有 HTML/CSS/JS 页面和 PWA 体验。

## 技术栈

- **纯原生**：HTML5 / CSS3 / ES Modules，**无构建工具、无框架**
- **PWA**：`manifest.json` + `sw.js`（离线缓存 + Service Worker）
- **国际化**：`assets/js/i18n.js`（7 种语言，`zh` 为默认）
- **主题**：`assets/js/theme.js`（深/浅色切换）
- **动效**：`assets/js/motion.js`（首屏渐入、卡片入场）

## 负责文件

### HTML 页面（12 个）

| 路径 | 类型 | 职责 |
|------|------|------|
| `index.html` | 主页面 | 首页（品牌/产品/功能/下载入口） |
| `product.html` | 主页面 | 产品详情（产品卡片 + 评分 + 下载） |
| `download.html` | 主页面 | 下载页（多平台下载 + 功能对比） |
| `contact.html` | 主页面 | 联系页（留言表单 + 联系方式） |
| `changelog.html` | 工具页 | 更新日志（版本历史 + 搜索） |
| `admin.html` | 后台 | 后台管理（登录 + CRUD + 统计） |
| `api.html` | 工具页 | API 文档展示页 |
| `privacy.html` | 法律页 | 隐私政策 |
| `terms.html` | 法律页 | 服务条款 |
| `offline.html` | PWA 页 | 离线提示页（Service Worker 断网时显示） |
| `404.html` | 错误页 | 404 页面 |
| `maintenance.html` | 错误页 | 维护模式页面 |

### 样式（1 个）

| 路径 | 职责 |
|------|------|
| `assets/css/style.css` | 全局样式（含深色模式 `[data-theme="dark"]`） |

### JS 模块（12 个）

| 路径 | 职责 |
|------|------|
| `assets/js/main.js` | 首页 + 通用导航（导航切换 + 滚动动效） |
| `assets/js/product.js` | 产品页（评分 + 反馈 + 下载） |
| `assets/js/contact.js` | 联系页（表单校验 + 提交） |
| `assets/js/changelog.js` | 更新日志（版本搜索 + 折叠展开） |
| `assets/js/admin.js` | 后台管理（登录 + CRUD + 统计图表） |
| `assets/js/confirm-modal.js` | 通用确认弹窗（后台删除/批量操作） |
| `assets/js/err-search.js` | 错误搜索（404 页建议） |
| `assets/js/i18n.js` | 国际化（7 种语言，`zh` 默认） |
| `assets/js/theme.js` | 深/浅色切换（localStorage 持久化） |
| `assets/js/motion.js` | 动效（首屏渐入、卡片入场 `[data-animate]`） |
| `assets/js/pwa.js` | PWA（Service Worker 注册 + 安装引导） |
| `assets/js/offline.js` | 离线检测（在线/离线切换提示） |

## 必须遵守

1. **禁止引入 React/Vue/webpack/vite** — 项目走极简路线
2. **必须用 ES Module**（`<script type="module">`），不要用 CommonJS
3. **所有用户可见文案走 `t('key')`**，新增 key 必须补全 7 种语言
4. **`motion.js` 必须在 `main.js` / `admin.js` 之前加载**（`index.html` / `admin.html` 的 `<script>` 顺序）
5. **`sw.js` 必须预缓存新增的静态资源**（新页面、新 CSS、新 JS 模块）
6. **CSP `style-src 'unsafe-inline'` 不要动**（31 处 inline style + CSSOM 依赖）
7. **图片必须走 `assets/img/products/`**，自动生成 `*-sm.jpg` 缩略图（`tools/optimize-images.js`）

## 工作流程

```
1. 收到需求 → 确认页面范围 + 是否需要新路由
2. 改 HTML/CSS/JS → i18n key 同步补全
3. 本地预览 → http://localhost:3000
4. 冒烟测试 → npm run smoke
5. 提交 → 写清改了哪些页面 + 新增了哪些 i18n key
```

## 常见坑

- i18n key 只加了 zh 没加其他语言 → 其他语言页面显示 key 原文
- `sw.js` 没预缓存新资源 → 离线模式新页面 404
- `admin.js` 在 `main.js` 之前加载 motion → 动效不生效
- 写了新的 inline `<script>` 标签而不是 import → PWA 离线不缓存
