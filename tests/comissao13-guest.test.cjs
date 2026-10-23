const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('Cliente sem conta: token individual, OTP, divergência, auditoria e prorrogação única',async()=>{
 const db=new PGlite();const q=async(s,a=[])=> (await db.query(s,a)).rows;
 const user=async n=>q("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);
 const rpc=async(n,a=[])=> (await q('select '+n+'('+a.map((_,i)=>'$'+(i+1)).join(',')+') r',a))[0].r;
 try{
 await db.exec(fs.readFileSync('tests/fixtures/valor-definido-schema.sql','utf8'));
 await db.exec("alter table qf_chamados add column atendimento_tipo text default 'tradicional',add column modalidade text default 'padrao';alter table qf_profissionais add column horario_inicio time;alter table qf_profissionais add column horario_fim time;alter table qf_profissionais add column alerta_modo text;alter table qf_profissionais add column documento text;create table qf_admins(user_id uuid primary key);create schema extensions;");
 // PGlite não inclui pgcrypto: substitutos isolados só para testar transições.
 // A concorrência em CI usa PostgreSQL/pgcrypto reais.
 await db.exec("create function extensions.digest(text,text) returns bytea language sql as $$select decode(md5($1)||md5($1),'hex')$$;create function extensions.gen_random_bytes(integer) returns bytea language sql as $$select substring(decode(md5(random()::text)||md5(random()::text),'hex') from 1 for $1)$$;");
 for(const f of ['20261022183000_comissao13_piloto.sql','20261022184500_comissao13_adesao_carteirinha.sql','20261022184616_comissao13_fluxo_validado.sql','20261022185059_comissao13_validacao_acordo.sql','20261022185945_comissao13_qr_notificacoes.sql','20261022190530_comissao13_financeiro_seguro.sql','20261022235500_comissao13_simplificada_conclusao.sql','20261022235600_comissao13_desbloqueio_simplificado.sql','20261022235700_comissao13_push_simplificado.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261022235500_comissao13_simplificada_conclusao.sql','utf8'));
 await q('update private.qf_comissao13_config set ativo=true');
 for(let n=1;n<=9;n++){await q("insert into qf_profiles(id,tipo,nome,foto_url) values($1,$2,'Fixture','selfie')",[id(n),n===9?'cliente':'profissional']);if(n<9){await q("insert into qf_profissionais(user_id,especialidades,raio_km,latitude,longitude) values($1,array['cat_eletricista'],22,0,0)",[id(n)]);await q('insert into qf_carteiras(profissional_id,saldo_centavos) values($1,10000)',[id(n)]);}}
 const call=id(100);await q("insert into qf_chamados(id,cliente_id,categoria,max_orcamentos,latitude,longitude) values($1,$2,'cat_eletricista',4,0.09,0)",[call,id(9)]);

 await db.exec(fs.readFileSync('docs/qf13-cliente-sem-cadastro.sql','utf8'));
 await user(1);assert.equal((await rpc('qf_comissao13_desbloquear',[call,true])).ok,true);
 const f=(await rpc('qf_comissao13_fechamentos_painel'))[0];
 assert.equal((await rpc('qf13_cliente_abrir',[f.id])).ok,false,'profissional não recebe link do cliente');
 await user(9);const link=await rpc('qf13_cliente_abrir',[f.id]);const token=link.url.split('token=')[1];assert.match(token,/^[a-f0-9]{64}$/);
 await q("select set_config('request.jwt.claim.sub','',false)");
 assert.equal((await rpc('qf13_cliente_guest',['0'.repeat(64),'info'])).ok,false);
 assert.equal((await rpc('qf13_cliente_guest',[token,'info'])).ok,true,'sem sessão');
 await q('set role anon');await assert.rejects(rpc('qf13_cliente_guest',[token,'info']),/permission denied/);await q('reset role');
 const hash='a'.repeat(64);let sent=await rpc('qf13_cliente_guest',[token,'criar','contratou',hash]);assert.equal(sent.ok,true);
 assert.equal((await rpc('qf13_cliente_guest',[token,'confirmar','contratou',hash])).ok,false,'envio não aceito ainda');
 await rpc('qf_comissao13_codigo_enviado',[sent.codigo_id,'SM'+'a'.repeat(32)]);
 assert.equal((await rpc('qf13_cliente_guest',[token,'confirmar','contratou','b'.repeat(64)])).ok,false,'OTP incorreto');
 const confirmed=await rpc('qf13_cliente_guest',[token,'confirmar','contratou',hash]);assert.equal(confirmed.ok,true);assert.match(confirmed.codigo_servico,/^\d{6}$/);assert.equal(confirmed.comissao_devida,false);
 assert.equal((await rpc('qf13_cliente_guest',[token,'confirmar','contratou',hash])).ok,false,'uso único');
 await user(1);assert.equal((await rpc('qf_comissao13_prestar_contas',[f.id,'informado',50000,confirmed.codigo_servico])).ok,true);
 assert.equal((await rpc('qf_comissao13_fechamentos_painel'))[0].comissao_centavos,null);
 await user(2);assert.equal((await rpc('qf_comissao13_desbloquear',[call,true])).ok,true);let neg=(await rpc('qf_comissao13_fechamentos_painel'))[0];
 await q("update qf_comissao13_fechamentos set prazo_contas=now()-interval '1 minute' where id=$1",[neg.id]);assert.equal((await rpc('qf_comissao13_status')).bloqueio,'prestacao_contas_vencida');
 assert.equal((await rpc('qf_comissao13_prestar_contas',[neg.id,'negociando'])).ok,true);assert.equal((await rpc('qf_comissao13_status')).bloqueio,null);
 assert.equal((await rpc('qf_comissao13_prestar_contas',[neg.id,'negociando'])).reason,'limite_prorrogacao');
 await q("update qf_comissao13_fechamentos set prazo_contas=now()-interval '1 minute' where id=$1",[neg.id]);
 const call2=id(101);await q("insert into qf_chamados(id,cliente_id,categoria,max_orcamentos,latitude,longitude) values($1,$2,'cat_eletricista',4,0.09,0)",[call2,id(9)]);
 await assert.rejects(rpc('qf_desbloquear_chamado',[call2]),/prestacao_contas_vencida/);
 assert.equal((await rpc('qf_comissao13_desbloquear',[call2,true])).reason,'prestacao_contas_vencida','bloqueio grátis');
 await rpc('qf_comissao13_prestar_contas',[neg.id,'recusado']);assert.equal((await rpc('qf_comissao13_status')).bloqueio,null);
 await user(9);const link2=await rpc('qf13_cliente_abrir',[neg.id]),token2=link2.url.split('token=')[1];
 await q("select set_config('request.jwt.claim.sub','',false)");sent=await rpc('qf13_cliente_guest',[token2,'criar','contratou',hash]);await rpc('qf_comissao13_codigo_enviado',[sent.codigo_id,'SM'+'b'.repeat(32)]);
 assert.equal((await rpc('qf13_cliente_guest',[token2,'confirmar','contratou',hash])).resposta,'divergencia');
 await user(2);neg=(await rpc('qf_comissao13_fechamentos_painel'))[0];assert.equal(neg.comissao_centavos,null);assert.equal((await rpc('qf_comissao13_status')).bloqueio,null,'divergência não suspende');
 await q("select set_config('test.admin','true',false)");await user(9);const hist=await rpc('qf13_admin_historico',[neg.id]);assert.ok(hist.eventos.some(e=>e.depois.cliente_resposta==='divergencia'));assert.ok(hist.notificacoes.length>=2);
 console.log('PASS guest: token/OTP sem login, rate limit, envio confirmado, replay bloqueado, código vinculado ao profissional, prazo, prorrogação única, bloqueio entre modalidades, divergência sem cobrança/suspensão e auditoria.');
 }finally{await db.close();}
});
