/* QuemFaz 11.36 — anúncios entram na home; atribuição e conversão sem dados pessoais.
   11.96: eventos pedido_iniciado / pedido_formulario_avancado / pedido_publicado para as plataformas de anúncio. */
(function (global) {
  'use strict';
  // Links de verificação/recuperação contêm tokens privados: não carregar tags de medição.
  if (/^#\/auth\/cliente\/(verificar|redefinir)\//.test(location.hash)) return;

  var QF_DOMINIO_OFICIAL = /^(?:www\.)?quemfazservico\.com\.br$/i.test(location.hostname);
  // Meta Pixel: mede PageView e permite que o evento Lead abaixo seja enviado somente após o pedido salvo.
  var QF_META_PIXEL_ID = '1124265238584181';
  function ensureMetaPixel() {
    if (!QF_DOMINIO_OFICIAL || location.search.indexOf('demo=1') !== -1 || typeof global.fbq === 'function') return;
    try {
      var n = global.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!global._fbq) global._fbq = n;
      n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      var t = document.createElement('script');
      t.async = true; t.src = 'https://connect.facebook.net/en_US/fbevents.js';
      var s = document.getElementsByTagName('script')[0];
      if (s && s.parentNode) s.parentNode.insertBefore(t, s); else document.head.appendChild(t);
      global.fbq('init', QF_META_PIXEL_ID);
      global.fbq('track', 'PageView');
    } catch (_) {}
  }
  ensureMetaPixel();
  // Preserva o clique pago ao longo do formulario, sem transformar busca organica em anuncio.
  // Sem identificador de clique ou UTM, nao atribuir uma visita paga.
  var QF_ATTR_KEY = 'qf_ads_attribution_v1';
  function readAdTouch() {
    var saved = {};
    try { saved = JSON.parse(global.sessionStorage.getItem(QF_ATTR_KEY) || '{}') || {}; } catch (_) {}
    var p = new URLSearchParams(location.search || '');
    var fresh = {};
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','gbraid','wbraid','fbclid'].forEach(function (k) {
      var v = p.get(k);
      if (v) fresh[k] = String(v).slice(0, /^(gclid|gbraid|wbraid)$/.test(k) ? 512 : 240);
    });
    var hasFresh = Object.keys(fresh).length > 0;
    if (hasFresh) {
      var touch = {
        source: fresh.utm_source || ((fresh.gclid || fresh.gbraid || fresh.wbraid) ? 'google' : (fresh.fbclid ? 'facebook' : '')),
        medium: fresh.utm_medium || ((fresh.gclid || fresh.gbraid || fresh.wbraid) ? 'cpc' : (fresh.fbclid ? 'paid_social' : '')),
        campaign: fresh.utm_campaign || '',
        content: fresh.utm_content || '',
        term: fresh.utm_term || '',
        gclid: fresh.gclid || '', gbraid: fresh.gbraid || '', wbraid: fresh.wbraid || '',
        fbclid: fresh.fbclid || ''
      };
      try { global.sessionStorage.setItem(QF_ATTR_KEY, JSON.stringify(touch)); } catch (_) {}
      return touch;
    }
    return saved;
  }
  var capturedTouch = readAdTouch();
  // A publicacao de pedidos usa tambem QFMarketingTouch. Sincroniza dados de campanha
  // identificados no URL para que o referenciador ChatGPT nao substitua utm_source.
  if (capturedTouch.source && (capturedTouch.medium || capturedTouch.campaign || capturedTouch.gclid || capturedTouch.gbraid || capturedTouch.fbclid)) {
    global.QFMarketingTouch = Object.assign({}, global.QFMarketingTouch || {}, capturedTouch);
  }
  var campaign = global.QFMarketingTouch || capturedTouch || {};
  var sid;
  try {
    sid = sessionStorage.getItem('qf_funnel_session_v2');
    if (!sid) { sid = global.crypto.randomUUID(); sessionStorage.setItem('qf_funnel_session_v2', sid); }
  } catch (_) { sid = global.crypto.randomUUID(); }
  var seen = {}, submittedAt = 0;
  var services = {
    pintor: 'cat_pintor', eletricista: 'cat_eletricista', encanador: 'cat_encanador', montador: 'cat_montador', montagem: 'cat_montador',
    tecnico_refrigeracao: 'cat_geladeira', tecnico_geladeira: 'cat_geladeira', geladeira: 'cat_geladeira',
    fogao: 'cat_fogao_microondas', microondas: 'cat_fogao_microondas', fogao_microondas: 'cat_fogao_microondas',
    chaveiro: 'cat_chaveiro', antenista: 'cat_antenista', faxina_pos_obra: 'cat_faxina_pos_obra', limpeza_pos_obra: 'cat_faxina_pos_obra',
    pedreiro: 'cat_pedreiro', desentupidor: 'cat_desentupidor', telhadista: 'cat_telhadista',
    limpeza_sofa: 'cat_limpeza_estofados', marido_aluguel: 'cat_marido_aluguel', diarista: 'cat_diarista',
    azulejista: 'cat_azulejista', gesseiro: 'cat_gesseiro', impermeabilizacao: 'cat_impermeabilizacao', caixa_dagua: 'cat_caixa_dagua',
    ar_condicionado: 'cat_arcondicionado', arcondicionado: 'cat_arcondicionado',
    marceneiro: 'cat_marceneiro', piso: 'cat_azulejista', pisos: 'cat_azulejista',
    faxina: 'cat_faxina_pos_obra', estofado: 'cat_limpeza_estofados', sofa: 'cat_limpeza_estofados'
  };
  // Ordem importa: o termo mais especifico vem antes do generico.
  var textCategories = [
    ['caixa de agua', 'cat_caixa_dagua'], ['caixa d agua', 'cat_caixa_dagua'],
    ['pos obra', 'cat_faxina_pos_obra'], ['faxina', 'cat_faxina_pos_obra'],
    ['estofado', 'cat_limpeza_estofados'], ['sofa', 'cat_limpeza_estofados'],
    ['diarista', 'cat_diarista'], ['ar condicionado', 'cat_arcondicionado'],
    ['marceneiro', 'cat_marceneiro'], ['marido de aluguel', 'cat_marido_aluguel'],
    ['montador', 'cat_montador'], ['montagem', 'cat_montador'],
    ['azulejista', 'cat_azulejista'], ['piso', 'cat_azulejista'],
    ['eletricista', 'cat_eletricista'], ['pedreiro', 'cat_pedreiro'],
    ['pintor', 'cat_pintor'], ['encanador', 'cat_encanador'], ['gesseiro', 'cat_gesseiro']
  ];
  function normalizeText(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ');
  }
  function categoryFromText(text) {
    var norm = normalizeText(text);
    if (!norm.trim()) return null;
    for (var i = 0; i < textCategories.length; i++) {
      if (norm.indexOf(textCategories[i][0]) !== -1) return textCategories[i][1];
    }
    return null;
  }
  function serviceFromLink(search) {
    var p = new URLSearchParams(search || '');
    var explicit = p.get('servico');
    if (explicit) return services[explicit] || (/^cat_[a-z0-9_]+$/.test(explicit) ? explicit : null);
    var campaign = p.get('utm_campaign') || '';
    // Somente campanhas de clientes preenchem o servico; campanhas de profissionais nao.
    var isClientCampaign = /clientes/i.test(campaign) || /^qf_[a-z0-9_]*_nov26$/.test(campaign);
    if (!isClientCampaign) return null;
    var source = (p.get('utm_source') || '').toLowerCase();
    var medium = (p.get('utm_medium') || '').toLowerCase();
    var paid = source === 'google' || source === 'facebook' || source === 'instagram' || medium === 'cpc' || medium === 'paid_social';
    if (!paid) return null;
    var content = (p.get('utm_content') || '').toLowerCase();
    if (content) {
      if (services[content]) return services[content];
      if (/^cat_[a-z0-9_]+$/.test(content)) return content;
    }
    // Termo de busca e nome do grupo de anuncios indicam o servico procurado.
    return categoryFromText([p.get('utm_term') || '', content, campaign].join(' '));
  }
  function applyDestination() {
    var cat = serviceFromLink(location.search);
    if (!cat || !global.DB || !global.DB.categoryById(cat)) return;
    // Guarda o serviço anunciado, mas mantém o visitante na página inicial.
    // Links explícitos para formulário e outras telas continuam funcionando normalmente.
    if (!/^#\/(?:calculadora\/?|auth\/cliente\/cadastro\/?|)?$/.test(location.hash || '#/')) return;
    try { sessionStorage.setItem('qf_pending_category', cat); } catch (_) {}
    // Mantém a home como entrada, mas mostra o serviço pesquisado no campo principal.
    // O formulário lê a mesma categoria quando o visitante continuar.
    var selected = global.DB.categoryById(cat);
    if (selected) {
      var home = document.querySelector('[data-landing-service-search]');
      if (home && !String(home.value || '').trim()) {
        home.value = selected.nome;
        home.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }
  // Identifica a página local que iniciou o pedido, sem inventar origem ou campanha.
  try {
    var servicePath = /^\/servicos(?:\/[a-z0-9-]+){0,2}\/$/;
    var seoPage = servicePath.test(location.pathname) ? location.pathname : new URLSearchParams(location.search).get('seo_page');
    if (seoPage && servicePath.test(seoPage)) sessionStorage.setItem('qf_seo_page', seoPage);
  } catch (_) {}
  function attribution() {
    var live = global.QFMarketingTouch || {};
    // O identificador explicito de campanha/click tem prioridade sobre referenciadores genericos.
    // Evita que chatgpt.com ou outra origem de navegacao sobrescreva utm_source=google.
    var touch = Object.assign({}, live, capturedTouch);
    // Identificadores de clique confirmam origem paga mesmo sem UTM.
    if (!touch.source && (touch.gclid || touch.gbraid || touch.wbraid)) {
      touch.source = 'google'; touch.medium = touch.medium || 'cpc';
    }
    var out = {};
    ['source', 'medium', 'campaign', 'content', 'term', 'click_id', 'click_type', 'gclid', 'gbraid', 'wbraid', 'gad_campaignid', 'fbclid'].forEach(function (key) {
      if (touch[key]) out[key] = String(touch[key]).slice(0, /^(click_id|gclid|gbraid)$/.test(key) ? 512 : 240);
    });
    if (!out.fbclid && touch.click_type === 'fbclid' && touch.click_id) out.fbclid = String(touch.click_id).slice(0, 512);
    // Sem UTM não significa anúncio: registra apenas o referenciador conhecido,
    // sem classificar esse acesso como campanha paga.
    if (!out.source) {
      try {
        var host = new URL(document.referrer).hostname.toLowerCase();
        if (/(^|\.)google\./.test(host)) out.source = 'google_referral';
        else if (/(^|\.)(facebook\.com|fb\.com|instagram\.com)$/.test(host)) out.source = 'meta_referral';
        else if (/(^|\.)bing\.com$/.test(host)) out.source = 'bing_referral';
      } catch (_) {}
    }
    if (!out.source) out.source = 'direto';
    try {
      var landing = sessionStorage.getItem('qf_seo_page');
      if (landing && servicePath.test(landing)) {
        out.landing_page = landing;
        if (!out.content) out.content = landing;
      }
    } catch (_) {}
    return Object.assign(out,global.QFMarketingDedicado?.attribution?.()||{});
  }
  // Eventos de conversão para Google Ads / GA4 / Microsoft Ads (ver qf-conversao.js). Sem dados pessoais.
  // Começar pela busca da home também é iniciar o pedido; a etapa 1 concluída garante o "iniciado" antes (ordem do funil).
  var adEvents = { home_submit: 'pedido_iniciado', form_start: 'pedido_iniciado', step_service_completed: 'pedido_formulario_avancado' };
  function adEvent(name, detail) {
    try { if (global.QFConversao) global.QFConversao.evento(name, detail || {}); } catch (_) {}
  }
  function track(event, detail, once) {
    if (location.search.indexOf('demo=1') !== -1) return;
    detail = detail || {};
    if (adEvents[event]) {
      var adCat = detail.category || (function () { try { return sessionStorage.getItem('qf_pending_category'); } catch (_) { return null; } })();
      if (event === 'step_service_completed') adEvent('pedido_iniciado', { categoria: adCat });
      adEvent(adEvents[event], { categoria: adCat });
    }
    var key = event + ':' + (detail.category || '') + ':' + (detail.request_id || '');
    if (once && seen[key]) return;
    seen[key] = true;
    var origin = attribution();
    var row = {
      id: global.crypto.randomUUID(), measurement_version: 2, session_id: sid, event: event, category: String(detail.category || '').slice(0, 120) || null,
      source: origin.source || null,
      campaign: origin.campaign || null,
      content: origin.content || null,
      request_id: detail.request_id || null,
      error_code: String(detail.error_code || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || null,
      duration_ms: submittedAt ? Math.min(3600000, Math.max(0, Date.now() - submittedAt)) : null
    };
    // Falha na medição jamais impede o pedido; não envia nomes, telefone ou texto do serviço.
    function send(attempt) {
      var client = global.QFCloud && global.QFCloud.client;
      function retry() {
        if (attempt < 3) global.setTimeout(function () { send(attempt + 1); }, 1000 * (attempt + 1));
        else delete seen[key];
      }
      if (!client) { retry(); return; }
      // O mesmo UUID torna as retentativas idempotentes, inclusive após resposta perdida.
      Promise.resolve(client.from('qf_client_funnel').insert(row)).then(function (r) {
        if (r.error && r.error.code !== '23505') retry();
      }).catch(retry);
    }
    send(0);
  }

  function published(req, category) {
    if (!req || !req.id || !(global.QFCloud && global.QFCloud.enabled)) return;
    // Pedido urgente aguardando Pix ainda não foi publicado: não enviar Lead nem conversão.
    if (req.aguardandoPagamento) {
      track('awaiting_payment', { category: category, request_id: req.id }, true);
      return;
    }
    track('published', { category: category, request_id: req.id }, true);
    var key = 'qf_conversion_' + req.id;
    if (seen[key]) return;
    try { if (localStorage.getItem(key)) return; } catch (_) {}
    seen[key] = true;
    try { localStorage.setItem(key, '1'); } catch (_) {}
    try {
      if (QF_DOMINIO_OFICIAL && typeof global.fbq === 'function') global.fbq('track', 'Lead', {
        content_name: 'QuemFaz Pedido de Serviço', content_category: category || 'servico', role: 'cliente'
      }, { eventID: 'qf_pedido_' + req.id });
    } catch (_) {}
    // Google Ads é enviado por QFConversao, para a conta nova e com consentimento.
    // GA4 e Microsoft Ads: mesmo momento e mesma regra (pedido confirmado no Supabase, uma vez por pedido).
    adEvent('pedido_publicado', { request_id: req.id, categoria: category });
  }
  global.QFClientAcquisition = { services: services, serviceFromLink: serviceFromLink, applyDestination: applyDestination, attribution: attribution, track: track, published: published };
  global.addEventListener('DOMContentLoaded', function () {
    if (!/profissional|recrutamento/.test(location.hash || '') && !/profissionais/i.test(campaign.campaign || '')) track('landing', {}, true);
    // O visitante que precisa de um serviço vê primeiro o pedido; planos e publicidade
    // continuam disponíveis abaixo, sem alterar cadastro, atendimento ou pagamentos.
    function prioritizeClientHome() {
      var shell = document.getElementById('app-shell');
      if (!shell || typeof shell.getAttribute !== 'function' || shell.getAttribute('data-route') !== 'inicio') return;
      var landing = shell.querySelector('.qf-landing');
      if (!landing) return;
      var hero = landing.querySelector('.qf-landing-hero');
      var body = landing.querySelector('.qf-landing-body');
      var livre = landing.querySelector('[data-qf-home-livre]');
      if (hero && body && livre && livre.parentElement === landing &&
          (livre.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        body.after(livre);
      }
      if (!hero) return;
      var copy = hero.querySelector('.qf-hero2');
      var actions = copy && copy.querySelector('.qf-landing-actions');
      var banner = copy && copy.querySelector('[data-brandrot]');
      if (actions && banner && banner.parentElement === actions.parentElement &&
          (banner.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        actions.after(banner);
      }
      if(copy && copy.querySelector('.qf-customer-sub')) copy.querySelector('[data-qf-client-first-tip]')?.remove();
      if (copy && actions && !copy.querySelector('.qf-customer-sub') && !copy.querySelector('[data-qf-client-first-tip]')) {
        var tip = document.createElement('p');
        tip.setAttribute('data-qf-client-first-tip', '');
        tip.className = 'text text--sm text--secondary';
        tip.style.cssText = 'margin:0 0 10px;padding:0 4px;line-height:1.5';
        tip.textContent = 'Publique seu pedido grátis. Compare profissionais da região e escolha sem obrigação de contratar.';
        actions.before(tip);
      }
    }
    function bindForms() {
      prioritizeClientHome();
      // V11.43.3: tela inicial. Mede só se a pessoa tocou no campo, digitou ou tentou enviar; nunca o texto digitado.
      var home = document.querySelector('[data-landing-service-form]');
      if (home && !home.dataset.funnelBound) {
        home.dataset.funnelBound = '1';
        home.addEventListener('focusin', function () { track('home_focus', {}, true); });
        home.addEventListener('input', function (e) { if (e.isTrusted) track('home_type', {}, true); });
        home.addEventListener('submit', function () { track('home_submit', {}, true); }, true);

      }
      var form = document.getElementById('cadastro-cliente-form');
      if (form && !form.dataset.funnelBound) {
        form.dataset.funnelBound = '1';
        track('form_view', {}, true);
        form.addEventListener('input', function (e) { if (e.isTrusted) track('form_start', {}, true); });
        form.addEventListener('click', function (e) {
          if (e.isTrusted && e.target.closest && e.target.closest('[data-qf-opcao]')) track('form_start', {}, true);
        });
        var lastField = '', fieldEvents = 0;
        form.addEventListener('focusin', function (e) {
          var field = e.target.name || (e.target.hasAttribute('data-servico-edit-input') ? 'servico' : '');
          if (['servico','descricao','prazo','periodo','prazoDia','cidade','uf','bairro','telefone','nome'].indexOf(field) === -1 || field === lastField || fieldEvents >= 80) return;
          lastField = field; fieldEvents++;
          track('field_focus', { error_code: field });
        });
        form.addEventListener('submit', function () {
          // Enter nas etapas intermediárias apenas avança; ainda não é publicação.
          var step = form.getAttribute('data-qf-etapa'), sub = form.getAttribute('data-qf-sub');
          if (step === '1' || sub === 'a' || sub === 'b' || form.dataset.publishing === '1' || form.dataset.resolving === '1') return;
          submittedAt = Date.now(); track('submit');
        }, true);
      }
    }
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-home-services]')) track('home_cta', {}, true);
    }, true);
    bindForms();
    var observer = new MutationObserver(bindForms);
    var shell = document.getElementById('app-shell');
    if (shell) observer.observe(shell, { childList: true, subtree: true });
  });
})(window);
