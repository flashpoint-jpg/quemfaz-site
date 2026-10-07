/* QuemFaz 11.34 — destino dos anúncios, etapas sem dados pessoais e conversão por pedido salvo. */
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
    sid = sessionStorage.getItem('qf_funnel_session');
    if (!sid) { sid = global.crypto.randomUUID(); sessionStorage.setItem('qf_funnel_session', sid); }
  } catch (_) { sid = global.crypto.randomUUID(); }
  var seen = {}, submittedAt = 0;
  var services = {
    pintor: 'cat_pintor', eletricista: 'cat_eletricista', encanador: 'cat_encanador', montador: 'cat_montador',
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
    // Compatibilidade com os anúncios já ativos. Não interfere em links de profissionais ou pedidos.
    if (!/^#\/(?:calculadora\/?|auth\/cliente\/cadastro\/?|)?$/.test(location.hash || '#/')) return;
    try { sessionStorage.setItem('qf_pending_category', cat); sessionStorage.removeItem('qf_calc'); } catch (_) {}
    history.replaceState(null, '', location.pathname + location.search + '#/auth/cliente/cadastro');
  }
  function attribution() {
    var out = {};
    ['source', 'medium', 'campaign', 'content', 'term', 'click_id'].forEach(function (key) {
      if (campaign[key]) out[key] = String(campaign[key]).slice(0, key === 'click_id' ? 512 : 240);
    });
    return out;
  }
  function track(event, detail, once) {
    if (location.search.indexOf('demo=1') !== -1) return;
    detail = detail || {};
    var key = event + ':' + (detail.category || '') + ':' + (detail.request_id || '');
    if (once && seen[key]) return;
    seen[key] = true;
    var client = global.QFCloud && global.QFCloud.client;
    if (!client) return;
    var row = {
      session_id: sid, event: event, category: String(detail.category || '').slice(0, 120) || null,
      source: String(campaign.source || '').slice(0, 120) || null,
      campaign: String(campaign.campaign || '').slice(0, 240) || null,
      content: String(campaign.content || '').slice(0, 240) || null,
      request_id: detail.request_id || null,
      error_code: String(detail.error_code || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || null,
      duration_ms: submittedAt ? Math.min(3600000, Math.max(0, Date.now() - submittedAt)) : null
    };
    // Falha na medição jamais impede o pedido; não envia nomes, telefone ou texto do serviço.
    Promise.resolve(client.from('qf_client_funnel').insert(row)).then(function (r) {
      if (r.error) console.warn('QuemFaz: etapa não registrada', event, r.error.code);
    }).catch(function () {});
  }
  function published(req, category) {
    if (!req || !req.id || !(global.QFCloud && global.QFCloud.enabled)) return;
    var key = 'qf_conversion_' + req.id;
    if (seen[key]) return;
    try { if (localStorage.getItem(key)) return; } catch (_) {}
    seen[key] = true;
    try { localStorage.setItem(key, '1'); } catch (_) {}
    track('published', { category: category, request_id: req.id }, true);
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
    var observer = new MutationObserver(function () {
      var form = document.getElementById('cadastro-cliente-form');
      if (form && !form.dataset.funnelBound) {
        form.dataset.funnelBound = '1';
        track('form_view', {}, true);
        form.addEventListener('input', function () { track('form_start', {}, true); }, { once: true });
        var lastField = '', fieldEvents = 0;
        form.addEventListener('focusin', function (e) {
          var field = e.target.name || (e.target.hasAttribute('data-servico-edit-input') ? 'servico' : '');
          if (['servico','descricao','prazo','periodo','prazoDia','cidade','uf','bairro','telefone','nome'].indexOf(field) === -1 || field === lastField || fieldEvents >= 80) return;
          lastField = field; fieldEvents++;
          track('field_focus', { error_code: field });
        });
        form.addEventListener('submit', function () { submittedAt = Date.now(); track('submit'); }, true);
      }
    });
    observer.observe(document.getElementById('app-shell'), { childList: true, subtree: true });
  });
})(window);
