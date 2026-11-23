const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('chamado 24h só libera contato para os participantes após validar o Pix de R$ 20', async () => {
 const db = new PGlite();
 const id = n => '10000000-0000-4000-8000-00000000000'+n;
 const [client,pro,other] = [id(1),id(2),id(3)];
 try {
  await db.exec(`
   create role anon; create role authenticated; create role service_role;
   create schema auth; create schema private;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('qf.user',true),'')::uuid$$;
   create table qf_profiles(id uuid primary key,tipo text,nome text,telefone text,whatsapp text,cidade text,uf text,ativo boolean);
   create table qf_profissionais(user_id uuid primary key,especialidades text[]);
   create table qf_profissional_cidades(profissional_id uuid,cidade text,uf text);
   create table qf_recargas(id uuid primary key,profissional_id uuid,status text);
   create table qf_planos_profissional(recarga_id uuid,profissional_id uuid,plano text,valido_ate timestamptz,chamados_restantes int);
   create function private.qf_push_interno(text,uuid) returns void language plpgsql as $$begin null; end;$$;
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20261123214500_chamado_urgente_24h.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261123235000_plantao_disponibilidade_na_busca.sql','utf8'));
  for(const [u,role,name,phone] of [[client,'cliente','Cliente','11910000000'],[pro,'profissional','Alex','11910000001'],[other,'profissional','Outra','11910000002']]){
   await db.query("insert into qf_profiles values($1,$2,$3,$4,$4,'Santo André','SP',true)",[u,role,name,phone]);
   if(role==='profissional')await db.query("insert into qf_profissionais values($1,array['cat_eletricista'])",[u]);
  }
  const as = u=>db.query("select set_config('qf.user',$1,false)",[u]);
  const list = async()=> (await db.query('select qf_plantao_listar() as items')).rows[0].items;
  await as(pro);
  await assert.rejects(db.query('select qf_plantao_disponibilidade(true)'),/Ative o 24 Livre/);
  const create = desc=>db.query("select qf_plantao_criar($1,'cat_eletricista',$2,'09010000','Santo André','SP','Centro','Rua Exemplo, 120') as id",[client,desc]);
  const empty = (await create('Sem energia apenas na residência.')).rows[0].id;
  await as(client);
  assert.equal((await list()).find(row=>row.id===empty).estado,'sem_profissional');
  await assert.rejects(db.query('select qf_plantao_pix_reservar($1,$2,true)',[client,empty]),/Prazo da oferta/);
  await as(pro);
  await db.query("insert into qf_recargas values($1,$2,'aprovado')",[id(4),pro]);
  await db.query("insert into qf_planos_profissional values($1,$2,'livre_24h',now()+interval '30 days',20)",[id(4),pro]);
  await db.query('select qf_plantao_disponibilidade(true)');
  await assert.rejects(create('WhatsApp 11 9 1234-5678'),/Remova o telefone/);
  const call=(await create('Sem energia apenas na residência.')).rows[0].id;
  await as(client);
  assert.equal((await list()).find(row=>row.id===call).profissionais_disponiveis,1);
  await as(other);
  assert.deepEqual(await list(),[]);
  await assert.rejects(db.query('select qf_plantao_aceitar($1,30)',[call]),/indisponível/);
  await as(pro);
  assert.equal((await list())[0].profissionais_disponiveis,null);
  assert.equal((await list())[0].telefone,null);
  assert.equal((await list())[0].endereco,null);
  await db.query('select qf_plantao_aceitar($1,30)',[call]);
  await assert.rejects(db.query('select qf_plantao_aceitar($1,45)',[call]),/indisponível/);
  await as(client);
  assert.equal((await list())[0].chegada_minutos,30);
  assert.equal((await list())[0].telefone,null);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select qf_plantao_pix_reservar($1,$2,true)',[client,call]),/permission denied/);
  await db.exec('reset role');
  await db.query('select qf_plantao_pix_reservar($1,$2,true)',[client,call]);
  const confirm = (payer=client, value=2000, time=new Date(), txid=call.replaceAll('-',''), e2e='E'+'A'.repeat(31)) =>
   db.query('select qf_plantao_pix_confirmar($1,$2,$3,$4,$5,$6) as estado',[payer,call,txid,e2e,value,time]);
  await assert.rejects(confirm(other),/não corresponde/);
  await assert.rejects(confirm(client,1999),/não corresponde/);
  assert.equal((await list())[0].telefone,null);
  const result=await confirm();
  assert.equal(result.rows[0].estado,'confirmado');
  assert.equal((await confirm()).rows[0].estado,'confirmado');
  assert.equal((await list())[0].telefone,'11910000001');
  await as(pro);
  assert.equal((await list())[0].telefone,'11910000000');
  assert.equal((await list())[0].endereco,'Rua Exemplo, 120');
  assert.equal((await db.query('select chamados_restantes from qf_planos_profissional')).rows[0].chamados_restantes,20);
  const late=(await create('Rede elétrica da casa caiu.')).rows[0].id;
  await db.query('select qf_plantao_aceitar($1,30)',[late]);
  const reserve=await db.query('select qf_plantao_pix_reservar($1,$2,true) as r',[client,late]);
  await as(client);
  const tooLate=new Date(Date.parse(reserve.rows[0].r.prazo_pix)+1000);
  assert.equal((await db.query('select qf_plantao_pix_confirmar($1,$2,$3,$4,2000,$5) as estado',
   [client,late,late.replaceAll('-',''),'E'+'B'.repeat(31),tooLate])).rows[0].estado,'reembolso_pendente');
  assert.equal((await list()).find(row=>row.id===late).telefone,null);
 } finally {await db.close();}
});
