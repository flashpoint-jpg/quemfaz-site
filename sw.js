/* QuemFaz — Service Worker
   A versão abaixo PRECISA ser alterada a cada publicação (o app compara com APP_VERSION).
   - HTML/JS sempre buscados na rede primeiro (sem cache HTTP) para não prender versão antiga.
   - Cache só é usado quando o aparelho está sem internet.
   - Nova versão só assume o controle quando o app pede (SKIP_WAITING) ou na próxima abertura. */
const SW_VERSION = '11.4.1';
const CACHE = 'quemfaz-' + SW_VERSION;
const CORE = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon.svg', './icon.svg', './icon.svg', './quemfaz.png', './quemfaz_chamado.mp3'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))).catch(() => null));
  // Primeira instalação: ativa na hora. Atualização: espera o app pedir (evita trocar versão no meio de um formulário).
  if (!self.registration.active) self.skipWaiting();
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
  const netReq = isPage ? new Request(req, { cache: 'no-store' }) : req;
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

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {
    data = { title: 'QuemFaz', body: event.data ? event.data.text() : 'Você tem uma nova atualização.' };
  }
  const strong = !!data.strong;
  const options = {
    body: data.body || 'Abra o QuemFaz para ver os detalhes.',
    icon: './icon.svg',
    badge: './icon.svg',
    tag: data.tag || 'quemfaz-alerta',
    renotify: true,
    requireInteraction: strong,
    silent: false,
    vibrate: strong ? [400, 150, 400, 150, 600, 150, 400] : [200, 100, 200],
    timestamp: Date.now(),
    data: { url: data.url || './index.html#/' }
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(data.title || 'QuemFaz', options);
    // Avisa janelas abertas para atualizarem a tela e tocarem o som do app.
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    list.forEach(c => c.postMessage({ type: 'QF_PUSH', payload: data }));
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || './index.html#/';
  const target = new URL(raw, self.registration.scope).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.indexOf(self.registration.scope) === 0 && 'focus' in client) {
          client.postMessage({ type: 'QF_NAVIGATE', url: target });
          return client.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(target) : null;
    })
  );
});