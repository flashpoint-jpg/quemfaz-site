/* QuemFaz — Pedidos com valor definido, cancelamento, baixa por QR e confirmação do cliente.
   TUDO fica atrás da chave `pedidos_valor_definido` (qf_config). Com a chave desligada nada muda na tela.
   A parte pura (valor, taxa, textos, HTML) é testada em tests/valor-definido-front.test.cjs.
   A regra de verdade (valor, taxa, teto, débito, limite de 1 profissional) vive no banco; aqui só mostramos. */
(function (global) {
  'use strict';

  var DEFAULTS = { ativo: false, percentual_bps: 600, valor_min_centavos: 2000, valor_max_centavos: 50000000 };
  var ROTULO = 'Valor confirmado pelo cliente';

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

  function validarValor(cents, cfg) {
    var c = cfgOf(cfg);
    if (cents == null || !isFinite(cents) || cents <= 0) return { ok: false, motivo: 'obrigatorio', mensagem: 'Informe quanto você pode pagar pelo serviço.' };
    if (cents < c.valor_min_centavos) return { ok: false, motivo: 'minimo', mensagem: 'O valor mínimo é ' + formatBRL(c.valor_min_centavos) + '.' };
    if (cents > c.valor_max_centavos) return { ok: false, motivo: 'maximo', mensagem: 'O valor máximo é ' + formatBRL(c.valor_max_centavos) + '.' };
    return { ok: true };
  }

  // Mesma regra do banco (arredonda meio para cima, aplica teto). É só PRÉVIA: quem cobra é o banco.
  function calcularTaxa(valorCents, bps, tetoCents) {
    var v = Math.round(Number(valorCents) || 0);
    if (v <= 0) return 0;
    var t = Math.floor((v * Number(bps == null ? 600 : bps) + 5000) / 10000);
    if (tetoCents != null && Number(tetoCents) > 0) t = Math.min(t, Number(tetoCents));
    return Math.max(t, 0);
  }

  // Valida o que o formulário vai enviar para o pedido B. Devolve a linha extra do insert ou o erro.
  function montarCamposPedido(entrada, cfg, agora) {
    var e = entrada || {};
    if (e.modalidade !== 'valor_definido') return { ok: true, campos: { modalidade: 'contatos' } };
    var cents = typeof e.valorCentavos === 'number' ? e.valorCentavos : parseBRL(e.valorTexto);
    var v = validarValor(cents, cfg);
    if (!v.ok) return { ok: false, campo: 'valor', mensagem: v.mensagem };
    if (e.materialIncluso !== true && e.materialIncluso !== false) return { ok: false, campo: 'material', mensagem: 'Diga se o material está incluso no valor.' };
    if (!e.confirmou) return { ok: false, campo: 'confirmacao', mensagem: 'Confirme que pretende contratar pelo valor informado.' };
    if (String(e.descricao || '').trim().length < 10) return { ok: false, campo: 'descricao', mensagem: 'Descreva o serviço (mínimo de 10 letras).' };
    var cond = String(e.condicoes || '').trim().slice(0, 500);
    return {
      ok: true,
      campos: {
        modalidade: 'valor_definido',
        valor_oferecido_centavos: cents,
        material_incluso: e.materialIncluso,
        valor_confirmado_em: (agora || new Date()).toISOString(),
        condicoes_valor: cond || null,
        max_orcamentos: 1
      }
    };
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

  function mensagemDesbloqueio(out) {
    out = out || {};
    var m = {
      desativado: 'Este tipo de pedido ainda não está disponível.',
      avaliacao_pendente: 'Finalize e avalie o serviço pendente antes de aceitar outro chamado.',
      selfie_obrigatoria: 'Envie sua selfie de verificação para desbloquear pedidos.',
      modalidade_invalida: 'Este pedido não tem valor definido.',
      sem_permissao: 'Você não pode desbloquear este pedido.',
      ja_participou: 'Você já desbloqueou este pedido.',
      indisponivel: 'Este pedido não está mais disponível.',
      reservado: 'Outro profissional acabou de desbloquear este pedido.',
      nao_elegivel: 'Este pedido não é da sua profissão ou está fora da sua região.',
      taxa_mudou: 'A taxa mudou. Confira o novo valor antes de continuar.'
    };
    if (out.reason === 'saldo_insuficiente') {
      return 'Faltam ' + formatBRL(out.falta != null ? out.falta : Math.max(0, Number(out.taxa || 0) - Number(out.saldo || 0))) + ' em créditos para pagar a taxa de ' + formatBRL(out.taxa) + '.';
    }
    return m[out.reason] || 'Não foi possível desbloquear este pedido.';
  }

  // ---------- HTML (strings puras, escapadas) ----------
  function etiquetaHtml() {
    return '<span class="badge badge--success qf-valor-etiqueta" data-qf-valor-etiqueta>' + esc(ROTULO) + '</span>';
  }

  function resumoValorHtml(info) {
    if (!info || info.modalidade !== 'valor_definido') return '';
    var linhas = '<div class="qf-valor-box" data-qf-valor-box>' +
      etiquetaHtml() +
      '<div class="qf-valor-box__valor"><small>Valor que o cliente quer pagar</small><strong>' + esc(formatBRL(info.valor)) + '</strong></div>' +
      '<div class="qf-valor-box__linha">' + (info.materialIncluso ? 'Material incluso no valor' : 'Material por conta do cliente') + '</div>';
    if (info.taxa != null) {
      linhas += '<div class="qf-valor-box__linha">Taxa de indicação para liberar o contato: <strong>' + esc(formatBRL(info.taxa)) + '</strong></div>' +
        '<div class="qf-valor-box__nota">Você paga só a taxa. O combinado do serviço é direto com o cliente, sujeito à confirmação do escopo.</div>';
    }
    return linhas + '</div>';
  }

  function seletorModalidadeHtml(cfg) {
    var c = cfgOf(cfg);
    return '<div class="field qf-modalidade" data-qf-modalidade role="radiogroup" aria-labelledby="qf-modalidade-label">' +
      '<span class="field__label" id="qf-modalidade-label">Como você quer contratar?</span>' +
      '<button type="button" class="qf-envio__opt" role="radio" aria-checked="true" data-qf-modalidade-opt="contatos">' +
        '<span class="qf-envio__topo"><span class="qf-envio__radio" aria-hidden="true"></span><span class="qf-envio__nome">Receber até 4 contatos</span><span class="qf-envio__preco qf-envio__preco--gratis">Grátis</span></span>' +
        '<span class="qf-envio__desc">Profissionais da região chamam você e cada um passa o preço.</span></button>' +
      '<button type="button" class="qf-envio__opt" role="radio" aria-checked="false" data-qf-modalidade-opt="valor_definido">' +
        '<span class="qf-envio__topo"><span class="qf-envio__radio" aria-hidden="true"></span><span class="qf-envio__nome">Já tenho um valor para pagar</span></span>' +
        '<span class="qf-envio__desc">Você diz quanto pode pagar e só 1 profissional recebe o seu contato.</span></button>' +
      '<input type="hidden" name="modalidade" value="contatos">' +
      '<div data-qf-valor-campos hidden>' +
        '<label class="field"><span class="field__label">Quanto você pode pagar pelo serviço? (R$)</span>' +
          '<input class="input" inputmode="decimal" autocomplete="off" name="valorTexto" placeholder="Ex.: 1.500,00" data-qf-valor-input>' +
          '<small class="field__hint" data-qf-valor-erro role="alert"></small>' +
          '<small class="field__hint">Entre ' + esc(formatBRL(c.valor_min_centavos)) + ' e ' + esc(formatBRL(c.valor_max_centavos)) + '.</small></label>' +
        '<div class="field"><span class="field__label">O material está incluso no valor?</span>' +
          '<label><input type="radio" name="materialIncluso" value="1"> Sim, material incluso</label> ' +
          '<label><input type="radio" name="materialIncluso" value="0"> Não, o material é à parte</label></div>' +
        '<label class="field"><span class="field__label">Condições (opcional)</span>' +
          '<textarea class="input" name="condicoesValor" maxlength="500" rows="2" placeholder="Ex.: pagamento após a conclusão"></textarea></label>' +
        '<label class="qf-valor-confirma"><input type="checkbox" name="confirmaValor" value="1"> Confirmo que pretendo contratar o serviço pelo valor informado.</label>' +
      '</div></div>';
  }

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

  // Anexa valor/taxa nos pedidos já carregados. Falha em silêncio: sem a camada, o app segue como era.
  function enriquecer(reqs) {
    var c = client();
    if (!ativo() || !c || !reqs || !reqs.length) return Promise.resolve(reqs);
    var ids = reqs.map(function (r) { return r.id; }).filter(Boolean).slice(0, 100);
    return Promise.resolve(c.rpc('qf_valor_info_chamados', { p_ids: ids })).then(function (r) {
      if (!r || r.error || !Array.isArray(r.data)) return reqs;
      var mapa = {};
      r.data.forEach(function (i) { mapa[i.chamado_id] = i; });
      reqs.forEach(function (q) {
        var i = mapa[q.id];
        if (!i) return;
        q.modalidade = 'valor_definido';
        q.valorDefinido = { modalidade: 'valor_definido', valor: Number(i.valor_oferecido_centavos), materialIncluso: !!i.material_incluso, taxa: i.taxa_centavos == null ? null : Number(i.taxa_centavos), vagas: Number(i.vagas) };
      });
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
    ROTULO: ROTULO, MOTIVOS_CANCELAMENTO: MOTIVOS_CANCELAMENTO, RESPOSTAS_CONCLUSAO: RESPOSTAS_CONCLUSAO,
    esc: esc, parseBRL: parseBRL, formatBRL: formatBRL, validarValor: validarValor, calcularTaxa: calcularTaxa,
    montarCamposPedido: montarCamposPedido, mensagemDesbloqueio: mensagemDesbloqueio,
    etiquetaHtml: etiquetaHtml, resumoValorHtml: resumoValorHtml, seletorModalidadeHtml: seletorModalidadeHtml,
    cancelamentoHtml: cancelamentoHtml, contestacaoHtml: contestacaoHtml, MOTIVOS_CONTESTACAO: MOTIVOS_CONTESTACAO, baixaHtml: baixaHtml, linkConfirmacao: linkConfirmacao, tokenDoHash: tokenDoHash,
    carregarConfig: carregarConfig, ativo: ativo, enriquecer: enriquecer,
    abrirCancelamento: abrirCancelamento, montarBaixa: montarBaixa,
    config: function () { return cfgOf(state.cfg); },
    desbloquear: function (id, taxa) { return rpc('qf_desbloquear_chamado_valor', { p_chamado_id: id, p_taxa_confirmada_centavos: taxa }); },
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
