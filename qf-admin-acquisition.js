/* Quem Faz 11.36 — relatórios de captação: histórico separado dos pedidos existentes. */
(function (global) {
  'use strict';
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
    var client = global.QFAdminCloud.client;
    var since = new Date(Date.now() - 7 * 86400000).toISOString();
    var summary = client.rpc('qf_client_funnel_summary', { p_days: 7 });
    // A leitura direta aplica as permissões de cliente/profissional e pode
    // retornar [] ao administrador. O snapshot verifica a função administrativa.
    var existing = client.rpc('qf_admin_snapshot');
    Promise.all([summary, existing]).then(function (responses) {
      if (!report.isConnected) return;
      var r = responses[0], live = responses[1];
      if (r.error) throw r.error;
      var d = r.data || {}, counts = d.steps || {};
      var labels = {
        landing: 'Visitas medidas', home_cta: 'Tocou em "Pedir grátis" (tela inicial)',
        home_focus: 'Tocou no campo da tela inicial', home_type: 'Digitou na tela inicial',
        home_submit: 'Enviou da tela inicial', form_view: 'Abriu o formulário',
        form_start: 'Começou a preencher', submit: 'Tentou publicar',
        published: 'Pedidos publicados · histórico'
      };
      var esc = global.PU.escapeHtml;
      var callList = live && !live.error && live.data && Array.isArray(live.data.chamados)
        ? live.data.chamados.filter(function (call) { return Date.parse(call.criado_em) >= Date.parse(since); }) : null;
      var liveTotal = callList ? callList.length : null;
      var names = {
        servico: 'Serviço', descricao: 'Descrição', prazo: 'Prazo', periodo: 'Período',
        prazoDia: 'Data', cidade: 'Cidade', uf: 'Estado', bairro: 'Bairro',
        telefone: 'WhatsApp', nome: 'Nome'
      };
      var codes = {
        region: 'Cidade / estado', description: 'Descrição',
        phone: 'WhatsApp', neighborhood: 'Bairro', service: 'Serviço',
        name: 'Nome', quick_access: 'Acesso rápido'
      };
      var origins = {
        google: 'Google', meta: 'Meta (Facebook / Instagram)', fb: 'Facebook',
        ig: 'Instagram', google_referral: 'Google · referência não classificada',
        meta_referral: 'Meta · referência não classificada',
        bing_referral: 'Bing · referência não classificada'
      };
      var html = '<p class="text--sm text--secondary">Etapas medidas desde 06/10/2026. Visitas e etapas contam sessões; publicações contam IDs únicos. Nem todos os acessos podem ser medidos.</p>' +
        '<div class="stack--sm" style="margin-top:12px;">' + Object.keys(labels).map(function (key) {
          return '<div class="row-between"><span>' + labels[key] + '</span><strong>' + Number(counts[key] || 0) + '</strong></div>';
        }).join('') + '</div>' +
        '<p class="text--sm text--secondary" style="margin-top:8px;">Publicações do histórico continuam contabilizadas mesmo quando um pedido é excluído posteriormente.</p>' +
        '<hr class="hairline"><h3 class="h3">Pedidos existentes no banco</h3>';
      if (liveTotal !== null) {
        html += '<div class="row-between"><span>Criados nos últimos 7 dias e ainda na base</span><strong>' + liveTotal + '</strong></div>';
        if (callList.length) {
          var statuses = {};
          callList.forEach(function (x) { var name = x.status || 'sem_status'; statuses[name] = (statuses[name] || 0) + 1; });
          html += Object.keys(statuses).sort().map(function (key) {
            var pt = {
              aberto: 'Aberto', buscando: 'Buscando profissional',
              em_negociacao: 'Em negociação', concluido: 'Concluído',
              cancelado: 'Cancelado', expirado: 'Expirado'
            };
            return '<div class="row-between text--sm"><span>' + esc(pt[key] || key.replace(/_/g, ' ')) + '</span><strong>' + statuses[key] + '</strong></div>';
          }).join('');
        }
        html += '<p class="text--sm text--secondary" style="margin-top:8px;">Esta contagem mostra os pedidos que existem hoje, não as publicações históricas. As duas métricas não são equivalentes.</p>';
      } else {
        html += '<p class="text--sm text--secondary">Contagem atual indisponível; consulte a Central de Pedidos. O histórico acima continua válido.</p>';
      }
      html += '<hr class="hairline"><h3 class="h3">Publicações por origem</h3>' +
        ((d.sources || []).length ? (d.sources || []).map(function (s) {
          return '<div class="row-between"><span>' + esc(origins[s.source] || s.source || 'Origem não identificada') + '</span><strong>' + Number(s.requests || 0) + '</strong></div>';
        }).join('') : '<p class="text--sm text--secondary">Nenhuma publicação medida.</p>') +
        '<p class="text--sm text--secondary" style="margin-top:8px;">Origem não identificada não significa necessariamente acesso direto. Sem identificador de campanha ou referência, a origem não pode ser comprovada.</p>' +
        '<hr class="hairline"><h3 class="h3">Último campo acessado · sem pedido publicado</h3>' +
        '<p class="text--sm text--secondary">Sessões sem publicação e sem atividade há pelo menos 30 minutos. Mostra onde pararam, não a causa. Medição de campos iniciada em 07/10/2026.</p>' +
        ((d.last_fields || []).length ? d.last_fields.map(function (f) {
          return '<div class="row-between"><span>' + esc(names[f.field] || 'Outro campo') + '</span><strong>' + Number(f.sessions || 0) + '</strong></div>';
        }).join('') : '<p class="text--sm text--secondary">Ainda não há sessões encerradas com essa medição.</p>') +
        '<hr class="hairline"><h3 class="h3">Falhas registradas</h3>' +
        '<p class="text--sm text--secondary">Quantidade de tentativas com erro, não de pessoas. A mesma sessão pode registrar mais de uma falha; o histórico não zera após uma correção.</p>' +
        ((d.errors || []).length ? d.errors.map(function (e) {
          var label = e.event === 'validation_error' ? 'Validação · ' + (codes[e.code] || e.code || 'sem código') :
            (e.event || 'Erro') + ' · ' + (codes[e.code] || e.code || 'sem código');
          return '<div class="row-between"><span>' + esc(label) + '</span><strong>' + Number(e.total || 0) + '</strong></div>';
        }).join('') : '<p class="text--sm text--secondary">Nenhuma falha registrada neste período.</p>');
      report.innerHTML = html;
    }).catch(function () {
      if (report.isConnected) report.textContent = 'Não foi possível carregar as etapas agora. Atualize o painel para tentar novamente.';
    });
  };
})(window);
