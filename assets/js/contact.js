/* ============================================================
   联系页脚本：表单校验 + 提交到 /api/contact
   导航交互（吸顶/汉堡/高亮）由 main.js 统一处理
   ============================================================ */
(function () {
  'use strict';
  var API = '/api';
  var form = document.getElementById('contact-form');
  if (!form) return;

  var submitBtn = document.getElementById('c-submit');
  var msg = document.getElementById('c-msg');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = document.getElementById('c-name').value.trim();
    var email = document.getElementById('c-email').value.trim();
    var message = document.getElementById('c-message').value.trim();
    var company = document.getElementById('c-company') ? document.getElementById('c-company').value.trim() : '';

    msg.className = 'form-msg';
    msg.textContent = '';

    // 蜜罐：真人不会填此隐藏栏，命中即视为机器人，直接放弃提交（服务端二次拦截）
    if (company) {
      showMsg('提交被拦截', 'err');
      return;
    }

    if (!name || !message) {
      showMsg('请填写称呼与留言内容', 'err');
      return;
    }
    if (name.length > 60 || message.length > 1000) {
      showMsg('内容超出长度限制', 'err');
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showMsg('邮箱格式不正确', 'err');
      return;
    }

    submitBtn.disabled = true;
    var old = submitBtn.textContent;
    var g = window.GRI18n;
    submitBtn.textContent = (g && g.dict[g.get()]['btn.sending']) || '发送中…';

    fetch(API + '/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, email: email, message: message, company: company })
    })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j }; });
      })
      .then(function (res) {
        if (!res.ok) {
          showMsg((res.j && res.j.error) || '提交失败，请稍后再试', 'err');
          return;
        }
        showMsg('已收到你的留言，我们会尽快回复，谢谢！', 'ok');
        form.reset();
      })
      .catch(function () {
        showMsg('网络异常，请稍后再试', 'err');
      })
      .then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = old;
      });
  });

  function showMsg(text, type) {
    msg.textContent = text;
    msg.className = 'form-msg ' + type;
  }
})();
