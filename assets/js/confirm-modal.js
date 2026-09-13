/* ============================================================
   绿角犀 后台 · 危险操作二次确认弹窗
   - UMD：浏览器挂 window.showConfirm；Node 导出 factory 供测试
   - 返回 Promise<boolean>：用户确认 resolve(true)，取消/Esc resolve(false)
   - 无障碍：role=dialog / aria-modal / 自动聚焦确认键 / Esc 取消 / 外部点击取消
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.showConfirm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function showConfirm(opts) {
    opts = opts || {};
    var title = opts.title || '请确认';
    var message = opts.message || '';
    var confirmText = opts.confirmText || '确认';
    var cancelText = opts.cancelText || '取消';
    var danger = !!opts.danger;

    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay' + (danger ? ' modal-danger' : '');
      overlay.setAttribute('role', 'presentation');

      var dialog = document.createElement('div');
      dialog.className = 'modal';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'modal-title');
      dialog.setAttribute('aria-describedby', 'modal-desc');

      var h = document.createElement('h2');
      h.id = 'modal-title';
      h.className = 'modal-title';
      h.textContent = title;

      var p = document.createElement('p');
      p.id = 'modal-desc';
      p.className = 'modal-desc';
      p.textContent = message;

      var actions = document.createElement('div');
      actions.className = 'modal-actions';

      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-ghost';
      cancelBtn.textContent = cancelText;

      var okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
      okBtn.textContent = confirmText;

      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      dialog.appendChild(h);
      dialog.appendChild(p);
      dialog.appendChild(actions);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      function cleanup() {
        document.removeEventListener('keydown', onKey, true);
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
      function done(result) {
        if (done._fired) return;
        done._fired = true;
        cleanup();
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); done(false); }
        else if (e.key === 'Enter') { e.preventDefault(); done(true); }
      }

      cancelBtn.addEventListener('click', function () { done(false); });
      okBtn.addEventListener('click', function () { done(true); });
      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) done(false); });

      document.addEventListener('keydown', onKey, true);
      if (okBtn.focus) okBtn.focus();

      // 暴露最近一次实例，供自动化测试模拟交互（不影响生产逻辑）
      showConfirm._last = { overlay: overlay, dialog: dialog, okBtn: okBtn, cancelBtn: cancelBtn };
    });
  }

  return showConfirm;
});
