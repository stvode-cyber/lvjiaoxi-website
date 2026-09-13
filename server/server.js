require('./env'); // 最先加载：将项目根 .env 注入 process.env（零依赖，早于 config 读取）
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const routes = require('./routes');
const config = require('./config');
const db = require('./db');

const app = express();

// 信任前置反向代理（nginx/Caddy 等）：使 req.ip 反映真实客户端，
// 否则限流/登录防爆破按 IP 维度会全部归并到 127.0.0.1 而失效。
app.set('trust proxy', 1);

/* ---------- 请求 ID 与日志 ----------
   排障时最痛的是「用户说刚才报错了，但日志里找不到是哪一条」。给每个请求分配 ID，
   写进访问日志、错误日志，并回写到响应头 X-Request-Id：用户截图里带上它就能精确定位。
   客户端可自带 X-Request-Id（便于跨服务串联），但必须做格式白名单校验——
   否则攻击者可传入含换行的字符串伪造日志行（日志注入）。

   位置至关重要：必须排在 express.json() **之前**。否则请求体解析失败（畸形 JSON）时
   会直接跳到错误处理器，req.id 尚未赋值，错误响应里只能给出 '-'——恰好在最需要
   追踪 ID 的场景下丢失追踪能力。（此坑由回归自检「错误响应带 requestId」断言发现） */
const REQ_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

app.use(function (req, res, next) {
  const incoming = req.headers['x-request-id'];
  const id = (typeof incoming === 'string' && REQ_ID_RE.test(incoming))
    ? incoming
    : crypto.randomBytes(8).toString('hex');
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
});

app.use(express.json());

// HTTP 响应压缩（gzip）：减少 HTML/CSS/JS/JSON 传输体积；express.static 与 res.send 均被统一覆盖
// 默认阈值 1KB（过小响应不压缩），且对含 Cache-Control: no-transform 的响应自动跳过。
app.use(compression());

const DATA_DIR = path.join(__dirname, '..', 'data');
const ACCESS_LOG = path.join(DATA_DIR, 'access.log');
const ERROR_LOG = path.join(DATA_DIR, 'error.log');
const LOG_MAX = 5 * 1024 * 1024;

// 追加日志 + 超 5MB 轮转（只保留一份 .1），全程异步且吞掉错误，绝不影响请求
function appendLog(file, text) {
  fs.appendFile(file, text, function () {
    fs.stat(file, function (err, st) {
      if (!err && st.size > LOG_MAX) {
        fs.rename(file, file + '.1', function () {});
      }
    });
  });
}

// 访问日志（运维可观测性，零依赖）
app.use(function (req, res, next) {
  const start = Date.now();
  res.on('finish', function () {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
      .split(',')[0].trim() || '-';
    const len = res.get('Content-Length') || '-';
    const line = [
      new Date().toISOString(),
      req.id,
      ip,
      req.method,
      req.originalUrl || req.url,
      res.statusCode,
      len,
      (Date.now() - start) + 'ms',
      req.headers['referer'] || '-',
      req.headers['user-agent'] || '-',
    ].join(' ');
    appendLog(ACCESS_LOG, line + '\n');
  });
  next();
});

// 隐藏技术栈
app.disable('x-powered-by');

// 基础安全响应头（零依赖，生产建议项）
app.use(function (req, res, next) {
  // 内容安全策略：默认仅允许同源资源；图片允许 data:（base64 图标）；
  // script-src 仅 'self'（内联 JSON-LD 属数据非可执行脚本，无需 unsafe-inline；全站无内联事件处理器/无 eval，故可收紧）；
  // style-src 暂保留 unsafe-inline 兼容内联样式，后续可升级为 nonce 方案进一步收紧。
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "img-src 'self' data: https:; " +
    // 注意：style-src 的 'unsafe-inline' 是刻意为之，请勿随手删除。
    // 原因：页面含 31 处 style="" 内联属性，且 admin.js / main.js / product.js 通过
    // CSSOM（element.style.*）动态设置样式——二者在 CSP 下都需要 unsafe-inline。
    // 一旦移除，后台面板与页面交互会直接失效。script-src 才是真正敏感的一项，保持严格 'self'。
    "style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; " +
    "font-src 'self'; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});

// favicon 路由（浏览器默认会请求 /favicon.ico）
app.get('/favicon.ico', function (req, res) {
  res.type('image/svg+xml');
  res.sendFile(path.join(__dirname, '..', 'assets', 'img', 'logo.svg'));
});

// 站点基础域名（去尾斜杠），供 sitemap / robots / 分享链接使用
const SITE = (config.siteUrl || 'https://lvjiaoxi.example.com').replace(/\/+$/, '');
// 占位域名（开发期硬编码在各 HTML 的 OG/canonical 中），上线时统一替换为 SITE
const PLACEHOLDER = 'https://lvjiaoxi.example.com';

// 公开站点配置（单一配置源：config.siteUrl / 环境变量 SITE_URL）
app.get('/api/site', function (req, res) {
  res.json({ siteUrl: SITE, siteName: '绿角犀' });
});

// 站点域名统一替换中间件：把 HTML 响应里的占位域名替换为真实站点域名（SITE）
// 注册在静态托管之前，对 SEO 爬虫友好（无需执行 JS）
function serveHtml(file, res, next) {
  fs.readFile(file, 'utf8', function (err, html) {
    if (err) return next();
    // HTML 含服务端注入的真实域名，且改版需即时生效，故不做浏览器缓存
    res.setHeader('Cache-Control', 'no-cache');
    res.type('text/html; charset=utf-8').send(html.split(PLACEHOLDER).join(SITE));
  });
}
// 仅允许根目录层的页面（/、/admin.html 等）；子目录内的 .html 不公开，
// 避免 node_modules / deploy / data 等目录里的 HTML 被直接读取。
const ROOT_HTML_RE = /^\/[^/]*\.html?$/;

/* ---------- 站点维护模式（维度 73） ----------
   后台开启后（settings.maintenance='1'），前台 HTML 页面统一返回维护页（503）、
   公开业务 API 返回 503 JSON；后台（/admin.html 与 /api/admin/*）、静态资源（/assets 等）、
   运维探针（/api/health*）与站点配置（/api/site）保持可用——保证管理员能随时进入后台关闭维护。
   位置必须在上方「域名替换 / HTML 服务中间件」之前：否则维护中 HTML 页面会被其直接 200 服务，
   维护页根本到不了用户浏览器（此坑由冒烟 [41] 运行时断言发现）。 */
function maintenanceOn() {
  try {
    var r = db.prepare("SELECT value FROM settings WHERE key='maintenance'").get();
    return !!(r && r.value === '1');
  } catch (e) { return false; }
}
app.use(function (req, res, next) {
  if (!maintenanceOn()) return next();
  var p = req.path;
  // 放行：后台页、后台接口、站点配置、运维探针、静态资源、PWA 根级文件、SEO 动态文件
  if (p === '/admin.html' || p.startsWith('/api/admin/') || p === '/api/site' ||
      p === '/api/health' || p === '/api/health/detail' ||
      p.startsWith('/assets/') || p === '/sw.js' || p === '/manifest.json' || p === '/favicon.ico' ||
      p === '/robots.txt' || p === '/sitemap.xml' || p === '/rss.xml') return next();
  // 前台 HTML 页面 → 503 维护页（注入后台设置的维护提示语；无提示语则隐藏）
  if (req.method === 'GET' && (p === '/' || ROOT_HTML_RE.test(p))) {
    var msgRow;
    try { msgRow = db.prepare("SELECT value FROM settings WHERE key='maintenance_msg'").get(); } catch (e) { msgRow = null; }
    var msg = (msgRow && msgRow.value) ? msgRow.value : '';
    fs.readFile(path.join(__dirname, '..', 'maintenance.html'), 'utf8', function (err, html) {
      if (err) return res.status(503).type('text/plain').send('站点维护中');
      res.status(503).setHeader('Cache-Control', 'no-cache').type('text/html; charset=utf-8')
        .send(html.split(PLACEHOLDER).join(SITE).split('__MAINT_MSG__').join(msg));
    });
    return;
  }
  // 公开业务 API → 503 JSON
  if (p.startsWith('/api/')) return res.status(503).json({ error: 'maintenance', message: '站点维护中' });
  next();
});

app.use(function (req, res, next) {
  if (req.method !== 'GET') return next();
  var p = req.path;
  if (p === '/' || ROOT_HTML_RE.test(p)) {
    var file;
    try {
      // 归一化并解析真实路径，随后校验必须落在项目根目录内（防目录穿越）
      file = path.normalize(path.join(__dirname, '..', decodeURIComponent(p === '/' ? 'index.html' : p)));
    } catch (e) {
      return next();
    }
    var root = path.join(__dirname, '..');
    if (file !== root && !file.startsWith(root + path.sep)) return next();
    return serveHtml(file, res, next);
  }
  next();
});

// 动态 robots.txt：必须在静态托管前挂载，否则会被根目录同名静态文件覆盖
app.get('/robots.txt', (req, res) => {
  res.type('text/plain; charset=utf-8');
  res.send(
    'User-agent: *\n' +
    'Allow: /\n' +
    'Disallow: /admin.html\n' +
    'Disallow: /api/\n' +
    'Disallow: /downloads/\n' +
    'Sitemap: ' + SITE + '/sitemap.xml\n'
  );
});

// 动态 sitemap.xml：自动收录首页 / 下载页 / 全部在架产品详情页
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml; charset=utf-8');
  res.send(buildSitemap());
});

// 动态 RSS 2.0：对外发布在架产品动态（订阅 / 发现）
app.get('/rss.xml', (req, res) => {
  res.type('application/rss+xml; charset=utf-8');
  res.send(buildRss());
});

/* ---------- 静态资源缓存策略 ----------
   按类型分级，兼顾「更新能及时生效」与「回访秒开」：
   - sw.js            no-store：一旦被浏览器缓存，Service Worker 更新会被卡死，必须禁用
   - HTML             no-cache：HTML 由服务端注入真实域名，且改版需即时生效
   - CSS / JS         1 小时 + must-revalidate：配合 ETag 走 304，更新最多延迟一小时
   - 图片 / 字体       7 天 + stale-while-revalidate：文件名即版本，换图请改名或加 ?v=
   - 安装包           1 小时 + must-revalidate（下载量由前端点击上报，缓存不影响统计） */
const CACHE_RULES = [
  { test: /(^|[\\/])sw\.js$/, value: 'no-cache, no-store, must-revalidate' },
  { test: /\.(html?|htm)$/, value: 'no-cache' },
  { test: /\.(css|js|mjs|json)$/, value: 'public, max-age=3600, must-revalidate' },
  { test: /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/, value: 'public, max-age=604800, stale-while-revalidate=86400' },
  { test: /\.(woff2?|ttf|otf|eot)$/, value: 'public, max-age=604800, stale-while-revalidate=86400' },
  { test: /\.(exe|msi|dmg|pkg|deb|rpm|apk|ipa|zip|rar|7z)$/, value: 'public, max-age=3600, must-revalidate' }
];

function applyCache(res, filePath) {
  const name = String(filePath || '').toLowerCase();
  for (const rule of CACHE_RULES) {
    if (rule.test.test(name)) {
      res.setHeader('Cache-Control', rule.value);
      return;
    }
  }
}

/* ---------- 公开资源白名单 ----------
   项目根目录绝不能整目录静态托管：否则 /data/app.db（整库）、/server/auth.js（鉴权源码）、
   /data/access.log（访客 IP）、/node_modules、部署配置、以及上线后创建的 .env（含后台口令）
   都会被任意访客直接下载。这里改为「白名单放行」，其余一律走 404（不暴露资源是否存在）。 */
const PUBLIC_ROOT_FILES = new Set(['/sw.js', '/manifest.json', '/favicon.ico']);

function notFoundPage(req, res) {
  res.status(404).type('text/html; charset=utf-8').sendFile(path.join(__dirname, '..', '404.html'));
}

app.use(function (req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const p = req.path;
  if (p.startsWith('/api')) return next();                  // API 由下方路由处理，守卫不介入
  if (p === '/' || ROOT_HTML_RE.test(p)) return next();     // 页面：交给上层的域名替换中间件
  if (PUBLIC_ROOT_FILES.has(p)) return next();              // PWA / 图标等根级公开文件
  if (p.startsWith('/assets/')) return next();              // 站点静态资源
  if (p.startsWith('/downloads/')) return next();           // 对外安装包
  return notFoundPage(req, res);
});

// 静态托管（在白名单守卫之后，故只会命中已放行的路径）：assets / 根级公开文件 / 页面
app.use(express.static(path.join(__dirname, '..'), { setHeaders: applyCache }));

// 安装包目录：真实安装包投放处（由后台填写 /downloads/xxx 或手动放入）
app.use('/downloads', express.static(path.join(__dirname, '..', 'downloads'), { setHeaders: applyCache }));

// API 路由挂载在 /api 前缀
app.use('/api', routes);

// 未匹配 API 返回 JSON 404
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

// 404 兜底：非 API 路由返回友好页面
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not found' });
  }
  notFoundPage(req, res);
});

/* ---------- 统一错误处理 ----------
   必须注册在所有路由之后。典型触发场景：express.json() 收到畸形 JSON 抛 SyntaxError（400）、
   路由内同步抛错（500）。默认行为会返回 HTML 堆栈片段——既可能泄露内部实现细节，
   API 调用方也拿不到结构化错误。这里统一为：记 error.log（含 requestId）+ 返回不带堆栈的响应。 */
app.use(function (err, req, res, next) {
  const id = req.id || '-';
  const status = (err && (err.status || err.statusCode)) || 500;
  const where = req.method + ' ' + (req.originalUrl || req.url);
  appendLog(
    ERROR_LOG,
    '[' + new Date().toISOString() + '] ' + id + ' ' + where + ' ' + status + '\n' +
    (err && err.stack ? err.stack : String(err)) + '\n'
  );
  console.error('[error] ' + id + ' ' + where + ' ' + status + ' ' + (err && err.message));

  // 响应已发出（如流式写到一半出错）则无法改写，交给 Express 默认收尾
  if (res.headersSent) return next(err);

  if (req.path.startsWith('/api/')) {
    return res.status(status).json({
      // 5xx 不回显内部错误信息（防信息泄露）；4xx 保留可读提示（如 JSON 格式错误）
      error: status >= 500 ? 'internal error' : (err && err.message) || 'bad request',
      requestId: id
    });
  }
  res.status(status).type('text/html; charset=utf-8').send(
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + status + ' 出错了</title></head><body>' +
    '<h1>服务器出错了</h1><p>请稍后重试。若持续出现，请提供下面的编号以便我们定位：</p>' +
    '<p><code>' + id + '</code></p><p><a href="/">返回首页</a></p>' +
    '</body></html>'
  );
});

/* ---------- sitemap 生成 ---------- */
// 静态页 lastmod：取对应 HTML 文件的修改日期（改版即更新，真实反映内容时效）
function htmlLastmod(file) {
  try {
    return new Date(fs.statSync(path.join(__dirname, '..', file)).mtime).toISOString().slice(0, 10);
  } catch (e) {
    return undefined;
  }
}
function buildSitemap() {
  const pages = [
    { loc: SITE + '/', changefreq: 'daily', priority: '1.0', lastmod: htmlLastmod('index.html') },
    { loc: SITE + '/download.html', changefreq: 'daily', priority: '0.8', lastmod: htmlLastmod('download.html') },
    { loc: SITE + '/privacy.html', changefreq: 'yearly', priority: '0.3', lastmod: htmlLastmod('privacy.html') },
    { loc: SITE + '/terms.html', changefreq: 'yearly', priority: '0.3', lastmod: htmlLastmod('terms.html') },
  ];
  const products = db.prepare("SELECT id, created_at FROM products WHERE status = 'on'").all();
  products.forEach(function (p) {
    pages.push({
      loc: SITE + '/product.html?id=' + p.id,
      changefreq: 'weekly',
      priority: '0.6',
      lastmod: p.created_at ? new Date(p.created_at).toISOString().slice(0, 10) : undefined,
    });
  });
  const items = pages
    .map(function (p) {
      const lastmod = p.lastmod ? '    <lastmod>' + p.lastmod + '</lastmod>\n' : '';
      return (
        '  <url>\n' +
        '    <loc>' + escapeXml(p.loc) + '</loc>\n' +
        lastmod +
        '    <changefreq>' + p.changefreq + '</changefreq>\n' +
        '    <priority>' + p.priority + '</priority>\n' +
        '  </url>'
      );
    })
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    items +
    '\n</urlset>\n'
  );
}

function escapeXml(s) {
  return String(s).replace(/[&<>'"]/g, function (m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' }[m];
  });
}

/* ---------- RSS 2.0 生成 ---------- */
function buildRss() {
  var prods = db.prepare(
    "SELECT id, name, type, category, desc, created_at FROM products WHERE status='on' ORDER BY id DESC"
  ).all();
  var items = prods.map(function (p) {
    var link = SITE + '/product.html?id=' + p.id;
    var desc = (p.desc || '').slice(0, 300);
    var pub = p.created_at ? new Date(p.created_at).toUTCString() : new Date().toUTCString();
    // 分类标记：类型（应用/游戏）+ 自由分类（如有），供订阅器按分类过滤
    var cats = [p.type === 'game' ? '游戏' : '应用'];
    if (p.category) cats.push(p.category);
    var catXml = cats.map(function (c) { return '      <category>' + escapeXml(c) + '</category>\n'; }).join('');
    return (
      '    <item>\n' +
      '      <title>' + escapeXml(p.name) + '</title>\n' +
      '      <link>' + escapeXml(link) + '</link>\n' +
      '      <guid isPermaLink="false">' + escapeXml(link) + '</guid>\n' +
      catXml +
      '      <description>' + escapeXml(desc) + '</description>\n' +
      '      <pubDate>' + pub + '</pubDate>\n' +
      '    </item>'
    );
  }).join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0">\n' +
    '  <channel>\n' +
    '    <title>绿角犀 LVJIAOXI 产品动态</title>\n' +
    '    <link>' + escapeXml(SITE + '/') + '</link>\n' +
    '    <description>绿角犀 —— 专注效率应用与精品游戏的数字产品公司，应用与游戏，触手可及。</description>\n' +
    '    <language>zh-CN</language>\n' +
    '    <lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>\n' +
    items + '\n' +
    '  </channel>\n' +
    '</rss>\n'
  );
}

if (config.adminPassword === 'admin123') {
  console.warn('[安全提醒] 当前使用默认后台口令 admin123，上线前请修改 server/config.js 或设置环境变量 ADMIN_PASSWORD。');
}

const server = app.listen(config.port, () => {
  console.log(`绿角犀官网运行中： http://localhost:${config.port}`);
  console.log(`后台管理： http://localhost:${config.port}/admin.html`);
  // 数据库自动备份（约每天一份，保留最近 7 份）；失败只记日志，不影响服务
  if (process.env.DISABLE_AUTO_BACKUP !== '1') {
    try {
      require('./backup.js').startScheduler();
    } catch (e) {
      console.error('[backup] 调度器启动失败：' + e.message);
    }
  }
});

// 优雅关闭：先停止接收新连接，关闭数据库，再退出；配合 PM2/systemd 的 SIGTERM
function shutdown(signal) {
  console.log('[shutdown] 收到 ' + signal + '，开始优雅关闭…');
  try { require('./backup.js').stopScheduler(); } catch (e) {}
  server.close(function () {
    try { db.close(); } catch (e) {}
    console.log('[shutdown] 连接已关闭，进程退出');
    process.exit(0);
  });
  // 强制兜底：10s 内未关闭则强制退出，避免僵尸进程
  setTimeout(function () {
    try { db.close(); } catch (e) {}
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGTERM', function () { shutdown('SIGTERM'); });
process.on('SIGINT', function () { shutdown('SIGINT'); });

// 全局异常兜底：记录但不让进程静默崩溃（进行中的请求由 Express 自行 500 兜底）
process.on('uncaughtException', function (err) {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', function (reason) {
  console.error('[unhandledRejection]', reason);
});
