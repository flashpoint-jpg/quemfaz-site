const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const { PGlite } = require('@electric-sql/pglite');

const root = path.join(__dirname, '..');

test('Professional search accepts typos, contact details and ignores city selection during search', () => {
  const admin = fs.readFileSync(path.join(root, 'dist/admin.html'), 'utf8');
  const start = admin.indexOf('  function bindProfissionaisLista(content) {');
  const end = admin.indexOf('  Screens.adminProfissionalDetalheRender', start);
  const normalize = admin.match(/^  function catNormAdmin\(v\).*$/m)[0];
  const { window } = new JSDOM(`<main>
    <input id="qf-prof-busca"><p data-prof-resultados></p><div class="qf-prof-cities"></div>
    <section data-prof-grupo="santo andre"><div data-prof-nome="patrick nascimento pereira" data-prof-search="patrick nascimento pereira 11999990000 patrick@example.test">Patrick</div></section>
    <section data-prof-grupo="outra"><div data-prof-nome="jose silva" data-prof-search="jose silva 11988880000 jose@example.test">José</div></section>
  </main>`);
  const main = window.document.querySelector('main');
  const context = { main, document: window.document, profBusca: '', profCidadeFiltro: 'outra' };
  vm.runInNewContext(normalize + '\n' + admin.slice(start, end) + '\nbindProfissionaisLista(main);', context);
  const [patrick, jose] = main.querySelectorAll('[data-prof-search]');
  const search = main.querySelector('input');
  const status = main.querySelector('[data-prof-resultados]');
  const query = (value) => {
    search.value = value;
    search.dispatchEvent(new window.Event('input'));
  };
  assert.equal(patrick.hidden, true);
  assert.equal(jose.hidden, false);
  for (const term of ['PATRIK', 'Patrick Pereira', '+55 (11) 99999-0000', 'patrick@example.test']) {
    query(term);
    assert.equal(patrick.hidden, false, term);
    assert.equal(jose.hidden, true, term);
    assert.match(status.textContent, /^1 profissional encontrado/);
  }
  query('Sem resultado');
  assert.match(status.textContent, /Nenhum profissional encontrado/);
  query('');
  assert.equal(patrick.hidden, true);
  assert.equal(jose.hidden, false);
  assert.match(admin, /Editar dados<\/button>/);
  assert.match(admin, /Estender plano<\/button>/);
});

test('Only an admin can extend an active plan, without altering quotas or double-applying the request', async () => {
  const db = new PGlite();
  const profile = '00000000-0000-4000-8000-000000000001';
  const admin = '00000000-0000-4000-8000-000000000002';
  const legacy = '00000000-0000-4000-8000-000000000003';
  const livre = '00000000-0000-4000-8000-000000000004';
  const payment = '00000000-0000-4000-8000-000000000005';
  const scheduled = '00000000-0000-4000-8000-000000000006';
  const before = '2099-01-01T00:00:00.123456Z';
  const extend = (plan, days) => `select public.qf_admin_estender_plano_profissional('${profile}', '${plan}', '${before}', ${days}) as data`;
  try {
    await db.exec(`
      create role authenticated;
      create role anon;
      create schema private;
      create schema auth;
      grant usage on schema private to authenticated;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create function private.qf_is_admin() returns boolean language sql stable as $$
        select auth.uid() = '${admin}'::uuid
      $$;
      create table public.qf_profissionais(user_id uuid primary key);
      create table public.qf_recargas(id uuid primary key, status text);
      create table public.qf_planos_profissional(
        id uuid primary key, profissional_id uuid, plano text, chamados_total integer, chamados_restantes integer,
        valido_ate timestamptz, criado_em timestamptz default now(), recarga_id uuid, atualizado_em timestamptz
      );
      create table public.qf_livre_assinaturas(
        id uuid primary key, profissional_id uuid, recarga_id uuid, inicio_em timestamptz,
        fim_em timestamptz, criado_em timestamptz default now()
      );
      insert into public.qf_profissionais values ('${profile}');
      insert into public.qf_planos_profissional(id, profissional_id, plano, chamados_total, chamados_restantes, valido_ate)
        values ('${legacy}', '${profile}', 'pro', 10, 4, '${before}');
      insert into public.qf_recargas values ('${payment}', 'aprovado');
      insert into public.qf_livre_assinaturas(id, profissional_id, recarga_id, inicio_em, fim_em)
        values ('${livre}', '${profile}', '${payment}', '2020-01-01', '${before}'),
               ('${scheduled}', '${profile}', '${payment}', '2099-01-03', '2099-02-01');
    `);
    const migration = '20261123131609_admin_estender_plano_profissional.sql';
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8'));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${profile}';`);
    await assert.rejects(db.query(extend(legacy, 1)), /Sem permissão/);
    await db.exec(`set request.jwt.claim.sub = '${admin}';`);
    const snapshot = await db.query('select public.qf_admin_planos_profissionais() as data');
    assert.ok(snapshot.rows[0].data.some((plan) => plan.registro_id === legacy));
    assert.ok(snapshot.rows[0].data.some((plan) => plan.registro_id === livre));
    await assert.rejects(db.query(extend(legacy, 0)), /1 a 365/);
    const result = await db.query(extend(legacy, 3));
    assert.match(result.rows[0].data.valido_ate, /^2099-01-04T00:00:00\.123456/);
    await assert.rejects(db.query(extend(legacy, 3)), /foi alterado/);
    await assert.rejects(db.query(extend(livre, 3)), /período do Livre já agendado/);
    await db.query(extend(livre, 1));
    await db.exec('reset role;');
    const quotas = await db.query('select chamados_total, chamados_restantes from public.qf_planos_profissional');
    assert.deepEqual(quotas.rows, [{ chamados_total: 10, chamados_restantes: 4 }]);
    const audits = await db.query('select dias from private.qf_admin_extensoes_plano order by id');
    assert.deepEqual(audits.rows, [{ dias: 3 }, { dias: 1 }]);
  } finally {
    await db.close();
  }
});
