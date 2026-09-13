/* 绿角犀官网 PWA：Service Worker 注册 + 新版本更新提示 + 手动检查更新入口
   - 自动检测：sw.js 字节变化（发布新版本）→ 浏览器触发 updatefound → 新 SW installed
     且页面已被旧 SW 控制（非首次安装）时，弹出底部提示条「发现新版本，点击刷新」。
   - 手动检查：暴露 window.checkPWAUpdate()（后台「检查更新」按钮 / 控制台可调用），
     重新拉取 sw.js 探测新版本。
   - 定时探测：每小时一次（浏览器默认 24h，这里加密，缩短「发布→用户感知」延迟）。
   - 提示条文案随 i18n 语言切换实时更新（gr:langchange）。
   纯原生 JS，零依赖；i18n.js 在本脚本之后加载，取词需运行时判断。 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;

  var CHECK_INTERVAL = 60 * 60 * 1000; // 1 小时
  var regRef = null;   // 当前 ServiceWorkerRegistration
  var bar = null;      // 更新提示条 DOM
  var busy = false;    // 正在应用更新（防重复点击）

  // i18n 取词：i18n.js 提供 window.GRI18n（dict + get），缺失回退默认文案
  function tt(key, fb) {
    try {
      var g = window.GRI18n;
      var d = g && g.dict;
      var l = g ? g.get() : 'zh';
      var t = d && d[l] && d[l][key];
      return (t != null) ? t : fb;
    } catch (e) { return fb; }
  }

  function showBar() {
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'pwa-update-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML =
      '<span class="pwa-update-msg"></span>' +
      '<button type="button" class="pwa-update-btn"></button>' +
      '<button type="button" class="pwa-update-close" aria-label=""></button>';
    document.body.appendChild(bar);
    bar.querySelector('.pwa-update-btn').addEventListener('click', applyUpdate);
    bar.querySelector('.pwa-update-close').addEventListener('click', function () { hideBar(); });
    renderBar();
  }
  function renderBar() {
    if (!bar) return;
    bar.querySelector('.pwa-update-msg').textContent = tt('pwa.update', '发现新版本，点击刷新即可更新');
    bar.querySelector('.pwa-update-btn').textContent = tt('pwa.refresh', '刷新');
    bar.querySelector('.pwa-update-close').textContent = '×';
    bar.querySelector('.pwa-update-close').setAttribute('aria-label', tt('pwa.close', '关闭'));
  }
  function hideBar() {
    if (bar) { bar.remove(); bar = null; }
  }
  function applyUpdate() {
    if (busy) return;
    busy = true;
    // 通知等待中的新 SW 立即接管（若尚未 skipWaiting），随后刷新页面加载新版本
    var waiting = regRef && regRef.waiting;
    if (waiting) {
      try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
    }
    window.location.reload();
  }

  // 新 SW 出现：仅在「页面已被旧 SW 控制」时提示（首次安装静默，不打扰访客）
  function onUpdateFound() {
    var nw = regRef && regRef.installing;
    if (!nw) return;
    nw.addEventListener('statechange', function () {
      if (nw.state === 'installed' && navigator.serviceWorker.controller) {
        showBar();
      }
    });
  }

  function registerSW() {
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      regRef = reg;
      reg.addEventListener('updatefound', onUpdateFound);
    }).catch(function (err) {
      console.warn('SW register failed:', err);
    });
  }

  // 手动检查更新（后台「检查更新」按钮 / 控制台可调用）
  window.checkPWAUpdate = function () {
    if (busy) return;
    if (!regRef) { registerSW(); return; }
    regRef.update().catch(function (err) { console.warn('SW update check failed:', err); });
  };

  // 语言切换时重翻译提示条
  window.addEventListener('gr:langchange', renderBar);

  if (document.readyState === 'loading') {
    window.addEventListener('load', registerSW);
  } else {
    registerSW();
  }
  // 定期自动探测新版本（同源 update() 开销极小）
  setInterval(function () {
    if (regRef && !busy) { regRef.update().catch(function () {}); }
  }, CHECK_INTERVAL);
})();
