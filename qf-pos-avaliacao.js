/* QuemFaz — tela "Serviço finalizado com sucesso!" depois da avaliação.
   Usada por confirmar-servico.html (confirmação por link/QR do pedido) e avaliar.html (QR da carteirinha).
   - Instalar: Play Store no Android, instalação PWA quando o navegador oferece, instrução no iPhone.
   - Não mostra o convite se o app já está instalado e não insiste depois de dispensado (30 dias).
   - "Solicitar outro serviço" abre o formulário normal de publicação, sem exigir instalação nem cadastro.
   Não há regra por profissão: a tela não depende da categoria do pedido. */
(function (global) {
  'use strict';

  var PLAY_PADRAO = 'https://play.google.com/store/apps/details?id=br.app.quemfaz';
  var CHAVE_DISPENSA = 'qf_convite_app_dispensado';
  var DIAS_SEM_INSISTIR = 30;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Link oficial já configurado no projeto (play-links.js → QF_PLAY.LINK_DA_LOJA); só aceita https.
  function linkPlay(cfg) {
    var u = cfg && cfg.LINK_DA_LOJA;
    return /^https:\/\/play\.google\.com\//i.test(u || '') ? u : PLAY_PADRAO;
  }

  // env: { standalone, nativo, marcadoInstalado, plataformaSalva, dispensadoEm (ms|null), agora (ms) }
  function jaInstalado(env) {
    env = env || {};
    return !!(env.standalone || env.nativo || env.marcadoInstalado || env.plataformaSalva === 'android');
  }
  function dispensadoRecente(env) {
    env = env || {};
    var t = Number(env.dispensadoEm);
    var agora = Number(env.agora) || Date.now();
    return isFinite(t) && t > 0 && agora - t >= 0 && agora - t < DIAS_SEM_INSISTIR * 86400000;
  }
  function deveMostrarConvite(env) { return !jaInstalado(env) && !dispensadoRecente(env); }

  // Qual botão de instalar mostrar. caps: { android, ios, promptPwa }
  function modoInstalar(caps) {
    caps = caps || {};
    if (caps.android) return 'play';          // Android: loja oficial (app completo, com notificações)
    if (caps.promptPwa) return 'pwa';         // desktop/outros: instalação PWA quando o navegador permitir
    if (caps.ios) return 'ios';               // iPhone: instrução "Adicionar à Tela de Início"
    return 'nenhum';
  }

  function novoPedidoUrl(origin) { return String(origin || '').replace(/\/+$/, '') + '/'; }

  function html(opts) {
    opts = opts || {};
    var concluido = opts.resultado ? opts.resultado === 'concluido' : true;
    var h = '<div class="qf-pos" data-qf-pos>' +
      '<div class="qf-pos__ok" aria-hidden="true">✓</div>' +
      '<h1>' + (concluido ? 'Serviço finalizado com sucesso!' : 'Obrigado pela sua resposta') + '</h1>' +
      '<p>' + (concluido
        ? 'Obrigado por avaliar o profissional. Tenha o Quem Faz sempre à mão para quando precisar de outro serviço.'
        : 'Sua resposta foi registrada. Quando precisar de outro serviço, o Quem Faz está à mão.') + '</p>';
    if (opts.convite && concluido) {
      var rot = opts.modo === 'ios' ? 'Como instalar no iPhone' : 'Instalar aplicativo grátis';
      h += '<div data-qf-convite>' +
        (opts.modo === 'play' ? '<a class="qf-btn qf-btn--primary" data-qf-instalar href="' + esc(opts.playUrl) + '" rel="noopener">' + rot + '</a>'
          : '<button class="qf-btn qf-btn--primary" type="button" data-qf-instalar>' + rot + '</button>') +
        (opts.modo === 'ios' ? '<p class="qf-pos__nota" data-qf-ios hidden>Toque em Compartilhar e depois em “Adicionar à Tela de Início”.</p>' : '') +
        '</div>';
    }
    h += '<a class="qf-btn qf-btn--ghost" data-qf-novo-pedido href="' + esc(opts.novoPedido || '/') + '">Solicitar outro serviço</a>';
    if (opts.convite && concluido) h += '<button class="qf-pos__dispensar" type="button" data-qf-dispensar>Agora não</button>';
    return h + '</div>';
  }

  var CSS = '.qf-pos{text-align:center;padding:8px 2px}.qf-pos__ok{width:64px;height:64px;border-radius:50%;background:#e6f7ee;color:#0a6b3a;font-size:36px;line-height:64px;margin:0 auto 12px;font-weight:900}' +
    '.qf-pos h1{font-size:24px;line-height:1.25;margin:4px 0 8px}.qf-pos p{color:#586377;line-height:1.5;margin:0 0 18px}' +
    '.qf-btn{display:block;width:100%;border:0;border-radius:13px;min-height:54px;line-height:54px;font:inherit;font-weight:850;font-size:16px;text-decoration:none;cursor:pointer;margin-top:10px;text-align:center;padding:0 12px;box-sizing:border-box}' +
    '.qf-btn--primary{background:#ff790a;color:#101d38}.qf-btn--ghost{background:#fff;color:#0c2448;border:2px solid #cbd4e1;line-height:50px}' +
    '.qf-pos__dispensar{margin-top:14px;background:none;border:0;color:#586377;font:inherit;text-decoration:underline;cursor:pointer;min-height:44px}.qf-pos__nota{font-size:14px;margin-top:10px}';

  // ---------- navegador ----------
  function ambiente() {
    var w = global, n = w.navigator || {}, ls = null;
    function get(k) { try { return w.localStorage.getItem(k); } catch (_) { return null; } }
    var standalone = false;
    try { standalone = !!(w.matchMedia && (w.matchMedia('(display-mode: standalone)').matches || w.matchMedia('(display-mode: fullscreen)').matches || w.matchMedia('(display-mode: minimal-ui)').matches)) || n.standalone === true; } catch (_) {}
    var nativo = false;
    try { nativo = !!(w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform()); } catch (_) {}
    return {
      standalone: standalone, nativo: nativo, marcadoInstalado: get('qf_pwa_installed') === '1', plataformaSalva: get('qf_platform'),
      dispensadoEm: Number(get(CHAVE_DISPENSA)) || null, agora: Date.now(),
      android: /android/i.test(n.userAgent || ''), ios: /iphone|ipad|ipod/i.test(n.userAgent || '')
    };
  }

  var promptPwa = null;
  if (global.addEventListener) {
    global.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); promptPwa = e; });
    global.addEventListener('appinstalled', function () { try { global.localStorage.setItem('qf_pwa_installed', '1'); } catch (_) {} });
  }

  // Mostra a tela dentro de `alvo`. `resultado`: 'concluido' | 'com_problema' | 'nao_realizado'.
  function mostrar(alvo, resultado) {
    var env = ambiente();
    if (!document.getElementById('qf-pos-css')) { var st = document.createElement('style'); st.id = 'qf-pos-css'; st.textContent = CSS; document.head.appendChild(st); }
    function desenhar() {
      var modo = modoInstalar({ android: env.android, ios: env.ios, promptPwa: !!promptPwa });
      var convite = deveMostrarConvite(env) && modo !== 'nenhum';
      alvo.innerHTML = html({ resultado: resultado, convite: convite, modo: modo, playUrl: linkPlay(global.QF_PLAY), novoPedido: novoPedidoUrl(global.location && global.location.origin) });
      var dis = alvo.querySelector('[data-qf-dispensar]');
      if (dis) dis.onclick = function () { try { global.localStorage.setItem(CHAVE_DISPENSA, String(Date.now())); } catch (_) {} env.dispensadoEm = Date.now(); desenhar(); };
      var ins = alvo.querySelector('button[data-qf-instalar]');
      if (ins) ins.onclick = function () {
        if (modo === 'ios') { var n = alvo.querySelector('[data-qf-ios]'); if (n) n.hidden = false; return; }
        if (modo === 'pwa' && promptPwa) { var p = promptPwa; promptPwa = null; p.prompt(); Promise.resolve(p.userChoice).then(function (c) { if (c && c.outcome === 'accepted') { try { global.localStorage.setItem('qf_pwa_installed', '1'); } catch (_) {} env.marcadoInstalado = true; } desenhar(); }); }
      };
    }
    desenhar();
    // Se o navegador avisar que o PWA já está instalado, esconde o convite (quando a API existir).
    try { if (global.navigator.getInstalledRelatedApps) global.navigator.getInstalledRelatedApps().then(function (l) { if (l && l.length) { env.marcadoInstalado = true; desenhar(); } }).catch(function () {}); } catch (_) {}
    // O prompt PWA pode chegar depois da primeira tela.
    if (global.addEventListener) global.addEventListener('beforeinstallprompt', function () { desenhar(); });
  }

  var api = { PLAY_PADRAO: PLAY_PADRAO, CHAVE_DISPENSA: CHAVE_DISPENSA, DIAS_SEM_INSISTIR: DIAS_SEM_INSISTIR, linkPlay: linkPlay, jaInstalado: jaInstalado, dispensadoRecente: dispensadoRecente, deveMostrarConvite: deveMostrarConvite, modoInstalar: modoInstalar, novoPedidoUrl: novoPedidoUrl, html: html, mostrar: mostrar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.QFPosAvaliacao = api;
})(typeof window !== 'undefined' ? window : globalThis);
