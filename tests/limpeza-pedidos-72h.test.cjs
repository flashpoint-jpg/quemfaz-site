const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync(path.join(__dirname,
  '../supabase/migrations/20261022125145_limpeza_pedidos_72h_sem_desbloqueio.sql'), 'utf8');

test('72h cleanup preserves schedules, every historical unlock, negotiations, finals and Garante', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema private;
      create role anon; create role authenticated; create role service_role;
      create table public.qf_chamados (
        id integer primary key, status text, atendimento_tipo text,
        criado_em timestamptz, atualizado_em timestamptz,
        data_preferida timestamptz, prazo_dia date
      );
      create table public.qf_desbloqueios (chamado_id integer, ativo boolean, criado_em timestamptz);
      create table public.qf_orcamentos (chamado_id integer, status text);
      begin;
    `);
    // Execute the actual production predicate/cleanup functions, not a JS copy.
    await db.exec(migration.split('-- Apply only the availability predicate')[0]);
    await db.exec(`
      insert into public.qf_chamados(id,status,criado_em,atualizado_em)
      select n, 'aberto', now()-interval '100 hours', now() from generate_series(1,15) n;
      update public.qf_chamados set criado_em=now()-interval '72 hours' where id=2;
      update public.qf_chamados set criado_em=now()-interval '71 hours' where id=3;
      update public.qf_chamados set prazo_dia=(now() at time zone 'America/Sao_Paulo')::date+1 where id=4;
      update public.qf_chamados set data_preferida=now()+interval '5 days' where id=5;
      update public.qf_chamados set prazo_dia=(now() at time zone 'America/Sao_Paulo')::date where id=6;
      update public.qf_chamados set data_preferida=
        ((now() at time zone 'America/Sao_Paulo')::date::timestamp at time zone 'America/Sao_Paulo') where id=7;
      insert into public.qf_desbloqueios values
        (8,true,now()-interval '90 hours'), (9,false,now()-interval '90 hours');
      update public.qf_chamados set status='em_negociacao' where id=10;
      update public.qf_chamados set status='finalizado' where id=11;
      update public.qf_chamados set status='concluido' where id=12;
      update public.qf_chamados set atendimento_tipo='garante' where id=13;
      update public.qf_chamados set status='cancelado' where id=14;
      insert into public.qf_orcamentos values(15,'aceito');
    `);
    const before = (await db.query('select * from public.qf_chamados order by id')).rows;
    const expected = (await db.query('select id from public.qf_chamados c where private.qf_pedido_expiravel_72h(c)')).rows;
    assert.deepEqual(expected.map(x => x.id), [1]);
    const availability = ['qf_listar_chamados_disponiveis', 'qf_outros_pedidos_vitrine',
      'qf_outros_pedidos_vitrine_v2', 'qf_chamado_destinatarios_alcance',
      'qf_cascata_destinatarios', 'qf_push_reservar_entregas', 'qf_push_aberto_todos_destinatarios'];
    for (const name of availability) {
      await db.exec(`create function public.${name}(p_chamado_id integer) returns table(id integer)
        language sql as $$ select c.id from public.qf_chamados c
        where c.id = p_chamado_id ${name === 'qf_push_aberto_todos_destinatarios' ? '' : "and c.status in ('aberto','em_negociacao')"} $$;`);
    }
    const patch = migration.match(/do \$patch\$[\s\S]*?\$patch\$;/)[0];
    await db.exec(patch);
    await db.exec(patch); // Reapplication must preserve all guards.
    for (const name of availability) {
      assert.equal((await db.query(`select * from public.${name}(1)`)).rows.length, 0, `${name}: expired before cron`);
      assert.equal((await db.query(`select * from public.${name}(14)`)).rows.length, 0, `${name}: cancelled`);
      assert.equal((await db.query(`select * from public.${name}(4)`)).rows.length, 1, `${name}: future scheduled`);
      assert.equal((await db.query(`select * from public.${name}(8)`)).rows.length, 1, `${name}: historical unlock`);
    }
    assert.equal((await db.query('select private.qf_expirar_chamados() n')).rows[0].n, 1);
    assert.equal((await db.query('select private.qf_expirar_chamados() n')).rows[0].n, 0);
    assert.equal((await db.query('select private.qf_fechar_sem_retorno() n')).rows[0].n, 0);
    const after = (await db.query('select * from public.qf_chamados order by id')).rows;
    assert.equal(after[0].status, 'cancelado');
    assert.deepEqual(after.slice(1), before.slice(1));
    assert.equal((await db.query('select count(*)::int n from public.qf_desbloqueios')).rows[0].n, 2);
    // Once a future scheduled day has passed, an otherwise eligible request expires.
    await db.exec(`update public.qf_chamados set prazo_dia=(now() at time zone 'America/Sao_Paulo')::date-1 where id=4`);
    assert.equal((await db.query('select private.qf_expirar_chamados() n')).rows[0].n, 1);
    // Cron uses the existing job; the obsolete unlocked-order timer stays disabled.
    assert.match(migration, /cron.schedule\('qf-expirar-chamados', '\* \* \* \* \*'/);
    assert.match(migration, /cron.alter_job\(jobid, active := false\)/);
    assert.match(migration, /and not private.qf_pedido_expiravel_72h\(c\)/);
    await db.exec('rollback');
  } finally { await db.close(); }
});
