const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');

function boot(name, storage) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  const start = html.indexOf('(function (global)', html.indexOf('/* QuemFaz — dados do Supabase'));
  const end = html.indexOf('})(window);', start) + '})(window);'.length;
  const window = { localStorage: storage };
  const scope = { window, PU: { uid: (() => { let n = 0; return () => String(++n); })() }, console, Date };
  vm.runInNewContext(html.slice(start, end), scope);
  window.DB.load();
  return { DB: window.DB, html };
}
for (const name of ['index.html', 'admin.html']) {
  test(name + ': dados grandes nunca são gravados nem restaurados do aparelho', () => {
    const values = new Map([
      ['quemfaz_db_v2', '{"users":{"clientes":[{"id":"old-private-data"}]}}'],
      ['quemfaz_session_v2', '{"role":"admin","userId":"admin_1"}'],
      ['sb-auth-token', 'access-token'],
      ['qf_pending_selfie_test', 'pending-upload']
    ]);
    let writes = 0;
    const storage = { getItem(k) { return values.get(k) ?? null; }, removeItem(k) { values.delete(k); },
      setItem(k, v) { writes++; throw Object.assign(new Error('quota full'), { name: 'QuotaExceededError' }); } };
    const { DB } = boot(name, storage);
    assert.equal(values.has('quemfaz_db_v2'), false);
    assert.equal(values.get('sb-auth-token'), 'access-token');
    assert.equal(values.get('qf_pending_selfie_test'), 'pending-upload');
    assert.equal(DB.getSession().userId, 'admin_1');
    DB.state.requests = [{ id: 'from-server', fotos: ['x'.repeat(6 * 1024 * 1024)] }];
    assert.doesNotThrow(() => DB.persist());
    assert.equal(writes, 0);
    assert.equal(DB.load().requests[0].id, 'from-server', 'Recarregar o modelo na mesma tela preserva a resposta recebida');
    DB.setSession(null);
    assert.equal(DB.getSession(), null, 'Logout em memória prevalece sobre sessão antiga se a quota está cheia');
    assert.equal(boot(name, storage).DB.state.requests.some(r => r.id === 'from-server'), false, 'Nova abertura exige dados da nuvem');
  });
  test(name + ': armazenamento bloqueado não impede estado de tela e sessão em memória', () => {
    const blocked = () => { throw new Error('Storage disabled'); };
    const { DB } = boot(name, { getItem: blocked, setItem: blocked, removeItem: blocked });
    DB.setSession({ role: 'cliente', userId: 'cloud-user' });
    assert.equal(DB.getSession().userId, 'cloud-user');
    DB.state.requests = [{ id: 'cloud-call' }];
    assert.doesNotThrow(() => DB.persist());
    assert.equal(DB.requestById('cloud-call').id, 'cloud-call');
    DB.setSession(null);
    assert.equal(DB.getSession(), null);
  });
}
test('Painel: anúncios retornados pelo banco atualizam com armazenamento cheio', async () => {
  const { DB, html } = boot('admin.html', {
    getItem: () => null, removeItem() {}, setItem() { throw new Error('quota exceeded'); }
  });
  const start = html.indexOf('  async function syncAds()');
  const end = html.indexOf('  async function approve(', start);
  const scope = { DB, mapAd: r => r, client: { rpc: async name => ({
    data: name === 'qf_admin_listar_anuncios' ? [{ id: 'ad-cloud', imagem: 'x'.repeat(6 * 1024 * 1024) }] : {}, error: null
  }) } };
  vm.createContext(scope); vm.runInContext(html.slice(start, end), scope);
  const ads = await scope.syncAds();
  assert.equal(ads[0].id, 'ad-cloud');
  assert.equal(DB.state.ads[0].id, 'ad-cloud');
});
