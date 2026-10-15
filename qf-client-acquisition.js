/* QuemFaz 11.36 — anúncios entram na home; atribuição e conversão sem dados pessoais. */
(function (global) {
  'use strict';

  // Meta Pixel: mede PageView e permite que o evento Lead abaixo seja enviado somente após o pedido salvo.
  var QF_META_PIXEL_ID = '1124265238584181';
  function ensureMetaPixel() {
    if (location.search.indexOf('demo=1') !== -1 || typeof global.fbq === 'function') return;
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
  var campaign = global.QFMarketingTouch || {};
  var sid;
  try {
    sid = sessionStorage.getItem('qf_funnel_session_v2');
    if (!sid) { sid = global.crypto.randomUUID(); sessionStorage.setItem('qf_funnel_session_v2', sid); }
  } catch (_) { sid = global.crypto.randomUUID(); }
  var seen = {}, submittedAt = 0;
  var services = {
    pintor: 'cat_pintor', eletricista: 'cat_eletricista', encanador: 'cat_encanador', montador: 'cat_montador', montagem: 'cat_montador',
    chaveiro: 'cat_chaveiro', antenista: 'cat_antenista', faxina_pos_obra: 'cat_faxina_pos_obra', limpeza_pos_obra: 'cat_faxina_pos_obra',
    pedreiro: 'cat_pedreiro', desentupidor: 'cat_desentupidor', telhadista: 'cat_telhadista',
    limpeza_sofa: 'cat_limpeza_estofados', marido_aluguel: 'cat_marido_aluguel', diarista: 'cat_diarista',
    azulejista: 'cat_azulejista', gesseiro: 'cat_gesseiro', impermeabilizacao: 'cat_impermeabilizacao', caixa_dagua: 'cat_caixa_dagua'
  };
  function serviceFromLink(search) {
    var p = new URLSearchParams(search || '');
    var explicit = p.get('servico');
    if (explicit) return services[explicit] || (Object.values(services).indexOf(explicit) !== -1 ? explicit : null);
    if (p.get('utm_source') !== 'google' || !/^quemfaz_clientes_/.test(p.get('utm_campaign') || '')) return null;
    return services[p.get('utm_content')] || null;
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
    var seoPage = new URLSearchParams(location.search).get('seo_page');
    if (seoPage && /^\/servicos\/[a-z0-9-]+\/[a-z0-9-]+\/$/.test(seoPage)) sessionStorage.setItem('qf_seo_page', seoPage);
  } catch (_) {}
  function attribution() {
    var touch = global.QFMarketingTouch || campaign || {};
    var out = {};
    ['source', 'medium', 'campaign', 'content', 'term', 'click_id'].forEach(function (key) {
      if (touch[key]) out[key] = String(touch[key]).slice(0, key === 'click_id' ? 512 : 240);
    });
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
    try { if (!out.content) out.content = sessionStorage.getItem('qf_seo_page') || undefined; } catch (_) {}
    return out;
  }
  function track(event, detail, once) {
    if (location.search.indexOf('demo=1') !== -1) return;
    detail = detail || {};
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
      if (typeof global.fbq === 'function') global.fbq('track', 'Lead', {
        content_name: 'QuemFaz Pedido de Serviço', content_category: category || 'servico', role: 'cliente'
      }, { eventID: 'qf_pedido_' + req.id });
    } catch (_) {}
    try { if (typeof global.qfGoogleLead === 'function') global.qfGoogleLead(req.id); } catch (_) {}
  }
  global.QFClientAcquisition = { services: services, serviceFromLink: serviceFromLink, applyDestination: applyDestination, attribution: attribution, track: track, published: published };
  global.addEventListener('DOMContentLoaded', function () {
    if (!/profissional|recrutamento/.test(location.hash || '') && !/profissionais/i.test(campaign.campaign || '')) track('landing', {}, true);
    function bindForms() {
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
