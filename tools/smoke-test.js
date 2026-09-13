#!/usr/bin/env node
/**
 * 全站回归自检（零依赖，Node 18+ 内置 fetch）
 *
 * 用法：
 *   node tools/smoke-test.js                       # 探测 3000 端口；未运行则临时拉起实例（随机端口）后自动关闭
 *   node tools/smoke-test.js --url=http://1.2.3.4:8080   # 对指定站点（如已上线的生产环境）跑一遍
 *   node tools/smoke-test.js --spawn               # 强制用临时实例，不碰正在运行的开发服务
 *
 * 退出码：0 = 全部通过；1 = 存在失败项（可用于 CI 门禁）
 *
 * 覆盖：页面可用性 / API 契约 / 后台鉴权 / 静态托管白名单（安全护栏）/ 缓存策略 /
 *       安全响应头 / SEO 与结构化数据 / 留言防滥用。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const urlArg = argv.find((a) => a.startsWith('--url='));
const forceSpawn = argv.includes('--spawn');
const DEFAULT_TARGET = 'http://127.0.0.1:' + (process.env.SMOKE_PORT || 3000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 断言框架 ---------------- */
let passed = 0;
const failures = [];
let group = '';

function section(title) {
  group = title;
  console.log('\n' + title);
}

function ok(name, cond, detail) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + name + (detail ? '   ' + detail : ''));
  } else {
    failures.push(group + ' → ' + name + (detail ? '  (' + detail + ')' : ''));
    console.log('  ✗ ' + name + (detail ? '   ' + detail : ''));
  }
}

/* ---------------- HTTP 助手 ---------------- */
let BASE = urlArg ? urlArg.slice('--url='.length).replace(/\/+$/, '') : DEFAULT_TARGET;

async function req(p, init) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + p, init);
    return { res, ms: Date.now() - t0, err: null };
  } catch (e) {
    return { res: null, ms: Date.now() - t0, err: e.message };
  }
}

async function status(p, init) {
  const { res, err } = await req(p, init);
  return res ? res.status : 'ERR:' + err;
}

/* ---------------- 临时实例（可选） ---------------- */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function isUp(url) {
  try {
    const r = await fetch(url + '/api/health');
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function waitUp(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isUp(url)) return true;
    await sleep(300);
  }
  return false;
}

let child = null;

async function ensureServer() {
  if (!forceSpawn && !urlArg) {
    if (await isUp(DEFAULT_TARGET)) {
      console.log('目标：已运行的实例 ' + DEFAULT_TARGET);
      return;
    }
  }
  if (urlArg) {
    if (!(await isUp(BASE))) {
      console.error('无法连接指定目标：' + BASE);
      process.exit(1);
    }
    console.log('目标：' + BASE);
    return;
  }
  const port = await freePort();
  BASE = 'http://127.0.0.1:' + port;
  console.log('目标：临时实例 ' + BASE + '（测试结束后自动关闭）');
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port) }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const errBuf = [];
  child.stderr.on('data', (d) => errBuf.push(d.toString()));
  child.stdout.on('data', (d) => errBuf.push(d.toString()));
  if (!(await waitUp(BASE, 20000))) {
    console.error('临时实例启动失败：\n' + errBuf.join(''));
    if (child) child.kill();
    process.exit(1);
  }
}

function shutdown() {
  if (child && !child.killed) child.kill();
}

/* ---------------- 测试主体 ---------------- */
async function run() {
  console.log('=== 绿角犀官网 回归自检 ===');

  /* 1. 页面可用性 */
  section('[1] 页面可用性');
  for (const p of ['/', '/index.html', '/download.html', '/contact.html', '/product.html', '/admin.html', '/offline.html', '/404.html']) {
    ok('GET ' + p + ' → 200', (await status(p)) === 200);
  }

  /* 2. API 契约 */
  section('[2] API 契约');
  const health = await req('/api/health');
  let healthJson = {};
  if (health.res && health.res.ok) healthJson = await health.res.json().catch(() => ({}));
  ok('/api/health 返回 ok', healthJson.status === 'ok', JSON.stringify(healthJson));
  ok('/api/health 数据库正常', healthJson.db === 'ok');

  const siteRes = await req('/api/site');
  const site = siteRes.res && siteRes.res.ok ? await siteRes.res.json().catch(() => ({})) : {};
  ok('/api/site 返回站点域名', typeof site.siteUrl === 'string' && /^https?:\/\//.test(site.siteUrl || ''), site.siteUrl);

  const prodRes = await req('/api/products');
  let products = null;
  if (prodRes.res && prodRes.res.ok) products = await prodRes.res.json().catch(() => null);
  ok('/api/products 返回数组', Array.isArray(products), products ? products.length + ' 条' : '解析失败');
  ok('/api/products 非空（种子数据存在）', Array.isArray(products) && products.length > 0);
  // 产品分类：每条应有 category 字段，且至少存在不同分类（前端筛选依赖此）
  ok('产品含 category 字段', Array.isArray(products) && products.every(function (p) { return 'category' in p; }));
  const cats = products ? Array.from(new Set(products.map(function (p) { return p.category; }))) : [];
  ok('存在至少 2 个不同分类（筛选有意义）', cats.length >= 2, cats.length + ' 类: ' + cats.join(','));
  // 分类筛选接口：传入某一分类应只返回该分类产品
  if (cats.length) {
    const fRes = await req('/api/products?category=' + encodeURIComponent(cats[0]));
    const fList = fRes.res ? await fRes.res.json().catch(function () { return null; }) : null;
    ok('?category= 筛选只返回匹配分类', Array.isArray(fList) && fList.length > 0 &&
      fList.every(function (p) { return p.category === cats[0]; }), fList ? fList.length + ' 条' : '解析失败');
  }
  ok('未知 API 返回 JSON 404', (await status('/api/definitely-not-exist')) === 404);

  /* 3. 后台鉴权 */
  section('[3] 后台鉴权');
  const pw = process.env.ADMIN_PASSWORD || 'admin123';
  const loginRes = await req('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 登录接口为「用户名 + 口令」契约（dim-31 多管理员体系），默认管理员用户名为 admin
    body: JSON.stringify({ username: 'admin', password: pw })
  });
  let token = '';
  if (loginRes.res && loginRes.res.ok) {
    const j = await loginRes.res.json().catch(() => ({}));
    token = j.token || '';
  }
  ok('正确口令登录成功', loginRes.res ? loginRes.res.ok : false, loginRes.res ? String(loginRes.res.status) : String(loginRes.err));
  ok('登录返回 token', token.length > 0);

  const badLogin = await status('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '__wrong_password__' })
  });
  ok('错误口令被拒绝（401 / 429）', badLogin === 401 || badLogin === 429, String(badLogin));

  ok('无 token 访问统计 → 401', (await status('/api/admin/stats')) === 401);
  if (token) {
    ok('带 token 访问统计 → 200', (await status('/api/admin/stats', { headers: { Authorization: 'Bearer ' + token } })) === 200);
  }
  ok('伪造 token 被拒绝', (await status('/api/admin/stats', { headers: { Authorization: 'Bearer forged.token.here' } })) === 401);

  /* 4. 静态托管白名单（安全护栏） */
  section('[4] 静态托管白名单（安全护栏）');
  const SENSITIVE = [
    '/data/app.db',
    '/data/access.log',
    '/server/server.js',
    '/server/auth.js',
    '/server/db.js',
    '/package.json',
    '/package-lock.json',
    '/README.md',
    '/DEPLOY.md',
    '/deploy/nginx.conf',
    '/node_modules/express/package.json',
    '/tools/smoke-test.js',
    '/.env'
  ];
  for (const p of SENSITIVE) {
    ok('敏感路径不可访问 ' + p, (await status(p)) === 404, '实际 ' + (await status(p)));
  }
  const dbProbe = await req('/data/app.db');
  if (dbProbe.res) {
    const body = await dbProbe.res.text().catch(() => '');
    ok('数据库内容未泄露（无 SQLite 文件头）', !body.includes('SQLite format 3'));
    ok('数据库内容未泄露（无表结构）', !/CREATE TABLE/i.test(body));
  }
  ok('目录穿越尝试被拦截', (await status('/../package.json')) === 404);
  ok('子目录 HTML 不公开', (await status('/data/any.html')) === 404);

  /* 4b. 自动备份目录：备份是数据库的完整副本，泄露后果比主库更严重 */
  const BACKUP_DIR = path.join(ROOT, 'data', 'backups');
  let localBackups = [];
  try {
    localBackups = require('fs').readdirSync(BACKUP_DIR)
      .filter((f) => /\.db$/.test(f));
  } catch (e) { /* 目录不存在则跳过逐个探测 */ }

  ok('备份目录不可列表 ' + '/data/backups/', (await status('/data/backups/')) === 404);
  for (const name of localBackups.slice(0, 3)) {
    const p = '/data/backups/' + name;
    ok('备份文件不可下载 ' + p, (await status(p)) === 404, '实际 ' + (await status(p)));
  }
  if (localBackups.length) {
    // 即使返回了非 404，也必须确认响应体不是一份可用的数据库
    const probe = await req('/data/backups/' + localBackups[0]);
    if (probe.res) {
      const body = await probe.res.text().catch(() => '');
      ok('备份内容未泄露（无 SQLite 文件头）', !body.includes('SQLite format 3'));
    }
  } else {
    console.log('  · 本地暂无自动备份文件，跳过逐个探测（备份目录本身已校验）');
  }

  /* 5. 公开资源 */
  section('[5] 公开资源与缓存策略');
  const PUBLIC = ['/sw.js', '/manifest.json', '/assets/css/style.css', '/assets/js/main.js',
    '/assets/js/admin.js', '/assets/img/hero-bg.jpg', '/assets/img/og.jpg',
    '/assets/img/icon-512.png', '/assets/img/logo.svg'];
  for (const p of PUBLIC) ok('GET ' + p + ' → 200', (await status(p)) === 200);

  async function cacheControl(p) {
    const { res } = await req(p);
    return res ? (res.headers.get('cache-control') || '') : '';
  }
  ok('sw.js 禁用缓存（防 SW 更新卡死）', /no-store/.test(await cacheControl('/sw.js')), await cacheControl('/sw.js'));
  ok('HTML 不缓存', /no-cache/.test(await cacheControl('/')), await cacheControl('/'));
  ok('CSS 短缓存 + must-revalidate', /max-age=3600/.test(await cacheControl('/assets/css/style.css')));
  ok('图片长缓存', /max-age=604800/.test(await cacheControl('/assets/img/hero-bg.jpg')));

  /* 6. 安全响应头 */
  section('[6] 安全响应头');
  const home = await req('/');
  if (home.res) {
    const h = home.res.headers;
    const csp = h.get('content-security-policy') || '';
    ok('Content-Security-Policy 存在', !!csp);
    // 关键不变量：脚本执行必须收紧。style-src 保留 'unsafe-inline' 是已知取舍（见 server.js 注释），
    // 因为页面存在 style="" 属性，且 admin.js / main.js / product.js 通过 CSSOM 动态设置样式，
    // 移除会直接破坏后台面板与页面交互。
    ok('CSP 脚本源未放开 unsafe-inline', !/script-src[^;]*unsafe-inline/.test(csp));
    ok('CSP 未放开 unsafe-eval', !/unsafe-eval/.test(csp));
    if (/style-src[^;]*unsafe-inline/.test(csp)) {
      console.log('  ! 提示：style-src 保留 unsafe-inline（已知取舍，非缺陷）——内联 style 属性与 CSSOM 设样式均依赖它');
    }
    ok('X-Frame-Options / frame-ancestors 防嵌套',
      !!h.get('x-frame-options') || /frame-ancestors/.test(h.get('content-security-policy') || ''));
    ok('HSTS 存在', !!h.get('strict-transport-security'));
    ok('未泄露 X-Powered-By', !h.get('x-powered-by'));
  }

  /* 7. SEO 与结构化数据 */
  section('[7] SEO 与结构化数据');
  for (const p of ['/sitemap.xml', '/robots.txt', '/rss.xml', '/manifest.json']) {
    ok('GET ' + p + ' → 200', (await status(p)) === 200);
  }
  const sitemap = await (await req('/sitemap.xml')).res.text();
  ok('sitemap 含 <urlset>', /<urlset/i.test(sitemap));
  ok('sitemap 使用真实域名', !!site.siteUrl && sitemap.includes(site.siteUrl.replace(/^https?:\/\//, '')));
  ok('sitemap 含 <lastmod> 动态日期', /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sitemap));
  const rss = await (await req('/rss.xml')).res.text();
  ok('RSS 条目含 <category> 分类标记', /<item>[\s\S]*?<category>/.test(rss) && (rss.match(/<category>/g) || []).length >= 2, (rss.match(/<category>/g) || []).length + ' 个');
  ok('RSS channel 含 <language> 语言标记', /<language>/.test(rss));
  const robots = await (await req('/robots.txt')).res.text();
  ok('robots.txt 声明 Sitemap', /Sitemap:/i.test(robots));
  ok('robots.txt 屏蔽后台', /Disallow:\s*\/admin\.html/i.test(robots));

  const html = home.res ? await home.res.text() : (await (await req('/')).res.text());
  ok('首页含 canonical', /rel="canonical"/.test(html));
  ok('首页 canonical 用真实域名', !!site.siteUrl && html.includes(site.siteUrl));
  ok('首页含 OG 分享图', /og:image/.test(html) && /assets\/img\/og\.jpg/.test(html));
  ok('首页含 JSON-LD 结构化数据', /application\/ld\+json/.test(html));

  /* 8. 留言防滥用 */
  section('[8] 留言防滥用');
  const honeypot = await status('/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'bot', email: 'bot@example.com', message: 'spam', company: 'bot-company' })
  });
  // 限流 30 次 / 10 分钟（放宽以容纳冒烟造数），反复跑测试可能先命中 429 —— 只要不是 2xx 即视为已拦截
  ok('蜜罐字段被拦截（400 / 429）', honeypot === 400 || honeypot === 429, String(honeypot));

  const badEmail = await status('/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'tester', email: 'not-an-email', message: 'hello' })
  });
  ok('非法邮箱被拦截（400 / 429）', badEmail === 400 || badEmail === 429, String(badEmail));

  /* 9. 可观测性与排障（请求追踪 / 错误处理 / 深度健康检查） */
  section('[9] 可观测性与排障');
  const rdPage = await req('/');
  const rid = rdPage.res ? rdPage.res.headers.get('x-request-id') : null;
  ok('响应带 X-Request-Id', !!rid, rid || '缺失');
  ok('X-Request-Id 格式合法', !!rid && /^[A-Za-z0-9._-]{1,64}$/.test(rid), rid || '');

  // 客户端自带 ID 应被透传（跨服务串联）；格式非法时必须被拒绝（防日志注入）
  const customId = 'trace-abc-123';
  const echoRes = await req('/api/health', { headers: { 'X-Request-Id': customId } });
  ok('客户端 X-Request-Id 被透传',
    !!echoRes.res && echoRes.res.headers.get('x-request-id') === customId,
    echoRes.res ? String(echoRes.res.headers.get('x-request-id')) : '无响应');

  // 注：不能用含换行的值测试——HTTP 头不允许换行，客户端会直接抛错，请求到不了服务端，
  // 那样只是在测客户端而非服务端。用「含空格」的非法值（头值允许空格）才能真打到服务端校验。
  const injectedId = 'evil id with spaces';
  const injRes = await req('/api/health', { headers: { 'X-Request-Id': injectedId } });
  const injVal = injRes.res ? injRes.res.headers.get('x-request-id') : '';
  ok('非法 X-Request-Id 被丢弃重生成（防日志注入）',
    !!injVal && injVal !== injectedId && /^[A-Za-z0-9._-]{1,64}$/.test(injVal), injVal || '无响应');

  // 畸形 JSON：express.json() 抛错，应由统一错误处理器转成结构化响应（而非 HTML 堆栈）
  const badJson = await req('/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"name": broken'
  });
  const badJsonStatus = badJson.res ? badJson.res.status : 0;
  ok('畸形 JSON → 400（非 500）', badJsonStatus === 400, String(badJsonStatus));
  let badJsonBody = null;
  if (badJson.res) badJsonBody = await badJson.res.json().catch(() => null);
  ok('错误响应为 JSON 且带 requestId', !!badJsonBody && typeof badJsonBody.requestId === 'string', JSON.stringify(badJsonBody));
  // 关键：请求体解析失败时，请求 ID 中间件必须已经跑过（它挂在 express.json() 之前），
  // 否则这里会拿到占位符 '-'，追踪链在最需要它的场景断掉。
  ok('错误响应 requestId 非占位符', !!badJsonBody && badJsonBody.requestId !== '-' && /^[A-Za-z0-9._-]{1,64}$/.test(badJsonBody.requestId), badJsonBody ? badJsonBody.requestId : '');
  ok('错误响应不泄露堆栈', !!badJsonBody && !/at .*\(|node_modules/.test(JSON.stringify(badJsonBody)));

  // 深度健康检查：需鉴权，且不能匿名访问
  ok('匿名访问 /api/health/detail → 401', (await status('/api/health/detail')) === 401);
  if (token) {
    const det = await req('/api/health/detail', { headers: { Authorization: 'Bearer ' + token } });
    let detJson = null;
    if (det.res) detJson = await det.res.json().catch(() => null);
    ok('带 token 访问 /api/health/detail → 200/503', det.res ? (det.res.status === 200 || det.res.status === 503) : false, det.res ? String(det.res.status) : 'ERR');
    ok('detail 含数据库检查结果', !!detJson && !!detJson.checks && detJson.checks.db && typeof detJson.checks.db.ok === 'boolean');
    ok('detail 含备份检查结果', !!detJson && !!detJson.checks && !!detJson.checks.backup && typeof detJson.checks.backup.stale === 'boolean');
    ok('detail 含磁盘检查结果', !!detJson && !!detJson.checks && !!detJson.checks.disk);
    ok('detail 含备份校验结果（有备份 ≠ 能恢复）',
      !!detJson && !!detJson.checks && !!detJson.checks.backupVerify && typeof detJson.checks.backupVerify.ok === 'boolean',
      detJson && detJson.checks && detJson.checks.backupVerify ? String(detJson.checks.backupVerify.ok) : '缺失');
    // 已有备份时，最近一次校验必须通过；否则健康检查会降级为 503
    if (detJson && detJson.checks && detJson.checks.backup && detJson.checks.backup.count > 0) {
      ok('存在备份时校验应为通过', detJson.checks.backupVerify.ok === true,
        detJson.checks.backupVerify.detail || '');
    }
    ok('detail 状态与 HTTP 状态码一致',
      !!detJson && ((detJson.status === 'ok' && det.res.status === 200) || (detJson.status === 'degraded' && det.res.status === 503)),
      detJson ? detJson.status + '/' + det.res.status : '');
  }

  /* 备份校验器的负向用例：若校验器被改坏到「永远返回通过」，上面那些断言依然会绿，
     但坏档就再也检测不出来了——所以必须验证它真的能抓出损坏文件。
     用 verifyBackup（只返回结果）而非 runVerify（会写审计日志），避免污染审计。 */
  try {
    const bkp = require(path.join(ROOT, 'server', 'backup.js'));
    const junk = path.join(os.tmpdir(), 'lvjx-smoke-bad-' + Date.now() + '.db');
    fs.writeFileSync(junk, 'this is not a sqlite database');
    const bad = bkp.verifyBackup(junk);
    ok('校验器能识别损坏的备份文件', bad && bad.ok === false, bad ? bad.error : '无返回');
    const missing = bkp.verifyBackup(path.join(os.tmpdir(), 'lvjx-smoke-missing-' + Date.now() + '.db'));
    ok('校验器能识别文件缺失', missing && missing.ok === false, missing ? missing.error : '无返回');
    try { fs.unlinkSync(junk); } catch (e) {}
  } catch (e) {
    ok('备份校验器负向用例可执行', false, e.message);
  }
  // 轻量探针不得泄露指纹信息（Node 版本 / 平台只出现在需鉴权的 detail 里）
  ok('轻量 /api/health 不暴露 Node 版本', !('nodeVersion' in healthJson), JSON.stringify(Object.keys(healthJson)));

  /* 10. 无障碍 (a11y) 护栏 —— 锁定维度42前端修复不被回退（读取仓库文件，不依赖运行实例） */
  section('[10] 无障碍 (a11y) 护栏');
  // 10a. 每个页面都有 skip-link，且目标主内容地标存在（键盘用户可直达主内容）
  const A11Y_PAGES = ['index.html', 'download.html', 'contact.html', 'product.html',
    'admin.html', 'api.html', '404.html', 'offline.html'];
  for (const pg of A11Y_PAGES) {
    const txt = fs.readFileSync(path.join(ROOT, pg), 'utf8');
    const hasSkip = /class="skip-link"/.test(txt);
    const hasMain = /id="main"|role="main"/.test(txt);
    ok(pg + ' skip-link + 主内容地标', hasSkip && hasMain,
      hasSkip ? (hasMain ? 'ok' : '缺 main 地标') : '缺 skip-link');
  }
  // 10b. 后台表单：每个 <label for="x"> 必须命中对应控件 id="x"，否则屏幕阅读器无法朗读
  const adminTxt = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const labelFors = Array.from(adminTxt.matchAll(/<label[^>]*\sfor="([^"]+)"/g)).map((m) => m[1]);
  const ctrlIds = new Set(Array.from(adminTxt.matchAll(/\bid="([^"]+)"/g)).map((m) => m[1]));
  const orphanLabels = labelFors.filter((f) => !ctrlIds.has(f));
  ok('admin.html 全部 label 均 for 关联到控件', orphanLabels.length === 0,
    orphanLabels.length ? '孤儿 label: ' + orphanLabels.join(',') : labelFors.length + ' 个 label 全部命中');
  for (const fid of ['f-name', 'f-type', 'f-category', 'f-icon', 'f-url', 'f-desc']) {
    ok('admin.html 产品表单含字段 ' + fid, ctrlIds.has(fid));
  }
  // 10c. 汉堡按钮开合必须同步 aria-expanded（屏幕阅读器播报菜单展开/收起）
  const mainJs = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'main.js'), 'utf8');
  ok('main.js 汉堡切换同步 aria-expanded', /setAttribute\(\s*'aria-expanded'/.test(mainJs));
  // 10d. 含主导航的 4 个营销页：当前导航项恰有 1 个 aria-current="page"
  for (const pg of ['index.html', 'download.html', 'contact.html', 'product.html']) {
    const t = fs.readFileSync(path.join(ROOT, pg), 'utf8');
    const n = (t.match(/aria-current="page"/g) || []).length;
    ok(pg + ' 恰有 1 个 aria-current="page"', n === 1, '实际 ' + n + ' 个');
  }

  /* 11. 结构化数据 (SEO 富媒体) 收尾 —— 每公开页均含 BreadcrumbList，产品页含 SoftwareApplication */
  section('[11] 结构化数据 (SEO 富媒体)');
  function extractLd(htmlStr) {
    const out = [];
    const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(htmlStr))) {
      try { out.push(JSON.parse(m[1])); } catch (e) { /* 无效块由下方断言捕获 */ }
    }
    return out;
  }
  function ldHasType(obj, type) {
    if (!obj || typeof obj !== 'object') return false;
    if (obj['@type'] === type) return true;
    if (Array.isArray(obj['@graph'])) return obj['@graph'].some((n) => n && n['@type'] === type);
    return false;
  }
  for (const pg of ['download.html', 'contact.html']) {
    const h = await (await req('/' + pg)).res.text();
    const blocks = extractLd(h);
    ok(pg + ' 含合法 JSON-LD 块', blocks.length > 0, blocks.length + ' 块');
    ok(pg + ' 含 BreadcrumbList 结构化数据', blocks.some((b) => ldHasType(b, 'BreadcrumbList')));
  }
  // 产品页为运行时注入：校验 product.js 注入能力 + 页面引用脚本
  const prodHtml = await (await req('/product.html')).res.text();
  const prodJs = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'product.js'), 'utf8');
  ok('product.html 引用 product.js', /product\.js/.test(prodHtml));
  ok('product.js 注入 SoftwareApplication', /'SoftwareApplication'/.test(prodJs));
  ok('product.js 注入 BreadcrumbList', /BreadcrumbList/.test(prodJs));
  ok('product.js 注入 application/ld+json', /application\/ld\+json/.test(prodJs));
  // 首页 Organization 回归（不应因新增结构化数据而失效）
  const homeBlocks = extractLd(await (await req('/')).res.text());
  ok('首页 含 Organization 结构化数据', homeBlocks.some((b) => ldHasType(b, 'Organization')));

  /* [12] 后台危险操作二次确认弹窗 (a11y + 行为) */
  section('[12] 后台危险操作二次确认弹窗');
  const adminHtml = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const adminJs = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  const i18nJs = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  ok('admin.html 引入 confirm-modal.js', /assets\/js\/confirm-modal\.js/.test(adminHtml));
  ok('admin.js 改用 showConfirm() 二次确认', /showConfirm\(/.test(adminJs));
  ok('admin.js 不再使用原生 confirm()', !/[^.\w]confirm\(/.test(adminJs), '残留 confirm( 会绕过弹窗');
  const newKeys = ['contact.deleteTitle', 'contact.deleteConfirm', 'product.deleteTitle', 'product.deleteConfirm'];
  for (const k of newKeys) {
    const n = (i18nJs.match(new RegExp("'" + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  // 行为校验（DOM 桩模拟 点击/Enter/Esc/遮罩）
  const verify = spawnSync(process.execPath, [path.join(ROOT, 'tools', '_verify_confirm.js')], { encoding: 'utf8' });
  ok('二次确认弹窗行为校验通过 (16 项)', verify.status === 0, (verify.stdout || '') + (verify.stderr || ''));

  /* [13] 后台产品表单双重校验（服务端契约 + 客户端守卫） */
  section('[13] 后台产品表单双重校验');
  const loginForV = await req('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: pw }) });
  let tk = '';
  if (loginForV.res && loginForV.res.ok) { const j = await loginForV.res.json().catch(() => ({})); tk = j.token || ''; }
  const authH = { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' };
  const createdIds = [];
  async function addAndTrack(body) {
    const s = await status('/api/admin/products', { method: 'POST', headers: authH, body: JSON.stringify(body) });
    const list = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + tk } })).res.json().catch(() => []);
    const rec = (list || []).filter((p) => p.name === body.name)[0];
    if (rec) createdIds.push(rec.id);
    return s;
  }
  const a1 = await addAndTrack({ name: '冒烟校验_合法', type: 'app', download_url: 'https://example.com/x' });
  ok('合法产品新增 → 200/201', a1 === 200 || a1 === 201, String(a1));
  ok('空名称新增 → 400', (await status('/api/admin/products', { method: 'POST', headers: authH, body: JSON.stringify({ name: '', type: 'app' }) })) === 400);
  ok('纯空格名称新增 → 400', (await status('/api/admin/products', { method: 'POST', headers: authH, body: JSON.stringify({ name: '   ', type: 'app' }) })) === 400);
  ok('缺 type 新增 → 400', (await status('/api/admin/products', { method: 'POST', headers: authH, body: JSON.stringify({ name: 'X' }) })) === 400);
  ok('超长名称(>80)新增 → 400', (await status('/api/admin/products', { method: 'POST', headers: authH, body: JSON.stringify({ name: 'A'.repeat(81), type: 'app' }) })) === 400);
  ok('javascript: 下载链接新增 → 400', (await status('/api/admin/products', { method: 'POST', headers: authH, body: JSON.stringify({ name: 'X', type: 'app', download_url: 'javascript:alert(1)' }) })) === 400);
  ok('data: 下载链接新增 → 400', (await status('/api/admin/products', { method: 'POST', headers: authH, body: JSON.stringify({ name: 'Y', type: 'app', download_url: 'data:text/html,<b>1</b>' }) })) === 400);
  const a6 = await addAndTrack({ name: '冒烟校验_相对', type: 'game', download_url: '/downloads/x' });
  ok('站内相对路径下载链接新增 → 200/201', a6 === 200 || a6 === 201, String(a6));
  ok('分类含 HTML 标签 → 400', (await status('/api/admin/products', { method: 'POST', headers: authH, body: JSON.stringify({ name: '冒烟校验_分类', type: 'app', category: '<b>html</b>' }) })) === 400);
  ok('分类含控制字符 → 400', (await status('/api/admin/products', { method: 'POST', headers: authH, body: JSON.stringify({ name: '冒烟校验_分类2', type: 'app', category: 'a\u0000b' }) })) === 400);
  ok('图标含字母（非 emoji）→ 400', (await status('/api/admin/products', { method: 'POST', headers: authH, body: JSON.stringify({ name: '冒烟校验_图标', type: 'app', icon: 'abc' }) })) === 400);
  const aIcon = await addAndTrack({ name: '冒烟校验_图标合法', type: 'app', icon: '🚀' });
  ok('合法 emoji 图标 → 200/201', aIcon === 200 || aIcon === 201, String(aIcon));
  if (createdIds.length) {
    ok('编辑清空名称 → 400', (await status('/api/admin/products/' + createdIds[0], { method: 'PUT', headers: authH, body: JSON.stringify({ name: '  ' }) })) === 400);
  }
  for (const id of createdIds) { await status('/api/admin/products/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tk } }); }
  const adminJs13 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  ok('admin.js 含客户端产品预校验 validateProductPayload', /validateProductPayload/.test(adminJs13));
  ok('admin.js 保存失败不再静默当成成功（含 !r.ok 分支）', /!r\.ok/.test(adminJs13));
  ok('admin.js 客户端校验含分类字符集规则', /分类含非法字符/.test(adminJs13));
  ok('admin.js 客户端校验含 emoji 图标规则', /图标仅限 emoji/.test(adminJs13));
  ok('admin.html 产品分类改为枚举下拉 select（去 datalist）',
    /<select id="f-category">/.test(fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8')) &&
    !/cat-options/.test(fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8')));

  /* [14] 错误页增强 + 图片渲染护栏（404/offline 快捷导航与搜索、懒加载与防 CLS） */
  section('[14] 错误页增强与图片渲染');
  const err404 = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
  const errOff = fs.readFileSync(path.join(ROOT, 'offline.html'), 'utf8');
  ok('404 页含快捷导航', /class="err-links"/.test(err404));
  ok('404 页含站内搜索入口', /id="err-search"/.test(err404) && /id="err-results"/.test(err404));
  ok('404 页引用外置搜索脚本（符合 CSP）', /assets\/js\/err-search\.js/.test(err404));
  ok('offline 页含快捷导航', /class="err-links"/.test(errOff));
  ok('offline 页引用外置状态脚本', /assets\/js\/offline\.js/.test(errOff));
  const offlineInline = Array.from(errOff.matchAll(/<script>([\s\S]*?)<\/script>/g)).map((m) => m[1]);
  ok('offline 页无内联状态脚本', !offlineInline.some((b) => b.indexOf('offline-state') >= 0 || b.indexOf('navigator.onLine') >= 0));
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  ok('sw.js 预缓存 err-search.js', /err-search\.js/.test(sw));
  ok('sw.js 预缓存 offline.js', /offline\.js/.test(sw));
  for (const k of ['err.quickNav', 'err.search', 'err.searchPh', 'err.searchEmpty', 'err.searchOffline']) {
    const n = (i18nJs.match(new RegExp("'" + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  // 图片渲染：所有 <img> 带 decoding + 显式尺寸（防 CLS）；首屏 logo 不应被懒加载（保护 LCP）
  for (const pg of ['index.html', 'download.html', 'contact.html', 'product.html', 'api.html', 'admin.html', '404.html', 'offline.html']) {
    const t = fs.readFileSync(path.join(ROOT, pg), 'utf8');
    const imgs = Array.from(t.matchAll(/<img\b[^>]*>/g)).map((m) => m[0]);
    if (!imgs.length) continue;
    const badDec = imgs.filter((i) => !/decoding="async"/.test(i));
    const badDim = imgs.filter((i) => !/\bwidth="/.test(i) || !/\bheight="/.test(i));
    const lazyLogo = imgs.filter((i) => /class="logo-img"/.test(i) && /loading="lazy"/.test(i));
    ok(pg + ' 全部 <img> 带 decoding="async"', badDec.length === 0, badDec.length ? badDec.join(' | ') : imgs.length + ' 个');
    ok(pg + ' 全部 <img> 带 width/height 尺寸', badDim.length === 0, badDim.length ? badDim.join(' | ') : '');
    ok(pg + ' 首屏 logo 未被懒加载', lazyLogo.length === 0, lazyLogo.length ? 'logo 懒加载会拖慢 LCP' : '');
  }

  /* [15] prefers-reduced-motion 无障碍动效降级 */
  section('[15] prefers-reduced-motion 降级');
  ok('assets/js/motion.js 存在且导出 prefersReducedMotion', /prefersReducedMotion/.test(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'motion.js'), 'utf8')));
  for (const pg of ['index.html', 'download.html', 'contact.html']) {
    ok(pg + ' 引入 motion.js', /assets\/js\/motion\.js/.test(fs.readFileSync(path.join(ROOT, pg), 'utf8')));
  }
  ok('admin.html 引入 motion.js', /assets\/js\/motion\.js/.test(fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8')));
  const mainJs15 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'main.js'), 'utf8');
  ok('main.js 数字滚动尊重 reduced-motion（直接落终值）', /prefersReducedMotion/.test(mainJs15) && /toLocaleString\(\);\s*return/.test(mainJs15));
  ok('main.js 分类跳转滚动感知 reduced-motion', /behavior:\s*\(window\.prefersReducedMotion/.test(mainJs15));
  const adminJs15 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  ok('admin.js 编辑表单滚动感知 reduced-motion', /scrollIntoView\(\{ behavior:\s*\(window\.prefersReducedMotion/.test(adminJs15));
  ok('sw.js 预缓存 motion.js', /motion\.js/.test(sw));

  /* [16] 404 搜索键盘导航与结果高亮 */
  section('[16] 404 搜索键盘导航与高亮');
  const err404b = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
  ok('404 搜索输入为 combobox 模式', /id="err-search"[^>]*role="combobox"/.test(err404b));
  ok('404 搜索输入含 aria-activedescendant', /id="err-search"[^>]*aria-activedescendant/.test(err404b));
  ok('404 搜索输入含 aria-expanded', /id="err-search"[^>]*aria-expanded/.test(err404b));
  ok('404 页含 aria-live 播报区', /id="err-live"[^>]*aria-live="polite"/.test(err404b));
  const errJs16 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'err-search.js'), 'utf8');
  ok('err-search.js 支持 ↑/↓ 键盘导航', /e\.key === 'ArrowDown'/.test(errJs16) && /e\.key === 'ArrowUp'/.test(errJs16));
  ok('err-search.js 支持 Enter 选中', /e\.key === 'Enter'/.test(errJs16) && /activate\(active\)/.test(errJs16));
  ok('err-search.js 同步 aria-activedescendant', /setAttribute\('aria-activedescendant'/.test(errJs16));
  ok('err-search.js 结果含 active 高亮类', /classList\.toggle\('active'/.test(errJs16));
  ok('err-search.js 播报结果数量/空态', /announce\(/.test(errJs16) && /live\.textContent/.test(errJs16));
  const style16 = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
  ok('style.css 含 .err-result.active 高亮样式', /\.err-result\.active/.test(style16));
  ok('style.css 含 .visually-hidden 工具类', /\.visually-hidden\s*\{/.test(style16));

  /* [17] 留言批量操作（后端端点 + 前端静态） */
  section('[17] 留言批量操作');
  const loginForB = await req('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: pw }) });
  const bj = await loginForB.res.json().catch(() => ({}));
  const bt = bj.token || '';
  const bH = { Authorization: 'Bearer ' + bt, 'Content-Type': 'application/json' };
  // 造 2 条测试留言（公开接口，走限流但允许）
  const c1 = await (await req('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '冒烟批量甲', message: 'batch-test-a' }) })).res.status;
  const c2 = await (await req('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '冒烟批量乙', message: 'batch-test-b' }) })).res.status;
  ok('可创建 2 条批量测试留言', c1 === 200 && c2 === 200, c1 + '/' + c2);
  const bData = await (await req('/api/admin/contacts', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => ({}));
  const bList = (bData && bData.rows) || [];
  ok('contacts 接口返回分页结构 {rows,total}', Array.isArray(bList) && typeof bData.total === 'number', 'rows=' + bList.length + ' total=' + bData.total);
  const ids = bList.filter((m) => m.name === '冒烟批量甲' || m.name === '冒烟批量乙').map((m) => m.id);
  ok('找到批量测试留言 id', ids.length === 2, ids.join(','));
  const bs1 = await status('/api/admin/contacts/batch-status', { method: 'POST', headers: bH, body: JSON.stringify({ ids: ids, status: 'done' }) });
  ok('批量标记已处理 → 200', bs1 === 200, String(bs1));
  const bs2 = await status('/api/admin/contacts/batch-status', { method: 'POST', headers: bH, body: JSON.stringify({ ids: ids, status: 'bad' }) });
  ok('批量非法状态 → 400', bs2 === 400, String(bs2));
  const bs3 = await status('/api/admin/contacts/batch-status', { method: 'POST', headers: bH, body: JSON.stringify({ ids: [], status: 'done' }) });
  ok('批量空 ids → 400', bs3 === 400, String(bs3));
  const bd1 = await status('/api/admin/contacts/batch-delete', { method: 'POST', headers: bH, body: JSON.stringify({ ids: ids }) });
  ok('批量删除 → 200', bd1 === 200, String(bd1));
  const bd2 = await status('/api/admin/contacts/batch-delete', { method: 'POST', headers: bH, body: JSON.stringify({ ids: ['a'] }) });
  ok('批量非法 id → 400', bd2 === 400, String(bd2));
  const bd3 = await status('/api/admin/contacts/batch-delete', { method: 'POST', headers: { Authorization: 'Bearer bad' }, body: JSON.stringify({ ids: [1] }) });
  ok('批量删除未鉴权 → 401', bd3 === 401, String(bd3));
  const adminHtml17 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const adminJs17 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  ok('admin.html 含全选控件', /id="contact-select-all"/.test(adminHtml17));
  ok('admin.html 含批量操作条', /id="contact-batch"/.test(adminHtml17) && /id="batch-del-sel"/.test(adminHtml17));
  ok('admin.js 含批量勾选处理', /data-check/.test(adminJs17));
  ok('admin.js 含批量请求 batchReq', /batchReq\(/.test(adminJs17));
  for (const k of ['contact.selectAll', 'contact.markDoneSel', 'contact.delSel', 'contact.batchCount', 'contact.delSelTitle', 'contact.delSelConfirm']) {
    const n = (i18nJs.match(new RegExp("'" + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }

  /* [18] 维度索引文件 */
  section('[18] 维度索引文件');
  const idxPath = path.join(ROOT, '维度清单.md');
  ok('维度清单.md 存在', fs.existsSync(idxPath));
  if (fs.existsSync(idxPath)) {
    const idx = fs.readFileSync(idxPath, 'utf8');
    // 总表行数（"^| N |"）应与「维度总数：**N**」一致，避免总表与统计脱节（不硬编码维度数，新增维度自动生效）
    const rowNums = (idx.match(/^\| (\d+) \|/gm) || []).map(function (m) { return parseInt(/\d+/.exec(m)[0], 10); });
    const totalMatch = idx.match(/维度总数：\*\*(\d+)\*\*/);
    const totalNum = totalMatch ? parseInt(totalMatch[1], 10) : 0;
    const maxRowNum = rowNums.length ? Math.max.apply(null, rowNums) : 0;
    ok('维度清单.md 总表行数与统计一致', rowNums.length === totalNum && maxRowNum === totalNum,
      '总表行数=' + rowNums.length + ' 最大编号=' + maxRowNum + ' 统计=' + totalNum);
    ok('维度清单.md 含回归组映射', /\[18\] 维度索引文件 \| 50/.test(idx) && /\[19\] 留言服务端分页\/搜索\/筛选 \| 51/.test(idx) && /\[20\] 404 搜索模糊匹配 \| 52/.test(idx));
  }

  /* [19] 留言服务端分页/搜索/筛选 */
  section('[19] 留言服务端分页/搜索/筛选');
  const p1 = await (await req('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '分页测试甲', message: 'keyword-alpha' }) })).res.status;
  const p2 = await (await req('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '分页测试乙', message: 'keyword-beta' }) })).res.status;
  const p3 = await (await req('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '分页测试丙', message: 'keyword-gamma' }) })).res.status;
  ok('造 3 条分页测试留言', p1 === 200 && p2 === 200 && p3 === 200, p1 + '/' + p2 + '/' + p3);
  const pgBase = '/api/admin/contacts?pageSize=2';
  const pgH = { headers: { Authorization: 'Bearer ' + bt } };
  const page1 = await (await req(pgBase + '&page=1', pgH)).res.json().catch(() => ({}));
  ok('分页第 1 页 2 条', (page1.rows || []).length === 2, 'rows=' + (page1.rows || []).length);
  ok('分页 total >= 3', typeof page1.total === 'number' && page1.total >= 3, 'total=' + page1.total);
  const page2 = await (await req(pgBase + '&page=2', pgH)).res.json().catch(() => ({}));
  ok('分页第 2 页返回余下数据', Array.isArray(page2.rows) && page2.rows.length > 0, 'rows=' + (page2.rows || []).length);
  const kwData = await (await req(pgBase + '&page=1&keyword=keyword-beta', pgH)).res.json().catch(() => ({}));
  ok('搜索 keyword-beta 命中 1 条', (kwData.rows || []).length === 1 && kwData.total === 1, 'total=' + kwData.total);
  const stData = await (await req(pgBase + '&page=1&status=new', pgH)).res.json().catch(() => ({}));
  ok('状态筛选 new 命中 >= 3', typeof stData.total === 'number' && stData.total >= 3, 'total=' + stData.total);
  const badPg = await status(pgBase + '&pageSize=999', pgH);
  ok('pageSize 上限钳制 → 200', badPg === 200, String(badPg));
  // 清理 3 条测试数据
  const pgAll = await (await req('/api/admin/contacts?pageSize=100', pgH)).res.json().catch(() => ({}));
  const pgIds = ((pgAll.rows) || []).filter((m) => (m.name || '').indexOf('分页测试') === 0).map((m) => m.id);
  if (pgIds.length) {
    const delR = await status('/api/admin/contacts/batch-delete', { method: 'POST', headers: bH, body: JSON.stringify({ ids: pgIds }) });
    ok('清理分页测试数据 → 200', delR === 200, String(delR));
  }
  const adminJs19 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  ok('admin.js 搜索走服务端加载（防抖 loadContacts）', /contactSearchTimer = setTimeout\(function \(\) \{ loadContacts\(\); \}, 300\)/.test(adminJs19));
  ok('admin.js 分页走服务端（loadContacts keepPage）', /act === 'next' && contactPage < totalPages[\s\S]*?loadContacts\(\{ keepPage: true \}\)/.test(adminJs19));
  ok('admin.js 使用服务端 total 渲染分页条', /共 ' \+ contactTotal \+ ' 条/.test(adminJs19));
  ok('admin.js 已移除客户端 filteredContacts', !/filteredContacts/.test(adminJs19));
  ok('admin.js 请求带分页参数', /'\?page=' \+ contactPage/.test(adminJs19));

  /* [20] 404 搜索模糊匹配（分类/描述） */
  section('[20] 404 搜索模糊匹配（分类/描述）');
  const errJs20 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'err-search.js'), 'utf8');
  ok('err-search.js 覆盖名称/分类/类型/描述模糊匹配', /category\.toLowerCase\(\).indexOf\(q\) >= 0/.test(errJs20) && /desc\.toLowerCase\(\).indexOf\(q\)/.test(errJs20) && /type\.indexOf\(q\) >= 0/.test(errJs20));
  ok('err-search.js 名称命中优先排序（matchRank）', /matchRank\(/.test(errJs20) && /hits\.sort\(function \(a, b\) \{/.test(errJs20));
  ok('err-search.js 结果仍限制 6 条', /slice\(0, 6\)/.test(errJs20));
  ok('err-search.js 非名称命中给上下文提示', /err-result-hint/.test(errJs20) && /matchHint\(p, lastQ\)/.test(errJs20));
  ok('err-search.js 描述命中截取上下文', /desc\.slice\(/.test(errJs20));
  const style20 = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
  ok('style.css 含 .err-result-hint 样式', /\.err-result-hint\s*\{/.test(style20));
  const i18n20 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  for (const k of ['err.matchCat', 'err.matchType', 'err.matchDesc']) {
    const n = (i18n20.match(new RegExp("'" + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  // 运行时：公开 products 接口确实带 category/desc（模糊匹配的数据基础）
  const prods20 = await (await req('/api/products')).res.json().catch(() => []);
  ok('/api/products 返回含 category 字段', Array.isArray(prods20) && prods20.some((p) => p.category), '产品数=' + (Array.isArray(prods20) ? prods20.length : 'N/A'));
  ok('/api/products 返回含 desc 字段', Array.isArray(prods20) && prods20.some((p) => p.desc));

  /* [21] 管理员角色编辑 / 账号删除（防锁死保护） */
  section('[21] 管理员角色编辑与账号删除');
  const adm21User = 'smoketest_adm_' + Date.now();
  const adm21Base = { headers: { Authorization: 'Bearer ' + bt } };
  const adm21List = await (await req('/api/admin/admins', adm21Base)).res.json().catch(() => []);
  const selfAdm21 = (adm21List || []).find((a) => a.username === 'admin');
  // 防锁死断言必须在创建测试账号前执行：否则库里已有第二个 admin，降级自己不会被拦。
  // 若断言失败（真实降级成功），立即把 admin 恢复为 admin 角色兜底，避免污染运行库。
  if (selfAdm21 && (adm21List || []).filter((x) => x.role === 'admin').length === 1) {
    const demoteSelf = await status('/api/admin/admins/' + selfAdm21.id, { method: 'PUT', headers: bH, body: JSON.stringify({ role: 'viewer' }) });
    ok('唯一 admin 不可降级（防锁死）→ 400', demoteSelf === 400, String(demoteSelf));
    if (demoteSelf === 200) await status('/api/admin/admins/' + selfAdm21.id, { method: 'PUT', headers: bH, body: JSON.stringify({ role: 'admin' }) });
  }
  const a21 = await (await req('/api/admin/admins', { method: 'POST', headers: bH, body: JSON.stringify({ username: adm21User, password: 'smoketest-pass', role: 'admin' }) })).res;
  ok('新增测试管理员 → 200/201', a21.status === 200 || a21.status === 201, String(a21.status));
  const a21j = await a21.json().catch(() => ({}));
  const adm21Id = a21j && a21j.id;
  let cleaned21 = false;
  const cleanup21 = async function () {
    if (cleaned21 || !adm21Id) return;
    cleaned21 = true;
    const listX = await (await req('/api/admin/admins', adm21Base)).res.json().catch(() => []);
    const recX = (listX || []).find((x) => x.id === adm21Id);
    if (recX) await status('/api/admin/admins/' + adm21Id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } });
  };
  try {
    if (adm21Id) {
      const putV = await status('/api/admin/admins/' + adm21Id, { method: 'PUT', headers: bH, body: JSON.stringify({ role: 'viewer' }) });
      ok('测试账号降级 viewer → 200', putV === 200, String(putV));
      const listV = await (await req('/api/admin/admins', adm21Base)).res.json().catch(() => []);
      const recV = (listV || []).find((x) => x.id === adm21Id);
      ok('降级后 role=viewer 生效', !!recV && recV.role === 'viewer', recV && recV.role);
      ok('非法角色 → 400', (await status('/api/admin/admins/' + adm21Id, { method: 'PUT', headers: bH, body: JSON.stringify({ role: 'boss' }) })) === 400);
      ok('角色未变幂等 → 200', (await status('/api/admin/admins/' + adm21Id, { method: 'PUT', headers: bH, body: JSON.stringify({ role: 'viewer' }) })) === 200);
      await status('/api/admin/admins/' + adm21Id, { method: 'PUT', headers: bH, body: JSON.stringify({ role: 'admin' }) });
    }
    if (selfAdm21) {
      ok('删除当前登录账号被拒 → 400', (await status('/api/admin/admins/' + selfAdm21.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } })) === 400);
    }
    ok('删除不存在账号 → 404', (await status('/api/admin/admins/999999', { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } })) === 404);
    ok('非法 id 删除 → 400', (await status('/api/admin/admins/abc', { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } })) === 400);
    if (adm21Id) {
      const delT = await status('/api/admin/admins/' + adm21Id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } });
      ok('删除测试账号 → 200', delT === 200, String(delT));
      cleaned21 = true;
    }
  } finally {
    await cleanup21();
  }
  const admJs21 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  ok('admin.js 渲染角色下拉 select[data-role-set]', /data-role-set="' \+ a\.id/.test(admJs21));
  ok('admin.js 自身行禁用角色切换（isSelf disabled）', /isSelf \? ' disabled'/.test(admJs21));
  ok('admin.js 渲染删除按钮 data-del-admin', /data-del-admin="' \+ a\.id/.test(admJs21));
  ok('admin.js 角色切换走 showConfirm 二次确认', /showConfirm[\s\S]*admin\.roleConfirm/.test(admJs21) && /data-role-set[\s\S]*showConfirm/.test(admJs21));
  ok('admin.js 删除账号走 showConfirm 二次确认', /showConfirm[\s\S]*admin\.deleteConfirm/.test(admJs21));
  const routes21 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 含 PUT /admin/admins/:id', /router\.put\('\/admin\/admins\/:id'/.test(routes21));
  ok('routes.js 含 DELETE /admin/admins/:id', /router\.delete\('\/admin\/admins\/:id'/.test(routes21));
  ok('routes.js 防锁死保护（最后一个 admin 不可降级/删除）', /不能降级最后一个管理员/.test(routes21) && /不能删除最后一个管理员/.test(routes21));
  const i18n21 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  for (const k of ['admin.self', 'admin.deleteTitle', 'admin.deleteConfirm', 'admin.roleConfirm']) {
    const n = (i18n21.match(new RegExp("'" + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  ok('api.html 文档含 PUT /admin/admins/:id', /PUT/.test(fs.readFileSync(path.join(ROOT, 'api.html'), 'utf8')) && /\/api\/admin\/admins\/:id/.test(fs.readFileSync(path.join(ROOT, 'api.html'), 'utf8')));

  /* [22] PWA 新版本更新提示（SW 行为依赖浏览器，冒烟只做静态断言） */
  section('[22] PWA 新版本更新提示');
  const pwa22 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'pwa.js'), 'utf8');
  const sw22 = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const css22 = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
  ok('pwa.js 注册 SW 并监听 updatefound', /serviceWorker\.register\('\/sw\.js'\)/.test(pwa22) && /updatefound/.test(pwa22));
  ok('pwa.js 仅在被旧 SW 控制时提示（installed + controller）', /nw\.state === 'installed' && navigator\.serviceWorker\.controller/.test(pwa22));
  ok('pwa.js 暴露 window.checkPWAUpdate 手动检查', /window\.checkPWAUpdate\s*=/.test(pwa22) && /regRef\.update\(\)/.test(pwa22));
  ok('pwa.js 点击刷新发送 SKIP_WAITING 并 reload', /SKIP_WAITING/.test(pwa22) && /location\.reload\(\)/.test(pwa22));
  ok('pwa.js 语言切换时重翻译提示条', /gr:langchange/.test(pwa22));
  ok('pwa.js 定时自动探测新版本', /setInterval/.test(pwa22));
  ok('sw.js 处理 SKIP_WAITING 消息', /self\.addEventListener\('message'[\s\S]*SKIP_WAITING/.test(sw22) && /self\.skipWaiting\(\)/.test(sw22));
  ok('sw.js 仍保留 install skipWaiting + activate 清理', /self\.skipWaiting\(\)/.test(sw22) && /caches\.delete/.test(sw22));
  ok('style.css 含 .pwa-update-bar 与入场动画', /\.pwa-update-bar \{/.test(css22) && /pwa-bar-in/.test(css22));
  const i18n22 = i18n21;
  for (const k of ['pwa.update', 'pwa.refresh', 'pwa.close', 'btn.checkUpdate']) {
    const n = (i18n22.match(new RegExp("'" + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  const index22 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const download22 = fs.readFileSync(path.join(ROOT, 'download.html'), 'utf8');
  const contact22 = fs.readFileSync(path.join(ROOT, 'contact.html'), 'utf8');
  const product22 = fs.readFileSync(path.join(ROOT, 'product.html'), 'utf8');
  ok('index/download/contact/product 4 页均引用 pwa.js',
    index22.indexOf('assets/js/pwa.js') !== -1 &&
    download22.indexOf('assets/js/pwa.js') !== -1 &&
    contact22.indexOf('assets/js/pwa.js') !== -1 &&
    product22.indexOf('assets/js/pwa.js') !== -1);
  const admin22 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('admin.html 引用 pwa.js（检查更新入口依赖）', admin22.indexOf('assets/js/pwa.js') !== -1);
  ok('admin.html 系统信息面板含「检查更新」按钮', /id="check-update"/.test(admin22));
  ok('admin.js 绑定检查更新按钮调用 window.checkPWAUpdate', /check-update/.test(admJs21) && /window\.checkPWAUpdate/.test(admJs21));

  /* [23] 产品置顶/排序权重 */
  section('[23] 产品置顶/排序权重');
  const dbJs23 = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');
  ok('db.js 幂等迁移新增 products.sort 列', /migrateProductsSort/.test(dbJs23) && /ALTER TABLE products ADD COLUMN sort INTEGER NOT NULL DEFAULT 0/.test(dbJs23));
  const routes23 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 公开产品按 sort DESC 排序', /ORDER BY sort DESC, id/.test(routes23));
  ok('routes.js 后台产品按 p.sort DESC 排序', /ORDER BY p\.sort DESC, p\.id/.test(routes23));
  ok('routes.js sort 服务端校验（整数 + 范围）', /排序权重须为整数/.test(routes23) && /排序权重范围 -9999 ~ 9999/.test(routes23));
  ok('routes.js 新增/编辑产品写入 sort', /VALUES \(.,.,.,.,.,.,.,.,'on',.,.,.\)/.test(routes23) && /sort=./.test(routes23));
  const adminJs23 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  const adminHtml23 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('admin.js 表单提交携带 sort 权重', /getElementById\('f-sort'\)/.test(adminJs23) && /sort: \(function/.test(adminJs23));
  ok('admin.js 客户端校验 sort 整数与范围', /排序权重须为整数/.test(adminJs23) && /排序权重范围 -9999 ~ 9999/.test(adminJs23));
  ok('admin.js 表格渲染排序列（sort-cell）', /sort-cell/.test(adminJs23));
  ok('admin.js 编辑回填 f-sort 值', /getElementById\('f-sort'\)\.value = p\.sort/.test(adminJs23));
  ok('admin.html 表单含排序权重输入（number + min/max）', /id="f-sort" type="number" step="1" min="-9999" max="9999"/.test(adminHtml23));
  ok('admin.html 表格含排序表头', /col\.sort/.test(adminHtml23));
  const i18n23 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  for (const k of ['f.sort', 'f.sortPh', 'col.sort']) {
    const n = (i18n23.match(new RegExp("'" + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  // 运行时：建 3 个不同权重产品，验证公开接口按 sort DESC 返回；非法权重被拒；后台接口带 sort 字段
  const sortTag = '冒烟排序_' + Date.now();
  const sortNames = [sortTag + '_high', sortTag + '_mid', sortTag + '_low'];
  const sortVals = [500, 100, -10];
  const sortIds = [];
  try {
    for (let i = 0; i < sortNames.length; i++) {
      const r = await req('/api/admin/products', { method: 'POST', headers: bH, body: JSON.stringify({ name: sortNames[i], type: 'app', category: '效率', desc: 'sort-test', sort: sortVals[i] }) });
      const j = await r.res.json().catch(() => ({}));
      if (r.res && (r.res.status === 200 || r.res.status === 201)) sortIds.push(j.id);
    }
    ok('创建 3 个不同权重测试产品', sortIds.length === 3, 'ids=' + sortIds.join(','));
    const pubSort = await (await req('/api/products')).res.json().catch(() => []);
    const mine = (Array.isArray(pubSort) ? pubSort : []).filter((p) => sortIds.indexOf(p.id) !== -1);
    ok('公开接口按 sort DESC 排序（500>100>-10）',
      mine.length === 3 && mine[0].sort === 500 && mine[1].sort === 100 && mine[2].sort === -10,
      mine.map((m) => m.id + ':' + m.sort).join(' '));
    const admSort = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
    const mineAdm = (Array.isArray(admSort) ? admSort : []).filter((p) => sortIds.indexOf(p.id) !== -1);
    ok('后台接口返回 sort 字段', mineAdm.length === 3 && mineAdm.every((p) => typeof p.sort === 'number'));
    ok('非法 sort（非整数）→ 400', (await status('/api/admin/products', { method: 'POST', headers: bH, body: JSON.stringify({ name: sortTag + '_bad', type: 'app', sort: 'abc' }) })) === 400);
    ok('越界 sort（>9999）→ 400', (await status('/api/admin/products', { method: 'POST', headers: bH, body: JSON.stringify({ name: sortTag + '_bad2', type: 'app', sort: 10000 }) })) === 400);
    if (sortIds.length === 3) {
      const editR = await status('/api/admin/products/' + sortIds[0], { method: 'PUT', headers: bH, body: JSON.stringify({ sort: 999 }) });
      ok('编辑 sort 权重 → 200', editR === 200, String(editR));
      const afterEdit = await (await req('/api/products')).res.json().catch(() => []);
      const m2 = (Array.isArray(afterEdit) ? afterEdit : []).filter((p) => sortIds.indexOf(p.id) !== -1);
      ok('编辑后置顶生效（999 最前）', m2.length === 3 && m2[0].id === sortIds[0] && m2[0].sort === 999,
        m2.map((m) => m.id + ':' + m.sort).join(' '));
    }
  } finally {
    for (const id of sortIds) {
      await status('/api/admin/products/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } });
    }
  }
  const cleaned23 = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
  const remains23 = (Array.isArray(cleaned23) ? cleaned23 : []).filter((p) => (p.name || '').indexOf('冒烟排序_') === 0 || (p.name || '').indexOf(sortTag) === 0);
  ok('清理排序测试产品', remains23.length === 0, '残留 ' + remains23.length + ' 条');

  /* [24] 流量趋势（可切换天数） */
  section('[24] 流量趋势（可切换天数）');
  const routes24 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 新增 /admin/stats/trend 端点', /router\.get\('\/admin\/stats\/trend'/.test(routes24));
  ok('routes.js days 钳制 1~90 且默认 14', /days < 1 \|\| days > 90/.test(routes24) && /days = 14/.test(routes24));
  ok('routes.js trend 返回区间合计 total', /total: \{ visits, downloads \}/.test(routes24));
  ok('routes.js bucketDaily SQL 聚合（localtime 分组）', /strftime\('%Y-%m-%d', ts\/1000, 'unixepoch', 'localtime'\)/.test(routes24) && /GROUP BY d/.test(routes24));
  const adminJs24 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  const adminHtml24 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const style24 = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
  ok('admin.js 趋势独立加载 loadTrend/applyTrend', /function loadTrend\(\)/.test(adminJs24) && /function applyTrend\(t\)/.test(adminJs24));
  ok('admin.js 天数预设 7/14/30 与切换', /TREND_PRESETS = \[7, 14, 30\]/.test(adminJs24) && /data-days/.test(adminJs24) && /trendDays = n/.test(adminJs24));
  ok('admin.js 标题与合计行动态渲染', /trend-title/.test(adminJs24) && /replace\('\{n\}'/.test(adminJs24) && /trend-total/.test(adminJs24) && /trend\.total'\)/.test(adminJs24));
  ok('admin.js 语言切换重渲染趋势', /if \(lastTrend\) \{ try \{ renderTrendDays\(\); applyTrend\(lastTrend\);/.test(adminJs24));
  ok('admin.js 已移除旧 lastDaily 重绘', !/lastDaily/.test(adminJs24));
  ok('admin.html 含天数切换按钮组与合计行', /id="trend-days"/.test(adminHtml24) && /id="trend-total"/.test(adminHtml24) && /id="trend-title"/.test(adminHtml24));
  ok('style.css 含 .trend-days/.td-btn/.trend-total', /\.trend-days/.test(style24) && /\.td-btn\.on/.test(style24) && /\.trend-total/.test(style24));
  const i18n24 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  for (const k of ['trend.days', 'trend.dayUnit', 'trend.total']) {
    const n = (i18n24.match(new RegExp("'" + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  ok('i18n panel.trend 已去固定 14 天文案', !/流量趋势（近 14 天）/.test(i18n24) && !/Traffic \(last 14 days\)/.test(i18n24));
  // 运行时：结构、长度、钳制、合计一致；stats 兼容仍含 14 天 daily
  const trendH = { headers: { Authorization: 'Bearer ' + bt } };
  const t7 = await (await req('/api/admin/stats/trend?days=7', trendH)).res.json().catch(() => null);
  ok('trend?days=7 返回 7 天', t7 && t7.days === 7 && Array.isArray(t7.range) && t7.range.length === 7);
  const t90 = await (await req('/api/admin/stats/trend?days=90', trendH)).res.json().catch(() => null);
  ok('trend?days=90 返回 90 天', t90 && t90.range && t90.range.length === 90);
  const tClamp = await (await req('/api/admin/stats/trend?days=9999', trendH)).res.json().catch(() => null);
  ok('trend?days=9999 钳制为默认 14', tClamp && tClamp.days === 14 && tClamp.range && tClamp.range.length === 14);
  const tBad = await (await req('/api/admin/stats/trend?days=abc', trendH)).res.json().catch(() => null);
  ok('trend?days=abc 钳制为默认 14', tBad && tBad.days === 14);
  const tSum = t7 && t7.range.every((d) => typeof d.visits === 'number' && typeof d.downloads === 'number' && d.date);
  const tTotalOk = t7 && t7.total &&
    t7.total.visits === t7.range.reduce((a, d) => a + d.visits, 0) &&
    t7.total.downloads === t7.range.reduce((a, d) => a + d.downloads, 0);
  ok('trend 每项结构合法且 total = 区间求和', !!tSum && !!tTotalOk);
  ok('trend 未带 token → 401', (await status('/api/admin/stats/trend?days=7')) === 401);
  const stats24 = await (await req('/api/admin/stats', trendH)).res.json().catch(() => null);
  ok('stats 兼容：仍返回 14 天 daily', stats24 && stats24.daily && stats24.daily.length === 14);

  /* [25] 审计/访问日志服务端分页与筛选 */
  section('[25] 审计/访问日志服务端分页与筛选');
  const routes25 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js audit 分页（page/pageSize 钳制）', /router\.get\('\/admin\/audit'/.test(routes25) && /Math\.min\(100, Math\.max\(1, parseInt\(req\.query\.pageSize/.test(routes25));
  ok('routes.js audit 关键词 LIKE（action/detail/ip）', /action LIKE \? OR detail LIKE \? OR ip LIKE \?/.test(routes25));
  ok('routes.js audit action 精确筛选 + 返回 {rows,total}', /where\.push\('action = \?'\)/.test(routes25) && /res\.json\(\{ rows, total \}\)/.test(routes25));
  const adminJs25 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  const adminHtml25 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const style25 = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
  ok('admin.js loadAudit 服务端分页参数', /\/admin\/audit' \+ qs/.test(adminJs25) && /pageSize=' \+ AUDIT_PAGE_SIZE/.test(adminJs25));
  ok('admin.js 末页回退与分页渲染', /auditPage--;\s*\n\s*return loadAudit\(\{ keepPage: true \}\)/.test(adminJs25) && /function renderAuditPager\(\)/.test(adminJs25));
  ok('admin.js 审计搜索防抖 + action 筛选重置页码', /auditSearchTimer/.test(adminJs25) && /auditAction = auditActionSel\.value === 'all' \? '' :/.test(adminJs25));
  ok('admin.js 访问日志行数切换', /accessLogLines/.test(adminJs25) && /accesslog-lines/.test(adminJs25));
  ok('admin.html 审计筛选/分页/日志行数控件', /id="audit-search"/.test(adminHtml25) && /id="audit-action"/.test(adminHtml25) && /id="audit-pager"/.test(adminHtml25) && /id="accesslog-lines"/.test(adminHtml25));
  ok('style.css 含 .audit-tools/.filter-select', /\.audit-tools/.test(style25) && /\.filter-select/.test(style25));
  const i18n25 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  const nAudit = (i18n25.match(/'search\.audit'/g) || []).length;
  ok('i18n 含 6 语言 key: search.audit', nAudit === 6, '实际 ' + nAudit + ' 处');
  // 运行时：audit 只读不改，无清理需求
  const aAudit1 = await (await req('/api/admin/audit?page=1&pageSize=10', trendH)).res.json().catch(() => null);
  ok('audit 分页返回 {rows,total} 且每页 ≤10', aAudit1 && Array.isArray(aAudit1.rows) && aAudit1.rows.length <= 10 && typeof aAudit1.total === 'number' && aAudit1.total >= 1,
    aAudit1 ? 'rows=' + aAudit1.rows.length + ' total=' + aAudit1.total : 'null');
  const aLogin = await (await req('/api/admin/audit?action=login&pageSize=50', trendH)).res.json().catch(() => null);
  ok('audit action=login 精确筛选', aLogin && aLogin.rows.length > 0 && aLogin.rows.every((r) => r.action === 'login'));
  const uniqKw = 'zzz_not_exist_' + Date.now();
  const aKw = await (await req('/api/admin/audit?keyword=' + uniqKw, trendH)).res.json().catch(() => null);
  ok('audit 无命中关键词 → total=0', aKw && aKw.total === 0 && aKw.rows.length === 0);
  const aClamp = await (await req('/api/admin/audit?pageSize=999', trendH)).res.json().catch(() => null);
  ok('audit pageSize=999 钳制为 100', aClamp && Array.isArray(aClamp.rows) && aClamp.rows.length <= 100);
  const aBig = await (await req('/api/admin/audit?page=99999', trendH)).res.json().catch(() => null);
  ok('audit 页码越界 → 空列表但 total 正确', aBig && Array.isArray(aBig.rows) && aBig.rows.length === 0 && typeof aBig.total === 'number' && aBig.total >= 1);
  ok('audit 未带 token → 401', (await status('/api/admin/audit')) === 401);
  const al500 = await (await req('/api/admin/accesslog?lines=500', trendH)).res.json().catch(() => null);
  ok('accesslog lines=500 返回 ≤500 行', al500 && Array.isArray(al500.lines) && al500.lines.length <= 500, al500 ? 'lines=' + al500.lines.length : 'null');
  const alBad = await (await req('/api/admin/accesslog?lines=abc', trendH)).res.json().catch(() => null);
  ok('accesslog lines=abc 回退默认 100', alBad && Array.isArray(alBad.lines) && alBad.lines.length <= 100);

  /* [26] 产品分类后台维护（自由输入 → 后台维护枚举） */
  section('[26] 产品分类后台维护');
  const dbJs26 = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');
  ok('db.js 建 categories 表（name 唯一）', /CREATE TABLE IF NOT EXISTS categories[\s\S]*name TEXT NOT NULL UNIQUE/.test(dbJs26));
  ok('db.js 空表时从产品分类回填 + 补齐常用分类', /migrateCategories/.test(dbJs26) && /SELECT DISTINCT category FROM products/.test(dbJs26));
  const routes26 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 公开 GET /api/categories', /router\.get\('\/categories'/.test(routes26) && /FROM categories ORDER BY id/.test(routes26));
  ok('routes.js 后台分类 CRUD（GET/POST/PUT/DELETE /admin/categories）',
    /router\.get\('\/admin\/categories'/.test(routes26) &&
    /router\.post\('\/admin\/categories'/.test(routes26) &&
    /router\.put\('\/admin\/categories\/:id'/.test(routes26) &&
    /router\.delete\('\/admin\/categories\/:id'/.test(routes26));
  ok('routes.js 分类写操作 requireAdmin + 审计', /category_add|category_rename|category_delete/.test(routes26));
  ok('routes.js 分类名校验（长度/字符集/重复 409）', /normalizeCategoryName/.test(routes26) && /分类已存在/.test(routes26));
  ok('routes.js 重命名同步更新引用产品（防孤儿）', /UPDATE products SET category=\? WHERE category=\?/.test(routes26));
  ok('routes.js 使用中分类不可删除（409）', /COUNT\(\*\) AS c FROM products WHERE category=\?/.test(routes26) && /无法删除/.test(routes26));
  ok('routes.js 产品分类枚举校验（不在枚举 → 400）', /分类须为后台分类枚举中的项/.test(routes26));
  const adminJs26 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  const adminHtml26 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const style26 = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
  ok('admin.html 分类面板（新增表单 + 列表 + 刷新）', /id="cat-add-form"/.test(adminHtml26) && /id="cat-list"/.test(adminHtml26) && /id="refresh-categories"/.test(adminHtml26));
  ok('admin.html 产品表单分类为枚举下拉 select', /<select id="f-category">/.test(adminHtml26));
  ok('admin.js loadCategories + renderCategories + 枚举下拉', /function loadCategories/.test(adminJs26) && /function renderCategories/.test(adminJs26) && /allCats\.map/.test(adminJs26));
  ok('admin.js 分类新增/重命名/删除（行内编辑 + 二次确认）', /cat-add-form/.test(adminJs26) && /startCatRename/.test(adminJs26) && /cat\.confirmDel/.test(adminJs26));
  ok('admin.js 分类变更后刷新产品列表', /loadCategories\(\);\s*\n?\s*loadProducts\(\)/.test(adminJs26));
  ok('style.css 含 .cat-list/.cat-row/.cat-rename-input', /\.cat-list/.test(style26) && /\.cat-row/.test(style26) && /\.cat-rename-input/.test(style26));
  const mainJs26 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'main.js'), 'utf8');
  ok('main.js 下载页分类下拉取自 /api/categories（含兜底）', /API \+ '\/categories'/.test(mainJs26) && /fallback/.test(mainJs26));
  const i18n26 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  for (const k of ['panel.categories', 'cat.add', 'cat.rename', 'cat.delete', 'cat.confirmDel', 'cat.none', 'cat.empty']) {
    const n = (i18n26.match(new RegExp("'" + k + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  // 运行时：分类 CRUD + 枚举强制 + viewer 403 + 公开枚举数据源
  const catName = '冒烟分类_' + Date.now();
  const catName2 = catName + '_改';
  const catH = { Authorization: 'Bearer ' + bt, 'Content-Type': 'application/json' };
  const catPub = await (await req('/api/categories')).res.json().catch(() => []);
  ok('公开 /api/categories 返回枚举且含种子分类', Array.isArray(catPub) && catPub.length >= 3 && catPub.some((c) => c && c.name === '效率'),
    Array.isArray(catPub) ? catPub.length + ' 个' : 'null');
  const cNew = await (await req('/api/admin/categories', { method: 'POST', headers: catH, body: JSON.stringify({ name: catName }) })).res.json().catch(() => null);
  ok('新增分类 → 返回 id', !!cNew && typeof cNew.id === 'number', cNew ? 'id=' + cNew.id : 'null');
  const catId = cNew && cNew.id;
  ok('重复新增同分类 → 409', (await status('/api/admin/categories', { method: 'POST', headers: catH, body: JSON.stringify({ name: catName }) })) === 409);
  ok('空分类名 → 400', (await status('/api/admin/categories', { method: 'POST', headers: catH, body: JSON.stringify({ name: '  ' }) })) === 400);
  ok('产品分类不在枚举 → 400', (await status('/api/admin/products', { method: 'POST', headers: catH, body: JSON.stringify({ name: '冒烟枚举_未知分类', type: 'app', category: '不存在的分类_xyz' }) })) === 400);
  let tmpProdId = null;
  let cleaned26 = false;
  const cleanup26 = async function () {
    if (cleaned26) return;
    cleaned26 = true;
    if (tmpProdId) await status('/api/admin/products/' + tmpProdId, { method: 'DELETE', headers: catH });
    if (catId) await status('/api/admin/categories/' + catId, { method: 'DELETE', headers: catH });
  };
  try {
    if (catId) {
      const pNew = await (await req('/api/admin/products', { method: 'POST', headers: catH, body: JSON.stringify({ name: '冒烟枚举_用新分类', type: 'app', category: catName }) })).res.json().catch(() => null);
      ok('枚举分类可用于产品（新增成功）', !!pNew && typeof pNew.id === 'number', pNew ? 'id=' + pNew.id : 'null');
      tmpProdId = pNew && pNew.id;
      ok('使用中分类删除 → 409', (await status('/api/admin/categories/' + catId, { method: 'DELETE', headers: catH })) === 409);
      ok('重命名分类 → 200', (await status('/api/admin/categories/' + catId, { method: 'PUT', headers: catH, body: JSON.stringify({ name: catName2 }) })) === 200);
      if (tmpProdId) {
        const pRec = await (await req('/api/admin/products', { headers: catH })).res.json().catch(() => []);
        const rec = (pRec || []).find((p) => p.id === tmpProdId);
        ok('重命名后产品分类同步为 new 名', !!rec && rec.category === catName2, rec && rec.category);
      }
      ok('重命名为已存在分类 → 409', (await status('/api/admin/categories/' + catId, { method: 'PUT', headers: catH, body: JSON.stringify({ name: '效率' }) })) === 409);
      if (tmpProdId) {
        ok('删除使用该分类的产品 → 200', (await status('/api/admin/products/' + tmpProdId, { method: 'DELETE', headers: catH })) === 200);
        tmpProdId = null;
      }
      ok('无产品使用后删除分类 → 200', (await status('/api/admin/categories/' + catId, { method: 'DELETE', headers: catH })) === 200);
      cleaned26 = true;
    }
    // viewer 角色：写分类 → 403（需登录为 viewer）
    const vUser = 'smoketest_viewer_' + Date.now();
    const vLogin = await (await req('/api/admin/admins', { method: 'POST', headers: catH, body: JSON.stringify({ username: vUser, password: 'smoketest-pass', role: 'viewer' }) })).res;
    const vLoginJ = await vLogin.json().catch(() => ({}));
    const vId = vLoginJ && vLoginJ.id;
    const vTok = await (await req('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: vUser, password: 'smoketest-pass' }) })).res.json().catch(() => ({}));
    const vH = { Authorization: 'Bearer ' + (vTok && vTok.token), 'Content-Type': 'application/json' };
    if (vId && vTok && vTok.token) {
      ok('viewer 写分类 → 403', (await status('/api/admin/categories', { method: 'POST', headers: vH, body: JSON.stringify({ name: 'viewer_should_block' }) })) === 403);
      await status('/api/admin/admins/' + vId, { method: 'DELETE', headers: catH });
    }
    const catPub2 = await (await req('/api/categories')).res.json().catch(() => []);
    ok('分类增删后 /api/categories 仍可用', Array.isArray(catPub2) && catPub2.length >= 3);
  } finally {
    await cleanup26();
  }

  /* [27] 产品大图/缩略图（image 字段 + 校验 + 渲染 + 预缓存） */
  section('[27] 产品大图/缩略图');
  const dbJs27 = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');
  ok('db.js products 含 image 字段迁移（幂等）', /ALTER TABLE products ADD COLUMN image/.test(dbJs27) && /migrateProductsImage/.test(dbJs27));
  ok('db.js 迁移回填种子产品大图（仅空时）', /UPDATE products SET image=\? WHERE name=\? AND image=''/.test(dbJs27));
  const routes27 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 公开/后台产品查询均含 image 字段', /SELECT id, name, type, category, desc, icon, image, download_url/.test(routes27));
  ok('routes.js 定义 validProductImage 校验', /function validProductImage/.test(routes27) && /\/assets\/img\//.test(routes27));
  ok('routes.js 新增/编辑产品写 image', /VALUES \(.,.,.,.,.,.,.,.,'on',.,.,.\)/.test(routes27) &&
    /SET name=., type=., category=., desc=., icon=., image=./.test(routes27));
  const adminJs27 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  const adminHtml27 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('admin.html 产品表单含 image 输入', /id="f-image"/.test(adminHtml27));
  ok('admin.js 提交读取 image 字段', /getElementById\('f-image'\)\.value/.test(adminJs27));
  ok('admin.js 客户端 image 校验（禁 javascript:/data:）', /f\.image &&\s*!\/\^https\?:\\\/\\\/\/i\.test/.test(adminJs27) || /image\.length > 500/.test(adminJs27));
  ok('admin.js 编辑回填 image', /getElementById\('f-image'\)\.value = p\.image/.test(adminJs27));
  const mainJs27 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'main.js'), 'utf8');
  ok('main.js 卡片渲染大图（懒加载 + 回退 emoji）', /class="pimg"/.test(mainJs27) && /loading="lazy"/.test(mainJs27) && /pmedia/.test(mainJs27));
  const productJs27 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'product.js'), 'utf8');
  ok('product.js 详情页渲染大图', /class="pd-img"/.test(productJs27) && /pd-icon/.test(productJs27));
  const style27 = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
  ok('style.css 含 .pmedia/.pimg/.picon-mini/.pd-img', /\.product-card \.pmedia/.test(style27) && /\.pimg/.test(style27) && /\.picon-mini/.test(style27) && /\.pd-img/.test(style27));
  const sw27 = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  ok('sw.js 预缓存全部产品图', ['note', 'team', 'cloud', 'password', 'space', 'candy', 'racing', 'pixel'].every((n) => sw27.indexOf('/assets/img/products/' + n + '.jpg') !== -1));
  for (const n of ['note', 'team', 'cloud', 'password', 'space', 'candy', 'racing', 'pixel']) {
    ok('产品图文件存在 ' + n + '.jpg', fs.existsSync(path.join(ROOT, 'assets', 'img', 'products', n + '.jpg')));
  }
  const i18n27 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  for (const k of ['f.image', 'f.imagePh']) {
    const n = (i18n27.match(new RegExp("'" + k + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  // 运行时：image 校验 + 空值回退 + 合法值写入
  const imgH = { Authorization: 'Bearer ' + bt, 'Content-Type': 'application/json' };
  ok('image: javascript: 链接新增 → 400', (await status('/api/admin/products', { method: 'POST', headers: imgH, body: JSON.stringify({ name: '冒烟图_js', type: 'app', image: 'javascript:alert(1)' }) })) === 400);
  ok('image: data: 链接新增 → 400', (await status('/api/admin/products', { method: 'POST', headers: imgH, body: JSON.stringify({ name: '冒烟图_data', type: 'app', image: 'data:text/html,<b>x</b>' }) })) === 400);
  ok('image: 站外 http 链接新增 → 200/201', (await status('/api/admin/products', { method: 'POST', headers: imgH, body: JSON.stringify({ name: '冒烟图_http', type: 'app', image: 'https://example.com/x.jpg' }) })) === 200);
  const imgProdName = '冒烟图_站内_' + Date.now();
  const imgNew = await (await req('/api/admin/products', { method: 'POST', headers: imgH, body: JSON.stringify({ name: imgProdName, type: 'game', image: '/assets/img/products/note.jpg' }) })).res.json().catch(() => null);
  ok('image: 站内 /assets/img/ 路径新增 → 返回 id', !!imgNew && typeof imgNew.id === 'number', imgNew ? 'id=' + imgNew.id : 'null');
  let imgRec = null;
  if (imgNew && imgNew.id) {
    const imgList = await (await req('/api/products', { headers: {} })).res.json().catch(() => []);
    imgRec = (imgList || []).find((p) => p.id === imgNew.id);
    ok('公开 /api/products 返回 image 字段', !!imgRec && imgRec.image === '/assets/img/products/note.jpg', imgRec && imgRec.image);
  }
  ok('image: 空值新增 → 200/201（回退 emoji）', (await status('/api/admin/products', { method: 'POST', headers: imgH, body: JSON.stringify({ name: '冒烟图_空', type: 'app' }) })) === 200);
  // 清理全部测试产品（含成功创建的 http/空/站内 用例）
  const imgList2 = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
  const imgLeftIds = (imgList2 || []).filter((p) => (p.name || '').indexOf('冒烟图_') === 0).map((p) => p.id);
  for (const id of imgLeftIds) { await status('/api/admin/products/' + id, { method: 'DELETE', headers: imgH }); }
  const imgList3 = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
  const imgLeft = (imgList3 || []).filter((p) => (p.name || '').indexOf('冒烟图_') === 0);
  ok('测试产品已清理', imgLeft.length === 0, imgLeft.length + ' 条残留');

  /* [28] 全站 <img> 响应式（srcset/sizes） */
  section('[28] 全站 <img> 响应式（srcset/sizes）');
  const mainJs28 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'main.js'), 'utf8');
  const productJs28 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'product.js'), 'utf8');
  ok('main.js 定义 srcsetList（站内图生成 -sm 变体，外链空串）', /function srcsetList\(src\)[\s\S]*?charAt\(0\) !== '\/'/.test(mainJs28) && /-sm\$1/.test(mainJs28) && /IMG_SM_W/.test(mainJs28));
  ok('main.js 定义卡片 sizes 断点（1000/700px + 视口兜底）', /IMG_CARD_SIZES = '\(min-width: 1000px\) 354px, \(min-width: 700px\) 46vw/.test(mainJs28));
  ok('main.js 下载页卡片渲染 srcset/sizes', /cardHTML[\s\S]*?srcset="' \+ ss/.test(mainJs28) && /sizes="' \+ IMG_CARD_SIZES/.test(mainJs28));
  ok('main.js 首页卡片渲染 srcset/sizes', /homeCardHTML[\s\S]*?srcset="' \+ ss/.test(mainJs28) && /sizes="' \+ IMG_CARD_SIZES/.test(mainJs28));
  ok('main.js 详情弹窗填充 srcset/sizes（外链清空）', /pim\.srcset = srcsetList\(p\.image\)/.test(mainJs28) && /pim\.sizes = pim\.srcset \? IMG_MODAL_SIZES/.test(mainJs28));
  ok('product.js 详情页大图 srcset/sizes（220px 固定宽）', /class="pd-img" src="' \+ esc\(p\.image\)[\s\S]*?sizes="220px"/.test(productJs28) && /-sm\$1/.test(productJs28));
  const sw28 = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  ok('sw.js 预缓存 8 张 480w 缩略图', ['note', 'team', 'cloud', 'password', 'space', 'candy', 'racing', 'pixel'].every((n) => sw28.indexOf('/assets/img/products/' + n + '-sm.jpg') !== -1));
  for (const n of ['note', 'team', 'cloud', 'password', 'space', 'candy', 'racing', 'pixel']) {
    ok('缩略图文件存在 ' + n + '-sm.jpg', fs.existsSync(path.join(ROOT, 'assets', 'img', 'products', n + '-sm.jpg')));
  }
  const smOk = await req('/assets/img/products/note-sm.jpg');
  ok('缩略图可被访问 → 200', !!smOk.res && smOk.res.status === 200, smOk.res ? String(smOk.res.status) : 'ERR');
  const smType = smOk.res && smOk.res.headers.get('content-type') || '';
  ok('缩略图响应为图片类型', smType.indexOf('image/') === 0, smType || '无 Content-Type');
  const smBody = smOk.res ? Buffer.from(await smOk.res.arrayBuffer()) : Buffer.alloc(0);
  ok('缩略图响应体为合法 JPEG（FFD8 头）', smBody.length > 2 && smBody[0] === 0xFF && smBody[1] === 0xD8, smBody.length + ' 字节');
  const smSmall = fs.statSync(path.join(ROOT, 'assets', 'img', 'products', 'note-sm.jpg')).size;
  const smBig = fs.statSync(path.join(ROOT, 'assets', 'img', 'products', 'note.jpg')).size;
  ok('缩略图比原图更小（省流量前提）', smSmall < smBig, smSmall + 'B vs ' + smBig + 'B');

  /* [29] 合规基础页（隐私政策 / 服务条款 / robots / sitemap） */
  section('[29] 合规基础页（隐私政策 / 服务条款 / robots / sitemap）');
  const privacy29 = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
  const terms29 = fs.readFileSync(path.join(ROOT, 'terms.html'), 'utf8');
  ok('privacy.html 存在且含 legal 正文区', /class="legal reveal"/.test(privacy29) && /生效日期：2026-09-10/.test(privacy29));
  ok('privacy.html 声明收集信息（表单/日志/本地存储）', /联系表单/.test(privacy29) && /访问日志/.test(privacy29) && /本地存储/.test(privacy29));
  ok('privacy.html 声明不向第三方出售/无第三方统计', /不会.*第三方.*出售/.test(privacy29) && /第三方统计、广告或社交追踪脚本/.test(privacy29));
  ok('privacy.html 含用户权利与联系方式', /查询、更正或删除/.test(privacy29) && /未成年人保护/.test(privacy29));
  ok('terms.html 存在且含 legal 正文区', /class="legal reveal"/.test(terms29) && /生效日期：2026-09-10/.test(terms29));
  ok('terms.html 覆盖知识产权/行为规范/免责/争议解决', /知识产权/.test(terms29) && /用户行为规范/.test(terms29) && /免责声明/.test(terms29) && /法律适用与争议解决/.test(terms29));
  const style29 = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
  ok('style.css 含 .legal 排版样式', /\.legal \{/.test(style29) && /\.legal h2/.test(style29));
  const srv29 = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  ok('server.js robots.txt 禁爬 /downloads/ 且含 Sitemap', /Disallow: \/downloads\/\\n/.test(srv29) && /Sitemap: ' \+ SITE \+ '\/sitemap\.xml/.test(srv29));
  ok('server.js sitemap 收录 privacy/terms', /SITE \+ '\/privacy\.html'/.test(srv29) && /SITE \+ '\/terms\.html'/.test(srv29));
  for (const f of ['index.html', 'download.html', 'contact.html', 'product.html', 'api.html']) {
    const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
    ok(f + ' 页脚含隐私/条款链接', /href="privacy\.html" data-i18n="footer\.privacy"/.test(h) && /href="terms\.html" data-i18n="footer\.terms"/.test(h));
  }
  const i18n29 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  for (const k of ['footer.privacy', 'footer.terms', 'legal.privacyTitle', 'legal.privacySub', 'legal.termsTitle', 'legal.termsSub']) {
    const n = (i18n29.match(new RegExp("'" + k + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  ok('GET /privacy.html → 200', (await status('/privacy.html')) === 200);
  ok('GET /terms.html → 200', (await status('/terms.html')) === 200);
  const robots29 = await (await req('/robots.txt')).res.text().catch(() => '');
  ok('robots.txt 含 Disallow /downloads/ 与 Sitemap', robots29.indexOf('Disallow: /downloads/') !== -1 && robots29.indexOf('Sitemap:') !== -1, robots29.split('\n')[0] || '空');
  const sitemap29 = await (await req('/sitemap.xml')).res.text().catch(() => '');
  ok('sitemap.xml 含 privacy/terms 条目', sitemap29.indexOf('privacy.html') !== -1 && sitemap29.indexOf('terms.html') !== -1);

  /* [30] 产品更新日志（version / changelog） */
  section('[30] 产品更新日志（version / changelog）');
  const dbJs30 = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');
  ok('db.js products 含 version/changelog 字段迁移（幂等）', /migrateProductsVersion/.test(dbJs30) && /ADD COLUMN version/.test(dbJs30) && /ADD COLUMN changelog/.test(dbJs30));
  ok('db.js 迁移回填种子版本/更新日志（仅 version 空时）', /UPDATE products SET version=\?, changelog=\? WHERE name=\? AND version=''/.test(dbJs30));
  const routes30 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 公开产品查询含 version/changelog', /image, download_url, version, changelog, sort, \(SELECT/.test(routes30));
  ok('routes.js 详情查询含 version/changelog', /download_url, version, changelog, \(SELECT/.test(routes30));
  ok('routes.js normalizeProduct 解析 version/changelog', /var version = b\.version !== undefined/.test(routes30) && /var changelog = b\.changelog !== undefined/.test(routes30));
  ok('routes.js 服务端校验版本/日志长度', /版本号过长（≤30 字符）/.test(routes30) && /更新日志过长（≤2000 字符）/.test(routes30));
  ok('routes.js 新增/编辑产品写 version/changelog', /VALUES \(.,.,.,.,.,.,.,.,'on',.,.,.\)/.test(routes30) && /SET name=., type=., category=., desc=., icon=., image=., version=., changelog=./.test(routes30));
  const adminJs30 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  const adminHtml30 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('admin.html 产品表单含版本/更新日志输入', /id="f-version"/.test(adminHtml30) && /id="f-changelog"/.test(adminHtml30));
  ok('admin.html 表格含版本列', /col\.version/.test(adminHtml30));
  ok('admin.js 提交读取 version/changelog', /getElementById\('f-version'\)\.value/.test(adminJs30) && /getElementById\('f-changelog'\)\.value/.test(adminJs30));
  ok('admin.js 客户端校验版本/日志长度', /版本号过长（≤30 字符）/.test(adminJs30) && /更新日志过长（≤2000 字符）/.test(adminJs30));
  ok('admin.js 表格渲染版本列（ver-cell）', /ver-cell/.test(adminJs30));
  ok('admin.js 编辑回填 f-version/f-changelog', /getElementById\('f-version'\)\.value = p\.version/.test(adminJs30) && /getElementById\('f-changelog'\)\.value = p\.changelog/.test(adminJs30));
  const productJs30 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'product.js'), 'utf8');
  ok('product.js 详情页渲染版本徽标 + 更新日志区', /class="pd-version"/.test(productJs30) && /class="pd-changelog reveal"/.test(productJs30) && /T\('pd\.changelog'/.test(productJs30));
  ok('product.js 动态 reveal 重新观察（详情可见性修复）', /function observeReveals\(\)/.test(productJs30) && /revealIo\.observe/.test(productJs30));
  const style30 = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
  ok('style.css 含 .pd-version/.pd-changelog 样式', /\.pd-version \{/.test(style30) && /\.pd-changelog \{/.test(style30));
  const i18n30 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  for (const k of ['f.version', 'f.versionPh', 'f.changelog', 'f.changelogPh', 'col.version', 'pd.changelog']) {
    const n = (i18n30.match(new RegExp("'" + k + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  // 运行时：合法写入 + 公开接口透出 + 编辑生效 + 超长被拒 + 种子回填 + 清理
  const vH = { Authorization: 'Bearer ' + bt, 'Content-Type': 'application/json' };
  const verTag = '冒烟日志_' + Date.now();
  const vNew = await (await req('/api/admin/products', { method: 'POST', headers: vH, body: JSON.stringify({ name: verTag, type: 'app', version: '3.2.1', changelog: 'v3.2.1 · 2026-09-01\n· 新增搜索\n· 修复崩溃' }) })).res.json().catch(() => null);
  ok('version/changelog 新增产品 → 返回 id', !!vNew && typeof vNew.id === 'number', vNew ? 'id=' + vNew.id : 'null');
  if (vNew && vNew.id) {
    const vList = await (await req('/api/products', { headers: {} })).res.json().catch(() => []);
    const vRec = (Array.isArray(vList) ? vList : []).find((p) => p.id === vNew.id);
    ok('公开 /api/products 返回 version/changelog', !!vRec && vRec.version === '3.2.1' && vRec.changelog.indexOf('新增搜索') !== -1, vRec && vRec.version);
    const vDet = await (await req('/api/products/' + vNew.id, { headers: {} })).res.json().catch(() => null);
    ok('公开 /api/products/:id 返回 version/changelog', !!vDet && vDet.version === '3.2.1' && vDet.changelog.indexOf('修复崩溃') !== -1, vDet && vDet.version);
    ok('编辑 version/changelog → 200', (await status('/api/admin/products/' + vNew.id, { method: 'PUT', headers: vH, body: JSON.stringify({ version: '3.2.2', changelog: 'v3.2.2 · 2026-09-10\n· 性能优化' }) })) === 200);
    const vDet2 = await (await req('/api/products/' + vNew.id, { headers: {} })).res.json().catch(() => null);
    ok('编辑后详情反映新版本', !!vDet2 && vDet2.version === '3.2.2' && vDet2.changelog.indexOf('性能优化') !== -1, vDet2 && vDet2.version);
  }
  ok('version 超长（>30）→ 400', (await status('/api/admin/products', { method: 'POST', headers: vH, body: JSON.stringify({ name: verTag + '_v', type: 'app', version: '1234567890123456789012345678901' }) })) === 400);
  ok('changelog 超长（>2000）→ 400', (await status('/api/admin/products', { method: 'POST', headers: vH, body: JSON.stringify({ name: verTag + '_c', type: 'app', changelog: 'x'.repeat(2001) }) })) === 400);
  const vAdm = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
  const vSeed = (Array.isArray(vAdm) ? vAdm : []).filter((p) => p.name === '效率笔记');
  ok('种子产品「效率笔记」已回填版本号', vSeed.length === 1 && !!vSeed[0].version, vSeed.length ? vSeed[0].version : '未找到');
  const vLeftIds = (Array.isArray(vAdm) ? vAdm : []).filter((p) => (p.name || '').indexOf('冒烟日志_') === 0).map((p) => p.id);
  for (const id of vLeftIds) { await status('/api/admin/products/' + id, { method: 'DELETE', headers: vH }); }
  const vAdm2 = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
  const vLeft = (Array.isArray(vAdm2) ? vAdm2 : []).filter((p) => (p.name || '').indexOf('冒烟日志_') === 0);
  ok('测试产品已清理', vLeft.length === 0, vLeft.length + ' 条残留');

  section('[31] 下载量展示+热门（downloads）');
  const dbJs31 = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');
  ok('db.js 下载量表含 product_id 索引（幂等）', /CREATE INDEX IF NOT EXISTS idx_downloads_product ON downloads\(product_id\)/.test(dbJs31));
  const routes31 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 公开产品列表含下载量子查询', /sort, \(SELECT COUNT\(\*\) FROM downloads d WHERE d\.product_id = products\.id\) AS downloads FROM products WHERE status='on'/.test(routes31));
  ok('routes.js 公开详情含下载量子查询', /changelog, \(SELECT COUNT\(\*\) FROM downloads d WHERE d\.product_id = products\.id\) AS downloads FROM products WHERE id=\?/.test(routes31));
  const mainJs31 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'main.js'), 'utf8');
  ok('main.js 卡片渲染下载量徽标（pcard-dl）', /pcard-dl/.test(mainJs31) && /fmtCount\(p\.downloads\)/.test(mainJs31));
  ok('main.js 定义 fmtCount 简写（k/M）', /function fmtCount\(n\)/.test(mainJs31) && /1000000/.test(mainJs31) && /1000/.test(mainJs31));
  const productJs31 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'product.js'), 'utf8');
  ok('product.js 详情页渲染下载量（pd-dl）', /class="pd-dl"/.test(productJs31) && /T\('pd\.downloads'/.test(productJs31));
  const style31 = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
  ok('style.css 含 .pcard-dl/.pd-dl 样式', /\.pcard-dl \{/.test(style31) && /\.pd-dl \{/.test(style31));
  const i18n31 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  const dlKeyCount = (i18n31.match(/'pd\.downloads'/g) || []).length;
  ok('i18n 含 6 语言 key: pd.downloads', dlKeyCount === 6, '实际 ' + dlKeyCount + ' 处');
  // 运行时：下载上报两次 → 列表/详情透出下载量 → 清理（含孤儿下载明细，避免污染统计）
  const vH31 = { Authorization: 'Bearer ' + bt, 'Content-Type': 'application/json' };
  const dlTag = '冒烟下载_' + Date.now();
  const dlNew = await (await req('/api/admin/products', { method: 'POST', headers: vH31, body: JSON.stringify({ name: dlTag, type: 'app', version: '1.0.0' }) })).res.json().catch(() => null);
  ok('下载量用例：新增产品 → 返回 id', !!dlNew && typeof dlNew.id === 'number', dlNew ? 'id=' + dlNew.id : 'null');
  if (dlNew && dlNew.id) {
    const dlJson = { 'Content-Type': 'application/json' };
    ok('下载上报两次 → 200',
      (await status('/api/downloads', { method: 'POST', headers: dlJson, body: JSON.stringify({ productId: dlNew.id }) })) === 200 &&
      (await status('/api/downloads', { method: 'POST', headers: dlJson, body: JSON.stringify({ productId: dlNew.id }) })) === 200);
    const dlList = await (await req('/api/products', { headers: {} })).res.json().catch(() => []);
    const dlRec = (Array.isArray(dlList) ? dlList : []).find((p) => p.id === dlNew.id);
    ok('公开 /api/products 返回下载量=1（同 IP 24h 去重，维度 66）', !!dlRec && dlRec.downloads === 1, dlRec ? 'downloads=' + dlRec.downloads : '未找到');
    const dlDet = await (await req('/api/products/' + dlNew.id, { headers: {} })).res.json().catch(() => null);
    ok('公开 /api/products/:id 返回下载量=1', !!dlDet && dlDet.downloads === 1, dlDet ? 'downloads=' + dlDet.downloads : 'null');
    ok('删除测试产品 → 200', (await status('/api/admin/products/' + dlNew.id, { method: 'DELETE', headers: vH31 })) === 200);
    // 清理孤儿下载明细（仅本地测试库可直连；线上 --url 模式跳过）
    if (!urlArg) {
      try {
        const Database = require('better-sqlite3');
        const localDb = new Database(path.join(ROOT, 'data', 'app.db'), { readonly: false });
        localDb.prepare('DELETE FROM downloads WHERE product_id = ?').run(dlNew.id);
        localDb.close();
      } catch (e) {}
    }
  }
  const dlLeft = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
  const dlResid = (Array.isArray(dlLeft) ? dlLeft : []).filter((p) => (p.name || '').indexOf('冒烟下载_') === 0);
  ok('下载量用例产品已清理', dlResid.length === 0, dlResid.length + ' 条残留');

  section('[32] 导航栏全站搜索（nav-search / ?q=）');
  const htmlFiles32 = ['index', 'download', 'product', 'contact', 'privacy', 'terms', 'api', '404', 'offline'].map((n) => n + '.html');
  const navSearchPages = htmlFiles32.filter((f) => fs.existsSync(path.join(ROOT, f)) && /<form class="nav-search" role="search" action="download\.html"/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  ok('9 个页面导航均含全站搜索框（action=download.html）', navSearchPages.length === 9, navSearchPages.length + '/' + htmlFiles32.length);
  const navQPages = htmlFiles32.filter((f) => /id="nav-q"/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  ok('9 个页面均含 #nav-q 搜索输入框', navQPages.length === 9, navQPages.length + '/' + htmlFiles32.length);
  const mainJs32 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'main.js'), 'utf8');
  ok('main.js 读取 ?q= 并联动过滤', /\[\?&\]q=\(\[\^&\]\*\)/.test(mainJs32) && /state\.kw = qFromUrl/.test(mainJs32) && /searchInput\.value = qFromUrl/.test(mainJs32));
  ok('main.js 预填导航搜索框 #nav-q', /getElementById\('nav-q'\)/.test(mainJs32) && /navQ\.value = qFromUrl/.test(mainJs32));
  ok('main.js ?q= 时滚动到筛选区', /\.filters/.test(mainJs32) && /scrollIntoView/.test(mainJs32));
  const style32 = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
  ok('style.css 含 .nav-search 胶囊样式', /\.nav-search \{/.test(style32) && /\.nav-search:focus-within/.test(style32) && /\.nav-search input/.test(style32));
  const i18n32 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  for (const k of ['nav.searchPh', 'nav.searchInput', 'nav.searchBtn', 'nav.searchForm']) {
    const n = (i18n32.match(new RegExp("'" + k + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  ok('download.html?q= 页面可访问 → 200', (await status('/download.html?q=' + encodeURIComponent('效率'), {})) === 200);

  section('[33] 热门下载排行（/api/products/hot + hot-strip）');
  const routes33 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 含 /products/hot 公开接口', /router\.get\('\/products\/hot'/.test(routes33) && /ORDER BY downloads DESC, sort DESC, id LIMIT \?/.test(routes33));
  const hotPages = ['index', 'download'].filter((f) => /id="hot"[\s\S]*?id="hot-list"/.test(fs.readFileSync(path.join(ROOT, f + '.html'), 'utf8')));
  ok('index/download 两页含热门区容器 #hot-list', hotPages.length === 2, hotPages.length + '/2');
  const download33 = fs.readFileSync(path.join(ROOT, 'download.html'), 'utf8');
  ok('download.html 热门标题走 i18n', /data-i18n="hot\.title"/.test(download33));
  const mainJs33 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'main.js'), 'utf8');
  ok('main.js 定义 hotItemHTML/loadHot', /function hotItemHTML\(p, i\)/.test(mainJs33) && /function loadHot\(\)/.test(mainJs33) && /\/products\/hot\?limit=5/.test(mainJs33));
  ok('main.js 热门项点击进详情（弹窗/详情页）', /\.hot-item/.test(mainJs33) && /openModal\(p\)/.test(mainJs33));
  const style33 = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
  ok('style.css 含 .hot-strip/.hot-item/.hot-rank/.top1', /\.hot-strip \{/.test(style33) && /\.hot-item \{/.test(style33) && /\.hot-rank/.test(style33) && /\.hot-rank\.top1/.test(style33));
  const i18n33 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  for (const k of ['hot.title', 'hot.sub', 'hot.empty']) {
    const n = (i18n33.match(new RegExp("'" + k + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  // 运行时：两个测试产品不同下载量 → hot 排序 → 清理
  const vH33 = { Authorization: 'Bearer ' + bt, 'Content-Type': 'application/json' };
  const tagA = '冒烟热门A_' + Date.now();
  const tagB = '冒烟热门B_' + Date.now();
  const hotA = await (await req('/api/admin/products', { method: 'POST', headers: vH33, body: JSON.stringify({ name: tagA, type: 'game', version: '1.0.0' }) })).res.json().catch(() => null);
  const hotB = await (await req('/api/admin/products', { method: 'POST', headers: vH33, body: JSON.stringify({ name: tagB, type: 'app', version: '1.0.0' }) })).res.json().catch(() => null);
  ok('热门用例：新增测试产品 A/B', !!hotA && typeof hotA.id === 'number' && !!hotB && typeof hotB.id === 'number', hotA ? 'A=' + hotA.id : 'null' + ' / ' + (hotB ? 'B=' + hotB.id : 'null'));
  if (hotA && hotB && typeof hotA.id === 'number' && typeof hotB.id === 'number') {
    const j33 = { 'Content-Type': 'application/json' };
    // A 上报 2 次（同 IP 24h 去重后计 1，维度 66），B 不上报 → A 应排在 B 前
    for (let i = 0; i < 2; i++) await status('/api/downloads', { method: 'POST', headers: j33, body: JSON.stringify({ productId: hotA.id }) });
    const hotList = await (await req('/api/products/hot?limit=10', { headers: {} })).res.json().catch(() => null);
    ok('hot 接口返回数组且长度 ≤10', Array.isArray(hotList) && hotList.length <= 10, Array.isArray(hotList) ? 'len=' + hotList.length : 'null');
    if (Array.isArray(hotList)) {
      const ia = hotList.findIndex((p) => p.id === hotA.id);
      const ib = hotList.findIndex((p) => p.id === hotB.id);
      ok('hot 按下载量降序（A=1 次在 B=0 次前）', ia !== -1 && ib !== -1 && ia < ib, 'ia=' + ia + ' ib=' + ib);
      const ra = ia !== -1 ? hotList[ia] : null;
      ok('hot 条目含 downloads 字段（A 去重后 =1）', !!ra && typeof ra.downloads === 'number' && ra.downloads === 1, ra ? 'A downloads=' + ra.downloads : 'null');
    }
    ok('清理测试产品 A/B', (await status('/api/admin/products/' + hotA.id, { method: 'DELETE', headers: vH33 })) === 200 && (await status('/api/admin/products/' + hotB.id, { method: 'DELETE', headers: vH33 })) === 200);
    // 清理孤儿下载明细（仅本地测试库可直连；线上 --url 模式跳过）
    if (!urlArg) {
      try {
        const Database = require('better-sqlite3');
        const localDb = new Database(path.join(ROOT, 'data', 'app.db'), { readonly: false });
        localDb.prepare('DELETE FROM downloads WHERE product_id IN (?,?)').run(hotA.id, hotB.id);
        localDb.close();
      } catch (e) {}
    }
  }
  const hotLeft = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
  const hotResid = (Array.isArray(hotLeft) ? hotLeft : []).filter((p) => (p.name || '').indexOf('冒烟热门') === 0);
  ok('热门用例产品已清理', hotResid.length === 0, hotResid.length + ' 条残留');

  section('[34] 下载统计防刷去重（同 IP 24h 窗口）');
  const dbJs34 = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');
  ok('db.js downloads 表含 ip 列（新库建表）', /ip TEXT NOT NULL DEFAULT ''/.test(dbJs34));
  ok('db.js 含 ip 迁移 + 去重索引（幂等）', /migrateDownloadsIp/.test(dbJs34) && /idx_downloads_ip_prod ON downloads\(ip, product_id, ts\)/.test(dbJs34));
  const routes34 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 下载上报含 24h 窗口去重查询', /SELECT 1 FROM downloads WHERE product_id=\? AND ip=\? AND ts>=\?/.test(routes34) && /24 \* 3600 \* 1000/.test(routes34));
  // 运行时：同 IP 连续上报不重复计数
  const vH34 = { Authorization: 'Bearer ' + bt, 'Content-Type': 'application/json' };
  const ddTag = '冒烟去重_' + Date.now();
  const ddNew = await (await req('/api/admin/products', { method: 'POST', headers: vH34, body: JSON.stringify({ name: ddTag, type: 'app', version: '1.0.0' }) })).res.json().catch(() => null);
  ok('去重用例：新增测试产品', !!ddNew && typeof ddNew.id === 'number', ddNew ? 'id=' + ddNew.id : 'null');
  if (ddNew && typeof ddNew.id === 'number') {
    const j34 = { 'Content-Type': 'application/json' };
    for (let i = 0; i < 3; i++) await status('/api/downloads', { method: 'POST', headers: j34, body: JSON.stringify({ productId: ddNew.id }) });
    const ddDet = await (await req('/api/products/' + ddNew.id, { headers: {} })).res.json().catch(() => null);
    ok('同 IP 上报 3 次 → 下载量仅 1（24h 去重）', !!ddDet && ddDet.downloads === 1, ddDet ? 'downloads=' + ddDet.downloads : 'null');
    ok('清理测试产品 → 200', (await status('/api/admin/products/' + ddNew.id, { method: 'DELETE', headers: vH34 })) === 200);
    // 清理孤儿下载明细（仅本地测试库可直连；线上 --url 模式跳过）
    if (!urlArg) {
      try {
        const Database = require('better-sqlite3');
        const localDb = new Database(path.join(ROOT, 'data', 'app.db'), { readonly: false });
        localDb.prepare('DELETE FROM downloads WHERE product_id = ?').run(ddNew.id);
        localDb.close();
      } catch (e) {}
    }
  }
  const ddLeft = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
  const ddResid = (Array.isArray(ddLeft) ? ddLeft : []).filter((p) => (p.name || '').indexOf('冒烟去重_') === 0);
  ok('去重用例产品已清理', ddResid.length === 0, ddResid.length + ' 条残留');

  section('[35] 后台产品图片直传（/api/admin/upload）');
  const routes35 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 含 /admin/upload 路由', /router\.post\('\/admin\/upload', authMiddleware, requireAdmin/.test(routes35));
  ok('routes.js 含类型白名单与大小限制', /UP_TYPES = \{ 'image\/png': '\.png'/.test(routes35) && /UP_MAX_BYTES = 2 \* 1024 \* 1024/.test(routes35));
  ok('routes.js 含魔数嗅探（拒绝伪装文件）', /function sniffImage\(buf\)/.test(routes35) && /0x89/.test(routes35));
  const adminHtml35 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('admin.html 含文件选择与上传按钮', /id="f-image-file"/.test(adminHtml35) && /id="f-image-upload"/.test(adminHtml35) && /accept="image\/png,image\/jpeg,image\/webp,image\/gif"/.test(adminHtml35));
  const adminJs35 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  ok('admin.js 上传逻辑（FileReader + /admin/upload）', /FileReader/.test(adminJs35) && /'\/admin\/upload'/.test(adminJs35) && /readAsDataURL\(f\)/.test(adminJs35));
  const i18n35 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  const upKeyN = (i18n35.match(/'f\.upload'/g) || []).length;
  ok('i18n 含 6 语言 key: f.upload', upKeyN === 6, '实际 ' + upKeyN + ' 处');
  // 运行时：上传 1x1 PNG → 200 + 落盘；非法类型 / 伪装内容 → 400
  const vH35 = { Authorization: 'Bearer ' + bt, 'Content-Type': 'application/json' };
  const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const upRes = await (await req('/api/admin/upload', { method: 'POST', headers: vH35, body: JSON.stringify({ data: png1x1 }) })).res.json().catch(() => null);
  ok('上传 1x1 PNG → ok + url', !!upRes && upRes.ok === true && typeof upRes.url === 'string' && upRes.url.indexOf('/assets/img/products/prod-') === 0, upRes ? upRes.url : 'null');
  if (upRes && upRes.ok && upRes.url) {
    const fpath = path.join(ROOT, 'assets', 'img', 'products', path.basename(upRes.url));
    ok('图片已落盘', fs.existsSync(fpath), fpath);
    if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
  }
  const upBad1 = await (await req('/api/admin/upload', { method: 'POST', headers: vH35, body: JSON.stringify({ data: 'data:image/svg+xml;base64,PHN2Zy8+' }) })).res.json().catch(() => null);
  ok('拒绝 SVG（400，不在白名单）', !!upBad1 && upBad1.error === '仅支持 PNG / JPG / WebP / GIF', upBad1 ? upBad1.error : 'null');
  const upBad2 = await (await req('/api/admin/upload', { method: 'POST', headers: vH35, body: JSON.stringify({ data: 'data:image/png;base64,aGVsbG8=' }) })).res.json().catch(() => null);
  ok('拒绝伪装 PNG（400，魔数不符）', !!upBad2 && upBad2.error === '图片内容校验失败', upBad2 ? upBad2.error : 'null');
  const upBad3 = await (await req('/api/admin/upload', { method: 'POST', headers: vH35, body: JSON.stringify({ data: 'data:text/plain;base64,aGVsbG8=' }) })).res.json().catch(() => null);
  ok('拒绝 text/plain（400，非图片数据）', !!upBad3 && upBad3.error === '仅支持 base64 图片数据', upBad3 ? upBad3.error : 'null');

  /* [36] 审计/留言数据导出（CSV：跨页全量 + 联动筛选 + BOM） */
  section('[36] 审计/留言数据导出（CSV）');
  const adminHtml36 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('admin.html 留言导出按钮 export-csv', /id="export-csv"/.test(adminHtml36));
  ok('admin.html 产品导出按钮 export-products（仅管理员）', /id="export-products" data-admin-only/.test(adminHtml36));
  ok('admin.html 审计导出按钮 export-audit', /id="export-audit"/.test(adminHtml36));
  const adminJs36 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  ok('admin.js 跨页全量拉取 fetchAllPages（pageSize=100 逐页）', /function fetchAllPages\(url, params\)/.test(adminJs36) && /var pageSize = 100/.test(adminJs36) && /if \(rows\.length === pageSize\) \{\s*page\+\+;\s*return one\(\)/.test(adminJs36));
  ok('admin.js 三个导出函数齐全', /function exportCsv\(\)/.test(adminJs36) && /function exportProducts\(\)/.test(adminJs36) && /function exportAudit\(\)/.test(adminJs36));
  ok('admin.js csvCell 转义逗号/引号/换行', /function csvCell\(v\)/.test(adminJs36) && /\[",\\r\\n\]/.test(adminJs36) && /v\.replace\(\/"\/g, '""'\)/.test(adminJs36));
  ok('admin.js CSV 带 BOM + CRLF（Excel 兼容）', /var csv = '﻿' \+ rows\.join\('\\r\\n'\)/.test(adminJs36));
  ok('admin.js 留言导出联动 status/keyword 筛选', /status: contactStatusFilter === 'all' \? '' : contactStatusFilter/.test(adminJs36) && /keyword: contactKw\.trim\(\)/.test(adminJs36));
  ok('admin.js 审计导出联动 action/keyword 筛选', /action: auditAction/.test(adminJs36) && /keyword: auditKw\.trim\(\)/.test(adminJs36));
  const i18n36 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  const expAuditN = (i18n36.match(/'btn\.exportAudit'/g) || []).length;
  ok('i18n 含 6 语言 key: btn.exportAudit', expAuditN === 6, '实际 ' + expAuditN + ' 处');
  // 运行时：导出依赖的分页接口以 pageSize=100 正常返回（fetchAllPages 的拉取基础）
  const vH36 = { headers: { Authorization: 'Bearer ' + bt } };
  const expAudit = await (await req('/api/admin/audit?page=1&pageSize=100', vH36)).res.json().catch(() => null);
  ok('审计分页 pageSize=100 → rows 数组', expAudit && Array.isArray(expAudit.rows) && typeof expAudit.total === 'number', expAudit ? 'rows=' + expAudit.rows.length + ' total=' + expAudit.total : 'null');
  const expContact = await (await req('/api/admin/contacts?page=1&pageSize=100&status=new', vH36)).res.json().catch(() => null);
  ok('留言分页 pageSize=100 且状态筛选生效', expContact && Array.isArray(expContact.rows) && typeof expContact.total === 'number' && expContact.rows.every((m) => m.status === 'new'),
    expContact ? 'rows=' + expContact.rows.length + ' total=' + expContact.total : 'null');

  /* [37] 后台批量导入产品（CSV：整批校验 + 事务写入） */
  section('[37] 后台批量导入产品（CSV）');
  const routes37 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 含 /admin/products/import 路由（admin）', /router\.post\('\/admin\/products\/import', authMiddleware, requireAdmin/.test(routes37));
  ok('routes.js 含 parseCsv（RFC4180 引号包裹）', /function parseCsv\(text\)/.test(routes37) && /inQ/.test(routes37) && /0xfeff/.test(routes37));
  ok('routes.js 单次导入上限 100 行', /CSV_MAX_ROWS = 100/.test(routes37));
  ok('routes.js 表头中英文别名 + 类型中文映射', /'应用'/.test(routes37) && /'游戏'/.test(routes37) && /'名称'/.test(routes37));
  ok('routes.js 整批校验失败则全部拒绝（返回逐行错误）', /failed\.length\) return res\.status\(400\)\.json\(\{ ok: false/.test(routes37) && /\.json\(\{ ok: true, imported/.test(routes37));
  const adminHtml37 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('admin.html 含导入按钮与隐藏文件输入', /id="import-products"/.test(adminHtml37) && /id="import-products-file" type="file" accept="\.csv,text\/csv"/.test(adminHtml37));
  const adminJs37 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  ok('admin.js 导入逻辑（FileReader + /admin/products/import）', /FileReader/.test(adminJs37) && /'\/admin\/products\/import'/.test(adminJs37) && /readAsText\(f, 'utf-8'\)/.test(adminJs37));
  const i18n37 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  const impKeyN = (i18n37.match(/'btn\.importCsv'/g) || []).length;
  ok('i18n 含 6 语言 key: btn.importCsv', impKeyN === 6, '实际 ' + impKeyN + ' 处');
  // 运行时：合法 CSV → 导入 2 条 + 公开可见；非法行 → 整批拒绝 + 行号
  const hdrs37 = { 'Authorization': 'Bearer ' + bt, 'Content-Type': 'application/json' };
  const csvGood = '名称,类型,分类,简介,图标,排序\nCSV导入甲,应用,工具,"简介,含逗号",🧪,5\nCSV导入乙,游戏,休闲,纯文本简介,🎮,3';
  const impGood = await (await req('/api/admin/products/import', { method: 'POST', headers: hdrs37, body: JSON.stringify({ csv: csvGood }) })).res.json().catch(() => null);
  ok('合法 CSV（含引号逗号字段）→ 导入 2 条', !!impGood && impGood.ok === true && impGood.imported === 2 && Array.isArray(impGood.ids) && impGood.ids.length === 2,
    impGood ? 'imported=' + (impGood.imported != null ? impGood.imported : 'null') + ' ids=' + ((impGood.ids || []).length) : 'null');
  if (impGood && impGood.ids && impGood.ids.length) {
    const pubList = await (await req('/api/products?type=app')).res.json().catch(() => []);
    ok('公开接口可见导入的 app 产品（含引号简介）', Array.isArray(pubList) && pubList.some((p) => p.id === impGood.ids[0] && p.desc === '简介,含逗号'),
      pubList.length ? 'app 数=' + pubList.length : '[]');
  }
  const csvBad = '名称,类型,分类\nCSV坏行甲,应用,工具\nCSV坏行乙,非类型,工具';
  const impBad = await (await req('/api/admin/products/import', { method: 'POST', headers: hdrs37, body: JSON.stringify({ csv: csvBad }) })).res.json().catch(() => null);
  ok('非法行 → 整批拒绝 + 报出第 3 行', !!impBad && impBad.ok === false && Array.isArray(impBad.failed) && impBad.failed.length === 1 && impBad.failed[0].line === 3,
    impBad ? 'failed=' + ((impBad.failed || []).length) + ' line=' + ((impBad.failed || [])[0] || {}).line : 'null');
  const csvNoHeader = '名称缺失列\nCSV导入丙,应用,工具';
  const impNoHeader = await (await req('/api/admin/products/import', { method: 'POST', headers: hdrs37, body: JSON.stringify({ csv: csvNoHeader }) })).res.json().catch(() => null);
  ok('缺少 name/名称 表头 → 400 明确报错', !!impNoHeader && impNoHeader.error === 'CSV 缺少 name/名称 列', impNoHeader ? impNoHeader.error : 'null');
  const csvEmpty = await (await req('/api/admin/products/import', { method: 'POST', headers: hdrs37, body: JSON.stringify({ csv: '' }) })).res.json().catch(() => null);
  ok('空 CSV → 400', !!csvEmpty && csvEmpty.error === 'csv 为空', csvEmpty ? csvEmpty.error : 'null');
  // 清理导入的测试产品
  if (impGood && impGood.ids && impGood.ids.length) {
    const delCodes = [];
    for (const id37 of impGood.ids) delCodes.push(await status('/api/admin/products/' + id37, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + bt } }));
    ok('清理导入的测试产品', delCodes.every((c) => c === 200), delCodes.join('/'));
    const remain = await (await req('/api/admin/products', { headers: { 'Authorization': 'Bearer ' + bt } })).res.json().catch(() => []);
    ok('清理后无残留（名称无 CSV导入 前缀）', Array.isArray(remain) && !remain.some((p) => (p.name || '').indexOf('CSV导入') === 0));
  }

  section('[38] 下载页排序切换（默认/最新/热门/名称）');
  const dlHtml38 = fs.readFileSync(path.join(ROOT, 'download.html'), 'utf8');
  ok('download.html 含排序下拉 sort-filter', /<select id="sort-filter"/.test(dlHtml38) && /aria-label="排序方式"/.test(dlHtml38));
  ok('download.html 排序下拉含 4 档（default/new/hot/name）',
    ['value="default"', 'value="new"', 'value="hot"', 'value="name"'].every((v) => dlHtml38.indexOf(v) !== -1));
  const mainJs38 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'main.js'), 'utf8');
  ok('main.js state 默认 sort=default', /state = \{ type: 'all', kw: '', category: '', sort: 'default' \}/.test(mainJs38));
  ok('main.js sortProducts 含 4 分支（default/new/hot/name + localeCompare）',
    /function sortProducts\(list\)/.test(mainJs38) && /s === 'new'/.test(mainJs38) && /s === 'hot'/.test(mainJs38) &&
    /s === 'name'/.test(mainJs38) && /localeCompare/.test(mainJs38) && /b\.sort \|\| 0\) - \(a\.sort \|\| 0\)/.test(mainJs38));
  ok('main.js renderProducts 内对 app/game 两桶应用排序', /sortProducts\(buckets\.app\)/.test(mainJs38) && /sortProducts\(buckets\.game\)/.test(mainJs38));
  ok('main.js sort-filter 变更监听 → 重渲染', /getElementById\('sort-filter'\)/.test(mainJs38) && /addEventListener\('change'/.test(mainJs38));
  const i18n38 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  for (const k of ['sort.default', 'sort.new', 'sort.hot', 'sort.name']) {
    const n = (i18n38.match(new RegExp("'" + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  // 运行时：验证公开接口已返回 created_at / downloads，且两测试产品在各维度上有明确大小关系（支撑前端排序）
  const sTag = '冒烟排序切换_' + Date.now();
  const sIds = [];
  try {
    const rA = await (await req('/api/admin/products', { method: 'POST', headers: bH, body: JSON.stringify({ name: sTag + '_甲', type: 'app', category: '工具', desc: 'sort-a', sort: 50 }) })).res.json().catch(() => null);
    const rB = await (await req('/api/admin/products', { method: 'POST', headers: bH, body: JSON.stringify({ name: sTag + '_乙', type: 'app', category: '工具', desc: 'sort-b', sort: 10 }) })).res.json().catch(() => null);
    if (rA && typeof rA.id === 'number' && rB && typeof rB.id === 'number') {
      sIds.push(rA.id, rB.id);
      ok('创建 2 个不同权重/时间测试产品', sIds.length === 2, 'ids=' + sIds.join(','));
      // 给甲记 1 次下载（乙保持 0），形成 downloads 差异
      await status('/api/downloads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: rA.id }) });
      const pubS = await (await req('/api/products')).res.json().catch(() => []);
      const mine = (Array.isArray(pubS) ? pubS : []).filter((p) => sIds.indexOf(p.id) !== -1);
      const pA = mine.find((p) => p.id === rA.id);
      const pB = mine.find((p) => p.id === rB.id);
      ok('公开接口返回 created_at 与 downloads（排序依据字段齐全）',
        mine.length === 2 && typeof pA.created_at === 'number' && typeof pB.created_at === 'number' &&
        typeof pA.downloads === 'number' && typeof pB.downloads === 'number',
        mine.map((m) => m.id + ':ca=' + m.created_at + ':dl=' + m.downloads).join(' '));
      ok('四种排序各有明确首位（default=甲 sort 大；new=乙后建；hot=甲下载多；name=甲在前）',
        mine.length === 2 && pA.sort > pB.sort && pB.created_at > pA.created_at && pA.downloads > pB.downloads && (pA.name || '').localeCompare(pB.name || '', 'zh') < 0,
        'A(sort=' + pA.sort + ',ca=' + pA.created_at + ',dl=' + pA.downloads + ') B(sort=' + pB.sort + ',ca=' + pB.created_at + ',dl=' + pB.downloads + ')');
    } else {
      ok('创建 2 个不同权重/时间测试产品', false, 'A=' + JSON.stringify(rA) + ' B=' + JSON.stringify(rB));
    }
  } finally {
    for (const id of sIds) await status('/api/admin/products/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } });
    if (!urlArg) {
      try {
        const Database = require('better-sqlite3');
        const localDb = new Database(path.join(ROOT, 'data', 'app.db'), { readonly: false });
        localDb.prepare('DELETE FROM downloads WHERE product_id IN (' + sIds.map(() => '?').join(',') + ')').run(...sIds);
        localDb.close();
      } catch (e) {}
    }
  }
  const left38 = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
  const resid38 = (Array.isArray(left38) ? left38 : []).filter((p) => (p.name || '').indexOf('冒烟排序切换_') === 0);
  ok('排序测试产品已清理', resid38.length === 0, resid38.length + ' 条残留');

  section('[39] 前台公告条（后台可维护）');
  const dbJs39 = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');
  ok('db.js 含 announcements 表（content/enabled 字段）',
    /CREATE TABLE IF NOT EXISTS announcements/.test(dbJs39) && /content TEXT NOT NULL/.test(dbJs39) && /enabled INTEGER NOT NULL DEFAULT 1/.test(dbJs39));
  const routes39 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 公开 GET /announcement（仅启用中的最新一条）',
    /router\.get\('\/announcement'/.test(routes39) && /WHERE enabled=1 ORDER BY id DESC LIMIT 1/.test(routes39));
  ok('routes.js 后台公告 CRUD（list/add/edit/delete + 审计）',
    /router\.get\('\/admin\/announcements'/.test(routes39) && /router\.post\('\/admin\/announcements'/.test(routes39) &&
    /router\.put\('\/admin\/announcements\/:id'/.test(routes39) && /router\.delete\('\/admin\/announcements\/:id'/.test(routes39) &&
    /logAudit\('announcement_add'/.test(routes39) && /logAudit\('announcement_edit'/.test(routes39) && /logAudit\('announcement_delete'/.test(routes39));
  ok('routes.js 公告内容校验（非空 + ≤200 字符）', /公告内容不能为空/.test(routes39) && /公告内容过长（≤200 字符）/.test(routes39));
  const adminHtml39 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('admin.html 含公告面板（发布表单 + 列表 + 刷新）',
    /id="ann-add-form"/.test(adminHtml39) && /id="ann-list"/.test(adminHtml39) && /id="refresh-announcements"/.test(adminHtml39));
  const adminJs39 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  ok('admin.js 公告逻辑（列表/增删/启停 + 登录后加载）',
    /function loadAnnouncements/.test(adminJs39) && /function renderAnnouncements/.test(adminJs39) &&
    /'\/admin\/announcements'/.test(adminJs39) && /loadAnnouncements\(\)/.test(adminJs39));
  const mainJs39 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'main.js'), 'utf8');
  ok('main.js 公告条（拉取 /announcement + localStorage 记忆关闭）',
    /API \+ '\/announcement'/.test(mainJs39) && /gr-ann-off-/.test(mainJs39) && /annBar\.hidden = false/.test(mainJs39));
  const productJs39 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'product.js'), 'utf8');
  ok('product.js 独立详情页也接入公告条', /API \+ '\/announcement'/.test(productJs39) && /gr-ann-off-/.test(productJs39));
  const css39 = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
  ok('style.css 含公告条样式（bar + 关闭按钮）', /\.announcement-bar \{/.test(css39) && /\.ann-close \{/.test(css39));
  for (const page of ['index.html', 'download.html', 'contact.html', 'product.html', 'privacy.html', 'terms.html']) {
    const h = fs.readFileSync(path.join(ROOT, page), 'utf8');
    ok(page + ' 含公告条容器（ann-bar/ann-msg/ann-close）',
      /id="ann-bar" hidden/.test(h) && /id="ann-msg"/.test(h) && /id="ann-close"/.test(h));
  }
  const i18n39 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  for (const k of ['panel.announcements', 'ann.content', 'ann.add', 'ann.empty', 'ann.delete', 'ann.delTitle', 'ann.confirmDel', 'ann.needContent', 'ann.added']) {
    const n = (i18n39.match(new RegExp("'" + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g')) || []).length;
    ok('i18n 含 6 语言 key: ' + k, n === 6, '实际 ' + n + ' 处');
  }
  // 运行时：无公告→null；发布→最新生效；停用→回退次新；校验失败拒绝；清理
  const hdrs39 = { 'Authorization': 'Bearer ' + bt, 'Content-Type': 'application/json' };
  const none39 = await (await req('/api/announcement')).res.json().catch(() => null);
  ok('无公告时 GET /announcement → null', none39 === null, String(none39));
  const annIds = [];
  try {
    const a1 = await (await req('/api/admin/announcements', { method: 'POST', headers: hdrs39, body: JSON.stringify({ content: '冒烟公告甲：绿角犀 2.0 发布' }) })).res.json().catch(() => null);
    const a2 = await (await req('/api/admin/announcements', { method: 'POST', headers: hdrs39, body: JSON.stringify({ content: '冒烟公告乙：新增云盘同步' }) })).res.json().catch(() => null);
    if (a1 && typeof a1.id === 'number' && a2 && typeof a2.id === 'number') {
      annIds.push(a1.id, a2.id);
      ok('发布 2 条公告', annIds.length === 2, 'ids=' + annIds.join(','));
      const cur = await (await req('/api/announcement')).res.json().catch(() => null);
      ok('公开接口返回最新一条启用公告（乙）', !!cur && cur.id === a2.id && cur.content.indexOf('乙') !== -1,
        cur ? 'id=' + cur.id + ' content=' + cur.content : 'null');
      const toggle = await (await req('/api/admin/announcements/' + a2.id, { method: 'PUT', headers: hdrs39, body: JSON.stringify({ content: '冒烟公告乙：新增云盘同步', enabled: 0 }) })).res.json().catch(() => null);
      ok('停用乙（enabled=0）→ ok', !!toggle && toggle.ok === true);
      const cur2 = await (await req('/api/announcement')).res.json().catch(() => null);
      ok('停用后公开接口回退到甲', !!cur2 && cur2.id === a1.id, cur2 ? 'id=' + cur2.id : 'null');
      const editA = await (await req('/api/admin/announcements/' + a1.id, { method: 'PUT', headers: hdrs39, body: JSON.stringify({ content: '冒烟公告甲：改版 2.1' }) })).res.json().catch(() => null);
      ok('编辑甲内容 → ok', !!editA && editA.ok === true);
      const cur3 = await (await req('/api/announcement')).res.json().catch(() => null);
      ok('编辑后公开接口同步新内容', !!cur3 && cur3.id === a1.id && cur3.content.indexOf('2.1') !== -1, cur3 ? cur3.content : 'null');
      const list39 = await (await req('/api/admin/announcements', { headers: hdrs39 })).res.json().catch(() => null);
      ok('后台列表含 2 条且按 id 倒序', !!list39 && Array.isArray(list39.rows) && list39.rows.length === 2 && list39.rows[0].id === a2.id && list39.rows[1].id === a1.id,
        list39 ? 'len=' + (list39.rows || []).length : 'null');
    } else {
      ok('发布 2 条公告', false, 'a1=' + JSON.stringify(a1) + ' a2=' + JSON.stringify(a2));
    }
    const badEmpty = await (await req('/api/admin/announcements', { method: 'POST', headers: hdrs39, body: JSON.stringify({ content: '   ' }) })).res.json().catch(() => null);
    ok('空公告 → 400', !!badEmpty && badEmpty.error === '公告内容不能为空', badEmpty ? badEmpty.error : 'null');
    const badLong = await (await req('/api/admin/announcements', { method: 'POST', headers: hdrs39, body: JSON.stringify({ content: '长'.repeat(201) }) })).res.json().catch(() => null);
    ok('超长公告（>200）→ 400', !!badLong && badLong.error === '公告内容过长（≤200 字符）', badLong ? badLong.error : 'null');
    const noAuth39 = await status('/api/admin/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '无鉴权' }) });
    ok('未登录发布公告 → 401', noAuth39 === 401, String(noAuth39));
  } finally {
    for (const id of annIds) await status('/api/admin/announcements/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + bt } });
  }
  const after39 = await (await req('/api/announcement')).res.json().catch(() => null);
  ok('清理后公开接口恢复 null', after39 === null, String(after39));
  const leftAnn = await (await req('/api/admin/announcements', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => null);
  const resid39 = (leftAnn && leftAnn.rows ? leftAnn.rows : []).filter((a) => (a.content || '').indexOf('冒烟公告') === 0);
  ok('公告测试数据已清理', resid39.length === 0, resid39.length + ' 条残留');

  section('[40] 详情页相关推荐（同分类优先）');
  const routes40 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 含 /products/:id/related 路由（公开）', /router\.get\('\/products\/:id\/related'/.test(routes40));
  ok('routes.js 三层推荐（同分类 → 同类型 → 兜底）且排除自身',
    /category = \?/.test(routes40) && /type = \?/.test(routes40) && /type != \?/.test(routes40) && /id != \?/.test(routes40));
  ok('routes.js limit clamp 1–8（默认 4）', /parseInt\(req\.query\.limit, 10\) \|\| 4/.test(routes40) && /, 1\), 8\)/.test(routes40));
  const productHtml40 = fs.readFileSync(path.join(ROOT, 'product.html'), 'utf8');
  ok('product.html 相关推荐标题（data-i18n=pd.related）+ 容器', /data-i18n="pd\.related"/.test(productHtml40) && /id="pd-more"/.test(productHtml40));
  const productJs40 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'product.js'), 'utf8');
  ok('product.js renderMore 改调 /related 接口', /'\/products\/' \+ currentId \+ '\/related\?limit=4'/.test(productJs40));
  const i18n40 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  const relN = (i18n40.match(/'pd\.related'/g) || []).length;
  ok('i18n 含 6 语言 key: pd.related', relN === 6, '实际 ' + relN + ' 处');
  // 运行时：A/B/C 同分类「工具」（A、B 为 app，C 为 game）、D 异分类「效率」→ 相关推荐同分类优先、排除自身
  const rTag = '冒烟相关_' + Date.now();
  const rIds = [];
  try {
    const mk = (name, type, category) => req('/api/admin/products', { method: 'POST', headers: bH, body: JSON.stringify({ name: name, type: type, category: category, desc: 'related-test' }) })
      .then((r) => r.res.json()).catch(() => null);
    const rA = await mk(rTag + '_A', 'app', '工具');
    const rB = await mk(rTag + '_B', 'app', '工具');
    const rC = await mk(rTag + '_C', 'game', '工具');
    const rD = await mk(rTag + '_D', 'app', '效率');
    const ids = [rA, rB, rC, rD].map((j) => j && j.id).filter((x) => typeof x === 'number');
    if (ids.length === 4) {
      rIds.push(...ids);
      ok('创建 4 个推荐测试产品（同分类 3 + 异分类 1）', rIds.length === 4, 'ids=' + rIds.join(','));
      const rel = await (await req('/api/products/' + rA.id + '/related?limit=4')).res.json().catch(() => null);
      const names = Array.isArray(rel) ? rel.map((p) => p.name) : [];
      ok('A 的相关推荐排除自身且同分类（工具）优先于补充',
        Array.isArray(rel) && rel.length === 4 && rel.every((p) => p.id !== rA.id) &&
        rel.slice(0, 3).every((p) => p.category === '工具') &&
        names.some((n) => n.indexOf('_B') !== -1) && names.some((n) => n.indexOf('_C') !== -1),
        'len=' + (Array.isArray(rel) ? rel.length : 'null') + ' ' + names.join('|'));
      const rel1 = await (await req('/api/products/' + rA.id + '/related?limit=1')).res.json().catch(() => null);
      ok('limit=1 → 仅 1 条', Array.isArray(rel1) && rel1.length === 1, 'len=' + (Array.isArray(rel1) ? rel1.length : 'null'));
      const relBig = await (await req('/api/products/' + rA.id + '/related?limit=99')).res.json().catch(() => null);
      ok('limit=99 → clamp 到 8', Array.isArray(relBig) && relBig.length <= 8, 'len=' + (Array.isArray(relBig) ? relBig.length : 'null'));
      const relC = await (await req('/api/products/' + rC.id + '/related?limit=4')).res.json().catch(() => null);
      const cNames = Array.isArray(relC) ? relC.map((p) => p.name) : [];
      ok('C（game/工具）推荐不含自身且含同分类 A/B',
        Array.isArray(relC) && relC.every((p) => p.id !== rC.id) &&
        cNames.some((n) => n.indexOf('_A') !== -1) && cNames.some((n) => n.indexOf('_B') !== -1),
        cNames.join('|'));
      const relD = await (await req('/api/products/' + rD.id + '/related?limit=4')).res.json().catch(() => null);
      ok('D（异分类）推荐排除自身', Array.isArray(relD) && relD.length === 4 && relD.every((p) => p.id !== rD.id),
        'len=' + (Array.isArray(relD) ? relD.length : 'null'));
    } else {
      ok('创建 4 个推荐测试产品（同分类 3 + 异分类 1）', false, 'ids=' + ids.join(','));
    }
    const notFound40 = await status('/api/products/999999/related');
    ok('不存在产品 → 404', notFound40 === 404, String(notFound40));
    const badId40 = await status('/api/products/abc/related');
    ok('非法 id → 400', badId40 === 400, String(badId40));
  } finally {
    for (const id of rIds) await status('/api/admin/products/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } });
  }
  const left40 = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
  const resid40 = (Array.isArray(left40) ? left40 : []).filter((p) => (p.name || '').indexOf('冒烟相关_') === 0);
  ok('相关推荐测试产品已清理', resid40.length === 0, resid40.length + ' 条残留');

  /* [41] 站点维护模式（后台开关 + 前台维护页 + 审计） */
  section('[41] 站点维护模式');
  const serverJs41 = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  ok('server.js 含维护开关判定 maintenanceOn', /function maintenanceOn\(\)/.test(serverJs41) && /settings.*key='maintenance'/.test(serverJs41));
  ok('server.js 放行后台/静态/探针（后台可随时关闭维护）',
    /p === '\/admin\.html' \|\| p\.startsWith\('\/api\/admin\/'\)/.test(serverJs41) &&
    /p === '\/api\/site'/.test(serverJs41) && /p === '\/api\/health'/.test(serverJs41) &&
    /p\.startsWith\('\/assets\/'\)/.test(serverJs41));
  ok('server.js 前台 HTML → 503 维护页 / 公开 API → 503 JSON', /maintenance\.html/.test(serverJs41) && /res\.status\(503\)/.test(serverJs41) && /\.type\('text\/html; charset=utf-8'\)/.test(serverJs41) && /503\)\.json\(\{ error: 'maintenance'/.test(serverJs41));
  const routes41 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 含 /admin/maintenance GET+PUT', /router\.get\('\/admin\/maintenance'/.test(routes41) && /router\.put\('\/admin\/maintenance'/.test(routes41));
  ok('routes.js PUT 提示语 ≤200 字符 + 审计', /msg\.length > 200/.test(routes41) && /logAudit\(enabled \? 'maintenance_on'/.test(routes41));
  const maintHtml41 = fs.readFileSync(path.join(ROOT, 'maintenance.html'), 'utf8');
  ok('maintenance.html 含提示语占位符 __MAINT_MSG__', maintHtml41.indexOf('__MAINT_MSG__') !== -1 && maintHtml41.indexOf('id="maint-msg"') !== -1);
  const adminHtml41 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('admin.html 含维护面板（maint-on/maint-off/maint-msg）', /id="maint-on"/.test(adminHtml41) && /id="maint-off"/.test(adminHtml41) && /id="maint-msg"/.test(adminHtml41));
  const adminJs41 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  ok('admin.js 含 loadMaintenance/setMaintenance', /function loadMaintenance\(\)/.test(adminJs41) && /function setMaintenance\(enabled\)/.test(adminJs41));
  const i18n41 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
  ok('i18n 含 6 语言 key: maint.on', (i18n41.match(/'maint\.on'/g) || []).length === 6);
  // 运行时：开启维护 → 前台/公开 API 503、后台/静态/探针放行；关闭后恢复
  const maintMsg = '冒烟维护提示_' + Date.now();
  try {
    const m0 = await (await req('/api/admin/maintenance', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => null);
    ok('初始维护状态可读且为关闭', m0 && m0.enabled === false, JSON.stringify(m0));
    const mOn = await (await req('/api/admin/maintenance', { method: 'PUT', headers: bH, body: JSON.stringify({ enabled: 1, message: maintMsg }) })).res.json().catch(() => null);
    ok('开启维护 → ok:true', mOn && mOn.ok === true, JSON.stringify(mOn));
    const homeR = await req('/');
    const homeTxt = homeR.res ? await homeR.res.text().catch(() => '') : '';
    ok('维护中首页 → 503 且带提示语', homeR.res && homeR.res.status === 503 && homeTxt.indexOf(maintMsg) !== -1,
      homeR.res ? String(homeR.res.status) : String(homeR.err));
    ok('维护中 /api/products → 503 JSON', (await status('/api/products')) === 503);
    const notFound41 = await req('/no-such-page.html');
    ok('维护中未知页面 → 503', notFound41.res && notFound41.res.status === 503, notFound41.res ? String(notFound41.res.status) : 'ERR');
    ok('维护中后台 admin.html → 200（放行）', (await status('/admin.html')) === 200);
    ok('维护中静态资源 → 200（放行）', (await status('/assets/css/style.css')) === 200);
    ok('维护中运维探针 /api/health → 200（放行）', (await status('/api/health')) === 200);
    ok('维护中站点配置 /api/site → 200（放行）', (await status('/api/site')) === 200);
    ok('维护中后台接口 /api/admin/stats → 200（放行）', (await status('/api/admin/stats', { headers: { Authorization: 'Bearer ' + bt } })) === 200);
  } finally {
    const mOff = await (await req('/api/admin/maintenance', { method: 'PUT', headers: bH, body: JSON.stringify({ enabled: 0 }) })).res.json().catch(() => null);
    ok('关闭维护 → ok:true', mOff && mOff.ok === true, JSON.stringify(mOff));
  }
  ok('关闭后首页恢复 200', (await status('/')) === 200);
  ok('关闭后 /api/products 恢复 200', (await status('/api/products')) === 200);
  const mFinal = await (await req('/api/admin/maintenance', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => null);
  ok('最终维护状态为关闭（不留脏状态）', mFinal && mFinal.enabled === false, JSON.stringify(mFinal));

  /* [42] 产品批量管理（多选批量上/下架/改分类/删除） */
  section('[42] 产品批量管理');
  const routes42 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 含 3 个批量端点', /admin\/products\/bulk\/status/.test(routes42) && /admin\/products\/bulk\/category/.test(routes42) && /admin\/products\/bulk\/delete/.test(routes42));
  ok('routes.js 批量校验：ids 1~500 个正整数', /normalizeBulkIds\(req\.body && req\.body\.ids\)/.test(routes42) && /!Array\.isArray\(ids\) \|\| ids\.length === 0 \|\| ids\.length > 500/.test(routes42));
  const adminHtml42 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('admin.html 含全选/批量操作条/批量分类下拉', /id="pm-select-all"/.test(adminHtml42) && /id="product-batch"/.test(adminHtml42) && /id="batch-category"/.test(adminHtml42));
  const adminJs42 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  ok('admin.js 含批量动作统一入口 bulkProduct 并分发 status/category/delete', /function bulkProduct\(op, payload\)/.test(adminJs42) && /bulkProduct\('status'/.test(adminJs42) && /bulkProduct\('category'/.test(adminJs42) && /bulkProduct\('delete'/.test(adminJs42));
  ok('i18n 含 6 语言 key: bulk.done', (i18n41.match(/'bulk\.done'/g) || []).length === 6);
  const bulkTag = '冒烟批量_' + Date.now();
  const bulkIds = [];
  const bulkCatIds = [];
  try {
    // 造一个独立分类枚举项，保证批量改分类校验通过（用完即删）
    const catRes = await req('/api/admin/categories', { method: 'POST', headers: bH, body: JSON.stringify({ name: bulkTag + '分类' }) });
    const catJson = await catRes.res.json().catch(() => null);
    if (catRes.res.ok && catJson && typeof catJson.id === 'number') bulkCatIds.push(catJson.id);
    const mk42 = (name) => req('/api/admin/products', { method: 'POST', headers: bH, body: JSON.stringify({ name: name, type: 'app', status: 'on', version: '1.0.0' }) }).then((r) => r.res.json()).catch(() => null);
    const p1 = await mk42(bulkTag + '_1');
    const p2 = await mk42(bulkTag + '_2');
    const p3 = await mk42(bulkTag + '_3');
    const created = [p1, p2, p3].filter((p) => p && typeof p.id === 'number').map((p) => p.id);
    if (created.length === 3) {
      bulkIds.push(...created);
      ok('创建 3 个批量测试产品', bulkIds.length === 3, 'ids=' + bulkIds.join(','));
      const offR = await (await req('/api/admin/products/bulk/status', { method: 'POST', headers: bH, body: JSON.stringify({ ids: bulkIds, status: 'off' }) })).res.json().catch(() => null);
      ok('批量下架 → changed=3', offR && offR.ok && offR.changed === 3, JSON.stringify(offR));
      const listOff = await (await req('/api/admin/products?keyword=' + encodeURIComponent(bulkTag), { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
      const offItems = (Array.isArray(listOff) ? listOff : []).filter((p) => (p.name || '').startsWith(bulkTag + '_'));
      ok('下架后 3 个均 off', offItems.length === 3 && offItems.every((p) => p.status === 'off'), 'on=' + offItems.filter((p) => p.status === 'on').length);
      const onR = await (await req('/api/admin/products/bulk/status', { method: 'POST', headers: bH, body: JSON.stringify({ ids: bulkIds, status: 'on' }) })).res.json().catch(() => null);
      ok('批量上架 → changed=3', onR && onR.ok && onR.changed === 3, JSON.stringify(onR));
      const catName = bulkTag + '分类';
      const catR = await (await req('/api/admin/products/bulk/category', { method: 'POST', headers: bH, body: JSON.stringify({ ids: bulkIds, category: catName }) })).res.json().catch(() => null);
      ok('批量改分类（枚举项）→ changed=3', catR && catR.ok && catR.changed === 3, JSON.stringify(catR));
      const listCat = await (await req('/api/admin/products?keyword=' + encodeURIComponent(bulkTag), { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
      const catItems = (Array.isArray(listCat) ? listCat : []).filter((p) => (p.name || '').startsWith(bulkTag + '_'));
      ok('改分类后 3 个均落到枚举分类', catItems.length === 3 && catItems.every((p) => p.category === catName), catItems.map((p) => p.category).join(','));
      const clearR = await (await req('/api/admin/products/bulk/category', { method: 'POST', headers: bH, body: JSON.stringify({ ids: bulkIds, category: '' }) })).res.json().catch(() => null);
      ok('批量清空分类（category=""）→ changed=3', clearR && clearR.ok && clearR.changed === 3, JSON.stringify(clearR));
    } else {
      ok('创建 3 个批量测试产品', false, 'ids=' + created.join(','));
    }
    ok('批量空 ids → 400', (await status('/api/admin/products/bulk/status', { method: 'POST', headers: bH, body: JSON.stringify({ ids: [], status: 'on' }) })) === 400);
    ok('批量非法 id → 400', (await status('/api/admin/products/bulk/status', { method: 'POST', headers: bH, body: JSON.stringify({ ids: ['a'], status: 'on' }) })) === 400);
    ok('批量非法 status → 400', (await status('/api/admin/products/bulk/status', { method: 'POST', headers: bH, body: JSON.stringify({ ids: [1], status: 'x' }) })) === 400);
    ok('批量分类含非法字符 → 400', (await status('/api/admin/products/bulk/category', { method: 'POST', headers: bH, body: JSON.stringify({ ids: [1], category: 'a<b' }) })) === 400);
    ok('批量分类非枚举项 → 400', (await status('/api/admin/products/bulk/category', { method: 'POST', headers: bH, body: JSON.stringify({ ids: [1], category: '不存在的分类xyz' }) })) === 400);
    const tooMany = Array.from({ length: 501 }, (_, i) => i + 1);
    ok('批量超 500 个 id → 400', (await status('/api/admin/products/bulk/delete', { method: 'POST', headers: bH, body: JSON.stringify({ ids: tooMany }) })) === 400);
    ok('批量未登录 → 401', (await status('/api/admin/products/bulk/status', { method: 'POST', body: JSON.stringify({ ids: [1], status: 'on' }) })) === 401);
    ok('批量删除 → 200', (await status('/api/admin/products/bulk/delete', { method: 'POST', headers: bH, body: JSON.stringify({ ids: bulkIds }) })) === 200);
  } finally {
    for (const id of bulkIds) await status('/api/admin/products/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } });
    for (const cid of bulkCatIds) await status('/api/admin/categories/' + cid, { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } });
  }
  const left42 = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
  const resid42 = (Array.isArray(left42) ? left42 : []).filter((p) => (p.name || '').indexOf(bulkTag) === 0);
  ok('批量测试产品已清理', resid42.length === 0, resid42.length + ' 条残留');

  /* [43] 访问分析可视化（浏览器/系统分布） */
  section('[43] 访问分析可视化');
  const routes43 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 含 parseUa 解析器', /function parseUa\(ua\)/.test(routes43));
  ok('routes.js stats 单次扫描聚合五分布', /SELECT referer, ua, lang, tz FROM visits/.test(routes43));
  ok('routes.js stats 响应含 browsers/oses', /browsers: topBrowsers/.test(routes43) && /oses: topOses/.test(routes43));
  const adminHtml43 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('admin.html 含 浏览器/系统 分布容器', /id="browser-bars"/.test(adminHtml43) && /id="os-bars"/.test(adminHtml43));
  const adminJs43 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  ok('admin.js 渲染 browsers/oses', /s\.browsers/.test(adminJs43) && /s\.oses/.test(adminJs43));
  ok('i18n 含 6 语言 key: panel.browserDist', (i18n41.match(/'panel\.browserDist'/g) || []).length === 6);
  // 运行时：造 4 条不同 UA 浏览记录 → stats 正确识别浏览器/系统
  const uaTag = '/smoke43_' + Date.now();
  const uaList = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/127.0',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
  ];
  for (let i = 0; i < uaList.length; i++) {
    await status('/api/views', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: uaTag + '_' + i, ua: uaList[i], lang: 'zh-CN', tz: 'Asia/Shanghai' }) });
  }
  const stats43 = await (await req('/api/admin/stats', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => null);
  const br43 = (stats43 && Array.isArray(stats43.browsers)) ? stats43.browsers.map((b) => b.name) : [];
  const os43 = (stats43 && Array.isArray(stats43.oses)) ? stats43.oses.map((o) => o.name) : [];
  ok('stats 返回 browsers/oses 数组', Array.isArray(stats43.browsers) && Array.isArray(stats43.oses), 'br=' + br43.length + ' os=' + os43.length);
  ok('Edge/Chrome/Firefox 被正确识别', br43.indexOf('Edge') !== -1 && br43.indexOf('Chrome') !== -1 && br43.indexOf('Firefox') !== -1, br43.join(','));
  ok('Windows/macOS/Android 被正确识别', os43.indexOf('Windows') !== -1 && os43.indexOf('macOS') !== -1 && os43.indexOf('Android') !== -1, os43.join(','));
  // 清理本地测试浏览记录（仅本地库可直连；线上 --url 模式跳过）
  if (!urlArg) {
    try {
      const Database43 = require('better-sqlite3');
      const localDb43 = new Database43(path.join(ROOT, 'data', 'app.db'), { readonly: false });
      localDb43.prepare('DELETE FROM visits WHERE page LIKE ?').run(uaTag + '%');
      localDb43.close();
      ok('测试浏览记录已清理（本地库）', true);
    } catch (e) {
      ok('测试浏览记录已清理（本地库）', false, String(e && e.message || e));
    }
  }

  /* [44] 产品用户反馈（详情页提交 + 后台按产品管理） */
  section('[44] 产品用户反馈');
  const routes44 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 含公开提交与后台管理端点', /router\.post\('\/feedback'/.test(routes44) && /router\.get\('\/admin\/feedback'/.test(routes44) && /router\.put\('\/admin\/feedback\/:id'/.test(routes44) && /router\.delete\('\/admin\/feedback\/:id'/.test(routes44));
  ok('routes.js 反馈仅允许上架产品 + 蜜罐 + 限流', /status='on'/.test(routes44) && /b\.company \|\| b\.website/.test(routes44) && /rateLimit\('feedback'/.test(routes44));
  const productJs44 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'product.js'), 'utf8');
  ok('product.js 含反馈区与提交逻辑', /function feedbackHtml\(p\)/.test(productJs44) && /function initFeedback\(p\)/.test(productJs44) && /id="fb-form"/.test(productJs44));
  const adminHtml44 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('admin.html 含反馈面板（列表/产品筛选/状态 chips）', /id="feedback-list"/.test(adminHtml44) && /id="fb-product-filter"/.test(adminHtml44) && /id="feedback-filter"/.test(adminHtml44));
  const adminJs44 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  ok('admin.js 含 loadFeedback/renderFeedback', /function loadFeedback\(opts\)/.test(adminJs44) && /function renderFeedback\(\)/.test(adminJs44));
  ok('i18n 含 6 语言 key: fb.submit', (i18n41.match(/'fb\.submit'/g) || []).length === 6);
  // 运行时：提交 → 校验分支 → 列表/筛选/状态/删除
  const fbTag = '冒烟反馈_' + Date.now();
  const fbProdIds = [];
  const fbIds = [];
  try {
    // 取一个上架产品；没有则造一个（用完即删）
    const allP44 = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
    let live = Array.isArray(allP44) ? allP44.find((p) => p.status === 'on') : null;
    if (!live) {
      const cr44 = await (await req('/api/admin/products', { method: 'POST', headers: bH, body: JSON.stringify({ name: fbTag + '_产品', type: 'app', status: 'on', version: '1.0.0' }) })).res.json().catch(() => null);
      if (cr44 && typeof cr44.id === 'number') { live = { id: cr44.id }; fbProdIds.push(cr44.id); }
    }
    if (!live) {
      ok('存在可反馈的上架产品（或已创建）', false, '无上架产品');
    } else {
      const fbBody = { productId: live.id, name: '冒烟用户', email: 'smoke@example.com', content: fbTag + ' 体验不错，建议增加夜间模式。', rating: 5, company: '' };
      const subR = await (await req('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fbBody) })).res.json().catch(() => null);
      ok('正常提交反馈（评分 5 + 中文）→ ok', subR && subR.ok === true && typeof subR.id === 'number', JSON.stringify(subR));
      if (subR && typeof subR.id === 'number') fbIds.push(subR.id);
      const sub2 = await (await req('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: live.id, content: fbTag + '_2', rating: 0 }) })).res.json().catch(() => null);
      ok('无评分提交 → ok', sub2 && sub2.ok === true, JSON.stringify(sub2));
      if (sub2 && typeof sub2.id === 'number') fbIds.push(sub2.id);
      ok('缺产品 id → 400', (await status('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x' }) })) === 400);
      ok('产品不存在 → 404', (await status('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: 999999, content: 'x' }) })) === 404);
      ok('空内容 → 400', (await status('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: live.id, content: '  ' }) })) === 400);
      ok('内容超 500 字 → 400', (await status('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: live.id, content: 'x'.repeat(501) }) })) === 400);
      ok('邮箱格式错误 → 400', (await status('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: live.id, content: 'ok', email: 'bad' }) })) === 400);
      ok('蜜罐命中 → 400', (await status('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: live.id, content: 'ok', company: 'spam' }) })) === 400);
      const list44 = await (await req('/api/admin/feedback?page=1&pageSize=50', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => null);
      ok('后台列表含联表产品名', !!list44 && Array.isArray(list44.rows) && list44.rows.some((f) => f.id === fbIds[0] && !!f.product_name), list44 ? 'total=' + list44.total : 'null');
      const fProd = await (await req('/api/admin/feedback?product_id=' + live.id, { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => null);
      ok('按产品筛选命中', !!fProd && fProd.rows.some((f) => f.id === fbIds[0]), fProd ? 'total=' + fProd.total : 'null');
      const fKw = await (await req('/api/admin/feedback?keyword=' + encodeURIComponent(fbTag), { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => null);
      ok('按关键词筛选命中', !!fKw && fKw.rows.some((f) => f.id === fbIds[0]), fKw ? 'total=' + fKw.total : 'null');
      const doneR = await status('/api/admin/feedback/' + fbIds[0], { method: 'PUT', headers: bH, body: JSON.stringify({ status: 'done' }) });
      ok('标记已处理 → 200', doneR === 200, String(doneR));
      const fDone = await (await req('/api/admin/feedback?status=done', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => null);
      ok('已处理筛选含该条', !!fDone && fDone.rows.some((f) => f.id === fbIds[0] && f.status === 'done'));
      ok('非法 status → 400', (await status('/api/admin/feedback/' + fbIds[0], { method: 'PUT', headers: bH, body: JSON.stringify({ status: 'x' }) })) === 400);
      ok('未登录访问列表 → 401', (await status('/api/admin/feedback')) === 401);
      if (fbIds.length >= 2) {
        ok('删除反馈 → 200', (await status('/api/admin/feedback/' + fbIds[1], { method: 'DELETE', headers: bH })) === 200);
        fbIds.length = 1;
      } else {
        ok('删除反馈 → 200', false, '缺少第二条反馈（跳过）');
      }
    }
  } finally {
    for (const id of fbIds) await status('/api/admin/feedback/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } });
    for (const id of fbProdIds) await status('/api/admin/products/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } });
    // 兜底清理：按关键词搜残留并逐个删除
    const fLeft = await (await req('/api/admin/feedback?keyword=' + encodeURIComponent(fbTag), { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => null);
    if (fLeft && Array.isArray(fLeft.rows)) {
      for (const row of fLeft.rows) await status('/api/admin/feedback/' + row.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } });
    }
  }
  const left44 = await (await req('/api/admin/feedback?keyword=' + encodeURIComponent(fbTag), { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => null);
  ok('反馈测试数据已清理', !left44 || left44.total === 0, left44 ? '残留 ' + left44.total + ' 条' : 'null');

  /* ---------- [45] H6 前台评分聚合 / 更新动态页 / 后台概览与导出 ---------- */
  section('[45] H6 评分聚合与动态页');
  const routes45 = fs.readFileSync(path.join(ROOT, 'server', 'routes.js'), 'utf8');
  ok('routes.js 含公开评分聚合端点（仅 status=done）', /router\.get\('\/products\/:id\/feedback'/.test(routes45) && /status='done'/.test(routes45));
  ok('routes.js stats 含反馈概览字段', /feedback: \{/.test(routes45) && /byProduct/.test(routes45) && /week/.test(routes45));
  const productJs45 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'product.js'), 'utf8');
  ok('product.js 含评分聚合加载与渲染', /function loadFeedbackSummary\(productId\)/.test(productJs45) && /function renderFeedbackSummary\(d\)/.test(productJs45) && /id="fb-summary"/.test(productJs45));
  const chgHtml45 = fs.existsSync(path.join(ROOT, 'changelog.html')) ? fs.readFileSync(path.join(ROOT, 'changelog.html'), 'utf8') : '';
  ok('changelog.html 已创建并含列表容器', chgHtml45.includes('id="chg-list"') && chgHtml45.includes('changelog.js'));
  const chgJs45 = fs.existsSync(path.join(ROOT, 'assets', 'js', 'changelog.js')) ? fs.readFileSync(path.join(ROOT, 'assets', 'js', 'changelog.js'), 'utf8') : '';
  ok('changelog.js 拉取 /api/products 并按产品过滤渲染', chgJs45.includes("'/products'") && /filter\(function \(p\)/.test(chgJs45) && chgJs45.includes('class="chg-logs"'));
  const indexHtml45 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dlHtml45 = fs.readFileSync(path.join(ROOT, 'download.html'), 'utf8');
  ok('导航含 changelog 入口（首页/下载页）', indexHtml45.includes('changelog.html') && dlHtml45.includes('changelog.html'));
  const swJs45 = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  ok('sw.js 预缓存 changelog.html 与 changelog.js', swJs45.includes("'/changelog.html'") && swJs45.includes("'/assets/js/changelog.js'"));
  const adminHtml45 = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('admin.html 含反馈导出/分析导出/反馈概览面板', /id="export-feedback"/.test(adminHtml45) && /id="export-stats"/.test(adminHtml45) && /id="fb-overview"/.test(adminHtml45));
  const adminJs45 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  ok('admin.js 含导出帮助与两个新导出', /function downloadCsv\(prefix, rows\)/.test(adminJs45) && /var fbExportBtn/.test(adminJs45) && /var statsExportBtn/.test(adminJs45));
  ok('admin.js 渲染反馈概览', /fb-overview-kpis/.test(adminJs45) && /fb\.byProduct/.test(adminJs45));
  ok('i18n 含 6 语言 key: nav.changelog / fb.avgBy / panel.fbOverview / chg.title',
    (i18n41.match(/'nav\.changelog'/g) || []).length === 6 && (i18n41.match(/'fb\.avgBy'/g) || []).length === 6 &&
    (i18n41.match(/'panel\.fbOverview'/g) || []).length === 6 && (i18n41.match(/'chg\.title'/g) || []).length === 6);
  // 运行时：审核闭环（new 前台不可见 → done 可见 + 均值） + stats 反馈概览
  const h6Tag = '冒烟H6_' + Date.now();
  const h6ProdIds = [];
  const h6FbIds = [];
  try {
    let live6 = null;
    const allP45 = await (await req('/api/admin/products', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => []);
    live6 = Array.isArray(allP45) ? allP45.find((p) => p.status === 'on') : null;
    if (!live6) {
      const cr45 = await (await req('/api/admin/products', { method: 'POST', headers: bH, body: JSON.stringify({ name: h6Tag + '_产品', type: 'app', status: 'on', version: '9.9.9', changelog: h6Tag + ' 更新说明行一\n- 行二' }) })).res.json().catch(() => null);
      if (cr45 && typeof cr45.id === 'number') { live6 = { id: cr45.id }; h6ProdIds.push(cr45.id); }
    }
    if (!live6) {
      ok('存在可测试的上架产品（或已创建）', false, '无上架产品');
    } else {
      const f1 = await (await req('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: live6.id, content: h6Tag + '_A 很棒', rating: 5 }) })).res.json().catch(() => null);
      const f2 = await (await req('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: live6.id, content: h6Tag + '_B 一般', rating: 3 }) })).res.json().catch(() => null);
      if (f1 && typeof f1.id === 'number') h6FbIds.push(f1.id);
      if (f2 && typeof f2.id === 'number') h6FbIds.push(f2.id);
      ok('造两条评分反馈成功', h6FbIds.length === 2, h6FbIds.length + '/2');
      const agg0 = await (await req('/api/products/' + live6.id + '/feedback')).res.json().catch(() => null);
      ok('未审核(new)时聚合 count=0（前台不可见）', !!agg0 && agg0.count === 0 && agg0.ratedCount === 0, JSON.stringify(agg0));
      ok('下架/不存在产品 → 404', (await status('/api/products/999999/feedback')) === 404);
      ok('非法 id → 400', (await status('/api/products/abc/feedback')) === 400);
      for (const fid of h6FbIds) await status('/api/admin/feedback/' + fid, { method: 'PUT', headers: bH, body: JSON.stringify({ status: 'done' }) });
      const agg1 = await (await req('/api/products/' + live6.id + '/feedback')).res.json().catch(() => null);
      ok('审核(done)后聚合 count=2 ratedCount=2 avg=4', !!agg1 && agg1.count === 2 && agg1.ratedCount === 2 && agg1.avg === 4, JSON.stringify(agg1));
      ok('聚合含最新评价摘要', !!agg1 && Array.isArray(agg1.rows) && agg1.rows.length === 2 && agg1.rows.some((r) => r.content.indexOf(h6Tag) !== -1));
      const lim1 = await (await req('/api/products/' + live6.id + '/feedback?limit=1')).res.json().catch(() => null);
      ok('limit=1 只返回 1 条摘要', !!lim1 && lim1.rows.length === 1, lim1 ? 'rows=' + lim1.rows.length : 'null');
      const f3 = await (await req('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: live6.id, content: h6Tag + '_C 无评分' }) })).res.json().catch(() => null);
      if (f3 && typeof f3.id === 'number') h6FbIds.push(f3.id);
      await status('/api/admin/feedback/' + h6FbIds[2], { method: 'PUT', headers: bH, body: JSON.stringify({ status: 'done' }) });
      const agg2 = await (await req('/api/products/' + live6.id + '/feedback')).res.json().catch(() => null);
      ok('无评分反馈计入 count 但不计入 ratedCount/avg', !!agg2 && agg2.count === 3 && agg2.ratedCount === 2 && agg2.avg === 4, JSON.stringify(agg2));
      const st45 = await (await req('/api/admin/stats', { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => null);
      const fb45 = st45 && st45.feedback;
      ok('stats.feedback 含总数/未处理/均值', !!fb45 && typeof fb45.total === 'number' && typeof fb45.pending === 'number' && typeof fb45.avg === 'number', fb45 ? JSON.stringify(fb45) : 'null');
      ok('stats.feedback.byProduct 为数组且 week 7 天', !!fb45 && Array.isArray(fb45.byProduct) && Array.isArray(fb45.week) && fb45.week.length === 7, fb45 ? 'byProduct=' + (fb45.byProduct || []).length + ' week=' + (fb45.week || []).length : 'null');
      const chgP45 = await (await req('/api/products')).res.json().catch(() => []);
      ok('/api/products 返回 version/changelog 字段', Array.isArray(chgP45) && chgP45.length > 0 && typeof chgP45[0].version === 'string' && typeof chgP45[0].changelog === 'string');
    }
  } finally {
    for (const id of h6FbIds) await status('/api/admin/feedback/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } });
    for (const id of h6ProdIds) await status('/api/admin/products/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + bt } });
  }
  const left45 = await (await req('/api/admin/feedback?keyword=' + encodeURIComponent(h6Tag), { headers: { Authorization: 'Bearer ' + bt } })).res.json().catch(() => null);
  ok('H6 测试数据已清理', !left45 || left45.total === 0, left45 ? '残留 ' + left45.total + ' 条' : 'null');

  /* 汇总 */
  console.log('\n' + '='.repeat(56));
  if (failures.length === 0) {
    console.log('全部通过：' + passed + ' 项');
    console.log('='.repeat(56));
    return 0;
  }
  console.log('通过 ' + passed + ' 项，失败 ' + failures.length + ' 项：');
  failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
  console.log('='.repeat(56));
  return 1;
}

(async () => {
  await ensureServer();
  let code = 1;
  try {
    code = await run();
  } catch (e) {
    console.error('\n自检异常中断：', e && e.message ? e.message : e);
  } finally {
    shutdown();
  }
  process.exit(code);
})();
