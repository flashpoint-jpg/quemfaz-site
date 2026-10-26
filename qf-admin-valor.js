/* QuemFaz — painel administrativo: pedidos com valor definido, taxas/tetos, baixas, contestações e cancelamentos.
   Seção adicional no dashboard do admin. Toda ação passa por RPC que confere admin no banco. */
(function (global) {
  'use strict';

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function brl(c) { var n = Math.round(Number(c) || 0); return 'R$ ' + String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + ('0' + (n % 100)).slice(-2); }
  function dt(v) { if (!v) return '—'; var d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('pt-BR'); }
  var MOTIVOS = { imprevisto: 'Imprevisto pessoal ou familiar', financeiro: 'Problema financeiro', nao_precisa_mais: 'Serviço não é mais necessário', nao_combinou: 'Não conseguiu combinar', outro: 'Outro motivo' };
  var STATUS_CONCLUSAO = { pendente: 'Aguardando o cliente', concluido: 'Cliente confirmou: concluído', com_problema: 'Cliente: realizado com problema', nao_realizado: 'Cliente: não realizado', substituida: 'Substituída', encerrada_admin: 'Encerrada pelo admin' };

  function planoDoProf(id) {
    var rows = (global.DB && global.DB.state && global.DB.state.planosProf) || [];
    var now = Date.now();
    var active = rows.filter(function(x) { return String(x.profissional_id) === String(id) && Date.parse(x.valido_ate) > now && (!x.inicio_em || Date.parse(x.inicio_em) <= now) && (x.plano === 'livre' || Number(x.chamados_restantes) > 0); });
    return active.find(function(x) { return x.plano === 'livre'; }) || active[0] || null;
  }
  function planoHtml(id) {
    var p = planoDoProf(id);
    if (!p) return '<span class="badge badge--muted">Sem plano ativo</span>';
    return '<span class="badge badge--navy">' + esc(p.plano === 'livre' ? 'QUEM FAZ LIVRE' : 'Plano ' + p.plano) + '</span><small class="text--secondary">Ativo até ' + esc(new Date(p.valido_ate).toLocaleDateString('pt-BR', {timeZone:'America/Sao_Paulo'})) + '</small>';
  }
  var STATUS_PEDIDO = {aberto:'Buscando profissional',em_negociacao:'Em negociação',confirmado:'Contratado',em_andamento:'Em andamento',concluido:'Concluído',cancelado:'Cancelado',expirado:'Expirado'};
  function pedidoHtml(p) {
    var valor = p.modalidade === 'valor_definido';
    var pedido = global.DB && global.DB.requestById ? global.DB.requestById(p.id) : null;
    var garante = p.atendimento_tipo === 'garante' || !!(pedido && pedido.atendimentoTipo === 'garante');
    var h = '<div class="card card--tight qf-adm-pedido" data-qf-admin-pedido="' + esc(p.id) + '">' +
      '<div class="row-between"><strong>' + esc(String(p.categoria || '').replace(/^cat_/, '').replace(/_/g, ' ')) + ' · ' + esc(String(p.id).slice(0, 8)) + '</strong>' +
      '<span class="badge ' + (garante ? 'qf-garante-badge' : (valor ? 'badge--success' : '')) + '">' + (garante ? 'QUEM FAZ GARANTE' : (valor ? 'Valor definido' : 'Pedido de orçamento')) + '</span></div>' +
      '<div class="text--sm text--secondary">' + esc(p.cidade || '') + (p.uf ? '/' + esc(p.uf) : '') + ' · ' + esc(STATUS_PEDIDO[p.status] || p.status) + ' · ' + esc(dt(p.criado_em)) + '</div>';
    if (valor) h += '<div class="text--sm">Valor do cliente: <strong>' + esc(brl(p.valor_oferecido_centavos)) + '</strong> · ' + (p.material_incluso ? 'material incluso' : 'material à parte') + '</div>';
    (p.desbloqueios || []).forEach(function (d) {
      h += '<div class="qf-adm-desbloqueio"><strong>' + esc(d.profissional || d.profissional_id) + '</strong><div class="qf-adm-plan-tag">' + planoHtml(d.profissional_id) + '</div><span class="text--sm">' +
        (d.origem === 'comissao13' ? 'Desbloqueio sem débito · 13% após conclusão confirmada pelo cliente · Pix automático' : 'Desbloqueio: ' + esc(brl(d.taxa_centavos)) + (Number(d.taxa_centavos) > 0 ? (d.pagamento_confirmado ? ' · débito confirmado' : ' · débito não confirmado') : ' · sem débito')) +
        (d.ativo ? '' : ' · inativo') + '</span><small class="text--secondary">' + esc(dt(d.criado_em)) + '</small></div>';

    });
    if (p.conclusao) {
      h += '<div class="text--sm">Baixa: ' + esc(STATUS_CONCLUSAO[p.conclusao.status] || p.conclusao.status) +
        (p.conclusao.nota ? ' · nota ' + Number(p.conclusao.nota) + '/5' : '') + ' · ' + esc(dt(p.conclusao.respondida_em || p.conclusao.criado_em)) + '</div>';
      if (p.conclusao.status === 'pendente') h += '<button class="btn btn--ghost btn--sm" type="button" data-qf-encerrar="' + esc(p.conclusao.id) + '">Encerrar com evidências</button>';
    }
    if (p.cancelamento) h += '<div class="text--sm">Cancelado: ' + esc(MOTIVOS[p.cancelamento.motivo] || p.cancelamento.motivo) + (p.cancelamento.detalhe ? ' — ' + esc(p.cancelamento.detalhe) : '') + ' · ' + esc(dt(p.cancelamento.criado_em)) + (p.cancelamento.houve_desbloqueio ? ' · havia desbloqueio' : '') + '</div>';
    (p.contestacoes || []).forEach(function (c) {
      h += '<div class="text--sm">Contestação (' + esc(c.status) + '): ' + esc(c.motivo) + ' — ' + esc(c.descricao) + (c.valor_estornado_centavos ? ' · estornado ' + esc(brl(c.valor_estornado_centavos)) : '') + '</div>';
      if (c.status === 'aberta' || c.status === 'pendente') {
        h += '<button class="btn btn--ghost btn--sm" type="button" data-qf-resolver="' + esc(c.id) + '" data-decisao="estornar">Estornar</button> ' +
             '<button class="btn btn--ghost btn--sm" type="button" data-qf-resolver="' + esc(c.id) + '" data-decisao="negar">Negar</button>';
      }
    });
    return h + '<div><button class="btn btn--ghost btn--sm" type="button" data-qf-historico="' + esc(p.id) + '">Histórico completo</button></div><div data-qf-hist hidden></div></div>';
  }

  function historicoHtml(eventos) {
    if (!eventos || !eventos.length) return '<div class="text--sm text--secondary">Sem eventos registrados.</div>';
    return eventos.map(function (e) { return '<div class="text--sm">' + esc(dt(e.criado_em)) + ' · <strong>' + esc(e.tipo) + '</strong> · ' + esc(e.ator_papel || '') + '</div>'; }).join('');
  }

  function suspeitosHtml(lista) {
    if (!lista || !lista.length) return '<div class="text--sm text--secondary">Nenhum cliente com cancelamentos repetidos após desbloqueio no período.</div>';
    return '<p class="text--sm text--secondary">Somente para revisão humana. Nada é bloqueado automaticamente.</p>' + lista.map(function (c) {
      return '<div class="card card--tight"><strong>' + esc(c.cliente || c.cliente_id) + '</strong> · ' + Number(c.total) + ' cancelamentos (' + Number(c.com_desbloqueio) + ' após desbloqueio) · último ' + esc(dt(c.ultimo)) + '</div>';
    }).join('');
  }

  // "6", "6,5", "6.5" -> pontos-base (600, 650); reais -> centavos. null se vazio/inválido.
  function pctParaBps(t) { var n = Number(String(t == null ? '' : t).replace(',', '.')); return isFinite(n) && String(t).trim() !== '' ? Math.round(n * 100) : null; }
  function reaisParaCentavos(t) { var s = String(t == null ? '' : t).trim(); if (!s) return null; var n = Number(s.replace(/\./g, '').replace(',', '.')); return isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined; }

  var api = { esc: esc, brl: brl, planoDoProf: planoDoProf, planoHtml: planoHtml, pedidoHtml: pedidoHtml, historicoHtml: historicoHtml, suspeitosHtml: suspeitosHtml, pctParaBps: pctParaBps, reaisParaCentavos: reaisParaCentavos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.QFAdminValor = api;

  if (!global.Screens || !global.document) return;
  var previous = global.Screens.afterRender;
  global.Screens.afterRender = function (pattern, content, params, user) {
    if (previous) previous(pattern, content, params, user);
    if (pattern !== '/admin/dashboard' || !global.QFAdminCloud || !global.QFAdminCloud.client) return;
    var c = global.QFAdminCloud.client, PU = global.PU;
    var box = document.createElement('section'); box.className = 'section';
    box.innerHTML = '<h2 class="h3">Baixas, cancelamentos e pedidos</h2><div class="card stack--sm" data-qf-valor-admin>Carregando…</div>';
    // No topo do painel: no fim da página ficava escondido atrás do relatório comercial.
    content.insertBefore(box, content.firstChild);
    var raiz = box.querySelector('[data-qf-valor-admin]');
    var filtro = null, pagina = 0, situacao = 'ativos', busca = '', pedidos = [], cfg = {}, suspeitos = [];
    function desenhar() {
      var lista = pedidos.filter(function(p) { return (situacao === 'todos' || (situacao === 'ativos' ? !['cancelado','expirado','concluido'].includes(p.status) : p.status === situacao)) && (!busca || [p.id,p.categoria,p.cidade].concat((p.desbloqueios || []).map(function(d){return d.profissional;})).join(' ').toLocaleLowerCase('pt-BR').includes(busca)); });
      var total = lista.length; pagina = Math.min(pagina, Math.max(0, Math.ceil(total/8)-1));
      raiz.innerHTML = '<div class="row-between"><h3 class="h3">Pedidos recentes</h3><a class="btn btn--ghost btn--sm" style="width:auto" href="#/admin/servicos">Ver todos</a></div><p class="text--sm text--secondary">O selo azul identifica o plano do profissional. O tipo do pedido aparece separado.</p><form data-qf-pedidos-busca class="stack--sm"><label>Buscar pedido ou profissional<input class="input" name="busca" type="search" value="' + esc(busca) + '" placeholder="Nome, serviço, cidade ou número"></label><label>Situação<select class="input" name="situacao">' + [['ativos','Em atendimento'],['todos','Todas as situações'],['aberto','Buscando profissional'],['em_negociacao','Em negociação'],['concluido','Concluídos'],['cancelado','Cancelados'],['expirado','Expirados']].map(function(x){return '<option value="'+x[0]+'"'+(situacao===x[0]?' selected':'')+'>'+x[1]+'</option>';}).join('') + '</select></label><button class="btn btn--outline btn--sm">Filtrar</button></form><p class="text--sm text--secondary">' + total + ' resultados · página ' + (pagina+1) + (pedidos.length===500?' · últimos 500 pedidos':'') + '</p><div class="stack">' + (lista.slice(pagina*8,pagina*8+8).map(pedidoHtml).join('') || '<p>Nenhum pedido neste filtro.</p>') + '</div><div class="btn-row"><button class="btn btn--outline btn--sm" data-qf-page="-1" '+(!pagina?'disabled':'')+'>Anterior</button><button class="btn btn--outline btn--sm" data-qf-page="1" '+((pagina+1)*8>=total?'disabled':'')+'>Próxima</button></div><details><summary>Configurações e revisão de cancelamentos</summary><div class="stack"><p>Baixa por QR e cancelamento com motivo: ' + (cfg.ativo?'ligado':'desligado') + '</p><button class="btn btn--outline btn--sm" data-qf-flag="'+(cfg.ativo?'0':'1')+'">'+(cfg.ativo?'Desligar':'Ligar')+'</button>'+suspeitosHtml(suspeitos)+'</div></details>';
    }
    raiz.addEventListener('submit', function(e) { if(!e.target.matches('[data-qf-pedidos-busca]'))return;e.preventDefault();busca=e.target.elements.busca.value.trim().toLocaleLowerCase('pt-BR');situacao=e.target.elements.situacao.value;pagina=0;desenhar(); });
    function rpc(n, a) { return Promise.resolve(c.rpc(n, a || {})).then(function (r) { if (r.error) throw r.error; return r.data; }); }
    function carregar() {
      Promise.all([rpc('qf_pedidos_valor_config'), rpc('qf_admin_pedidos_valor', { p_modalidade: filtro, p_limit: 500, p_offset: 0 }), rpc('qf_admin_cancelamentos_suspeitos')]).then(function (r) {
        if (!raiz.isConnected) return;
        cfg = r[0] || {}; pedidos = r[1] || []; suspeitos = r[2] || []; desenhar();
      }).catch(function () { raiz.textContent = 'Não foi possível carregar os pedidos. Atualize a página para tentar novamente.'; });
    }
    raiz.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-qf-page')) { pagina += Number(b.dataset.qfPage); desenhar(); box.scrollIntoView({block:'start'}); }
      else if (b.hasAttribute('data-qf-flag')) {
        var ligar = b.getAttribute('data-qf-flag') === '1';
        PU.confirmDialog({ title: ligar ? 'Ligar novas funcionalidades?' : 'Desligar novas funcionalidades?', message: ligar ? 'Clientes e profissionais passam a ver a baixa por QR e o cancelamento com motivo.' : 'Volta ao funcionamento anterior. Pedidos e histórico continuam guardados.', okLabel: ligar ? 'Ligar' : 'Desligar' })
          .then(function (ok) { if (ok) rpc('qf_admin_pedidos_valor_ativar', { p_ativo: ligar }).then(carregar).catch(function () { PU.toast('Não foi possível alterar.', 'danger'); }); });
      } else if (b.hasAttribute('data-qf-filtro')) { filtro = b.getAttribute('data-qf-filtro') || null; carregar(); }
      else if (b.hasAttribute('data-qf-historico')) {
        var alvo = b.closest('[data-qf-admin-pedido]').querySelector('[data-qf-hist]');
        rpc('qf_admin_pedido_historico', { p_chamado_id: b.getAttribute('data-qf-historico') }).then(function (ev) { alvo.innerHTML = historicoHtml(ev); alvo.hidden = false; });
      } else if (b.hasAttribute('data-qf-encerrar')) {
        var ev = global.prompt('Descreva as evidências do encerramento (mín. 10 letras). Nenhuma avaliação será criada.');
        if (ev && ev.trim().length >= 10) rpc('qf_admin_encerrar_conclusao', { p_conclusao_id: b.getAttribute('data-qf-encerrar'), p_evidencias: ev.trim() }).then(function (o) { PU.toast(o && o.ok ? 'Baixa encerrada.' : 'Não foi possível encerrar.', o && o.ok ? 'success' : 'danger'); carregar(); });
      } else if (b.hasAttribute('data-qf-resolver')) {
        var dec = b.getAttribute('data-decisao'), nota = global.prompt(dec === 'estornar' ? 'Motivo do estorno (fica registrado):' : 'Motivo da negativa (fica registrado):');
        if (nota && nota.trim()) rpc('qf_admin_resolver_contestacao', { p_id: b.getAttribute('data-qf-resolver'), p_decisao: dec, p_nota: nota.trim() }).then(function (o) { PU.toast(o && o.ok ? 'Contestação resolvida.' : 'Não foi possível resolver.', o && o.ok ? 'success' : 'danger'); carregar(); });
      }
    });
    carregar();
  };
})(typeof window !== 'undefined' ? window : globalThis);
