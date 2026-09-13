# PWA 增强指南

## 触发条件
优化离线体验、提升安装率、或用户说"让官网更像 App"时使用。

## 当前 PWA 状态

| 项目 | 现状 | 优化空间 |
|------|------|---------|
| manifest.json | ✅ 有 | 检查 icons 尺寸是否齐全 |
| sw.js 预缓存 | ✅ 有 | 新增页面需要手动更新 |
| 离线访问 | ⚠️ 静态可离线 | 动态内容（产品列表）无离线 |
| 安装提示 | ⚠️ pwa.js 有 | 可加自定义安装引导 |
| Push 通知 | ❌ 无 | 暂不需要 |

## 优化清单

### 1. 骨架屏加载（立即加）

```css
/* assets/css/style.css 里加 */
.skeleton {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
}
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
[data-theme="dark"] .skeleton {
  background: linear-gradient(90deg, #1a1a2e 25%, #2a2a4e 50%, #1a1a2e 75%);
  background-size: 200% 100%;
}
```

### 2. 预缓存自动更新

当前 sw.js 是手动维护 PRECACHE_URLS。优化方案：

```js
// sw.js 里用 Service Worker 的 precache 动态发现
// 方案 A：构建时生成（需要加 build 脚本）
// 方案 B：当前手动维护（保持现状，新增页面时必须更新）
const PRECACHE_URLS = [
  './',
  './index.html',
  './product.html',
  './download.html',
  './contact.html',
  './changelog.html',
  './admin.html',
  './404.html',
  './offline.html',
  './assets/css/style.css',
  './assets/js/main.js',
  './assets/js/motion.js',
  './assets/js/product.js',
  './assets/js/contact.js',
  './assets/js/admin.js',
  './assets/js/i18n.js',
  './assets/js/theme.js',
  './assets/js/pwa.js',
  './assets/js/offline.js',
  './manifest.json',
  './assets/img/logo.svg',
  './assets/img/icon-512.png',
  './assets/img/og.jpg',
];
```

**重要**：每次新增/修改静态资源，必须同步更新 PRECACHE_URLS，否则离线访问会 404。

### 3. 自定义安装引导

```js
// assets/js/pwa.js 里加 beforeinstallprompt 处理
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallBanner(); // 自定义 UI 引导用户安装
});

// 用户点击安装按钮
document.querySelector('#install-btn')?.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('安装结果:', outcome);
    deferredPrompt = null;
  }
});
```

### 4. 离线页面增强

当前 `offline.html` 是简单提示。可加：
- "上次在线时的产品列表"（从 cache storage 读）
- 重试按钮
- 自动重连检测

### 5. iOS PWA 额外配置

```html
<!-- 所有 HTML 页面 head 里加 -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="绿角犀">
<link rel="apple-touch-icon" href="./assets/img/icon-512.png">
```

### 6. 触摸优化

```css
/* style.css 里加 */
* { -webkit-tap-highlight-color: transparent; }
a, button { min-width: 44px; min-height: 44px; } /* Apple 推荐最小点击区 */
```

## 验证命令

```bash
# 本地启动后，Chrome DevTools → Application → Service Workers → 检查
# 1. Service Worker 已注册
# 2. Cache Storage 里有 PRECACHE_URLS 所有资源
# 3. 离线模式刷新页面能正常显示
```

## 禁止事项

- 不要引入 Workbox（保持原生 sw.js）
- 不要让 Service Worker 拦截 API 请求（静态资源-only）
- 不要忘记 iOS 的 apple-mobile-web-app meta
