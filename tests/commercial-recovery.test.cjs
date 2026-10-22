const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const schema=`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema private; create schema cron;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function private.qf_is_admin() returns boolean language sql stable as $$ select current_setting('test.admin',true)='true' $$;
create table public.qf_chamados(id uuid primary key,cliente_id uuid,categoria text,status text,max_orcamentos integer,criado_em timestamptz default now(),atualizado_em timestamptz default now(),data_preferida timestamptz,cidade text,uf text,latitude numeric,longitude numeric);
create table public.qf_profissionais(user_id uuid primary key,especialidades text[],online boolean,horario_inicio time,horario_fim time,latitude numeric,longitude numeric,raio_km integer);
create table public.qf_profiles(id uuid primary key,foto_url text,ativo boolean);
create table public.qf_carteiras(profissional_id uuid primary key,saldo_centavos bigint,bonus_inicial_centavos bigint,bonus_inicial_usado boolean,atualizado_em timestamptz);
create table public.qf_desbloqueios(id uuid default gen_random_uuid(),chamado_id uuid,profissional_id uuid,valor_centavos integer,origem text,ativo boolean,plano_id uuid,exclusivo boolean,unique(chamado_id,profissional_id));
create table public.qf_orcamentos(chamado_id uuid,status text);
create table public.qf_precos_desbloqueio(categoria text primary key,preco_centavos integer,ativo boolean);
create table public.qf_planos_catalogo(plano text primary key,preco_centavos integer,chamados integer,dias integer);
create table public.qf_planos_catalogo_hist(plano text,preco_centavos integer,chamados integer,dias integer,substituido_em timestamptz);
create table public.qf_planos_profissional(id uuid default gen_random_uuid(),profissional_id uuid,plano text,chamados_total integer,chamados_restantes integer,valido_ate timestamptz,recarga_id uuid,atualizado_em timestamptz);
create table public.qf_movimentacoes_carteira(profissional_id uuid,tipo text,valor_centavos bigint,referencia_tipo text,referencia_id uuid,descricao text);
create table public.qf_recargas(id uuid primary key,profissional_id uuid,valor_centavos integer,plano text,status text,metodo text,criado_em timestamptz default now());
create table public.qf_push_subscriptions(user_id uuid,ativo boolean);
create table public.qf_chamado_cascata(chamado_id uuid,etapa integer,rodada integer);
create table public.qf_push_entregas(chamado_id uuid,user_id uuid,evento text,raio_etapa_km integer,cascata_etapa integer,rodada integer,envio_status text,tentativas integer,tentativa_em timestamptz,envio_erro text,com_push boolean,unique(chamado_id,user_id,evento,rodada));
create table private.test_dispatch(evento text,chamado uuid);
create function private.qf_push_interno(e text,c uuid) returns void language sql as $$ insert into private.test_dispatch values(e,c) $$;
create function private.qf_pendencia_finalizacao(uuid,text) returns uuid language sql as $$ select null::uuid $$;
create function private.qf_expirar_bonus_profissional(uuid) returns void language sql as $$ select $$;
create function public.qf_bonus_recarga_centavos(integer) returns integer language sql as $$ select 0 $$;
create function public.qf_exclusivo_info() returns jsonb language sql as $$ select '{"ativo":false}'::jsonb $$;
create function public.qf_distancia_km(a numeric,b numeric,c numeric,d numeric) returns numeric language sql immutable as $$ select (6371*2*asin(sqrt(power(sin(radians((c-a)/2)),2)+cos(radians(a))*cos(radians(c))*power(sin(radians((d-b)/2)),2))))::numeric $$;
create function public.qf_cascata_destinatarios(c uuid) returns table(user_id uuid,online boolean) language sql as $$ select p.user_id,p.online from public.qf_profissionais p join public.qf_chamados x on x.id=c and x.categoria=any(p.especialidades) where private.qf_pro_atende_regiao(p.user_id,x.cidade,x.uf,x.latitude,x.longitude) $$;
create function public.qf_chamado_destinatarios_alcance(c uuid,r integer) returns table(user_id uuid) language sql as $$ select p.user_id from public.qf_profissionais p join public.qf_chamados x on x.id=c and x.categoria=any(p.especialidades) where p.online and private.qf_dentro_horario(p.horario_inicio,p.horario_fim) and private.qf_pro_atende_regiao(p.user_id,x.cidade,x.uf,x.latitude,x.longitude) $$;
create function public.qf_listar_chamados_disponiveis() returns table(id uuid) language sql as $$ select c.id from public.qf_chamados c join public.qf_profissionais p on p.user_id=auth.uid() and c.categoria=any(p.especialidades) where private.qf_pro_atende_regiao(p.user_id,c.cidade,c.uf,c.latitude,c.longitude) $$;
create function cron.schedule(text,text,text) returns integer language sql as $$ select 1 $$;
`;
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const call=uid(100), cli=uid(99);
async function database(){
 const db=new PGlite();
 // SQL validation is deferred until dependencies have been loaded.
 await db.exec('set check_function_bodies=off;'+schema);
 await db.exec(fs.readFileSync('tests/fixtures/commercial-production-functions.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261017122934_commercial_recovery_metrics.sql','utf8'));
 await db.exec("create trigger apply_recarga after update on public.qf_recargas for each row execute function public.qf_recarga_pagamento_aplicado(); insert into public.qf_precos_desbloqueio values('padrao',800,true);");
 await db.query('insert into public.qf_chamados(id,cliente_id,categoria,status,max_orcamentos,latitude,longitude) values($1,$2,\'pintor\',\'aberto\',4,-23.55,-46.63)',[call,cli]);
 for(let n=1;n<=6;n++){
  await db.query("insert into public.qf_profissionais values($1,array['pintor'],true,'00:00','00:00',-23.55,-46.63,10);",[uid(n)]);
  await db.query("insert into public.qf_profiles values($1,'selfie',true)",[uid(n)]);
  await db.query('insert into public.qf_carteiras values($1,$2,0,true,now())',[uid(n),n===6?0:2000]);
 }
 return db;
}
async function asUser(db,n){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(n)]);}
async function scalar(db,sql,params=[]){return Object.values((await db.query(sql,params)).rows[0])[0];}
test('isolated Postgres: debit once, insufficient balance, four places, payment applied once',async()=>{
 const db=await database();try{
  await asUser(db,6);
  assert.equal((await scalar(db,'select public.qf_desbloquear_chamado($1)',[call])).reason,'saldo_insuficiente');
  assert.equal(await scalar(db,'select count(*) from public.qf_desbloqueios'),0);
  await asUser(db,1);
  assert.equal((await scalar(db,'select public.qf_desbloquear_chamado($1)',[call])).ok,true);
  assert.equal((await scalar(db,'select public.qf_desbloquear_chamado($1)',[call])).already_unlocked,true);
  assert.equal(await scalar(db,'select saldo_centavos from public.qf_carteiras where profissional_id=$1',[uid(1)]),1200);
  for(let n=2;n<=4;n++){await asUser(db,n);assert.equal((await scalar(db,'select public.qf_desbloquear_chamado($1)',[call])).ok,true);}
  await asUser(db,5);assert.equal((await scalar(db,'select public.qf_desbloquear_chamado($1)',[call])).reason,'reservado');
  assert.equal(await scalar(db,'select count(*) from public.qf_desbloqueios'),4);
  await db.query("insert into public.qf_recargas(id,profissional_id,valor_centavos,status,metodo) values($1,$2,1000,'pendente','pix')",[uid(200),uid(6)]);
  await db.query("update public.qf_recargas set status='aprovado' where id=$1",[uid(200)]);
  await db.query("update public.qf_recargas set status='aprovado' where id=$1",[uid(200)]);
  assert.equal(await scalar(db,'select saldo_centavos from public.qf_carteiras where profissional_id=$1',[uid(6)]),1000);
  assert.equal(await scalar(db,"select count(*) from public.qf_movimentacoes_carteira where referencia_tipo='recarga'"),1);
  assert.equal(await scalar(db,"select count(*) from public.qf_movimentacoes_carteira where tipo='bonus'"),0);
 }finally{await db.close();}
});
test('isolated Postgres: all checkpoints, no repeats, delayed schedule, auth and exact radius',async()=>{
 const db=await database();try{
  for(const [minutes,count] of [[11,1],[31,2],[121,3],[1441,4]]){
   await db.query("update public.qf_chamados set criado_em=now()-make_interval(mins=>$1)",[minutes]);
   assert.equal(await scalar(db,'select private.qf_recuperar_pedidos_sem_desbloqueio()'),1);
   assert.equal(await scalar(db,'select private.qf_recuperar_pedidos_sem_desbloqueio()'),0);
   assert.equal(await scalar(db,'select count(*) from private.qf_pedido_recuperacoes'),count);
  }
  assert.equal(await scalar(db,'select count(*) from private.test_dispatch'),4);
  await db.exec('delete from private.qf_pedido_recuperacoes; delete from private.test_dispatch;');
  await scalar(db,'select private.qf_recuperar_pedidos_sem_desbloqueio()');
  assert.equal(await scalar(db,'select count(*) from private.test_dispatch'),1,'overdue stages cause one dispatch only');
  await db.exec("update public.qf_chamados set status='concluido'; delete from private.qf_pedido_recuperacoes;");
  assert.equal(await scalar(db,'select private.qf_recuperar_pedidos_sem_desbloqueio()'),0);
  await db.exec("update public.qf_chamados set status='aberto',data_preferida=now()+interval '2 days';");
  assert.equal(await scalar(db,'select private.qf_recuperar_pedidos_sem_desbloqueio()'),0,'scheduled service waits until 24h window');
  await asUser(db,1);
  assert.equal((await scalar(db,'select public.qf_admin_funil_comercial()')).reason,'sem_permissao');
  await db.exec("select set_config('test.admin','true',false)");
  assert.equal((await scalar(db,'select public.qf_admin_funil_comercial()')).ok,true);
  assert.equal(await scalar(db,"select private.qf_pro_atende_regiao($1,'São Paulo','SP',-23.60,-46.63)",[uid(1)]),true);
  assert.equal(await scalar(db,"select private.qf_pro_atende_regiao($1,'São Paulo','SP',-23.80,-46.63)",[uid(1)]),false);
  await db.query('insert into public.qf_push_subscriptions values($1,true)',[uid(1)]);
  const args=[call,[uid(1),uid(1)]];
  assert.equal((await scalar(db,"select public.qf_push_reservar_entregas($1,$2,'new_call',200)",args)).length,1);
  assert.equal((await scalar(db,"select public.qf_push_reservar_entregas($1,$2,'new_call',200)",args)).length,0);
 }finally{await db.close();}
});
test('return after recharge is account-bound, expires, and rechecks availability without debit',async()=>{
 const data=new Map(),routes=[],calls=[];
 const localStorage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 const win={addEventListener(){},navigate:r=>routes.push(r),QFCloud:{enabled:true,syncForCurrentSession:async()=>calls.push('sync'),client:{rpc:async n=>{calls.push(n);return {data:[{id:call}]};}}}};
 vm.runInNewContext(fs.readFileSync('qf-recharge-return.js','utf8'),{window:win,localStorage,Date,JSON});
 win.QFRechargeReturn.remember(call,uid(1));
 assert.equal(win.QFRechargeReturn.pending(uid(2)),null);
 assert.equal((await win.QFRechargeReturn.resume(uid(1))).ok,true);
 assert.deepEqual(calls,['sync','qf_listar_chamados_disponiveis']);
 assert.equal(routes[0],'/profissional/chamada/'+call);
 win.QFCloud.client.rpc=async()=>({data:[]});
 assert.equal((await win.QFRechargeReturn.resume(uid(1))).reason,'indisponivel');
 data.set('qf_recharge_return_v1',JSON.stringify({callId:call,userId:uid(1),at:0}));
 assert.equal(win.QFRechargeReturn.pending(uid(1)),null);
});
test('Google conversion uses the verified account label and respects demo and consent',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const snippet=html.slice(html.indexOf('window.qfGoogleLead ='),html.indexOf('</script>',html.indexOf('window.qfGoogleLead =')));
 const hits=[],win={QFConversao:{consentimento:()=> 'granted'}},location={search:''};
 vm.runInNewContext(snippet,{window:win,location,gtag:(...x)=>hits.push(x)});
 win.qfGoogleLead(''); assert.equal(hits.length,0);
 win.qfGoogleLead(call); assert.equal(hits[0][2].send_to,'AW-18273159663/RIX-CKfD1cUcEO-TqYlE');
 assert.equal(hits[0][2].transaction_id,call);
 location.search='?demo=1';win.qfGoogleLead(call);assert.equal(hits.length,1);
 location.search='';win.QFConversao.consentimento=()=> 'denied';win.qfGoogleLead(call);assert.equal(hits.length,1);
});
