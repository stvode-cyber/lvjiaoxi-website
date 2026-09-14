/* ============================================================
   绿角犀官网 前端脚本
   - 触达式动态：IntersectionObserver 扫描 .reveal，进入视口加 .in-view
   - 浏览/下载埋点上报（POST /api/views、/api/downloads）
   - 下载页从 /api/products 拉取「已上架」产品并渲染卡片
   - 数字滚动到视口时跳动（.num[data-count]）
   纯原生 JS，零依赖。
   ============================================================ */
(function () {
  'use strict';
  var API = '/api';

  /* ---------- 0) 导航增强：吸顶强化 + 移动端菜单 + 滚动高亮 ---------- */
  var navEl = document.querySelector('.nav');

  // 0.1 滚动时给导航加 .scrolled，强化玻璃背景
  function syncNav() {
    if (navEl) navEl.classList.toggle('scrolled', (window.scrollY || window.pageYOffset) > 10);
  }
  syncNav();
  window.addEventListener('scroll', syncNav, { passive: true });

  // 0.2 移动端汉堡菜单
  var burger = document.querySelector('.hamburger');
  if (burger) {
    burger.setAttribute('aria-expanded', 'false');
    function setMenu(open) {
      document.body.classList.toggle('nav-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    }
    burger.addEventListener('click', function (e) {
      e.stopPropagation();
      setMenu(!document.body.classList.contains('nav-open'));
    });
    // 点击任意导航链接后收起菜单
    document.querySelectorAll('.nav .links a').forEach(function (a) {
      a.addEventListener('click', function () { setMenu(false); });
    });
    // 点击菜单外部收起
    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('nav-open')) return;
      if (e.target.closest('.nav')) return;
      setMenu(false);
    });
  }

  // 0.3 滚动高亮当前章节（仅本页锚点参与）
  var spyLinks = [].slice.call(document.querySelectorAll('.nav .links a')).filter(function (a) {
    var h = a.getAttribute('href') || '';
    if (h.charAt(0) !== '#' || h.length < 2) return false;
    return !!document.getElementById(h.slice(1));
  });
  if (spyLinks.length && 'IntersectionObserver' in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var id = en.target.id;
        spyLinks.forEach(function (a) {
          a.classList.toggle('active', a.getAttribute('href') === '#' + id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    spyLinks.forEach(function (a) {
      var sec = document.getElementById(a.getAttribute('href').slice(1));
      if (sec) spy.observe(sec);
    });
    // 初始高亮首个可见锚点（首屏通常是 #home）
    var first = spyLinks[0];
    if (first) first.classList.add('active');
  }

  /* ---------- 0.4 快捷键：/ 聚焦导航搜索框，Esc 已用于关闭弹窗 ---------- */
  document.addEventListener('keydown', function (e) {
    // 用户正在输入框/textarea 里打字时不要拦截
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === '/' || e.code === 'Slash') {
      var q = document.getElementById('nav-q');
      if (q) { e.preventDefault(); q.focus(); q.select(); }
    }
  });

  /* ---------- 1) 触达式动态 ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in-view');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.15 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in-view'); });
  }

  /* ---------- 2) 浏览上报 ---------- */
  var page = document.body.getAttribute('data-page');
  if (page) {
    var tz = (window.Intl && Intl.DateTimeFormat)
      ? (Intl.DateTimeFormat().resolvedOptions().timeZone || '')
      : '';
    fetch(API + '/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page: page,
        referer: document.referrer || '',
        ua: navigator.userAgent || '',
        lang: navigator.language || navigator.userLanguage || '',
        tz: tz
      })
    }).catch(function () {});
  }

  /* ---------- 3) 数字滚动 ---------- */
  var counters = document.querySelectorAll('.num[data-count]');
  if (counters.length && 'IntersectionObserver' in window) {
    var co = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { animateCount(e.target); co.unobserve(e.target); }
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { co.observe(el); });
  }
  function animateCount(el) {
    var target = Number(el.getAttribute('data-count')) || 0;
    // 尊重减弱动态：直接落最终值，跳过数字滚动
    if (window.prefersReducedMotion && window.prefersReducedMotion()) {
      el.textContent = target.toLocaleString();
      return;
    }
    var dur = 1200, start = performance.now();
    function step(now) {
      var t = Math.min(1, (now - start) / dur);
      var v = Math.floor((1 - Math.pow(1 - t, 3)) * target);
      el.textContent = v.toLocaleString();
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = target.toLocaleString();
    }
    requestAnimationFrame(step);
  }

  /* ---------- 4) 下载页：拉取 + 搜索/分类筛选 ---------- */
  var ALL = [];                       // 全量已上架产品
  var byId = {};                      // id -> 产品对象，供详情弹窗快速取用
  var state = { type: 'all', kw: '', category: '', sort: 'default' };

  // 响应式图片（维度 60）：站内 /assets/img/ 图有配套 -sm 缩略图（480w），按视口宽度选档；
  // 外链无配套变体，退回单图 src（srcsetList 返回空串）
  var IMG_SM_W = 480;
  var IMG_CARD_SIZES = '(min-width: 1000px) 354px, (min-width: 700px) 46vw, calc(100vw - 48px)';
  var IMG_MODAL_SIZES = '(min-width: 520px) 384px, calc(92vw - 56px)';
  function srcsetList(src) {
    if (!src || src.charAt(0) !== '/') return '';
    return src.replace(/(\.[^.]+)$/, '-sm$1') + ' ' + IMG_SM_W + 'w, ' + src + ' 960w';
  }

  // 下载量简写（维度 63）：1234 → 1.2k，1500000 → 1.5M
  function fmtCount(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function cardHTML(p) {
    var icon = p.icon || (p.type === 'app' ? '📦' : '🎮');
    var typeLabel = p.type === 'app' ? '应用' : '游戏';
    var url = p.download_url || '';
    var hasUrl = url && url !== '#';
    var btn = hasUrl
      ? '<button class="btn btn-primary download-btn" data-id="' + p.id + '" data-url="' + encodeURIComponent(url) + '">下载</button>'
      : '<button class="btn btn-ghost download-btn is-disabled" disabled>敬请期待</button>';
    // 产品大图（维度 59/60）：有 image 时渲染大图（懒加载 + 固定宽高防布局抖动 + srcset/sizes 响应式），否则回退 emoji 图标
    var ss = srcsetList(p.image);
    var media = p.image
      ? '<img class="pimg" src="' + esc(p.image) + '" alt="' + esc(p.name) + '"' +
        (ss ? ' srcset="' + ss + '" sizes="' + IMG_CARD_SIZES + '"' : '') +
        ' loading="lazy" decoding="async" width="960" height="850" />'
      : '<div class="picon">' + icon + '</div>';
    return '' +
      '<div class="product-card" data-id="' + p.id + '">' +
        '<div class="pmedia">' + media + '</div>' +
        '<div class="top">' +
          '<div class="picon-mini">' + icon + '</div>' +
          '<div><div class="pname">' + esc(p.name) + '</div>' +
          '<div class="ptype">' + typeLabel + (p.category ? ' · ' + esc(p.category) : '') + '</div></div>' +
          (typeof p.downloads === 'number' && p.downloads > 0
            ? '<span class="pcard-dl" title="' + p.downloads + ' 次下载">↓ ' + fmtCount(p.downloads) + '</span>' : '') +
        '</div>' +
        '<div class="pdesc">' + esc(p.desc || '') + '</div>' +
        '<div class="pcard-foot">' + btn +
          '<button class="btn btn-ghost detail-btn" type="button">详情 ›</button>' +
        '</div>' +
      '</div>';
  }

  // 渲染某一类到对应网格；hideSection=true 时隐藏整个区块
  function paint(containerId, list, hideSection) {
    var c = document.getElementById(containerId);
    if (!c) return;
    var section = c.closest('section');
    if (hideSection) { if (section) section.style.display = 'none'; return; }
    if (section) section.style.display = '';
    if (!list.length) { c.innerHTML = '<div class="empty">未找到匹配的产品</div>'; return; }
    c.innerHTML = list.map(cardHTML).join('');
  }

  function renderProducts() {
    var kw = state.kw.trim().toLowerCase();
    var cat = state.category;
    var buckets = { app: [], game: [] };
    ALL.forEach(function (p) {
      if (state.type !== 'all' && p.type !== state.type) return;
      if (cat && (p.category || '') !== cat) return;
      if (kw && (p.name + ' ' + (p.desc || '') + ' ' + (p.category || '')).toLowerCase().indexOf(kw) === -1) return;
      buckets[p.type].push(p);
    });
    sortProducts(buckets.app);
    sortProducts(buckets.game);
    paint('app-list', buckets.app, state.type === 'game');
    paint('game-list', buckets.game, state.type === 'app');
  }

  // 排序切换（候选G2）：default=后台权重+ID 升序（贴近默认上下架顺序）、new=最近上架、hot=下载量、name=名称
  function sortProducts(list) {
    var s = state.sort;
    if (s === 'new') list.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
    else if (s === 'hot') list.sort(function (a, b) { return (b.downloads || 0) - (a.downloads || 0); });
    else if (s === 'name') list.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    else list.sort(function (a, b) { return (b.sort || 0) - (a.sort || 0) || (a.id || 0) - (b.id || 0); });
    return list;
  }

  // 分类下拉：优先从 /api/categories 后台枚举构建（维度 58），失败时退回从已加载产品收集
  function buildCategoryOptions(names) {
    var sel = document.getElementById('category-filter');
    if (!sel) return;
    var current = sel.value;
    var html = '<option value="">全部分类</option>' +
      names.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    if (sel.innerHTML !== html) sel.innerHTML = html;
    if (names.indexOf(current) !== -1) sel.value = current;
    else if (current) { state.category = ''; }
  }
  function refreshCategoryOptions() {
    var sel = document.getElementById('category-filter');
    if (!sel) return;
    var fallback = function () {
      var cats = {};
      ALL.forEach(function (p) { if (p.category) cats[p.category] = 1; });
      buildCategoryOptions(Object.keys(cats).sort());
    };
    fetch(API + '/categories')
      .then(function (r) { return r.json(); })
      .then(function (list) {
        var names = (list || []).map(function (c) { return c && c.name; }).filter(Boolean);
        if (names.length) buildCategoryOptions(names);
        else fallback();
      })
      .catch(fallback);
  }

  function loadAll() {
    fetch(API + '/products')
      .then(function (r) { return r.json(); })
      .then(function (list) {
        ALL = list || [];
        byId = {};
        ALL.forEach(function (p) { byId[p.id] = p; });
        refreshCategoryOptions();
        renderProducts();
      })
      .catch(function () {
        ['app-list', 'game-list'].forEach(function (id) {
          var c = document.getElementById(id);
          if (c) c.innerHTML = '<div class="empty">加载失败，请刷新重试</div>';
        });
      });
  }

  /* ---------- 4.0) 首页：实时展示在架产品（按业务线分桶） ---------- */
  function homeCardHTML(p) {
    var icon = p.icon || (p.type === 'app' ? '📦' : '🎮');
    var typeLabel = p.type === 'app' ? '应用' : '游戏';
    var ss = srcsetList(p.image);
    var media = p.image
      ? '<img class="pimg" src="' + esc(p.image) + '" alt="' + esc(p.name) + '"' +
        (ss ? ' srcset="' + ss + '" sizes="' + IMG_CARD_SIZES + '"' : '') +
        ' loading="lazy" decoding="async" width="960" height="850" />'
      : '<div class="picon">' + icon + '</div>';
    return '' +
      '<div class="product-card" data-home="1">' +
        '<div class="pmedia">' + media + '</div>' +
        '<div class="top">' +
          '<div class="picon-mini">' + icon + '</div>' +
          '<div><div class="pname">' + esc(p.name) + '</div>' +
          '<div class="ptype">' + typeLabel + (p.category ? ' · ' + esc(p.category) : '') + '</div></div>' +
          (typeof p.downloads === 'number' && p.downloads > 0
            ? '<span class="pcard-dl" title="' + p.downloads + ' 次下载">↓ ' + fmtCount(p.downloads) + '</span>' : '') +
        '</div>' +
        '<div class="pdesc">' + esc(p.desc || '') + '</div>' +
        '<div class="pcard-foot">' +
          '<a class="btn btn-ghost detail-btn" href="product.html?id=' + p.id + '">查看详情 ›</a>' +
        '</div>' +
      '</div>';
  }
  function loadHomeProducts() {
    var ha = document.getElementById('home-apps');
    var hg = document.getElementById('home-games');
    if (!ha && !hg) return;
    fetch(API + '/products')
      .then(function (r) { return r.json(); })
      .then(function (list) {
        var apps = (list || []).filter(function (p) { return p.type === 'app'; });
        var games = (list || []).filter(function (p) { return p.type === 'game'; });
        if (ha) ha.innerHTML = apps.length ? apps.map(homeCardHTML).join('') : '<div class="empty">暂无上架应用</div>';
        if (hg) hg.innerHTML = games.length ? games.map(homeCardHTML).join('') : '<div class="empty">暂无上架游戏</div>';
      })
      .catch(function () {
        if (ha) ha.innerHTML = '<div class="empty">加载失败，请刷新重试</div>';
        if (hg) hg.innerHTML = '<div class="empty">加载失败，请刷新重试</div>';
      });
  }

  /* ---------- 4.05) 热门下载排行（维度 65） ---------- */
  // 热门条目：排名徽章（前 3 名高亮）+ 缩略图 + 名称/类型 + 下载量徽标；点击进详情
  function hotItemHTML(p, i) {
    var icon = p.icon || (p.type === 'app' ? '📦' : '🎮');
    var typeLabel = p.type === 'app' ? '应用' : '游戏';
    var rank = i + 1;
    var rankCls = 'hot-rank' + (rank <= 3 ? ' top' + rank : '');
    var ss = srcsetList(p.image);
    var media = p.image
      ? '<img class="pimg" src="' + esc(p.image) + '" alt="' + esc(p.name) + '"' +
        (ss ? ' srcset="' + ss + '" sizes="220px"' : '') +
        ' loading="lazy" decoding="async" width="960" height="850" />'
      : '<div class="picon">' + icon + '</div>';
    return '' +
      '<div class="hot-item" data-id="' + p.id + '">' +
        '<span class="' + rankCls + '" aria-hidden="true">' + rank + '</span>' +
        '<div class="pmedia">' + media + '</div>' +
        '<div class="hot-info">' +
          '<div class="pname">' + esc(p.name) + '</div>' +
          '<div class="ptype">' + typeLabel + (p.category ? ' · ' + esc(p.category) : '') + '</div>' +
        '</div>' +
        (typeof p.downloads === 'number' && p.downloads > 0
          ? '<span class="pcard-dl" title="' + p.downloads + ' 次下载">↓ ' + fmtCount(p.downloads) + '</span>' : '') +
      '</div>';
  }
  function loadHot() {
    var c = document.getElementById('hot-list');
    if (!c) return;
    fetch(API + '/products/hot?limit=5')
      .then(function (r) { return r.json(); })
      .then(function (list) {
        if (!list || !list.length) { c.innerHTML = '<div class="empty">暂无热门数据</div>'; return; }
        c.innerHTML = list.map(hotItemHTML).join('');
        list.forEach(function (p) { if (!byId[p.id]) byId[p.id] = p; });
        if ('IntersectionObserver' in window) {
          c.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in-view'); });
        }
      })
      .catch(function () { c.innerHTML = '<div class="empty">加载失败</div>'; });
  }

  /* ---------- 4.1) 产品详情弹窗 ---------- */
  var modal = document.getElementById('pd-modal');
  function openModal(p) {
    if (!modal || !p) return;
    var pi = document.getElementById('pd-icon');
    var pim = document.getElementById('pd-img');
    if (p.image && pim) {
      pim.src = p.image;
      pim.alt = p.name;
      // 响应式（维度 60）：站内图按弹窗宽度选档，外链清空 srcset 退回单图
      pim.srcset = srcsetList(p.image) || '';
      pim.sizes = pim.srcset ? IMG_MODAL_SIZES : '';
      pim.style.display = '';
      if (pi) pi.style.display = 'none';
    } else {
      if (pim) pim.style.display = 'none';
      if (pi) { pi.style.display = ''; pi.textContent = p.icon || (p.type === 'app' ? '📦' : '🎮'); }
    }
    document.getElementById('pd-name').textContent = p.name;
    var t = document.getElementById('pd-type');
    t.textContent = p.type === 'app' ? '应用' : '游戏';
    t.className = 'modal-type ' + p.type;
    document.getElementById('pd-desc').textContent = p.desc || '暂无更多介绍。';
    document.getElementById('pd-page').setAttribute('href', 'product.html?id=' + p.id);
    var dl = document.getElementById('pd-download');
    var url = p.download_url || '';
    var hasUrl = url && url !== '#';
    var hint = document.getElementById('pd-hint');
    if (hasUrl) {
      dl.classList.remove('is-disabled'); dl.disabled = false;
      dl.setAttribute('data-id', p.id);
      dl.setAttribute('data-url', encodeURIComponent(url));
      hint.textContent = '';
    } else {
      dl.classList.add('is-disabled'); dl.disabled = true;
      dl.removeAttribute('data-id'); dl.removeAttribute('data-url');
      hint.textContent = '资源筹备中，敬请期待。';
    }
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }
  function closeModal() {
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }
  // 热门排行项点击（维度 65）：下载页走详情弹窗，首页跳独立详情页
  document.addEventListener('click', function (e) {
    var hot = e.target.closest('.hot-item');
    if (!hot) return;
    var id = Number(hot.getAttribute('data-id'));
    var p = byId[id];
    if (p && modal) openModal(p);
    else if (id) location.href = 'product.html?id=' + id;
  });
  // 点击卡片（非下载按钮）打开详情（首页 data-home 卡片走详情页链接，跳过）
  document.addEventListener('click', function (e) {
    if (e.target.closest('.download-btn')) return;   // 下载按钮交给下载逻辑
    var card = e.target.closest('.product-card');
    if (!card || card.hasAttribute('data-home')) return;
    var p = byId[card.getAttribute('data-id')];
    if (p) openModal(p);
  });
  // 关闭：背景 / × 按钮
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeModal();
    });
    // 弹窗内下载后顺手关闭弹窗
    document.getElementById('pd-download').addEventListener('click', closeModal);
  }
  // ESC 关闭
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal && modal.classList.contains('show')) closeModal();
  });

  // 搜索框
  var searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      state.kw = searchInput.value || '';
      renderProducts();
    });
  }
  // 全站搜索联动（维度 64）：导航搜索跳转 download.html?q=… 时自动套用过滤并滚动到结果区
  var qMatch = /[?&]q=([^&]*)/.exec(window.location.search);
  var qFromUrl = qMatch ? decodeURIComponent(qMatch[1]).trim() : '';
  if (qFromUrl) {
    state.kw = qFromUrl;
    if (searchInput) searchInput.value = qFromUrl;
    var fEl = document.querySelector('.filters');
    if (fEl) setTimeout(function () {
      fEl.scrollIntoView({ behavior: (window.prefersReducedMotion && window.prefersReducedMotion()) ? 'auto' : 'smooth', block: 'start' });
    }, 60);
  }
  // 预填导航搜索框（任意页面带 ?q= 时保持可见状态）
  var navQ = document.getElementById('nav-q');
  if (navQ) navQ.value = qFromUrl;
  // 分类切换
  var chips = document.getElementById('type-chips');
  if (chips) {
    chips.addEventListener('click', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      state.type = btn.getAttribute('data-type') || 'all';
      chips.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
      btn.classList.add('active');
      renderProducts();
      if (state.type === 'app' || state.type === 'game') {
        var f = document.querySelector('.filters');
        if (f) f.scrollIntoView({ behavior: (window.prefersReducedMotion && window.prefersReducedMotion()) ? 'auto' : 'smooth', block: 'start' });
      }
    });
  }
  // 分类下拉筛选
  var catSel = document.getElementById('category-filter');
  if (catSel) {
    catSel.addEventListener('change', function () {
      state.category = catSel.value || '';
      renderProducts();
    });
  }
  // 排序下拉筛选（候选G2）：改变排序方式后重渲染
  var sortSel = document.getElementById('sort-filter');
  if (sortSel) {
    sortSel.addEventListener('change', function () {
      state.sort = sortSel.value || 'default';
      renderProducts();
    });
  }
  // 导航「应用/游戏」联动分类筛选
  document.querySelectorAll('.nav .links a[href="#apps"], .nav .links a[href="#games"]').forEach(function (a) {
    a.addEventListener('click', function () {
      var t = a.getAttribute('href') === '#apps' ? 'app' : 'game';
      state.type = t;
      if (chips) chips.querySelectorAll('.chip').forEach(function (c) {
        c.classList.toggle('active', c.getAttribute('data-type') === t);
      });
      renderProducts();
    });
  });

  // 下载按钮：先打开链接，再上报（禁用按钮不触发）
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.download-btn');
    if (!btn || btn.disabled) return;
    var id = btn.getAttribute('data-id');
    var url = decodeURIComponent(btn.getAttribute('data-url') || '#');
    if (url && url !== '#') {
      var w = window.open(url, '_blank');
      if (!w) location.href = url;
    }
    fetch(API + '/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: Number(id) })
    }).catch(function () {});
  });

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /* ---------- 5) 前台公告条（候选G3） ---------- */
  // 后台维护的公告：仅展示最新一条启用中的；用户关闭后本机 localStorage 记忆，不再打扰
  var annBar = document.getElementById('ann-bar');
  if (annBar) {
    (function () {
      var annId = 0;
      fetch(API + '/announcement')
        .then(function (r) { return r.json(); })
        .then(function (a) {
          if (!a || !a.content) return;
          try {
            if (localStorage.getItem('gr-ann-off-' + a.id) === '1') return;
          } catch (e) {}
          annId = a.id;
          var msg = document.getElementById('ann-msg');
          if (msg) msg.textContent = a.content;
          annBar.hidden = false;
        })
        .catch(function () {});
      annBar.addEventListener('click', function (e) {
        if (!e.target.closest('.ann-close')) return;
        try { if (annId) localStorage.setItem('gr-ann-off-' + annId, '1'); } catch (err) {}
        annBar.hidden = true;
      });
    })();
  }

  loadAll();
  loadHomeProducts();
  loadHot();
})();
