const crypto = require('crypto');
const config = require('./config');
const db = require('./db');

// 会话有效期：8 小时。Token 内含签发时间戳与用户名，过期后服务端拒绝。
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

// Token 签名密钥（HMAC）。务必通过环境变量 AUTH_SECRET 设置为强随机值。
function serverSecret() {
  return config.authSecret || 'lvjx-default-auth-secret-please-change';
}

/* ---------- 多管理员表（幂等建表 + 种子默认管理员） ----------
   角色：admin = 完全管理（含写操作）；viewer = 只读（仅查看看板/数据）。
   口令以 scrypt（每用户独立随机盐）存储，不存明文。 */
function ensureAdmins() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      pwd_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);
  const count = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
  if (count === 0) {
    const username = 'admin';
    const password = config.adminPassword;
    const salt = crypto.randomBytes(16).toString('hex');
    const pass_hash = crypto.scryptSync(password, salt, 32).toString('hex');
    db.prepare(
      'INSERT INTO admins (username, pass_hash, salt, role, pwd_version, created_at) VALUES (?,?,?,?,?,?)'
    ).run(username, pass_hash, salt, 'admin', 1, Date.now());
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

// 校验用户名 + 口令；成功返回 {id, username, role, pwd_version}，失败返回 null
function verifyPassword(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  const row = db.prepare('SELECT * FROM admins WHERE username=?').get(username.trim());
  if (!row) return null;
  const hash = hashPassword(password, row.salt);
  if (hash !== row.pass_hash) return null;
  return { id: row.id, username: row.username, role: row.role, pwd_version: row.pwd_version };
}

// 判断某用户是否仍使用默认口令（用于后台「请修改默认口令」提示）
function isDefaultPassword(username) {
  const row = db.prepare('SELECT pass_hash, salt FROM admins WHERE username=?').get(username);
  if (!row) return false;
  return hashPassword('admin123', row.salt) === row.pass_hash;
}

// 更新指定用户口令：重算哈希、刷新盐、递增 pwd_version（使旧 Token 立即失效）
function updatePassword(username, newPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const pass_hash = hashPassword(newPassword, salt);
  db.prepare('UPDATE admins SET pass_hash=?, salt=?, pwd_version=pwd_version+1 WHERE username=?')
    .run(pass_hash, salt, username);
}

/* Token 格式：lvjx-<issuedAt base36>.<username>.<hmac>
   - HMAC 由服务端密钥对 username:issuedAt:pwd_version 签名，无密钥无法伪造
   - 口令变更（pwd_version 递增）→ 旧 Token 校验失败 → 立即失效
   - 超过 TTL → 拒绝（降低令牌被盗用风险） */
function makeToken(row) {
  const issuedAt = Date.now();
  const body = crypto.createHmac('sha256', serverSecret())
    .update(row.username + ':' + issuedAt + ':' + row.pwd_version)
    .digest('hex').slice(0, 32);
  return 'lvjx-' + issuedAt.toString(36) + '.' + row.username + '.' + body;
}

// 校验 Token；成功返回 {username, role}，失败返回 null
function verifyToken(token) {
  if (typeof token !== 'string' || token.indexOf('lvjx-') !== 0) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const issuedAt = parseInt(parts[0].slice(5), 36);
  const username = parts[1];
  const body = parts[2];
  if (!Number.isFinite(issuedAt) || !username) return null;
  if (Date.now() - issuedAt > TOKEN_TTL_MS) return null; // 过期
  const row = db.prepare('SELECT username, role, pwd_version FROM admins WHERE username=?').get(username);
  if (!row) return null;
  const expected = crypto.createHmac('sha256', serverSecret())
    .update(username + ':' + issuedAt + ':' + row.pwd_version)
    .digest('hex').slice(0, 32);
  if (body !== expected) return null;
  return { username: row.username, role: row.role };
}

// 新建管理员账号（仅管理员可调用）。返回 {lastInsertRowid}；用户名冲突抛 UNIQUE 错误
function addAdmin(username, password, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  const pass_hash = hashPassword(password, salt);
  return db.prepare(
    'INSERT INTO admins (username, pass_hash, salt, role, pwd_version, created_at) VALUES (?,?,?,?,?,?)'
  ).run(username, pass_hash, salt, role, 1, Date.now());
}

// 修改指定账号角色（仅管理员可调用）。返回 true；账号不存在返回 false
function updateAdminRole(id, role) {
  const info = db.prepare('UPDATE admins SET role=? WHERE id=?').run(role, id);
  return info.changes > 0;
}

// 删除指定账号（仅管理员可调用）。返回 true；账号不存在返回 false
function deleteAdmin(id) {
  const info = db.prepare('DELETE FROM admins WHERE id=?').run(id);
  return info.changes > 0;
}

module.exports = { ensureAdmins, verifyPassword, isDefaultPassword, updatePassword, addAdmin, updateAdminRole, deleteAdmin, makeToken, verifyToken, TOKEN_TTL_MS };
