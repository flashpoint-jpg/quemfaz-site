/* QuemFaz — Service Worker
   A versão abaixo PRECISA ser alterada a cada publicação (o app compara com APP_VERSION).
   - HTML/JS sempre buscados na rede primeiro (sem cache HTTP) para não prender versão antiga.
   - Cache só é usado quando o aparelho está sem internet.
   - Nova versão só assume o controle quando o app pede (SKIP_WAITING) ou na próxima abertura. */
const SW_VERSION = '12.1.19';
const CACHE = 'quemfaz-' + SW_VERSION;
const CORE = ['./qf-acompanhamento.js?v=canal-20261024', './acompanhar-pedido.html', './qf-livre.js?v=dois-planos-20261023-v2','./qf-atendimento.js?v=2', './qf-admin-commercial.js?v=1', './qf-admin-monitoramento.js?v=1', './qf-admin-devolucao.js?v=1', './qf-admin-push-diagnostico.js?v=1', './qf-recharge-return.js?v=1', './assets/qf-logo-20261013.webp', './assets/qf-logo-branco-20261014.webp', './icon-192.png?v=20261013', './icon-512.png?v=20261013', './qf-carteirinha.js?v=11.84.2', './carteirinha.html', './avaliar.html', './vendor/supabase-2.117.2.js', './qf-client-acquisition.js?v=11.96', './qf-conversao.js?v=11.96', './qf-admin-acquisition.js?v=11.75.1', './assets/qf-approved-1.webp', './assets/qf-approved-2.webp', './', './index.html', './admin.html', './manifest.webmanifest', './admin-manifest.webmanifest', './qf-recrutamento.js?v=11.33.1', './qf-recrutamento.css?v=11.33.1', './icon.svg', './quemfaz.png', './quemfaz_chamado.mp3'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))).catch(() => null));
  // Primeira instalação: ativa na hora. Atualização: espera o app pedir (evita trocar versão no meio de um formulário).
  // Atualização do painel sem deixar outra versão esperando pelo fechamento de todas as abas.
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.indexOf('quemfaz-') === 0 && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ version: SW_VERSION });
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/download/") === 0) return; // APK e versao.json: sempre direto da rede, sem cache
  const isPage = req.mode === 'navigate' || /\.html$/.test(url.pathname) || url.pathname.endsWith('/');
  // Navegações e arquivos críticos do app são sempre network-first sem cache HTTP.
  // Evita que uma PWA instalada continue presa em index/sw antigos após um deploy.
  const isCritical = isPage || url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/manifest.webmanifest');
  const netReq = isCritical ? new Request(req, { cache: 'no-store' }) : req;
  event.respondWith(
    fetch(netReq).then(response => {
      if (response && response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => null);
      }
      return response;
    }).catch(() => caches.match(req, { ignoreSearch: isPage }).then(r => r || (isPage ? caches.match('./index.html') : undefined)).then(r => r || new Response('Sem conexão', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })))
  );
});

// V11.51: "Simular chamado" — o aviso de teste marca "chegou no aparelho" assim que chega,
// mesmo com o app fechado (chave do aviso + chave pública do site; só altera aquele teste).
const QF_SUPABASE_URL = 'https://dczlyrgnzlxmzghzaooz.supabase.co';
const QF_SUPABASE_KEY = 'sb_publishable_-WiYw_1QTzW0l9o0d4ZU9Q_kSadNA2A';
function qfTesteChegou(data) {
  if (!data || data.tipo !== 'teste' || !data.teste_id || !data.teste_token) return Promise.resolve();
  return fetch(QF_SUPABASE_URL + '/rest/v1/rpc/qf_teste_chegou', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: QF_SUPABASE_KEY, Authorization: 'Bearer ' + QF_SUPABASE_KEY },
    body: JSON.stringify({ p_id: data.teste_id, p_token: data.teste_token })
  }).catch(() => null);
}

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {
    data = { title: 'QuemFaz', body: event.data ? event.data.text() : 'Você tem uma nova atualização.' };
  }
  const callTag = String(data.tag || "");
  const strong = data.strong === true || data.strong === 1 || data.strong === "1" ||
    callTag === "qf-new-calls-group" || callTag.indexOf("qf-new-call-") === 0;
  data.strong = strong;
  const options = {
    body: data.body || 'Abra o QuemFaz para ver os detalhes.',
    icon: './icon-192.png?v=20261013',
    badge: './icon.svg',
    tag: data.tag || 'quemfaz-alerta',
    renotify: true,
    requireInteraction: strong,
    silent: false,
    vibrate: strong ? [400, 150, 400, 150, 600, 150, 400] : [200, 100, 200],
    timestamp: Date.now(),
    data: {
      url: data.url || './index.html#/',
      grouped: !!data.grouped,
      count: Number(data.count || 0),
      fechou_id: data.fechou_id || '',
      fechou_token: data.fechou_token || ''
    }
  };
  // V11.83: "Você fechou?" — responde direto na notificação.
  if (data.fechou_id && data.fechou_token) {
    options.actions = [{ action: 'fechei', title: 'Fechei' }, { action: 'nao_fechei', title: 'Não fechei' }];
  }
  event.waitUntil((async () => {
    const chegou = qfTesteChegou(data);
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    // V11.16.33: mensagem da conversa que já está aberta e visível não vira notificação — o chat mostra na hora.
    const chatHash = String(data.tag || '').indexOf('qf-chat-') === 0 ? (String(data.url || '').split('#')[1] || '').split('?')[0] : '';
    const inChat = !!chatHash && list.some(c => c.visibilityState === 'visible' && (String(c.url || '').split('#')[1] || '').split('?')[0] === chatHash);
    if (!inChat) await self.registration.showNotification(data.title || 'QuemFaz', options);
    // Avisa janelas abertas para atualizarem a tela e tocarem o som do app.
    list.forEach(c => c.postMessage({ type: 'QF_PUSH', payload: data }));
    await chegou;
  })());
});

// URLs de push Web usam sempre o dominio publico ao abrir uma nova janela.
// A origem antiga continua apta a receber push durante a migracao; se uma
// janela antiga ja estiver aberta, reutiliza-a para preservar a sessao.
const QF_PUBLIC_ORIGIN = 'https://quemfazservico.com.br';
function qfNotificationTarget(raw) {
  let parsed;
  try {
    parsed = new URL(raw || './index.html#/', self.registration.scope);
  } catch (_) {
    parsed = new URL('/index.html#/', QF_PUBLIC_ORIGIN);
  }
  // Nao permitir que um payload de push redirecione para dominios externos.
  if (parsed.origin !== self.location.origin && parsed.origin !== QF_PUBLIC_ORIGIN) {
    return QF_PUBLIC_ORIGIN + '/index.html#/';
  }
  return QF_PUBLIC_ORIGIN + parsed.pathname + parsed.search + parsed.hash;
}

// V11.83: botões "Fechei" / "Não fechei" da pergunta "Você fechou o serviço?".
function qfResponderFechou(nd, resposta) {
  return fetch(QF_SUPABASE_URL + '/rest/v1/rpc/qf_fechou_responder_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: QF_SUPABASE_KEY, Authorization: 'Bearer ' + QF_SUPABASE_KEY },
    body: JSON.stringify({ p_desbloqueio_id: nd.fechou_id, p_token: nd.fechou_token, p_resposta: resposta })
  }).then(r => r.json()).catch(() => null).then(out => {
    const ok = out && out.ok;
    return self.registration.showNotification('QuemFaz', {
      body: ok ? (resposta === 'fechei' ? 'Registrado: você fechou o serviço. Obrigado!' : 'Registrado: você não fechou este pedido.') : 'Não deu para registrar agora. Abra o pedido no QuemFaz para responder.',
      icon: './icon-192.png?v=20261013', badge: './icon.svg', tag: 'qf-fechou-ok', silent: true,
      data: { url: nd.url || './index.html#/' }
    });
  });
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const nd = event.notification.data || {};
  if ((event.action === 'fechei' || event.action === 'nao_fechei') && nd.fechou_id && nd.fechou_token) {
    event.waitUntil(qfResponderFechou(nd, event.action));
    return;
  }
  const raw = (event.notification.data && event.notification.data.url) || './index.html#/';
  const target = qfNotificationTarget(raw);
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.indexOf(self.registration.scope) === 0 && 'focus' in client) {
          // Mantem a aba/PWA aberta na propria origem: evita perder login
          // do profissional enquanto sua inscricao antiga ainda esta ativa.
          const local = new URL(raw, self.registration.scope);
          const localTarget = (local.origin === self.location.origin) ? local.href : target;
          client.postMessage({ type: 'QF_NAVIGATE', url: localTarget });
          return client.focus();
        }
      }
      // Sem aba existente, novas aberturas passam a usar o dominio oficial.
      return clients.openWindow ? clients.openWindow(target) : null;
    })
  );
});

