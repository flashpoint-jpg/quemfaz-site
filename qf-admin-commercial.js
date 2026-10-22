(function (global) {
  'use strict';
  var previous = global.Screens.afterRender;
  global.Screens.afterRender = function (pattern, content, params, user) {
    if (previous) previous(pattern, content, params, user);
    if (pattern !== '/admin/dashboard' || !global.QFAdminCloud || !global.QFAdminCloud.client) return;
    var box = document.createElement('section'); box.className = 'section';
    box.innerHTML = '<h2 class="h3">Pedidos, desbloqueios e recargas</h2><div class="card" data-commercial-report>Carregando indicadores reais…</div>';
    content.appendChild(box);
    var report = box.querySelector('[data-commercial-report]');
    global.QFAdminCloud.client.rpc('qf_admin_funil_comercial').then(function (r) {
      if (!report.isConnected) return;
      if (r.error || !r.data || !r.data.ok) throw new Error('unavailable');
      var d = r.data, esc = global.PU.escapeHtml;
      function row(label, value) { return '<div class="row-between"><span>' + esc(label) + '</span><strong>' + Number(value || 0) + '</strong></div>'; }
      var h = '<p class="text--sm text--secondary">Pedidos abertos ou em negociação. Valores da carteira e aprovações refletem o banco neste momento.</p>';
      for (var i = 0; i <= 4; i++) h += row(i === 0 ? 'Pedidos sem desbloqueio' : 'Pedidos com ' + i + ' desbloqueio(s)', d.pedidos_ativos[i]);
      h += '<hr class="hairline">' + row('Profissionais com saldo positivo', d.carteiras.saldo_positivo) +
        row('Saldo cobre o menor preço das especialidades', d.carteiras.saldo_suficiente_minimo) +
        row('Saldo abaixo do menor preço das especialidades', d.carteiras.saldo_insuficiente_minimo) + row('Profissionais com plano disponível', d.carteiras.plano_ativo) +
        '<p class="text--sm text--secondary">O custo depende do serviço; saldo positivo não garante crédito suficiente para todo pedido. Planos são contados separadamente.</p>' +
        '<hr class="hairline">' + row('Recargas aprovadas no banco · histórico', d.recargas.aprovadas_banco) +
        '<div class="row-between"><span>Valor aprovado · histórico</span><strong>' + esc((Number(d.recargas.valor_aprovado_centavos) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })) + '</strong></div>' +
        row('Recargas pendentes', d.recargas.pendentes) + '<p class="text--sm text--secondary">' + esc(d.pagamentos_status) + '</p>';
      h += '<hr class="hairline"><h3 class="h3">Notificações · histórico</h3>';
      var labels = { enviado: 'Aceitas pelo serviço de push', falhou: 'Falhas de envio', sem_inscricao: 'Sem inscrição push', legado: 'Histórico sem confirmação', fora_horario: 'Fora do horário', reenvio_solicitado: 'Reenvio solicitado', processando: 'Em processamento' };
      Object.keys(d.notificacoes).forEach(function (k) { h += row(labels[k] || k, d.notificacoes[k]); });
      h += '<p class="text--sm text--secondary">Envio aceito não comprova exibição ou leitura no celular.</p><hr class="hairline"><h3 class="h3">Publicações por dia · últimos 7 dias</h3>';
      (d.publicacoes_dia || []).forEach(function (x) { h += row(x.dia, x.total); });
      h += '<p class="text--sm text--secondary">Pedidos publicados ainda presentes na base; exclusões posteriores podem reduzir o histórico.</p><hr class="hairline"><h3 class="h3">Pedidos e impedimentos observáveis</h3>';
      (d.pedidos || []).forEach(function (p) {
        var reason = Number(p.desbloqueios) >= Number(p.limite) ? 'Limite preenchido' :
          !Number(p.aptos_raio) ? 'Sem profissional elegível no raio' :
          !Number(p.aptos_com_credito_ou_plano) ? 'Elegíveis sem saldo suficiente ou plano' :
          !Number(p.aptos_online_horario) ? 'Sem elegível online no horário agora' :
          !Number(p.aptos_com_push) ? 'Elegíveis sem inscrição push ativa agora' : 'Há profissionais elegíveis; motivo comercial não comprovado';
        h += '<div class="card card--tight"><strong>' + esc(p.categoria.replace(/^cat_/, '').replace(/_/g, ' ')) + ' · ' + esc(p.id.slice(0, 8)) + '</strong>' +
          '<p class="text--sm">' + esc(reason) + '</p>' + row('Vagas restantes', Math.max(0, p.limite - p.desbloqueios)) +
          row('Elegíveis no raio', p.aptos_raio) + row('Online no horário', p.aptos_online_horario) +
          row('Com saldo suficiente ou plano', p.aptos_com_credito_ou_plano) + row('Envios aceitos pelo push', p.enviados) + '</div>';
      });
      h += '<hr class="hairline"><h3 class="h3">Recuperação automática</h3>';
      (d.recuperacoes || []).forEach(function (x) { h += row(x.etapa_minutos + ' min · ' + x.resultado, x.total); });
      h += '<p class="text--sm text--secondary">Custo por pedido: indisponível. ' + esc(d.google_ads_status) + '</p>';
      report.innerHTML = h;
    }).catch(function () { if (report.isConnected) report.textContent = 'Indicadores indisponíveis. Atualize o painel para tentar novamente.'; });
  };
})(window);
