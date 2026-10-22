const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('piloto simplificado: gratuito, pago, quatro vagas, contas e comissão administrativa',async()=>{
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
 const call=id(100);await q("insert into qf_chamados(id,cliente_id,categoria,max_orcamentos,latitude,longitude) values($1,$2,'cat_eletricista',4,0.09,0)",[call,id(9)]);
 await user(9);const code=await rpc('qf13_codigo_cliente',[call]);assert.match(code.codigo,/^\d{6}$/);
 await user(1);const free=await rpc('qf_comissao13_desbloquear',[call,true]);assert.equal(free.ok,true);
 assert.equal((await q('select saldo_centavos from qf_carteiras where profissional_id=$1',[id(1)]))[0].saldo_centavos,10000);
 let conta=(await rpc('qf_comissao13_fechamentos_painel'))[0];assert.equal(conta.status,'pendente');assert.equal(conta.comissao_centavos,null);
 assert.ok((await q('select * from qf_desbloqueios where chamado_id=$1 and profissional_id=$2 and ativo',[call,id(1)])).length,'registro usado pela autorização de contato');
 for(const [n,mode] of [[2,'qf_desbloquear_chamado'],[3,'qf_comissao13_desbloquear'],[4,'qf_desbloquear_chamado']]){await user(n);const r=await rpc(mode,mode.includes('comissao13')?[call,true]:[call]);assert.equal(r.ok,true);}
 assert.equal((await q('select saldo_centavos from qf_carteiras where profissional_id=$1',[id(2)]))[0].saldo_centavos,9210);
 await user(5);assert.equal((await rpc('qf_comissao13_desbloquear',[call,true])).ok,false);assert.equal((await rpc('qf_desbloquear_chamado',[call])).ok,false);
 assert.equal(Number((await q('select count(*) n from qf_desbloqueios where chamado_id=$1',[call]))[0].n),4);
 await user(1);assert.equal((await rpc('qf_comissao13_prestar_contas',[conta.id,'informado',50000,'000000'])).ok,false);
 assert.equal((await rpc('qf_comissao13_prestar_contas',[conta.id,'informado',50000,code.codigo])).ok,true);
 assert.equal((await rpc('qf_comissao13_fechamentos_painel'))[0].comissao_centavos,null,'declaração não é dívida');
 await assert.rejects(rpc('qf_comissao13_admin',[conta.id,'confirmar',50000,'Cliente confirmou por WhatsApp']),/admin/);
 await q("select set_config('test.admin','true',false)");await user(9);
 assert.equal((await rpc('qf_comissao13_admin',[conta.id,'confirmar',50000,'Cliente confirmou por WhatsApp'])).ok,true);
 conta=(await rpc('qf_comissao13_fechamentos_painel')).find(a=>a.id===conta.id);assert.equal(conta.comissao_centavos,6500);assert.equal(conta.cobranca_status,'pendente');
 assert.equal((await rpc('qf_comissao13_admin',[conta.id,'confirmar',90000,'Duplicado'])).comissao_centavos,6500);
 await q("update qf_comissao13_fechamentos set comissao_vence_em=now()-interval '1 minute' where id=$1",[conta.id]);await user(1);
 assert.equal((await rpc('qf_comissao13_status')).bloqueio,'comissao_vencida');await user(9);await rpc('qf_comissao13_admin',[conta.id,'pago',null,'Comprovante verificado pela equipe']);await user(1);assert.equal((await rpc('qf_comissao13_status')).bloqueio,null);
 await q("select set_config('test.admin','false',false)");await user(3);const pending=(await rpc('qf_comissao13_fechamentos_painel'))[0];await q("update qf_comissao13_fechamentos set prazo_contas=now()-interval '1 minute' where id=$1",[pending.id]);assert.equal((await rpc('qf_comissao13_status')).bloqueio,'prestacao_contas_vencida');await rpc('qf_comissao13_prestar_contas',[pending.id,'negociando',null,null]);assert.equal((await rpc('qf_comissao13_status')).bloqueio,null);
 console.log('PASS: gratuito/pago, limite misto 4, contas 48h, código, admin 13%, dívida só confirmada, baixa e desbloqueio');
 }finally{await db.close();}
});
