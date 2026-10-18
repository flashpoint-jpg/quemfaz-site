/* QuemFaz — Devolução por erro, na tela "Receita" do painel (rota /admin/pagamentos).
   O administrador procura o desbloqueio (código do pedido, nome ou WhatsApp do cliente, ou nome do
   profissional), escolhe o motivo e confirma. O banco (qf_admin_devolver_desbloqueio, só administrador)
   devolve o valor para a carteira do profissional e grava um "estorno" ligado ao pedido — que o painel
   já desconta da Entrada. Nada é calculado aqui: a tela só mostra o que o banco devolve. */
(function (global) {
  'use strict';

  var MOTIVOS = [
    ['erro_cadastro_cliente', 'O cliente cadastrou o pedido errado'],
    ['telefone_invalido', 'Telefone do cliente inválido'],
    ['pedido_duplicado', 'Pedido duplicado'],
    ['outro_admin', 'Outro motivo (explique abaixo)']
  ];
  var ROTULOS = {
    erro_cadastro_cliente: 'Cliente cadastrou errado',
    telefone_invalido: 'Telefone inválido',
    pedido_duplicado: 'Pedido duplicado',
    outro_admin: 'Outro motivo',
    cliente_cancelou: 'Cliente cancelou (automático)',
    chamado_expirou: 'Pedido expirou (automático)',
    cliente_nao_respondeu: 'Cliente não respondeu (automático)'
  };

  function esc(s) { return global.PU.escapeHtml(String(s == null ? '' : s)); }
  function brl(c) { return global.PU.formatCurrency(Number(c || 0)); }
  function rotuloMotivo(m) { return ROTULOS[m] || String(m || '—'); }

  // Cartão de um resultado da busca. O botão só existe quando o banco diz que dá para devolver.
  function cartaoResultado(it, i) {
    var local = [it.cidade, it.uf].filter(Boolean).join('/');
    var valor = it.origem === 'plano' ? '1 chamado do plano' : brl(it.valor_centavos);
    var acao = it.devolvivel
      ? '<button type="button" class="btn btn--primary btn--sm" data-dev-abrir="' + i + '">Devolver ' + esc(it.origem === 'plano' ? '1 chamado' : brl(it.valor_centavos)) + '</button>'
      : '<span class="text--sm text--secondary">' + esc(it.motivo_bloqueio || 'Não é possível devolver') + '</span>';
    return '<div class="card card--tight stack--sm">' +
      '<div class="row-between"><strong>' + esc(it.titulo || 'Pedido') + (local ? ' · ' + esc(local) : '') + '</strong>' +
        '<span class="text--sm text--secondary">cód. ' + esc(it.codigo) + '</span></div>' +
      '<div class="text--sm">Cliente: <b>' + esc(it.cliente_nome || '—') + '</b>' + (it.cliente_whatsapp ? ' · ' + esc(it.cliente_whatsapp) : '') + '</div>' +
      '<div class="text--sm">Profissional: <b>' + esc(it.profissional_nome || '—') + '</b> · desbloqueou por <b>' + esc(valor) + '</b> em ' + esc(global.PU.formatDateTime(it.criado_em)) + '</div>' +
      '<div>' + acao + '</div></div>';
  }

  function linhaHistorico(it) {
    var quem = it.manual ? 'feita por você' : 'automática';
    return '<div class="card card--tight stack--sm">' +
      '<div class="row-between"><strong>' + esc(it.origem === 'plano' ? '1 chamado devolvido ao plano' : brl(it.valor_centavos)) + '</strong>' +
        '<span class="text--sm text--secondary">' + esc(global.PU.formatDateTime(it.criado_em)) + '</span></div>' +
      '<div class="text--sm">' + esc(it.titulo || 'Pedido') + ' · cód. ' + esc(it.codigo) + ' · cliente ' + esc(it.cliente_nome || '—') + ' · profissional ' + esc(it.profissional_nome || '—') + '</div>' +
      '<div class="text--sm text--secondary">' + esc(rotuloMotivo(it.motivo)) + (it.detalhe ? ' — ' + esc(it.detalhe) : '') + ' · ' + esc(quem) + '</div></div>';
  }

  function montar(content, cloud) {
    var PU = global.PU, client = cloud.client;
    var box = document.createElement('section');
    box.className = 'section';
    box.setAttribute('data-devolucao', '');
    box.innerHTML =
      '<div class="section-head"><h2 class="h3">Devolução por erro</h2></div>' +
      '<div class="card stack">' +
        '<p class="text--sm text--secondary" style="margin:0;">Procure pelo código do pedido, nome ou WhatsApp do cliente, ou nome do profissional. ' +
        'O valor volta para a carteira do profissional e sai da receita.</p>' +
        '<label class="field"><span class="field__label">Código, nome ou WhatsApp</span>' +
        '<input class="input" type="search" autocomplete="off" inputmode="search" data-dev-busca placeholder="Ex.: 26628CE0, Patrick ou 79 99894-3362"></label>' +
        '<div class="stack--sm" data-dev-resultados aria-live="polite"></div>' +
      '</div>' +
      '<div class="section-head" style="margin-top:16px;"><h3 class="h3">Devoluções feitas</h3></div>' +
      '<div class="stack--sm" data-dev-historico><p class="text--sm text--secondary">Carregando…</p></div>';
    content.insertBefore(box, content.firstChild);

    var campo = box.querySelector('[data-dev-busca]');
    var areaRes = box.querySelector('[data-dev-resultados]');
    var areaHist = box.querySelector('[data-dev-historico]');
    var itens = [], seq = 0, timer = null;

    function carregarHistorico() {
      client.rpc('qf_admin_devolucoes_lista', { p_limite: 30 }).then(function (r) {
        if (!box.isConnected) return;
        if (r.error || !r.data || !r.data.ok) throw new Error('indisponivel');
        var d = r.data;
        var topo = '<div class="card card--tight"><div class="row-between"><span>Devolvido hoje</span><strong>' + esc(brl(d.hoje_centavos)) + '</strong></div>' +
          '<div class="row-between"><span>Devolvido no total</span><strong>' + esc(brl(d.total_centavos)) + '</strong></div>' +
          '<p class="text--sm text--secondary" style="margin:6px 0 0;">Estes valores já foram descontados da Entrada. Só conta dinheiro que voltou para a carteira; devolução pelo plano devolve 1 chamado.</p></div>';
        areaHist.innerHTML = topo + ((d.itens || []).length ? d.itens.map(linhaHistorico).join('') : '<p class="text--sm text--secondary">Nenhuma devolução ainda.</p>');
      }).catch(function () { if (box.isConnected) areaHist.innerHTML = '<p class="text--sm text--secondary">Histórico indisponível. Atualize o painel para tentar de novo.</p>'; });
    }

    function buscar() {
      var q = campo.value.trim(), meu = ++seq;
      if (q.length < 2) { itens = []; areaRes.innerHTML = ''; return; }
      areaRes.innerHTML = '<p class="text--sm text--secondary">Procurando…</p>';
      client.rpc('qf_admin_buscar_desbloqueios', { p_busca: q, p_limite: 20 }).then(function (r) {
        if (meu !== seq || !box.isConnected) return;
        if (r.error || !r.data || !r.data.ok) throw new Error((r.data && r.data.reason) || 'indisponivel');
        itens = r.data.itens || [];
        areaRes.innerHTML = itens.length ? itens.map(cartaoResultado).join('') : '<p class="text--sm text--secondary">Nenhum desbloqueio encontrado.</p>';
      }).catch(function () { if (meu === seq && box.isConnected) areaRes.innerHTML = '<p class="text--sm" style="color:var(--danger-600);">Não foi possível buscar agora. Tente de novo.</p>'; });
    }

    campo.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(buscar, 350); });

    areaRes.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest && ev.target.closest('[data-dev-abrir]');
      if (!b) return;
      var it = itens[Number(b.getAttribute('data-dev-abrir'))];
      if (it && it.devolvivel) abrirFormulario(it);
    });

    function abrirFormulario(it) {
      var plano = it.origem === 'plano';
      PU.openSheet(
        '<form class="stack" data-dev-form novalidate>' +
          '<h3 class="sheet__title">Devolver ' + esc(plano ? '1 chamado ao plano' : brl(it.valor_centavos)) + '</h3>' +
          '<p class="text--sm text--secondary" style="margin:0;">' + esc(it.titulo || 'Pedido') + ' · cód. ' + esc(it.codigo) + '<br>Cliente: ' + esc(it.cliente_nome || '—') + '<br>Profissional: ' + esc(it.profissional_nome || '—') + '</p>' +
          '<fieldset class="stack--sm" style="border:0;padding:0;margin:0;"><legend class="field__label">Motivo</legend>' +
            MOTIVOS.map(function (m, i) {
              return '<label class="card row" style="cursor:pointer;gap:10px;"><input type="radio" name="motivo" value="' + esc(m[0]) + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(m[1]) + '</span></label>';
            }).join('') +
          '</fieldset>' +
          '<label class="field"><span class="field__label">Detalhe (opcional, obrigatório em “outro motivo”)</span>' +
            '<textarea class="textarea" name="detalhe" maxlength="300" placeholder="Ex.: cliente digitou o bairro errado"></textarea></label>' +
          '<p class="text--sm text--secondary" style="margin:0;">' + (plano
            ? '1 chamado volta para o plano do profissional. Não mexe na receita.'
            : 'O valor volta para a carteira do profissional e sai da receita de hoje. A vaga do pedido volta a ficar livre — se o pedido estiver errado, cancele-o pelo painel.') + '</p>' +
          '<div class="btn-row"><button type="button" class="btn btn--outline" data-dev-cancelar>Cancelar</button>' +
          '<button type="submit" class="btn btn--primary" data-dev-confirmar>Confirmar devolução</button></div>' +
        '</form>', { persistent: true });
      var form = document.querySelector('[data-dev-form]');
      form.querySelector('[data-dev-cancelar]').onclick = function () { PU.closeSheet(); };
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var motivo = (form.querySelector('input[name="motivo"]:checked') || {}).value;
        var detalhe = form.detalhe.value.trim();
        if (motivo === 'outro_admin' && detalhe.length < 3) { PU.toast('Explique o motivo da devolução.', 'danger'); return; }
        var btn = form.querySelector('[data-dev-confirmar]');
        btn.disabled = true; btn.textContent = 'Devolvendo…';
        client.rpc('qf_admin_devolver_desbloqueio', { p_desbloqueio_id: it.desbloqueio_id, p_motivo: motivo, p_detalhe: detalhe || null }).then(function (r) {
          if (r.error) throw r.error;
          if (!r.data || !r.data.ok) throw new Error((r.data && r.data.reason) || 'Não foi possível devolver.');
          PU.closeSheet();
          PU.toast(r.data.origem === 'plano' ? '1 chamado devolvido ao plano.' : brl(r.data.valor_centavos) + ' devolvidos. A receita foi atualizada.', 'success');
          var sync = cloud.syncSnapshot ? cloud.syncSnapshot(true) : Promise.resolve();
          return Promise.resolve(sync).catch(function () {}).then(function () { if (global.navigate) global.navigate('/admin/pagamentos', true); });
        }).catch(function (err) {
          PU.toast((err && err.message) || 'Não foi possível devolver.', 'danger');
          btn.disabled = false; btn.textContent = 'Confirmar devolução';
        });
      });
    }

    carregarHistorico();
  }

  var previous = global.Screens && global.Screens.afterRender;
  if (global.Screens) {
    global.Screens.afterRender = function (pattern, content, params, user) {
      if (previous) previous(pattern, content, params, user);
      if (pattern !== '/admin/pagamentos') return;
      var cloud = global.QFAdminCloud;
      if (!cloud || !cloud.enabled || !cloud.client) return;
      montar(content, cloud);
    };
  }
  global.QFAdminDevolucao = { rotuloMotivo: rotuloMotivo, cartaoResultado: cartaoResultado, linhaHistorico: linhaHistorico };
})(window);
