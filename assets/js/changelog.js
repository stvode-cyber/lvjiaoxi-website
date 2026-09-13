/* ============================================================
   绿角犀 产品更新动态聚合页（H6b）
   - 调 GET /api/products 拉取已上架产品，按产品分组展示
     version（版本号）与 changelog（多行更新日志）
   - 过滤规则：version 与 changelog 均为空的产品不展示
   - 纯原生 JS，零依赖。
   ============================================================ */
(function () {
  'use strict';
  var API = '/api';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  // 轻量取当前语言文案：i18n.js 在 body 尾部加载（晚于本脚本），渲染时已就绪；取不到则用兜底文案
  function T(key, fallback) {
    try {
      var g = window.GRI18n;
      var dict = g && g.dict[g.get()];
      if (dict && dict[key] != null) return dict[key];
    } catch (e) {}
    return fallback;
  }

  var listEl = document.getElementById('chg-list');
  if (!listEl) return;

  fetch(API + '/products', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (products) {
      if (!products) { listEl.innerHTML = '<div class="empty">' + (T('chg.loadErr', '加载失败，请刷新重试')) + '</div>'; return; }
      var items = (products || []).filter(function (p) {
        return (p.version && String(p.version).trim()) || (p.changelog && String(p.changelog).trim());
      });
      if (!items.length) { listEl.innerHTML = '<div class="empty">' + (T('chg.empty', '暂无更新动态')) + '</div>'; return; }
      listEl.innerHTML = items.map(function (p) {
        var icon = p.icon || (p.type === 'app' ? '📦' : '🎮');
        var typeLabel = p.type === 'app' ? (T('type.app', '应用')) : (T('type.game', '游戏'));
        var ver = p.version ? '<span class="chg-ver">v' + esc(p.version) + '</span>' : '';
        var logs = String(p.changelog || '').split(/\n+/).map(function (line) {
          return line.trim().replace(/^[-·—]\s*/, '');
        }).filter(Boolean).map(function (line) {
          return '<li>' + esc(line) + '</li>';
        }).join('');
        return '<article class="chg-card reveal">' +
          '<div class="chg-head">' +
            '<span class="chg-icon" aria-hidden="true">' + icon + '</span>' +
            '<div class="chg-meta">' +
              '<h2><a href="product.html?id=' + p.id + '">' + esc(p.name) + '</a></h2>' +
              '<div class="chg-tags">' + ver +
                '<span class="pd-type ' + (p.type === 'app' ? 'app' : 'game') + '">' + typeLabel + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          (logs ? '<ul class="chg-logs">' + logs + '</ul>' : '<p class="chg-empty">' + (T('chg.noLog', '暂无更新说明')) + '</p>') +
        '</article>';
      }).join('');
      observeReveals();
    })
    .catch(function () {
      listEl.innerHTML = '<div class="empty">' + (T('chg.loadErr', '加载失败，请刷新重试')) + '</div>';
    });

  // 动态插入的 .reveal 卡片进入视口后加 .in-view（避免停留在 opacity:0）
  var revealIo = null;
  function observeReveals() {
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in-view'); });
      return;
    }
    if (!revealIo) {
      revealIo = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('in-view'); revealIo.unobserve(e.target); }
        });
      }, { threshold: 0.15 });
    }
    document.querySelectorAll('.reveal:not(.in-view)').forEach(function (el) { revealIo.observe(el); });
  }
})();
