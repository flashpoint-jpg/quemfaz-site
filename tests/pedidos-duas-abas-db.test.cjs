const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('Postgres: seleção real, profissão, limite, desbloqueio Avulso/Livre fora do raio e silêncio',async()=>{
 const db=new PGlite();const q=async(s,a=[])=> (await db.query(s,a)).rows;
 const as=async n=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await db.exec(n?'set role authenticated':'set role anon');};
 const rpc=async(n,args=[])=> (await q('select '+n+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args))[0].r;
 try{
 await db.exec(fs.readFileSync('tests/fixtures/valor-definido-schema.sql','utf8'));
 await db.exec(`grant select on private.test_dispatch to authenticated;
 alter table qf_chamados add column data_preferida timestamptz,add column prazo_dia date,add column atendimento_tipo text default 'tradicional',add column modalidade text default 'padrao';
 alter table qf_profissionais add column documento text,add column verificado boolean default false;
 alter table qf_desbloqueios drop constraint qf_desbloqueios_origem_check;
 create table qf_comissao13_adesoes(profissional_id uuid primary key,versao_termos text,aceito_em timestamptz,revogado_em timestamptz);
 create table private.test_assinaturas(profissional_id uuid primary key,fim_em timestamptz);
 create function private.qf_livre_acesso_ok(uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from private.test_assinaturas where profissional_id=$1 and fim_em>now())$$;
 create function private.qf13_bloqueio(uuid) returns text language sql as $$select null::text$$;
 create function private.qf_cortesia_reativacao_20261022(uuid) returns boolean language sql as $$select false$$;
 create function public.qf_ocultar_contato(text) returns text language sql as $$select $1$$;
 create function public.qf_tempo_estimado_min(numeric) returns integer language sql as $$select 10$$;
 create function private.qf_chamado_centro(uuid) returns table(latitude numeric,longitude numeric) language sql as $$select c.latitude,c.longitude from public.qf_chamados c where c.id=$1$$;
 drop function public.qf_listar_chamados_disponiveis();`);
 const expiry=fs.readFileSync('supabase/migrations/20261022125145_limpeza_pedidos_72h_sem_desbloqueio.sql','utf8');await db.exec(expiry.slice(0,expiry.indexOf('create or replace function private.qf_expirar_chamados')));
 await db.exec(fs.readFileSync('tests/fixtures/pedidos-duas-abas-production.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261024172302_professional_order_tabs.sql','utf8'));
 for(let n=1;n<=6;n++){await q("insert into qf_profiles(id,tipo,nome,foto_url) values($1,'profissional','Teste','foto')",[id(n)]);await q("insert into qf_profissionais(user_id,especialidades,latitude,longitude,raio_km) values($1,array['eletricista','montador'],-23.6,-46.5,20)",[id(n)]);await q('insert into qf_carteiras(profissional_id,saldo_centavos) values($1,10000)',[id(n)]);}
 const order=async(n,cat,lat=-24.6,extra='')=>q(`insert into qf_chamados(id,cliente_id,categoria,titulo,descricao,cidade,uf,bairro,latitude,longitude,max_orcamentos${extra?',criado_em':''}) values($1,$2,$3,'Pedido de teste','Serviço solicitado','Santo André','SP','Centro',$4,-46.5,4${extra?','+extra:''})`,[id(n),id(99),cat,lat]);
 await order(100,'eletricista',-23.61);await order(101,'eletricista');await order(102,'montador');await order(103,'pintor');await order(104,'eletricista',-24.6,"now()-interval '4 days'");await order(105,'eletricista');await q("update qf_chamados set status='cancelado' where id=$1",[id(105)]);
 await as(1);const near=await q('select id from qf_listar_chamados_disponiveis()'),far=await q('select * from qf_mais_oportunidades()');assert.deepEqual(near.map(r=>r.id),[id(100)]);assert.deepEqual(new Set(far.map(r=>r.id)),new Set([id(101),id(102)]));assert.ok(far.every(r=>r.fora_raio&&r.participantes===0&&r.limite===4));assert.equal((await q('select count(*)::integer n from private.test_dispatch'))[0].n,0,'consultar oportunidades não dispara push');
 await db.exec('reset role');await q("update qf_profissionais set especialidades=array['eletricista'] where user_id=$1",[id(1)]);await as(1);assert.deepEqual((await q('select id from qf_mais_oportunidades()')).map(r=>r.id),[id(101)]);
 const wrong=await rpc('public.qf_desbloquear_chamado',[id(103),false]);assert.equal(wrong.reason,'nao_elegivel');const paid=await rpc('public.qf_desbloquear_chamado',[id(101),false]);assert.equal(paid.ok,true);assert.equal(paid.origem,'saldo');assert.equal(paid.preco_centavos,790);assert.equal((await q('select saldo_centavos from qf_carteiras where profissional_id=$1',[id(1)]))[0].saldo_centavos,9210);
 assert.equal((await rpc('public.qf_desbloquear_chamado',[id(101),false])).already_unlocked,true);assert.equal((await q('select count(*)::integer n from qf_movimentacoes_carteira'))[0].n,1);
 await db.exec('reset role');await q("insert into private.test_assinaturas values($1,now()+interval '30 days')",[id(2)]);await as(2);const livre=await rpc('private.qf_livre_desbloquear',[id(101),true]);assert.equal(livre.ok,true);assert.equal(livre.preco_centavos,0);assert.equal((await q('select saldo_centavos from qf_carteiras where profissional_id=$1',[id(2)]))[0].saldo_centavos,10000);
 for(const n of [3,4]){await as(n);assert.equal((await rpc('public.qf_desbloquear_chamado',[id(101),false])).ok,true);}
 await as(5);assert.equal((await rpc('public.qf_desbloquear_chamado',[id(101),false])).reason,'reservado');assert.equal((await q('select count(*)::integer n from qf_mais_oportunidades() where id=$1',[id(101)]))[0].n,0);
 assert.equal((await q('select raio_km from qf_profissionais where user_id=$1',[id(1)]))[0].raio_km,20);assert.equal((await q('select count(*)::integer n from private.test_dispatch where evento=\'new_call\''))[0].n,0);
 await as(null);await assert.rejects(q('select * from qf_mais_oportunidades()'),/permission denied/);
 }finally{await db.close();}
});
