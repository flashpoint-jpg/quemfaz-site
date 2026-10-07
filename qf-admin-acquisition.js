/* Medição da captação, visível somente ao administrador autorizado no banco. */
(function (global) {
  var previous = global.Screens.afterRender;
  global.Screens.afterRender = function (pattern, content, params, user) {
    if (previous) previous(pattern, content, params, user);
    if (pattern !== '/admin/dashboard' || !global.QFAdminCloud || !global.QFAdminCloud.client) return;
    var box = document.createElement('section');
    box.className = 'section';
    box.innerHTML = '<h2 class="h3">Captação de clientes · últimos 7 dias</h2><div class="card" data-qf-funnel-report>Carregando etapas dos pedidos…</div>';
    var target = content.querySelector('#admin-fechamento');
    if (target) target.insertAdjacentElement('afterend', box); else content.appendChild(box);
    var report = box.querySelector('[data-qf-funnel-report]');
    global.QFAdminCloud.client.rpc('qf_client_funnel_summary', { p_days: 7 }).then(function (r) {
      if (r.error) throw r.error;
      var d = r.data || {}, counts = d.steps || {};
      var labels = { landing: 'Visitas medidas', form_view: 'Abriu o formulário', form_start: 'Começou a preencher', submit: 'Tentou publicar', published: 'Pedidos confirmados' };
      var esc = global.PU.escapeHtml;
      report.innerHTML = '<p class="text--sm text--secondary">Medição iniciada em 06/10/2026. Visitas e etapas contam sessões; pedidos contam IDs únicos. Bloqueadores podem impedir a medição.</p>' +
        '<div class="stack--sm" style="margin-top:12px;">' + Object.keys(labels).map(function (key) {
          return '<div class="row-between"><span>' + labels[key] + '</span><strong>' + Number(counts[key] || 0) + '</strong></div>';
        }).join('') + '</div><hr class="hairline"><h3 class="h3">Pedidos por origem</h3>' +
        (d.sources || []).map(function (s) { return '<div class="row-between"><span>' + esc(s.source || 'Sem origem identificada') + '</span><strong>' + Number(s.requests || 0) + '</strong></div>'; }).join('') +
        '<hr class="hairline"><h3 class="h3">Último campo acessado · sem pedido confirmado</h3>' +
        '<p class="text--sm text--secondary">Sessões sem publicação e sem atividade há pelo menos 30 minutos. Indica onde pararam, não o motivo. Medição de campos iniciada em 07/10/2026.</p>' +
        ((d.last_fields || []).length ? d.last_fields.map(function (f) {
          var names = {servico:'Serviço',descricao:'Descrição',prazo:'Prazo',periodo:'Período',prazoDia:'Data',cidade:'Cidade',uf:'Estado',bairro:'Bairro',telefone:'WhatsApp',nome:'Nome'};
          return '<div class="row-between"><span>' + esc(names[f.field] || 'Outro campo') + '</span><strong>' + Number(f.sessions || 0) + '</strong></div>';
        }).join('') : '<p class="text--sm text--secondary">Ainda não há sessões encerradas com essa medição.</p>') +
        '<hr class="hairline"><h3 class="h3">Falhas registradas</h3>' +
        ((d.errors || []).length ? d.errors.map(function (e) { return '<div class="row-between"><span>' + esc(e.event + ' · ' + (e.code || 'sem código')) + '</span><strong>' + Number(e.total || 0) + '</strong></div>'; }).join('') : '<p class="text--sm text--secondary">Nenhuma falha registrada neste período.</p>');
    }).catch(function () { report.textContent = 'Não foi possível carregar as etapas agora. Atualize o painel para tentar novamente.'; });
  };
})(window);
