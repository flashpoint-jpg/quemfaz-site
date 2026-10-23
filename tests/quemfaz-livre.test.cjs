const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('Livre: pagamento, ativação, RLS, vigência, limite, comissão e carteira',async()=>{
 const db=new PGlite();const q=async(s,a=[])=> (await db.query(s,a)).rows;
 const user=async n=>q("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);
 const rpc=async(n,a=[])=> (await q('select '+n+'('+a.map((_,i)=>'$'+(i+1)).join(',')+') r',a))[0].r;
 try{
 await db.exec(fs.readFileSync('tests/fixtures/valor-definido-schema.sql','utf8'));
 await db.exec("alter table qf_chamados add column atendimento_tipo text default 'tradicional',add column modalidade text default 'padrao';alter table qf_profissionais add column horario_inicio time;alter table qf_profissionais add column horario_fim time;alter table qf_profissionais add column alerta_modo text;alter table qf_profissionais add column documento text;create table qf_admins(user_id uuid primary key);create schema extensions;");
 // PGlite não inclui pgcrypto: substitutos isolados só para testar transições.
 // A concorrência em CI usa PostgreSQL/pgcrypto reais.
 await db.exec("create function extensions.digest(text,text) returns bytea language sql as $$select decode(md5($1)||md5($1),'hex')$$;create function extensions.gen_random_bytes(integer) returns bytea language sql as $$select substring(decode(md5(random()::text),'hex') from 1 for $1)$$;");
 for(const f of ['20261022183000_comissao13_piloto.sql','20261022184500_comissao13_adesao_carteirinha.sql','20261022184616_comissao13_fluxo_validado.sql','20261022185059_comissao13_validacao_acordo.sql','20261022185945_comissao13_qr_notificacoes.sql','20261022190530_comissao13_financeiro_seguro.sql','20261022235500_comissao13_simplificada_conclusao.sql','20261022235600_comissao13_desbloqueio_simplificado.sql','20261022235700_comissao13_push_simplificado.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261022235500_comissao13_simplificada_conclusao.sql','utf8'));
 await q('update private.qf_comissao13_config set ativo=true');
 for(let n=1;n<=9;n++){await q("insert into qf_profiles(id,tipo,nome,foto_url) values($1,$2,'Fixture','selfie')",[id(n),n===9?'cliente':'profissional']);if(n<9){await q("insert into qf_profissionais(user_id,especialidades,raio_km,latitude,longitude) values($1,array['cat_eletricista'],22,0,0)",[id(n)]);await q('insert into qf_carteiras(profissional_id,saldo_centavos) values($1,10000)',[id(n)]);}}
 await db.exec(`create table qf_recargas(id uuid primary key default gen_random_uuid(),profissional_id uuid references qf_profissionais(user_id),valor_centavos integer,metodo text,status text default 'pendente',plano text,provedor text,provedor_id text,criado_em timestamptz default now(),aprovado_em timestamptz, constraint qf_recargas_plano_check check(plano in ('mensal','pro','premium')));
 alter table qf_planos_profissional add column recarga_id uuid,add column plano text,add column chamados_total integer;
 create table qf_planos_catalogo(plano text,preco_centavos integer,chamados integer,dias integer);
 create table qf_planos_catalogo_hist(plano text,preco_centavos integer,chamados integer,dias integer,substituido_em timestamptz);
 create function private.qf_log_pagamento(uuid,uuid,text,jsonb) returns void language sql as $$select$$;
 create function qf_bonus_recarga_centavos(integer) returns integer language sql as $$select 0$$;
 create trigger qf_recarga_pagamento_aplicado after update of status on qf_recargas for each row execute function public.qf_recarga_pagamento_aplicado();` .replace('create trigger qf_recarga_pagamento_aplicado after update of status on qf_recargas for each row execute function public.qf_recarga_pagamento_aplicado();',''));
 await db.exec(fs.readFileSync('docs/quemfaz-livre-implementacao.sql','utf8'));
 await db.exec(fs.readFileSync('docs/livre-beneficio-integracao.sql','utf8'));
 await db.exec('create trigger qf_recarga_pagamento_aplicado after update of status on qf_recargas for each row execute function public.qf_recarga_pagamento_aplicado()');
 await user(1);const pay=await rpc('qf_livre_solicitar_pix');assert.equal(pay.valor_centavos,3990);
 assert.equal((await rpc('qf_livre_solicitar_pix')).recarga_id,pay.recarga_id,'Pix pendente reutilizado');
 assert.equal((await rpc('qf_livre_status')).ativo,false,'não ativa por solicitar Pix');
 await assert.rejects(q("update qf_recargas set status='aprovado' where id=$1",[pay.recarga_id]),/confirmação válida/);
 await q('set role authenticated');
 await assert.rejects(q("select private.qf_livre_ativar_recarga($1)",[pay.recarga_id]),/permission denied/);
 await assert.rejects(q("insert into qf_livre_assinaturas(profissional_id,recarga_id,inicio_em,fim_em) values($1,$2,now(),now()+interval '30 days')",[id(1),pay.recarga_id]),/permission denied/);
 await q('reset role');
 // Confirmação do provedor simulada exclusivamente no banco descartável.
 await q("update qf_recargas set status='aprovado',provedor='efi',provedor_id='fixturePixConfirmed' where id=$1",[pay.recarga_id]);
 assert.equal((await rpc('qf_livre_status')).ativo,true);
 assert.equal(Number((await q("select extract(epoch from fim_em-inicio_em)/86400 days from qf_livre_assinaturas"))[0].days),30);
 assert.equal((await rpc('private.qf_livre_ativar_recarga',[pay.recarga_id])),'ja_ativada');
 assert.equal((await rpc('private.qf_aplicar_beneficio_recarga',[pay.recarga_id])),'ja_ativada');
 assert.equal((await q('select count(*) n from qf_movimentacoes_carteira'))[0].n,0,'assinatura não gera saldo');
 assert.equal((await q('select count(*) n from qf_planos_profissional'))[0].n,0,'não gera pacote antigo');
 await user(2);await q('set role authenticated');assert.equal((await q('select * from qf_livre_assinaturas')).length,0,'RLS protege assinatura de outro profissional');await q('reset role');
 assert.equal((await rpc('qf_livre_desbloquear',[id(100),true])).reason,'plano_inativo');
 const call=id(100);await q("insert into qf_chamados(id,cliente_id,categoria,max_orcamentos,latitude,longitude) values($1,$2,'cat_eletricista',4,0.09,0)",[call,id(9)]);
 await user(1);assert.equal((await rpc('qf_livre_desbloquear',[call,false])).reason,'aceite_obrigatorio');
 const unlocked=await rpc('qf_livre_desbloquear',[call,true]);assert.equal(unlocked.ok,true);assert.equal(unlocked.preco_centavos,0);
 assert.equal((await q('select saldo_centavos from qf_carteiras where profissional_id=$1',[id(1)]))[0].saldo_centavos,10000);
 assert.equal((await rpc('qf_livre_desbloquear',[call,true])).reason,'ja_participou');
 const conta=(await rpc('qf_comissao13_fechamentos_painel'))[0];assert.equal(conta.status,'pendente');assert.equal(conta.comissao_centavos,null);
 for(const [n,mode] of [[2,'qf_desbloquear_chamado'],[3,'qf_comissao13_desbloquear'],[4,'qf_desbloquear_chamado']]){await user(n);assert.equal((await rpc(mode,mode.includes('comissao13')?[call,true]:[call])).ok,true);}
 await user(5);const p5=await rpc('qf_livre_solicitar_pix');await q("update qf_recargas set status='aprovado',provedor='efi',provedor_id='otherFixture' where id=$1",[p5.recarga_id]);assert.equal((await rpc('qf_livre_desbloquear',[call,true])).reason,'reservado');
 for(const [n,overrides] of [[101,"categoria='cat_pintor'"],[102,"latitude=5"],[103,"status='cancelado'"],[104,"atendimento_tipo='garante'"],[105,"modalidade='valor_definido'"]]){
 await q("insert into qf_chamados(id,cliente_id,categoria,max_orcamentos,latitude,longitude) values($1,$2,'cat_eletricista',4,0.09,0)",[id(n),id(9)]);await q('update qf_chamados set '+overrides+' where id=$1',[id(n)]);assert.equal((await rpc('qf_livre_desbloquear',[id(n),true])).ok,false,'incompatível/cancelado/exclusivo recusado');}
 await user(1);await q("update qf_livre_assinaturas set inicio_em=now()-interval '31 days',fim_em=now()-interval '1 day' where profissional_id=$1",[id(1)]);assert.equal((await rpc('qf_livre_status')).ativo,false);assert.equal((await rpc('qf_livre_desbloquear',[id(102),true])).reason,'plano_inativo');
 assert.equal((await q('select count(*) n from qf_desbloqueios where profissional_id=$1',[id(1)]))[0].n,1,'contato anterior preservado');
 // Recarga comum ainda credita carteira exatamente uma vez.
 await q("insert into qf_recargas(id,profissional_id,valor_centavos,metodo) values($1,$2,5000,'pix')",[id(501),id(1)]);await q("update qf_recargas set status='aprovado' where id=$1",[id(501)]);assert.equal((await q('select saldo_centavos from qf_carteiras where profissional_id=$1',[id(1)]))[0].saldo_centavos,15000);
 // Nova regra: o endpoint antigo não libera mais contatos sem assinatura paga.
 await db.exec(fs.readFileSync('supabase/migrations/20261023104017_livre_pix_creditos_obrigatorios.sql','utf8'));
 await user(6);await q('update qf_carteiras set saldo_centavos=0 where profissional_id=$1',[id(6)]);
 await q("insert into qf_chamados(id,cliente_id,categoria,max_orcamentos,latitude,longitude) values($1,$2,'cat_eletricista',4,0.09,0)",[id(106),id(9)]);
 assert.equal((await rpc('qf_comissao13_desbloquear',[id(106),true])).reason,'plano_inativo');
 assert.equal((await rpc('qf_desbloquear_chamado',[id(106)])).reason,'saldo_insuficiente');
 assert.equal((await rpc('qf_comissao13_status')).desbloqueio_gratuito_ativo,false);
 const p6=await rpc('qf_livre_solicitar_pix');
 assert.equal((await rpc('qf_comissao13_desbloquear',[id(106),true])).reason,'plano_inativo','Pix pendente não libera');
 await q("update qf_recargas set status='aprovado',provedor='efi',provedor_id='fixtureSix' where id=$1",[p6.recarga_id]);
 assert.equal((await rpc('qf_comissao13_desbloquear',[id(106),true])).ok,true,'assinatura paga libera mesmo com saldo zero');
 await user(3);assert.ok((await rpc('qf_comissao13_fechamentos_painel')).length,'fechamentos antigos preservados');
 console.log('PASS Livre: Pix idempotente, ativação servidor, RLS, 30 dias, sem saldo, desbloqueio e contas, quatro vagas mistas, compatibilidade, vencimento e recarga tradicional.');
 }finally{await db.close();}
});
