const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const ui=require('../qf-admin-organizacao.js');
const id='00000000-0000-4000-8000-000000000001';
async function setup(){
 const d=new PGlite();
 await d.exec(`create role anon;create role authenticated;create schema auth;create schema private;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function private.qf_is_admin() returns boolean language sql as $$select auth.uid()='${id}'::uuid$$;
 create table qf_desbloqueios(id uuid primary key);
 create table qf_profiles(id uuid,email text,tipo text);
 create table qf_pre_cadastro_pagamentos(id uuid,email text,status text,provedor text,provedor_id text,valor_centavos bigint,recarga_id uuid,aprovado_em timestamptz,criado_em timestamptz);
 create table qf_recargas(id uuid,profissional_id uuid,plano text,status text,provedor text,provedor_id text,valor_centavos bigint,aprovado_em timestamptz,atualizado_em timestamptz,criado_em timestamptz);
 create table qf_prioridade_pagamentos(id uuid,chamado_id uuid,status text,provedor text,provedor_id text,valor_centavos bigint,aprovado_em timestamptz,criado_em timestamptz);
 create table qf_anuncio_pagamentos(id uuid,status text,provedor text,provedor_id text,valor_centavos bigint,aprovado_em timestamptz,criado_em timestamptz);
 create table qf_comissao13_fechamentos(id uuid,desbloqueio_id uuid,status text,contratado_em timestamptz,cliente_resposta text,cobranca_status text,valor_informado_centavos bigint,comissao_centavos bigint,observacao_admin text);
 create table qf_comissao13_pix(id uuid,pago_em timestamptz,end_to_end_id text,valor_centavos bigint);
 create table private.qf_livre_manual_pix(id uuid,chamado_id uuid,status text,confirmado_em timestamptz,end_to_end_id text,valor_centavos bigint,profissional_centavos bigint,repassado_em timestamptz);
 create table private.qf_livre_split_pagamentos(like private.qf_livre_manual_pix);
 create table qf_comissao13_financeiro(id uuid,provedor_id text,pago_em timestamptz,valor_centavos bigint,profissional_centavos bigint,repasse_status text,repassado_em timestamptz,taxa_real_centavos bigint,estornado_centavos bigint);
 create table private.qf_comissao13_fin_eventos(financeiro_id uuid,tipo text,criado_em timestamptz);
 grant usage on schema auth,private to authenticated,anon;
 insert into qf_desbloqueios values('${id}');
 insert into qf_profiles values('${id}','teste@local.test','profissional');
 insert into qf_comissao13_fechamentos(id,desbloqueio_id,status,valor_informado_centavos) values('${id}','${id}','pendente',10000);`);
 await d.exec(fs.readFileSync('supabase/admin-organizacao-balanco.sql','utf8'));
 return d;
}
async function rpc(d,name,args=[]){return (await d.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).rows[0].r;}
async function as(d,admin){await d.exec('reset role');await d.query("select set_config('request.jwt.claim.sub',$1,false)",[admin?id:'00000000-0000-4000-8000-000000000002']);await d.exec('set role authenticated');}
test('admin: edição, exclusão reversível, auditoria e bloqueio de orçamento aceito',async()=>{
 const d=await setup();try{
  await as(d,false);await assert.rejects(()=>rpc(d,'qf_admin_lista_controle',['negociacao']),/administrativo/);
  await as(d,true);
  assert.equal((await rpc(d,'qf_admin_lista_controle',['negociacao',id,{observacao:'Conferido',valor_centavos:15000}])).ok,true);
  await rpc(d,'qf_admin_lista_controle',['negociacao',id,{excluido:true}]);
  let list=await rpc(d,'qf_admin_lista_controle',['negociacao']);assert.equal(list[0].excluido,true);assert.equal(list[0].observacao,'Conferido');
  await rpc(d,'qf_admin_lista_controle',['negociacao',id,{excluido:false}]);
  assert.equal((await rpc(d,'qf_admin_lista_controle',['negociacao']))[0].excluido,false);
  await d.exec("reset role;update qf_comissao13_fechamentos set cliente_resposta='confirmado'");await as(d,true);
  await assert.rejects(()=>rpc(d,'qf_admin_lista_controle',['negociacao',id,{valor_centavos:20000}]),/aceito/);
  await d.exec('reset role');assert.equal((await d.query('select count(*) n from private.qf_admin_lista_auditoria')).rows[0].n,3);
  assert.equal(Number((await d.query('select valor_informado_centavos v from qf_comissao13_fechamentos')).rows[0].v),15000);
  assert.equal((await d.query('select count(*) n from qf_desbloqueios')).rows[0].n,1);
 }finally{await d.close();}
});
test('balanço: pagamentos aprovados, pré-cadastro sem duplicidade e repasse em sua própria data',async()=>{
 const d=await setup();try{
  await d.exec(`insert into qf_recargas(id,profissional_id,plano,status,provedor,provedor_id,valor_centavos,aprovado_em) values
   ('${id}','${id}','livre','aprovado','efi','tx1',3990,now()),
   (gen_random_uuid(),'${id}',null,'aprovado','efi','tx2',1000,now()),
   (gen_random_uuid(),'${id}',null,'pendente','efi','tx3',9000,now());
   insert into qf_pre_cadastro_pagamentos(id,status,provedor,provedor_id,valor_centavos,aprovado_em) values(gen_random_uuid(),'aprovado','efi','tx1',3990,now());
   insert into private.qf_livre_manual_pix values('${id}','${id}','repassado',now()-interval '4 days','Eteste',10000,8700,now());
   insert into private.qf_livre_split_pagamentos select * from private.qf_livre_manual_pix;`);
  await as(d,false);await assert.rejects(()=>rpc(d,'qf_admin_balanco',[1]),/administrativo/);
  await as(d,true);const day=await rpc(d,'qf_admin_balanco',[1]);
  assert.equal(Number(day.entradas_centavos),4990);assert.equal(Number(day.saidas_centavos),8700);assert.equal(Number(day.saldo_periodo_centavos),-3710);assert.equal(Number(day.planos_centavos),3990);
  const week=await rpc(d,'qf_admin_balanco',[7]);assert.equal(Number(week.entradas_centavos),14990);assert.equal(Number(week.saidas_centavos),8700);
  assert.ok(day.eventos.every(x=>x.rota.startsWith('/admin/')));
 }finally{await d.close();}
});
test('balanço renderiza valores negativos e escapa conteúdo',()=>{
 const h=ui.balanceHtml({gerado_em:new Date().toISOString(),saldo_periodo_centavos:-100,eventos:[{em:new Date().toISOString(),tipo:'<script>',entrada:0,saida:100,rota:'/admin/financeiro'}]});
 assert.ok(h.includes('-R$'));assert.ok(h.includes('&lt;script&gt;'));assert.ok(!h.includes('<script>'));
});

