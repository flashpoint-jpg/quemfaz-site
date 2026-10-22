// Exclusivamente PostgreSQL descartável de CI; jamais executar contra produção.
const {Client}=require('pg'),fs=require('fs'),assert=require('node:assert/strict');
const url=process.env.QF13_TEST_DATABASE_URL;if(!url)throw Error('QF13_TEST_DATABASE_URL is required');
const u=new URL(url);if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/qf13_test')throw Error('Only the disposable local qf13_test database is allowed');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const db=new Client({connectionString:url});
async function race(pro,mode,call){
 const c=new Client({connectionString:url});await c.connect();
 try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[id(pro)]);
 const name=mode==='gratis'?'qf_comissao13_desbloquear':'qf_desbloquear_chamado';
 const r=(await c.query(`select ${name}($1${mode==='gratis'?',true':''}) as result`,[call])).rows[0].result;
 await c.query('select pg_sleep(0.05)');await c.query('commit');return {pro,mode,...r};
 }catch(e){await c.query('rollback');throw e;}finally{await c.end();}
}
(async()=>{await db.connect();try{
 await db.query(fs.readFileSync('tests/fixtures/valor-definido-schema.sql','utf8'));
 await db.query("alter table qf_chamados add column atendimento_tipo text default 'tradicional';alter table qf_profissionais add column horario_inicio time;alter table qf_profissionais add column horario_fim time;alter table qf_profissionais add column alerta_modo text;alter table qf_profissionais add column documento text default '12345678909';create table qf_admins(user_id uuid primary key)");
 for(const f of ['20261022183000_comissao13_piloto.sql','20261022184500_comissao13_adesao_carteirinha.sql','20261022184616_comissao13_fluxo_validado.sql','20261022185059_comissao13_validacao_acordo.sql','20261022185945_comissao13_qr_notificacoes.sql','20261022190530_comissao13_financeiro_seguro.sql'])await db.query(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await db.query('update private.qf_comissao13_prontidao set otp_validado=true,financeiro_validado=true,testes_aprovados=true');
 for(let n=1;n<=9;n++){
  await db.query("insert into qf_profiles(id,tipo,nome,ativo,foto_url,telefone) values($1,$2,$3,true,'selfie-test','11999990000')",[id(n),n===9?'cliente':'profissional','Fixture '+n]);
  if(n===9)continue;
  await db.query("insert into qf_profissionais(user_id,especialidades,raio_km,latitude,longitude) values($1,array['cat_eletricista'],22,0,0)",[id(n)]);
  await db.query('insert into qf_carteirinhas(profissional_id) values($1)',[id(n)]);
  await db.query("insert into qf_carteiras(profissional_id,saldo_centavos) values($1,10000)",[id(n)]);
  await db.query("insert into qf_comissao13_adesoes(profissional_id) values($1)",[id(n)]);
  await db.query("insert into private.qf_comissao13_recebedores(profissional_id,payee_code,conta_efi,documento,status) values($1,'receiver_fixture','1234567','12345678909','validado')",[id(n)]);
 }
 const call=id(100);await db.query("insert into qf_chamados(id,cliente_id,categoria,max_orcamentos,latitude,longitude) values($1,$2,'cat_eletricista',4,0.09,0)",[call,id(9)]);
 const initial=[await race(1,'pago',call),await race(2,'gratis',call)];assert.ok(initial.every(r=>r.ok));
 const attempts=await Promise.all([3,4,5,6,7,8].map(n=>race(n,n%2?'gratis':'pago',call)));
 assert.equal(attempts.filter(r=>r.ok).length,2);assert.equal(attempts.filter(r=>!r.ok).length,4);
 const rows=(await db.query('select profissional_id,origem,valor_centavos from qf_desbloqueios where chamado_id=$1',[call])).rows;assert.equal(rows.length,4);assert.ok(rows.some(r=>r.origem==='comissao13'));assert.ok(rows.some(r=>r.origem==='saldo'));
 for(let n=1;n<=8;n++){
  const d=rows.find(r=>r.profissional_id===id(n));const saldo=Number((await db.query('select saldo_centavos from qf_carteiras where profissional_id=$1',[id(n)])).rows[0].saldo_centavos);
  assert.equal(saldo,10000-(d?d.valor_centavos:0));
 }
 const q=(await db.query("insert into private.qf_comissao13_notificacoes(user_id,chave,titulo,corpo,rota) values($1,'race-fixture','Teste isolado','Não envia push real','/') returning id",[id(1)])).rows[0].id;
 async function claim(){const c=new Client({connectionString:url});await c.connect();try{await c.query('begin');const r=(await c.query('select qf_comissao13_notificacao_reservar($1) r',[q])).rows[0].r;await c.query('select pg_sleep(0.05)');await c.query('commit');return r;}finally{await c.end();}}
 const claimed=await Promise.all([claim(),claim()]);assert.equal(claimed.filter(r=>r.ok).length,1);assert.equal(claimed.filter(r=>!r.ok).length,1);
 console.log('PASS: 6 sessões independentes competiram por 2 vagas; total misto=4, saldo correto e reserva única de push. Nenhum serviço externo foi chamado.');
 }finally{await db.end();}})().catch(e=>{console.error(e);process.exitCode=1;});
