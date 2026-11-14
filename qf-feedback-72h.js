/* Controle manual do pedido pelo cliente; sem prazo para cancelamento automático. */
(function (g) {
  'use strict';
  const ACTIVE = new Set(['aberto', 'buscando', 'em_negociacao', 'aguardando_aceite', 'aguardando_orcamento', 'orcamento_enviado', 'orcamento_recusado', 'aprovado', 'em_andamento', 'sem_profissional']);
  const CHOICES = { ainda_preciso: 'Ainda preciso', ja_contratei: 'Já contratei', nao_preciso: 'Não preciso mais' };
  function eligible(order) {
    return Boolean(order.id && ACTIVE.has(order.status));
  }
  async function mount(container, orders, ownerId) {
    const cloud = g.QFCloud?.client;
    if (!cloud || !ownerId || !container?.isConnected) return;
    const eligibleOrders = (orders || []).filter(eligible);
    if (!eligibleOrders.length) return;
    // A consulta usa a sessão autenticada e as políticas RLS do banco.
    const result = await cloud.from('qf_pedido_feedback_72h').select('chamado_id,resposta').eq('cliente_id', ownerId).in('chamado_id', eligibleOrders.map(o => o.id));
    if (result.error || !container.isConnected) return;
    const answered = new Map((result.data || []).map(x => [x.chamado_id, x.resposta]));
    eligibleOrders.forEach(function (order) {
      const button = Array.from(container.querySelectorAll('[data-home-order],[data-qf-pedido-card]')).find(el => (el.dataset.homeOrder || el.dataset.qfPedidoCard) === order.id);
      if (!button) return;
      const card = g.document.createElement('section');
      card.className = 'qf-feedback-72h';
      card.setAttribute('aria-label', 'Atualizar situação do pedido');
      card.innerHTML = '<strong>Você ainda precisa desse serviço?</strong><p>Você decide quando não precisa mais. A resposta não confirma conclusão nem movimenta pagamentos.</p><div class="qf-feedback-72h__actions">' + Object.entries(CHOICES).map(([key, label]) => '<button type="button" data-qf-feedback="' + key + '">' + label + '</button>').join('') + '</div><p class="qf-feedback-72h__status" role="status" aria-live="polite">' + (answered.has(order.id) ? 'Resposta atual: ' + CHOICES[answered.get(order.id)] + '.' : '') + '</p>';
      button.insertAdjacentElement('afterend', card);
      card.addEventListener('click', async function (event) {
        const choice = event.target.closest('[data-qf-feedback]');
        if (!choice) return;
        const response = choice.dataset.qfFeedback;
        if (!Object.hasOwn(CHOICES, response)) return;
        if (response === 'nao_preciso' && !g.confirm('Cancelar este pedido? Os profissionais serão informados; o histórico de negociações e pagamentos será preservado.')) return;
        const buttons = card.querySelectorAll('button');
        buttons.forEach(b => { b.disabled = true; });
        const status = card.querySelector('[role=status]');
        status.textContent = 'Salvando sua resposta…';
        try {
          const result = await cloud.rpc('qf_cliente_atualizar_necessidade', { p_chamado_id: order.id, p_resposta: response });
          if (result.error || !result.data?.ok) throw result.error || Error(result.data?.reason || 'Não foi possível atualizar.');
          if (response === 'nao_preciso') {
            card.innerHTML = '<strong>Pedido cancelado a seu pedido.</strong><p>O histórico de negociações e pagamentos foi preservado.</p>';
            g.QFPush?.notify?.('call_cancelled', order.id)?.catch?.(() => {});
            if (g.QFCloud?.syncForCurrentSession) await g.QFCloud.syncForCurrentSession(true).catch(() => {});
          } else {
            status.textContent = 'Resposta registrada: ' + CHOICES[response] + '. Você pode alterar sua resposta quando quiser.';
            buttons.forEach(b => { b.disabled = false; });
          }
        } catch (_) {
          status.textContent = 'Não foi possível salvar. Tente novamente.';
          buttons.forEach(b => { b.disabled = false; });
        }
      });
    });
  }
  g.QFFeedback72 = { mount, eligible };
  const css = g.document.createElement('style');
  css.textContent = '.qf-feedback-72h{margin:10px 0 16px;padding:16px;border:1px solid #aac9ec;border-radius:14px;background:#f1f7ff;color:#163c6b;display:grid;gap:9px}.qf-feedback-72h strong{font-size:17px}.qf-feedback-72h p{margin:0;font-size:14px;line-height:1.45}.qf-feedback-72h__actions{display:flex;flex-wrap:wrap;gap:8px}.qf-feedback-72h__actions button{border:1px solid #1465c2;border-radius:10px;background:white;color:#1359a0;font-family:inherit;font-size:14px;font-weight:700;padding:11px 13px;min-height:44px;cursor:pointer}.qf-feedback-72h__actions button:first-child{background:#1465c2;color:white}.qf-feedback-72h__actions button:disabled{opacity:.6;cursor:wait}@media(max-width:520px){.qf-feedback-72h__actions{display:grid;grid-template-columns:1fr}.qf-feedback-72h__actions button{width:100%;font-size:14px}}';
  g.document.head.appendChild(css);
})(window);
