/* QuemFaz — monitoramento de acesso dos profissionais no painel administrativo.
   Dados consolidados vêm de qf_admin_monitoramento_profissionais(), que só responde a administradores
   (qf_admins). Tipo "estimado" = sem confirmação técnica; nunca é apresentado como fato. */
(function (global) {
  'use strict';

  var TIPOS = [['todos', 'Todos os tipos'], ['android', 'App Android'], ['pwa', 'PWA instalado'], ['navegador', 'Navegador'], ['nao_identificado', 'Não identificado']];
  var ATIVIDADE = [['todas', 'Qualquer atividade'], ['7d', 'Ativos nos últimos 7 dias'], ['30d', 'Ativos nos últimos 30 dias'], ['inativos', 'Sem acesso registrado em 30 dias']];
  var NOTIF = [['todas', 'Todas as notificações'], ['ativas', 'Ativas'], ['bloqueadas', 'Bloqueadas'], ['inativas', 'Inativas / não ativadas']];

  // Grupo usado nos filtros e nos indicadores.
  function grupoTipo(l) {
    var t = l.tipo_acesso;
    if (t === 'play_store') return 'android';
    if (t === 'pwa') return 'pwa';
    if (t === 'navegador') return 'navegador';
    if (!t && l.tipo_estimado === 'app_android') return 'android';
    return 'nao_identificado';
  }

  function rotuloTipo(l) {
    if (l.tipo_acesso) {
      var nome = { play_store: 'App Android', pwa: 'PWA instalado', navegador: 'Navegador', desconhecido: 'Não identificado' }[l.tipo_acesso] || 'Não identificado';
      if (l.tipo_acesso === 'desconhecido') return nome;
      return nome + (l.confianca === 'confirmada' ? ' · confirmado' : ' · estimado');
    }
    if (l.tipo_estimado === 'app_android') return 'App Android · estimado (push nativo ativo)';
    if (l.tipo_estimado === 'web_pwa_ou_navegador') return 'Não identificado (push web ativo: PWA ou navegador)';
    return 'Não identificado · sem registro';
  }

  function rotuloNotif(l) {
    return { ativas: 'Ativas', bloqueadas: 'Bloqueadas', inativas: 'Inativas' }[l.notificacoes] || 'Inativas';
  }

  function filtrar(linhas, f) {
    f = f || {};
    return (linhas || []).filter(function (l) {
      if (f.tipo && f.tipo !== 'todos' && grupoTipo(l) !== f.tipo) return false;
      if (f.atividade === '7d' && !l.ativo_7d) return false;
      if (f.atividade === '30d' && !l.ativo_30d) return false;
      if (f.atividade === 'inativos' && l.ativo_30d) return false;
      if (f.notificacoes && f.notificacoes !== 'todas' && l.notificacoes !== f.notificacoes) return false;
      return true;
    });
  }

  function resumir(linhas) {
    var r = { total: 0, com_registro: 0, android: 0, pwa: 0, navegador: 0, nao_identificado: 0, ativos_7d: 0, ativos_30d: 0, notif_ativas: 0, notif_bloqueadas: 0, notif_inativas: 0 };
    (linhas || []).forEach(function (l) {
      r.total++;
      if (l.ultimo_acesso) r.com_registro++;
      r[grupoTipo(l)]++;
      if (l.ativo_7d) r.ativos_7d++;
      if (l.ativo_30d) r.ativos_30d++;
      if (l.notificacoes === 'ativas') r.notif_ativas++;
      else if (l.notificacoes === 'bloqueadas') r.notif_bloqueadas++;
      else r.notif_inativas++;
    });
    return r;
  }

  function fmtData(v) {
    if (!v) return '—';
    try { return new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return '—'; }
  }

  function opcoes(lista) {
    return lista.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('');
  }

  function kpi(v, rotulo) { return '<div class="kpi-card"><div class="kpi-card__value">' + Number(v || 0) + '</div><div class="kpi-card__label">' + rotulo + '</div></div>'; }

  function montar(secao, dados, esc) {
    var linhas = Array.isArray(dados && dados.linhas) ? dados.linhas : [];
    var r = resumir(linhas);
    secao.innerHTML =
      '<h2 class="h3">Como os profissionais acessam</h2>' +
      '<p class="text--sm text--secondary">Registro automático a cada acesso autenticado, a partir desta versão. Quem ainda não abriu o app depois disso aparece sem registro. "Estimado" indica que não há confirmação técnica; "confirmado" vem da ponte nativa do app Android (a origem da instalação na Play Store não é verificável). Atualizado em ' + esc(fmtData(dados && dados.gerado_em)) + '.</p>' +
      '<div class="kpi-grid" data-mon-kpis>' +
        kpi(r.total, 'Profissionais') + kpi(r.com_registro, 'Com acesso registrado') +
        kpi(r.android, 'App Android') + kpi(r.pwa, 'PWA instalado') +
        kpi(r.navegador, 'Navegador') + kpi(r.nao_identificado, 'Não identificado') +
        kpi(r.ativos_7d, 'Ativos em 7 dias') + kpi(r.ativos_30d, 'Ativos em 30 dias') +
        kpi(r.notif_ativas, 'Notificações ativas') + kpi(r.notif_bloqueadas, 'Notificações bloqueadas') +
      '</div>' +
      '<div class="stack--sm" style="margin:14px 0 10px;display:grid;gap:8px;">' +
        '<select class="select" data-mon-f="tipo" aria-label="Filtrar por tipo de acesso">' + opcoes(TIPOS) + '</select>' +
        '<select class="select" data-mon-f="atividade" aria-label="Filtrar por atividade">' + opcoes(ATIVIDADE) + '</select>' +
        '<select class="select" data-mon-f="notificacoes" aria-label="Filtrar por notificações">' + opcoes(NOTIF) + '</select>' +
      '</div>' +
      '<div data-mon-tabela></div>';
    var tabela = secao.querySelector('[data-mon-tabela]');
    var selects = secao.querySelectorAll('[data-mon-f]');
    function desenhar() {
      var f = {};
      Array.prototype.forEach.call(selects, function (s) { f[s.getAttribute('data-mon-f')] = s.value; });
      var vis = filtrar(linhas, f), corte = vis.slice(0, 300);
      var corpo = corte.map(function (l) {
        return '<tr><td><strong>' + esc(l.nome || 'Sem nome') + '</strong><div class="text--sm text--secondary">' + esc([l.cidade, l.uf].filter(Boolean).join('/')) + '</div></td>' +
          '<td>' + esc(rotuloTipo(l)) + (l.app_versao ? '<div class="text--sm text--secondary">versão ' + esc(l.app_versao) + '</div>' : '') + '</td>' +
          '<td>' + esc(fmtData(l.ultimo_acesso)) + '</td>' +
          '<td>' + Number(l.dias_ativos_7d || 0) + ' / ' + Number(l.dias_ativos_30d || 0) + '</td>' +
          '<td>' + esc(rotuloNotif(l)) + '</td></tr>';
      });
      var cab = ['Profissional', 'Tipo de acesso', 'Último acesso', 'Dias ativos (7d / 30d)', 'Notificações'];
      tabela.innerHTML = '<div class="qf-adm-tabela"><div class="qf-adm-tabela__rolar"><table><thead><tr>' + cab.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' +
        (corpo.length ? corpo.join('') : '<tr class="qf-adm-tabela__vazio"><td colspan="5">Nenhum profissional com esses filtros.</td></tr>') +
        '</tbody></table></div><div class="qf-adm-tabela__rodape">' + vis.length + ' de ' + linhas.length + ' profissionais' + (vis.length > corte.length ? ' · mostrando os 300 primeiros' : '') + '</div></div>';
    }
    Array.prototype.forEach.call(selects, function (s) { s.addEventListener('change', desenhar); });
    desenhar();
  }

  global.QFAdminMonitoramento = { grupoTipo: grupoTipo, rotuloTipo: rotuloTipo, filtrar: filtrar, resumir: resumir };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.QFAdminMonitoramento;

  if (global.Screens && typeof document !== 'undefined') {
    var anterior = global.Screens.afterRender;
    global.Screens.afterRender = function (pattern, content, params, user) {
      if (anterior) anterior(pattern, content, params, user);
      if (pattern !== '/admin/profissionais' || !global.QFAdminCloud || !global.QFAdminCloud.client) return;
      var secao = document.createElement('section');
      secao.className = 'section';
      secao.setAttribute('data-mon-acesso', '1');
      secao.innerHTML = '<h2 class="h3">Como os profissionais acessam</h2><div class="card">Carregando acessos reais…</div>';
      content.appendChild(secao);
      var esc = global.PU.escapeHtml;
      global.QFAdminCloud.client.rpc('qf_admin_monitoramento_profissionais').then(function (res) {
        if (!secao.isConnected) return;
        if (res.error) throw res.error;
        montar(secao, res.data, esc);
      }).catch(function () {
        if (secao.isConnected) secao.innerHTML = '<h2 class="h3">Como os profissionais acessam</h2><div class="card">Não foi possível carregar agora. Somente administradores autorizados veem estes dados.</div>';
      });
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
