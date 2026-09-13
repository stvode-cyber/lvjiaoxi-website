# 前端组件规范

## 触发条件
新增页面、修改现有页面、或用户说"帮我调一下前端"时使用。

## 技术约束（必须遵守）
1. **纯原生 HTML/CSS/JS** — 无 React/Vue/webpack/vite
2. **ES Module** — `<script type="module">`，import/export
3. **无构建步骤** — 改完直接浏览器刷新看效果
4. **PWA 兼容** — 静态资源必须被 `sw.js` 预缓存

## 页面结构模板
```html
<!-- index.html 模板 -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="绿角犀安全浏览器官网">
    <!-- PWA -->
    <link rel="manifest" href="./manifest.json">
    <link rel="icon" href="./assets/img/icon-512.png">
    <!-- 主题 -->
    <script src="./assets/js/theme.js"></script>  <!-- 先加载，避免闪烁 -->
    <!-- 样式 -->
    <link rel="stylesheet" href="./assets/css/style.css">
    <!-- 标题（i18n 在 main.js 里替换） -->
    <title>绿角犀</title>
</head>
<body>
    <!-- 导航 -->
    <nav class="navbar">...</nav>
    <!-- 主内容 -->
    <main>
        <section class="hero">...</section>
        <section class="features">...</section>
    </main>
    <!-- 页脚 -->
    <footer class="footer">...</footer>
    <!-- 脚本：motion.js 必须在 main.js 之前 -->
    <script src="./assets/js/motion.js"></script>
    <script type="module" src="./assets/js/main.js"></script>
    <!-- PWA 注册 -->
    <script src="./assets/js/pwa.js"></script>
</body>
</html>
```

## CSS 规范

### BEM 命名（简化版）
```css
/* 块 */
.feature-card { ... }
/* 元素 */
.feature-card__title { ... }
.feature-card__image { ... }
/* 修饰符 */
.feature-card--featured { ... }
```

### 深色模式
```css
/* style.css 里已有 */
:root { --bg: #ffffff; --text: #1a1a1a; ... }
[data-theme="dark"] { --bg: #0f0f0f; --text: #f0f0f0; ... }

/* 使用 */
.feature-card { background: var(--bg); color: var(--text); }
```

### 响应式断点
```css
/* style.css 里已有 */
/* 移动端 */
@media (max-width: 640px) { ... }
/* 平板 */
@media (max-width: 1024px) { ... }
```

## JS 规范

### i18n
```js
// 所有用户可见文案必须走 t()
import { t } from './i18n.js';

document.querySelector('.hero-title').textContent = t('hero.title');
```

### motion.js 用法
```js
// main.js 里初始化
import { initMotion } from './motion.js';
initMotion();  // 自动给 [data-animate] 元素加渐入

// HTML 里标记
<section class="hero" data-animate>...</section>
```

### 表单校验
```js
// contact.js 里已有校验逻辑，复用不要重写
import { validateContact } from './contact.js';

const errors = validateContact({ name, message });
if (errors.length) { showErrors(errors); return; }
```

## PWA 注意事项

### sw.js 预缓存
新增的静态资源**必须**加到 `sw.js` 的 precache list：
```js
const PRECACHE_URLS = [
    './',
    './index.html',
    './product.html',
    './new-page.html',  // ← 新增页面
    './assets/js/main.js',
    './assets/js/new-module.js',  // ← 新增 JS
    './assets/css/style.css',
    './assets/img/logo.svg',
];
```

### 离线友好
- 关键页面必须被预缓存
- 动态内容（产品列表/留言）离线显示上次缓存
- 断网时用 `offline.js` 提示用户

## 新增页面 Checklist
- [ ] HTML 结构语义化
- [ ] `<script>` 顺序正确（theme → motion → main）
- [ ] i18n key 补全 7 种语言
- [ ] `sw.js` 预缓存新增资源
- [ ] 导航/页脚链接更新
- [ ] 移动端响应式测试
- [ ] 深色模式测试
- [ ] 冒烟测试通过

## 禁止事项
- 不要写 inline `<script>`（除了 `pwa.js` 注册 Service Worker）
- 不要写 inline style（CSP 有 `'unsafe-inline'` 但尽量不用）
- 不要在 JS 里硬编码中文文案（走 `t()`）
- 不要漏掉 `motion.js` 的加载顺序
- 不要忘记 `sw.js` 预缓存新资源

## 常见坑速查

| 现象 | 根因 | 修复 |
|------|------|------|
| i18n 新 key 只加了 zh | 其他语言显示 key 原文 | 搜 i18n.js 所有语言对象，补全 7 种 |
| 新页面离线 404 | sw.js 没加预缓存 | 更新 PRECACHE_URLS 数组 |
| motion.js 动效不生效 | 在 main.js/admin.js 之后加载 | 调整 `<script>` 顺序：theme → motion → main |
| PWA 安装按钮不出 | iOS 缺 apple-mobile-web-app meta | 所有 HTML 加 3 个 apple meta + apple-touch-icon |
| 图片加载慢 | 没用缩略图 | `tools/optimize-images.js` 生成 `*-sm.jpg` |
