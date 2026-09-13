// 零依赖 .env 加载器：将项目根目录下的 .env 注入 process.env（不覆盖已存在的变量）
// 用法：在 server.js 最顶部 `require('./env');`，务必早于 require('./config')
// 支持：# 注释行、KEY=VALUE、单/双引号包裹的值；不覆盖系统或进程管理器已注入的变量。
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const envPath = file || path.join(__dirname, '..', '.env');
  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch (e) {
    return; // 无 .env 文件时静默跳过（使用 config.js 默认值）
  }
  text.split(/\r?\n/).forEach(function (raw) {
    const line = raw.trim();
    if (!line || line.charAt(0) === '#') return;
    const eq = line.indexOf('=');
    if (eq === -1) return;
    const key = line.slice(0, eq).trim();
    if (!key) return;
    let val = line.slice(eq + 1).trim();
    if (
      (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') ||
      (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'")
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  });
}

module.exports = loadEnv;

// 模块被 require 时自动注入 .env（server.js 顶部 require('./env') 即生效，无需显式调用）
loadEnv();
