const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { JSDOM } = require('jsdom');

test('Buscar novamente recupera os campos da última busca e permite editá-los',async()=>{
 const {window:w}=new JSDOM('<div class="qf-approved-picker-actions"></div>',{
  runScripts:'outside-only',url:'https://example.test/'
 });
 const item={id:'pedido',cliente:true,estado:'sem_profissional',categoria:'cat_encanador',
  bairro:'Centro',descricao:'Vazamento na cozinha',dados_busca:{cep:'09172060',endereco:'Rua Exemplo, 68'}};
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 let sent;
 try{
  w.QFCloud={client:{
   auth:{getSession:async()=>({data:{session:{user:{id:'cliente'}}}})},
   rpc:async()=>({data:[item]}),
   functions:{invoke:async(name,{body})=>{sent=body;return {data:{id:item.id}};}}
  }};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.eval(fs.readFileSync('qf-plantao-24h.js','utf8'));
  await new Promise(resolve=>w.document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  w.document.querySelector('[data-qf-plantao-client]').click();
  await settle();
  w.document.querySelector('[data-plantao-action="retry"]').click();
  await settle();
  const form=w.document.querySelector('[data-plantao-form]');
  assert.deepEqual(Object.fromEntries(new w.FormData(form)),{
   categoria:'cat_encanador',cep:'09172060',buscaUf:'',buscaCidade:'',buscaRua:'',
   endereco:'Rua Exemplo, 68',bairro:'Centro',descricao:'Vazamento na cozinha'
  });
  form.elements.endereco.value='Rua Exemplo, 70';
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await settle();
  assert.equal(sent.action,'criar');
  assert.equal(sent.endereco,'Rua Exemplo, 70');
 }finally{w.close();}
});

test('tela inicial do profissional permite abrir o Plantão 24h', async () => {
 const {window:w} = new JSDOM('<div id="app-shell" data-route="profissional-home"><main class="view"></main></div>', {
  runScripts:'outside-only', url:'https://example.test/#/profissional/home'
 });
 try {
  let disponivel=false;
  w.QFCloud={client:{
   auth:{getSession:async()=>({data:{session:{user:{id:'professional'}}}})},
   rpc:async (name,args)=>{
    if(name==='qf_plantao_listar')return {data:disponivel?[{
     id:'called',categoria:'cat_encanador',bairro:'Jardim do Estádio',cidade:'Santo André',
     estado:'buscando',distancia_km:18,descricao:'Vazamento'
    },{
     id:'canceled',categoria:'cat_encanador',bairro:'Centro',cidade:'Santo André',
     estado:'cancelado',cancelado_pelo_cliente:true
    }]:[]};
    if(args?.p_disponivel)disponivel=true;
    return {data:{inscrito_gratis:true,categorias_elegiveis:['cat_encanador'],disponivel}};
   }
  }};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.eval(fs.readFileSync('qf-plantao-24h.js','utf8'));
  await new Promise(resolve=>w.document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  const entry=w.document.querySelector('[data-qf-plantao-pro]');
  assert.equal(entry.textContent,'Plantão 24h');
  entry.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(w.document.querySelector('[data-plantao-action="on"]').textContent,'Estou de plantão');
  w.document.querySelector('[data-plantao-action="on"]').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(w.document.querySelector('.qf-plantao-card').textContent,/18 km aprox. em linha reta/);
  assert.match(w.document.querySelector('[data-plantao-offer]').textContent,/Aceitar chamado/);
  const history=[...w.document.querySelectorAll('.qf-plantao-card')].find(card=>card.textContent.includes('Chamado não atendido'));
  assert.match(history.textContent,/Cancelado pelo cliente/);
  assert.equal(history.querySelector('button'),null);
 } finally {w.close();}
});

test('chamado 24h só libera contato para os participantes após validar o Pix de R$ 20', async () => {
 const db = new PGlite();
 const id = n => '10000000-0000-4000-8000-00000000000'+n;
 const [client,pro,other,signup] = [id(1),id(2),id(3),id(5)];
 try {
  await db.exec(`
   create role anon; create role authenticated; create role service_role;
   create schema auth; create schema private;
   create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('qf.user',true),'')::uuid$$;
   create table qf_profiles(id uuid primary key,tipo text,nome text,telefone text,whatsapp text,cidade text,uf text,ativo boolean);
   create table qf_profissionais(user_id uuid primary key,especialidades text[]);
   create table qf_profissional_cidades(profissional_id uuid,cidade text,uf text);
   create table qf_recargas(id uuid primary key,profissional_id uuid,status text);
   create table qf_planos_profissional(recarga_id uuid,profissional_id uuid,plano text,valido_ate timestamptz,chamados_restantes int);
   create function private.qf_push_interno(text,uuid) returns void language plpgsql as $$begin null; end;$$;
   create function private.qf_is_admin() returns boolean language sql stable as $$select auth.uid()='10000000-0000-4000-8000-000000000006'::uuid$$;
   create function private.qf_cidade_centro(text,text) returns table(latitude numeric,longitude numeric)
   language sql stable as $$select case $1 when 'Santo André' then 19 when 'Fora da área' then 70 end::numeric, 0::numeric$$;
   create function public.qf_distancia_km(numeric,numeric,numeric,numeric) returns numeric
   language sql immutable strict as $$select abs($1-$3)$$;
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20261123214500_chamado_urgente_24h.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261123235000_plantao_disponibilidade_na_busca.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261124002008_plantao_gratuito.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261126014729_admin_plantao_profissionais.sql','utf8'));
  await db.exec(`
   alter table qf_profissionais add column latitude numeric, add column longitude numeric, add column raio_km integer;
   alter table qf_profissional_cidades add column latitude numeric, add column longitude numeric, add column raio_km integer;
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20261126022151_plantao_busca_por_raio.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261126022453_plantao_preservar_dados_busca.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261126022929_plantao_cancelado_no_painel.sql','utf8'));
  for(const [u,role,name,phone] of [[client,'cliente','Cliente','11910000000'],[pro,'profissional','Alex','11910000001'],[other,'profissional','Outra','11910000002']]){
   await db.query("insert into qf_profiles values($1,$2,$3,$4,$4,'Santo André','SP',true)",[u,role,name,phone]);
   if(role==='profissional')await db.query("insert into qf_profissionais values($1,array['cat_eletricista'])",[u]);
  }
  const as = u=>db.query("select set_config('qf.user',$1,false)",[u]);
  const list = async()=> (await db.query('select qf_plantao_listar() as items')).rows[0].items;
  await as(client);
  await assert.rejects(db.query('select qf_plantao_inscrever()'),/profissão atendida/);
  await as(other);
  await db.query("update qf_profissionais set especialidades=array['cat_pintor'] where user_id=$1",[other]);
  await assert.rejects(db.query('select qf_plantao_inscrever()'),/profissão atendida/);
  await db.query('insert into auth.users values($1,$2)',[signup,{qf_plantao_gratis:true}]);
  await db.query("insert into qf_profiles values($1,'profissional','Novo profissional','','','Santo André','SP',true)",[signup]);
  await db.query("insert into qf_profissionais values($1,array['cat_chaveiro'])",[signup]);
  await as(signup);
  const shift = async () => (await db.query('select qf_plantao_disponibilidade() as status')).rows[0].status;
  assert.deepEqual(await shift(),{plano_ativo:false,inscrito_gratis:true,disponivel:false,categorias_elegiveis:['cat_chaveiro'],desbloqueios_restantes:0});
  await db.query('select qf_plantao_disponibilidade(true)');
  await as(pro);
  await assert.rejects(db.query('select qf_plantao_disponibilidade(true)'),/Inscreva-se no Plantão/);
  const create = desc=>db.query("select qf_plantao_criar($1,'cat_eletricista',$2,'09010000','Santo André','SP','Centro','Rua Exemplo, 120') as id",[client,desc]);
  const empty = (await create('Sem energia apenas na residência.')).rows[0].id;
  await as(client);
  assert.equal((await list()).find(row=>row.id===empty).estado,'sem_profissional');
  assert.deepEqual((await list()).find(row=>row.id===empty).dados_busca,{cep:'09010000',endereco:'Rua Exemplo, 120'});
  await assert.rejects(db.query('select qf_plantao_pix_reservar($1,$2,true)',[client,empty]),/Prazo da oferta/);
  await as(pro);
  await db.exec('set role anon');
  await assert.rejects(db.query('select qf_plantao_inscrever()'),/permission denied/);
  await db.exec('set role authenticated');
  await db.query('select qf_plantao_inscrever()');
  await db.query('select qf_plantao_inscrever()');
  await db.exec('reset role');
  assert.deepEqual(await shift(),{plano_ativo:false,inscrito_gratis:true,disponivel:false,categorias_elegiveis:['cat_eletricista'],desbloqueios_restantes:0});
  await db.query('select qf_plantao_disponibilidade(true)');
  await db.query("update qf_profiles set cidade='Guarulhos' where id=$1",[pro]);
  await db.query("insert into qf_profissional_cidades values($1,'Guarulhos','SP',1,0,41)",[pro]);
  assert.equal((await db.query("select private.qf_plantao_elegivel($1,'cat_eletricista','Fora da área','SP') as elegivel",[pro])).rows[0].elegivel,false);
  await assert.rejects(create('WhatsApp 11 9 1234-5678'),/Remova o telefone/);
  const canceled=(await create('Tomada com problema elétrico.')).rows[0].id;
  await db.query('select qf_plantao_disponibilidade(false)');
  await assert.rejects(db.query('select qf_plantao_recusar($1)',[canceled]),/indisponível para cancelamento/);
  await as(client);
  await db.query('select qf_plantao_recusar($1)',[canceled]);
  await as(other);
  assert.equal((await list()).some(row=>row.id===canceled),false);
  await as(pro);
  const canceledCard=(await list()).find(row=>row.id===canceled);
  assert.equal(canceledCard.estado,'cancelado');
  assert.equal(canceledCard.cancelado_pelo_cliente,true);
  assert.equal(canceledCard.endereco,null);
  assert.equal(canceledCard.telefone,null);
  await assert.rejects(db.query('select qf_plantao_aceitar($1,30)',[canceled]),/indisponível/);
  await db.query('select qf_plantao_disponibilidade(true)');
  const call=(await create('Sem energia apenas na residência.')).rows[0].id;
  assert.deepEqual((await db.query("select qf_plantao_push_destinatarios($1) as ids",[call])).rows[0].ids,[pro]);
  await as(client);
  assert.equal((await list()).find(row=>row.id===call).profissionais_disponiveis,1);
  assert.equal((await list()).find(row=>row.id===call).distancia_km,null);
  await as(other);
  assert.deepEqual(await list(),[]);
  await assert.rejects(db.query('select qf_plantao_aceitar($1,30)',[call]),/indisponível/);
  await as(pro);
  assert.equal((await list())[0].profissionais_disponiveis,null);
  assert.equal((await list())[0].telefone,null);
  assert.equal((await list())[0].endereco,null);
  assert.equal((await list())[0].distancia_km,18);
  assert.equal((await list())[0].dados_busca,null);
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
  assert.equal((await db.query('select count(*)::int as total from qf_planos_profissional')).rows[0].total,0);
  assert.equal((await db.query('select count(*)::int as total from qf_recargas')).rows[0].total,0);
  await as(other);
  await db.query("update qf_profissionais set especialidades=array['cat_eletricista'] where user_id=$1",[other]);
  await db.query("insert into qf_recargas values($1,$2,'aprovado')",[id(4),other]);
  await db.query("insert into qf_planos_profissional values($1,$2,'livre_24h',now()+interval '30 days',20)",[id(4),other]);
  assert.equal((await shift()).desbloqueios_restantes,20);
  assert.equal((await shift()).plano_ativo,true);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select qf_admin_plantao_profissionais()'),{code:'42501'});
  await as(id(6));
  const roster=(await db.query('select qf_admin_plantao_profissionais() as roster')).rows[0].roster;
  assert.equal(roster.length,3);
  assert.deepEqual(roster.find(row=>row.id===other),{
   id:other,nome:'Outra',cidade:'Santo André',uf:'SP',categorias:['cat_eletricista'],
   ativo:true,inscrito_gratis:false,plano_ativo:true,disponivel:false
  });
  assert.equal(roster.find(row=>row.id===pro).disponivel,true);
  await db.exec('reset role');
  await as(pro);
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
