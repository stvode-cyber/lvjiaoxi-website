const path = require('path');
const fs = require('fs');
const config = require('./config');
const Database = require('better-sqlite3');

const dbDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'app.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page TEXT NOT NULL,
  ip TEXT,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL
);

-- 下载量按产品统计索引（维度 63）：COUNT(d.product_id) 关联加速
CREATE INDEX IF NOT EXISTS idx_downloads_product ON downloads(product_id);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  desc TEXT,
  icon TEXT,
  download_url TEXT,
  status TEXT NOT NULL DEFAULT 'on',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  message TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- 前台公告条（候选G3）：后台可维护，最多展示最新一条启用中的公告
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 产品用户反馈（维度 76）：详情页提交，后台按产品管理
-- rating 1~5（0=未评分），status new=未处理 / done=已处理
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  ip TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_product ON feedback(product_id);
`);

// 访问来源分析：为 visits 增加 referer / ua / lang / tz 字段（兼容旧库，幂等迁移）
(function migrateVisits() {
  var cols = db.prepare('PRAGMA table_info(visits)').all().map(function (c) { return c.name; });
  ['referer', 'ua', 'lang', 'tz'].forEach(function (col) {
    if (cols.indexOf(col) === -1) {
      try { db.exec('ALTER TABLE visits ADD COLUMN ' + col + ' TEXT'); } catch (e) {}
    }
  });
})();

// 联系留言状态字段迁移（幂等）：新增 status（new=未处理 / done=已处理），默认 new
(function migrateContacts() {
  var cols = db.prepare('PRAGMA table_info(contacts)').all().map(function (c) { return c.name; });
  if (cols.indexOf('status') === -1) {
    try { db.exec("ALTER TABLE contacts ADD COLUMN status TEXT NOT NULL DEFAULT 'new'"); } catch (e) {}
  }
})();

// 产品分类字段迁移（幂等）：新增 category（自由文本分类，如「效率」「RPG」），默认空串
(function migrateProducts() {
  var cols = db.prepare('PRAGMA table_info(products)').all().map(function (c) { return c.name; });
  if (cols.indexOf('category') === -1) {
    try { db.exec("ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  }
})();

// 产品排序权重迁移（幂等）：新增 sort（整数，越大越靠前，默认 0），下载页按 sort DESC 排序实现置顶
(function migrateProductsSort() {
  var cols = db.prepare('PRAGMA table_info(products)').all().map(function (c) { return c.name; });
  if (cols.indexOf('sort') === -1) {
    try { db.exec('ALTER TABLE products ADD COLUMN sort INTEGER NOT NULL DEFAULT 0'); } catch (e) {}
  }
})();

// 产品大图迁移（幂等，维度 59）：新增 image（大图/缩略图路径或 URL，空=卡片回退 emoji 图标）
// 并回填已知种子产品的默认大图（仅 image 为空时生效，兼容旧库）
(function migrateProductsImage() {
  var cols = db.prepare('PRAGMA table_info(products)').all().map(function (c) { return c.name; });
  if (cols.indexOf('image') === -1) {
    try { db.exec("ALTER TABLE products ADD COLUMN image TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  }
  var IMG = {
    '效率笔记': '/assets/img/products/note.jpg',
    '团队协作': '/assets/img/products/team.jpg',
    '云盘同步': '/assets/img/products/cloud.jpg',
    '密码管家': '/assets/img/products/password.jpg',
    '星际探险': '/assets/img/products/space.jpg',
    '消除乐园': '/assets/img/products/candy.jpg',
    '赛车竞速': '/assets/img/products/racing.jpg',
    '像素勇者': '/assets/img/products/pixel.jpg'
  };
  var upd = db.prepare("UPDATE products SET image=? WHERE name=? AND image=''");
  var tx = db.transaction(function () {
    for (var k in IMG) upd.run(IMG[k], k);
  });
  tx();
})();

// 种子数据（占位）：仅在 products 为空时写入
const count = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
if (count === 0) {
  const insert = db.prepare(
    'INSERT INTO products (name, type, category, desc, icon, image, download_url, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  const now = Date.now();
  const apps = [
    ['效率笔记', 'app', '效率', '本地优先的轻量笔记，支持 Markdown、双向链接与多端实时同步。', '📝', '/assets/img/products/note.jpg', '#', 'on'],
    ['团队协作', 'app', '协作', '看板、文档、即时沟通三合一，让远程团队像在同一间办公室。', '🤝', '/assets/img/products/team.jpg', '#', 'on'],
    ['云盘同步', 'app', '工具', '端到端加密网盘，大文件秒传、历史版本随时回溯。', '☁️', '/assets/img/products/cloud.jpg', '#', 'on'],
    ['密码管家', 'app', '安全', '自动生成并加密保存密码，跨设备一键填充，告别弱口令。', '🔐', '/assets/img/products/password.jpg', '#', 'on'],
  ];
  const games = [
    ['星际探险', 'game', 'RPG', '开放宇宙 RPG，驾驶飞船探索数百颗星球，书写你的星际传奇。', '🚀', '/assets/img/products/space.jpg', '#', 'on'],
    ['消除乐园', 'game', '休闲', '治愈系三消，搭配轻音乐与关卡挑战，通勤碎片时间刚刚好。', '🍬', '/assets/img/products/candy.jpg', '#', 'on'],
    ['赛车竞速', 'game', '竞速', '真实物理引擎竞速手游，漂移过弯、改装座驾、天梯对决。', '🏎️', '/assets/img/products/racing.jpg', '#', 'on'],
    ['像素勇者', 'game', '复古', '复古像素风地牢探险，随机地图 + 装备构筑，每局都新鲜。', '🟢', '/assets/img/products/pixel.jpg', '#', 'on'],
  ];
  const all = [...apps, ...games];
  const tx = db.transaction(() => {
    for (const [name, type, category, desc, icon, image, download_url, status] of all) {
      insert.run(name, type, category, desc, icon, image, download_url, status, now);
    }
  });
  tx();
  console.log('[db] 已写入种子产品数据：' + all.length + ' 条');
}

// 下载统计防刷去重（幂等，维度 66）：downloads 增加 ip 列 + (ip, product_id, ts) 去重索引
(function migrateDownloadsIp() {
  var cols = db.prepare('PRAGMA table_info(downloads)').all().map(function (c) { return c.name; });
  if (cols.indexOf('ip') === -1) {
    try { db.exec("ALTER TABLE downloads ADD COLUMN ip TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_downloads_ip_prod ON downloads(ip, product_id, ts)');
})();

// 产品版本/更新日志迁移（幂等，维度 62）：新增 version（版本号，如 1.2.0）与 changelog（多行更新日志）
(function migrateProductsVersion() {
  var cols = db.prepare('PRAGMA table_info(products)').all().map(function (c) { return c.name; });
  if (cols.indexOf('version') === -1) {
    try { db.exec("ALTER TABLE products ADD COLUMN version TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  }
  if (cols.indexOf('changelog') === -1) {
    try { db.exec("ALTER TABLE products ADD COLUMN changelog TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  }
})();

// 种子版本/更新日志回填（幂等）：仅 version 为空时写入示例数据（后台可随时覆盖，维度 62）
(function backfillProductsVersion() {
  var LOG = {
    '效率笔记': ['1.2.0', 'v1.2.0 · 2026-08-20\n· 新增双向链接，笔记间跳转更顺手\n· 移动端编辑体验优化\n\nv1.1.0 · 2026-06-12\n· 支持 Markdown 导出\n· 修复深色模式光标不可见问题'],
    '团队协作': ['2.0.1', 'v2.0.1 · 2026-08-05\n· 看板新增筛选与泳道\n· 修复消息未读数不同步\n\nv2.0.0 · 2026-07-01\n· 全新「协作空间」工作台'],
    '云盘同步': ['1.4.3', 'v1.4.3 · 2026-07-28\n· 大文件传输稳定性提升\n· 新增离线收藏夹\n\nv1.4.0 · 2026-05-16\n· 端到端加密默认开启'],
    '密码管家': ['1.8.2', 'v1.8.2 · 2026-08-12\n· 支持安全笔记\n· 修复部分设备自动填充失效\n\nv1.8.0 · 2026-06-30\n· 跨设备一键填充优化'],
    '星际探险': ['0.9.4', 'v0.9.4 · 2026-08-18\n· 新增 3 颗可探索星球\n· 飞船自定义涂装\n\nv0.9.0 · 2026-07-05\n· 开放宇宙地图预览'],
    '消除乐园': ['1.5.0', 'v1.5.0 · 2026-08-22\n· 新增「周末挑战」限时玩法\n· 关卡难度曲线优化\n\nv1.4.2 · 2026-06-08\n· 修复高分榜结算异常'],
    '赛车竞速': ['1.3.6', 'v1.3.6 · 2026-08-30\n· 新增雨夜赛道\n· 漂移手感微调\n\nv1.3.0 · 2026-07-20\n· 天梯赛季 S2 开启'],
    '像素勇者': ['1.1.2', 'v1.1.2 · 2026-09-01\n· 新增随机事件「神秘商人」\n· 装备套装效果上线\n\nv1.1.0 · 2026-07-12\n· 新增地牢第 6 层']
  };
  var upd = db.prepare("UPDATE products SET version=?, changelog=? WHERE name=? AND version=''");
  var tx = db.transaction(function () {
    for (var k in LOG) upd.run(LOG[k][0], LOG[k][1], k);
  });
  tx();
})();

// 产品分类枚举（幂等）：categories 表；为空时从现有产品分类回填，并补齐常用分类（维度 58）
(function migrateCategories() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (n === 0) {
    const rows = db.prepare("SELECT DISTINCT category FROM products WHERE category <> ''").all();
    const names = rows.map((r) => r.category);
    ['效率', '协作', '工具', '安全', 'RPG', '休闲', '竞速', '复古'].forEach((c) => {
      if (names.indexOf(c) === -1) names.push(c);
    });
    const ins = db.prepare('INSERT INTO categories (name, created_at) VALUES (?,?)');
    const now = Date.now();
    const tx = db.transaction(() => names.forEach((nm) => ins.run(nm, now)));
    tx();
    console.log('[db] 已初始化产品分类枚举：' + names.length + ' 个');
  }
})();

// 后台口令持久化（可被「修改口令」覆盖；重启不覆盖已修改值）
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_password', ?)").run(config.adminPassword);

db.dbPath = dbPath;
module.exports = db;
