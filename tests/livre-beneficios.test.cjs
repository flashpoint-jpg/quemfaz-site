const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
const uid=n=>'00000000-0000-4000-a000-'+String(n).padStart(12,'0');
const migration=fs.readFileSync('supabase/migrations/20261029021315_livre_teste_cortesia.sql','utf8');
async function setup(){const d=new PGlite();await d.exec(`create role anon;create role authenticated;create schema auth;create schema private;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create table public.qf_profiles(id uuid primary key,tipo text,nome text,email text,telefone text,criado_em timestamptz default now());
create table public.qf_profissionais(user_id uuid primary key,documento text);
create table public.qf_pre_cadastro_pagamentos(id uuid primary key,email text,nome text,telefone text,profissional_id uuid,status text,criado_em timestamptz default now());
create table public.qf_recargas(id uuid primary key,status text);
create table public.qf_livre_assinaturas(id uuid primary key,profissional_id uuid,recarga_id uuid,inicio_em timestamptz,fim_em timestamptz);
create function private.qf_is_admin() returns boolean language sql as $$select auth.uid()='${uid(99)}'::uuid$$;
create function private.qf_livre_acesso_ok(uuid) returns boolean language sql as $$select exists(select 1 from public.qf_livre_assinaturas a join public.qf_recargas r on r.id=a.recarga_id where a.profissional_id=$1 and a.inicio_em<=now() and a.fim_em>clock_timestamp() and r.status='aprovado')$$;
create function private.qf_cadastro_profissional_pago(uuid) returns boolean language sql as $$select false$$;
create function public.qf_livre_status() returns jsonb language sql as $$select jsonb_build_object('ok',auth.uid() is not null,'ativo',exists(select 1 from public.qf_livre_assinaturas a join public.qf_recargas r on r.id=a.recarga_id where a.profissional_id=auth.uid() and a.inicio_em<=now() and a.fim_em>clock_timestamp() and r.status='aprovado'),'valor_centavos',3990,'recarga_id',null)$$;
grant usage on schema private,auth to authenticated;grant execute on function auth.uid() to authenticated;
`);await d.exec(migration);await d.exec(fs.readFileSync('supabase/migrations/20261029024128_livre_ficha_profissional.sql','utf8'));for(let n of [1,2,3,4,5,6,99])await d.query('insert into auth.users values($1,$2,now())',[uid(n),`p${n}@example.com`]);return d;}
async function as(d,n,admin=false){await d.exec('reset role');await d.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);await d.exec(admin?'reset role':'set role authenticated');}
async function rpc(d,name,args=[]){return (await d.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args)).rows[0].r;}
test('Teste de 48 horas: identidade única, contagem após identificação, expiração e acesso anterior preservado',async()=>{const d=await setup();try{
 await as(d,1);assert.equal((await rpc(d,'qf_livre_preparar_acesso',[true,'52998224725','11987654321'])).ok,true);
 assert.equal((await rpc(d,'qf_livre_status')).ativo,false,'não inicia sem identificação completa');
 await as(d,1,true);await d.query('insert into qf_profissionais values($1,$2)',[uid(1),'52998224725']);
 let b=(await d.query('select * from private.qf_livre_beneficios')).rows[0];assert.equal(Date.parse(b.fim_em)-Date.parse(b.inicio_em),48*3600000);
 await as(d,1);let s=await rpc(d,'qf_livre_status');assert.equal(s.ativo,true);assert.equal(s.tipo_acesso,'teste');
 await assert.rejects(()=>rpc(d,'qf_admin_livre_beneficio',['p1@example.com','ativar',30,'não autorizado']),/administrativo/);
 await as(d,2);await assert.rejects(()=>rpc(d,'qf_livre_preparar_acesso',[true,'52998224725','11912345678']),/Identificação já cadastrada/);
 await as(d,1,true);await d.exec("update private.qf_livre_beneficios set inicio_em=now()-interval '3 days',fim_em=now()-interval '1 day'");
 await as(d,1);s=await rpc(d,'qf_livre_status');assert.equal(s.ativo,false);assert.equal(s.teste_vencido,true);await assert.rejects(()=>rpc(d,'qf_livre_preparar_acesso',[true,'52998224725','11987654321']),/já utilizado/);
 await as(d,99,true);assert.equal((await d.query('select count(*) n from qf_profissionais')).rows[0].n,1,'cadastro mantido');assert.equal((await d.query('select count(*) n from qf_recargas')).rows[0].n,0,'nenhuma cobrança fictícia');
}finally{await d.close();}});
test('Cortesia 2, 3, 4, 10 dias, prorrogar, encerrar, auditoria, convite e assinatura paga',async()=>{const d=await setup();try{
 await as(d,99,true);for(const [n,days] of [[1,2],[2,3],[3,4],[4,10]]){await d.query('insert into qf_profissionais values($1,$2)',[uid(n),'doc'+n]);await d.query('insert into qf_pre_cadastro_pagamentos(id,email,nome) values($1,$2,$3)',[uid(n),`p${n}@example.com`,'Pro '+n]);const r=await rpc(d,'qf_admin_livre_beneficio',[`p${n}@example.com`,'ativar',days,'Teste da cortesia']);assert.equal(Date.parse(r.beneficio.fim_em)-Date.parse(r.beneficio.inicio_em),days*86400000);}
 let r=await rpc(d,'qf_admin_livre_beneficio',['p1@example.com','prorrogar',7,'Prorrogação de teste']);assert.equal(Date.parse(r.beneficio.fim_em)-Date.parse(r.beneficio.inicio_em),9*86400000);
 await rpc(d,'qf_admin_livre_beneficio',['p1@example.com','encerrar',1,'Encerramento autorizado']);await as(d,1);assert.equal((await rpc(d,'qf_livre_status')).ativo,false);
 await as(d,99,true);await d.query('insert into qf_pre_cadastro_pagamentos(id,email,nome) values($1,$2,$3)',[uid(5),'p5@example.com','Convite']);r=await rpc(d,'qf_admin_livre_beneficio',['p5@example.com','ativar',4,'Convite para profissional']);assert.equal(r.beneficio.inicio_em,null);
 await as(d,5);await rpc(d,'qf_livre_preparar_acesso',[false,'','']);await as(d,99,true);await d.query('insert into qf_profissionais values($1,$2)',[uid(5),'12345678901']);r=(await d.query("select * from private.qf_livre_beneficios where email='p5@example.com'")).rows[0];assert.ok(r.inicio_em);
 await d.query("insert into qf_recargas values($1,'aprovado')",[uid(6)]);await d.query("insert into qf_livre_assinaturas values($1,$1,$1,now(),now()+interval '30 days')",[uid(6)]);
 await assert.rejects(()=>rpc(d,'qf_admin_livre_beneficio',['p6@example.com','ativar',4,'Teste proteção pago']),/Assinatura paga ativa/);
 await assert.rejects(()=>rpc(d,'qf_admin_livre_beneficio',['p1@example.com','ativar',366,'Prazo inválido']),/prazo inválido/);
 assert.ok(Number((await d.query('select count(*) n from private.qf_livre_beneficio_historico')).rows[0].n)>=8);
 await as(d,6);assert.equal((await rpc(d,'qf_livre_status')).tipo_acesso,'pago');
 await as(d,99);const panel=await rpc(d,'qf_admin_livre_painel',['','todos',0]);assert.equal(panel.total,5);assert.equal(panel.kpis.planos_pagos,1);assert.equal(panel.kpis.cortesias,4);await as(d,99,true);await d.query('insert into qf_profiles(id,tipo,nome,email,telefone) values($1,$2,$3,$4,$5)',[uid(5),'profissional','Convite','p5@example.com','11999999999']);await as(d,99);const linked=await rpc(d,'qf_admin_livre_painel',['p5@example.com','todos',0]);assert.equal(linked.itens[0].profissional_id,uid(5),'pré-cadastro reconhece perfil sem falso pagamento');assert.ok(panel.itens.some(r=>r.historico.length));
}finally{await d.close();}});
