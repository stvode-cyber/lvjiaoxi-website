#!/usr/bin/env node
/**
 * 运维维护工具（零额外依赖）
 *
 * 用法：
 *   node tools/maintain.js stats                     查看数据库与备份概况
 *   node tools/maintain.js backup                    立即生成一份备份并轮转
 *   node tools/maintain.js list                      列出所有备份文件
 *   node tools/maintain.js prune [--keep=7]          手动轮转（保留最近 N 份）
 *   node tools/maintain.js vacuum                    整理数据库文件、回收空闲页
 *   node tools/maintain.js clean-contacts --days=180 清理 N 天前「已处理」的留言
 *   node tools/maintain.js clean-audit --days=365    清理 N 天前的审计日志
 *   node tools/maintain.js restore latest            从备份恢复（latest = 最新一份）
 *   node tools/maintain.js restore lvjiaoxi-20260901-0407.db --yes
 *
 * 安全约定：
 *   - 所有删除/恢复类操作默认只预览（dry-run），必须显式加 --yes 才会真正执行。
 *   - 删除前自动建议先备份；如当前无备份且未加 --yes，会拒绝执行。
 *   - 恢复前会：校验备份文件合法性 → 检测服务是否在运行（运行中拒绝）→ 自动先备份当前库。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const db = require(path.join(ROOT, 'server', 'db.js'));

const args = process.argv.slice(2);
const cmd = args[0] || 'stats';
const flags = {};
args.slice(1).forEach(function (a) {
  const m = /^--([^=]+)(=(.*))?$/.exec(a);
  if (m) flags[m[1]] = m[3] === undefined ? true : m[3];
});

const YES = flags.yes === true || flags.yes === '1';
const DAYS = parseInt(flags.days, 10) || 180;
const KEEP = parseInt(flags.keep, 10) || 7;

function human(n) {
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
  return (n / 1024 / 1024).toFixed(2) + 'MB';
}

function dirSize(dir) {
  let total = 0, count = 0;
  try {
    fs.readdirSync(dir).forEach(function (f) {
      const s = fs.statSync(path.join(dir, f));
      if (s.isFile()) { total += s.size; count++; }
    });
  } catch (e) {}
  return { bytes: total, count: count };
}

/* ---------------- stats ---------------- */
function stats() {
  // 动态枚举：新增表无需改动本文件；跳过 SQLite 内部表
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(function (r) { return r.name; });

  console.log('=== 数据库概况 ===');
  console.log('路径：' + db.dbPath + '  (' + human(fs.statSync(db.dbPath).size) + ')');
  tables.forEach(function (t) {
    try {
      const c = db.prepare('SELECT COUNT(*) AS c FROM "' + t + '"').get().c;
      console.log('  ' + t.padEnd(14) + c + ' 行');
    } catch (e) {
      console.log('  ' + t.padEnd(14) + '(读取失败)');
    }
  });

  const logs = path.join(ROOT, 'data', 'access.log');
  if (fs.existsSync(logs)) console.log('\n访问日志：' + human(fs.statSync(logs).size));

  const b = dirSize(path.join(ROOT, 'data', 'backups'));
  console.log('备份目录：' + b.count + ' 份，共 ' + human(b.bytes));
}

/* ---------------- backup / list / prune ---------------- */
function backup() {
  const bkp = require(path.join(ROOT, 'server', 'backup.js'));
  return bkp.runBackup().then(function (r) {
    console.log('已生成：' + path.basename(r.file) + '  (' + human(r.bytes) + ')');
    console.log('清理旧备份：' + r.removed + ' 份（保留最近 ' + bkp.KEEP + ' 份）');
  });
}

function list() {
  const bkp = require(path.join(ROOT, 'server', 'backup.js'));
  const files = bkp.listBackups();
  if (!files.length) { console.log('暂无备份'); return; }
  const dir = bkp.BACKUP_DIR;
  files.forEach(function (f) {
    const s = fs.statSync(path.join(dir, f));
    console.log('  ' + f + '  ' + human(s.size) + '  ' + s.mtime.toISOString().slice(0, 19).replace('T', ' '));
  });
  console.log('共 ' + files.length + ' 份，合计 ' + human(dirSize(dir).bytes));
}

/* ---------------- verify：备份完整性校验（有备份 ≠ 能恢复） ---------------- */
function verify() {
  const bkp = require(path.join(ROOT, 'server', 'backup.js'));
  const files = bkp.listBackups();
  if (!files.length) { console.log('暂无备份可校验'); return; }

  // 默认只校验最新一份（足以发现「备份机制本身是否在产出坏档」）；--all 才全量校验
  const targets = flags.all ? files : [files[files.length - 1]];
  console.log('=== 备份完整性校验（' + targets.length + ' / ' + files.length + ' 份）===');

  let bad = 0;
  targets.forEach(function (f) {
    const r = bkp.runVerify(path.join(bkp.BACKUP_DIR, f));
    if (r.ok) {
      const rows = Object.keys(r.rows).map(function (k) { return k + ' ' + r.rows[k]; }).join(' / ');
      console.log('  ✓ ' + f + '  ' + human(r.bytes) + '  ' + r.tables + ' 表 · ' + rows);
    } else {
      bad++;
      console.log('  ✗ ' + f + '  ' + r.error);
    }
  });

  console.log(bad === 0 ? '\n全部通过' : '\n' + bad + ' 份备份不可用，请立即排查并重新备份');
  if (bad > 0) process.exitCode = 1;
}

function prune() {
  const bkp = require(path.join(ROOT, 'server', 'backup.js'));
  const files = bkp.listBackups();
  const doomed = files.slice(0, Math.max(0, files.length - KEEP));
  if (!doomed.length) { console.log('无需清理（当前 ' + files.length + ' 份 ≤ 保留 ' + KEEP + ' 份）'); return; }
  console.log('将删除 ' + doomed.length + ' 份旧备份：');
  doomed.forEach(function (f) { console.log('  - ' + f); });
  if (!YES) { console.log('\n[预览模式] 实际删除请追加 --yes'); return; }
  const removed = bkp.pruneBackups(KEEP);
  console.log('已删除 ' + removed + ' 份');
}

/* ---------------- vacuum ---------------- */
function vacuum() {
  const before = fs.statSync(db.dbPath).size;
  console.log('整理前：' + human(before));
  db.exec('VACUUM');
  const after = fs.statSync(db.dbPath).size;
  console.log('整理后：' + human(after) + '  (变化 ' + (after - before >= 0 ? '+' : '') + human(after - before) + ')');
}

/* ---------------- 恢复 ---------------- */

/** 备份文件是否是合法的 SQLite：校验文件头 + 能否打开 + 是否含本站核心表 */
/** 校验备份文件：委托给 server/backup.js 的共用实现（含 integrity_check + 临时副本保护），
 *  这里保持「返回 null 表示可用、返回字符串表示错误」的旧接口，restore 逻辑无需改动。 */
function validateBackupFile(file) {
  const r = require(path.join(ROOT, 'server', 'backup.js')).verifyBackup(file);
  return r.ok ? null : (r.error || '校验未通过');
}

/** 服务是否在运行（运行中恢复会导致文件占用 / 数据错乱，必须拒绝） */
function serviceRunning(port, cb) {
  const net = require('net');
  const sock = net.connect({ host: '127.0.0.1', port: port });
  let done = false;
  const finish = function (v) {
    if (done) return;
    done = true;
    try { sock.destroy(); } catch (e) {}
    cb(v);
  };
  sock.setTimeout(800);
  sock.on('connect', function () { finish(true); });
  sock.on('error', function () { finish(false); });
  sock.on('timeout', function () { finish(false); });
}

function restore() {
  const bkp = require(path.join(ROOT, 'server', 'backup.js'));
  const target = args[1];

  if (!target) {
    console.error('用法：node tools/maintain.js restore <latest|备份文件名> [--yes]');
    console.error('可用备份：');
    bkp.listBackups().forEach(function (f) { console.error('  ' + f); });
    process.exit(1);
  }

  const files = bkp.listBackups();
  if (!files.length) { console.error('没有任何备份可恢复'); process.exit(1); }

  const name = target === 'latest' ? files[files.length - 1] : target;
  if (files.indexOf(name) === -1) {
    console.error('备份不存在：' + name);
    console.error('可用备份：' + files.join(' / '));
    process.exit(1);
  }

  const src = path.join(bkp.BACKUP_DIR, name);
  const dst = db.dbPath;

  console.log('=== 恢复数据库 ===');
  console.log('来源备份：' + name + '  (' + human(fs.statSync(src).size) + ')');
  console.log('目标位置：' + dst + '  (当前 ' + human(fs.statSync(dst).size) + ')');

  const bad = validateBackupFile(src);
  if (bad) { console.error('\n[拒绝恢复] ' + bad); process.exit(1); }
  console.log('合法性校验：通过（SQLite 文件头 + 含本站数据表）');

  const port = parseInt(process.env.PORT, 10) || 3000;
  serviceRunning(port, function (running) {
    if (running) {
      console.error('\n[拒绝恢复] 检测到服务正在端口 ' + port + ' 运行。');
      console.error('运行中覆盖数据库会导致文件占用失败或数据错乱。请先停服：');
      console.error('  PM2:      pm2 stop lvjiaoxi');
      console.error('  systemd:  sudo systemctl stop lvjiaoxi');
      console.error('  本地开发: 结束 node server/server.js 进程');
      process.exit(1);
    }

    console.log('服务状态：未运行（可以安全覆盖）');

    if (!YES) {
      console.log('\n[预览模式] 将执行：');
      console.log('  1. 先把当前数据库另存为一份「恢复前快照」备份');
      console.log('  2. 用备份覆盖 data/app.db');
      console.log('  3. 删除 app.db-wal / app.db-shm 残留（否则旧 WAL 会重放到新库上）');
      console.log('\n实际执行请追加 --yes');
      return;
    }

    try {
      // 1) 恢复前快照：万一恢复错了还能回退。
      //    刻意放在备份目录但不使用 lvjiaoxi- 前缀，这样不会被 listBackups 当成常规备份，
      //    也不会被轮转清理掉。
      const pre = path.join(bkp.BACKUP_DIR, 'prerestore-' + Date.now() + '.db');
      fs.copyFileSync(dst, pre);
      console.log('\n已保存恢复前快照：' + path.basename(pre));

      // 2) Windows 下已打开的文件无法覆盖，必须先关闭本进程持有的连接
      try { db.close(); } catch (e) {}

      fs.copyFileSync(src, dst);

      // 3) 关键：清除 WAL / SHM 残留。否则 SQLite 会把旧库的 WAL 重放到新库上，
      //    造成数据错乱甚至损坏。
      for (const suffix of ['-wal', '-shm']) {
        try { fs.unlinkSync(dst + suffix); } catch (e) { /* 不存在则忽略 */ }
      }

      console.log('已恢复：' + name + ' → data/app.db');
      console.log('已清理 WAL/SHM 残留');
      console.log('\n请重新启动服务：npm start');
    } catch (e) {
      console.error('恢复失败：' + e.message);
      process.exit(1);
    }
  });
}

/* ---------------- 数据保留清理 ---------------- */
function requireSafety(label) {
  const bkp = require(path.join(ROOT, 'server', 'backup.js'));
  if (!bkp.listBackups().length && YES) {
    console.error('[拒绝执行] 当前没有任何备份，且你使用了 --yes。');
    console.error('请先执行：node tools/maintain.js backup');
    process.exit(1);
  }
  return label;
}

function cleanByAge(table, tsCol, extra, label) {
  const cutoff = Date.now() - DAYS * 24 * 60 * 60 * 1000;
  const where = tsCol + ' < ?' + ((extra && extra.sql) || '');
  const params = [cutoff].concat((extra && extra.params) || []);
  const rows = db.prepare('SELECT COUNT(*) AS c FROM ' + table + ' WHERE ' + where).get(params).c;

  console.log('=== ' + label + ' ===');
  console.log('条件：' + tsCol + ' 早于 ' + new Date(cutoff).toISOString().slice(0, 10) +
    '（' + DAYS + ' 天前）' + ((extra && extra.human) ? ' 且 ' + extra.human : ''));
  console.log('匹配：' + rows + ' 行');

  if (!rows) { console.log('无需清理'); return; }
  if (!YES) { console.log('[预览模式] 实际删除请追加 --yes'); return; }

  requireSafety(label);
  const info = db.prepare('DELETE FROM ' + table + ' WHERE ' + where).run(params);
  console.log('已删除 ' + info.changes + ' 行');
}

function cleanContacts() {
  // 只清理「已处理」的旧留言，避免误删未跟进的客户线索
  cleanByAge('contacts', 'ts', {
    sql: " AND status='done'",
    params: [],
    human: '状态为「已处理」'
  }, '清理已处理留言');
}

function cleanAudit() {
  cleanByAge('audit_log', 'ts', null, '清理审计日志');
}

/* ---------------- 入口 ---------------- */
const actions = {
  stats: stats,
  backup: backup,
  list: list,
  verify: verify,
  prune: prune,
  vacuum: vacuum,
  'clean-contacts': cleanContacts,
  'clean-audit': cleanAudit,
  restore: restore
};

if (!actions[cmd]) {
  console.error('未知命令：' + cmd);
  console.error('可用命令：' + Object.keys(actions).join(' / '));
  process.exit(1);
}

try {
  const out = actions[cmd]();
  if (out && typeof out.then === 'function') {
    out.catch(function (e) { console.error('执行失败：' + e.message); process.exit(1); });
  }
} catch (e) {
  console.error('执行失败：' + e.message);
  process.exit(1);
}
