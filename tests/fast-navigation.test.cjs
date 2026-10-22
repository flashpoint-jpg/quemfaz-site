const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html', 'utf8');
const source = html.slice(html.indexOf('  let routeRevision = 0;'), html.indexOf('  // V10.6: identifica'));
function fixture() {
  let path = '/profissional/home', session = { role: 'profissional', userId: 'p1' };
  let user = { id: 'p1' }, rendered = [], redirects = [], errors = 0, content;
  const scope = {
    currentPath: () => path, currentSession: () => session, currentUser: () => user,
    matchRoute: () => ({ route: { role: 'profissional', tab: 'servicos', render: () => 'same' }, params: {} }),
    renderApp() { rendered.push(path); content = { qfPath: path, qfRenderedHtml: 'same' }; },
    renderAnon() {}, navigate(p) { redirects.push(p); path = p; },
    renderConnectionError() { errors++; }, userIsEditing: () => false,
    document: { querySelector: () => null, getElementById: () => content },
    window: { scrollY: 0, scrollTo() {} }, setTimeout, console: { error() {}, warn() {} },
    DB: { logout() { session = null; } }, PU: { toast() {} }, sessionStorage: { getItem() {}, setItem() {} },
    syncPersistentProfessionalNotices: async () => {},
    global: { QFConnection: { deadline: p => p }, QFCloud: { enabled: true, syncForCurrentSession: async () => {}, pendingFlow: async () => ({ pending: false }) }, QFPush: { refreshStatus: async () => {} } }
  };
  vm.createContext(scope); vm.runInContext(source, scope);
  return { scope, rendered, redirects, get errors() { return errors; }, setPath(p) { path = p; }, expire() { session = null; user = null; } };
}
const tick = () => new Promise(r => setTimeout(r, 5));
test('first load validates; subsequent client and professional navigation renders before slow network', async () => {
  for (const role of ['profissional', 'cliente']) {
    const f = fixture();
    f.scope.currentSession = () => ({ role, userId: 'p1' });
    f.scope.matchRoute = () => ({ route: { role, tab: 'servicos', render: () => 'same' }, params: {} });
    let release;
    f.scope.global.QFCloud.syncForCurrentSession = () => new Promise(r => { release = r; });
    const initial = f.scope.route(); assert.equal(f.rendered.length, 0);
    release(); await initial; assert.equal(f.rendered.length, 1);
    f.setPath('/' + role + '/servicos');
    const next = f.scope.route(); assert.equal(f.rendered.length, 2, 'draw happens synchronously');
    await tick(); release(); await next;
    assert.equal(f.rendered.length, 2, 'unchanged content is not remounted');
  }
});
test('late navigation cannot redraw or redirect a newer screen', async () => {
  const f = fixture(); await f.scope.route();
  let release;
  f.scope.global.QFCloud.pendingFlow = () => new Promise(r => { release = r; });
  f.setPath('/profissional/servicos'); const old = f.scope.route(); await tick();
  f.scope.global.QFCloud.pendingFlow = async () => ({ pending: false });
  f.setPath('/profissional/carteira'); await f.scope.route();
  release({ pending: true, chamado_id: 'old' }); await old;
  assert.deepEqual(f.redirects, []); assert.equal(f.rendered.at(-1), '/profissional/carteira');
});
test('offline keeps an already loaded screen, while first-load errors remain visible', async () => {
  const f = fixture(); await f.scope.route();
  f.scope.global.QFCloud.syncForCurrentSession = async () => { throw Error('offline'); };
  f.setPath('/profissional/servicos'); await f.scope.route(); assert.equal(f.errors, 0);
  const cold = fixture(); cold.scope.global.QFCloud.syncForCurrentSession = f.scope.global.QFCloud.syncForCurrentSession;
  await cold.scope.route(); assert.equal(cold.errors, 1);
});
test('pending service guard and expired sessions still redirect', async () => {
  const f = fixture(); await f.scope.route();
  f.scope.global.QFCloud.pendingFlow = async () => ({ pending: true, chamado_id: '123' });
  f.setPath('/profissional/servicos'); await f.scope.route();
  assert.equal(f.redirects.at(-1), '/profissional/pedido/123');
  f.scope.global.QFCloud.pendingFlow = async () => ({ pending: false });
  f.scope.global.QFCloud.syncForCurrentSession = async () => f.expire();
  f.setPath('/profissional/carteira'); await f.scope.route(); assert.equal(f.redirects.at(-1), '/');
});
test('background response preserves edited forms', async () => {
  const f = fixture(); await f.scope.route();
  let release;
  f.scope.global.QFCloud.syncForCurrentSession = () => new Promise(r => { release = r; });
  f.setPath('/profissional/perfil'); const next = f.scope.route();
  f.scope.userIsEditing = () => true;
  f.scope.matchRoute = () => ({ route: { role: 'profissional', tab: 'perfil', render: () => 'changed' }, params: {} });
  await tick(); release(); await next; assert.equal(f.rendered.length, 2);
});
