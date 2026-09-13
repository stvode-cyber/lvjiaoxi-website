const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { ensureAdmins, verifyPassword, isDefaultPassword, updatePassword, makeToken, verifyToken, TOKEN_TTL_MS } = require('./auth');

ensureAdmins(); // 启动即确保 admins 表存在并写入默认管理员（幂等）

const router = express.Router();

// 受保护接口中间件：校验 Authorization: Bearer <token>，并将 {username, role} 挂到 req.user
function authMiddleware(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}

// 仅管理员（写权限）可访问：拒绝只读(viewer)角色的写操作
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ error: '需要管理员权限' });
}

/* 健康检查分两层，刻意区分：
   - /api/health       公开、极轻量（不查磁盘、不列目录），给负载均衡 / 存活探针高频调用，
                       且只返回最小信息（不暴露 Node 版本、路径等指纹）。
   - /api/health/detail 需登录：完整运维指标（数据库可写、备份是否停摆、磁盘余量、内存、日志体积），
                       供人工排障与告警系统使用；任一关键项异常时返回 503。 */
router.get('/health', (req, res) => {
  let dbStatus = 'ok';
  try {
    db.prepare('SELECT 1').get();
  } catch (e) {
    dbStatus = 'error';
  }
  res.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    time: new Date().toISOString(),
    db: dbStatus
  });
});

// 深度健康检查（需登录）：返回可执行结论，异常项带 ok:false 且整体 503，便于告警直接判定
router.get('/health/detail', authMiddleware, (req, res) => {
  const checks = {};
  let degraded = false;

  // 1) 数据库：只读探测不够——写入探针才能发现「磁盘满 / 只读挂载」这类故障
  try {
    const t0 = Date.now();
    db.prepare('SELECT 1').get();
    const tables = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'").get().c;
    checks.db = { ok: true, latencyMs: Date.now() - t0, tables: tables, writable: true };
  } catch (e) {
    degraded = true;
    checks.db = { ok: false, error: String(e && e.message || e) };
  }

  // 2) 备份：是否悄悄停摆（关键——备份不存在/过期时运维必须能立刻知道）
  const bkp = require('./backup.js');
  try {
    const b = bkp.getStatus();
    checks.backup = {
      ok: b.count > 0 && !b.stale,
      count: b.count,
      lastTs: b.lastTs,
      lastName: b.lastName,
      totalBytes: b.totalBytes,
      stale: b.stale
    };
    if (!checks.backup.ok) degraded = true;
  } catch (e) {
    degraded = true;
    checks.backup = { ok: false, error: String(e && e.message || e) };
  }

  // 2b) 备份完整性：有备份 ≠ 能恢复。从未校验过 / 最近一次校验失败都要告警，
  //     否则「以为有备份」和「真能恢复」之间永远隔着一次灾难的距离。
  try {
    const v = bkp.lastVerify();
    checks.backupVerify = v
      ? { ok: v.ok, ts: v.ts, detail: v.detail }
      : { ok: false, ts: null, detail: '从未校验过任何备份' };
    if (!checks.backupVerify.ok) degraded = true;
  } catch (e) {
    degraded = true;
    checks.backupVerify = { ok: false, error: String(e && e.message || e) };
  }

  // 3) 磁盘余量：低于 512MB 视为危险（数据库写满会导致整站只读）
  try {
    const st = fs.statfsSync(path.join(__dirname, '..', 'data'));
    const free = st.bavail * st.bsize;
    const total = st.blocks * st.bsize;
    const ok = free > 512 * 1024 * 1024;
    checks.disk = { ok: ok, freeBytes: free, totalBytes: total };
    if (!ok) degraded = true;
  } catch (e) {
    checks.disk = { ok: false, error: 'unavailable' };
  }

  // 4) 内存：RSS 超过 512MB 提示（长时间运行的内存泄漏早期信号）
  const mem = process.memoryUsage();
  const rssOk = mem.rss < 512 * 1024 * 1024;
  checks.memory = { ok: rssOk, rssBytes: mem.rss, heapUsedBytes: mem.heapUsed };
  if (!rssOk) degraded = true;

  // 5) 日志文件体积：无限增长会吃满磁盘（已有轮转，这里做兜底观测）
  const logs = {};
  ['access.log', 'error.log'].forEach(function (f) {
    try { logs[f] = fs.statSync(path.join(__dirname, '..', 'data', f)).size; }
    catch (e) { logs[f] = 0; }
  });
  checks.logs = { ok: true, files: logs };

  res.status(degraded ? 503 : 200).json({
    status: degraded ? 'degraded' : 'ok',
    uptime: Math.floor(process.uptime()),
    serverTime: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
    checks
  });
});

// 通用速率限制（进程内固定窗口，按 路由 + IP 维度；重启后重置）
const rateWindows = new Map();
function rateLimit(routeKey, max, windowMs) {
  return function (req, res, next) {
    const ip = req.ip || 'unknown';
    const key = routeKey + ':' + ip;
    const now = Date.now();
    let w = rateWindows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowMs };
      rateWindows.set(key, w);
    }
    w.count += 1;
    if (w.count > max) {
      const retry = Math.ceil((w.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: '请求过于频繁，请 ' + retry + ' 秒后再试' });
    }
    next();
  };
}

// 操作审计：记录后台关键动作（登录 / 产品增删改 / 改口令），供审计面板追溯
function logAudit(action, detail, ip) {
  try {
    db.prepare('INSERT INTO audit_log (action, detail, ip, ts) VALUES (?,?,?,?)')
      .run(action, detail || '', ip || '', Date.now());
  } catch (e) {}
}

/* ============ 前台公开接口（无需登录） ============ */

// 浏览上报（含来源 / 地域分析字段，限流防刷）
router.post('/views', rateLimit('views', 60, 60 * 1000), (req, res) => {
  const b = req.body || {};
  const page = (b.page || 'unknown').toString().slice(0, 200);
  const referer = typeof b.referer === 'string' ? b.referer.slice(0, 500) : '';
  const ua = typeof b.ua === 'string' ? b.ua.slice(0, 500) : '';
  const lang = typeof b.lang === 'string' ? b.lang.slice(0, 50) : '';
  const tz = typeof b.tz === 'string' ? b.tz.slice(0, 100) : '';
  db.prepare('INSERT INTO visits (page, ip, referer, ua, lang, tz, ts) VALUES (?,?,?,?,?,?,?)')
    .run(page, req.ip, referer, ua, lang, tz, Date.now());
  res.json({ ok: true });
});

// 下载点击上报（限流防刷 + 同 IP 24h 窗口去重，维度 66：防刷重复累计）
router.post('/downloads', rateLimit('downloads', 30, 60 * 1000), (req, res) => {
  const productId = req.body && req.body.productId ? Number(req.body.productId) : null;
  if (!productId) return res.status(400).json({ error: 'productId required' });
  const ip = req.ip || '';
  // 同一 IP 对同一产品在 24h 窗口内只计 1 次（幂等，重复上报返回 ok 但不重复计数）
  const dup = db
    .prepare('SELECT 1 FROM downloads WHERE product_id=? AND ip=? AND ts>=? LIMIT 1')
    .get(productId, ip, Date.now() - 24 * 3600 * 1000);
  if (!dup) {
    db.prepare('INSERT INTO downloads (product_id, ip, ts) VALUES (?,?,?)').run(productId, ip, Date.now());
  }
  res.json({ ok: true });
});

// 联系留言上报（公开，限流防垃圾）
router.post('/contact', rateLimit('contact', 30, 10 * 60 * 1000), (req, res) => {
  const b = req.body || {};
  // 蜜罐：机器人常填的隐藏字段（人类不可见），命中即判定为垃圾提交
  if (b.company || b.website || b.url || b.hp) {
    return res.status(400).json({ error: '提交被拦截' });
  }
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim();
  const message = String(b.message || '').trim();
  if (!name || !message) return res.status(400).json({ error: '请填写称呼与留言内容' });
  if (name.length > 60 || message.length > 1000) {
    return res.status(400).json({ error: '内容超出长度限制' });
  }
  if (email) {
    if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }
  }
  db.prepare('INSERT INTO contacts (name, email, message, ts) VALUES (?,?,?,?)')
    .run(name, email || '', message, Date.now());
  res.json({ ok: true });
});

// 拉取已上架产品（对外只暴露必要字段；按排序权重 sort DESC 排，权重越大越靠前）
router.get('/products', (req, res) => {
  const type = req.query.type;
  const category = typeof req.query.category === 'string' && req.query.category.trim() ? req.query.category.trim() : null;
  let rows;
  if (type === 'app' || type === 'game') {
    if (category) {
      rows = db
        .prepare("SELECT id, name, type, category, desc, icon, image, download_url, version, changelog, sort, created_at, (SELECT COUNT(*) FROM downloads d WHERE d.product_id = products.id) AS downloads FROM products WHERE status='on' AND type=? AND category=? ORDER BY sort DESC, id")
        .all(type, category);
    } else {
      rows = db
        .prepare("SELECT id, name, type, category, desc, icon, image, download_url, version, changelog, sort, created_at, (SELECT COUNT(*) FROM downloads d WHERE d.product_id = products.id) AS downloads FROM products WHERE status='on' AND type=? ORDER BY sort DESC, id")
        .all(type);
    }
  } else if (category) {
    rows = db
      .prepare("SELECT id, name, type, category, desc, icon, image, download_url, version, changelog, sort, created_at, (SELECT COUNT(*) FROM downloads d WHERE d.product_id = products.id) AS downloads FROM products WHERE status='on' AND category=? ORDER BY sort DESC, id")
      .all(category);
  } else {
    rows = db
      .prepare("SELECT id, name, type, category, desc, icon, image, download_url, version, changelog, sort, created_at, (SELECT COUNT(*) FROM downloads d WHERE d.product_id = products.id) AS downloads FROM products WHERE status='on' ORDER BY sort DESC, id")
      .all();
  }
  res.json(rows);
});

// 产品分类枚举（公开，维度 58）：后台可维护，下载页分类区据此自动生成
router.get('/categories', (req, res) => {
  res.json(db.prepare('SELECT id, name FROM categories ORDER BY id').all());
});

// 当前生效公告（公开，候选G3）：前台公告条取最新一条启用中的公告；无则返回 null
router.get('/announcement', (req, res) => {
  const row = db.prepare('SELECT id, content, created_at, updated_at FROM announcements WHERE enabled=1 ORDER BY id DESC LIMIT 1').get();
  res.json(row || null);
});

// 热门下载排行（公开，维度 65）：按下载量降序取 TOP N（默认 5，clamp 1–10）
router.get('/products/hot', (req, res) => {
  const n = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 10);
  const rows = db
    .prepare("SELECT id, name, type, category, desc, icon, image, download_url, version, changelog, sort, (SELECT COUNT(*) FROM downloads d WHERE d.product_id = products.id) AS downloads FROM products WHERE status='on' ORDER BY downloads DESC, sort DESC, id LIMIT ?")
    .all(n);
  res.json(rows);
});

// 单个产品详情（对外只暴露已上架；缺失/下架返回 404）
router.get('/products/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const row = db
    .prepare("SELECT id, name, type, category, desc, icon, image, download_url, version, changelog, (SELECT COUNT(*) FROM downloads d WHERE d.product_id = products.id) AS downloads FROM products WHERE id=? AND status='on'")
    .get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// 相关推荐（候选G4）：同分类优先 → 同类型补充 → 其余兜底，均排除自身，
// 排序按下载量、权重、ID 综合；limit 默认 4（clamp 1–8）
router.get('/products/:id/related', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const self = db.prepare("SELECT id, type, category FROM products WHERE id=? AND status='on'").get(id);
  if (!self) return res.status(404).json({ error: 'not found' });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 4, 1), 8);
  const SEL = "SELECT id, name, type, category, desc, icon, image, download_url, version, changelog, sort, (SELECT COUNT(*) FROM downloads d WHERE d.product_id = products.id) AS downloads FROM products WHERE status='on' AND id != ?";
  const rows = db.prepare(SEL + " AND category = ? ORDER BY downloads DESC, sort DESC, id LIMIT ?").all(id, self.category, limit);
  if (rows.length >= limit) return res.json(rows);
  const fill = db.prepare(SEL + " AND category != ? AND type = ? ORDER BY downloads DESC, sort DESC, id LIMIT ?").all(id, self.category, self.type, limit - rows.length);
  rows.push.apply(rows, fill);
  if (rows.length >= limit) return res.json(rows);
  const rest = db.prepare(SEL + " AND category != ? AND type != ? ORDER BY downloads DESC, sort DESC, id LIMIT ?").all(id, self.category, self.type, limit - rows.length);
  rows.push.apply(rows, rest);
  res.json(rows);
});

// 产品反馈聚合（H6a 前台评分聚合）：仅展示已审核(status='done')的反馈——
// 后台将反馈标记「已处理」即视为审核通过，前台才可见。返回平均分(按有评分者计)、
// 评分人数、最新 limit 条摘要（默认 5，clamp 1~20）。
router.get('/products/:id/feedback', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const p = db.prepare("SELECT 1 FROM products WHERE id=? AND status='on'").get(id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
  const agg = db.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN rating>0 THEN 1 ELSE 0 END),0) AS rated, COALESCE(SUM(rating),0) AS sum FROM feedback WHERE product_id=? AND status='done'"
  ).get(id);
  const rows = db.prepare(
    "SELECT id, name, content, rating, ts FROM feedback WHERE product_id=? AND status='done' ORDER BY ts DESC, id DESC LIMIT ?"
  ).all(id, limit);
  const rated = agg.rated || 0;
  res.json({
    count: agg.n || 0,
    ratedCount: rated,
    avg: rated ? Math.round((agg.sum / rated) * 10) / 10 : 0,
    rows: rows
  });
});

/* ============ 后台接口（Bearer Token） ============ */

// 产品图片直传（维度 67）：后台上传图片 → 存 assets/img/products/，返回站内路径供 f-image 使用
const UP_DIR = path.join(__dirname, '..', 'assets', 'img', 'products');
const UP_MAX_BYTES = 2 * 1024 * 1024; // 单图 ≤ 2MB
const UP_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
// 魔数嗅探（阻止伪装文件）：返回与声明 MIME 比对
function sniffImage(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 6 && buf.toString('latin1', 0, 6) === 'GIF89a') return 'image/gif';
  return null;
}
router.post('/admin/upload', authMiddleware, requireAdmin, (req, res) => {
  const data = req.body && req.body.data;
  if (typeof data !== 'string' || data.length > UP_MAX_BYTES * 1.6) {
    return res.status(400).json({ error: '图片数据缺失或过大' });
  }
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/.exec(data);
  if (!m) return res.status(400).json({ error: '仅支持 base64 图片数据' });
  const ext = UP_TYPES[m[1]];
  if (!ext) return res.status(400).json({ error: '仅支持 PNG / JPG / WebP / GIF' });
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch (e) { return res.status(400).json({ error: '图片数据解码失败' }); }
  if (!buf.length || buf.length > UP_MAX_BYTES) return res.status(400).json({ error: '图片大小须在 2MB 以内' });
  if (sniffImage(buf) !== m[1]) return res.status(400).json({ error: '图片内容校验失败' });
  const name = 'prod-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
  try {
    fs.mkdirSync(UP_DIR, { recursive: true });
    fs.writeFileSync(path.join(UP_DIR, name), buf);
  } catch (e) {
    return res.status(500).json({ error: '图片保存失败' });
  }
  logAudit('image_upload', name + ' ' + m[1] + ' ' + buf.length + 'B', req.ip);
  res.json({ ok: true, url: '/assets/img/products/' + name });
});

// 登录防爆破：单 IP 连续失败达到阈值后锁定一段时间（进程内计数，服务重启后重置）
const loginAttempts = new Map();
const MAX_LOGIN_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000; // 锁定 15 分钟
function getLoginLock(ip) {
  const a = loginAttempts.get(ip);
  if (!a) return null;
  if (a.lockUntil && a.lockUntil > Date.now()) return a; // 仍在锁定中
  if (a.lockUntil) loginAttempts.delete(ip); // 锁定已过期，清理
  return null;
}

// 登录：校验口令，返回由该口令动态派生的 Token
router.post('/admin/login', (req, res) => {
  const ip = req.ip;
  const locked = getLoginLock(ip);
  if (locked) {
    const retry = Math.ceil((locked.lockUntil - Date.now()) / 1000);
    return res.status(429).json({ error: '尝试次数过多，请 ' + retry + ' 秒后再试' });
  }
  const username = (req.body && req.body.username) || '';
  const password = (req.body && req.body.password) || '';
  const user = verifyPassword(username, password);
  if (!user) {
    const a = loginAttempts.get(ip) || { count: 0, lockUntil: 0 };
    a.count += 1;
    if (a.count >= MAX_LOGIN_FAILS) { a.lockUntil = Date.now() + LOGIN_LOCK_MS; a.count = 0; }
    loginAttempts.set(ip, a);
    return res.status(401).json({ error: '用户名或口令不正确' });
  }
  loginAttempts.delete(ip); // 登录成功，清零失败计数
  logAudit('login', 'user=' + user.username, req.ip);
  res.json({ token: makeToken(user), expiresAt: Date.now() + TOKEN_TTL_MS, role: user.role, username: user.username });
});

// 修改后台口令（需登录）：更新当前登录用户口令，成功后返回新 Token，旧 Token 立即失效
router.put('/admin/password', authMiddleware, requireAdmin, (req, res) => {
  const b = req.body || {};
  const oldPassword = (b.oldPassword || '').toString();
  const newPassword = (b.newPassword || '').toString();
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '请填写原口令与新口令' });
  if (newPassword.length < 6) return res.status(400).json({ error: '新口令至少 6 位' });
  if (!verifyPassword(req.user.username, oldPassword)) return res.status(401).json({ error: '原口令不正确' });
  updatePassword(req.user.username, newPassword);
  logAudit('password_change', 'user=' + req.user.username, req.ip);
  const refreshed = verifyPassword(req.user.username, newPassword);
  res.json({ ok: true, token: makeToken(refreshed), expiresAt: Date.now() + TOKEN_TTL_MS });
});

// 管理员账号管理（仅管理员可操作）
const { addAdmin, updateAdminRole, deleteAdmin } = require('./auth');
router.get('/admin/admins', authMiddleware, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, username, role, created_at FROM admins ORDER BY id').all();
  res.json(rows);
});
router.post('/admin/admins', authMiddleware, requireAdmin, (req, res) => {
  const b = req.body || {};
  const username = (b.username || '').toString().trim();
  const password = (b.password || '').toString();
  const role = b.role === 'viewer' ? 'viewer' : 'admin';
  if (!username || !password) return res.status(400).json({ error: '请填写用户名与新口令' });
  if (password.length < 6) return res.status(400).json({ error: '新口令至少 6 位' });
  if (!/^[A-Za-z0-9_.\-]{2,32}$/.test(username)) return res.status(400).json({ error: '用户名仅允许字母/数字/._-，2-32 位' });
  try {
    const info = addAdmin(username, password, role);
    logAudit('admin_add', 'user=' + username + ' role=' + role, req.ip);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    // UNIQUE 冲突 → 用户名已存在
    if (String(e.message || '').indexOf('UNIQUE') !== -1) return res.status(409).json({ error: '用户名已存在' });
    return res.status(500).json({ error: '创建失败' });
  }
});

// 修改管理员角色（仅管理员）：降级前检查是否最后一个 admin，防止后台锁死（无人再能写操作）
router.put('/admin/admins/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
  const row = db.prepare('SELECT id, username, role FROM admins WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const role = req.body && req.body.role;
  if (role !== 'admin' && role !== 'viewer') return res.status(400).json({ error: 'invalid role' });
  if (role === row.role) return res.json({ ok: true }); // 角色未变，幂等返回
  if (row.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS c FROM admins WHERE role='admin'").get().c;
    if (adminCount <= 1) return res.status(400).json({ error: '不能降级最后一个管理员，否则后台将无人可管理' });
  }
  updateAdminRole(id, role);
  logAudit('admin_role', 'id=' + id + ' ' + row.username + ' -> ' + role, req.ip);
  res.json({ ok: true });
});

// 删除管理员账号（仅管理员）：不能删除当前登录账号，不能删除最后一个 admin（防止后台锁死）
router.delete('/admin/admins/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
  const row = db.prepare('SELECT id, username, role FROM admins WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.username === req.user.username) return res.status(400).json({ error: '不能删除当前登录的账号' });
  if (row.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS c FROM admins WHERE role='admin'").get().c;
    if (adminCount <= 1) return res.status(400).json({ error: '不能删除最后一个管理员，否则后台将无人可管理' });
  }
  deleteAdmin(id);
  logAudit('admin_delete', 'id=' + id + ' ' + row.username, req.ip);
  res.json({ ok: true });
});

// 数据库备份（需登录）：在线备份（合并 WAL，保证一致性）后以附件形式下载
router.get('/admin/backup', authMiddleware, requireAdmin, function (req, res) {
  const ts = new Date();
  const pad = function (n) { return (n < 10 ? '0' : '') + n; };
  const stamp = ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) + '-' +
    pad(ts.getHours()) + pad(ts.getMinutes());
  const fileName = 'lvjiaoxi-backup-' + stamp + '.db';
  const src = db.dbPath;
  const tmp = src + '.backup-' + Date.now();
  const cleanup = function () { try { fs.unlinkSync(tmp); } catch (e) {} };
  const send = function (err) {
    if (err) { cleanup(); return res.status(500).json({ error: 'backup failed' }); }
    res.download(tmp, fileName, function () { cleanup(); });
  };
  logAudit('db_backup', fileName, req.ip);
  // 优先使用 better-sqlite3 在线备份（合并 WAL，确保一致性）；旧版本无 backup 则直接拷贝主库
  if (typeof db.backup === 'function') {
    db.backup(tmp).then(function () { send(null); }).catch(send);
  } else {
    try { fs.copyFileSync(src, tmp); send(null); } catch (e) { send(e); }
  }
});

// 看板数据
router.get('/admin/stats', authMiddleware, (req, res) => {
  const totalVisits = db.prepare('SELECT COUNT(*) AS c FROM visits').get().c;
  const totalDownloads = db.prepare('SELECT COUNT(*) AS c FROM downloads').get().c;
  const totalContacts = db.prepare('SELECT COUNT(*) AS c FROM contacts').get().c;
  const pendingContacts = db.prepare("SELECT COUNT(*) AS c FROM contacts WHERE status != 'done'").get().c;
  const pageVisits = db.prepare('SELECT page, COUNT(*) AS c FROM visits GROUP BY page').all();
  const productDownloads = db
    .prepare(
      `SELECT p.id, p.name, p.type, p.status, COUNT(d.id) AS c
       FROM products p LEFT JOIN downloads d ON d.product_id = p.id
       GROUP BY p.id ORDER BY p.id`
    )
    .all();
  const topProducts = productDownloads
    .slice()
    .sort((a, b) => b.c - a.c)
    .slice(0, 8)
    .map((p) => ({ id: p.id, name: p.name, type: p.type, status: p.status, c: p.c }));

  // 流量来源分析：按 referer 归类（直接 / 搜索 / 社交 / 引荐 / 其他）
  // 一次全表扫描同时产出 来源 / 语言 / 时区 / 浏览器 / 系统 五个分布（替代原先 3 次独立查询）
  const visitRows = db.prepare('SELECT referer, ua, lang, tz FROM visits').all();
  const refs = visitRows.map((r) => r.referer || '');
  const buckets = { direct: 0, search: 0, social: 0, referral: 0, other: 0 };
  const hostCount = {};
  refs.forEach((ref) => {
    const cat = categorizeSource(ref);
    buckets[cat] = (buckets[cat] || 0) + 1;
    if (ref) {
      try {
        const h = new URL(ref).hostname;
        if (h) hostCount[h] = (hostCount[h] || 0) + 1;
      } catch (e) {}
    }
  });
  const sourceLabels = {
    direct: '直接访问',
    search: '搜索引擎',
    social: '社交平台',
    referral: '外部引荐',
    other: '其他',
  };
  const sources = Object.keys(buckets)
    .map((k) => ({ key: k, label: sourceLabels[k], c: buckets[k] }))
    .sort((a, b) => b.c - a.c);
  const topReferrers = Object.keys(hostCount)
    .map((h) => ({ host: h, c: hostCount[h] }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 10);

  // 地域 / 语言 / 浏览器 / 系统 分布（零依赖：取浏览器语言、时区与 UA 粗分，均为已存字段）
  const langCount = {};
  const tzCount = {};
  const browserCount = {};
  const osCount = {};
  visitRows.forEach((r) => {
    const l = r.lang || '未知';
    const t = r.tz || '未知';
    langCount[l] = (langCount[l] || 0) + 1;
    tzCount[t] = (tzCount[t] || 0) + 1;
    const u = parseUa(r.ua);
    browserCount[u.browser] = (browserCount[u.browser] || 0) + 1;
    osCount[u.os] = (osCount[u.os] || 0) + 1;
  });
  const topLangs = Object.keys(langCount)
    .map((l) => ({ lang: l, c: langCount[l] }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 8);
  const topTimezones = Object.keys(tzCount)
    .map((t) => ({ tz: t, c: tzCount[t] }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 8);
  const topBrowsers = Object.keys(browserCount)
    .map((b) => ({ name: b, c: browserCount[b] }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 8);
  const topOses = Object.keys(osCount)
    .map((o) => ({ name: o, c: osCount[o] }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 8);

  // 反馈概览（H6d）：总数 / 未处理 / 评分均值 + 按产品分布 top5 + 近7天新增趋势
  const fbTotal = db.prepare('SELECT COUNT(*) AS c FROM feedback').get().c;
  const fbPending = db.prepare("SELECT COUNT(*) AS c FROM feedback WHERE status != 'done'").get().c;
  const fbAgg = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN rating>0 THEN 1 ELSE 0 END),0) AS rated, COALESCE(SUM(rating),0) AS sum FROM feedback"
  ).get();
  const fbRated = fbAgg.rated;
  const fbByProduct = db.prepare(
    "SELECT COALESCE(p.name, '#已删除产品') AS name, COUNT(f.id) AS c FROM feedback f LEFT JOIN products p ON p.id=f.product_id GROUP BY f.product_id ORDER BY c DESC LIMIT 5"
  ).all();
  const fbDayFmt = "strftime('%Y-%m-%d', ts/1000, 'unixepoch', 'localtime')";
  const fbDayMap = {};
  db.prepare('SELECT ' + fbDayFmt + ' AS d, COUNT(*) AS c FROM feedback WHERE ts >= ? GROUP BY d')
    .all(todayStart() - 6 * 86400000)
    .forEach(function (r) { fbDayMap[r.d] = r.c; });
  const fb7d = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(todayStart() - i * 86400000);
    const key =
      dt.getFullYear() + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' +
      String(dt.getDate()).padStart(2, '0');
    fb7d.push({ date: dt.getMonth() + 1 + '-' + dt.getDate(), c: fbDayMap[key] || 0 });
  }

  res.json({
    totalVisits,
    totalDownloads,
    totalContacts,
    pendingContacts,
    pageVisits,
    productDownloads,
    topProducts,
    sources,
    topReferrers,
    topLangs,
    topTimezones,
    browsers: topBrowsers,
    oses: topOses,
    daily: bucketDaily(14),
    feedback: {
      total: fbTotal,
      pending: fbPending,
      ratedCount: fbRated,
      avg: fbRated ? Math.round((fbAgg.sum / fbRated) * 10) / 10 : 0,
      byProduct: fbByProduct,
      week: fb7d
    }
  });
});

// 流量趋势（可切换天数）：days 钳制 1~90（默认 14），返回每日浏览/下载 + 区间合计
router.get('/admin/stats/trend', authMiddleware, (req, res) => {
  let days = parseInt(req.query.days, 10);
  if (!Number.isInteger(days) || days < 1 || days > 90) days = 14;
  const range = bucketDaily(days);
  let visits = 0;
  let downloads = 0;
  range.forEach((d) => { visits += d.visits; downloads += d.downloads; });
  res.json({ days, total: { visits, downloads }, range });
});

// 系统信息（需登录）：运维自检，配合公开 /api/health 使用
router.get('/admin/sysinfo', authMiddleware, (req, res) => {
  let dbSize = 0;
  try {
    const st = fs.statSync(path.join(__dirname, '..', 'data', 'app.db'));
    dbSize = st.size;
  } catch (e) {}
  const counts = {
    products: db.prepare('SELECT COUNT(*) AS c FROM products').get().c,
    onShelf: db.prepare("SELECT COUNT(*) AS c FROM products WHERE status='on'").get().c,
    visits: db.prepare('SELECT COUNT(*) AS c FROM visits').get().c,
    downloads: db.prepare('SELECT COUNT(*) AS c FROM downloads').get().c,
    contacts: db.prepare('SELECT COUNT(*) AS c FROM contacts').get().c,
  };
  // 备份可观测性：复用 backup.getStatus()（与 /api/health/detail 同一实现）
  let backup = { count: 0, lastTs: null, lastName: null, totalBytes: 0, stale: true, dir: null };
  try {
    backup = require('./backup.js').getStatus();
  } catch (e) { /* 备份目录不可读时保持默认值 */ }

  res.json({
    uptime: Math.floor(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    dbSize,
    defaultPassword: isDefaultPassword(req.user.username),
    currentUser: req.user.username,
    currentRole: req.user.role,
    serverTime: new Date().toISOString(),
    counts,
    backup,
  });
});

// 站点维护模式（维度 73）：读取当前状态（需登录）
router.get('/admin/maintenance', authMiddleware, (req, res) => {
  const get = (key) => {
    const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return r ? r.value : '';
  };
  res.json({ enabled: get('maintenance') === '1', message: get('maintenance_msg') });
});

// 站点维护模式：开启 / 关闭（admin，写审计；message 为维护页提示语，≤200 字符）
router.put('/admin/maintenance', authMiddleware, requireAdmin, (req, res) => {
  const enabled = req.body && req.body.enabled ? 1 : 0;
  const msg = String((req.body && req.body.message != null) ? req.body.message : '').trim();
  if (msg.length > 200) return res.status(400).json({ error: '维护提示语过长（≤200 字符）' });
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  upsert.run('maintenance', String(enabled));
  upsert.run('maintenance_msg', msg);
  logAudit(enabled ? 'maintenance_on' : 'maintenance_off', 'msg=' + (msg || '-'), req.ip);
  res.json({ ok: true, enabled: enabled === 1, message: msg });
});

// 操作审计日志（需登录）：服务端分页 + 关键词（操作/详情/IP）+ 操作类型筛选
router.get('/admin/audit', authMiddleware, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
  const keyword = String(req.query.keyword || '').trim();
  const action = String(req.query.action || '').trim();
  const where = [];
  const params = [];
  if (keyword) {
    const kw = '%' + keyword + '%';
    where.push('(action LIKE ? OR detail LIKE ? OR ip LIKE ?)');
    params.push(kw, kw, kw);
  }
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) AS c FROM audit_log' + whereSql).get(...params).c;
  const rows = db
    .prepare('SELECT id, action, detail, ip, ts FROM audit_log' + whereSql + ' ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?')
    .all(...params, pageSize, (page - 1) * pageSize);
  res.json({ rows, total });
});

// 访问日志尾部查看（运维可观测性，需登录）：返回 data/access.log 最近 N 行（含轮转备份 .1）
router.get('/admin/accesslog', authMiddleware, (req, res) => {
  const n = Math.min(parseInt(req.query.lines) || 100, 500);
  const logPath = path.join(__dirname, '..', 'data', 'access.log');
  const readTail = (file) => {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const lines = text.split('\n').filter(Boolean);
      return lines.slice(-n);
    } catch (e) {
      return [];
    }
  };
  const lines = readTail(logPath);
  const bak = logPath + '.1';
  if (lines.length < n) {
    const extra = readTail(bak).slice(-(n - lines.length));
    lines.unshift(...extra);
  }
  res.json({ lines: lines.slice(-n) });
});

// 将 referer 归类到流量来源维度（零依赖，纯字符串匹配）
function categorizeSource(referer) {
  if (!referer) return 'direct';
  var r;
  try {
    r = new URL(referer).hostname.toLowerCase();
  } catch (e) {
    return 'other';
  }
  if (!r) return 'direct';
  var searchEngines = ['google.', 'bing.', 'baidu.', 'sogou.', 'so.com', 'yahoo.', 'duckduckgo.', 'yandex.'];
  var social = [
    'weibo.', 't.cn', 'qq.com', 'qzone.', 'weixin.', 'zhihu.', 'douyin.', 'bytedance.',
    'x.com', 'twitter.', 'facebook.', 'linkedin.', 'reddit.', 'youtube.', 'instagram.', 'telegram.',
    'xiaohongshu.', 'xhslink.', 'tieba.', 'douban.'
  ];
  for (var i = 0; i < searchEngines.length; i++) if (r.indexOf(searchEngines[i]) !== -1) return 'search';
  for (var j = 0; j < social.length; j++) if (r.indexOf(social[j]) !== -1) return 'social';
  return 'referral';
}

// 浏览器 / 操作系统识别（维度 75：零依赖，从已存的 UA 字符串粗分）
// 顺序敏感：先特判 Edge/Opera/Samsung/微信/雅虎，再 Chrome/Firefox，最后 Safari/IE
function parseUa(ua) {
  if (!ua) return { browser: '未知', os: '未知' };
  const s = String(ua);
  let browser = '未知';
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(s)) browser = 'Samsung';
  else if (/MicroMessenger/i.test(s)) browser = '微信';
  else if (/YaBrowser/i.test(s)) browser = 'Yandex';
  else if (/Chrome\/|CriOS\//i.test(s)) browser = 'Chrome';
  else if (/Firefox\/|FxiOS\//i.test(s)) browser = 'Firefox';
  else if (/Safari\//i.test(s)) browser = 'Safari';
  else if (/MSIE|Trident/i.test(s)) browser = 'IE';
  let os = '未知';
  if (/Windows NT/i.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'macOS';
  else if (/CrOS/i.test(s)) os = 'ChromeOS';
  else if (/Linux/i.test(s)) os = 'Linux';
  return { browser: browser, os: os };
}

// 近 N 天每日浏览/下载量（按本地日期分桶；SQL 聚合 + 本地时区补零）
// 本地时区当日 0 点时间戳（反馈/访问按天聚合的区间起点）
function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketDaily(days) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today.getTime() - (days - 1) * 86400000;
  const dayFmt = "strftime('%Y-%m-%d', ts/1000, 'unixepoch', 'localtime')";
  const vMap = {};
  db.prepare(`SELECT ${dayFmt} AS d, COUNT(*) AS c FROM visits WHERE ts >= ? GROUP BY d`)
    .all(start)
    .forEach((r) => { vMap[r.d] = r.c; });
  const dMap = {};
  db.prepare(`SELECT ${dayFmt} AS d, COUNT(*) AS c FROM downloads WHERE ts >= ? GROUP BY d`)
    .all(start)
    .forEach((r) => { dMap[r.d] = r.c; });
  const out = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(start + i * 86400000);
    const key =
      dt.getFullYear() + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' +
      String(dt.getDate()).padStart(2, '0');
    out.push({ date: dt.getMonth() + 1 + '-' + dt.getDate(), visits: vMap[key] || 0, downloads: dMap[key] || 0 });
  }
  return out;
}

// 全部产品（含已下架），附带各产品累计下载量；按排序权重 sort DESC 排，便于运营直观看到前台顺序
router.get('/admin/products', authMiddleware, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, COUNT(d.id) AS downloads
       FROM products p LEFT JOIN downloads d ON d.product_id = p.id
       GROUP BY p.id ORDER BY p.sort DESC, p.id`
    )
    .all();
  res.json(rows);
});

// 产品字段校验（新增 / 编辑共用）。existing 为编辑时的现有行（缺省值来源）。
// 返回 { ok:true, name, type, category, desc, icon, download_url, sort } 或 { ok:false, error }
function normalizeProduct(b, existing) {
  if (!b || typeof b !== 'object') return { ok: false, error: 'invalid body' };
  var name = b.name !== undefined ? b.name : (existing ? existing.name : '');
  var type = b.type !== undefined ? b.type : (existing ? existing.type : undefined);
  var category = b.category !== undefined ? b.category : (existing ? existing.category : '');
  var desc = b.desc !== undefined ? b.desc : (existing ? existing.desc : '');
  var icon = b.icon !== undefined ? b.icon : (existing ? existing.icon : '');
  var image = b.image !== undefined ? b.image : (existing ? existing.image : '');
  var download_url = b.download_url !== undefined ? b.download_url : (existing ? existing.download_url : '');
  var version = b.version !== undefined ? b.version : (existing ? existing.version : '');
  var changelog = b.changelog !== undefined ? b.changelog : (existing ? existing.changelog : '');
  var sort = b.sort !== undefined ? b.sort : (existing ? existing.sort : 0);
  if (type !== 'app' && type !== 'game') return { ok: false, error: 'type must be app or game' };
  name = String(name == null ? '' : name).trim();
  category = String(category == null ? '' : category).trim();
  desc = String(desc == null ? '' : desc);
  icon = String(icon == null ? '' : icon).trim();
  image = String(image == null ? '' : image).trim();
  download_url = String(download_url == null ? '' : download_url).trim();
  // 版本/更新日志（维度 62）：version 短文本，changelog 多行；均为可空
  version = String(version == null ? '' : version).trim();
  changelog = String(changelog == null ? '' : changelog).trim();
  // 排序权重：整数，范围 -9999 ~ 9999（越大越靠前）；空值视为 0
  if (sort === '' || sort == null) sort = 0;
  sort = Number(sort);
  if (!Number.isInteger(sort)) return { ok: false, error: '排序权重须为整数' };
  if (sort < -9999 || sort > 9999) return { ok: false, error: '排序权重范围 -9999 ~ 9999' };
  if (!name) return { ok: false, error: 'name is required' };
  if (name.length > 80) return { ok: false, error: '名称过长（≤80 字符）' };
  if (category.length > 40) return { ok: false, error: '分类过长（≤40 字符）' };
  if (category && !validCategory(category)) return { ok: false, error: '分类含非法字符（仅限中英文、数字与常用分隔符）' };
  // 维度 58：分类须为后台维护的枚举项（空 = 不分类）
  if (category && !db.prepare('SELECT 1 FROM categories WHERE name=?').get(category)) {
    return { ok: false, error: '分类须为后台分类枚举中的项（可在「产品分类管理」中添加）' };
  }
  if (desc.length > 500) return { ok: false, error: '简介过长（≤500 字符）' };
  if (icon.length > 8) return { ok: false, error: '图标过长（≤8 字符）' };
  if (icon && !validIcon(icon)) return { ok: false, error: '图标仅限 emoji（如 📝 / 🚀）' };
  if (image.length > 500) return { ok: false, error: '产品图地址过长（≤500 字符）' };
  if (!validProductImage(image)) return { ok: false, error: '产品图须为 http(s) 链接或 /assets/img/… 图片路径' };
  if (version.length > 30) return { ok: false, error: '版本号过长（≤30 字符）' };
  if (changelog.length > 2000) return { ok: false, error: '更新日志过长（≤2000 字符）' };
  var urlErr = validDownloadUrl(download_url);
  if (urlErr) return { ok: false, error: urlErr };
  return { ok: true, name: name, type: type, category: category, desc: desc, icon: icon, image: image, download_url: download_url, version: version, changelog: changelog, sort: sort };
}
// 分类：自由文本但限制字符集（拦截控制符 / HTML 标签 / 引号，防止注入到页面与 RSS）
// 允许：中英文、数字、空白、下划线，以及常用分隔符（/ 、 , . - · （） #）
function validCategory(s) {
  return /^[\p{Script=Han}A-Za-z0-9_\s/、,.\-#·()（）]+$/u.test(s);
}
// 图标：仅 emoji（扩展象形文字 + ZWJ 序列 + 变体选择符），拒绝字母 / HTML / 控制字符
function validIcon(s) {
  return /^[\p{Extended_Pictographic}\u200d\ufe0f]+$/u.test(s);
}
// 产品大图（维度 59）：允许空（卡片回退 emoji）、http(s) 链接、或站内 /assets/img/ 图片路径
// 拒绝 javascript:/data: 等危险协议与任意外链（防止注入与信息泄露）
function validProductImage(s) {
  if (!s) return true;
  if (/^https?:\/\//i.test(s)) return /^https?:\/\/[^\s"'<>]+$/i.test(s);
  if (s.charAt(0) === '/') return /^\/assets\/img\/[A-Za-z0-9_\-./]+\.(jpe?g|png|webp|avif|gif|svg)$/i.test(s);
  return false;
}
// 下载链接：允许为空（可选）或 http(s) / 站内相对路径；拒绝 javascript:/data:/vbscript: 等危险协议
function validDownloadUrl(u) {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return null;
  if (/^(\/|#|\.\/|\.\.\/)/.test(u)) return null;
  if (/^(downloads?|assets)\//i.test(u)) return null;
  return '下载链接须为 http(s) 或站内相对路径';
}

// 新增产品（默认上架）
router.post('/admin/products', authMiddleware, requireAdmin, (req, res) => {
  const r = normalizeProduct(req.body, null);
  if (!r.ok) return res.status(400).json({ error: r.error });
  const info = db
    .prepare(
      "INSERT INTO products (name, type, category, desc, icon, image, download_url, sort, status, created_at, version, changelog) VALUES (?,?,?,?,?,?,?,?,'on',?,?,?)"
    )
    .run(r.name, r.type, r.category, r.desc, r.icon, r.image, r.download_url, r.sort, Date.now(), r.version, r.changelog);
  logAudit('product_add', 'id=' + info.lastInsertRowid, req.ip);
  res.json({ id: info.lastInsertRowid });
});

// 编辑 / 上下架切换
router.put('/admin/products/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const r = normalizeProduct(req.body, existing);
  if (!r.ok) return res.status(400).json({ error: r.error });
  var status = (req.body && req.body.status !== undefined) ? req.body.status : existing.status;
  if (status !== 'on' && status !== 'off') status = existing.status;
  db.prepare(
    'UPDATE products SET name=?, type=?, category=?, desc=?, icon=?, image=?, version=?, changelog=?, download_url=?, sort=?, status=? WHERE id=?'
  ).run(r.name, r.type, r.category, r.desc, r.icon, r.image, r.version, r.changelog, r.download_url, r.sort, status, id);
  logAudit('product_edit', 'id=' + id, req.ip);
  res.json({ ok: true });
});

// 删除产品
router.delete('/admin/products/:id', authMiddleware, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(Number(req.params.id));
  logAudit('product_delete', 'id=' + req.params.id, req.ip);
  res.json({ ok: true });
});

/* ============ 产品批量管理（维度 74：多选批量上/下架、改分类、删除） ============ */

// 批量操作公共校验：ids 须为非空正整数数组（1~500 个，防滥用），返回规范化数组或 null
function normalizeBulkIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) return null;
  const out = [];
  for (const v of ids) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) return null;
    out.push(n);
  }
  return out;
}

// 批量上架 / 下架（transaction 保证计数准确；不存在/已下架的 id 不报错，返回实际变更数）
router.post('/admin/products/bulk/status', authMiddleware, requireAdmin, (req, res) => {
  const ids = normalizeBulkIds(req.body && req.body.ids);
  if (!ids) return res.status(400).json({ error: 'ids 须为 1~500 个正整数' });
  const status = req.body && req.body.status;
  if (status !== 'on' && status !== 'off') return res.status(400).json({ error: 'status 须为 on 或 off' });
  const st = db.prepare('UPDATE products SET status=? WHERE id=?');
  const tx = db.transaction((list) => list.reduce((n, id) => n + st.run(status, id).changes, 0));
  const changed = tx(ids);
  logAudit(status === 'on' ? 'product_bulk_on' : 'product_bulk_off', 'count=' + changed, req.ip);
  res.json({ ok: true, changed: changed });
});

// 批量改分类（category 为空字符串 = 取消分类；须为后台分类枚举项，与单条编辑规则一致）
router.post('/admin/products/bulk/category', authMiddleware, requireAdmin, (req, res) => {
  const ids = normalizeBulkIds(req.body && req.body.ids);
  if (!ids) return res.status(400).json({ error: 'ids 须为 1~500 个正整数' });
  const category = String(req.body && req.body.category != null ? req.body.category : '').trim();
  if (category.length > 40) return res.status(400).json({ error: '分类过长（≤40 字符）' });
  if (category && !validCategory(category)) return res.status(400).json({ error: '分类含非法字符（仅限中英文、数字与常用分隔符）' });
  if (category && !db.prepare('SELECT 1 FROM categories WHERE name=?').get(category)) {
    return res.status(400).json({ error: '分类须为后台分类枚举中的项（可在「产品分类管理」中添加）' });
  }
  const st = db.prepare('UPDATE products SET category=? WHERE id=?');
  const tx = db.transaction((list) => list.reduce((n, id) => n + st.run(category, id).changes, 0));
  const changed = tx(ids);
  logAudit('product_bulk_category', 'count=' + changed + ' category=' + (category || '(无)'), req.ip);
  res.json({ ok: true, changed: changed });
});

// 批量删除（不存在的 id 忽略；引用该产品的下载记录由外键级联清理）
router.post('/admin/products/bulk/delete', authMiddleware, requireAdmin, (req, res) => {
  const ids = normalizeBulkIds(req.body && req.body.ids);
  if (!ids) return res.status(400).json({ error: 'ids 须为 1~500 个正整数' });
  const st = db.prepare('DELETE FROM products WHERE id=?');
  const tx = db.transaction((list) => list.reduce((n, id) => n + st.run(id).changes, 0));
  const changed = tx(ids);
  logAudit('product_bulk_delete', 'count=' + changed, req.ip);
  res.json({ ok: true, changed: changed });
});

/* ============ 产品 CSV 批量导入（维度 69） ============ */

// 简易 RFC4180 CSV 解析：支持双引号包裹（含 "" 转义）、逗号、CRLF/LF 与 BOM；自动丢弃全空行
function parseCsv(text) {
  if (text == null) return [];
  text = String(text);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 UTF-8 BOM（Excel 导出常见）
  var rows = [], row = [], field = '', inQ = false;
  var i = 0, n = text.length;
  while (i < n) {
    var ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; } else { inQ = false; i++; }
      } else { field += ch; i++; }
    } else if (ch === '"') { inQ = true; i++; }
    else if (ch === ',') { row.push(field); field = ''; i++; }
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = []; i++;
    }
    else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; }
    else { field += ch; i++; }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

// 表头别名（中英文均可，小写匹配）
const CSV_HEADER_ALIASES = {
  name: ['name', '名称'],
  type: ['type', '类型'],
  category: ['category', '分类'],
  desc: ['desc', '简介', '描述'],
  icon: ['icon', '图标'],
  image: ['image', '产品图', '图片'],
  download_url: ['download_url', '下载链接', '下载地址'],
  version: ['version', '版本', '版本号'],
  changelog: ['changelog', '更新日志', '更新说明'],
  sort: ['sort', '排序', '排序权重']
};
const CSV_MAX_ROWS = 100; // 单次导入行数上限（防滥用）

// 批量导入产品：整批校验通过后事务写入（任一行非法则全部拒绝，返回逐行错误供修正重试）
router.post('/admin/products/import', authMiddleware, requireAdmin, (req, res) => {
  const csv = req.body && typeof req.body.csv === 'string' ? req.body.csv : '';
  if (!csv.trim()) return res.status(400).json({ error: 'csv 为空' });
  const rows = parseCsv(csv);
  if (rows.length < 2) return res.status(400).json({ error: 'CSV 至少需要表头 + 1 行数据' });
  // 表头定位（别名匹配）
  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const idx = {};
  Object.keys(CSV_HEADER_ALIASES).forEach((key) => {
    let pos = -1;
    for (let a = 0; a < CSV_HEADER_ALIASES[key].length && pos < 0; a++) {
      pos = headers.indexOf(CSV_HEADER_ALIASES[key][a].toLowerCase());
    }
    idx[key] = pos;
  });
  if (idx.name < 0) return res.status(400).json({ error: 'CSV 缺少 name/名称 列' });
  const dataRows = rows.slice(1);
  if (dataRows.length > CSV_MAX_ROWS) return res.status(400).json({ error: '单次导入最多 ' + CSV_MAX_ROWS + ' 行' });
  const failed = [];
  const objs = [];
  dataRows.forEach((r, k) => {
    const line = k + 2; // 第 1 行是表头
    const cell = (f) => (idx[f] >= 0 && r[idx[f]] != null ? String(r[idx[f]]).trim() : '');
    const rawType = cell('type').toLowerCase();
    const type = rawType === 'app' || rawType === '应用' ? 'app' : (rawType === 'game' || rawType === '游戏' ? 'game' : rawType);
    const r2 = normalizeProduct({
      name: cell('name'), type: type, category: cell('category'), desc: cell('desc'),
      icon: cell('icon'), image: cell('image'), download_url: cell('download_url'),
      version: cell('version'), changelog: cell('changelog'), sort: cell('sort')
    }, null);
    if (!r2.ok) failed.push({ line: line, error: r2.error });
    else objs.push(r2);
  });
  if (failed.length) return res.status(400).json({ ok: false, total: dataRows.length, failed: failed });
  const ins = db.prepare(
    "INSERT INTO products (name, type, category, desc, icon, image, download_url, sort, status, created_at, version, changelog) VALUES (?,?,?,?,?,?,?,?,'on',?,?,?)"
  );
  const tx = db.transaction((list) => list.map((o) => ins.run(o.name, o.type, o.category, o.desc, o.icon, o.image, o.download_url, o.sort, Date.now(), o.version, o.changelog).lastInsertRowid));
  const ids = tx(objs);
  logAudit('product_import', 'count=' + ids.length, req.ip);
  res.json({ ok: true, imported: ids.length, total: dataRows.length, ids: ids });
});

/* ============ 产品分类管理（维度 58） ============ */

// 分类名称校验（新增 / 重命名共用）
function normalizeCategoryName(raw) {
  const name = String(raw == null ? '' : raw).trim();
  if (!name) return '分类名称不能为空';
  if (name.length > 40) return '分类名称过长（≤40 字符）';
  if (!validCategory(name)) return '分类名称含非法字符（仅限中英文、数字与常用分隔符）';
  return null;
}

// 分类列表（含使用该分类的产品数，供删除保护与运营参考）
router.get('/admin/categories', authMiddleware, (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.created_at,
              (SELECT COUNT(*) FROM products p WHERE p.category = c.name) AS usage
       FROM categories c ORDER BY c.id`
    )
    .all();
  res.json({ rows });
});

// 新增分类
router.post('/admin/categories', authMiddleware, requireAdmin, (req, res) => {
  const err = normalizeCategoryName(req.body && req.body.name);
  if (err) return res.status(400).json({ error: err });
  const name = String(req.body.name).trim();
  if (db.prepare('SELECT 1 FROM categories WHERE name=?').get(name)) {
    return res.status(409).json({ error: '分类已存在' });
  }
  const info = db.prepare('INSERT INTO categories (name, created_at) VALUES (?,?)').run(name, Date.now());
  logAudit('category_add', 'name=' + name, req.ip);
  res.json({ id: info.lastInsertRowid });
});

// 重命名分类（同步更新引用该分类的产品，保持数据一致）
router.put('/admin/categories/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare('SELECT * FROM categories WHERE id=?').get(id);
  if (!old) return res.status(404).json({ error: 'not found' });
  const err = normalizeCategoryName(req.body && req.body.name);
  if (err) return res.status(400).json({ error: err });
  const name = String(req.body.name).trim();
  if (name !== old.name && db.prepare('SELECT 1 FROM categories WHERE name=?').get(name)) {
    return res.status(409).json({ error: '分类已存在' });
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE categories SET name=? WHERE id=?').run(name, id);
    db.prepare('UPDATE products SET category=? WHERE category=?').run(name, old.name);
  });
  tx();
  logAudit('category_rename', 'id=' + id + ' ' + old.name + '→' + name, req.ip);
  res.json({ ok: true });
});

// 删除分类（仅当无产品使用时允许；使用中返回 409 防止孤儿引用）
router.delete('/admin/categories/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM categories WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const usage = db.prepare('SELECT COUNT(*) AS c FROM products WHERE category=?').get(row.name).c;
  if (usage > 0) return res.status(409).json({ error: '该分类下有 ' + usage + ' 个产品，无法删除' });
  db.prepare('DELETE FROM categories WHERE id=?').run(id);
  logAudit('category_delete', 'name=' + row.name, req.ip);
  res.json({ ok: true });
});

/* ============ 前台公告条管理（候选G3） ============ */

// 公告内容校验（新增 / 编辑共用）
function normalizeAnnouncement(raw) {
  const content = String(raw == null ? '' : raw).trim();
  if (!content) return '公告内容不能为空';
  if (content.length > 200) return '公告内容过长（≤200 字符）';
  return null;
}

// 公告列表（按创建倒序，运营侧可看全部历史）
router.get('/admin/announcements', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT id, content, enabled, created_at, updated_at FROM announcements ORDER BY id DESC').all();
  res.json({ rows });
});

// 新增公告（enabled 缺省为开启）
router.post('/admin/announcements', authMiddleware, requireAdmin, (req, res) => {
  const err = normalizeAnnouncement(req.body && req.body.content);
  if (err) return res.status(400).json({ error: err });
  const content = String(req.body.content).trim();
  const enabled = req.body.enabled === false || req.body.enabled === 0 ? 0 : 1;
  const now = Date.now();
  const info = db.prepare('INSERT INTO announcements (content, enabled, created_at, updated_at) VALUES (?,?,?,?)').run(content, enabled, now, now);
  logAudit('announcement_add', 'id=' + info.lastInsertRowid, req.ip);
  res.json({ id: info.lastInsertRowid });
});

// 编辑公告（内容 + 启停状态）
router.put('/admin/announcements/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM announcements WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const err = normalizeAnnouncement(req.body && req.body.content);
  if (err) return res.status(400).json({ error: err });
  const content = String(req.body.content).trim();
  const enabled = req.body.enabled === false || req.body.enabled === 0 ? 0 : 1;
  db.prepare('UPDATE announcements SET content=?, enabled=?, updated_at=? WHERE id=?').run(content, enabled, Date.now(), id);
  logAudit('announcement_edit', 'id=' + id, req.ip);
  res.json({ ok: true });
});

// 删除公告
router.delete('/admin/announcements/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM announcements WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM announcements WHERE id=?').run(id);
  logAudit('announcement_delete', 'id=' + id, req.ip);
  res.json({ ok: true });
});

// 联系留言列表（后台，服务端分页 + 搜索 + 状态筛选）
// query: page(默认1) pageSize(默认10，上限100) keyword(姓名/邮箱/留言 模糊) status(new|done|all)
router.get('/admin/contacts', authMiddleware, (req, res) => {
  const q = req.query || {};
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || 10));
  const keyword = (q.keyword || '').trim();
  const status = q.status === 'new' || q.status === 'done' ? q.status : null;
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(name LIKE ? OR email LIKE ? OR message LIKE ?)');
    const like = '%' + keyword + '%';
    params.push(like, like, like);
  }
  if (status) { where.push('status = ?'); params.push(status); }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) AS n FROM contacts' + whereSql).get(...params).n;
  const rows = db
    .prepare('SELECT id, name, email, message, ts, status FROM contacts' + whereSql + ' ORDER BY ts DESC LIMIT ? OFFSET ?')
    .all(...params, pageSize, (page - 1) * pageSize);
  res.json({ rows, total });
});

// 删除联系留言（后台）。删除不可恢复，故先校验存在性并写入审计（含邮箱，便于事后追溯）
router.delete('/admin/contacts/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
  const row = db.prepare('SELECT id, email FROM contacts WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM contacts WHERE id=?').run(id);
  logAudit('contact_delete', 'id=' + id + ' email=' + (row.email || ''), req.ip);
  res.json({ ok: true });
});

// 更新联系留言处理状态（后台）：new=未处理 / done=已处理
router.put('/admin/contacts/:id/status', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM contacts WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const st = (req.body && req.body.status) || 'new';
  if (st !== 'new' && st !== 'done') return res.status(400).json({ error: 'invalid status' });
  db.prepare('UPDATE contacts SET status=? WHERE id=?').run(st, id);
  logAudit('contact_status', 'id=' + id + ' -> ' + st, req.ip);
  res.json({ ok: true });
});

// 批量更新联系留言状态（后台）：body { ids:[...], status }。单次上限 100，防滥用
router.post('/admin/contacts/batch-status', authMiddleware, requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  const st = req.body && req.body.status;
  if (!ids.length || ids.length > 100) return res.status(400).json({ error: 'invalid ids' });
  if (st !== 'new' && st !== 'done') return res.status(400).json({ error: 'invalid status' });
  const nums = ids.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n <= 0)) return res.status(400).json({ error: 'invalid id' });
  const placeholders = nums.map(() => '?').join(',');
  const info = db.prepare('UPDATE contacts SET status=? WHERE id IN (' + placeholders + ')').run(st, ...nums);
  logAudit('contact_batch_status', 'ids=[' + nums.join(',') + '] -> ' + st + ' n=' + info.changes, req.ip);
  res.json({ ok: true, updated: info.changes });
});

// 批量删除联系留言（后台）。删除不可恢复，写入审计（含邮箱，便于事后追溯）
router.post('/admin/contacts/batch-delete', authMiddleware, requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  if (!ids.length || ids.length > 100) return res.status(400).json({ error: 'invalid ids' });
  const nums = ids.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n <= 0)) return res.status(400).json({ error: 'invalid id' });
  const rows = db.prepare('SELECT id, email FROM contacts WHERE id IN (' + nums.map(() => '?').join(',') + ')').all(...nums);
  const placeholders = nums.map(() => '?').join(',');
  const info = db.prepare('DELETE FROM contacts WHERE id IN (' + placeholders + ')').run(...nums);
  logAudit('contact_batch_delete', 'ids=[' + rows.map((r) => r.id + ':' + (r.email || '')).join(',') + '] n=' + info.changes, req.ip);
  res.json({ ok: true, deleted: info.changes });
});

/* ============ 产品用户反馈（维度 76：详情页提交 + 后台按产品管理） ============ */

// 反馈提交（公开，限流 + 蜜罐；仅允许对上架中产品提交，内容 ≤500 字符）
router.post('/feedback', rateLimit('feedback', 20, 10 * 60 * 1000), (req, res) => {
  const b = req.body || {};
  // 蜜罐：机器人常填的隐藏字段（真人不可见），命中即拦截
  if (b.company || b.website || b.url || b.hp) {
    return res.status(400).json({ error: '提交被拦截' });
  }
  const productId = Number(b.productId);
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: '缺少有效的产品 ID' });
  }
  const p = db.prepare("SELECT 1 FROM products WHERE id=? AND status='on'").get(productId);
  if (!p) return res.status(404).json({ error: '产品不存在或已下架' });
  const content = String(b.content || '').trim();
  if (!content) return res.status(400).json({ error: '请填写反馈内容' });
  if (content.length > 500) return res.status(400).json({ error: '反馈内容过长（≤500 字符）' });
  const name = String(b.name || '').trim().slice(0, 60);
  const email = String(b.email || '').trim().slice(0, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }
  let rating = parseInt(b.rating, 10);
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) rating = 0;
  const info = db.prepare('INSERT INTO feedback (product_id, name, email, content, rating, status, ip, ts) VALUES (?,?,?,?,?,?,?,?)')
    .run(productId, name, email, content, rating, 'new', req.ip || '', Date.now());
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 反馈列表（需登录）：筛选 产品/状态 + 关键词(内容/称呼/邮箱) + 分页，联表带产品名
router.get('/admin/feedback', authMiddleware, (req, res) => {
  const q = req.query || {};
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || 10));
  const where = [];
  const params = [];
  const pid = parseInt(q.product_id, 10);
  if (Number.isInteger(pid) && pid > 0) { where.push('f.product_id = ?'); params.push(pid); }
  const st = q.status;
  if (st === 'new' || st === 'done') { where.push('f.status = ?'); params.push(st); }
  const kw = (q.keyword || '').trim();
  if (kw) {
    where.push('(f.content LIKE ? OR f.name LIKE ? OR f.email LIKE ?)');
    const like = '%' + kw + '%';
    params.push(like, like, like);
  }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) AS n FROM feedback f' + whereSql).get(...params).n;
  const rows = db
    .prepare('SELECT f.id, f.product_id, f.name, f.email, f.content, f.rating, f.status, f.ts, p.name AS product_name FROM feedback f LEFT JOIN products p ON p.id = f.product_id' + whereSql + ' ORDER BY f.ts DESC LIMIT ? OFFSET ?')
    .all(...params, pageSize, (page - 1) * pageSize);
  res.json({ rows, total });
});

// 反馈状态切换（后台）：new=未处理 / done=已处理
router.put('/admin/feedback/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
  const existing = db.prepare('SELECT id FROM feedback WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const st = (req.body && req.body.status) || 'new';
  if (st !== 'new' && st !== 'done') return res.status(400).json({ error: 'invalid status' });
  db.prepare('UPDATE feedback SET status=? WHERE id=?').run(st, id);
  logAudit('feedback_' + (st === 'done' ? 'done' : 'reopen'), 'id=' + id, req.ip);
  res.json({ ok: true });
});

// 删除反馈（后台）。删除不可恢复，写入审计
router.delete('/admin/feedback/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
  const row = db.prepare('SELECT id, product_id FROM feedback WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM feedback WHERE id=?').run(id);
  logAudit('feedback_delete', 'id=' + id + ' product=' + row.product_id, req.ip);
  res.json({ ok: true });
});

module.exports = router;
