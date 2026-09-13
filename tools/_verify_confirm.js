/* 后台二次确认弹窗行为校验（零依赖，DOM 桩）
 * 校验：A11y 结构 / 危险态样式 / 聚焦 / 确认(点击·Enter) / 取消(点击·Esc·点遮罩)
 * 退出码 0=通过, 1=失败。由 smoke-test.js 的 [12] 组调用。 */
'use strict';
const path = require('path');
const showConfirm = require(path.join(__dirname, '..', 'assets', 'js', 'confirm-modal.js'));

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

/* ---------- 最小 DOM 桩 ---------- */
function El(tag) {
  this.tag = tag; this.className = ''; this.textContent = ''; this.id = '';
  this.children = []; this.parentNode = null;
  this._attrs = {}; this._h = {}; this._focused = false;
}
El.prototype.setAttribute = function (k, v) { this._attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return this._attrs[k] != null ? this._attrs[k] : null; };
El.prototype.appendChild = function (c) { this.children.push(c); c.parentNode = this; return c; };
El.prototype.removeChild = function (c) {
  var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null;
};
El.prototype.addEventListener = function (t, fn) { (this._h[t] = this._h[t] || []).push(fn); };
El.prototype.removeEventListener = function (t, fn) {
  if (!this._h[t]) return; this._h[t] = this._h[t].filter(function (f) { return f !== fn; });
};
El.prototype.focus = function () { this._focused = true; };

var doc = {
  body: new El('body'),
  _h: {},
  createElement: function (t) { return new El(t); },
  addEventListener: function (t, fn) { (this._h[t] = this._h[t] || []).push(fn); },
  removeEventListener: function (t, fn) { if (!this._h[t]) return; this._h[t] = this._h[t].filter(function (f) { return f !== fn; }); }
};
global.document = doc;

function fireClick(el) { (el._h.click || []).forEach(function (fn) { fn({ preventDefault: function () {}, target: el }); }); }
function fireKey(key) { (doc._h.keydown || []).forEach(function (fn) { fn({ key: key, preventDefault: function () {} }); }); }
function fireMousedown(el, target) { (el._h.mousedown || []).forEach(function (fn) { fn({ target: target }); }); }

function run() {
  // 场景 A：危险态 + 结构 + 聚焦 + 点击确认 => true
  var pA = showConfirm({ title: '删除产品', message: '确定？', danger: true, confirmText: '删除' });
  var a = showConfirm._last;
  ok(a.dialog.getAttribute('role') === 'dialog', 'dialog 带 role=dialog');
  ok(a.dialog.getAttribute('aria-modal') === 'true', 'dialog 带 aria-modal=true');
  ok(a.dialog.getAttribute('aria-labelledby') === 'modal-title', 'dialog 关联标题');
  ok(a.dialog.getAttribute('aria-describedby') === 'modal-desc', 'dialog 关联描述');
  ok(a.okBtn.className.indexOf('btn-danger') >= 0, '危险态确认键为 btn-danger');
  ok(a.cancelBtn.className.indexOf('btn-ghost') >= 0, '取消键为 btn-ghost');
  ok(a.okBtn._focused === true, '确认键自动聚焦');
  ok(a.dialog.children.length === 3, '弹窗含 标题+描述+操作区');
  ok(a.overlay.parentNode === doc.body, '弹窗已挂载到 body');

  fireClick(a.okBtn);
  return pA.then(function (r) {
    ok(r === true, '点击确认键 => resolve(true)');
    ok(a.overlay.parentNode === null, '确认后弹窗已从 DOM 移除(cleanup)');

    // 场景 B：点击取消 => false
    var pB = showConfirm({ title: 'T', message: 'M', danger: true });
    fireClick(showConfirm._last.cancelBtn);
    return pB;
  }).then(function (r) {
    ok(r === false, '点击取消键 => resolve(false)');

    // 场景 C：Esc => false
    var pC = showConfirm({ title: 'T', message: 'M' });
    fireKey('Escape');
    return pC;
  }).then(function (r) {
    ok(r === false, 'Esc => resolve(false)');

    // 场景 D：Enter => true（非危险态也走主按钮）
    var pD = showConfirm({ title: 'T', message: 'M' });
    var d = showConfirm._last;
    ok(d.okBtn.className.indexOf('btn-danger') < 0 && d.okBtn.className.indexOf('btn-primary') >= 0, '非危险态确认键为 btn-primary');
    fireKey('Enter');
    return pD;
  }).then(function (r) {
    ok(r === true, 'Enter => resolve(true)');

    // 场景 E：点击遮罩 => false
    var pE = showConfirm({ title: 'T', message: 'M' });
    fireMousedown(showConfirm._last.overlay, showConfirm._last.overlay);
    return pE;
  }).then(function (r) {
    ok(r === false, '点击遮罩 => resolve(false)');

    console.log('\n确认弹窗校验：通过 ' + pass + ' / 失败 ' + fail);
    process.exit(fail ? 1 : 0);
  }).catch(function (e) {
    console.error('校验异常：', e);
    process.exit(1);
  });
}
run();
