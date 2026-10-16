/* QuemFaz — medição de pedidos para Google Ads, Google Analytics 4 e Microsoft Advertising.
   Três eventos, sempre sem dados pessoais:
     pedido_iniciado            — primeira interação com o formulário do pedido (uma vez por sessão)
     pedido_formulario_avancado — etapa 1 concluída, o cliente passou para local/contato (uma vez por sessão)
     pedido_publicado           — somente depois que o Supabase confirmou o pedido gravado (uma vez por pedido)
   Nunca envia nome, telefone, endereço, bairro, CEP, e-mail ou o texto do pedido.
   Respeita a escolha de cookies de medição feita no aviso (Aceitar / Recusar). */
(function (global) {
  'use strict';

  // IDs reais: preencha somente com valores tirados dos painéis. Vazio = plataforma desligada.
  var CONFIG = global.QF_TRACKING_CONFIG = Object.assign({
    ga4: '',                 // ex.: 'G-XXXXXXXXXX' (Google Analytics 4 → Administrador → Fluxos de dados)
    googleAds: 'AW-18273159663', // já instalado no site (tag QF_GOOGLE_ADS_V1)
    uet: '343279366'                  // ex.: '343XXXXX' (Microsoft Advertising → Ferramentas → Tags UET)
  }, global.QF_TRACKING_CONFIG || {});

  var EVENTOS = { pedido_iniciado: 1, pedido_formulario_avancado: 1, pedido_publicado: 1 };
  var CHAVE_CONSENTIMENTO = 'qf_consent_v1';

  function demo() { return /[?&]demo=1(&|$)/.test(location.search || ''); }

  function lerConsentimento() {
    try {
      var v = JSON.parse(localStorage.getItem(CHAVE_CONSENTIMENTO) || 'null');
      if (v && (v.medicao === 'granted' || v.medicao === 'denied')) return v.medicao;
    } catch (_) {}
    return null;
  }
  function consentimento() { return lerConsentimento() || global.QF_CONSENT_PADRAO || 'granted'; }
  function permitido() { return consentimento() === 'granted' && !demo(); }

  // Parâmetros seguros: só categoria do serviço (código interno) e origem da campanha.
  function parametrosSeguros(extra) {
    var out = {};
    var cat = extra && extra.categoria;
    if (cat && /^cat_[a-z0-9_]{1,60}$/.test(String(cat))) out.categoria = String(cat);
    try {
      var a = global.QFClientAcquisition && global.QFClientAcquisition.attribution ? global.QFClientAcquisition.attribution() : {};
      if (a.source) out.origem = String(a.source).slice(0, 60);
      if (a.campaign) out.campanha = String(a.campaign).slice(0, 100);
    } catch (_) {}
    return out;
  }

  function jaEnviado(nome, idPedido) {
    var chave = 'qf_ev_' + nome + (idPedido ? '_' + idPedido : '');
    var store = idPedido ? global.localStorage : global.sessionStorage;
    try { if (store.getItem(chave)) return true; store.setItem(chave, '1'); } catch (_) {}
    return false;
  }

  // ---------- Carregamento das tags opcionais (somente com ID real e consentimento) ----------
  var carregado = { ga4: false, uet: false };
  function carregarGa4() {
    if (carregado.ga4 || !/^G-[A-Z0-9]{4,20}$/.test(CONFIG.ga4) || typeof global.gtag !== 'function') return;
    carregado.ga4 = true;
    global.gtag('config', CONFIG.ga4, { send_page_view: true });
  }
  function carregarUet() {
    if (carregado.uet || !/^\d{4,12}$/.test(String(CONFIG.uet))) return;
    carregado.uet = true;
    global.uetq = global.uetq || [];
    global.uetq.push('consent', 'default', { ad_storage: consentimento() === 'granted' ? 'granted' : 'denied' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://bat.bing.com/bat.js';
    s.onload = function () {
      try {
        var o = { ti: String(CONFIG.uet), enableAutoSpaTracking: true, q: global.uetq };
        global.uetq = new global.UET(o);
        global.uetq.push('pageLoad');
      } catch (_) {}
    };
    (document.head || document.documentElement).appendChild(s);
  }

  function aplicarConsentimento(valor) {
    var g = valor === 'granted' ? 'granted' : 'denied';
    try {
      if (typeof global.gtag === 'function') global.gtag('consent', 'update', {
        ad_storage: g, ad_user_data: g, ad_personalization: g, analytics_storage: g
      });
    } catch (_) {}
    try { if (typeof global.fbq === 'function') global.fbq('consent', g === 'granted' ? 'grant' : 'revoke'); } catch (_) {}
    try { if (global.uetq && global.uetq.push) global.uetq.push('consent', 'update', { ad_storage: g }); } catch (_) {}
    if (g === 'granted') { carregarGa4(); carregarUet(); }
  }

  // ---------- Envio dos eventos ----------
  function evento(nome, extra) {
    if (!EVENTOS[nome]) return false;
    extra = extra || {};
    var idPedido = nome === 'pedido_publicado' ? String(extra.request_id || '') : '';
    if (nome === 'pedido_publicado' && !/^[0-9a-f-]{8,64}$/i.test(idPedido)) return false; // sem confirmação do banco, nada é enviado
    if (jaEnviado(nome, idPedido)) return false;
    var params = parametrosSeguros(extra);
    // dataLayer: disponível para Google Tag Manager, sempre sem dados pessoais.
    try {
      global.dataLayer = global.dataLayer || [];
      global.dataLayer.push(Object.assign({ event: nome, qf_consentimento: consentimento() }, params, idPedido ? { transaction_id: idPedido } : {}));
    } catch (_) {}
    if (!permitido()) return true;
    // Google Analytics 4 (evento recomendado de lead no pedido publicado).
    if (carregado.ga4 && typeof global.gtag === 'function') {
      try {
        global.gtag('event', nome, Object.assign({ send_to: CONFIG.ga4 }, params, idPedido ? { transaction_id: idPedido } : {}));
        if (nome === 'pedido_publicado') global.gtag('event', 'generate_lead', { send_to: CONFIG.ga4, currency: 'BRL', value: 1, lead_source: params.origem || 'direto' });
      } catch (_) {}
    }
    // Microsoft Advertising UET: meta de conversão "Evento personalizado", ação = nome do evento.
    if (carregado.uet && global.uetq && global.uetq.push) {
      try { global.uetq.push('event', nome, { event_category: 'pedido', event_label: params.categoria || 'servico' }); } catch (_) {}
    }
    return true;
  }

  // ---------- Aviso de cookies de medição ----------
  // Não aparece por cima da primeira tela nem do formulário do pedido: surge quando a pessoa rola a página
  // ou depois de alguns segundos. Se o padrão for 'denied' (aceite obrigatório), aparece na hora.
  function navInferior() {
    var max = 0, h = global.innerHeight || 0;
    document.querySelectorAll('.qf-home-nav, .tabbar').forEach(function (n) {
      var st = global.getComputedStyle ? global.getComputedStyle(n) : null;
      if (st && (st.display === 'none' || st.visibility === 'hidden' || st.position !== 'fixed')) return;
      var r = n.getBoundingClientRect();
      if (r.height > 0 && r.bottom >= h - 30 && r.top > h / 2) max = Math.max(max, Math.round(h - r.top));
    });
    return max;
  }
  function rotaDoFormulario() { return /^#\/auth\/cliente\/cadastro/.test(location.hash || ''); }
  function mostrarAviso() {
    if (lerConsentimento() || demo() || document.getElementById('qf-consent') || !document.body) return;
    if (/\/(admin|profissional)\.html$/.test(location.pathname)) return;
    var box = document.createElement('div');
    box.id = 'qf-consent';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Aviso de cookies');
    box.innerHTML =
      '<p>Usamos cookies para medir os anúncios, sem enviar nome ou telefone. <a href="/privacidade/#medicao">Saiba mais</a></p>' +
      '<div class="qf-consent__acoes"><button type="button" data-qf-consent="denied">Recusar</button>' +
      '<button type="button" data-qf-consent="granted" class="is-primary">Aceitar</button></div>';
    var css = document.createElement('style');
    css.id = 'qf-consent-css';
    css.textContent =
      '#qf-consent{position:fixed;left:10px;right:10px;bottom:calc(var(--qf-consent-bottom,10px) + env(safe-area-inset-bottom));z-index:2147483000;max-width:560px;margin:0 auto;' +
      'background:#07162F;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:10px 12px;box-shadow:0 8px 28px rgba(0,0,0,.3);font:13.5px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
      'display:flex;gap:8px 10px;align-items:center;flex-wrap:wrap}' +
      '#qf-consent p{margin:0;flex:1 1 200px}#qf-consent a{color:#FFB47F;text-decoration:underline}' +
      '.qf-consent__acoes{display:flex;gap:8px;margin-left:auto}' +
      '#qf-consent button{min-height:44px;min-width:88px;border-radius:10px;border:1px solid rgba(255,255,255,.55);background:transparent;color:#fff;font:600 14px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:0 14px;cursor:pointer}' +
      '#qf-consent button.is-primary{background:#FF7900;border-color:#FF7900;color:#1a0c00}' +
      '#qf-consent button:focus-visible,#qf-consent a:focus-visible{outline:3px solid #FFB47F;outline-offset:2px}';
    document.head.appendChild(css);
    document.body.appendChild(box);
    // Fica acima da barra inferior do app e reserva espaço no fim da página: não cobre enviar, cancelar ou o menu.
    function posicionar() {
      if (!box.isConnected) return;
      if (rotaDoFormulario()) { box.style.display = 'none'; document.body.style.paddingBottom = ''; return; }
      box.style.display = '';
      box.style.setProperty('--qf-consent-bottom', (navInferior() + 10) + 'px');
      document.body.style.paddingBottom = (box.offsetHeight + navInferior() + 20) + 'px';
    }
    posicionar();
    global.addEventListener('hashchange', posicionar);
    global.addEventListener('resize', posicionar);
    var t = global.setInterval ? global.setInterval(posicionar, 1500) : null;
    box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-qf-consent]');
      if (!b) return;
      escolher(b.getAttribute('data-qf-consent'));
      if (t) global.clearInterval(t);
      global.removeEventListener('hashchange', posicionar);
      global.removeEventListener('resize', posicionar);
      document.body.style.paddingBottom = '';
      box.remove();
    });
  }
  function agendarAviso() {
    if (lerConsentimento() || demo()) return;
    if ((global.QF_CONSENT_PADRAO || 'granted') === 'denied') { mostrarAviso(); return; }
    var feito = false;
    function tentar() {
      if (feito || rotaDoFormulario()) return;
      feito = true;
      document.removeEventListener('scroll', aoRolar, true);
      mostrarAviso();
    }
    function aoRolar(e) {
      var el = e && e.target && e.target.scrollTop !== undefined && e.target !== document ? e.target : document.scrollingElement;
      if (el && el.scrollTop > 240) tentar();
    }
    document.addEventListener('scroll', aoRolar, true);
    global.addEventListener('hashchange', function () { if (!rotaDoFormulario()) global.setTimeout(tentar, 1200); });
    if (global.setTimeout) global.setTimeout(tentar, 15000);
  }
  function escolher(valor) {
    var v = valor === 'denied' ? 'denied' : 'granted';
    try { localStorage.setItem(CHAVE_CONSENTIMENTO, JSON.stringify({ medicao: v, em: new Date().toISOString() })); } catch (_) {}
    aplicarConsentimento(v);
  }

  global.QFConversao = { evento: evento, consentimento: consentimento, escolher: escolher, config: CONFIG };

  if (permitido()) { carregarGa4(); carregarUet(); }
  global.QFConversao.mostrarAviso = mostrarAviso;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', agendarAviso);
  else agendarAviso();
})(window);
