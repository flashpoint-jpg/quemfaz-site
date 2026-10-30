/* Testes isolados da função real de visitante: SEM chaves, banco externo ou pedidos de produção. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder } = require('node:util');
const { transformSync } = require('esbuild');

const functionFile = path.resolve(__dirname, '../supabase/functions/quemfaz-cliente-rapido/index.ts');
const original = fs.readFileSync(functionFile, 'utf8');
const withoutImports = original.replace(/^import\s+.*?;\s*$/gm, '');
const compiled = transformSync(withoutImports, { loader: 'ts', format: 'iife', target: 'es2022' }).code;

function fixture(options = {}) {
  const users = new Map();
  const profiles = new Map();
  const events = [];
  const deleted = [];
  const calls = [];
  const oldId = '11111111-1111-4111-8111-111111111111';
  const visitorId = '22222222-2222-4222-8222-222222222222';
  if (options.oldAccount) {
    users.set(oldId, { id: oldId, email: 'antigo@example.com' });
    profiles.set(oldId, { id: oldId, tipo: 'cliente', telefone: '11987654321' });
  }
  const admin = {
    auth: { admin: {
      createUser: async attrs => {
        calls.push(['createUser', attrs]);
        if (options.createError) return { data: null, error: { message: 'unavailable' } };
        const user = { id: visitorId, email: attrs.email, app_metadata: attrs.app_metadata };
        users.set(visitorId, user);
        return { data: { user }, error: null };
      },
      deleteUser: async id => {
        deleted.push(id);
        users.delete(id);
        profiles.delete(id);
        return { error: null };
      },
      generateLink: async ({ type, email }) => {
        calls.push(['generateLink', { type, email }]);
        if (options.linkError) return { data: { properties: {} }, error: { message: 'unavailable' } };
        return { data: { properties: { hashed_token: 'hash-pedido-visitante' } }, error: null };
      }
    } },
    rpc: async (...args) => {
      calls.push(['rpc', args]);
      if (options.oldAccount && args[0] === 'qf_cliente_canonico_por_whatsapp') {
        return { data: [{ id: oldId }], error: null };
      }
      return { data: [], error: null };
    },
    from: name => {
      if (name === 'qf_cliente_auth_eventos') {
        const filters = {};
        return {
          select: () => ({
            eq(field, value) { filters[field] = value; return this; },
            async gte() {
              if (options.counterError) return { count: null, error: { message: 'unavailable' } };
              const count = filters.ip_hash ? (options.ipCount || 0) : (options.phoneCount || 0);
              return { count, error: null };
            }
          }),
          insert: async value => {
            calls.push(['event', value]);
            events.push(value);
            return { error: null };
          }
        };
      }
      if (name === 'qf_profiles') {
        return { upsert: async (value, settings) => {
          calls.push(['upsert', value]);
          if (options.profileError) return { error: { message: 'unique violation' } };
          if (!value.visitante_sem_cadastro) throw Error('Visitante sem identidade separada.');
          if (users.get(value.id)?.app_metadata?.qf_guest !== true) {
            throw Error('A marca de visitante deve vir de app_metadata do servidor.');
          }
          if (profiles.get(value.id)) throw Error('Identidade repetida.');
          profiles.set(value.id, value);
          return { error: null };
        }};
      }
      throw Error('Tabela não prevista nos testes: ' + name);
    }
  };
  let handler;
  vm.runInNewContext(compiled, {
    Deno: {
      env: { get: k => k === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'chave-somente-mock' },
      serve: fn => { handler = fn; }
    },
    createClient: () => admin,
    crypto: webcrypto, TextEncoder, Request, Response, URL, console
  }, { filename: 'quemfaz-cliente-rapido.ts', timeout: 1000 });
  assert.equal(typeof handler, 'function');
  async function request(body, headers = {}) {
    const r = await handler(new Request('https://example.supabase.co/functions/v1/quemfaz-cliente-rapido', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.24', ...headers },
      body: JSON.stringify(body)
    }));
    return { status: r.status, body: await r.json() };
  }
  return { users, profiles, events, deleted, calls, oldId, visitorId, request, handler };
}

test('Publica como visitante sem Google, senha, SMS ou service_role no cliente', async () => {
  const f = fixture();
  const { status, body } = await f.request({ modo: 'visitante', nome: 'Maria Teste', telefone: '(11) 98765-4321' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.guest, true);
  assert.equal(body.user_id, f.visitorId);
  assert.equal(body.otp_type, 'magiclink');
  assert.equal(body.token_hash, 'hash-pedido-visitante');
  assert.equal(f.profiles.get(f.visitorId).visitante_sem_cadastro, true);
  assert.equal(f.profiles.get(f.visitorId).telefone, '11987654321');
  assert.equal(f.users.get(f.visitorId).app_metadata.qf_guest, true);
  assert.equal(f.events.length, 1);
  assert.equal(f.calls.filter(x => x[0] === 'rpc').length, 0);
  assert.ok(!JSON.stringify(body).includes('chave-somente-mock'));
});

test('Telefone já cadastrado gera identidade nova e preserva integralmente a antiga', async () => {
  const f = fixture({ oldAccount: true });
  const before = JSON.stringify(f.profiles.get(f.oldId));
  const r = await f.request({ modo: 'visitante', nome: 'Outra Pessoa', telefone: '11987654321' });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.user_id, f.oldId);
  assert.equal(JSON.stringify(f.profiles.get(f.oldId)), before);
  assert.deepEqual(f.deleted, []);
  assert.equal(f.calls.filter(x => x[0] === 'rpc').length, 0);
});

test('Valida celular e nome antes de criar usuário', async () => {
  for (const body of [
    { modo: 'visitante', nome: 'A', telefone: '11987654321' },
    { modo: 'visitante', nome: 'Teste', telefone: '00000000000' },
    { modo: 'visitante', nome: 'Teste', telefone: '11912345678' }
  ]) {
    const f = fixture();
    const r = await f.request(body);
    assert.equal(r.status, 400);
    assert.equal(f.users.size, 0);
    assert.equal(f.calls.length, 0);
  }
});

test('Limita criação de visitantes por IP e por telefone, sem criar usuário', async () => {
  for (const settings of [{ ipCount: 6 }, { phoneCount: 4 }]) {
    const f = fixture(settings);
    const r = await f.request({ modo: 'visitante', nome: 'Teste', telefone: '11987654321' });
    assert.equal(r.status, 429);
    assert.equal(f.users.size, 0);
    assert.equal(f.calls.some(x => x[0] === 'createUser'), false);
  }
});

test('Contador indisponível bloqueia a publicação sem liberar criação ilimitada', async () => {
  const f = fixture({ counterError: true });
  const r = await f.request({ modo: 'visitante', nome: 'Teste', telefone: '11987654321' });
  assert.equal(r.status, 503);
  assert.equal(f.users.size, 0);
});

test('Falha de perfil ou geração de token limpa somente o visitante recém-criado', async () => {
  for (const settings of [{ profileError: true }, { linkError: true }]) {
    const f = fixture({ ...settings, oldAccount: true });
    const r = await f.request({ modo: 'visitante', nome: 'Teste', telefone: '11987654321' });
    assert.equal(r.status, 500);
    assert.equal(f.users.has(f.visitorId), false);
    assert.deepEqual(f.deleted, [f.visitorId]);
    assert.equal(f.users.has(f.oldId), true);
  }
});

test('Sem prova de posse, modo antigo entrar não cria sessão de outro cliente', async () => {
  const f = fixture({ oldAccount: true });
  const r = await f.request({ modo: 'entrar', telefone: '11987654321', codigo: '12' });
  assert.equal(r.status, 400);
  assert.equal(f.calls.length, 0);
});

test('OPTIONS sem efeitos colaterais, HEAD não permitido', async () => {
  const f = fixture();
  const opt = await f.handler(new Request('https://example.supabase.co/functions/v1/quemfaz-cliente-rapido', { method: 'OPTIONS' }));
  assert.equal(opt.status, 200);
  const head = await f.handler(new Request('https://example.supabase.co/functions/v1/quemfaz-cliente-rapido', { method: 'HEAD' }));
  assert.equal(head.status, 405);
  assert.equal(f.users.size, 0);
});

test('Migração separa visitante do cadastro de telefone e preserva validação autenticada', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261030115500_publicacao_visitante_sem_login.sql'), 'utf8');
  assert.match(migration, /visitante_sem_cadastro\s*=\s*false/i);
  assert.match(migration, /raw_app_meta_data/);
  assert.match(migration, /qf_cliente_canonico_por_whatsapp/);
  assert.match(migration, /CREATE UNIQUE INDEX qf_profiles_cliente_telefone_unico/i);
});
