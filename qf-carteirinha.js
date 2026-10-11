/* Quem Faz — carteirinha de avaliação. Não modifica o fluxo de pedidos. */
(function (global) {
  'use strict';
  function usuario() {
    try {
      var sess = global.DB && global.DB.getSession && global.DB.getSession();
      if (!sess || sess.role !== 'profissional' || !/^[0-9a-f-]{36}$/i.test(String(sess.userId || ''))) return null;
      return sess.userId;
    } catch (_) { return null; }
  }
  function render() {
    var shell = document.getElementById('app-shell');
    if (!shell || shell.getAttribute('data-route') !== 'profissional-home') return;
    var id = usuario();
    var status = shell.querySelector('.qf-prof-status');
    if (!id || !status || shell.querySelector('[data-qf-carteirinha-home]')) return;
    var card = document.createElement('section');
    card.className = 'card qf-carteirinha-home';
    card.setAttribute('data-qf-carteirinha-home', '');
    var page = '/carteirinha.html?prof=' + encodeURIComponent(id);
    card.innerHTML =
      '<div class="qf-carteirinha-home__top">' +
        '<span class="qf-carteirinha-home__icon" aria-hidden="true">▣</span>' +
        '<div><h2>Ganhe pontos com avaliações</h2><p>Imprima sua carteirinha e peça ao cliente para avaliar seu atendimento pelo QR Code.</p></div>' +
      '</div>' +
      '<a class="btn btn--primary qf-carteirinha-home__btn" href="' + page + '&imprimir=1" target="_blank" rel="noopener">Imprimir minha carteirinha</a>' +
      '<a class="qf-carteirinha-home__view" href="' + page + '" target="_blank" rel="noopener">Ver carteirinha</a>';
    status.insertAdjacentElement('afterend', card);
  }
  var css = document.createElement('style');
  css.textContent =
    '.qf-carteirinha-home{padding:18px!important;border-left:4px solid #ff790a!important}' +
    '.qf-carteirinha-home__top{display:flex;align-items:flex-start;gap:13px}' +
    '.qf-carteirinha-home__icon{flex:0 0 44px;width:44px;height:44px;border:2px solid #ff790a;border-radius:12px;display:grid;place-items:center;color:#fa7400;font-size:29px;font-weight:bold}' +
    '.qf-carteirinha-home h2{font-size:18px;line-height:1.3;color:#102a52;margin:0 0 5px;font-weight:800}' +
    '.qf-carteirinha-home p{font-size:14px;line-height:1.48;color:#48566b;margin:0}' +
    '.qf-carteirinha-home__btn{display:flex;justify-content:center;margin-top:15px;width:100%;background:#ff790a!important;color:#101d38!important;font-weight:800}' +
    '.qf-carteirinha-home__view{display:block;text-align:center;font-size:14px;color:#102a52;font-weight:700;text-decoration:underline;margin-top:14px}';
  document.head.appendChild(css);
  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    global.requestAnimationFrame(function () { queued = false; render(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  else schedule();
  global.addEventListener('hashchange', schedule);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
})(window);
