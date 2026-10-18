/* QuemFaz — "Quem recebeu e por quê": detalhe do envio de push de um pedido, no painel.
   Qualquer botão com data-push-diag="<id do pedido>" abre o detalhe. Os dados vêm de
   qf_admin_push_diagnostico (só administrador, somente leitura): lista os profissionais da profissão do
   pedido e, para cada um, se recebeu, falhou, não tem notificação ativada ou por que ficou de fora
   (offline, fora do horário, fora do raio, etc.). A tela não envia nada. */
(function (global) {
  'use strict';

  var ROTULOS = {
    recebeu: 'Envio aceito pelo serviço de push',
    falhou: 'Falha no envio',
    sem_token: 'Sem notificação ativada',
    pendente: 'Elegível, aguardando envio',
    sem_confirmacao: 'Histórico antigo, sem confirmação',
    ja_desbloqueou: 'Já desbloqueou o pedido',
    offline: 'Offline',
    fora_do_horario: 'Fora do horário de atendimento',
    fora_do_raio: 'Fora do raio / região de atendimento',
    pendencia_finalizacao: 'Com pendência de finalização',
    perfil_inativo: 'Perfil inativo',
    sem_vagas: 'Vagas do pedido preenchidas'
  };
  var ELEGIVEIS = ['recebeu', 'falhou', 'sem_token', 'pendente', 'sem_confirmacao', 'ja_desbloqueou'];
  var ERROS = {
    subscription_expired: 'aparelho desconectado (token expirado)',
    fcm_send_failed: 'o Firebase recusou o envio',
    fcm_network_error: 'falha de rede no envio',
    fcm_not_configured: 'push do app não configurado',
    vapid_not_configured: 'push web não configurado'
  };

  function esc(s) { return global.PU.escapeHtml(String(s == null ? '' : s)); }
  function rotulo(s) { return ROTULOS[s] || String(s || '—'); }
  function erroTxt(e) { return ERROS[e] || (/^web_push_/.test(String(e || '')) ? 'o navegador recusou o envio (' + String(e).replace('web_push_', '') + ')' : String(e || '')); }
  function km(v) { return v == null ? '' : String(v).replace('.', ',') + ' km'; }

  function linha(it) {
    var extra = [];
    if (it.km != null) extra.push(km(it.km));
    if (it.situacao === 'falhou' && it.erro) extra.push(erroTxt(it.erro));
    if (it.situacao === 'sem_token') extra.push('não consegue receber até ativar no celular');
    return '<div class="row-between" style="gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border,#e5e7eb);">' +
      '<span><b>' + esc(it.nome) + '</b>' + (extra.length ? '<small class="text--secondary" style="display:block;">' + esc(extra.join(' · ')) + '</small>' : '') + '</span>' +
      '<span class="text--sm" style="text-align:right;">' + esc(rotulo(it.situacao)) + '</span></div>';
  }

  function render(d) {
    var p = d.pedido || {}, r = d.resumo || {}, por = r.por_situacao || {};
    var itens = d.itens || [];
    var elegiveis = itens.filter(function (i) { return ELEGIVEIS.indexOf(i.situacao) !== -1; });
    var excluidos = itens.filter(function (i) { return ELEGIVEIS.indexOf(i.situacao) === -1; });
    var resumo = Object.keys(por).sort(function (a, b) { return por[b] - por[a]; }).map(function (k) {
      return '<div class="row-between"><span>' + esc(rotulo(k)) + '</span><strong>' + Number(por[k]) + '</strong></div>';
    }).join('');
    return '<div class="stack">' +
      '<h3 class="sheet__title">Quem recebeu e por quê</h3>' +
      '<p class="text--sm text--secondary" style="margin:0;">' + esc(p.titulo || 'Pedido') + ' · ' + esc([p.cidade, p.uf].filter(Boolean).join('/')) +
        ' · cód. ' + esc(String(p.id || '').slice(0, 8).toUpperCase()) + ' · ' + Number(p.ocupadas || 0) + ' de ' + Number(p.limite || 0) + ' vagas ocupadas</p>' +
      '<div class="card card--tight"><div class="row-between"><span>Profissionais da profissão</span><strong>' + Number(r.total_categoria || 0) + '</strong></div>' +
        '<div class="row-between"><span>Elegíveis agora</span><strong>' + Number(r.elegiveis_agora || 0) + '</strong></div>' + resumo + '</div>' +
      '<h4 class="h3" style="margin:4px 0 0;">Elegíveis e envio (' + elegiveis.length + ')</h4>' +
      (elegiveis.length ? elegiveis.map(linha).join('') : '<p class="text--sm text--secondary">Nenhum.</p>') +
      '<h4 class="h3" style="margin:12px 0 0;">Ficaram de fora (' + excluidos.length + ')</h4>' +
      (excluidos.length ? excluidos.map(linha).join('') : '<p class="text--sm text--secondary">Nenhum.</p>') +
      '<p class="text--sm text--secondary" style="margin:8px 0 0;">“Envio aceito” significa que o serviço de push recebeu a mensagem; não comprova que apareceu no celular. ' +
      'Quem está “sem notificação ativada” só passa a receber depois de abrir o app e ativar. Esta tela não envia nada.</p>' +
      '<button type="button" class="btn btn--outline" data-push-diag-fechar>Fechar</button></div>';
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('[data-push-diag]');
    if (!b) return;
    ev.preventDefault();
    var PU = global.PU, cloud = global.QFAdminCloud;
    if (!cloud || !cloud.enabled || !cloud.client) { PU.toast('Entre no painel para ver o detalhe do envio.', 'danger'); return; }
    var id = b.getAttribute('data-push-diag');
    PU.openSheet('<div class="stack"><p class="text--sm text--secondary">Carregando…</p></div>');
    cloud.client.rpc('qf_admin_push_diagnostico', { p_chamado_id: id }).then(function (r) {
      if (r.error || !r.data || !r.data.ok) throw new Error((r.data && r.data.reason) || 'indisponivel');
      PU.openSheet(render(r.data));
      var fechar = document.querySelector('[data-push-diag-fechar]');
      if (fechar) fechar.onclick = function () { PU.closeSheet(); };
    }).catch(function () {
      PU.openSheet('<div class="stack"><p class="text--sm" style="color:var(--danger-600);">Não foi possível carregar o detalhe agora. Tente de novo.</p></div>');
    });
  });

  global.QFAdminPushDiagnostico = { render: render, rotulo: rotulo, erroTxt: erroTxt };
})(window);
