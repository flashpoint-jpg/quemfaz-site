const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { PGlite } = require('@electric-sql/pglite');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'dist/admin.html'), 'utf8');
const admin = '00000000-0000-4000-8000-000000000001';
const profile = '00000000-0000-4000-8000-000000000002';
const operation = '00000000-0000-4000-8000-000000000003';

test('saldo fica no topo e confirma o mesmo lançamento após falha de conexão', async () => {
  const start = source.indexOf('  function adminProfCarteiraHtml(p) {');
  const end = source.indexOf('  function adminProfGestaoHtml(p) {', start);
  const profileStart = source.indexOf('  function adminProfCloud(p) {');
  const profileSource = source.slice(profileStart, source.indexOf('  function waHref(', profileStart));
  assert.ok(profileSource.indexOf('adminProfCarteiraHtml(p) +') < profileSource.indexOf('adminProfGestaoHtml(p) +'));
  assert.doesNotMatch(profileSource, /data-action="add-creditos"/);
  const { window } = new JSDOM('<main></main>');
  const main = window.document.querySelector('main');
  const person = { nome: 'Profissional de teste', saldo: 740 };
  const calls = [];

  try {
    vm.runInNewContext(source.slice(start, end) + '\nmain.innerHTML = adminProfCarteiraHtml(person); bindProfCarteira(main, id);', {
      main, person, id: profile, cloudOn: () => true,
      DB: { profissionalById: () => person },
      PU: {
        escapeHtml: text => text,
        formatCurrency: cents => 'R$ ' + (cents / 100).toFixed(2).replace('.', ','),
        parseCurrencyInput: text => Math.round(Number(text.replace(',', '.')) * 100),
      },
      global: {
        crypto: { randomUUID: () => operation },
        QFConnection: { deadline: promise => promise },
        QFAdminCloud: { client: { rpc: async (name, args) => {
          assert.equal(name, 'qf_admin_creditar_carteira');
          calls.push({ ...args });
          if (calls.length === 1) throw Error('Conexão interrompida');
          return { data: { ok: true, saldo_centavos: 2740 } };
        } } },
      },
    });
    const form = main.querySelector('form');
    const submit = async () => {
      form.dispatchEvent(new window.Event('submit', { cancelable: true }));
      await new Promise(resolve => setImmediate(resolve));
    };
    const pendingStatus = form.querySelector('[data-prof-credito-status]');
    const confirm = form.querySelector('[data-prof-credito-confirmar]');
    form.elements.valor.value = '0';
    await submit();
    assert.equal(calls.length, 0);
    assert.match(pendingStatus.textContent, /Informe um valor válido/);
    assert.match(form.textContent, /Adicionar à carteira de Profissional de teste/);
    form.elements.valor.value = 'R$ 20,00';
    confirm.click();
    await submit();
    assert.match(pendingStatus.textContent, /Confirmação pendente/);
    assert.equal(form.elements.valor.readOnly, true);
    assert.equal(confirm.textContent, 'Verificar lançamento');
    confirm.click();
    confirm.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [calls[0], calls[0]]);
    assert.equal(calls[0].p_valor_centavos, 2000);
    assert.equal(calls[0].p_operacao_id, operation);
    assert.equal(person.saldo, 2740);
    assert.equal(main.querySelector('[data-prof-saldo-atual]').textContent, 'R$ 27,40');
    assert.match(main.querySelector('[data-prof-credito-concluido]').textContent, /Saldo adicionado/);
  } finally {
    window.close();
  }
});

test('crédito manual exige administrador, retorna saldo real e não duplica a operação', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema private;
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table qf_admins (user_id uuid primary key);
      create table qf_profissionais (user_id uuid primary key);
      create table qf_carteiras (profissional_id uuid primary key references qf_profissionais, saldo_centavos bigint,
        bonus_inicial_centavos bigint, bonus_inicial_usado boolean, atualizado_em timestamptz);
      create table qf_movimentacoes_carteira (profissional_id uuid references qf_profissionais, tipo text,
        valor_centavos integer check (valor_centavos > 0), referencia_tipo text, referencia_id uuid, descricao text);
      create table qf_auditoria (id uuid);
      create function private.qf_log_pagamento(uuid, uuid, text, jsonb, text) returns void language sql
        as $$ insert into public.qf_auditoria values ($1) $$;
      insert into qf_admins values ('${admin}');
      insert into qf_profissionais values ('${profile}');
      insert into qf_carteiras values ('${profile}', 740, 0, false, now());
    `);
    const migrations = path.join(root, 'supabase/migrations');
    const migration = fs.readdirSync(migrations).find(name => name.endsWith('_admin_credito_carteira_confirmado.sql'));
    await db.exec(fs.readFileSync(path.join(migrations, migration), 'utf8'));
    const credit = async cents => (await db.query('select public.qf_admin_creditar_carteira($1, $2, $3, $4) as result',
      [profile, cents, 'Cortesia', operation])).rows[0].result;
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${profile}'`);
    await assert.rejects(credit(2000), /Sem permissão/);
    await db.exec(`set request.jwt.claim.sub = '${admin}'`);
    assert.equal((await credit(-1)).ok, false);
    assert.deepEqual(await credit(2000), { ok: true, saldo_centavos: 2740 });
    assert.deepEqual(await credit(2000), { ok: true, saldo_centavos: 2740 });
    assert.equal((await credit(3000)).ok, false);
    await db.exec('reset role');
    assert.deepEqual((await db.query('select valor_centavos, referencia_id from qf_movimentacoes_carteira')).rows,
      [{ valor_centavos: 2000, referencia_id: operation }]);
    assert.deepEqual((await db.query('select id from qf_auditoria')).rows, [{ id: operation }]);
  } finally {
    await db.close();
  }
});
