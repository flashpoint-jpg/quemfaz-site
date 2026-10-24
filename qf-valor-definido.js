/* QuemFaz — orçamento aproximado do pedido + cancelamento, baixa por QR e confirmação do cliente.
   O orçamento aproximado vale para TODOS os pedidos (campo opcional, sempre gratuito): é só uma estimativa
   do cliente, mostrada ao profissional antes do desbloqueio. Nunca é preço fechado nem comissão.
   Cancelamento com motivo, baixa por QR e contestação seguem atrás da chave `pedidos_valor_definido` (qf_config).
   A parte pura (valor, textos, HTML) é testada em tests/valor-definido-front.test.cjs e orcamento-aproximado.test.cjs.
   A regra de verdade (cobrança do desbloqueio normal/exclusivo) vive no banco; aqui só mostramos. */
(function (global) {
  'use strict';

  var DEFAULTS = { ativo: false, valor_min_centavos: 2000, valor_max_centavos: 50000000 };
  var ORC_MIN = 1000, ORC_MAX = 50000000; // R$ 10,00 a R$ 500.000,00 (o banco aceita de R$ 1,00)

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // "1.500,50" | "1500" | "R$ 90" -> centavos inteiros; vazio/inválido -> null. Nunca devolve número quebrado.
  function parseBRL(text) {
    var s = String(text == null ? '' : text).replace(/[^\d.,]/g, '');
    if (!s) return null;
    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    var sep = Math.max(lastComma, lastDot);
    var inteiro = s, frac = '';
    if (sep >= 0) {
      var depois = s.slice(sep + 1);
      // Ponto/vírgula só é decimal se vier com 1–2 dígitos; "1.500" é mil, não 1,5.
      if (depois.length >= 1 && depois.length <= 2 && (lastComma >= 0 || s.split('.').length === 2)) {
        inteiro = s.slice(0, sep); frac = depois;
      }
    }
    inteiro = inteiro.replace(/[.,]/g, '');
    if (!inteiro && !frac) return null;
    var cents = Number(inteiro || '0') * 100 + Number((frac + '00').slice(0, 2));
    return isFinite(cents) && cents >= 0 ? Math.round(cents) : null;
  }

  function formatBRL(cents) {
    var n = Math.round(Number(cents) || 0);
    var neg = n < 0; n = Math.abs(n);
    var reais = Math.floor(n / 100), cent = n % 100;
    var r = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + 'R$ ' + r + ',' + (cent < 10 ? '0' : '') + cent;
  }

  function cfgOf(c) { return Object.assign({}, DEFAULTS, c || {}); }

  // Orçamento aproximado: opcional. Vazio é válido (pedido sem estimativa). Nunca exige preço fechado.
  function validarOrcamento(texto) {
    var vazio = String(texto == null ? '' : texto).trim() === '';
    if (vazio) return { ok: true, centavos: null };
    var c = parseBRL(texto);
    if (c == null || c <= 0) return { ok: false, mensagem: 'Digite um valor válido. Exemplo: R$ 1.500,00.' };
    if (c < ORC_MIN) return { ok: false, mensagem: 'O valor mínimo é ' + formatBRL(ORC_MIN) + '.' };
    if (c > ORC_MAX) return { ok: false, mensagem: 'O valor máximo é ' + formatBRL(ORC_MAX) + '.' };
    return { ok: true, centavos: c };
  }

  // Ao sair do campo: "1500" vira "R$ 1.500,00". Texto inválido fica como está (o erro aparece).
  function formatarOrcamento(texto) {
    var v = validarOrcamento(texto);
    return v.ok && v.centavos ? formatBRL(v.centavos) : String(texto == null ? '' : texto);
  }

  function campoOrcamentoHtml() {
    return '<label class="field qf-orcamento" data-qf-orcamento>' +
      '<span class="field__label">Quanto você está disposto a gastar aproximadamente com esse serviço? <small>(valor estimado, opcional)</small></span>' +
      '<input class="input" inputmode="decimal" autocomplete="off" name="orcamentoAprox" placeholder="Ex.: R$ 1.500,00" data-qf-orcamento-input aria-describedby="qf-orc-ajuda qf-orc-erro">' +
      '<small class="field__hint" id="qf-orc-erro" data-qf-orcamento-erro role="alert"></small>' +
      '<small class="field__hint" id="qf-orc-ajuda">Só uma estimativa para o profissional. Você não está contratando e o preço final é combinado entre vocês. Publicar é grátis.</small></label>';
  }

  function orcamentoHtml(centavos) {
    var c = Number(centavos);
    if (!isFinite(c) || c <= 0) return '';
    return '<div class="qf-orcamento-box" data-qf-orcamento-box><small>Orçamento aproximado do cliente</small><strong>' + esc(formatBRL(c)) + '</strong>' +
      '<span>Valor estimado pelo cliente, não é preço fechado. O preço final é combinado entre vocês.</span></div>';
  }

  // ---------- Confirmação de interesse do cliente (selo "Interesse confirmado pelo cliente") ----------
  // Pergunta obrigatória no fim do pedido. Nenhuma opção vem marcada: interesse nunca é marcado automaticamente.
  // O selo só aparece ao profissional quando o cliente escolheu "contratar" E o banco registrou data e hora.
  // Não é garantia de contratação e o cliente não fica obrigado a contratar.
  var INTERESSE_CONTRATAR = 'contratar', INTERESSE_PESQUISANDO = 'pesquisando';

  function campoInteresseHtml() {
    return '<fieldset class="field qf-interesse" data-qf-interesse aria-describedby="qf-interesse-erro">' +
      '<legend class="field__label">Você pretende contratar um profissional?</legend>' +
      '<label class="qf-interesse__opt"><input type="radio" name="interesseContratar" value="' + INTERESSE_CONTRATAR + '" required> <span>Sim, quero receber propostas para contratar.</span></label>' +
      '<label class="qf-interesse__opt"><input type="radio" name="interesseContratar" value="' + INTERESSE_PESQUISANDO + '" required> <span>Estou apenas pesquisando preços.</span></label>' +
      '<small class="field__hint" id="qf-interesse-erro" data-qf-interesse-erro role="alert"></small></fieldset>';
  }

  // Só 'contratar' e 'pesquisando' valem; vazio ou qualquer outra coisa = ainda não respondeu (bloqueia a publicação).
  function validarInteresse(valor) {
    var v = String(valor == null ? '' : valor);
    if (v === INTERESSE_CONTRATAR || v === INTERESSE_PESQUISANDO) return { ok: true, valor: v };
    return { ok: false, valor: null, mensagem: 'Escolha uma opção: você pretende contratar um profissional?' };
  }

  // Selo verde e discreto, visível antes do desbloqueio. Sem confirmação registrada (data/hora), nada aparece.
  function seloInteresseHtml(req, compacto) {
    if (!req || req.interesseCliente !== INTERESSE_CONTRATAR || !req.interesseConfirmadoEm) return '';
    return '<span class="qf-interesse-selo' + (compacto === true ? ' qf-interesse-selo--compact' : '') + '" data-qf-interesse-selo title="O cliente disse que pretende contratar. Não é garantia de contratação.">' +
      '<span aria-hidden="true">&#10003;</span> ' + (compacto === true ? 'Interesse confirmado' : 'Interesse confirmado pelo cliente') + '</span>';
  }

  var MOTIVOS_CANCELAMENTO = [
    { id: 'imprevisto', texto: 'Imprevisto pessoal ou familiar' },
    { id: 'financeiro', texto: 'Problema financeiro' },
    { id: 'nao_precisa_mais', texto: 'O serviço não é mais necessário' },
    { id: 'nao_combinou', texto: 'Não consegui combinar com o profissional' },
    { id: 'outro', texto: 'Outro motivo' }
  ];

  var RESPOSTAS_CONCLUSAO = [
    { id: 'concluido', texto: 'Serviço concluído' },
    { id: 'com_problema', texto: 'Serviço realizado com problema' },
    { id: 'nao_realizado', texto: 'Serviço não realizado' }
  ];

  // ---------- HTML (strings puras, escapadas) ----------
  function cancelamentoHtml() {
    return '<div class="stack" data-qf-cancelar><h3 class="sheet__title">Cancelar pedido</h3>' +
      '<p class="text text--secondary">Conte o motivo. Os profissionais envolvidos serão avisados.</p>' +
      MOTIVOS_CANCELAMENTO.map(function (m, i) {
        return '<label class="qf-cancel__opt"><input type="radio" name="motivoCancelamento" value="' + m.id + '"' + (i === 0 ? ' checked' : '') + '> ' + esc(m.texto) + '</label>';
      }).join('') +
      '<textarea class="input" name="detalheCancelamento" maxlength="500" rows="2" placeholder="Detalhe (obrigatório em &quot;Outro motivo&quot;)"></textarea>' +
      '<p class="text--sm text--secondary">Créditos de quem já desbloqueou não voltam automaticamente. Se houver contato falso, o profissional pode contestar e a equipe analisa.</p>' +
      '<button class="btn btn--danger" type="button" data-qf-cancelar-ok>Cancelar pedido</button></div>';
  }

  function baixaHtml(link, expira) {
    return '<div class="stack" data-qf-baixa><h3 class="sheet__title">Solicitar finalização do serviço</h3>' +
      '<p class="text text--secondary">Peça ao cliente para ler este QR Code ou abrir o link. Só ele, logado na conta dele, confirma.</p>' +
      '<div class="qf-baixa__qr" data-qf-baixa-qr></div>' +
      '<input class="input" readonly value="' + esc(link) + '" data-qf-baixa-link aria-label="Link de confirmação">' +
      '<button class="btn btn--ghost" type="button" data-qf-baixa-zap>Enviar pelo WhatsApp</button>' +
      '<small class="text--sm text--secondary">Vale até ' + esc(String(expira || '').slice(0, 10).split('-').reverse().join('/')) + '.</small></div>';
  }

  function linkConfirmacao(origin, token) {
    return String(origin || '').replace(/\/+$/, '') + '/confirmar-servico.html#t=' + encodeURIComponent(String(token || ''));
  }
  function tokenDoHash(hash) {
    var m = /(?:^|[#&])t=([0-9a-f]{64})(?:&|$)/i.exec(String(hash || ''));
    return m ? m[1].toLowerCase() : null;
  }

  // ---------- Integração com o app (só roda no navegador, com a chave ligada) ----------
  var state = { cfg: null, loading: null };
  function client() { return global.QFCloud && global.QFCloud.client; }

  function carregarConfig(force) {
    if (!force && state.cfg) return Promise.resolve(state.cfg);
    if (state.loading && !force) return state.loading;
    var c = client();
    if (!c) { state.cfg = cfgOf(null); return Promise.resolve(state.cfg); }
    state.loading = Promise.resolve(c.rpc('qf_pedidos_valor_config')).then(function (r) {
      state.cfg = cfgOf(r && !r.error ? r.data : null);
      return state.cfg;
    }).catch(function () { state.cfg = cfgOf(null); return state.cfg; }).then(function (x) { state.loading = null; return x; });
    return state.loading;
  }
  function ativo() { return !!(state.cfg && state.cfg.ativo === true); }

  // Anexa o orçamento aproximado nos pedidos já carregados. Falha em silêncio: sem ele o app segue como era.
  function enriquecerOrcamento(reqs) {
    var c = client();
    if (!c || !reqs || !reqs.length) return Promise.resolve(reqs);
    var ids = reqs.filter(function (r) { return r && r.id && r.orcamentoAproxCentavos == null; }).map(function (r) { return r.id; }).slice(0, 100);
    if (!ids.length) return Promise.resolve(reqs);
    return Promise.resolve(c.rpc('qf_orcamento_info_chamados', { p_ids: ids })).then(function (r) {
      if (!r || r.error || !Array.isArray(r.data)) return reqs;
      var mapa = {};
      r.data.forEach(function (i) { mapa[i.chamado_id] = Number(i.orcamento_aproximado_centavos); });
      reqs.forEach(function (q) { if (q && mapa[q.id] > 0) q.orcamentoAproxCentavos = mapa[q.id]; });
      return reqs;
    }).catch(function () { return reqs; });
  }

  // Anexa o selo de interesse nos pedidos já carregados. O banco só devolve quem confirmou 'contratar'.
  // Falha em silêncio: sem ele o app segue como era (e nenhum selo é mostrado).
  function enriquecerInteresse(reqs) {
    var c = client();
    if (!c || !reqs || !reqs.length) return Promise.resolve(reqs);
    var ids = reqs.filter(function (r) { return r && r.id && !r.interesseConfirmadoEm; }).map(function (r) { return r.id; }).slice(0, 100);
    if (!ids.length) return Promise.resolve(reqs);
    return Promise.resolve(c.rpc('qf_interesse_info_chamados', { p_ids: ids })).then(function (r) {
      if (!r || r.error || !Array.isArray(r.data)) return reqs;
      var mapa = {};
      r.data.forEach(function (i) { if (i && i.chamado_id && i.interesse_confirmado_em) mapa[i.chamado_id] = i.interesse_confirmado_em; });
      reqs.forEach(function (q) { if (q && mapa[q.id]) { q.interesseCliente = INTERESSE_CONTRATAR; q.interesseConfirmadoEm = mapa[q.id]; } });
      return reqs;
    }).catch(function () { return reqs; });
  }

  function rpc(nome, args) {
    var c = client();
    if (!c) return Promise.resolve({ ok: false, reason: 'sem_conexao' });
    return Promise.resolve(c.rpc(nome, args)).then(function (r) {
      if (r.error) return { ok: false, reason: 'erro', error: r.error.message };
      return r.data || { ok: false, reason: 'erro' };
    });
  }

  // ---------- Telas (cola com o app; não é testada em node) ----------
  var qrPromise = null;
  function carregarQr() {
    if (global.QRCode) return Promise.resolve(global.QRCode);
    if (qrPromise) return qrPromise;
    qrPromise = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
      sc.onload = function () { global.QRCode ? resolve(global.QRCode) : reject(new Error('QR indisponível')); };
      sc.onerror = function () { reject(new Error('QR indisponível')); };
      document.head.appendChild(sc);
    });
    return qrPromise;
  }

  function abrirCancelamento(chamadoId, aoTerminar) {
    var PU = global.PU;
    PU.openSheet(cancelamentoHtml());
    var raiz = document.querySelector('[data-qf-cancelar]');
    if (!raiz) return;
    raiz.querySelector('[data-qf-cancelar-ok]').onclick = function (ev) {
      var btn = ev.currentTarget;
      var motivoEl = raiz.querySelector('input[name="motivoCancelamento"]:checked');
      var detalhe = String(raiz.querySelector('[name="detalheCancelamento"]').value || '').trim();
      var motivo = motivoEl ? motivoEl.value : '';
      if (!motivo) { PU.toast('Escolha o motivo do cancelamento.', 'danger'); return; }
      if (motivo === 'outro' && detalhe.length < 3) { PU.toast('Conte brevemente o outro motivo.', 'danger'); return; }
      btn.disabled = true;
      api.cancelar(chamadoId, motivo, detalhe).then(function (out) {
        if (out && out.ok) { PU.closeSheet(); PU.toast('Pedido cancelado. Os profissionais envolvidos foram avisados.', 'success', 5000); if (aoTerminar) aoTerminar(out); return; }
        btn.disabled = false;
        PU.toast(out && out.reason === 'status_invalido' ? 'Este pedido não pode mais ser cancelado.' : 'Não foi possível cancelar agora. Tente de novo.', 'danger');
      });
    };
  }

  var MOTIVOS_CONTESTACAO = [
    { id: 'contato_falso', texto: 'O contato é falso' },
    { id: 'contato_invalido', texto: 'O número não existe / não atende' },
    { id: 'cliente_cancelou', texto: 'O cliente me disse que cancelou' },
    { id: 'outro', texto: 'Outro motivo' }
  ];
  function contestacaoHtml() {
    return '<div class="stack" data-qf-contestar><h3 class="sheet__title">Contestar desbloqueio</h3>' +
      '<p class="text text--secondary">A equipe analisa com as evidências. O estorno só acontece se o problema for comprovado.</p>' +
      MOTIVOS_CONTESTACAO.map(function (m, i) { return '<label class="qf-cancel__opt"><input type="radio" name="motivoContestacao" value="' + m.id + '"' + (i === 0 ? ' checked' : '') + '> ' + esc(m.texto) + '</label>'; }).join('') +
      '<textarea class="input" name="descContestacao" maxlength="1000" rows="3" placeholder="O que aconteceu? (mínimo 10 letras)"></textarea>' +
      '<textarea class="input" name="evidContestacao" maxlength="2000" rows="2" placeholder="Evidências: horários das tentativas, prints, links (opcional)"></textarea>' +
      '<button class="btn btn--primary" type="button" data-qf-contestar-ok>Enviar contestação</button></div>';
  }
  function abrirContestacao(chamadoId) {
    var PU = global.PU, c = client();
    if (!c) return;
    PU.openSheet(contestacaoHtml());
    var raiz = document.querySelector('[data-qf-contestar]');
    if (!raiz) return;
    raiz.querySelector('[data-qf-contestar-ok]').onclick = function (ev) {
      var btn = ev.currentTarget;
      var motivo = (raiz.querySelector('input[name="motivoContestacao"]:checked') || {}).value;
      var desc = String(raiz.querySelector('[name="descContestacao"]').value || '').trim();
      var evid = String(raiz.querySelector('[name="evidContestacao"]').value || '').trim();
      if (desc.length < 10) { PU.toast('Descreva o problema com pelo menos 10 letras.', 'danger'); return; }
      btn.disabled = true;
      Promise.resolve(c.auth.getUser()).then(function (u) {
        var uid = u && u.data && u.data.user && u.data.user.id;
        return c.from('qf_desbloqueios').select('id').eq('chamado_id', chamadoId).eq('profissional_id', uid).limit(1);
      }).then(function (r) {
        var d = r && r.data && r.data[0];
        if (!d) return { ok: false, reason: 'sem_permissao' };
        return api.contestar(d.id, motivo, desc, evid);
      }).then(function (out) {
        btn.disabled = false;
        if (out && out.ok) { PU.closeSheet(); PU.toast('Contestação enviada. Vamos analisar.', 'success', 5000); return; }
        var m = { ja_contestado: 'Este desbloqueio já foi contestado.', prazo_encerrado: 'O prazo para contestar terminou.', sem_permissao: 'Você não desbloqueou este pedido.' };
        PU.toast(m[out && out.reason] || 'Não foi possível enviar agora.', 'danger');
      }).catch(function () { btn.disabled = false; PU.toast('Não foi possível enviar agora.', 'danger'); });
    };
  }

  function montarBaixa(content, chamadoId) {
    var PU = global.PU;
    if (!ativo() || !content || content.querySelector('[data-qf-baixa-btn]')) return;
    var req = global.DB && global.DB.requestById && global.DB.requestById(chamadoId);
    if (!req || !req.profissionalId) return; // só quem desbloqueou
    var view = content.querySelector('.view') || content;
    var sec = document.createElement('div');
    sec.className = 'section card stack--sm';
    sec.innerHTML = '<div class="text--strong">Atendimento feito?</div>' +
      '<p class="text--sm text--secondary">Peça ao cliente para confirmar. Só ele confirma, e a avaliação é dele.</p>' +
      '<button class="btn btn--primary btn--block" type="button" data-qf-baixa-btn>Solicitar finalização do serviço</button>' +
      '<button class="btn btn--ghost btn--block" type="button" data-qf-contestar-btn>Contato falso ou inválido? Contestar desbloqueio</button>';
    view.appendChild(sec);
    sec.querySelector('[data-qf-contestar-btn]').onclick = function () { abrirContestacao(chamadoId); };
    sec.querySelector('[data-qf-baixa-btn]').onclick = function (ev) {
      var btn = ev.currentTarget; btn.disabled = true;
      api.solicitarBaixa(chamadoId).then(function (out) {
        btn.disabled = false;
        if (!out || !out.ok) {
          var m = { sem_desbloqueio: 'Você não desbloqueou este pedido.', status_invalido: 'Este pedido não está em atendimento.', limite: 'Muitas solicitações hoje. Tente amanhã.', desativado: 'Recurso ainda não disponível.' };
          PU.toast(m[out && out.reason] || 'Não foi possível solicitar a baixa agora.', 'danger'); return;
        }
        var link = linkConfirmacao(global.location.origin, out.token);
        PU.openSheet(baixaHtml(link, out.expira_em));
        var raiz = document.querySelector('[data-qf-baixa]');
        if (!raiz) return;
        raiz.querySelector('[data-qf-baixa-zap]').onclick = function () {
          global.open('https://wa.me/?text=' + encodeURIComponent('Confirme o serviço no Quem Faz: ' + link), '_blank', 'noopener');
        };
        carregarQr().then(function (QR) {
          var alvo = raiz.querySelector('[data-qf-baixa-qr]');
          if (alvo && !alvo.firstChild) new QR(alvo, { text: link, width: 220, height: 220, correctLevel: QR.CorrectLevel.M });
        }).catch(function () {});
      });
    };
  }

  var api = {
    MOTIVOS_CANCELAMENTO: MOTIVOS_CANCELAMENTO, RESPOSTAS_CONCLUSAO: RESPOSTAS_CONCLUSAO,
    esc: esc, parseBRL: parseBRL, formatBRL: formatBRL, 
    validarOrcamento: validarOrcamento, formatarOrcamento: formatarOrcamento, campoOrcamentoHtml: campoOrcamentoHtml, orcamentoHtml: orcamentoHtml,
    cancelamentoHtml: cancelamentoHtml, contestacaoHtml: contestacaoHtml, MOTIVOS_CONTESTACAO: MOTIVOS_CONTESTACAO, baixaHtml: baixaHtml, linkConfirmacao: linkConfirmacao, tokenDoHash: tokenDoHash,
    INTERESSE_CONTRATAR: INTERESSE_CONTRATAR, INTERESSE_PESQUISANDO: INTERESSE_PESQUISANDO,
    campoInteresseHtml: campoInteresseHtml, validarInteresse: validarInteresse, seloInteresseHtml: seloInteresseHtml, enriquecerInteresse: enriquecerInteresse,
    carregarConfig: carregarConfig, ativo: ativo, enriquecerOrcamento: enriquecerOrcamento,
    abrirCancelamento: abrirCancelamento, montarBaixa: montarBaixa,
    config: function () { return cfgOf(state.cfg); },
    cancelar: function (id, motivo, detalhe) { return rpc('qf_cliente_cancelar_pedido', { p_chamado_id: id, p_motivo: motivo, p_detalhe: detalhe || null }); },
    solicitarBaixa: function (id) { return rpc('qf_solicitar_baixa', { p_chamado_id: id }); },
    pendentes: function (token, carteirinha) { return rpc('qf_cliente_conclusoes_pendentes', { p_token: token || null, p_carteirinha: carteirinha || null }); },
    responder: function (id, resposta, nota, comentario, problema, token) {
      return rpc('qf_conclusao_responder', { p_conclusao_id: id, p_resposta: resposta, p_nota: nota == null ? null : nota, p_comentario: comentario || null, p_problema: problema || null, p_token: token || null });
    },
    contestar: function (desbloqueioId, motivo, descricao, evidencias) {
      return rpc('qf_contestar_desbloqueio', { p_desbloqueio_id: desbloqueioId, p_motivo: motivo, p_descricao: descricao, p_evidencias: evidencias || null });
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.QFValor = api;
})(typeof window !== 'undefined' ? window : globalThis);
