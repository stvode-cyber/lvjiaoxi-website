/**
 * 数据库自动备份与轮转
 *
 * 设计要点：
 * 1. 使用 better-sqlite3 的在线备份 API（db.backup），会把 WAL 合并进主库，
 *    无需停服即可得到一致性快照；旧版本无此 API 时回退为文件拷贝。
 * 2. 「当日已备份则跳过」——避免开发环境每次重启都产生新备份文件堆积。
 * 3. 轮转保留最近 N 份，防止磁盘无限增长。
 * 4. 全程 try/catch：备份失败绝不影响主服务（只记录日志）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const db = require('./db.js');

// 本站必须存在的数据表：备份里少了任何一张，都说明它不是一份可用的本站备份
const REQUIRED_TABLES = ['contacts', 'products', 'visits'];

const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
const KEEP = 7;              // 保留最近 7 份
const INTERVAL_MS = 6 * 60 * 60 * 1000;  // 每 6 小时检查一次
const MIN_GAP_MS = 20 * 60 * 60 * 1000;  // 距上次备份不足 20 小时则跳过（实现「约每天一份」）

function pad(n) { return (n < 10 ? '0' : '') + n; }

function stamp(d) {
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes());
}

function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter(function (f) { return /^lvjiaoxi-\d{8}-\d{4}\.db$/.test(f); })
      .sort();  // 文件名时间戳递增，字典序即时间序
  } catch (e) {
    return [];
  }
}

/** 轮转：只保留最近 KEEP 份 */
function pruneBackups(keep) {
  const all = listBackups();
  const n = keep || KEEP;
  let removed = 0;
  for (let i = 0; i < all.length - n; i++) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, all[i]));
      removed++;
    } catch (e) { /* 忽略单个删除失败 */ }
  }
  return removed;
}

/** 上次备份距今的毫秒数；没有备份时返回 Infinity */
function lastBackupAge() {
  const all = listBackups();
  if (!all.length) return Infinity;
  const newest = all[all.length - 1];
  const m = /^lvjiaoxi-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.db$/.exec(newest);
  if (!m) return Infinity;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  return Date.now() - t;
}

/**
 * 备份状态快照（可观测性用）
 * 「配好了自动备份」不等于「备份真的在跑」——这里把最近一次备份的实际情况算出来，
 * 供后台面板 /api/admin/sysinfo 与深度健康检查 /api/health/detail 共用（单一实现，避免两处漂移）。
 * @returns {{count:number,lastTs:number|null,lastName:string|null,totalBytes:number,stale:boolean,dir:string}}
 */
function getStatus() {
  const files = listBackups();
  let total = 0;
  files.forEach(function (f) {
    try { total += fs.statSync(path.join(BACKUP_DIR, f)).size; } catch (e) {}
  });
  const newest = files.length ? files[files.length - 1] : null;
  let lastTs = null;
  if (newest) {
    const m = /^lvjiaoxi-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.db$/.exec(newest);
    if (m) lastTs = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  }
  return {
    count: files.length,
    lastTs: lastTs,
    lastName: newest,
    totalBytes: total,
    // 自动备份约每天一份；超过 48 小时没有新备份即视为「备份已停摆」
    stale: !(lastTs && Date.now() - lastTs < 48 * 60 * 60 * 1000),
    dir: BACKUP_DIR
  };
}

/** 执行一次备份，返回 {ok, file, bytes, removed} */
async function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, 'lvjiaoxi-' + stamp(new Date()) + '.db');

  if (typeof db.backup === 'function') {
    await db.backup(file);
  } else {
    fs.copyFileSync(db.dbPath, file);
  }

  // 校验产物非空，避免把空文件当成有效备份
  const size = fs.statSync(file).size;
  if (!size) {
    try { fs.unlinkSync(file); } catch (e) {}
    throw new Error('backup produced empty file');
  }

  const removed = pruneBackups(KEEP);
  audit('db_autobackup', path.basename(file) + ' (' + Math.round(size / 1024) + 'KB)');
  return { ok: true, file: file, bytes: size, removed: removed };
}

/**
 * 校验一份备份是否「真正可用」——而不只是「文件存在」。
 * 备份损坏 / 写了一半被截断，往往要到真正需要恢复的那一刻才暴露，那时已经晚了。
 * 三重检查：①SQLite 完整性检查（integrity_check）②本站关键表齐全 ③表可读并抽样计数。
 *
 * 关键：必须在【临时副本】上校验。直接打开备份文件会让 SQLite 生成 -wal / -shm 副作用文件，
 * 污染备份目录，还会让人误以为该备份仍有未合并的 WAL。
 *
 * @returns {{ok:boolean,name:string,bytes:number,tables:number,rows:Object,integrity:string|null,error:string|null}}
 */
function verifyBackup(file) {
  const out = { ok: false, file: file, name: path.basename(file || ''), bytes: 0, tables: 0, rows: {}, integrity: null, error: null };

  if (!file || !fs.existsSync(file)) { out.error = '文件不存在'; return out; }
  out.bytes = fs.statSync(file).size;
  if (!out.bytes) { out.error = '文件为空'; return out; }

  let fd = -1;
  try {
    const head = Buffer.alloc(16);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, head, 0, 16, 0);
    if (head.toString('latin1', 0, 15) !== 'SQLite format 3') {
      out.error = '不是有效的 SQLite 文件（文件头不符）';
      return out;
    }
  } catch (e) {
    out.error = '无法读取文件：' + e.message;
    return out;
  } finally {
    if (fd >= 0) { try { fs.closeSync(fd); } catch (e) {} }
  }

  const tmp = path.join(os.tmpdir(), 'lvjx-verify-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.db');
  let probe = null;
  try {
    fs.copyFileSync(file, tmp);
    probe = new Database(tmp, { readonly: true });

    const ic = probe.pragma('integrity_check');
    out.integrity = (Array.isArray(ic) && ic[0] && ic[0].integrity_check) || String(ic && ic.integrity_check || ic);
    if (out.integrity !== 'ok') {
      out.error = '完整性检查未通过：' + out.integrity;
      return out;
    }

    const names = probe.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      .map(function (r) { return r.name; });
    out.tables = names.length;
    for (const need of REQUIRED_TABLES) {
      if (names.indexOf(need) === -1) { out.error = '缺少本站数据表：' + need; return out; }
    }
    // 抽样计数：既验证表可读，也让运维看清「这份备份里到底有多少数据」
    for (const t of REQUIRED_TABLES) {
      try { out.rows[t] = probe.prepare('SELECT COUNT(*) AS c FROM ' + t).get().c; }
      catch (e) { out.error = '表 ' + t + ' 不可读：' + e.message; return out; }
    }
    out.ok = true;
  } catch (e) {
    out.error = '无法打开：' + (e && e.message || e);
  } finally {
    try { if (probe) probe.close(); } catch (e) {}
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmp + suffix); } catch (e) { /* 不存在则忽略 */ }
    }
  }
  return out;
}

/** 校验并写入审计日志（动作 db_verify），供后台审计面板与健康检查追溯 */
function runVerify(file) {
  const r = verifyBackup(file);
  const summary = r.ok
    ? '通过 · ' + r.name + ' · ' + r.tables + ' 表 / ' + (r.rows.contacts || 0) + ' 留言 / ' +
      (r.rows.products || 0) + ' 产品 / ' + Math.round(r.bytes / 1024) + 'KB'
    : '失败 · ' + (r.name || '-') + ' · ' + r.error;
  audit('db_verify', summary);
  if (!r.ok) console.error('[backup] 备份校验失败：' + summary);
  return r;
}

/** 最近一次校验结果（取自审计日志 db_verify，故无需额外状态文件） */
function lastVerify() {
  try {
    const row = db.prepare("SELECT detail, ts FROM audit_log WHERE action='db_verify' ORDER BY ts DESC LIMIT 1").get();
    if (!row) return null;
    return { ts: row.ts, detail: row.detail, ok: String(row.detail).indexOf('通过') === 0 };
  } catch (e) {
    return null;
  }
}

/** 写入审计表（与 routes.js 的 logAudit 保持同表同结构） */
function audit(action, detail) {
  try {
    db.prepare('INSERT INTO audit_log (action, detail, ip, ts) VALUES (?,?,?,?)')
      .run(action, detail || '', '127.0.0.1', Date.now());
  } catch (e) { /* 审计失败不影响备份 */ }
}

let timer = null;
let running = false;

/** 带并发保护的单次调度：距上次备份不足 MIN_GAP_MS 则跳过 */
async function tick(force) {
  if (running) return null;
  running = true;
  try {
    if (!force && lastBackupAge() < MIN_GAP_MS) return null;
    const r = await runBackup();
    console.log('[backup] 已生成 ' + path.basename(r.file) +
      ' (' + Math.round(r.bytes / 1024) + 'KB)，清理旧备份 ' + r.removed + ' 份');
    // 备份完立刻自证：损坏的备份若等到「要恢复的那一刻」才发现，就没有任何意义了。
    // 库很小（数十 KB），integrity_check 开销可忽略，且失败只影响日志不影响主服务。
    try {
      const v = runVerify(r.file);
      if (v.ok) {
        console.log('[backup] 校验通过：' + v.tables + ' 表 / ' + (v.rows.contacts || 0) + ' 留言');
      } else {
        console.error('[backup] 校验失败（该备份可能不可用）：' + v.error);
      }
    } catch (e) {
      console.error('[backup] 校验过程异常：' + e.message);
    }
    return r;
  } catch (e) {
    console.error('[backup] 自动备份失败：' + e.message);
    return null;
  } finally {
    running = false;
  }
}

/**
 * 启动定时备份。
 * 启动时先检查一次（不足间隔则跳过，因此重启不会刷屏），随后每 INTERVAL_MS 检查一次。
 */
function startScheduler() {
  if (timer) return timer;
  tick(false);
  timer = setInterval(function () { tick(false); }, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();  // 不阻止进程退出
  return timer;
}

function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = {
  runBackup: runBackup,
  pruneBackups: pruneBackups,
  listBackups: listBackups,
  lastBackupAge: lastBackupAge,
  getStatus: getStatus,
  verifyBackup: verifyBackup,
  runVerify: runVerify,
  lastVerify: lastVerify,
  REQUIRED_TABLES: REQUIRED_TABLES,
  startScheduler: startScheduler,
  stopScheduler: stopScheduler,
  tick: tick,
  BACKUP_DIR: BACKUP_DIR,
  KEEP: KEEP
};
