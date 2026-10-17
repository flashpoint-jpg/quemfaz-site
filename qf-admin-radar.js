/* Radar de Leads Externos — aba do painel administrativo (/admin/radar-leads).
   Tudo passa por funções do Supabase que exigem administrador (qf_radar_*); nenhuma tabela é lida direto.
   O painel PREPARA convites: nada é enviado a ninguém, nenhum pedido é criado e nada é cobrado. */
(function (global) {
  'use strict';
  var Screens = global.Screens, PU = global.PU;
  if (!Screens || !PU) return;

  var STATUS = {
    novo: ['A revisar', 'badge--warning'], qualificado: ['Qualificado', 'badge--info'],
    convite_preparado: ['Convite preparado', 'badge--info'], convite_enviado: ['Convite enviado', 'badge--info'],
    cliente_confirmou: ['Cliente confirmou', 'badge--success'], pedido_publicado: ['Pedido publicado', 'badge--success'],
    descartado: ['Descartado', 'badge--muted'], duplicado: ['Duplicado', 'badge--muted']
  };
  var FILTERS = [
    ['todos', 'Todos', null], ['novo', 'A revisar', 'novo'], ['qualificado', 'Qualificados', 'qualificado'],
    ['convite_preparado', 'Convite preparado', 'convite_preparado'], ['convite_enviado', 'Convite enviado', 'convite_enviado'],
    ['pedido_publicado', 'Pedido publicado', 'pedido_publicado'], ['descartado', 'Descartados', 'descartado'],
    ['duplicado', 'Duplicados', 'duplicado']
  ];
  var EVENTS = {
    capturado: 'Capturado pela fonte', registro_manual: 'Registrado manualmente', registro_teste: 'Registro de teste',
    convite_preparado: 'Convite preparado', convite_enviado: 'Convite marcado como enviado',
    pedido_publicado: 'Cliente publicou o pedido pelo link', status_novo: 'Voltou para revisão',
    status_qualificado: 'Marcado como qualificado', status_descartado: 'Descartado', status_cliente_confirmou: 'Cliente confirmou interesse'
  };
  var state = { filter: 'todos', busca: '', offset: 0, total: 0, itens: [], resumo: null, busy: false };
  var PAGE = 25;

  function esc(v) { return PU.escapeHtml(String(v == null ? '' : v)); }
  function client() { return global.QFAdminCloud && global.QFAdminCloud.client; }
  function rpc(name, args) {
    var c = client();
    if (!c) return Promise.reject(new Error('Painel sem conexão com o banco.'));
    return c.rpc(name, args || {}).then(function (r) {
      if (r.error) throw new Error(r.error.message || 'Falha ao consultar o banco.');
      return r.data;
    });
  }
  function brl(centavos) {
    return (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function when(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return iso; }
  }
  function safeLink(url) { return /^https:\/\/[^\s"'<>]+$/.test(String(url || '')) ? url : ''; }
  function kpi(value, label, hint) {
    return '<div class="kpi-card"><div class="kpi-card__value">' + esc(value) + '</div><div class="kpi-card__label">' + esc(label) + '</div>' +
      (hint ? '<div class="text--sm text--secondary" style="margin-top:4px;">' + esc(hint) + '</div>' : '') + '</div>';
  }

  Screens.adminRadarRender = function () {
    return '<div class="view qf-radar" data-qf-radar>' +
      '<div class="card stack--sm">' +
        '<div class="h3">Radar de Leads Externos · Grande ABC</div>' +
        '<p class="text--sm text--secondary">Oportunidades de pessoas que procuram serviços fora do Quem Faz. Aqui elas ficam <strong>só em revisão</strong>: ' +
        'nenhum pedido é criado, nenhum profissional é avisado e nenhum crédito é cobrado até o próprio cliente abrir o link e publicar. ' +
        'Os dados guardados são o link da publicação e um trecho sem telefone, e-mail ou CPF; expiram em 30 dias se não virarem pedido.</p>' +
        '<div class="btn-row"><button type="button" class="btn btn--outline" data-radar-refresh>' + global.icon('refresh') + ' Atualizar</button></div>' +
      '</div>' +
      '<section class="section"><div class="section-head"><h2 class="h3">Indicadores</h2></div><div data-radar-kpis class="stack--sm"><div class="card text--sm">Carregando…</div></div></section>' +
      '<section class="section"><div class="section-head"><h2 class="h3">Fontes externas</h2></div><div data-radar-sources class="card stack--sm text--sm">Carregando…</div></section>' +
      '<section class="section"><details class="card" data-radar-manual><summary class="text--strong" style="cursor:pointer;">Registrar uma publicação pública manualmente</summary>' +
        '<form class="stack--sm" data-radar-form style="margin-top:12px;" novalidate>' +
          '<label class="field"><span class="field__label">Link da publicação (https)</span><input class="input" name="url" type="url" required placeholder="https://…"></label>' +
          '<label class="field"><span class="field__label">Trecho do pedido (sem telefone ou e-mail)</span><textarea class="input" name="trecho" rows="3" maxlength="500" required></textarea></label>' +
          '<div class="row" style="gap:8px;flex-wrap:wrap;">' +
            '<label class="field" style="flex:1;min-width:160px;"><span class="field__label">Serviço</span><select class="input" name="servico" data-radar-service></select></label>' +
            '<label class="field" style="flex:1;min-width:160px;"><span class="field__label">Cidade</span><select class="input" name="cidade" data-radar-city></select></label>' +
          '</div>' +
          '<div class="row" style="gap:8px;flex-wrap:wrap;">' +
            '<label class="field" style="flex:1;min-width:160px;"><span class="field__label">Bairro (opcional)</span><input class="input" name="bairro" maxlength="80"></label>' +
            '<label class="field" style="flex:1;min-width:160px;"><span class="field__label">Urgência</span><select class="input" name="urgencia"><option value="">Normal</option><option value="urgente">Urgente</option></select></label>' +
          '</div>' +
          '<label class="row" style="gap:8px;"><input type="checkbox" name="teste"> <span class="text--sm">Registro de teste (dados fictícios; fica fora dos indicadores e some em 7 dias)</span></label>' +
          '<div class="btn-row"><button type="button" class="btn btn--outline" data-radar-suggest>Sugerir pelo texto</button>' +
          '<button type="submit" class="btn btn--primary">Registrar</button></div>' +
        '</form></details></section>' +
      '<section class="section"><div class="section-head"><h2 class="h3">Oportunidades</h2></div>' +
        '<div class="segmented" data-radar-filters>' + FILTERS.map(function (f) {
          return '<button type="button" class="segmented__item' + (f[0] === state.filter ? ' is-active' : '') + '" data-radar-filter="' + f[0] + '">' + f[1] + '</button>';
        }).join('') + '</div>' +
        '<label class="field" style="margin-top:8px;"><span class="field__label">Buscar por serviço, cidade, fonte ou texto</span><input class="input" type="search" data-radar-search value="' + esc(state.busca) + '"></label>' +
        '<div data-radar-list class="stack--sm" style="margin-top:8px;"><div class="card text--sm">Carregando…</div></div>' +
        '<div class="btn-row" style="margin-top:8px;"><button type="button" class="btn btn--outline" data-radar-more hidden>Carregar mais</button></div>' +
      '</section>' +
    '</div>';
  };

  function renderKpis(root, r) {
    var box = root.querySelector('[data-radar-kpis]');
    box.innerHTML = '<div class="kpi-grid">' +
      kpi(r.encontrados, 'Leads encontrados', r.duplicados ? r.duplicados + ' duplicado(s) fora da conta' : '') +
      kpi(r.qualificados, 'Leads qualificados', r.a_revisar ? r.a_revisar + ' ainda a revisar' : '') +
      kpi(r.convites_enviados, 'Convites enviados', r.convites_preparados + ' preparado(s)') +
      kpi(r.clientes_confirmados, 'Clientes confirmados') +
      kpi(r.pedidos_publicados, 'Pedidos publicados') +
      kpi(r.profissionais_desbloquearam, 'Profissionais que desbloquearam', r.desbloqueios + ' desbloqueio(s)') +
      kpi(brl(r.creditos_centavos), 'Créditos usados nos desbloqueios') +
      kpi(r.recargas_atribuiveis + ' · ' + brl(r.recargas_atribuiveis_centavos), 'Recargas atribuíveis') +
    '</div>' +
    '<p class="text--sm text--secondary" style="margin-top:8px;">Pedido publicado = o cliente abriu o link do convite e publicou pelo formulário normal. ' +
    'Recarga atribuível = recarga aprovada de um profissional que desbloqueou um pedido vindo do radar, feita depois desse primeiro desbloqueio. ' +
    'Registros de teste (' + Number(r.testes || 0) + ') ficam fora destes números.</p>';
    var bySvc = Object.keys(r.por_servico || {}), byCity = Object.keys(r.por_cidade || {});
    if (bySvc.length || byCity.length) {
      box.innerHTML += '<div class="card text--sm stack--sm">' +
        (bySvc.length ? '<div><strong>Por serviço:</strong> ' + bySvc.map(function (k) { return esc(k) + ' (' + r.por_servico[k] + ')'; }).join(' · ') + '</div>' : '') +
        (byCity.length ? '<div><strong>Por cidade:</strong> ' + byCity.map(function (k) { return esc(k) + ' (' + r.por_cidade[k] + ')'; }).join(' · ') + '</div>' : '') + '</div>';
    }
  }

  function renderSources(root, fontes) {
    var box = root.querySelector('[data-radar-sources]');
    var externas = (fontes || []).filter(function (f) { return f.kind !== 'manual'; });
    var html = '';
    if (!externas.length) {
      html += '<div><span class="badge badge--warning">Nenhuma fonte externa automática habilitada</span></div>' +
        '<p class="text--secondary">A captura automática só roda em fontes com acesso e coleta autorizados, habilitadas com a prova da autorização registrada. ' +
        'Enquanto isso, use o registro manual abaixo para publicações públicas que você encontrar.</p>';
    }
    html += (fontes || []).map(function (f) {
      var ok = f.enabled && f.last_status === 'ok';
      var label = f.kind === 'manual' ? 'Manual' : !f.enabled ? 'Desabilitada' : f.last_status === 'bloqueada' ? 'Bloqueada pela fonte' : f.last_status === 'erro' ? 'Com erro' : f.last_run_at ? 'Ativa' : 'Ativa · aguardando 1ª rodada';
      return '<div class="row-between"><span><strong>' + esc(f.label) + '</strong> <small>(' + esc(f.kind) + (f.allowed_host ? ' · ' + esc(f.allowed_host) : '') + ')</small></span>' +
        '<span class="badge ' + (ok ? 'badge--success' : f.last_status === 'bloqueada' || f.last_status === 'erro' ? 'badge--danger' : 'badge--muted') + '">' + esc(label) + '</span></div>' +
        (f.last_run_at ? '<div class="text--sm text--secondary">Última rodada ' + esc(when(f.last_run_at)) + ' · ' + Number(f.last_items_seen || 0) + ' item(ns) lidos' + (f.last_error ? ' · ' + esc(f.last_error) : '') + '</div>' : '');
    }).join('');
    box.innerHTML = html;
  }

  function leadCard(l) {
    var st = STATUS[l.status] || [l.status, 'badge--muted'];
    var link = safeLink(l.source_url);
    var actions = [];
    if (['pedido_publicado', 'duplicado'].indexOf(l.status) === -1) {
      if (l.status !== 'descartado') actions.push('<button type="button" class="btn btn--primary" data-radar-invite="' + l.id + '">' + (l.invite_prepared_at ? 'Ver convite' : 'Preparar convite') + '</button>');
      if (l.status !== 'descartado') actions.push('<button type="button" class="btn btn--outline" data-radar-status="cliente_confirmou" data-id="' + l.id + '">Cliente confirmou</button>');
      if (l.status === 'novo') actions.push('<button type="button" class="btn btn--outline" data-radar-status="qualificado" data-id="' + l.id + '">Qualificar</button>');
      actions.push(l.status === 'descartado'
        ? '<button type="button" class="btn btn--outline" data-radar-status="novo" data-id="' + l.id + '">Reabrir</button>'
        : '<button type="button" class="btn btn--outline" data-radar-status="descartado" data-id="' + l.id + '">Descartar</button>');
    }
    actions.push('<button type="button" class="btn btn--outline" data-radar-history="' + l.id + '">Histórico</button>');
    actions.push('<button type="button" class="btn btn--outline" data-radar-delete="' + l.id + '" data-motivo="opt_out">Pediu para não ser contatado</button>');
    actions.push('<button type="button" class="btn btn--outline" data-radar-delete="' + l.id + '" data-motivo="exclusao_lgpd">Excluir (LGPD)</button>');
    return '<div class="card stack--sm" data-radar-card="' + l.id + '">' +
      '<div class="row-between"><strong>' + esc(l.service) + ' · ' + esc(l.city) + (l.neighborhood ? ' (' + esc(l.neighborhood) + ')' : '') + '</strong>' +
      '<span>' + (l.is_test ? '<span class="badge badge--danger">TESTE</span> ' : '') + (l.urgency === 'urgente' ? '<span class="badge badge--warning">Urgente</span> ' : '') +
      '<span class="badge ' + st[1] + '">' + esc(st[0]) + '</span></span></div>' +
      '<div class="text--sm">' + esc(l.excerpt || '') + '</div>' +
      '<div class="text--sm text--secondary">Fonte: ' + esc(l.source) + ' · confiança ' + Math.round(Number(l.confidence || 0) * 100) + '% · capturado ' + esc(when(l.first_seen_at)) +
        (l.status === 'duplicado' ? ' · repete outra oportunidade' : ' · expira ' + esc(when(l.expires_at))) + '</div>' +
      (link ? '<div class="text--sm"><a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Ver publicação original</a></div>' : '') +
      (l.invited_at ? '<div class="text--sm text--secondary">Convite marcado como enviado em ' + esc(when(l.invited_at)) + (l.invite_channel ? ' (' + esc(l.invite_channel) + ')' : '') + '</div>' : '') +
      (l.chamado_id ? '<div class="text--sm text--secondary">Pedido ' + esc(String(l.chamado_id).slice(0, 8)) + ' · ' + Number(l.desbloqueios || 0) + ' desbloqueio(s)</div>' : '') +
      '<div class="btn-row" style="flex-wrap:wrap;">' + actions.join('') + '</div>' +
      '<div data-radar-extra="' + l.id + '"></div></div>';
  }

  function renderList(root, append) {
    var box = root.querySelector('[data-radar-list]');
    var html = state.itens.map(leadCard).join('');
    box.innerHTML = html || '<div class="card text--sm text--secondary">Nenhuma oportunidade neste filtro. ' +
      (state.resumo && !state.resumo.encontrados ? 'Ainda não há leads reais registrados.' : '') + '</div>';
    var more = root.querySelector('[data-radar-more]');
    more.hidden = state.itens.length >= state.total;
    more.textContent = 'Carregar mais (' + state.itens.length + ' de ' + state.total + ')';
  }

  function loadSummary(root) {
    return rpc('qf_radar_resumo').then(function (r) {
      state.resumo = r; renderKpis(root, r); renderSources(root, r.fontes);
    });
  }
  function loadList(root, reset) {
    if (reset) { state.offset = 0; state.itens = []; }
    var f = FILTERS.filter(function (x) { return x[0] === state.filter; })[0];
    return rpc('qf_radar_listar', { p_status: f ? f[2] : null, p_busca: state.busca || null, p_limite: PAGE, p_offset: state.offset }).then(function (r) {
      state.total = r.total; state.itens = state.itens.concat(r.itens || []); state.offset = state.itens.length; renderList(root);
    });
  }
  function reload(root) {
    return Promise.all([loadSummary(root), loadList(root, true)]).catch(function (err) {
      PU.toast((err && err.message) || 'Não foi possível carregar o Radar.', 'danger');
      ['[data-radar-kpis]', '[data-radar-list]'].forEach(function (sel) {
        var el = root.querySelector(sel); if (el && /Carregando/.test(el.textContent)) el.innerHTML = '<div class="card text--sm">Não foi possível carregar. ' + esc(err && err.message) + '</div>';
      });
    });
  }

  function fillSelects(root) {
    var C = global.QFRadarClassifier;
    var svc = root.querySelector('[data-radar-service]'), city = root.querySelector('[data-radar-city]');
    if (!C) return;
    svc.innerHTML = C.SERVICES.map(function (s) { return '<option value="' + esc(s.slug) + '">' + esc(s.label) + '</option>'; }).join('');
    city.innerHTML = C.CITIES.map(function (c) { return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>'; }).join('');
  }
  function suggest(root) {
    var C = global.QFRadarClassifier, form = root.querySelector('[data-radar-form]');
    if (!C) return;
    var r = C.classifyLead({ authorizedSource: true, url: form.url.value || 'https://exemplo.invalid/', source: 'manual_admin', text: form.trecho.value });
    if (r.service_slug) form.servico.value = r.service_slug;
    if (r.city) form.cidade.value = r.city;
    if (r.neighborhood) form.bairro.value = r.neighborhood;
    form.urgencia.value = r.urgency || '';
    PU.toast(r.accepted ? 'Sugestão preenchida. Confira antes de registrar.' : 'O texto não parece um pedido de contratação (' + r.reason.replace(/_/g, ' ') + '). Confira antes de registrar.', r.accepted ? 'success' : 'info');
  }
  function submitManual(root, form) {
    var C = global.QFRadarClassifier;
    var url = String(form.url.value || '').trim();
    if (!/^https:\/\/\S+$/.test(url)) { PU.toast('Informe um link https válido.', 'danger'); return; }
    if (String(form.trecho.value || '').trim().length < 10) { PU.toast('Cole o trecho do pedido.', 'danger'); return; }
    var svc = C.SERVICES.filter(function (s) { return s.slug === form.servico.value; })[0];
    var btn = form.querySelector('[type=submit]'); btn.disabled = true;
    rpc('qf_radar_registrar_manual', {
      p_url: url, p_trecho: form.trecho.value, p_servico: svc ? svc.label : form.servico.value, p_slug: form.servico.value,
      p_cidade: form.cidade.value, p_bairro: form.bairro.value || null, p_urgencia: form.urgencia.value || null, p_teste: !!form.teste.checked
    }).then(function (r) {
      PU.toast(r.novo ? (r.duplicado_de ? 'Registrado como duplicado de outra oportunidade.' : 'Oportunidade registrada.') : 'Esse link já estava registrado.', 'success');
      form.reset(); fillSelects(root); return reload(root);
    }).catch(function (err) { PU.toast((err && err.message) || 'Não foi possível registrar.', 'danger'); })
      .then(function () { btn.disabled = false; });
  }

  function showInvite(root, id) {
    var lead = state.itens.filter(function (l) { return l.id === id; })[0];
    var extra = root.querySelector('[data-radar-extra="' + id + '"]');
    return rpc('qf_radar_preparar_convite', { p_lead: id, p_canal: 'manual' }).then(function (r) {
      var msg = global.QFRadarClassifier.inviteMessage(lead ? lead.service : r.servico, r.link);
      extra.innerHTML = '<div class="card card--tight stack--sm" style="background:var(--bg-sunken);border:none;">' +
        '<div class="text--strong">Convite pronto para envio manual</div>' +
        '<textarea class="input" rows="4" readonly data-radar-msg>' + esc(msg) + '</textarea>' +
        '<div class="text--sm text--secondary">Nada foi enviado. Copie a mensagem, envie pelo canal em que a pessoa já pediu ajuda (respeitando as regras da plataforma) e depois marque como enviado.</div>' +
        '<div class="btn-row"><button type="button" class="btn btn--outline" data-radar-copy>Copiar mensagem</button>' +
        '<button type="button" class="btn btn--primary" data-radar-sent="' + id + '">Marcar como enviado</button></div></div>';
      // Atualiza só este cartão (sem recarregar a lista) para o painel do convite não sumir.
      if (lead) {
        var keep = extra.innerHTML, card = root.querySelector('[data-radar-card="' + id + '"]');
        lead.invite_prepared_at = lead.invite_prepared_at || new Date().toISOString();
        if (lead.status === 'novo' || lead.status === 'qualificado') lead.status = 'convite_preparado';
        if (card) { card.outerHTML = leadCard(lead); root.querySelector('[data-radar-extra="' + id + '"]').innerHTML = keep; }
      }
      return loadSummary(root);
    });
  }
  function showHistory(root, id) {
    var extra = root.querySelector('[data-radar-extra="' + id + '"]');
    return rpc('qf_radar_eventos', { p_lead: id }).then(function (ev) {
      extra.innerHTML = '<div class="card card--tight stack--sm" style="background:var(--bg-sunken);border:none;"><div class="text--strong">Histórico</div>' +
        (ev.length ? ev.map(function (e) {
          return '<div class="text--sm"><strong>' + esc(EVENTS[e.tipo] || e.tipo) + '</strong> · ' + esc(when(e.em)) + ' · ' + esc(e.ator) + (e.nota ? ' · ' + esc(e.nota) : '') + '</div>';
        }).join('') : '<div class="text--sm">Sem eventos.</div>') + '</div>';
    });
  }

  function bind(root) {
    fillSelects(root);
    root.addEventListener('click', function (e) {
      var t = e.target;
      function on(sel) { return t.closest(sel); }
      var el;
      if (on('[data-radar-refresh]')) { reload(root); return; }
      if ((el = on('[data-radar-filter]'))) {
        state.filter = el.getAttribute('data-radar-filter');
        root.querySelectorAll('[data-radar-filter]').forEach(function (b) { b.classList.toggle('is-active', b === el); });
        loadList(root, true).catch(function (err) { PU.toast(err.message, 'danger'); }); return;
      }
      if (on('[data-radar-more]')) { loadList(root, false).catch(function (err) { PU.toast(err.message, 'danger'); }); return; }
      if (on('[data-radar-suggest]')) { suggest(root); return; }
      if ((el = on('[data-radar-invite]'))) { showInvite(root, el.getAttribute('data-radar-invite')).catch(function (err) { PU.toast(err.message, 'danger'); }); return; }
      if ((el = on('[data-radar-history]'))) { showHistory(root, el.getAttribute('data-radar-history')).catch(function (err) { PU.toast(err.message, 'danger'); }); return; }
      if (on('[data-radar-copy]')) {
        var ta = on('[data-radar-extra]').querySelector('[data-radar-msg]');
        (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(ta.value) : Promise.reject()).then(function () { PU.toast('Mensagem copiada.', 'success'); }, function () { ta.select(); PU.toast('Selecione e copie a mensagem.', 'info'); });
        return;
      }
      if ((el = on('[data-radar-sent]'))) {
        el.disabled = true;
        rpc('qf_radar_marcar_convite_enviado', { p_lead: el.getAttribute('data-radar-sent'), p_canal: 'manual', p_nota: null })
          .then(function () { PU.toast('Convite marcado como enviado.', 'success'); return reload(root); })
          .catch(function (err) { PU.toast(err.message, 'danger'); el.disabled = false; });
        return;
      }
      if ((el = on('[data-radar-status]'))) {
        rpc('qf_radar_atualizar_status', { p_lead: el.getAttribute('data-id'), p_status: el.getAttribute('data-radar-status'), p_nota: null })
          .then(function () { return reload(root); }).catch(function (err) { PU.toast(err.message, 'danger'); });
        return;
      }
      if ((el = on('[data-radar-delete]'))) {
        // Duas etapas: o primeiro toque pede confirmação, o segundo (em até 5 s) executa. Exclusão é definitiva.
        if (el.getAttribute('data-armed') !== '1') {
          el.setAttribute('data-armed', '1'); el.textContent = 'Toque de novo para confirmar';
          setTimeout(function () { if (el.isConnected) { el.removeAttribute('data-armed'); el.textContent = el.getAttribute('data-motivo') === 'opt_out' ? 'Pediu para não ser contatado' : 'Excluir (LGPD)'; } }, 5000);
          return;
        }
        rpc('qf_radar_excluir', { p_lead: el.getAttribute('data-radar-delete'), p_motivo: el.getAttribute('data-motivo') })
          .then(function () { PU.toast('Removido. Só o código da URL fica guardado para não recapturar.', 'success'); return reload(root); })
          .catch(function (err) { PU.toast(err.message, 'danger'); });
      }
    });
    root.addEventListener('submit', function (e) {
      var form = e.target.closest('[data-radar-form]');
      if (form) { e.preventDefault(); submitManual(root, form); }
    });
    var timer;
    root.addEventListener('input', function (e) {
      var s = e.target.closest('[data-radar-search]');
      if (!s) return;
      clearTimeout(timer);
      timer = setTimeout(function () { state.busca = s.value.trim(); loadList(root, true).catch(function (err) { PU.toast(err.message, 'danger'); }); }, 350);
    });
  }

  var previous = Screens.afterRender;
  Screens.afterRender = function (pattern, content, params, user) {
    if (previous) previous(pattern, content, params, user);
    if (pattern !== '/admin/radar-leads') return;
    var root = content.querySelector('[data-qf-radar]');
    if (!root) return;
    state.offset = 0; state.itens = [];
    bind(root);
    reload(root);
  };
})(window);
