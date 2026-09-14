/* 绿角犀官网 Service Worker：离线可用 + 静态资源缓存 */
const CACHE = 'lvjx-v5';
const OFFLINE_URL = '/offline.html';
const ASSETS = [
  '/',
  '/index.html',
  '/product.html',
  '/download.html',
  '/contact.html',
  '/changelog.html',
  '/privacy.html',
  '/terms.html',
  '/admin.html',
  '/api.html',
  '/maintenance.html',
  '/404.html',
  OFFLINE_URL,
  '/assets/css/style.css',
  '/assets/js/main.js',
  '/assets/js/motion.js',
  '/assets/js/changelog.js',
  '/assets/js/product.js',
  '/assets/js/contact.js',
  '/assets/js/admin.js',
  '/assets/js/err-search.js',
  '/assets/js/offline.js',
  '/assets/img/logo.svg',
  '/assets/img/icon-512.png',
  // 产品大图（维度 59）：预缓存全部种子产品图，离线时卡片/详情仍可见
  '/assets/img/products/note.jpg',
  '/assets/img/products/team.jpg',
  '/assets/img/products/cloud.jpg',
  '/assets/img/products/password.jpg',
  '/assets/img/products/space.jpg',
  '/assets/img/products/candy.jpg',
  '/assets/img/products/racing.jpg',
  '/assets/img/products/pixel.jpg',
  // 响应式缩略图（维度 60）：480w 档随大图一起预缓存
  '/assets/img/products/note-sm.jpg',
  '/assets/img/products/team-sm.jpg',
  '/assets/img/products/cloud-sm.jpg',
  '/assets/img/products/password-sm.jpg',
  '/assets/img/products/space-sm.jpg',
  '/assets/img/products/candy-sm.jpg',
  '/assets/img/products/racing-sm.jpg',
  '/assets/img/products/pixel-sm.jpg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

// 收到页面「立即接管」消息（PWA 更新提示条点击「刷新」时发送），配合 skipWaiting 让新版 SW 立即激活
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 跨域不处理
  if (url.pathname.indexOf('/api/') === 0) return;        // API 不缓存，始终走网络

  var accept = req.headers.get('accept') || '';
  if (accept.indexOf('text/html') !== -1) {
    // 导航 / HTML：网络优先，离线回退缓存（开发期始终拿最新）
    e.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () {
          // 离线且无缓存：回退到专门的离线页（而不是伪装成首页，避免误导用户）
          if (req.mode === 'navigate') {
            return caches.match(OFFLINE_URL).then(function (hit) { return hit || Response.error(); });
          }
          return caches.match(req);
        })
    );
    return;
  }

  // 其余静态资源：stale-while-revalidate
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req).then(function (cached) {
        var net = fetch(req).then(function (res) {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(function () { return cached; });
        return cached || net;
      });
    })
  );
});
