/* 绿角犀官网 离线页网络状态监听
   断线时给出明确反馈，恢复网络后自动回首页，无需手动刷新。
   独立外置脚本：CSP script-src 'self' 禁止内联脚本，内联版会被浏览器拦截。 */
(function () {
  'use strict';

  var state = document.getElementById('offline-state');
  var btn = document.getElementById('retry-btn');
  if (!state || !btn) return;

  function render() {
    if (navigator.onLine) {
      state.textContent = '网络已恢复，正在为你返回首页…';
    } else {
      state.textContent = '仍处于离线状态。恢复网络后本页会自动跳转。';
    }
  }

  btn.addEventListener('click', function () {
    if (navigator.onLine) location.replace('index.html');
    else { render(); location.reload(); }
  });

  window.addEventListener('online', function () {
    render();
    setTimeout(function () { location.replace('index.html'); }, 800);
  });
  window.addEventListener('offline', render);

  render();
})();
