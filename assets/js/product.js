/* ============================================================
   绿角犀 产品详情独立页
   - 读取 URL ?id= 调 GET /api/products/:id 渲染详情
   - 动态注入 OG / Twitter meta，使每个产品可被独立分享/收录
   - 下载按钮：打开链接 + 上报（无链接则禁用）
   - 「更多产品」拉取其余已上架产品
   纯原生 JS，零依赖。
   ============================================================ */
(function () {
  'use strict';
  var API = '/api';

  /* ---------- 导航增强（与 main.js 一致，便于独立页复用） ---------- */
  var navEl = document.querySelector('.nav');
  function syncNav() {
    if (navEl) navEl.classList.toggle('scrolled', (window.scrollY || window.pageYOffset) > 10);
  }
  syncNav();
  window.addEventListener('scroll', syncNav, { passive: true });
  var burger = document.querySelector('.hamburger');
  if (burger) {
    burger.addEventListener('click', function (e) {
      e.stopPropagation();
      document.body.classList.toggle('nav-open');
    });
    document.querySelectorAll('.nav .links a').forEach(function (a) {
      a.addEventListener('click', function () { document.body.classList.remove('nav-open'); });
    });
    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('nav-open')) return;
      if (e.target.closest('.nav')) return;
      document.body.classList.remove('nav-open');
    });
  }

  /* ---------- 触达动画 ---------- */
  // 详情内容是异步拉取后插入的，动态元素需在插入后重新扫描并观察，
  // 否则 .reveal 卡片会停留在 opacity:0 不可见（旧实现只在页面加载时扫描一次）。
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
  observeReveals();

  var BASE = location.origin;

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
  // 下载量简写（维度 63）：1234 → 1.2k，1500000 → 1.5M
  function fmtCount(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function getParam(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : '';
  }
  function setMeta(prop, content) {
    var sel = prop.indexOf('og:') === 0 || prop.indexOf('twitter:') === 0
      ? 'meta[property="' + prop + '"]'
      : 'meta[name="' + prop + '"]';
    var el = document.head.querySelector(sel);
    if (el) el.setAttribute('content', content);
  }

  /* ---------- 渲染详情 ---------- */
  function renderDetail(p) {
    var typeLabel = p.type === 'app' ? '应用' : '游戏';
    var icon = p.icon || (p.type === 'app' ? '📦' : '🎮');
    var url = p.download_url || '';
    var hasUrl = url && url !== '#';
    var btn = hasUrl
      ? '<button class="btn btn-primary download-btn" data-id="' + p.id + '" data-url="' + encodeURIComponent(url) + '">立即下载</button>'
      : '<button class="btn btn-ghost download-btn is-disabled" disabled>敬请期待</button>';

    var desc = p.desc || '暂无更多介绍。';
    var root = document.getElementById('pd-root');
    // 产品大图（维度 59/60）：有 image 时展示大图（响应式 srcset/sizes），否则回退 emoji
    // 详情页图固定 220px 宽；站内图有配套 -sm 缩略图（480w），外链退回单图
    var ss = p.image && p.image.charAt(0) === '/'
      ? p.image.replace(/(\.[^.]+)$/, '-sm$1') + ' 480w, ' + p.image + ' 960w' : '';
    var media = p.image
      ? '<img class="pd-img" src="' + esc(p.image) + '" alt="' + esc(p.name) + '"' +
        (ss ? ' srcset="' + ss + '" sizes="220px"' : '') +
        ' width="960" height="850" />'
      : '<div class="pd-icon">' + icon + '</div>';
    // 版本徽标（维度 62）：有版本号才显示，前缀 v
    var verBadge = p.version ? '<span class="pd-version">v' + esc(p.version) + '</span>' : '';
    // 下载量（维度 63）：有统计才显示，前缀 ↓
    var dlLine = typeof p.downloads === 'number' && p.downloads > 0
      ? '<div class="pd-dl">↓ ' + fmtCount(p.downloads) + ' ' + T('pd.downloads', '次下载') + '</div>' : '';
    // 更新日志（维度 62）：多行文本，CSS pre-line 保留换行；无日志则不渲染该区块
    var changelogHtml = p.changelog
      ? '<div class="pd-changelog reveal">' +
          '<div class="pd-changelog-head"><h2>' + T('pd.changelog', '更新日志') + '</h2></div>' +
          '<div class="pd-changelog-body">' + esc(p.changelog) + '</div>' +
        '</div>'
      : '';
    root.innerHTML =
      '<div class="pd-card reveal">' +
        media +
        '<div class="pd-main">' +
          '<div class="pd-title"><h1>' + esc(p.name) + '</h1>' +
            verBadge +
            '<span class="pd-type ' + p.type + '">' + typeLabel + '</span></div>' +
          '<p class="pd-desc">' + esc(desc) + '</p>' +
          dlLine +
          '<div class="pd-actions">' + btn +
            '<a class="btn btn-ghost" href="download.html">返回下载中心</a>' +
          '</div>' +
          (hasUrl ? '' : '<div class="pd-note">资源筹备中，敬请期待上线。</div>') +
        '</div>' +
      '</div>' +
      changelogHtml +
      feedbackHtml(p);
    // 动态插入的 reveal 元素重新进入观察（否则保持 opacity:0）
    observeReveals();

    // 注入社交 meta（让该产品可被独立分享/收录）
    var title = p.name + ' | 绿角犀';
    document.title = title;
    setMeta('description', (p.type === 'app' ? '应用' : '游戏') + '「' + p.name + '」——' + desc);
    setMeta('og:title', title);
    setMeta('og:description', desc);
    setMeta('og:url', BASE + '/product.html?id=' + p.id);
    setMeta('twitter:title', title);
    setMeta('twitter:description', desc);
    setMeta('canonical', BASE + '/product.html?id=' + p.id);

    // 结构化数据 JSON-LD（利于搜索引擎收录为富媒体结果）
    var cat = p.type === 'app' ? 'Application' : 'Game';
    var ld = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'SoftwareApplication',
          name: p.name,
          applicationCategory: cat,
          operatingSystem: '跨平台',
          description: desc,
          url: BASE + '/product.html?id=' + p.id,
          image: p.image ? (/^https?:\/\//i.test(p.image) ? p.image : BASE + p.image) : BASE + '/assets/img/og.jpg',
          brand: { '@type': 'Brand', name: '绿角犀 LVJIAOXI' },
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' }
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: '首页', item: BASE + '/' },
            { '@type': 'ListItem', position: 2, name: '下载中心', item: BASE + '/download.html' },
            { '@type': 'ListItem', position: 3, name: p.name, item: BASE + '/product.html?id=' + p.id }
          ]
        }
      ]
    };
    var oldLd = document.getElementById('pd-jsonld');
    if (oldLd) oldLd.parentNode.removeChild(oldLd);
    var ldScript = document.createElement('script');
    ldScript.type = 'application/ld+json';
    ldScript.id = 'pd-jsonld';
    ldScript.textContent = JSON.stringify(ld);
    document.head.appendChild(ldScript);

    // 下载上报（复用全局点击委托，这里直接绑定也行）
    if (hasUrl) {
      root.querySelector('.download-btn').addEventListener('click', function () {
        var w = window.open(url, '_blank');
        if (!w) location.href = url;
        fetch(API + '/downloads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: Number(p.id) })
        }).catch(function () {});
      });
    }
    initFeedback(p);
    loadFeedbackSummary(p.id);
  }

  // 用户反馈区块（维度 76）：评分(选填) + 称呼/邮箱(选填) + 内容(必填)，提交到 /api/feedback
  function feedbackHtml(p) {
    var stars = '';
    for (var i = 1; i <= 5; i++) {
      stars += '<button type="button" class="fb-star" data-v="' + i + '" aria-label="' + i + ' 星">★</button>';
    }
    return '<section class="pd-feedback reveal">' +
      '<div class="pd-changelog-head"><h2>' + T('fb.title', '用户反馈') + '</h2></div>' +
      '<p class="fb-sub">' + T('fb.sub', '说说你使用这款产品的体验（评分选填）') + '</p>' +
      '<div id="fb-summary" class="fb-summary" hidden></div>' +
      '<form id="fb-form" class="contact-form" novalidate>' +
        '<div class="hp" aria-hidden="true">' +
          '<label for="fb-company">请勿填写此栏</label>' +
          '<input id="fb-company" name="company" type="text" tabindex="-1" autocomplete="off" />' +
        '</div>' +
        '<div class="field">' +
          '<label>' + T('fb.rate', '评分（选填）') + '</label>' +
          '<div class="fb-stars" id="fb-stars" role="radiogroup" aria-label="评分">' + stars + '</div>' +
        '</div>' +
        '<div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
          '<div><label for="fb-name">' + T('contact.name', '称呼') + '</label>' +
            '<input id="fb-name" maxlength="60" placeholder="' + esc(T('fb.namePh', '怎么称呼你（选填）')) + '" /></div>' +
          '<div><label for="fb-email">' + T('contact.email', '邮箱') + '</label>' +
            '<input id="fb-email" type="email" maxlength="120" placeholder="you@example.com" /></div>' +
        '</div>' +
        '<div class="field">' +
          '<label for="fb-content">' + T('fb.content', '反馈内容 *') + '</label>' +
          '<textarea id="fb-content" rows="4" maxlength="500" required placeholder="' + esc(T('fb.contentPh', '使用体验、建议或遇到的问题…')) + '"></textarea>' +
        '</div>' +
        '<button class="btn btn-primary" type="submit" id="fb-submit">' + T('fb.submit', '提交反馈') + '</button>' +
        '<div class="form-msg" id="fb-msg" role="status" aria-live="polite"></div>' +
      '</form>' +
    '</section>';
  }

  // 反馈表单交互：星级选择 + 提交（成功后重置表单，提示感谢）
  function initFeedback(p) {
    var form = document.getElementById('fb-form');
    if (!form) return;
    var rating = 0;
    var stars = document.getElementById('fb-stars');
    var submitBtn = document.getElementById('fb-submit');
    var msg = document.getElementById('fb-msg');
    if (stars) {
      stars.addEventListener('click', function (e) {
        var b = e.target.closest('.fb-star');
        if (!b) return;
        rating = Number(b.getAttribute('data-v'));
        Array.prototype.forEach.call(stars.children, function (s) {
          s.classList.toggle('active', Number(s.getAttribute('data-v')) <= rating);
        });
      });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var content = document.getElementById('fb-content').value.trim();
      var name = document.getElementById('fb-name').value.trim();
      var email = document.getElementById('fb-email').value.trim();
      var company = document.getElementById('fb-company') ? document.getElementById('fb-company').value.trim() : '';
      msg.className = 'form-msg';
      msg.textContent = '';
      if (company) { msg.textContent = T('fb.err', '提交失败，请稍后再试'); msg.className = 'form-msg err'; return; }
      if (!content) { msg.textContent = T('fb.need', '请填写反馈内容'); msg.className = 'form-msg err'; return; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = T('fb.badMail', '邮箱格式不正确'); msg.className = 'form-msg err'; return; }
      submitBtn.disabled = true;
      var old = submitBtn.textContent;
      submitBtn.textContent = T('fb.sending', '提交中…');
      fetch(API + '/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: Number(p.id), name: name, email: email, content: content, rating: rating, company: company })
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j }; });
      }).then(function (res) {
        if (!res.ok) { msg.textContent = (res.j && res.j.error) || T('fb.err', '提交失败，请稍后再试'); msg.className = 'form-msg err'; return; }
        msg.textContent = T('fb.ok', '感谢你的反馈！');
        msg.className = 'form-msg ok';
        form.reset();
        if (stars) Array.prototype.forEach.call(stars.children, function (s) { s.classList.remove('active'); });
        rating = 0;
        loadFeedbackSummary(p.id); // 提交成功后刷新前台评分聚合（如管理员已审核即可见）
      }).catch(function () {
        msg.textContent = T('fb.err', '提交失败，请稍后再试');
        msg.className = 'form-msg err';
      }).then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = old;
      });
    });
  }

  // 前台评分聚合（H6a）：拉取已审核反馈 → 平均分 + 评分人数 + 最新评价摘要
  function loadFeedbackSummary(productId) {
    fetch(API + '/products/' + productId + '/feedback', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { renderFeedbackSummary(d); })
      .catch(function () {});
  }
  function renderFeedbackSummary(d) {
    var box = document.getElementById('fb-summary');
    if (!box) return;
    if (!d || !d.count) { box.hidden = true; box.innerHTML = ''; return; }
    var parts = [];
    if (d.ratedCount > 0) {
      var full = Math.round(d.avg);
      var stars = '';
      for (var i = 1; i <= 5; i++) stars += i <= full ? '★' : '☆';
      parts.push(
        '<div class="fb-avg">' +
          '<span class="fb-avg-num">' + d.avg.toFixed(1) + '</span>' +
          '<span class="fb-avg-stars" aria-hidden="true">' + stars + '</span>' +
          '<span class="fb-avg-meta">' + T('fb.avgBy', '已获 {n} 人评分').replace('{n}', d.ratedCount) + '</span>' +
        '</div>'
      );
    }
    parts.push(
      '<div class="fb-sum-head">' + T('fb.recent', '最新评价') + '</div>' +
      '<ul class="fb-sum-list">' + d.rows.map(function (r) {
        return '<li class="fb-sum-item">' +
          (r.rating > 0 ? '<span class="fb-sum-stars" title="' + r.rating + '/5" aria-hidden="true">' +
            '★★★★★'.slice(0, r.rating) + '<span class="dim">' + '★★★★★'.slice(r.rating) + '</span></span>' : '') +
          '<span class="fb-sum-content">' + esc(r.content) + '</span>' +
          '<span class="fb-sum-meta">' + esc(r.name || T('fb.anon', '匿名用户')) + ' · ' + fmtTime(r.ts) + '</span>' +
        '</li>';
      }).join('') + '</ul>'
    );
    box.innerHTML = parts.join('');
    box.hidden = false;
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderError() {
    document.getElementById('pd-root').innerHTML =
      '<div class="pd-err">' +
        '<div style="font-size:48px;margin-bottom:12px;">🧭</div>' +
        '<h2>产品不存在或已下架</h2>' +
        '<p style="color:var(--text-dim);margin:12px 0 22px;">该链接可能已失效，去看看其他产品吧。</p>' +
        '<a class="btn btn-primary" href="download.html">前往下载中心</a>' +
      '</div>';
  }

  /* ---------- 相关推荐（候选G4：同分类优先，后端 /products/:id/related） ---------- */
  function renderMore(currentId) {
    fetch(API + '/products/' + currentId + '/related?limit=4')
      .then(function (r) { return r.json(); })
      .then(function (list) {
        var others = (list || []).slice(0, 4);
        if (!others.length) return;
        var wrap = document.getElementById('pd-more-wrap');
        var box = document.getElementById('pd-more');
        box.innerHTML = others.map(function (p) {
          var icon = p.icon || (p.type === 'app' ? '📦' : '🎮');
          var t = p.type === 'app' ? '应用' : '游戏';
          var media = p.image
            ? '<img class="pimg" src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy" decoding="async" width="960" height="850" />'
            : '<div class="picon">' + icon + '</div>';
          return '' +
            '<a class="product-card" href="product.html?id=' + p.id + '">' +
              '<div class="pmedia">' + media + '</div>' +
              '<div class="top">' +
                '<div class="picon-mini">' + icon + '</div>' +
                '<div><div class="pname">' + esc(p.name) + '</div>' +
                '<div class="ptype">' + t + '</div></div>' +
              '</div>' +
              '<div class="pdesc">' + esc(p.desc || '') + '</div>' +
            '</a>';
        }).join('');
        wrap.style.display = '';
      })
      .catch(function () {});
  }

  /* ---------- 前台公告条（候选G3，与 main.js 一致） ---------- */
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

  /* ---------- 启动 ---------- */
  var id = getParam('id');
  if (!id) { renderError(); return; }
  fetch(API + '/products/' + encodeURIComponent(id))
    .then(function (r) {
      if (!r.ok) throw new Error('not found');
      return r.json();
    })
    .then(function (p) {
      renderDetail(p);
      renderMore(p.id);
      // 浏览上报
      var tz = (window.Intl && Intl.DateTimeFormat)
        ? (Intl.DateTimeFormat().resolvedOptions().timeZone || '')
        : '';
      fetch(API + '/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: 'product:' + p.id,
          referer: document.referrer || '',
          ua: navigator.userAgent || '',
          lang: navigator.language || navigator.userLanguage || '',
          tz: tz
        })
      }).catch(function () {});
    })
    .catch(function () { renderError(); });
})();
