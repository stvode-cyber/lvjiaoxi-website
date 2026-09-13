/* ============================================================
   绿角犀官网 无障碍动效工具
   - prefersReducedMotion()：查询用户是否开启「减弱动态效果」
     （matchMedia 一次性缓存 + change 时刷新，避免重复构造 MediaQueryList）
   纯原生 JS，零依赖。
   ============================================================ */
(function () {
  'use strict';

  var mql = null;
  var reduced = false;

  function read() {
    reduced = !!(mql && mql.matches);
  }

  if (typeof window.matchMedia === 'function') {
    mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    read();
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', read);
    } else if (typeof mql.addListener === 'function') {
      mql.addListener(read); // 旧引擎回退
    }
  }

  window.prefersReducedMotion = function () { return reduced; };
})();
