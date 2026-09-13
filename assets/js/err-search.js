/* 绿角犀官网 404 页站内产品搜索
   - 通过公开 API /api/products 拉取在架产品，客户端模糊匹配（小目录，无需服务端搜索）
   - 匹配范围：名称 / 分类 / 类型 / 描述，任一包含即命中；名称命中优先排序保持相关度
   - 结果实时下拉展示，点击跳转产品详情页；非名称命中给一行上下文说明
   - 无障碍：combobox + listbox 模式，↑/↓ 键盘导航、Enter 选中、aria-activedescendant、
     aria-expanded、结果数量/空态 live region 播报；无 JS 时原生 <input type=search> 仍可用
   - 失败（离线 / 接口异常）时给出明确提示，不静默失败
   纯原生 JS，零依赖；CSP script-src 'self' 下外置脚本运行。 */
(function () {
  'use strict';

  var input = document.getElementById('err-search');
  var box = document.getElementById('err-results');
  var live = document.getElementById('err-live');
  if (!input || !box) return;

  var products = [];
  var loaded = false;
  var timer = null;
  var active = -1; // 当前高亮结果下标；-1 = 无
  var lastQ = '';  // 最近一次查询词（渲染命中提示用）

  function fetchProducts() {
    return fetch('/api/products')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (list) { products = Array.isArray(list) ? list : []; loaded = true; });
  }

  function setExpanded(open) {
    input.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function resultLinks() {
    return box.querySelectorAll('.err-result');
  }

  // 高亮第 idx 项并同步 aria-activedescendant；idx=-1 清除
  function setActive(idx) {
    var links = resultLinks();
    active = idx;
    if (idx < 0 || idx >= links.length) {
      links.forEach(function (a) { a.classList.remove('active'); });
      input.removeAttribute('aria-activedescendant');
      return;
    }
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle('active', i === idx);
    }
    input.setAttribute('aria-activedescendant', links[idx].id);
  }

  function render(list, message) {
    box.innerHTML = '';
    setActive(-1);
    if (message) {
      var note = document.createElement('div');
      note.className = 'err-results-note';
      note.textContent = message;
      box.appendChild(note);
      setExpanded(true);
      announce(message);
      return;
    }
    list.forEach(function (p, i) {
      var a = document.createElement('a');
      a.className = 'err-result';
      a.id = 'err-result-' + i;
      a.href = 'product.html?id=' + encodeURIComponent(p.id);
      a.setAttribute('role', 'option');
      var icon = document.createElement('span');
      icon.className = 'err-result-icon';
      icon.textContent = p.icon || '📦';
      var name = document.createElement('span');
      name.className = 'err-result-name';
      name.textContent = p.name;
      // 非名称命中（分类/类型/描述）时给一行简短说明，避免「结果为什么出现」的困惑
      var hintTxt = matchHint(p, lastQ);
      var main = document.createElement('span');
      main.className = 'err-result-main';
      main.appendChild(name);
      if (hintTxt) {
        var hint = document.createElement('span');
        hint.className = 'err-result-hint';
        hint.textContent = hintTxt;
        main.appendChild(hint);
      }
      var tag = document.createElement('span');
      tag.className = 'err-result-type';
      tag.textContent = p.type === 'game' ? '游戏' : '应用';
      a.appendChild(icon);
      a.appendChild(main);
      a.appendChild(tag);
      box.appendChild(a);
    });
    setExpanded(list.length > 0);
    announce(list.length > 0 ? '找到 ' + list.length + ' 个结果' : dictMsg('err.searchEmpty') || '未找到相关产品');
  }

  function announce(msg) {
    if (live && msg) live.textContent = msg;
  }

  // 相关度：名称命中 0 > 分类/类型命中 1 > 描述命中 2（数值越小越靠前）
  function matchRank(p, q) {
    if ((p.name || '').toLowerCase().indexOf(q) >= 0) return 0;
    if ((p.category || '').toLowerCase().indexOf(q) >= 0) return 1;
    if ((p.type === 'game' ? '游戏' : '应用').indexOf(q) >= 0) return 1;
    return 2;
  }

  // 非名称命中的简短说明：分类 · X / 类型 · Y / 描述 · …上下文…
  function matchHint(p, q) {
    if ((p.name || '').toLowerCase().indexOf(q) >= 0) return '';
    var category = (p.category || '');
    if (category.toLowerCase().indexOf(q) >= 0) {
      return (dictMsg('err.matchCat') || '分类') + ' · ' + category;
    }
    var type = p.type === 'game' ? '游戏' : '应用';
    if (type.indexOf(q) >= 0) {
      return (dictMsg('err.matchType') || '类型') + ' · ' + type;
    }
    var desc = p.desc || '';
    var i = desc.toLowerCase().indexOf(q);
    if (i >= 0) {
      var start = Math.max(0, i - 6);
      var snip = (start > 0 ? '…' : '') + desc.slice(start, i + q.length + 14) + '…';
      return (dictMsg('err.matchDesc') || '描述') + ' · ' + snip;
    }
    return '';
  }

  function search(q) {
    q = (q || '').trim().toLowerCase();
    lastQ = q;
    if (!q) { box.innerHTML = ''; setActive(-1); setExpanded(false); return; }
    if (!loaded) return; // 数据未就绪：先保留输入，加载完成后再触发一次
    // 模糊匹配：名称 / 分类 / 类型 / 描述任一包含即命中；名称命中优先，保持相关度
    var hits = products.filter(function (p) {
      var name = (p.name || '').toLowerCase();
      var category = (p.category || '').toLowerCase();
      var desc = (p.desc || '').toLowerCase();
      var type = p.type === 'game' ? '游戏' : '应用';
      return name.indexOf(q) >= 0 || category.indexOf(q) >= 0 ||
             desc.indexOf(q) >= 0 || type.indexOf(q) >= 0;
    });
    hits.sort(function (a, b) { return matchRank(a, q) - matchRank(b, q); });
    hits = hits.slice(0, 6);
    render(hits, hits.length ? null : dictMsg('err.searchEmpty') || '未找到相关产品');
  }

  // ↑/↓ 移动，Enter 选中当前（无高亮则取第一个），Esc 关闭
  function move(step) {
    var links = resultLinks();
    if (!links.length) return;
    var next = active + step;
    if (next < 0) next = links.length - 1;
    if (next >= links.length) next = 0;
    setActive(next);
  }

  function activate(idx) {
    var links = resultLinks();
    if (idx < 0) idx = 0;
    var target = links[idx];
    if (target) location.href = target.getAttribute('href');
  }

  function dictMsg(key) {
    try {
      var lang = window.GRI18n.get();
      var d = window.GRI18n.dict[lang];
      return (d && d[key]) || '';
    } catch (e) { return ''; }
  }

  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { search(input.value); }, 180);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (input.value) { if (!box.children.length) search(input.value); move(1); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (box.children.length) activate(active); }
    else if (e.key === 'Escape') { box.innerHTML = ''; setActive(-1); setExpanded(false); }
  });
  // 鼠标悬停同步高亮（与键盘共用同一 active 状态）
  box.addEventListener('mouseover', function (e) {
    var a = e.target.closest ? e.target.closest('.err-result') : null;
    if (a) setActive(Array.prototype.indexOf.call(resultLinks(), a));
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.err-search')) { box.innerHTML = ''; setActive(-1); setExpanded(false); }
  });

  // 预加载产品目录；成功后有输入则补搜一次，失败（离线）时提示
  fetchProducts().then(function () {
    if (input.value.trim()) search(input.value);
  }).catch(function () {
    render([], dictMsg('err.searchOffline') || '搜索需要联网，恢复网络后再试');
  });
})();
