/* ============================================================
   绿角犀 后台脚本
   - 单管理员口令登录（Bearer Token，存 localStorage）
   - 看板：总浏览/下载、流量趋势(14天双线图)、各页浏览、热门下载 TOP
   - 产品管理：搜索 + 类型筛选 + 上架 / 编辑 / 上下架切换 / 删除
   ============================================================ */
(function () {
  'use strict';
  var API = '/api';
  var TOKEN_KEY = 'lvjx_admin_token';
  var ROLE_KEY = 'lvjx_admin_role';
  var USER_KEY = 'lvjx_admin_user';
  var lastTrend = null; // 最近一次趋势响应（用于窗口缩放时重绘）

  var loginView = document.getElementById('login-view');
  var appView = document.getElementById('admin-app');

  /* ---------- 工具 ---------- */
  var EXP_KEY = 'lvjx_admin_exp';
  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); localStorage.removeItem(EXP_KEY); }
  function getExp() { var v = localStorage.getItem(EXP_KEY); return v ? Number(v) : null; }
  // 登录 / 改口令成功后写入 Token、角色与过期时间戳（服务端下发 expiresAt / role / username）
  function setSession(t, exp, role, username) {
    localStorage.setItem(TOKEN_KEY, t);
    if (typeof role === 'string') localStorage.setItem(ROLE_KEY, role);
    if (typeof username === 'string') localStorage.setItem(USER_KEY, username);
    if (typeof exp === 'number') localStorage.setItem(EXP_KEY, String(exp));
    else localStorage.removeItem(EXP_KEY);
  }
  function getRole() { return localStorage.getItem(ROLE_KEY) || 'admin'; }
  function getUsername() { return localStorage.getItem(USER_KEY) || ''; }
  function clearToken() {
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(EXP_KEY);
    localStorage.removeItem(ROLE_KEY); localStorage.removeItem(USER_KEY);
  }
  // 是否管理员（写权限）。viewer 角色只读，隐藏/禁用写操作控件。
  function isAdmin() { return getRole() === 'admin'; }
  // i18n 取词：缺失时回退到 key 本身（绝不空白），保证切换语言不出现空白。
  function T(k) {
    try {
      var d = window.GRI18n && window.GRI18n.dict;
      var l = window.GRI18n ? window.GRI18n.get() : 'zh';
      var t = d && d[l] && d[l][k];
      return (t != null) ? t : k;
    } catch (e) { return k; }
  }
  // 客户端过期预检：无过期信息（旧版 Token）交由服务端校验；有则按本地时间判断
  function isSessionValid() {
    var t = getToken();
    if (!t) return false;
    var exp = getExp();
    if (typeof exp !== 'number') return true;
    return Date.now() < exp;
  }
  function nowStr() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function authHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() };
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /* 轻量操作反馈：异步操作（删除 / 改状态 / 加载）失败时必须让用户看见，
     否则界面毫无变化，用户会以为操作已经成功。 */
  var toastTimer = null;
  function showToast(msg, isErr) {
    var el = document.getElementById('admin-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'admin-toast';
      el.className = 'admin-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'admin-toast' + (isErr ? ' err' : '');
    void el.offsetWidth;               // 强制回流，保证连续调用时淡入动画可重放
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3000);
  }

  /* ---------- 视图切换 ---------- */
  function showApp() {
    loginView.classList.add('hidden');
    appView.classList.add('show');
    applyRoleUI();
    loadStats();
    loadProducts();
    loadContacts();
    loadSysInfo();
    loadAudit();
    loadAccessLog();
    loadAdmins();
    loadCategories();
    loadAnnouncements();
    populateFbFilter();
    loadFeedback();
    resetIdle();
  }

  // 角色门控：viewer 角色为只读，隐藏写操作控件并显示只读提示
  function applyRoleUI() {
    var viewer = !isAdmin();
    document.body.classList.toggle('viewer', viewer);
    var badge = document.getElementById('role-badge');
    if (badge) {
      badge.textContent = (getUsername() || '') + ' · ' + (viewer ? '只读' : '管理员');
      badge.style.display = '';
    }
    var ro = document.getElementById('readonly-banner');
    if (ro) ro.style.display = viewer ? 'block' : 'none';
  }
  function showLogin() {
    appView.classList.remove('show');
    loginView.classList.remove('hidden');
    document.getElementById('password').value = '';
    // 回填上次登录的用户名，节省重复输入
    var savedUser = getUsername();
    if (savedUser) document.getElementById('username').value = savedUser;
    clearIdle();
  }

  /* ---------- 空闲自动退出（避免令牌长期悬挂被盗用） ---------- */
  var IDLE_MS = 30 * 60 * 1000; // 30 分钟无操作自动退出
  var idleTimer = null;
  function clearIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }
  function resetIdle() {
    clearIdle();
    idleTimer = setTimeout(function () {
      if (isSessionValid()) { clearToken(); showLogin(); }
    }, IDLE_MS);
  }
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, resetIdle, { passive: true });
  });

  /* ---------- 登录 ---------- */
  document.getElementById('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var uname = document.getElementById('username').value.trim();
    var pw = document.getElementById('password').value;
    var err = document.getElementById('login-err');
    err.textContent = '';
    fetch(API + '/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uname, password: pw })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { err.textContent = (res.j && res.j.error) || '登录失败'; return; }
        setSession(res.j.token, res.j.expiresAt, res.j.role, res.j.username);
        showApp();
      })
      .catch(function () { err.textContent = '网络错误，请重试'; });
  });

  /* ---------- 退出 ---------- */
  document.getElementById('logout').addEventListener('click', function () {
    clearToken();
    showLogin();
  });

  /* ---------- 刷新（手动 / 自动共用） ---------- */
  var refreshBtn = document.getElementById('refresh-btn');
  var autoBtn = document.getElementById('auto-btn');
  var exportBtn = document.getElementById('export-csv');
  var AUTO_KEY = 'lvjx_admin_auto';
  var REFRESH_MS = 30000;
  var autoTimer = null;

  // silent=true 时（自动刷新）不改变按钮文案，也不受手动按钮禁用态影响
  function doRefresh(silent) {
    if (!silent && refreshBtn.disabled) return Promise.resolve();
    if (!silent) {
      refreshBtn.disabled = true;
      refreshBtn.dataset.old = refreshBtn.textContent;
      refreshBtn.textContent = '↻ 刷新中…';
    }
    return Promise.all([
      fetch(API + '/admin/stats', { headers: authHeaders() }).then(function (r) {
        if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
        return r.json();
      }).then(function (s) { applyStats(s); }),
      loadProducts(),
      // 自动轮询(silent=true)时保留当前浏览页码，否则每次刷新都把管理员拽回第 1 页；
      // 手动刷新(silent=false)才重置——用户主动刷新本就期望看到最新。
      loadContacts({ keepPage: silent }),
      loadSysInfo(),
      loadAudit()
    ]).then(function () {
      if (!silent) { refreshBtn.disabled = false; refreshBtn.textContent = refreshBtn.dataset.old || '↻ 刷新数据'; }
    }).catch(function () {
      if (!silent) { refreshBtn.disabled = false; refreshBtn.textContent = refreshBtn.dataset.old || '↻ 刷新数据'; }
    });
  }
  refreshBtn.addEventListener('click', function () { doRefresh(false); });

  /* ---------- 自动刷新开关（localStorage 记忆） ---------- */
  function startAuto() {
    if (autoTimer) return;
    autoTimer = setInterval(function () { doRefresh(true); }, REFRESH_MS);
    autoBtn.textContent = '自动刷新 开';
    autoBtn.classList.add('on');
    localStorage.setItem(AUTO_KEY, '1');
  }
  function stopAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    autoBtn.textContent = '自动刷新 关';
    autoBtn.classList.remove('on');
    localStorage.setItem(AUTO_KEY, '0');
  }
  autoBtn.addEventListener('click', function () {
    if (autoTimer) stopAuto(); else startAuto();
  });
  if (localStorage.getItem(AUTO_KEY) === '1') startAuto();

  /* ---------- 留言 CSV 导出（维度 68：联动当前筛选 + 跨页全量） ---------- */
  function csvCell(v) {
    v = (v == null ? '' : String(v));
    if (/[",\r\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  }
  // 跨页拉取筛选后的全量（pageSize=100 逐页直至拉完）；供留言/审计导出复用
  function fetchAllPages(url, params) {
    var pageSize = 100, page = 1, acc = [];
    function one() {
      var qs = '?page=' + page + '&pageSize=' + pageSize;
      Object.keys(params || {}).forEach(function (k) {
        var v = params[k];
        if (v) qs += '&' + k + '=' + encodeURIComponent(v);
      });
      return fetch(url + qs, { headers: authHeaders() })
        .then(function (r) {
          if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          var rows = (data && data.rows) || [];
          acc = acc.concat(rows);
          if (rows.length === pageSize) { page++; return one(); }
          return acc;
        });
    }
    return one();
  }
  function exportCsv() {
    if (exportBtn.disabled) return;
    exportBtn.disabled = true;
    var old = exportBtn.textContent;
    exportBtn.textContent = '⬇ 导出中…';
    fetchAllPages(API + '/admin/contacts', {
      status: contactStatusFilter === 'all' ? '' : contactStatusFilter,
      keyword: contactKw.trim()
    }).then(function (list) {
      if (!list.length) { alert('暂无匹配留言可导出'); return; }
      function p(n) { return (n < 10 ? '0' : '') + n; }
      var statusLabel = { new: '待处理', done: '已处理', ignored: '已忽略' };
      var rows = ['提交时间,姓名,邮箱,留言内容,状态'];
      list.forEach(function (m) {
        var d = new Date(m.ts);
        var t = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
          p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
        rows.push([t, m.name, m.email || '', m.message, statusLabel[m.status] || m.status].map(csvCell).join(','));
      });
      var csv = '﻿' + rows.join('\r\n'); // BOM 保证 Excel 正确识别 UTF-8
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var d = new Date();
      a.href = url;
      a.download = '绿角犀留言_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
        '-' + p(d.getHours()) + p(d.getMinutes()) + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    })
      .catch(function () { alert('导出失败，请重试'); })
      .then(function () { exportBtn.disabled = false; exportBtn.textContent = old; });
  }
  exportBtn.addEventListener('click', exportCsv);

  /* ---------- 审计 CSV 导出（维度 68：联动 action/keyword 筛选 + 跨页全量） ---------- */
  var auditExportBtn = document.getElementById('export-audit');
  if (auditExportBtn) {
    function exportAudit() {
      if (auditExportBtn.disabled) return;
      auditExportBtn.disabled = true;
      var old = auditExportBtn.textContent;
      auditExportBtn.textContent = '⬇ 导出中…';
      fetchAllPages(API + '/admin/audit', {
        action: auditAction,
        keyword: auditKw.trim()
      }).then(function (list) {
        if (!list.length) { alert('暂无匹配审计记录可导出'); return; }
        function p(n) { return (n < 10 ? '0' : '') + n; }
        var actionLabel = auditLabels || {};
        var rows = ['时间,动作,详情,IP'];
        list.forEach(function (a) {
          var d = new Date(a.ts);
          var t = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
            p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
          rows.push([t, actionLabel[a.action] || a.action, a.detail || '', a.ip || ''].map(csvCell).join(','));
        });
        var csv = '﻿' + rows.join('\r\n'); // BOM 保证 Excel 正确识别 UTF-8
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var d = new Date();
        a.href = url;
        a.download = '绿角犀审计_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
          '-' + p(d.getHours()) + p(d.getMinutes()) + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      })
        .catch(function () { alert('导出失败，请重试'); })
        .then(function () { auditExportBtn.disabled = false; auditExportBtn.textContent = old; });
    }
    auditExportBtn.addEventListener('click', exportAudit);
  }

  /* ---------- 通用 CSV 落盘（H6c 新增导出复用） ---------- */
  function downloadCsv(prefix, rows) {
    var csv = '﻿' + rows.join('\r\n'); // BOM 保证 Excel 正确识别 UTF-8
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    a.href = url;
    a.download = prefix + '_' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) +
      '-' + p2(d.getHours()) + p2(d.getMinutes()) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function fmtTimeCsv(ts) {
    var d = new Date(ts);
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' +
      p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  }

  /* ---------- 反馈 CSV 导出（H6c：联动当前筛选 + 跨页全量） ---------- */
  var fbExportBtn = document.getElementById('export-feedback');
  if (fbExportBtn) {
    fbExportBtn.addEventListener('click', function () {
      if (fbExportBtn.disabled) return;
      fbExportBtn.disabled = true;
      var old = fbExportBtn.textContent;
      fbExportBtn.textContent = '⬇ 导出中…';
      fetchAllPages(API + '/admin/feedback', {
        status: fbStatusFilter === 'all' ? '' : fbStatusFilter,
        keyword: fbKw.trim(),
        product_id: fbProductId
      }).then(function (list) {
        if (!list.length) { alert('暂无匹配反馈可导出'); return; }
        var statusLabel = { new: '待处理', done: '已处理' };
        var rows = ['提交时间,产品,称呼,邮箱,评分,反馈内容,状态'];
        list.forEach(function (f) {
          rows.push([fmtTimeCsv(f.ts), f.product_name || ('#' + f.product_id), f.name || '', f.email || '',
            f.rating || '', f.content, statusLabel[f.status] || f.status].map(csvCell).join(','));
        });
        downloadCsv('绿角犀反馈', rows);
      })
        .catch(function () { alert('导出失败，请重试'); })
        .then(function () { fbExportBtn.disabled = false; fbExportBtn.textContent = old; });
    });
  }

  /* ---------- 访问分析 CSV 导出（H6c：来源/语言/时区/浏览器/系统/引荐/热门 各分布） ---------- */
  var statsExportBtn = document.getElementById('export-stats');
  if (statsExportBtn) {
    statsExportBtn.addEventListener('click', function () {
      if (statsExportBtn.disabled) return;
      var s = lastStats;
      if (!s) { alert('暂无统计数据，请先刷新看板'); return; }
      statsExportBtn.disabled = true;
      var old = statsExportBtn.textContent;
      statsExportBtn.textContent = '⬇ 导出中…';
      var rows = [];
      function sec(title, cols, items) {
        rows.push('=== ' + title + ' ===');
        rows.push(cols.join(','));
        (items || []).forEach(function (it) {
          rows.push(cols.map(function (c) { return it[c]; }).map(csvCell).join(','));
        });
        rows.push('');
      }
      sec('流量来源', ['来源', '次数'], (s.sources || []).map(function (x) { return { 来源: x.label, 次数: x.c }; }));
      sec('引荐域名', ['域名', '次数'], (s.topReferrers || []).map(function (x) { return { 域名: x.host, 次数: x.c }; }));
      sec('访问语言', ['语言', '次数'], (s.topLangs || []).map(function (x) { return { 语言: x.lang, 次数: x.c }; }));
      sec('访问时区', ['时区', '次数'], (s.topTimezones || []).map(function (x) { return { 时区: x.tz, 次数: x.c }; }));
      sec('浏览器分布', ['浏览器', '次数'], (s.browsers || []).map(function (x) { return { 浏览器: x.name, 次数: x.c }; }));
      sec('系统分布', ['系统', '次数'], (s.oses || []).map(function (x) { return { 系统: x.name, 次数: x.c }; }));
      sec('热门产品', ['产品', '下载次数'], (s.topProducts || []).map(function (x) { return { 产品: x.name, 下载次数: x.c }; }));
      downloadCsv('绿角犀访问分析', rows);
      statsExportBtn.disabled = false;
      statsExportBtn.textContent = old;
    });
  }

  /* ---------- 数据库备份下载（服务端生成 .db 附件） ---------- */
  var backupBtn = document.getElementById('backup-db');
  if (backupBtn) {
    backupBtn.addEventListener('click', function () {
      if (backupBtn.disabled) return;
      backupBtn.disabled = true;
      var old = backupBtn.textContent;
      backupBtn.textContent = '⬇ 备份中…';
      fetch(API + '/admin/backup', { headers: authHeaders() })
        .then(function (r) {
          if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
          if (!r.ok) throw new Error('backup failed');
          var cd = r.headers.get('Content-Disposition') || '';
          var m = /filename="?([^";]+)"?/.exec(cd);
          var fname = m ? m[1] : 'lvjiaoxi-backup.db';
          return r.blob().then(function (blob) { return { blob: blob, fname: fname }; });
        })
        .then(function (o) {
          var url = URL.createObjectURL(o.blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = o.fname;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        })
        .catch(function () { alert('备份失败，请重试'); })
        .then(function () { backupBtn.disabled = false; backupBtn.textContent = old; });
    });
  }

  /* ---------- 产品目录 CSV 导出（导出内存全量，无需额外请求） ---------- */
  var exportProdBtn = document.getElementById('export-products');
  function exportProducts() {
    if (exportProdBtn.disabled) return;
    if (!allProducts.length) { alert('暂无产品可导出'); return; }
    exportProdBtn.disabled = true;
    var old = exportProdBtn.textContent;
    exportProdBtn.textContent = '⬇ 导出中…';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    var rows = ['ID,名称,类型,状态,下载量,排序,下载链接,简介'];
    allProducts.forEach(function (x) {
      rows.push([
        x.id,
        x.name,
        x.type === 'app' ? '应用' : '游戏',
        x.status === 'on' ? '已上架' : '已下架',
        (x.downloads != null ? x.downloads : 0),
        (x.sort != null ? x.sort : 0),
        x.download_url || '',
        x.desc || ''
      ].map(csvCell).join(','));
    });
    var csv = '﻿' + rows.join('\r\n'); // BOM 保证 Excel 正确识别 UTF-8
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    a.href = url;
    a.download = '绿角犀产品_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    exportProdBtn.disabled = false;
    exportProdBtn.textContent = old;
  }
  exportProdBtn.addEventListener('click', exportProducts);

  /* ---------- 产品 CSV 批量导入（维度 69：整批校验通过才入库） ---------- */
  var importBtn = document.getElementById('import-products');
  var importFile = document.getElementById('import-products-file');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', function () { importFile.value = ''; importFile.click(); });
    importFile.addEventListener('change', function () {
      var f = importFile.files && importFile.files[0];
      if (!f) return;
      if (f.size > 1024 * 1024) { alert('CSV 文件过大（≤1MB）'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var csv = String(reader.result || '');
        importBtn.disabled = true;
        var old = importBtn.textContent;
        importBtn.textContent = '⬆ 导入中…';
        fetch(API + '/admin/products/import', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ csv: csv })
        })
          .then(function (r) {
            if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
            return r.json().catch(function () { return null; }).then(function (d) { return { status: r.status, data: d }; });
          })
          .then(function (r) {
            var d = r.data;
            if (r.status === 200 && d && d.ok) {
              showToast((T('import.ok') || '已导入 {n} 条').replace('{n}', d.imported));
              loadProducts();
            } else if (d && d.failed) {
              var lines = d.failed.slice(0, 10).map(function (f2) { return '第 ' + f2.line + ' 行：' + f2.error; }).join('\n');
              alert('导入失败（' + d.failed.length + ' 行有误，全部未导入）：\n' + lines + (d.failed.length > 10 ? '\n…' : ''));
            } else {
              alert(d && d.error ? d.error : '导入失败，请重试');
            }
          })
          .catch(function () {})
          .then(function () { importBtn.disabled = false; importBtn.textContent = old; });
      };
      reader.readAsText(f, 'utf-8');
    });
  }

  /* ---------- 看板 ---------- */
  function loadStats() {
    fetch(API + '/admin/stats', { headers: authHeaders() })
      .then(function (r) {
        if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
        return r.json();
      })
      .then(applyStats)
      .catch(function () {});
  }
  // 看板渲染（登录/自动加载与手动刷新共用）
  var lastStats = null;
  function applyStats(s) {
    lastStats = s;
    document.getElementById('kpis').innerHTML =
        kpi(s.totalVisits, T('kpi.views')) + kpi(s.totalDownloads, T('kpi.downloads')) +
        kpi((s.pageVisits || []).length, T('kpi.monitored')) + kpi((s.productDownloads || []).length, T('kpi.productCount')) +
        kpi((s.totalContacts || 0), T('kpi.contacts')) + kpi((s.pendingContacts || 0), T('kpi.pending'), (s.pendingContacts || 0) > 0);
    document.getElementById('updated-at').innerHTML = '最后更新：<b>' + nowStr() + '</b>';

    var pv = (s.pageVisits || []).map(function (x) { return { name: x.page, c: x.c }; });
    document.getElementById('page-bars').innerHTML = bars(pv);

    // 流量来源构成（直接 / 搜索 / 社交 / 引荐 / 其他）
    var sources = (s.sources || []).map(function (x) { return { name: x.label, c: x.c }; });
    document.getElementById('source-bars').innerHTML = bars(sources);

    // 主要引荐域名 TOP
    var refs = (s.topReferrers || []);
    document.getElementById('referrer-list').innerHTML = refs.length
      ? refs.map(function (x) {
          return '<div class="rank-item"><span class="rank-name" title="' + esc(x.host) + '">' +
            esc(x.host) + '</span><span class="rank-val">' + x.c + ' 次</span></div>';
        }).join('')
      : '<div class="empty">' + T('empty.referrers') + '</div>';

    // 访问语言 / 时区分布
    var langs = (s.topLangs || []).map(function (x) { return { name: x.lang, c: x.c }; });
    document.getElementById('lang-bars').innerHTML = bars(langs);
    var tzs = (s.topTimezones || []).map(function (x) { return { name: x.tz, c: x.c }; });
    document.getElementById('tz-bars').innerHTML = bars(tzs);

    // 访问浏览器 / 系统分布（维度 75）
    var browsers = (s.browsers || []).map(function (x) { return { name: x.name, c: x.c }; });
    document.getElementById('browser-bars').innerHTML = bars(browsers);
    var oses = (s.oses || []).map(function (x) { return { name: x.name, c: x.c }; });
    document.getElementById('os-bars').innerHTML = bars(oses);

    var top = (s.topProducts || []).map(function (x) {
      return { id: x.id, name: x.name, type: x.type, status: x.status, c: x.c };
    });
    document.getElementById('top-list').innerHTML = rankList(top);

    // 反馈概览（H6d）：总数 / 未处理 / 已评分 / 平均分 + 按产品分布 + 近7天趋势
    var fb = s.feedback || {};
    var fbKpi = document.getElementById('fb-overview-kpis');
    if (fbKpi) {
      fbKpi.innerHTML =
        kpi(fb.total || 0, T('kpi.fbTotal')) + kpi(fb.pending || 0, T('kpi.fbPending'), (fb.pending || 0) > 0) +
        kpi(fb.ratedCount || 0, T('kpi.fbRated')) + kpi(fb.avg ? fb.avg : '-', T('kpi.fbAvg'));
    }
    var fbOv = document.getElementById('fb-overview');
    if (fbOv) {
      var fbParts = [];
      if (fb.byProduct && fb.byProduct.length) {
        fbParts.push('<h3 class="ov-sub">' + T('fb.byProduct') + '</h3>' +
          bars(fb.byProduct.map(function (x) { return { name: x.name, c: x.c }; })));
      }
      if (fb.week && fb.week.length) {
        fbParts.push('<h3 class="ov-sub">' + T('fb.week7') + '</h3>' +
          bars(fb.week.map(function (x) { return { name: x.date, c: x.c }; })));
      }
      fbOv.innerHTML = fbParts.length ? fbParts.join('') : '<div class="empty">' + (T('fb.empty') || '暂无反馈') + '</div>';
    }

    if (s.daily && s.daily.length) {
      // 兼容：stats 仍携带 14 天 daily；趋势图由独立 loadTrend() 渲染（支持天数切换）
      if (!lastTrend) loadTrend();
    }

    // 未处理留言主动提醒：仅在「轮询发现新增」时提示，避免首次加载/手动刷新刷屏。
    // 用函数属性保存上次待处理数，不污染全局作用域。
    if (applyStats._lastPending !== undefined && s.pendingContacts > applyStats._lastPending) {
      showToast('有 ' + (s.pendingContacts - applyStats._lastPending) + ' 条新留言待处理', true);
    }
    applyStats._lastPending = s.pendingContacts;
  }
  function kpi(v, k, warn) {
    return '<div class="kpi' + (warn ? ' warn' : '') + '">' +
      '<div class="v">' + (v || 0).toLocaleString() + '</div><div class="k">' + k + '</div></div>';
  }
  function bars(list) {
    if (!list.length) return '<div class="empty">暂无数据</div>';
    var max = Math.max.apply(null, list.map(function (x) { return x.c; }).concat([1]));
    return list.map(function (x) {
      var pct = max ? Math.round((x.c / max) * 100) : 0;
      return '<div class="bar-row"><div class="name" title="' + esc(x.name) + '">' + esc(x.name) +
        '</div><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="val">' + x.c + '</div></div>';
    }).join('');
  }
  function rankList(list) {
    if (!list.length) return '<div class="empty">暂无下载数据</div>';
    var medal = ['🥇', '🥈', '🥉'];
    return list.map(function (x, i) {
      var no = medal[i] || ('#' + (i + 1));
      var typeCls = x.type === 'app' ? 'app' : 'game';
      return '<div class="rank-item">' +
        '<span class="rank-no">' + no + '</span>' +
        '<span class="rank-name" title="' + esc(x.name) + '">' + esc(x.name) + '</span>' +
        '<span class="rank-tag ' + typeCls + '">' + (x.type === 'app' ? T('type.app') : T('type.game')) + '</span>' +
        '<span class="rank-val">' + x.c + ' 次</span>' +
      '</div>';
    }).join('');
  }

  /* ---------- Canvas 趋势图（双线：浏览 / 下载） ---------- */
  function drawTrend(canvas, daily) {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || (canvas.parentNode && canvas.parentNode.clientWidth) || 600;
    var cssH = 260;
    canvas.width = Math.max(1, cssW * dpr);
    canvas.height = Math.max(1, cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var padL = 40, padR = 14, padT = 16, padB = 28;
    var plotW = cssW - padL - padR;
    var plotH = cssH - padT - padB;
    var maxV = Math.max.apply(null, daily.map(function (d) { return Math.max(d.visits, d.downloads); }).concat([1]));
    maxV = (Math.ceil(maxV / 5) * 5) || 5;

    // 网格 + Y 轴刻度
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.fillStyle = 'rgba(167,173,207,0.85)';
    ctx.font = '11px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    var steps = 4;
    for (var i = 0; i <= steps; i++) {
      var val = Math.round(maxV * i / steps);
      var y = padT + plotH - (plotH * i / steps);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      ctx.fillText(String(val), padL - 6, y);
    }

    function line(key, color) {
      // 面积
      ctx.beginPath();
      daily.forEach(function (d, idx) {
        var x = padL + (plotW * idx / (daily.length - 1));
        var y = padT + plotH - (plotH * d[key] / maxV);
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.lineTo(padL + plotW, padT + plotH);
      ctx.lineTo(padL, padT + plotH);
      ctx.closePath();
      var grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, color.replace('rgb', 'rgba').replace(')', ',0.22)'));
      grad.addColorStop(1, color.replace('rgb', 'rgba').replace(')', ',0)'));
      ctx.fillStyle = grad; ctx.fill();
      // 线
      ctx.beginPath();
      daily.forEach(function (d, idx) {
        var x = padL + (plotW * idx / (daily.length - 1));
        var y = padT + plotH - (plotH * d[key] / maxV);
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
      // 数据点
      ctx.fillStyle = color;
      daily.forEach(function (d, idx) {
        var x = padL + (plotW * idx / (daily.length - 1));
        var y = padT + plotH - (plotH * d[key] / maxV);
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
      });
    }
    line('visits', 'rgb(108,92,231)');
    line('downloads', 'rgb(24,212,212)');

    // X 轴标签
    ctx.fillStyle = 'rgba(167,173,207,0.9)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var stepLabel = Math.ceil(daily.length / 7);
    daily.forEach(function (d, idx) {
      if (idx % stepLabel !== 0 && idx !== daily.length - 1) return;
      var x = padL + (plotW * idx / (daily.length - 1));
      ctx.fillText(d.date, x, padT + plotH + 8);
    });
  }

  /* ---------- 流量趋势（可切换天数 7/14/30） ---------- */
  var trendDays = 14;
  var TREND_PRESETS = [7, 14, 30];
  function renderTrendDays() {
    var box = document.getElementById('trend-days');
    if (!box) return;
    box.innerHTML = TREND_PRESETS.map(function (n) {
      return '<button type="button" class="td-btn' + (n === trendDays ? ' on' : '') + '" data-days="' + n + '" aria-pressed="' + (n === trendDays) + '">' +
        n + T('trend.dayUnit') + '</button>';
    }).join('');
  }
  function loadTrend() {
    renderTrendDays();
    fetch(API + '/admin/stats/trend?days=' + trendDays, { headers: authHeaders() })
      .then(function (r) {
        if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
        return r.json();
      })
      .then(applyTrend)
      .catch(function () {});
  }
  function applyTrend(t) {
    if (!t || !t.range) return;
    lastTrend = t;
    var title = document.getElementById('trend-title');
    if (title) title.textContent = T('panel.trend') + ' · ' + T('trend.days').replace('{n}', t.days || trendDays);
    var total = document.getElementById('trend-total');
    if (total) total.textContent = T('trend.total')
      .replace('{v}', ((t.total && t.total.visits) || 0).toLocaleString())
      .replace('{d}', ((t.total && t.total.downloads) || 0).toLocaleString());
    drawTrend(document.getElementById('trend-chart'), t.range);
  }
  var trendDaysBox = document.getElementById('trend-days');
  if (trendDaysBox) trendDaysBox.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== trendDaysBox && !(t.getAttribute && t.getAttribute('data-days'))) t = t.parentNode;
    if (!t || t === trendDaysBox) return;
    var n = parseInt(t.getAttribute('data-days'), 10);
    if (n === trendDays) return;
    trendDays = n;
    loadTrend();
  });

  /* ---------- 产品列表（带搜索 + 类型筛选） ---------- */
  var allProducts = [];
  var pmFilter = 'all';
  var pmKeyword = '';
  var selectedProductIds = {}; // 批量选中集合：产品 id -> true（跨筛选/搜索保留）

  function loadProducts() {
    fetch(API + '/admin/products', { headers: authHeaders() })
      .then(function (r) {
        if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
        return r.json();
      })
      .then(function (list) {
        allProducts = list || [];
        renderProducts();
        refreshCategoryOptions();
        populateFbFilter();
      })
      .catch(function () {});
  }
  /* ---------- 产品分类管理（维度 58：自由输入 → 后台维护枚举） ---------- */
  var allCats = []; // {id, name, usage}
  function loadCategories() {
    fetch(API + '/admin/categories', { headers: authHeaders() })
      .then(function (r) {
        if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
        return r.json();
      })
      .then(function (data) {
        allCats = (data && data.rows) || [];
        renderCategories();
        refreshCategoryOptions();
      })
      .catch(function () {});
  }
  // 产品表单分类下拉：以枚举为准（空 = 不分类），保持当前选中值；同步填充批量改分类下拉
  function refreshCategoryOptions() {
    var sel = document.getElementById('f-category');
    if (sel) {
      var current = sel.value;
      var html = '<option value="">' + T('cat.none') + '</option>' +
        allCats.map(function (c) { return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>'; }).join('');
      if (sel.innerHTML !== html) sel.innerHTML = html;
      if (allCats.some(function (c) { return c.name === current; })) sel.value = current;
      else sel.value = '';
    }
    var bsel = document.getElementById('batch-category');
    if (bsel) {
      var bhtml = '<option value="">' + T('cat.none') + '</option>' +
        allCats.map(function (c) { return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>'; }).join('');
      if (bsel.innerHTML !== bhtml) bsel.innerHTML = bhtml;
    }
  }
  // 分类管理列表：名称 / 使用产品数 / 重命名（行内编辑）/ 删除（二次确认）
  function renderCategories() {
    var box = document.getElementById('cat-list');
    var empty = document.getElementById('cat-empty');
    if (!box) return;
    if (!allCats.length) { box.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
    if (empty) empty.style.display = 'none';
    box.innerHTML = allCats.map(function (c) {
      return '<div class="cat-row" data-id="' + c.id + '" data-name="' + esc(c.name) + '">' +
        '<span class="cat-name">' + esc(c.name) + '</span>' +
        '<span class="cat-usage">' + T('cat.usage') + '：' + (c.usage != null ? c.usage : 0) + '</span>' +
        '<span class="cat-actions">' +
          '<button class="btn-sm" data-act="rename" type="button">' + T('cat.rename') + '</button>' +
          '<button class="btn-sm danger" data-act="del" type="button">' + T('cat.delete') + '</button>' +
        '</span>' +
      '</div>';
    }).join('');
  }
  function apiCategory(method, url, body) {
    return fetch(API + url, {
      method: method,
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
      return r.json().then(function (j) {
        if (!r.ok) throw Object.assign(new Error((j && j.error) || ('HTTP ' + r.status)), { status: r.status });
        return j;
      }).catch(function (e) {
        if (e instanceof SyntaxError) throw new Error('HTTP ' + r.status);
        throw e;
      });
    });
  }
  var catForm = document.getElementById('cat-add-form');
  if (catForm) {
    catForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = document.getElementById('cat-name').value.trim();
      if (!name) { showToast(T('cat.needName') || '请填写分类名称', true); return; }
      apiCategory('POST', '/admin/categories', { name: name })
        .then(function () {
          document.getElementById('cat-name').value = '';
          loadCategories();
        })
        .catch(function (err) { showToast(err.message, true); });
    });
  }
  var catList = document.getElementById('cat-list');
  if (catList) {
    catList.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var row = btn.closest('.cat-row');
      if (!row) return;
      var id = Number(row.getAttribute('data-id'));
      var name = row.getAttribute('data-name') || '';
      var act = btn.getAttribute('data-act');
      if (act === 'rename') { startCatRename(row, id, name); }
      else if (act === 'del') {
        showConfirm({
          title: T('cat.delTitle') || '删除分类',
          message: (T('cat.confirmDel') || '确定删除分类「{name}」？该操作不可撤销。').replace('{name}', name),
          danger: true,
          confirmText: T('cat.delete') || '删除'
        }).then(function (ok) {
          if (!ok) return;
          apiCategory('DELETE', '/admin/categories/' + id)
            .then(function () { loadCategories(); loadProducts(); })
            .catch(function (err) { showToast(err.message, true); });
        });
      }
    });
  }
  // 行内重命名：名称变为输入框 + 保存/取消
  function startCatRename(row, id, oldName) {
    var nameEl = row.querySelector('.cat-name');
    if (!nameEl || row.classList.contains('renaming')) return;
    row.classList.add('renaming');
    var input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 40;
    input.value = oldName;
    input.className = 'cat-rename-input';
    input.setAttribute('aria-label', T('cat.name'));
    nameEl.innerHTML = '';
    nameEl.appendChild(input);
    var save = row.querySelector('[data-act="rename"]');
    save.textContent = T('cat.save');
    save.className = 'btn-sm';
    var cancel = row.querySelector('[data-act="del"]');
    cancel.textContent = T('btn.cancelEdit');
    cancel.className = 'btn-sm';
    cancel.dataset.act = 'cancel';
    input.focus();
    input.select();
    function finish() {
      var v = input.value.trim();
      if (!v || v === oldName) { exit(); return; }
      apiCategory('PUT', '/admin/categories/' + id, { name: v })
        .then(function () { loadCategories(); loadProducts(); })
        .catch(function (err) { showToast(err.message, true); exit(); });
    }
    function exit() {
      row.classList.remove('renaming');
      save.textContent = T('cat.rename');
      cancel.textContent = T('cat.delete');
      cancel.dataset.act = 'del';
    }
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); finish(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); exit(); }
    });
    save.addEventListener('click', finish);
    cancel.addEventListener('click', exit);
  }
  var refreshCatsBtn = document.getElementById('refresh-categories');
  if (refreshCatsBtn) refreshCatsBtn.addEventListener('click', loadCategories);

  /* ---------- 前台公告条管理（候选G3） ---------- */
  var allAnn = []; // {id, content, enabled, created_at, updated_at}
  function loadAnnouncements() {
    fetch(API + '/admin/announcements', { headers: authHeaders() })
      .then(function (r) {
        if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
        return r.json();
      })
      .then(function (data) {
        allAnn = (data && data.rows) || [];
        renderAnnouncements();
      })
      .catch(function () {});
  }
  function apiAnnouncement(method, url, body) {
    return fetch(API + url, {
      method: method,
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
      return r.json().then(function (j) {
        if (!r.ok) throw Object.assign(new Error((j && j.error) || ('HTTP ' + r.status)), { status: r.status });
        return j;
      }).catch(function (e) {
        if (e instanceof SyntaxError) throw new Error('HTTP ' + r.status);
        throw e;
      });
    });
  }
  function renderAnnouncements() {
    var box = document.getElementById('ann-list');
    var empty = document.getElementById('ann-empty');
    if (!box) return;
    if (!allAnn.length) { box.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
    if (empty) empty.style.display = 'none';
    box.innerHTML = allAnn.map(function (a) {
      var stateCls = a.enabled ? 'status-on' : 'status-off';
      var stateTxt = a.enabled ? T('status.on') : T('status.off');
      var toggleTxt = a.enabled ? T('action.shelfOff') : T('action.shelfOn');
      return '<div class="ann-row" data-id="' + a.id + '">' +
        '<span class="ann-state ' + stateCls + '">' + stateTxt + '</span>' +
        '<span class="ann-content">' + esc(a.content) + '</span>' +
        '<span class="ann-time">' + new Date(a.created_at).toLocaleString() + '</span>' +
        '<span class="ann-actions">' +
          '<button class="btn-sm" data-act="toggle">' + toggleTxt + '</button>' +
          '<button class="btn-sm danger" data-act="del">' + T('ann.delete') + '</button>' +
        '</span>' +
      '</div>';
    }).join('');
  }
  var annForm = document.getElementById('ann-add-form');
  if (annForm) {
    annForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var content = document.getElementById('ann-content').value.trim();
      if (!content) { showToast(T('ann.needContent') || '公告内容不能为空', true); return; }
      apiAnnouncement('POST', '/admin/announcements', { content: content })
        .then(function () {
          document.getElementById('ann-content').value = '';
          loadAnnouncements();
          showToast((T('ann.added') || '公告已发布'));
        })
        .catch(function (err) { showToast(err.message, true); });
    });
  }
  var annList = document.getElementById('ann-list');
  if (annList) {
    annList.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var row = btn.closest('.ann-row');
      if (!row) return;
      var id = Number(row.getAttribute('data-id'));
      var act = btn.getAttribute('data-act');
      var item = allAnn.find(function (a) { return a.id === id; });
      if (!item) return;
      if (act === 'toggle') {
        apiAnnouncement('PUT', '/admin/announcements/' + id, { content: item.content, enabled: item.enabled ? 0 : 1 })
          .then(function () { loadAnnouncements(); })
          .catch(function (err) { showToast(err.message, true); });
      } else if (act === 'del') {
        showConfirm({
          title: T('ann.delTitle') || '删除公告',
          message: (T('ann.confirmDel') || '确定删除该公告？').replace('{content}', item.content),
          danger: true,
          confirmText: T('ann.delete') || '删除'
        }).then(function (ok) {
          if (!ok) return;
          apiAnnouncement('DELETE', '/admin/announcements/' + id)
            .then(function () { loadAnnouncements(); })
            .catch(function (err) { showToast(err.message, true); });
        });
      }
    });
  }
  var refreshAnnBtn = document.getElementById('refresh-announcements');
  if (refreshAnnBtn) refreshAnnBtn.addEventListener('click', loadAnnouncements);

  function renderProducts() {
    var tbody = document.getElementById('product-rows');
    var empty = document.getElementById('product-empty');
    var kw = pmKeyword.trim().toLowerCase();
    var list = allProducts.filter(function (p) {
      if (pmFilter !== 'all' && p.type !== pmFilter) return false;
      if (kw && p.name.toLowerCase().indexOf(kw) === -1) return false;
      return true;
    });
    // 已选中的产品被删/下架等情况发生后，修剪失效 id
    var validIds = {};
    allProducts.forEach(function (p) { validIds[p.id] = true; });
    Object.keys(selectedProductIds).forEach(function (k) {
      if (!validIds[k]) delete selectedProductIds[k];
    });
    if (!list.length) { tbody.innerHTML = ''; empty.style.display = 'block'; updateProductBatchBar(); return; }
    empty.style.display = 'none';
    tbody.innerHTML = list.map(function (p) {
      var statusCls = p.status === 'on' ? 'status-on' : 'status-off';
      var statusTxt = p.status === 'on' ? T('status.on') : T('status.off');
      var toggleCls = p.status === 'on' ? 'off' : 'on';
      var toggleTxt = p.status === 'on' ? T('action.shelfOff') : T('action.shelfOn');
      var actions = isAdmin()
        ? '<button class="btn-sm ' + toggleCls + '" data-act="toggle" data-id="' + p.id + '">' + toggleTxt + '</button>' +
          '<button class="btn-sm" data-act="edit" data-id="' + p.id + '">' + T('product.edit') + '</button>' +
          '<button class="btn-sm danger" data-act="del" data-id="' + p.id + '" data-name="' + esc(p.name) + '">' + T('product.delete') + '</button>'
        : '<span style="color:var(--text-dim)">' + T('role.viewer') + '</span>';
      var cbx = isAdmin()
        ? '<label class="msg-check"><input type="checkbox" data-pcheck="' + p.id + '"' + (selectedProductIds[p.id] ? ' checked' : '') + ' aria-label="选择产品 ' + esc(p.name) + '" /><span class="visually-hidden">选择</span></label>'
        : '';
      return '<tr>' +
        '<td>' + cbx + '</td>' +
        '<td>' + p.id + '</td>' +
        '<td>' + esc(p.name) + '</td>' +
        '<td><span class="tag">' + (p.type === 'app' ? T('type.app') : T('type.game')) + '</span></td>' +
        '<td>' + (p.category ? esc(p.category) : '<span style="color:var(--text-dim)">—</span>') + '</td>' +
        '<td class="' + statusCls + '">' + statusTxt + '</td>' +
        '<td class="dl-count">' + (p.downloads != null ? p.downloads : 0) + '</td>' +
        '<td class="sort-cell">' + (p.sort != null ? p.sort : 0) + '</td>' +
        '<td class="ver-cell">' + (p.version ? esc(p.version) : '<span style="color:var(--text-dim)">—</span>') + '</td>' +
        '<td>' + actions + '</td></tr>';
    }).join('');
    // 全选：当前筛选结果全部勾选时置为选中
    var selAll = document.getElementById('pm-select-all');
    if (selAll) selAll.checked = list.length > 0 && list.every(function (p) { return !!selectedProductIds[p.id]; });
    updateProductBatchBar();
  }

  /* ---------- 联系留言列表（服务端分页搜索 + 批量操作） ---------- */
  var contactTotal = 0; // 服务端返回的匹配总数
  var contactKw = '';
  var contactStatusFilter = 'all';
  var contactPage = 1;
  var CONTACT_PAGE_SIZE = 10;
  var contactSearchTimer = null; // 搜索防抖
  var selectedIds = {}; // 批量选中集合：id -> true（跨页保留）

  /**
   * 拉取留言列表（服务端分页 + 搜索 + 状态筛选）。
   * @param {Object} [opts] opts.keepPage=true 时保留当前页码；否则重置到第 1 页。
   *   删除或标记状态后 keepPage，管理员在第 3 页逐条处理时不会被踢回第 1 页。
   */
  function loadContacts(opts) {
    var keepPage = !!(opts && opts.keepPage);
    var qs = '?page=' + contactPage + '&pageSize=' + CONTACT_PAGE_SIZE +
      '&status=' + encodeURIComponent(contactStatusFilter) +
      '&keyword=' + encodeURIComponent(contactKw.trim());
    return fetch(API + '/admin/contacts' + qs, { headers: authHeaders() })
      .then(function (r) {
        if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        allContacts = (data && data.rows) || [];
        contactTotal = (data && data.total) || 0;
        if (!keepPage) contactPage = 1;
        if (contactPage > 1 && allContacts.length === 0 && contactTotal > 0) {
          // 末页被删空后回退一页（服务端分页下不会自动收敛页码）
          contactPage--;
          return loadContacts({ keepPage: true });
        }
        renderContacts();
      })
      .catch(function (e) {
        if (e && e.message === 'unauthorized') return;   // 已跳转登录，无需报错
        showToast('留言加载失败：' + (e && e.message || '未知错误'), true);
      });
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function renderContacts() {
    var box = document.getElementById('contact-list');
    var pager = document.getElementById('contact-pager');
    if (!box) return;
    var pageItems = allContacts;
    if (!pageItems.length) {
      box.innerHTML = '<div class="empty">' + (contactTotal ? '无匹配留言' : '暂无留言') + '</div>';
      if (pager) pager.innerHTML = '';
      updateBatchBar();
      return;
    }
    var totalPages = Math.max(1, Math.ceil(contactTotal / CONTACT_PAGE_SIZE));
    box.innerHTML = pageItems.map(function (m) {
      var st = m.status || 'new';
      var stCls = st === 'done' ? 'done' : 'new';
      var stTxt = st === 'done' ? T('status.done') : T('status.pending');
      var toggleTxt = st === 'done' ? T('status.markPending') : T('status.markDone');
      var actions = isAdmin()
        ? '<button class="btn-sm" data-status-toggle="' + m.id + '" data-status="' + st + '" title="切换处理状态">' + toggleTxt + '</button>' +
          '<button class="btn-sm danger" data-del="' + m.id + '" title="删除">✕</button>'
        : '';
      var checked = selectedIds[m.id] ? ' checked' : '';
      var cbx = isAdmin()
        ? '<label class="msg-check"><input type="checkbox" data-check="' + m.id + '"' + checked + ' aria-label="选择留言 ' + esc(m.name) + '" /><span class="visually-hidden">选择</span></label>'
        : '';
      return '<div class="msg-item">' +
        cbx +
        '<div class="msg-top"><span class="msg-name">' + esc(m.name) + '</span>' +
        '<span class="msg-status ' + stCls + '">' + stTxt + '</span>' +
        '<span class="msg-time">' + fmtTime(m.ts) + '</span>' + actions + '</div>' +
        (m.email ? '<div class="msg-email">' + esc(m.email) + '</div>' : '') +
        '<div class="msg-text">' + esc(m.message) + '</div>' +
      '</div>';
    }).join('');
    // 全选本页：当前页全部选中时勾选
    var selAll = document.getElementById('contact-select-all');
    if (selAll) selAll.checked = pageItems.length > 0 && pageItems.every(function (m) { return !!selectedIds[m.id]; });
    if (pager) {
      pager.innerHTML =
        '<button class="pg" data-pg="prev"' + (contactPage <= 1 ? ' disabled' : '') + '>‹ 上一页</button>' +
        '<span class="pg-info">第 ' + contactPage + ' / ' + totalPages + ' 页 · 共 ' + contactTotal + ' 条</span>' +
        '<button class="pg" data-pg="next"' + (contactPage >= totalPages ? ' disabled' : '') + '>下一页 ›</button>';
    }
    updateBatchBar();
  }
  function selectedCount() {
    return Object.keys(selectedIds).length;
  }
  function updateBatchBar() {
    var bar = document.getElementById('contact-batch');
    var cnt = document.getElementById('contact-batch-count');
    if (!bar || !cnt) return;
    var n = selectedCount();
    bar.hidden = n === 0;
    cnt.textContent = (T('contact.batchCount') || '已选 {n} 条').replace('{n}', String(n));
  }
  document.getElementById('contact-search').addEventListener('input', function (e) {
    contactKw = e.target.value;
    contactPage = 1;
    // 防抖：停止输入 300ms 后再请求，避免每击键一次全表 LIKE 扫描
    if (contactSearchTimer) clearTimeout(contactSearchTimer);
    contactSearchTimer = setTimeout(function () { loadContacts(); }, 300);
  });
  document.getElementById('contact-pager').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-pg]');
    if (!b || b.disabled) return;
    var totalPages = Math.max(1, Math.ceil(contactTotal / CONTACT_PAGE_SIZE));
    var act = b.getAttribute('data-pg');
    if (act === 'prev' && contactPage > 1) contactPage--;
    else if (act === 'next' && contactPage < totalPages) contactPage++;
    else return;
    loadContacts({ keepPage: true });
  });
  document.getElementById('contact-list').addEventListener('click', function (e) {
    var del = e.target.closest('button[data-del]');
    if (del) {
      var id = del.getAttribute('data-del');
      showConfirm({
        title: T('contact.deleteTitle') || '删除留言',
        message: T('contact.deleteConfirm') || '确定删除这条留言？此操作不可恢复。',
        danger: true,
        confirmText: T('contact.delete') || '删除'
      }).then(function (ok) {
        if (!ok) return;
        del.disabled = true;
        fetch(API + '/admin/contacts/' + id, { method: 'DELETE', headers: authHeaders() })
          .then(function (r) {
            if (r.status === 401) { clearToken(); showLogin(); return; }
            // 必须校验状态：此前无论成功失败都直接刷新，界面毫无变化，
            // 用户会以为删掉了（尤其 token 过期导致 401 时）。
            if (!r.ok) { showToast('删除失败（HTTP ' + r.status + '）', true); return; }
            loadContacts({ keepPage: true }); loadStats();
          })
          .catch(function () { showToast('删除失败：网络错误', true); })
          .then(function () { del.disabled = false; });
      });
      return;
    }
    var tog = e.target.closest('button[data-status-toggle]');
    if (tog) {
      var tid = tog.getAttribute('data-status-toggle');
      var cur = tog.getAttribute('data-status');
      var next = cur === 'done' ? 'new' : 'done';
      tog.disabled = true;
      fetch(API + '/admin/contacts/' + tid + '/status', {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status: next })
      })
        .then(function (r) {
          if (r.status === 401) { clearToken(); showLogin(); return; }
          if (!r.ok) { showToast('状态更新失败（HTTP ' + r.status + '）', true); return; }
          loadContacts({ keepPage: true }); loadStats();
        })
        .catch(function () { showToast('状态更新失败：网络错误', true); })
        .then(function () {
          // 无论成功失败都要恢复：此前网络错误被 catch 吞掉且不恢复禁用，
          // 按钮会永久卡在 disabled，只能刷新页面才能继续操作。
          tog.disabled = false;
        });
    }
  });

  /* ---------- 联系留言批量操作（勾选 + 全选 + 标记/删除） ---------- */
  document.getElementById('contact-list').addEventListener('change', function (e) {
    var cb = e.target.closest('input[data-check]');
    if (!cb) return;
    var id = cb.getAttribute('data-check');
    if (cb.checked) selectedIds[id] = true; else delete selectedIds[id];
    renderContacts();
  });
  var selAllEl = document.getElementById('contact-select-all');
  if (selAllEl) {
    selAllEl.addEventListener('change', function () {
      // 服务端分页：当前页 = 已加载的 allContacts（跨页选择不随导航清空）
      var pageItems = allContacts;
      if (selAllEl.checked) {
        pageItems.forEach(function (m) { selectedIds[m.id] = true; });
      } else {
        pageItems.forEach(function (m) { delete selectedIds[m.id]; });
      }
      renderContacts();
    });
  }
  function batchReq(path, ids) {
    return fetch(API + '/admin/contacts/' + path, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ ids: ids })
    }).then(function (r) {
      if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  document.getElementById('batch-mark-done').addEventListener('click', function () {
    var ids = Object.keys(selectedIds).map(Number);
    if (!ids.length) return;
    batchReq('batch-status', ids).then(function () {
      selectedIds = {};
      loadContacts({ keepPage: true }); loadStats();
    }).catch(function (e) {
      if (e && e.message === 'unauthorized') return;
      showToast('批量标记失败：' + (e && e.message || '未知错误'), true);
    });
  });
  document.getElementById('batch-del-sel').addEventListener('click', function () {
    var ids = Object.keys(selectedIds).map(Number);
    if (!ids.length) return;
    showConfirm({
      title: T('contact.delSelTitle') || '批量删除留言',
      message: (T('contact.delSelConfirm') || '确定删除选中的 {n} 条留言？此操作不可恢复。').replace('{n}', String(ids.length)),
      danger: true,
      confirmText: T('contact.delete') || '删除'
    }).then(function (ok) {
      if (!ok) return;
      batchReq('batch-delete', ids).then(function () {
        selectedIds = {};
        loadContacts({ keepPage: true }); loadStats();
      }).catch(function (e) {
        if (e && e.message === 'unauthorized') return;
        showToast('批量删除失败：' + (e && e.message || '未知错误'), true);
      });
    });
  });

  /* ---------- 产品反馈（维度 76：按产品/状态筛选 + 关键词 + 分页） ---------- */
  var FEEDBACK_PAGE_SIZE = 10;
  var fbKw = '';
  var fbStatusFilter = 'all';
  var fbProductId = '';
  var fbPage = 1;
  var fbTotal = 0;
  var allFeedback = [];
  var fbSearchTimer = null;

  function loadFeedback(opts) {
    var keepPage = !!(opts && opts.keepPage);
    var qs = '?page=' + fbPage + '&pageSize=' + FEEDBACK_PAGE_SIZE +
      '&status=' + encodeURIComponent(fbStatusFilter) +
      '&keyword=' + encodeURIComponent(fbKw.trim()) +
      '&product_id=' + encodeURIComponent(fbProductId);
    return fetch(API + '/admin/feedback' + qs, { headers: authHeaders() })
      .then(function (r) {
        if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        allFeedback = (data && data.rows) || [];
        fbTotal = (data && data.total) || 0;
        if (!keepPage) fbPage = 1;
        if (fbPage > 1 && allFeedback.length === 0 && fbTotal > 0) {
          fbPage--;
          return loadFeedback({ keepPage: true });
        }
        renderFeedback();
      })
      .catch(function (e) {
        if (e && e.message === 'unauthorized') return;
        showToast('反馈加载失败：' + (e && e.message || '未知错误'), true);
      });
  }
  function renderFeedback() {
    var box = document.getElementById('feedback-list');
    var pager = document.getElementById('feedback-pager');
    if (!box) return;
    if (!allFeedback.length) {
      box.innerHTML = '<div class="empty">' + (fbTotal ? '无匹配反馈' : T('fb.empty') || '暂无反馈') + '</div>';
      if (pager) pager.innerHTML = '';
      return;
    }
    var totalPages = Math.max(1, Math.ceil(fbTotal / FEEDBACK_PAGE_SIZE));
    box.innerHTML = allFeedback.map(function (f) {
      var st = f.status || 'new';
      var stCls = st === 'done' ? 'done' : 'new';
      var stTxt = st === 'done' ? T('status.done') : T('status.pending');
      var toggleTxt = st === 'done' ? T('fb.markPending') : T('fb.markDone');
      var stars = f.rating > 0
        ? '<span class="fb-rating" title="' + f.rating + '/5">' +
          '★★★★★'.slice(0, f.rating) + '<span class="dim">' + '★★★★★'.slice(f.rating) + '</span></span>'
        : '<span class="msg-email">' + T('fb.unrated') + '</span>';
      var pname = f.product_name ? esc(f.product_name) : '<span style="color:var(--text-dim)">#' + f.product_id + '（已删除）</span>';
      var actions = isAdmin()
        ? '<button class="btn-sm" data-fb-toggle="' + f.id + '" data-status="' + st + '">' + toggleTxt + '</button>' +
          '<button class="btn-sm danger" data-fb-del="' + f.id + '">✕</button>'
        : '';
      return '<div class="msg-item">' +
        '<div class="msg-top"><span class="msg-name">' + pname + '</span>' +
        stars +
        '<span class="msg-status ' + stCls + '">' + stTxt + '</span>' +
        '<span class="msg-time">' + fmtTime(f.ts) + '</span>' + actions + '</div>' +
        (f.name ? '<div class="msg-email">' + esc(f.name) + (f.email ? ' · ' + esc(f.email) : '') + '</div>' : '') +
        '<div class="msg-text">' + esc(f.content) + '</div>' +
      '</div>';
    }).join('');
    if (pager) {
      pager.innerHTML =
        '<button class="pg" data-fbpg="prev"' + (fbPage <= 1 ? ' disabled' : '') + '>‹ 上一页</button>' +
        '<span class="pg-info">第 ' + fbPage + ' / ' + totalPages + ' 页 · 共 ' + fbTotal + ' 条</span>' +
        '<button class="pg" data-fbpg="next"' + (fbPage >= totalPages ? ' disabled' : '') + '>下一页 ›</button>';
    }
  }
  // 按产品筛选下拉：由全量产品填充（保留当前选择）
  function populateFbFilter() {
    var sel = document.getElementById('fb-product-filter');
    if (!sel) return;
    var cur = sel.value;
    var html = '<option value="">' + T('fb.filterProduct') + '</option>' +
      allProducts.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
    if (sel.innerHTML !== html) sel.innerHTML = html;
    if (allProducts.some(function (p) { return String(p.id) === cur; })) sel.value = cur;
    else sel.value = '';
  }
  var fbSearchEl = document.getElementById('feedback-search');
  if (fbSearchEl) fbSearchEl.addEventListener('input', function (e) {
    fbKw = e.target.value;
    fbPage = 1;
    if (fbSearchTimer) clearTimeout(fbSearchTimer);
    fbSearchTimer = setTimeout(function () { loadFeedback(); }, 300);
  });
  var fbFilterEl = document.getElementById('feedback-filter');
  if (fbFilterEl) fbFilterEl.addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    fbStatusFilter = b.getAttribute('data-status') || 'all';
    Array.prototype.forEach.call(fbFilterEl.children, function (c) { c.classList.toggle('active', c === b); });
    fbPage = 1;
    loadFeedback();
  });
  var fbPagerEl = document.getElementById('feedback-pager');
  if (fbPagerEl) fbPagerEl.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-fbpg]');
    if (!b || b.disabled) return;
    var totalPages = Math.max(1, Math.ceil(fbTotal / FEEDBACK_PAGE_SIZE));
    var act = b.getAttribute('data-fbpg');
    if (act === 'prev' && fbPage > 1) fbPage--;
    else if (act === 'next' && fbPage < totalPages) fbPage++;
    else return;
    loadFeedback({ keepPage: true });
  });
  var fbProdSel = document.getElementById('fb-product-filter');
  if (fbProdSel) fbProdSel.addEventListener('change', function () {
    fbProductId = this.value;
    fbPage = 1;
    loadFeedback();
  });
  var fbListEl = document.getElementById('feedback-list');
  if (fbListEl) fbListEl.addEventListener('click', function (e) {
    var del = e.target.closest('button[data-fb-del]');
    if (del) {
      var id = del.getAttribute('data-fb-del');
      showConfirm({
        title: T('fb.delTitle') || '删除反馈',
        message: T('fb.delConfirm') || '确定删除这条反馈？此操作不可恢复。',
        danger: true,
        confirmText: T('contact.delete') || '删除'
      }).then(function (ok) {
        if (!ok) return;
        del.disabled = true;
        fetch(API + '/admin/feedback/' + id, { method: 'DELETE', headers: authHeaders() })
          .then(function (r) {
            if (r.status === 401) { clearToken(); showLogin(); return; }
            if (!r.ok) { showToast('删除失败（HTTP ' + r.status + '）', true); return; }
            loadFeedback({ keepPage: true }); loadStats();
          })
          .catch(function () { showToast('删除失败：网络错误', true); })
          .then(function () { del.disabled = false; });
      });
      return;
    }
    var tog = e.target.closest('button[data-fb-toggle]');
    if (tog) {
      var tid = tog.getAttribute('data-fb-toggle');
      var cur = tog.getAttribute('data-status');
      var next = cur === 'done' ? 'new' : 'done';
      tog.disabled = true;
      fetch(API + '/admin/feedback/' + tid, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status: next })
      })
        .then(function (r) {
          if (r.status === 401) { clearToken(); showLogin(); return; }
          if (!r.ok) { showToast('状态更新失败（HTTP ' + r.status + '）', true); return; }
          loadFeedback({ keepPage: true }); loadStats();
        })
        .catch(function () { showToast('状态更新失败：网络错误', true); })
        .then(function () { tog.disabled = false; });
    }
  });

  /* ---------- 产品操作（事件委托） ---------- */
  document.getElementById('product-rows').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var act = btn.getAttribute('data-act');
    if (act === 'toggle') {
      fetch(API + '/admin/products/' + id, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ status: btn.classList.contains('on') ? 'on' : 'off' })
      }).then(function () { loadProducts(); loadStats(); });
    } else if (act === 'del') {
      var pname = btn.getAttribute('data-name') || ('#' + id);
      showConfirm({
        title: T('product.deleteTitle') || '删除产品',
        message: (T('product.deleteConfirm') || '确定删除该产品？此操作不可恢复。').replace('{name}', pname),
        danger: true,
        confirmText: T('product.delete') || '删除'
      }).then(function (ok) {
        if (!ok) return;
        fetch(API + '/admin/products/' + id, { method: 'DELETE', headers: authHeaders() })
          .then(function () { loadProducts(); loadStats(); });
      });
    } else if (act === 'edit') {
      startEdit(Number(id));
    }
  });

  /* ---------- 产品批量操作（维度 74） ---------- */
  // 当前筛选结果中选中的产品 id 列表
  function selectedProductList() {
    return Object.keys(selectedProductIds).map(Number);
  }
  function updateProductBatchBar() {
    var bar = document.getElementById('product-batch');
    var cnt = document.getElementById('product-batch-count');
    if (!bar || !cnt) return;
    var n = selectedProductList().length;
    bar.hidden = n === 0;
    cnt.textContent = (T('bulk.batchCount') || '已选 {n} 个产品').replace('{n}', String(n));
  }
  // 勾选 / 取消勾选（事件委托到 tbody，行内重新渲染会重建 checkbox，用 change 事件）
  document.getElementById('product-rows').addEventListener('change', function (e) {
    var cb = e.target.closest('input[data-pcheck]');
    if (!cb) return;
    var id = Number(cb.getAttribute('data-pcheck'));
    if (cb.checked) selectedProductIds[id] = true;
    else delete selectedProductIds[id];
    updateProductBatchBar();
  });
  // 全选当前筛选结果 / 取消全选
  var pmSelAll = document.getElementById('pm-select-all');
  if (pmSelAll) {
    pmSelAll.addEventListener('change', function () {
      var kw = pmKeyword.trim().toLowerCase();
      var list = allProducts.filter(function (p) {
        if (pmFilter !== 'all' && p.type !== pmFilter) return false;
        if (kw && p.name.toLowerCase().indexOf(kw) === -1) return false;
        return true;
      });
      if (this.checked) list.forEach(function (p) { selectedProductIds[p.id] = true; });
      else list.forEach(function (p) { delete selectedProductIds[p.id]; });
      renderProducts();
    });
  }
  // 批量操作统一入口：POST /admin/products/bulk/<op>，成功回调后刷新并保留选中
  function bulkProduct(op, payload) {
    return fetch(API + '/admin/products/bulk/' + op, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
      return r.json().then(function (j) {
        if (!r.ok) throw Object.assign(new Error((j && j.error) || ('HTTP ' + r.status)), { status: r.status });
        return j;
      }).catch(function (e) {
        if (e instanceof SyntaxError) throw new Error('HTTP ' + r.status);
        throw e;
      });
    });
  }
  var batchOn = document.getElementById('batch-shelf-on');
  if (batchOn) batchOn.addEventListener('click', function () {
    var ids = selectedProductList();
    if (!ids.length) { showToast(T('bulk.needSel') || '请先勾选产品', true); return; }
    bulkProduct('status', { ids: ids, status: 'on' })
      .then(function () { loadProducts(); loadStats(); showToast(T('bulk.done') || '操作成功'); })
      .catch(function (e) { if (e && e.message === 'unauthorized') return; showToast((T('bulk.fail') || '批量操作失败：') + (e && e.message || '未知错误'), true); });
  });
  var batchOff = document.getElementById('batch-shelf-off');
  if (batchOff) batchOff.addEventListener('click', function () {
    var ids = selectedProductList();
    if (!ids.length) { showToast(T('bulk.needSel') || '请先勾选产品', true); return; }
    bulkProduct('status', { ids: ids, status: 'off' })
      .then(function () { loadProducts(); loadStats(); showToast(T('bulk.done') || '操作成功'); })
      .catch(function (e) { if (e && e.message === 'unauthorized') return; showToast((T('bulk.fail') || '批量操作失败：') + (e && e.message || '未知错误'), true); });
  });
  var batchCat = document.getElementById('batch-cat-apply');
  if (batchCat) batchCat.addEventListener('click', function () {
    var ids = selectedProductList();
    if (!ids.length) { showToast(T('bulk.needSel') || '请先勾选产品', true); return; }
    var sel = document.getElementById('batch-category');
    var category = sel ? sel.value : '';
    bulkProduct('category', { ids: ids, category: category })
      .then(function () { loadProducts(); loadStats(); showToast(T('bulk.done') || '操作成功'); })
      .catch(function (e) { if (e && e.message === 'unauthorized') return; showToast((T('bulk.fail') || '批量操作失败：') + (e && e.message || '未知错误'), true); });
  });
  var batchDel = document.getElementById('batch-del-products');
  if (batchDel) batchDel.addEventListener('click', function () {
    var ids = selectedProductList();
    if (!ids.length) { showToast(T('bulk.needSel') || '请先勾选产品', true); return; }
    var n = ids.length;
    showConfirm({
      title: T('bulk.delTitle') || '批量删除产品',
      message: (T('bulk.delConfirm') || '确定删除选中的 {n} 个产品？此操作不可恢复。').replace('{n}', String(n)),
      danger: true,
      confirmText: T('product.delete') || '删除'
    }).then(function (ok) {
      if (!ok) return;
      bulkProduct('delete', { ids: ids })
        .then(function () {
          selectedProductIds = {};
          loadProducts(); loadStats();
          showToast(T('bulk.done') || '操作成功');
        })
        .catch(function (e) { if (e && e.message === 'unauthorized') return; showToast((T('bulk.fail') || '批量操作失败：') + (e && e.message || '未知错误'), true); });
    });
  });

  /* ---------- 搜索 + 筛选 ---------- */
  document.getElementById('pm-search').addEventListener('input', function (e) {
    pmKeyword = e.target.value;
    renderProducts();
  });
  document.getElementById('pm-filter').addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    pmFilter = b.getAttribute('data-type');
    Array.prototype.forEach.call(this.children, function (c) { c.classList.remove('active'); });
    b.classList.add('active');
    renderProducts();
  });
  var contactFilterEl = document.getElementById('contact-filter');
  if (contactFilterEl) {
    contactFilterEl.addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      contactStatusFilter = b.getAttribute('data-status') || 'all';
      Array.prototype.forEach.call(this.children, function (c) { c.classList.remove('active'); });
      b.classList.add('active');
      selectedIds = {};
      contactPage = 1;
      loadContacts();
    });
  }

  /* ---------- 新增 / 编辑 表单 ---------- */
  var form = document.getElementById('product-form');
  var editIdInput = document.getElementById('edit-id');
  var submitBtn = document.getElementById('submit-btn');
  var cancelBtn = document.getElementById('cancel-edit');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var payload = {
      name: document.getElementById('f-name').value.trim(),
      type: document.getElementById('f-type').value,
      category: document.getElementById('f-category').value.trim(),
      desc: document.getElementById('f-desc').value.trim(),
      icon: document.getElementById('f-icon').value.trim(),
      image: document.getElementById('f-image').value.trim(),
      download_url: document.getElementById('f-url').value.trim(),
      version: document.getElementById('f-version').value.trim(),
      changelog: document.getElementById('f-changelog').value.trim(),
      sort: (function () {
        var v = document.getElementById('f-sort').value.trim();
        return v === '' ? 0 : Number(v);
      })()
    };
    var verr = validateProductPayload(payload);
    if (verr) { showToast(verr, true); return; }

    var id = editIdInput.value;
    var req;
    if (id) {
      req = fetch(API + '/admin/products/' + id, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload)
      });
    } else {
      req = fetch(API + '/admin/products', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(payload)
      });
    }
    req.then(function (r) {
      if (r.status === 401) { clearToken(); showLogin(); return; }
      if (!r.ok) {
        // 此前无论成功失败都重置表单+刷新，校验失败也会被当成成功。
        r.json().then(function (j) {
          showToast(j && j.error ? j.error : ('保存失败（HTTP ' + r.status + '）'), true);
        }).catch(function () {
          showToast('保存失败（HTTP ' + r.status + '）', true);
        });
        return;
      }
      resetForm();
      loadProducts();
      loadStats();
    }).catch(function () { showToast('保存失败：网络错误', true); });
  });

  // 客户端预校验（与服务端规则保持一致，拦截明显非法输入）
  function validateProductPayload(p) {
    if (!p.name) return '请填写名称';
    if (p.name.length > 80) return '名称过长（≤80 字符）';
    if (p.category.length > 40) return '分类过长（≤40 字符）';
    if (p.category && !/^[\p{Script=Han}A-Za-z0-9\s/、,.\-#·()（）]+$/u.test(p.category)) {
      return '分类含非法字符（仅限中英文、数字与常用分隔符）';
    }
    if (p.desc.length > 500) return '简介过长（≤500 字符）';
    if (p.icon.length > 8) return '图标过长（≤8 字符）';
    if (p.icon && !/^[\p{Extended_Pictographic}\u200d\ufe0f]+$/u.test(p.icon)) {
      return '图标仅限 emoji（如 📝 / 🚀）';
    }
    if (p.image.length > 500) return '产品图地址过长（≤500 字符）';
    if (p.image &&
      !/^https?:\/\/[^\s"'<>]+$/i.test(p.image) &&
      !/^\/assets\/img\/[A-Za-z0-9_\-./]+\.(jpe?g|png|webp|avif|gif|svg)$/i.test(p.image)) {
      return '产品图须为 http(s) 链接或 /assets/img/… 图片路径';
    }
    var sv = p.sort;
    if (typeof sv === 'string') sv = sv.trim();
    if (sv === '' || sv == null) sv = 0;
    if (!Number.isInteger(Number(sv))) return '排序权重须为整数';
    if (Number(sv) < -9999 || Number(sv) > 9999) return '排序权重范围 -9999 ~ 9999';
    if (p.download_url &&
      !/^https?:\/\//i.test(p.download_url) &&
      !/^(\/|#|\.\/|\.\.\/)/.test(p.download_url) &&
      !/^(downloads?|assets)\//i.test(p.download_url)) {
      return '下载链接须为 http(s) 或站内相对路径';
    }
    if (p.version.length > 30) return '版本号过长（≤30 字符）';
    if (p.changelog.length > 2000) return '更新日志过长（≤2000 字符）';
    return null;
  }

  // 产品图片直传（维度 67）：选择本地图片 → 上传 /api/admin/upload → 回填 f-image 地址
  var imgFile = document.getElementById('f-image-file');
  var imgUpBtn = document.getElementById('f-image-upload');
  if (imgFile && imgUpBtn) {
    imgUpBtn.addEventListener('click', function () { imgFile.click(); });
    imgFile.addEventListener('change', function () {
      var f = imgFile.files && imgFile.files[0];
      if (!f) return;
      if (!/^image\/(png|jpeg|webp|gif)$/i.test(f.type)) {
        showToast('仅支持 PNG / JPG / WebP / GIF 图片', true); imgFile.value = ''; return;
      }
      if (f.size > 2 * 1024 * 1024) {
        showToast('图片须 ≤ 2MB', true); imgFile.value = ''; return;
      }
      var fr = new FileReader();
      fr.onload = function () {
        fetch(API + '/admin/upload', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ data: fr.result })
        }).then(function (r) {
          if (r.status === 401) { clearToken(); showLogin(); return; }
          return r.json();
        }).then(function (j) {
          if (!j || !j.ok || !j.url) {
            showToast((j && j.error) || '上传失败', true); imgFile.value = ''; return;
          }
          document.getElementById('f-image').value = j.url;
          showToast('图片已上传：' + j.url);
        }).catch(function () { showToast('上传失败：网络错误', true); });
      };
      fr.onerror = function () { showToast('图片读取失败', true); };
      fr.readAsDataURL(f);
    });
  }

  cancelBtn.addEventListener('click', resetForm);

  function startEdit(id) {
    var p = allProducts.find(function (x) { return x.id === id; });
    if (!p) return;
    editIdInput.value = p.id;
    document.getElementById('f-name').value = p.name;
    document.getElementById('f-type').value = p.type;
    document.getElementById('f-category').value = p.category || '';
    document.getElementById('f-icon').value = p.icon || '';
    document.getElementById('f-image').value = p.image || '';
    document.getElementById('f-sort').value = p.sort != null ? p.sort : 0;
    document.getElementById('f-url').value = p.download_url || '';
    document.getElementById('f-version').value = p.version || '';
    document.getElementById('f-changelog').value = p.changelog || '';
    document.getElementById('f-desc').value = p.desc || '';
    submitBtn.textContent = '保存修改';
    cancelBtn.style.display = 'inline-block';
    form.scrollIntoView({ behavior: (window.prefersReducedMotion && window.prefersReducedMotion()) ? 'auto' : 'smooth' });
  }
  function resetForm() {
    form.reset();
    editIdInput.value = '';
    submitBtn.textContent = '上架新产品';
    cancelBtn.style.display = 'none';
  }

  /* ---------- 修改后台口令 ---------- */
  var pwForm = document.getElementById('pw-form');
  var pwMsg = document.getElementById('pw-msg');
  pwForm.addEventListener('submit', function (e) {
    e.preventDefault();
    pwMsg.textContent = '';
    pwMsg.className = 'form-msg';
    var oldPw = document.getElementById('old-pw').value;
    var newPw = document.getElementById('new-pw').value;
    var newPw2 = document.getElementById('new-pw2').value;
    if (!oldPw || !newPw || !newPw2) { pwMsg.textContent = '请填写全部字段'; pwMsg.classList.add('err'); return; }
    if (newPw.length < 6) { pwMsg.textContent = '新口令至少 6 位'; pwMsg.classList.add('err'); return; }
    if (newPw !== newPw2) { pwMsg.textContent = '两次输入的新口令不一致'; pwMsg.classList.add('err'); return; }
    var pwSubmit = pwForm.querySelector('#pw-submit');
    pwSubmit.disabled = true;
    fetch(API + '/admin/password', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        pwSubmit.disabled = false;
        if (!res.ok) { pwMsg.textContent = (res.j && res.j.error) || '修改失败'; pwMsg.classList.add('err'); return; }
        // 口令已更新：用新 Token 替换本地旧 Token，后续请求自动生效
        if (res.j && res.j.token) setSession(res.j.token, res.j.expiresAt);
        pwMsg.textContent = '口令已更新成功，请使用新口令登录';
        pwMsg.classList.add('ok');
        document.getElementById('old-pw').value = '';
        document.getElementById('new-pw').value = '';
        document.getElementById('new-pw2').value = '';
      })
      .catch(function () { pwSubmit.disabled = false; pwMsg.textContent = '网络错误，请重试'; pwMsg.classList.add('err'); });
  });

  /* ---------- 管理员账号管理（仅管理员） ---------- */
  // 当前账号行禁用角色切换/删除：后端另有「最后一个 admin 不可降级/删除」兜底，这里先阻断明显误操作
  function loadAdmins() {
    if (!isAdmin()) return;
    fetch(API + '/admin/admins', { headers: authHeaders() })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        var box = document.getElementById('admin-list');
        if (!box) return;
        if (!list || !list.length) { box.innerHTML = '<div class="empty">暂无账号</div>'; return; }
        var me = getUsername();
        box.innerHTML = list.map(function (a) {
          var isSelf = a.username === me;
          var selfTag = isSelf ? '<span class="admin-self">' + T('admin.self') + '</span>' : '';
          var roleOpts = '<option value="admin"' + (a.role === 'admin' ? ' selected' : '') + '>' + T('role.admin') + '</option>' +
            '<option value="viewer"' + (a.role === 'viewer' ? ' selected' : '') + '>' + T('role.viewer') + '</option>';
          var roleSel = '<select class="admin-role-select' + (a.role === 'viewer' ? ' sel-viewer' : ' sel-admin') + '"' +
            ' data-role-set="' + a.id + '" data-name="' + esc(a.username) + '"' +
            (isSelf ? ' disabled' : '') + ' aria-label="' + (T('na.role') || '角色') + ' ' + esc(a.username) + '">' +
            roleOpts + '</select>';
          var delBtn = isSelf ? '' :
            '<button class="btn-sm danger" data-del-admin="' + a.id + '" data-name="' + esc(a.username) + '">' +
            T('admin.delete') + '</button>';
          return '<div class="admin-row">' +
            '<span class="admin-name">' + esc(a.username) + selfTag + '</span>' +
            roleSel + delBtn +
          '</div>';
        }).join('');
      })
      .catch(function () {});
  }
  // 角色切换：select 变更 → showConfirm 二次确认（降级/提升都是敏感操作）→ PUT
  var adminListEl = document.getElementById('admin-list');
  if (adminListEl) {
    adminListEl.addEventListener('change', function (e) {
      var sel = e.target.closest('select[data-role-set]');
      if (!sel) return;
      var id = sel.getAttribute('data-role-set');
      var name = sel.getAttribute('data-name') || ('#' + id);
      var next = sel.value;
      var roleTxt = next === 'viewer' ? T('role.viewer') : T('role.admin');
      sel.disabled = true;
      showConfirm({
        title: T('admin.roleTitle') || '修改角色',
        message: (T('admin.roleConfirm') || '确定将「{name}」的角色改为「{role}」？')
          .replace('{name}', name).replace('{role}', roleTxt),
        confirmText: T('admin.confirm') || '确认'
      }).then(function (ok) {
        if (!ok) { sel.disabled = false; loadAdmins(); return; }
        fetch(API + '/admin/admins/' + id, {
          method: 'PUT', headers: authHeaders(), body: JSON.stringify({ role: next })
        })
          .then(function (r) {
            if (r.status === 401) { clearToken(); showLogin(); return; }
            if (!r.ok) {
              r.json().then(function (j) {
                showToast((j && j.error) || ('角色修改失败（HTTP ' + r.status + '）'), true);
              }).catch(function () { showToast('角色修改失败（HTTP ' + r.status + '）', true); });
              loadAdmins();
              return;
            }
            showToast(name + ' → ' + roleTxt);
            loadAdmins();
          })
          .catch(function () { showToast('角色修改失败：网络错误', true); loadAdmins(); });
      });
    });
    // 删除账号：showConfirm 二次确认（不可恢复）→ DELETE
    adminListEl.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-del-admin]');
      if (!btn) return;
      var id = btn.getAttribute('data-del-admin');
      var name = btn.getAttribute('data-name') || ('#' + id);
      showConfirm({
        title: T('admin.deleteTitle') || '删除账号',
        message: (T('admin.deleteConfirm') || '确定删除账号「{name}」？此操作不可恢复。').replace('{name}', name),
        danger: true,
        confirmText: T('admin.delete') || '删除'
      }).then(function (ok) {
        if (!ok) return;
        btn.disabled = true;
        fetch(API + '/admin/admins/' + id, { method: 'DELETE', headers: authHeaders() })
          .then(function (r) {
            if (r.status === 401) { clearToken(); showLogin(); return; }
            if (!r.ok) {
              r.json().then(function (j) {
                showToast((j && j.error) || ('删除失败（HTTP ' + r.status + '）'), true);
              }).catch(function () { showToast('删除失败（HTTP ' + r.status + '）', true); });
              loadAdmins();
              return;
            }
            showToast('已删除账号：' + name);
            loadAdmins();
          })
          .catch(function () { showToast('删除失败：网络错误', true); loadAdmins(); })
          .then(function () { btn.disabled = false; });
      });
    });
  }
  var naForm = document.getElementById('add-admin-form');
  if (naForm) {
    naForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('na-msg');
      msg.textContent = ''; msg.className = 'form-msg';
      var user = document.getElementById('na-user').value.trim();
      var pass = document.getElementById('na-pass').value;
      var role = document.getElementById('na-role').value;
      if (!user || !pass) { msg.textContent = '请填写用户名与口令'; msg.classList.add('err'); return; }
      if (pass.length < 6) { msg.textContent = '口令至少 6 位'; msg.classList.add('err'); return; }
      var btn = document.getElementById('na-submit');
      btn.disabled = true;
      fetch(API + '/admin/admins', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ username: user, password: pass, role: role })
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          btn.disabled = false;
          if (!res.ok) { msg.textContent = (res.j && res.j.error) || '添加失败'; msg.classList.add('err'); return; }
          msg.textContent = '已添加账号：' + user; msg.classList.add('ok');
          document.getElementById('na-user').value = '';
          document.getElementById('na-pass').value = '';
          loadAdmins();
        })
        .catch(function () { btn.disabled = false; msg.textContent = '网络错误，请重试'; msg.classList.add('err'); });
    });
  }

  /* ---------- 窗口缩放重绘图表 ---------- */
  var resizeTimer;
  window.addEventListener('resize', function () {
    if (!lastTrend) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      drawTrend(document.getElementById('trend-chart'), lastTrend.range);
    }, 150);
  });

  /* ---------- 系统信息 ---------- */
  // 「检查更新」：调用 pwa.js 暴露的 window.checkPWAUpdate() 重新拉取 sw.js 探测新版本；
  // 有新版本时 pwa.js 会弹出更新提示条（点击刷新即应用）。非 SW 环境（不支持）时给出提示。
  var checkUpdateBtn = document.getElementById('check-update');
  if (checkUpdateBtn) {
    checkUpdateBtn.addEventListener('click', function () {
      if (typeof window.checkPWAUpdate !== 'function') {
        showToast('当前环境不支持 PWA 更新检查', true);
        return;
      }
      checkUpdateBtn.disabled = true;
      showToast('已发起检查，如有新版本将弹出提示');
      window.checkPWAUpdate();
      setTimeout(function () { checkUpdateBtn.disabled = false; }, 3000);
    });
  }
  function loadSysInfo() {
    fetch(API + '/admin/sysinfo', { headers: authHeaders() })
      .then(function (r) {
        if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
        return r.json();
      })
      .then(applySysInfo)
      .catch(function () {});
  }
  /* ---------- 站点维护模式（维度 73） ---------- */
  function loadMaintenance() {
    var st = document.getElementById('maint-status');
    if (!st) return;
    st.textContent = '…';
    fetch(API + '/admin/maintenance', { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (m) {
        var on = m && m.enabled;
        st.textContent = on ? getText('maint.statusOn') : getText('maint.statusOff');
        st.style.color = on ? '#ff9b8f' : '#4fd18b';
        var msg = document.getElementById('maint-msg');
        if (msg && m && m.message) msg.value = m.message;
        var btnOn = document.getElementById('maint-on');
        var btnOff = document.getElementById('maint-off');
        if (btnOn) btnOn.disabled = !!on;
        if (btnOff) btnOff.disabled = !on;
      })
      .catch(function () { st.textContent = '–'; });
  }
  function setMaintenance(enabled) {
    var msg = document.getElementById('maint-msg');
    return fetch(API + '/admin/maintenance', {
      method: 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify({ enabled: enabled ? 1 : 0, message: msg ? msg.value : '' })
    }).then(function (r) {
      if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
      return r.json();
    });
  }
  (function initMaintenance() {
    var btnOn = document.getElementById('maint-on');
    var btnOff = document.getElementById('maint-off');
    if (btnOn) btnOn.addEventListener('click', function () {
      if (typeof showConfirm === 'function') {
        showConfirm({ title: getText('maint.confirmTitle'), message: getText('maint.confirm'), danger: true })
          .then(function (ok) { if (ok) { btnOn.disabled = true; return setMaintenance(true); } return null; })
          .then(function (r) { if (!r) return; loadMaintenance(); showToast(r.message ? r.message : getText('maint.done')); })
          .catch(function () {});
      } else {
        btnOn.disabled = true;
        setMaintenance(true).then(function (r) { loadMaintenance(); showToast(r.message ? r.message : getText('maint.done')); });
      }
    });
    if (btnOff) btnOff.addEventListener('click', function () {
      btnOff.disabled = true;
      setMaintenance(false)
        .then(function () { loadMaintenance(); showToast(getText('maint.done')); })
        .catch(function () { btnOff.disabled = false; });
    });
  })();
  function fmtUptime(s) {
    s = s || 0;
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var parts = [];
    if (d) parts.push(d + ' 天');
    if (h) parts.push(h + ' 时');
    if (m) parts.push(m + ' 分');
    parts.push((s % 60) + ' 秒');
    return parts.join('');
  }
  function fmtSize(b) {
    b = b || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(2) + ' MB';
  }
  function fmtAgo(ts) {
    if (!ts) return '未知';
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 0) return '刚刚';
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    return Math.floor(s / 86400) + ' 天前';
  }
  function applySysInfo(s) {
    if (!s) return;
    var rows = [
      { k: '运行时长', v: fmtUptime(s.uptime) },
      { k: 'Node 版本', v: s.nodeVersion },
      { k: '平台', v: s.platform },
      { k: '数据库大小', v: fmtSize(s.dbSize) },
      { k: '服务器时间', v: s.serverTime },
      { k: '产品总数', v: s.counts.products + '（在架 ' + s.counts.onShelf + '）' },
      { k: '累计浏览', v: s.counts.visits },
      { k: '累计下载', v: s.counts.downloads },
      { k: '联系留言', v: s.counts.contacts }
    ];
    // 备份可观测性：备份停摆是「平时无感、出事致命」的问题，必须显式暴露
    if (s.backup) {
      var b = s.backup;
      if (!b.count) {
        rows.push({ k: '数据库备份', v: '暂无备份 ⚠ 请执行 npm run backup', warn: true });
      } else {
        rows.push({
          k: '数据库备份',
          v: b.count + ' 份 / ' + fmtSize(b.totalBytes) + ' · 最近 ' + fmtAgo(b.lastTs) +
            (b.stale ? ' ⚠ 已超过 48 小时' : ' ✓'),
          warn: !!b.stale
        });
      }
    }
    if (s.defaultPassword) rows.push({ k: '后台口令', v: '仍使用默认 admin123 ⚠', warn: true });
    else rows.push({ k: '后台口令', v: '已自定义 ✓' });
    document.getElementById('sys-info').innerHTML = renderSysRows(rows);
    loadHealth();
  }

  function renderSysRows(rows) {
    return rows.map(function (r) {
      return '<div class="sys-item' + (r.warn ? ' warn' : '') + '">' +
        '<span class="sys-k">' + esc(r.k) + '</span>' +
        '<span class="sys-v">' + esc(String(r.v)) + '</span></div>';
    }).join('');
  }

  /* 深度健康检查：接口是 /api/health/detail（需登录，异常项会返回 503）。
     目的与备份状态一致——把「服务看着正常，但磁盘快满 / 内存异常 / 数据库只读」这类
     平时无感、出事致命的问题直接摆在运维眼前，而不是等网站挂了才发现。 */
  function loadHealth() {
    fetch(API + '/health/detail', { headers: authHeaders() })
      .then(function (r) {
        if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
        // 503 是「检查未通过」的正常响应，仍需解析 body
        if (r.status !== 200 && r.status !== 503) throw new Error('bad status ' + r.status);
        return r.json();
      })
      .then(applyHealth)
      .catch(function () {});
  }
  function applyHealth(h) {
    var box = document.getElementById('sys-info');
    if (!h || !h.checks || !box) return;
    var c = h.checks;
    var rows = [];
    var bad = 0;
    function push(k, v, isBad) {
      rows.push({ k: k, v: v, warn: !!isBad });
      if (isBad) bad++;
    }
    if (c.db) {
      if (c.db.ok) push('数据库', '读写正常 · ' + c.db.tables + ' 张表 · ' + c.db.latencyMs + 'ms', false);
      else push('数据库', '读写异常 ⚠ ' + (c.db.error || ''), true);
    }
    if (c.disk) {
      if (c.disk.ok) push('磁盘可用', fmtSize(c.disk.freeBytes) + ' / 共 ' + fmtSize(c.disk.totalBytes), false);
      else push('磁盘可用', '不足 512MB ⚠', true);
    }
    if (c.backupVerify) {
      // 有备份 ≠ 能恢复。校验结果必须可见，否则「以为有备份」和「真能恢复」永远隔着一次灾难。
      push('备份校验', c.backupVerify.ok ? '最近一次通过 ✓' : '⚠ ' + (c.backupVerify.detail || '未通过'), !c.backupVerify.ok);
    }
    if (c.memory) {
      push('进程内存', fmtSize(c.memory.rssBytes) + (c.memory.ok ? '' : ' ⚠ 超过 512MB'), !c.memory.ok);
    }
    if (c.logs && c.logs.files) {
      var lf = c.logs.files;
      push('日志文件', '访问 ' + fmtSize(lf['access.log'] || 0) + ' · 错误 ' + fmtSize(lf['error.log'] || 0), false);
    }
    rows.unshift({
      k: '健康检查',
      v: h.status === 'ok' ? '全部通过 ✓' : bad + ' 项未通过 ⚠',
      warn: h.status !== 'ok'
    });
    // 追加到系统信息面板末尾（面板内无事件绑定，重建 DOM 无副作用）
    box.innerHTML += renderSysRows(rows);
  }

  /* ---------- 操作审计日志（服务端分页 + 筛选） ---------- */
  var AUDIT_PAGE_SIZE = 10;
  var auditPage = 1;
  var auditTotal = 0;
  var auditKw = '';
  var auditAction = '';
  var auditSearchTimer = null;
  function loadAudit(opts) {
    var keepPage = !!(opts && opts.keepPage);
    var qs = '?page=' + auditPage + '&pageSize=' + AUDIT_PAGE_SIZE +
      '&action=' + encodeURIComponent(auditAction) +
      '&keyword=' + encodeURIComponent(auditKw.trim());
    fetch(API + '/admin/audit' + qs, { headers: authHeaders() })
      .then(function (r) {
        if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
        return r.json();
      })
      .then(function (data) {
        var rows = (data && data.rows) || [];
        auditTotal = (data && data.total) || 0;
        if (!keepPage) auditPage = 1;
        if (auditPage > 1 && rows.length === 0 && auditTotal > 0) {
          auditPage--;
          return loadAudit({ keepPage: true });
        }
        applyAudit(rows);
        renderAuditPager();
      })
      .catch(function () {});
  }
  function renderAuditPager() {
    var pager = document.getElementById('audit-pager');
    if (!pager) return;
    if (!auditTotal) { pager.innerHTML = ''; return; }
    var totalPages = Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE));
    pager.innerHTML =
      '<button class="pg" data-apg="prev"' + (auditPage <= 1 ? ' disabled' : '') + '>‹ 上一页</button>' +
      '<span class="pg-info">第 ' + auditPage + ' / ' + totalPages + ' 页 · 共 ' + auditTotal + ' 条</span>' +
      '<button class="pg" data-apg="next"' + (auditPage >= totalPages ? ' disabled' : '') + '>下一页 ›</button>';
  }
  var auditSearchEl = document.getElementById('audit-search');
  if (auditSearchEl) auditSearchEl.addEventListener('input', function (e) {
    auditKw = e.target.value;
    auditPage = 1;
    if (auditSearchTimer) clearTimeout(auditSearchTimer);
    auditSearchTimer = setTimeout(function () { loadAudit(); }, 300);
  });
  var auditActionSel = document.getElementById('audit-action');
  if (auditActionSel) auditActionSel.addEventListener('change', function () {
    auditAction = auditActionSel.value === 'all' ? '' : auditActionSel.value;
    auditPage = 1;
    loadAudit();
  });
  var auditPagerEl = document.getElementById('audit-pager');
  if (auditPagerEl) auditPagerEl.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-apg]');
    if (!b || b.disabled) return;
    var totalPages = Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE));
    var act = b.getAttribute('data-apg');
    if (act === 'prev' && auditPage > 1) auditPage--;
    else if (act === 'next' && auditPage < totalPages) auditPage++;
    else return;
    loadAudit({ keepPage: true });
  });
  var auditLabels = {
    login: '登录后台',
    product_add: '新增产品',
    product_edit: '编辑产品',
    product_delete: '删除产品',
    password_change: '修改口令',
    contact_delete: '删除留言',
    contact_status: '更新留言状态',
    db_backup: '导出数据库备份',
    db_autobackup: '自动备份数据库',
    db_verify: '校验备份完整性'
  };
  function applyAudit(list) {
    var box = document.getElementById('audit-list');
    if (!box) return;
    if (!list.length) { box.innerHTML = '<div class="empty">暂无操作记录</div>'; return; }
    // 按日期分组，渲染成时间线（左侧竖线 + 日期分组标题 + 每条圆点）
    function p(n) { return (n < 10 ? '0' : '') + n; }
    function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
    function timeOnly(ts) { var d = new Date(ts); return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }
    var groups = {};
    list.forEach(function (m) {
      var k = dayKey(m.ts);
      (groups[k] = groups[k] || []).push(m);
    });
    var days = Object.keys(groups).sort().reverse();
    box.className = 'audit-list audit-timeline';
    box.innerHTML = days.map(function (day) {
      var items = groups[day].map(function (m) {
        var label = auditLabels[m.action] || m.action;
        return '<div class="audit-item">' +
          '<span class="audit-act">' + esc(label) + '</span>' +
          (m.detail ? '<span class="audit-detail">' + esc(m.detail) + '</span>' : '') +
          '<span class="audit-ip">' + esc(m.ip || '') + '</span>' +
          '<span class="audit-time">' + timeOnly(m.ts) + '</span></div>';
      }).join('');
      return '<div class="audit-day"><div class="audit-day-h">' + esc(day) + '</div>' + items + '</div>';
    }).join('');
  }
  var auditBtn = document.getElementById('refresh-audit');
  if (auditBtn) auditBtn.addEventListener('click', loadAudit);

  var accessLogLines = 100;
  function loadAccessLog() {
    fetch(API + '/admin/accesslog?lines=' + accessLogLines, { headers: authHeaders() })
      .then(function (r) {
        if (r.status === 401) { clearToken(); showLogin(); throw new Error('unauthorized'); }
        return r.json();
      })
      .then(function (data) {
        var box = document.getElementById('access-log');
        if (!box) return;
        var lines = (data && data.lines) || [];
        box.textContent = lines.length ? lines.join('\n') : '暂无访问记录';
      })
      .catch(function () {});
  }
  var accessLogBtn = document.getElementById('refresh-accesslog');
  if (accessLogBtn) accessLogBtn.addEventListener('click', loadAccessLog);
  var accessLinesSel = document.getElementById('accesslog-lines');
  if (accessLinesSel) accessLinesSel.addEventListener('change', function () {
    accessLogLines = parseInt(accessLinesSel.value, 10) || 100;
    loadAccessLog();
  });

  // 语言切换后，重渲染动态看板/表格（静态文案由 i18n.js 自动处理）
  window.addEventListener('gr:langchange', function () {
    if (lastStats) applyStats(lastStats);
    if (lastTrend) { try { renderTrendDays(); applyTrend(lastTrend); } catch (e) {} } else { try { loadTrend(); } catch (e) {} }
    try { renderProducts(); } catch (e) {}
    try { renderContacts(); } catch (e) {}
    try { loadAdmins(); } catch (e) {}
    try { loadAccessLog(); } catch (e) {}
  });

  /* ---------- 启动 ---------- */
  if (isSessionValid()) { showApp(); } else { clearToken(); showLogin(); }
})();
