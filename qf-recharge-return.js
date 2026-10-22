/* Preserve the opportunity across payment without reserving a place or charging again. */
(function (global) {
  'use strict';
  var KEY = 'qf_recharge_return_v1';
  function remember(callId, userId) {
    try { localStorage.setItem(KEY, JSON.stringify({ callId: callId, userId: userId, at: Date.now() })); } catch (_) {}
  }
  function pending(userId) {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!d || d.userId !== userId || Date.now() - d.at > 86400000 || !/^[0-9a-f-]{36}$/i.test(d.callId)) return null;
      return d;
    } catch (_) { return null; }
  }
  async function resume(userId) {
    var d = pending(userId), cloud = global.QFCloud;
    if (!d || !cloud || !cloud.enabled) return { ok: false, reason: 'sem_pedido' };
    await cloud.syncForCurrentSession(true);
    var r = await cloud.client.rpc('qf_listar_chamados_disponiveis');
    if (r.error) throw r.error;
    if (!(r.data || []).some(function (c) { return c.id === d.callId; })) return { ok: false, reason: 'indisponivel' };
    global.navigate('/profissional/chamada/' + d.callId, true);
    return { ok: true };
  }
  function place() {
    if (!/^#\/profissional\/carteira(?:$|[/?])/.test(location.hash || '')) return;
    var db = global.DB, sess = db && db.getSession(), userId = sess && sess.id;
    // Session records use userId in older clients; accept both without crossing accounts.
    userId = userId || (sess && sess.userId);
    var d = userId && pending(userId), host = document.getElementById('app-content');
    if (!d || !host || host.querySelector('[data-qf-recharge-return]')) return;
    var section = host.querySelector('.view .section');
    if (!section) return;
    var box = document.createElement('div');
    box.className = 'card'; box.setAttribute('data-qf-recharge-return', '');
    box.innerHTML = '<h3 class="h3">Continue no pedido que você escolheu</h3>' +
      '<p class="text--sm text--secondary">Após a confirmação do pagamento, volte para conferir o saldo e as vagas. A recarga não reserva o pedido.</p>' +
      '<button type="button" class="btn btn--primary">Voltar ao pedido</button>' +
      '<p class="text--sm text--secondary" role="status"></p>';
    section.appendChild(box);
    var button = box.querySelector('button'), status = box.querySelector('[role="status"]');
    button.onclick = async function () {
      button.disabled = true;
      try {
        var r = await resume(userId);
        if (!r.ok) status.textContent = 'Este pedido não está disponível para você agora. Confira os outros serviços disponíveis.';
      } catch (_) { status.textContent = 'Não foi possível conferir o pedido. Tente novamente.'; }
      finally { button.disabled = false; }
    };
  }
  global.QFRechargeReturn = { remember: remember, pending: pending, resume: resume };
  if (typeof MutationObserver !== 'undefined') {
    var queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true; global.setTimeout(function () { queued = false; place(); }, 50);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  global.addEventListener('hashchange', place);
  global.addEventListener('DOMContentLoaded', place);
})(window);
