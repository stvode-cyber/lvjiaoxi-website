/* ============================================================
   绿角犀官网 主题切换（暗 / 亮）
   - 初始主题由 <head> 内联脚本按 localStorage / 系统偏好写入 <html data-theme>，
     本文件只负责交互与持久化，避免首屏闪烁。
   - 选择器 .theme-toggle 可在任意页面复用，点击即在 dark/light 间切换。
   纯原生 JS，零依赖，挂在 window 上以便调试。
   ============================================================ */
(function () {
  'use strict';

  var STORE_KEY = 'gr-theme';
  var META_DARK = '#0a0e27';
  var META_LIGHT = '#f3f5fb';

  function root() { return document.documentElement; }

  function current() {
    var t = root().getAttribute('data-theme');
    return (t === 'light' || t === 'dark') ? t : 'dark';
  }

  function apply(t) {
    root().setAttribute('data-theme', t);
    try { localStorage.setItem(STORE_KEY, t); } catch (e) {}
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? META_LIGHT : META_DARK);
    var btns = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', String(t === 'light'));
    }
  }

  function toggle() {
    apply(current() === 'light' ? 'dark' : 'light');
  }

  // 事件委托：页面内所有 .theme-toggle 都生效（含动态渲染）
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.theme-toggle');
    if (!btn) return;
    e.preventDefault();
    toggle();
  });

  // 同步初始状态（内联脚本已设好 data-theme，这里补齐持久化与 aria）
  apply(current());

  window.GRTheme = { get: current, set: apply, toggle: toggle };
})();
