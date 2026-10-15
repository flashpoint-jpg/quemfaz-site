// V11.92: notificação web só pelo domínio oficial (preview da Vercel duplicava aviso e virava "possível spam").
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), { stripTypeScriptTypes } = require('node:module');
const root = __dirname + '/..';
const push = fs.readFileSync(root + '/supabase/functions/quemfaz-push/index.ts', 'utf8');
const aviso = fs.readFileSync(root + '/supabase/functions/quemfaz-admin-aviso/index.ts', 'utf8');

function helpers() {
  const a = push.indexOf('// V11.92: de onde vem a inscrição web');
  const b = push.indexOf('  return !o || PUSH_ORIGINS_OK.has(o);\n}\n', a) + 40;
  const ctx = { Set, String };
  vm.createContext(ctx);
  vm.runInContext(stripTypeScriptTypes(push.slice(a, b)) + '\nglobalThis.H={webPushOrigin,deviceSignature,webSubOk,PUSH_ORIGIN_OFICIAL};', ctx);
  return ctx.H;
}

test('origem: www vira o domínio oficial; preview não é aceito', () => {
  const H = helpers();
  const req = o => ({ headers: { get: () => o } });
  assert.equal(H.webPushOrigin(req('https://www.quemfazservico.com.br')), H.PUSH_ORIGIN_OFICIAL);
  assert.equal(H.webSubOk({ origem: 'https://quemfazservico.com.br' }), true);
  assert.equal(H.webSubOk({ origem: 'https://quemfaz-site-d5564w8w4-entregaflhas.vercel.app' }), false);
  assert.equal(H.webSubOk({ origem: null }), true, 'inscrições antigas sem origem continuam recebendo');
});

test('mesmo aparelho é reconhecido mesmo com o Chrome atualizado', () => {
  const H = helpers();
  const a = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36';
  const b = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';
  const pc = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0';
  assert.equal(H.deviceSignature(a), H.deviceSignature(b));
  assert.notEqual(H.deviceSignature(a), H.deviceSignature(pc));
});

test('inscrição grava a origem, recusa preview e desativa as duplicadas', () => {
  const sub = push.slice(push.indexOf('if (action === "subscribe") {'), push.indexOf('if (action === "test_self")'));
  assert.match(sub, /wrong_origin: true/);
  assert.match(sub, /origem,\n/);
  assert.match(sub, /official_exists/);
  assert.match(sub, /\.in\("id", velhas\)/);
  assert.match(push, /\.filter\(webSubOk\)/);
  assert.match(aviso, /\.filter\(webSubOk\)/);
});

test('app e painel não ativam notificação em endereço de preview', () => {
  for (const f of ['index.html', 'admin.html']) {
    const s = fs.readFileSync(root + '/' + f, 'utf8');
    assert.ok(s.includes("/\\.vercel\\.app$/.test(String(location.hostname || '')) && location.hostname !== 'quemfaz-site.vercel.app'"), f);
  }
  const admin = fs.readFileSync(root + '/admin.html', 'utf8');
  assert.match(admin, /pushRestored = true;[\s\S]{0,200}activatePush\(\)\.catch/);
});
