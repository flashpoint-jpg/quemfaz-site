const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const helper = html.match(/<script>\s*(\/\* QF_CONNECTION_[\s\S]*?)<\/script>/)[1];
assert.equal(helper, admin.match(/<script>\s*(\/\* QF_CONNECTION_[\s\S]*?)<\/script>/)[1]);

function connection(fetch) {
  const scope = { window: { fetch }, location: { href: 'https://quemfaz.example/' }, URL, AbortController, Response,
    console: { warn() {} }, setTimeout: (fn, ms) => setTimeout(fn, ms >= 10000 ? 20 : ms), clearTimeout };
  vm.runInNewContext(helper, scope);
  return scope.window.QFConnection;
}

async function run() {
  let signal;
  const qf = connection((url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  });
  await assert.rejects(qf.fetch('https://project.supabase.co/rest/v1/qf_profiles'), { name: 'AbortError' });
  assert.equal(signal.aborted, true);
  await assert.rejects(qf.deadline(new Promise(() => {}), 5, 'sessão'), /conexão demorou/);
  assert.equal(await qf.deadline(Promise.resolve('ok'), 5, 'sessão'), 'ok');

  const success = connection(async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200, headers: { 'content-type': 'application/json' } }));
  assert.deepEqual(await (await success.fetch('https://project.supabase.co/rest/v1/qf_profiles')).json(), [{ id: 1 }]);
  const noContent = connection(async () => new Response(null, { status: 204 }));
  assert.equal((await noContent.fetch('https://project.supabase.co/rest/v1/qf_profiles')).status, 204);
  let mutationOptions;
  const mutation = connection(async (url, options) => { mutationOptions = options; return new Response('{}'); });
  const options = { method: 'POST', body: '{"chamado":1}' };
  await mutation.fetch('https://project.supabase.co/rest/v1/rpc/qf_desbloquear_chamado', options);
  assert.equal(mutationOptions, options, 'Não cancela nem repete operações financeiras');
  const upstream = new AbortController();
  const reading = qf.fetch('https://project.supabase.co/rest/v1/rpc/qf_admin_snapshot', { method: 'POST', signal: upstream.signal });
  upstream.abort();
  await assert.rejects(reading, { name: 'AbortError' });

  const syncSource = html.slice(html.indexOf('  let publicAdsSync = null;'), html.indexOf('  function traduzErroAuth'));
  let clears = 0, session = { role: 'cliente', userId: 'old' }, adsStarted = 0, sessionReads = 0;
  const scope = {
    global: { QFConnection: success, dispatchEvent() {} },
    enabled: true, prepareLocalState() {}, syncing: null, lastSyncAt: 0,
    DB: { getSession: () => session, setSession: s => { session = s; } },
    clearRuntimeData() { clears++; },
    syncPublicAds: () => { adsStarted++; return new Promise(() => {}); },
    client: { auth: { getSession: async () => { sessionReads++; return { data: { session: null }, error: null }; } } },
    console: { warn() {} }, CustomEvent: class { constructor(type) { this.type = type; } }
  };
  vm.createContext(scope); vm.runInContext(syncSource, scope);
  assert.equal(await scope.syncForCurrentSession(false), null, 'Anúncio travado não bloqueia visitante');
  assert.equal(adsStarted, 1); assert.equal(session, null); assert.equal(clears, 1);
  await scope.syncForCurrentSession(false);
  assert.equal(sessionReads, 1, 'Evita sincronização duplicada em navegações próximas');
  session = { role: 'profissional', userId: 'saved' };
  scope.client.auth.getSession = async () => ({ error: new Error('offline') });
  await assert.rejects(scope.syncForCurrentSession(true), /offline/);
  assert.equal(session.userId, 'saved', 'Erro de rede preserva a sessão');
  assert.equal(clears, 1, 'Erro de rede não apaga dados');

  scope.client.auth.getSession = async () => ({ data: { session: { user: { id: 'saved', email: 'test@example.test' } } }, error: null });
  scope.ensureProfile = async () => ({ tipo: 'profissional' });
  scope.applyPendingIdentity = async () => {};
  scope.syncLocalUser = async () => ({ id: 'saved' });
  let callsLoaded = false;
  scope.syncProfessionalCalls = async () => { callsLoaded = true; };
  await scope.syncForCurrentSession(true);
  assert.equal(callsLoaded, true, 'Conta e chamados carregam sem aguardar anúncios');
  assert.equal(session.userId, 'saved');

  const routeSource = admin.slice(admin.indexOf('  async function route() {'), admin.indexOf('  function renderAnon(found)'));
  let errorShown = false, rendered = false, loggedOut = false;
  const routeScope = { currentPath: () => '/admin/dashboard', matchRoute: () => ({ route: { role: 'admin' } }),
    currentSession: () => ({ role: 'admin' }), global: { QFConnection: success, QFAdminCloud: { enabled: true,
      hasSession: async () => true, syncAds: async () => {}, syncSnapshot: async () => { throw new Error('offline'); }, syncSupport: async () => {} } },
    DB: { logout() { loggedOut = true; } }, renderConnectionError() { errorShown = true; },
    renderApp() { rendered = true; }, console: { warn() {} }
  };
  vm.createContext(routeScope); vm.runInContext(routeSource, routeScope);
  await routeScope.route();
  assert.equal(errorShown, true); assert.equal(rendered, false); assert.equal(loggedOut, false);
  // V11.29.1: depois da primeira carga, trocar de aba desenha na hora, sem esperar a internet.
  let solta; const presa = new Promise((r) => { solta = r; });
  Object.assign(routeScope, { currentUser: () => ({ id: 'a' }), window: { scrollY: 0, scrollTo() {} }, Date });
  routeScope.global.QFAdminCloud.syncSnapshot = async () => {};
  errorShown = false; rendered = false;
  await routeScope.route();
  assert.equal(rendered, true, 'Primeira carga sincroniza e desenha');
  rendered = false;
  routeScope.global.QFAdminCloud.syncSnapshot = () => presa;
  vm.runInContext('painelSincronizadoEm = Date.now() - 60000;', routeScope);
  await routeScope.route();
  assert.equal(rendered, true, 'Com a internet presa, a aba abre do mesmo jeito'); assert.equal(errorShown, false);
  solta();
  // V11.30.3: dados novos que dão a mesma tela não redesenham (só o horário muda); se mudou, redesenha.
  {
    let tela = '<span>Atualizado em 05/10 21:00</span><b>3 pedidos</b>', desenhos = 0;
    const rota = { role: 'admin', render: () => tela };
    Object.assign(routeScope, { matchRoute: () => ({ route: rota, params: {} }), renderApp() { desenhos++; } });
    routeScope.global.QFAdminCloud.syncSnapshot = async () => {};
    const espera = () => new Promise((r) => setTimeout(r, 5));
    vm.runInContext("painelSincronizando = false; telaMexida = false; painelSincronizadoEm = Date.now() - 60000; ultimoDesenho = { path: '/admin/dashboard', html: '<span>Atualizado em 05/10 21:00</span><b>3 pedidos</b>' };", routeScope);
    tela = '<span>Atualizado em 05/10 21:05</span><b>3 pedidos</b>';
    await routeScope.route(); await espera();
    assert.equal(desenhos, 1, 'Mesma tela: desenha uma vez só, sem redesenhar depois');
    vm.runInContext('painelSincronizadoEm = Date.now() - 60000;', routeScope);
    tela = '<span>Atualizado em 05/10 21:06</span><b>4 pedidos</b>';
    await routeScope.route(); await espera();
    assert.equal(desenhos, 3, 'Dado novo: redesenha para mostrar');
  }
  console.log('PASS: timeout, abort, respostas JSON/204, preservação de mutações, anúncios lentos, sessão, chamados e erro do painel.');
}
run().catch(err => { console.error(err); process.exitCode = 1; });
