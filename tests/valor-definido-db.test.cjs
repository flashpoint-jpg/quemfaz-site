// Banco isolado (PGlite): esquema de produção reduzido + migração de pedidos com valor definido + asserções SQL.
// As mesmas três etapas foram executadas em PostgreSQL 16 com psql (ver docs/valor-definido-qr.md).
const {test}=require('node:test');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(p,'utf8');
test('valor definido: esquema + migração + asserções do banco',async()=>{
 const db=new PGlite();
 try{
  await db.exec(read('tests/fixtures/valor-definido-schema.sql'));
  await db.exec(read('supabase/2026-10-18-pedidos-valor-definido-qr.sql'));
  await db.exec(read('tests/valor-definido-db.sql'));
 }finally{await db.close();}
});
test('valor definido: reversão remove só as funções novas e preserva dados',async()=>{
 const db=new PGlite();
 try{
  await db.exec(read('tests/fixtures/valor-definido-schema.sql'));
  await db.exec(read('supabase/2026-10-18-pedidos-valor-definido-qr.sql'));
  await db.exec(read('tests/valor-definido-db.sql'));
  await db.exec(read('supabase/2026-10-18-pedidos-valor-definido-qr-rollback.sql'));
  const r=await db.query("select (select count(*)::int from pg_proc where proname in ('qf_desbloquear_chamado_valor','qf_solicitar_baixa','qf_valor_cfg')) f,(select count(*)::int from pg_tables where tablename in ('qf_conclusoes','qf_pedido_eventos')) t,(select count(*)::int from public.qf_avaliacoes) a");
  const row=r.rows[0];
  if(row.f!==0||row.t!==2||row.a<1)throw new Error('reversão inesperada '+JSON.stringify(row));
 }finally{await db.close();}
});
