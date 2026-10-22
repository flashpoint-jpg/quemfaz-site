const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const root=require('node:path').join(__dirname,'..');
const read=p=>fs.readFileSync(root+'/'+p,'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash='a'.repeat(64),wrong='b'.repeat(64);
let db;
async function q(sql,args=[]){return (await db.query(sql,args)).rows;}
async function rpc(name,args=[]){return (await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as r`,args))[0].r;}
async function user(n){await q("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);}
async function init(){
 db=new PGlite(); await db.exec(read('tests/fixtures/valor-definido-schema.sql'));
 await db.exec("alter table public.qf_chamados add column atendimento_tipo text default 'tradicional';");
 await db.exec(read('supabase/migrations/20261022183000_comissao13_piloto.sql'));
 await db.exec(read('supabase/migrations/20261022184500_comissao13_adesao_carteirinha.sql'));
 await db.exec(read('supabase/migrations/20261022184616_comissao13_fluxo_validado.sql'));
 await db.exec(read('supabase/migrations/20261022185059_comissao13_validacao_acordo.sql'));
 // A segunda aplicação prova idempotência do esquema e permissões.
 await db.exec(read('supabase/migrations/20261022184616_comissao13_fluxo_validado.sql'));
 await db.exec(read('supabase/migrations/20261022185059_comissao13_validacao_acordo.sql'));
 for(let n=1;n<=7;n++){
  await q("insert into public.qf_profiles(id,tipo,ativo,foto_url,telefone,nome) values($1,$2,true,'selfie','11999990000',$3)",[id(n),n===7?'cliente':'profissional','Pessoa '+n]);
  if(n!==7){await q("update qf_profiles set telefone='11888880000' where id=$1",[id(n)]);await q("insert into public.qf_profissionais(user_id,especialidades,raio_km,latitude,longitude) values($1,array['cat_eletricista'],22,0,0)",[id(n)]);await q('insert into public.qf_carteirinhas(profissional_id) values($1)',[id(n)]);}
 }
 await q("insert into public.qf_chamados(id,cliente_id,categoria,max_orcamentos,latitude,longitude) values($1,$2,'cat_eletricista',4,0.09,0)",[id(100),id(7)]);
}
test('piloto: isolamento, limite misto, carteira, OTP e confirmação auditável',async t=>{
 await init();
 try {
 await t.test('sem infraestrutura, gratuito não desbloqueia nem toca no saldo',async()=>{
  await user(1); assert.equal((await rpc('qf_comissao13_status')).desbloqueio_gratuito_ativo,false);
  assert.equal((await rpc('qf_comissao13_desbloquear',[id(100),true])).reason,'integracao_pendente');
  assert.equal((await q('select count(*)::int as n from qf_desbloqueios'))[0].n,0);
  await q('update private.qf_comissao13_prontidao set otp_validado=true,financeiro_validado=true,testes_aprovados=true');
 });
 await t.test('adesão, selfie, profissão e raio são validados no servidor',async()=>{
  assert.equal((await rpc('qf_comissao13_desbloquear',[id(100),true])).reason,'adesao_necessaria');
  assert.equal((await rpc('qf_comissao13_aderir',[false])).reason,'aceite_obrigatorio');
  assert.equal((await rpc('qf_comissao13_aderir',[true])).ok,true);
  await q("update qf_profissionais set especialidades=array['cat_pintor'] where user_id=$1",[id(1)]);
  assert.equal((await rpc('qf_comissao13_desbloquear',[id(100),true])).reason,'nao_elegivel');
  await q("update qf_profissionais set especialidades=array['cat_eletricista'],raio_km=1 where user_id=$1",[id(1)]);
  assert.equal((await rpc('qf_comissao13_desbloquear',[id(100),true])).reason,'nao_elegivel');
  await q('update qf_profissionais set raio_km=22 where user_id=$1',[id(1)]);
 });
 let unlock;
 await t.test('dois gratuitos + dois tradicionais ocupam as mesmas quatro vagas',async()=>{
  await q('insert into qf_carteiras(profissional_id,saldo_centavos) values($1,10000)',[id(1)]);
  unlock=await rpc('qf_comissao13_desbloquear',[id(100),true]);assert.equal(unlock.ok,true);
  assert.equal((await q('select saldo_centavos from qf_carteiras where profissional_id=$1',[id(1)]))[0].saldo_centavos,10000);
  assert.equal((await rpc('qf_comissao13_desbloquear',[id(100),true])).reason,'ja_participou');
  await q("insert into qf_desbloqueios(chamado_id,profissional_id,valor_centavos,origem) values($1,$2,790,'saldo'),($1,$3,0,'plano')",[id(100),id(3),id(4)]);
  await user(2);await rpc('qf_comissao13_aderir',[true]);assert.equal((await rpc('qf_comissao13_desbloquear',[id(100),true])).participantes,4);
  await user(5);await rpc('qf_comissao13_aderir',[true]);assert.equal((await rpc('qf_comissao13_desbloquear',[id(100),true])).reason,'reservado');
  assert.equal((await q('select count(*)::int n from qf_desbloqueios where chamado_id=$1',[id(100)]))[0].n,4);
 });
 let token,acordo,codigo;
 await t.test('contratação exige desbloqueio próprio e telefone vem do pedido',async()=>{
  await user(2);assert.equal((await rpc('qf_comissao13_propor',[unlock.desbloqueio_id,50000,new Date().toISOString()])).reason,'sem_desbloqueio');
  await user(1);
  await assert.rejects(q("update qf_desbloqueios set desfecho='fechado' where id=$1",[unlock.desbloqueio_id]),/confirmacao_cliente_otp_obrigatoria/);
  await q("update qf_profiles set telefone='11999990000' where id=$1",[id(1)]);
  assert.equal((await rpc('qf_comissao13_propor',[unlock.desbloqueio_id,50000,new Date().toISOString()])).reason,'telefone_profissional');
  await q("update qf_profiles set telefone='11888880000' where id=$1",[id(1)]);
  let r=await rpc('qf_comissao13_propor',[unlock.desbloqueio_id,50000,new Date().toISOString()]);assert.equal(r.ok,true);token=r.token;acordo=r.acordo_id;
  assert.equal((await rpc('qf_comissao13_propor',[unlock.desbloqueio_id,50000,new Date().toISOString()])).reason,'acordo_existente');
  assert.equal((await rpc('qf_comissao13_cliente_info',['invalido'])).reason,'link_invalido');
  const row=(await q('select * from qf_comissao13_acordos where id=$1',[acordo]))[0];assert.notEqual(row.token_hash,token);assert.equal(row.telefone_vinculado,'11999990000');
 });
 await t.test('OTP não enviado, incorreto, expirado, excesso e reutilização falham',async()=>{
  let r=await rpc('qf_comissao13_codigo_criar',[token,'contratar',hash]);codigo=r.codigo_id;assert.equal(r.telefone,'11999990000');
  assert.equal((await rpc('qf_comissao13_cliente_confirmar',[token,'contratar',hash,true,null])).reason,'codigo_invalido');
  await rpc('qf_comissao13_codigo_enviado',[codigo,'SM-provider-accepted']);
  for(let i=0;i<5;i++) assert.equal((await rpc('qf_comissao13_cliente_confirmar',[token,'contratar',wrong,true,null])).ok,false);
  assert.equal((await rpc('qf_comissao13_cliente_confirmar',[token,'contratar',hash,true,null])).ok,false);
  assert.equal((await rpc('qf_comissao13_codigo_criar',[token,'contratar',hash])).reason,'limite');
  await q("update private.qf_comissao13_codigos set criado_em=now()-interval '10 minutes',tentativas=0,expira_em=now()-interval '1 minute'");
  assert.equal((await rpc('qf_comissao13_cliente_confirmar',[token,'contratar',hash,true,null])).ok,false);
  r=await rpc('qf_comissao13_codigo_criar',[token,'contratar',hash]);await rpc('qf_comissao13_codigo_enviado',[r.codigo_id,'SM-2']);
  assert.equal((await rpc('qf_comissao13_cliente_confirmar',[token,'contratar',hash,false,null])).reason,'confirmacao_obrigatoria');
  assert.equal((await rpc('qf_comissao13_cliente_confirmar',[token,'contratar',hash,true,null])).status,'contratado');
  assert.equal((await rpc('qf_comissao13_cliente_confirmar',[token,'contratar',hash,true,null])).ok,false);
 });
 await t.test('QR/link sozinho não conclui; conclusão correta não registra pagamento',async()=>{
  assert.equal((await rpc('qf_comissao13_cliente_info',[token])).status,'contratado');
  await q("update private.qf_comissao13_codigos set criado_em=now()-interval '10 minutes'");
  let r=await rpc('qf_comissao13_codigo_criar',[token,'concluir',hash]);await rpc('qf_comissao13_codigo_enviado',[r.codigo_id,'SM-3']);
  assert.equal((await rpc('qf_comissao13_cliente_confirmar',[token,'concluir',hash,true,null])).status,'concluido');
  let a=(await q('select * from qf_comissao13_acordos where id=$1',[acordo]))[0];assert.equal(a.pago_em,null);assert.equal(a.repassado_em,null);
  let p=(await rpc('qf_comissao13_painel'))[0];assert.equal(p.comissao_centavos,6500);assert.equal(p.profissional_centavos,43500);
  await q("update private.qf_comissao13_codigos set criado_em=now()-interval '10 minutes'");
  r=await rpc('qf_comissao13_codigo_criar',[token,'contestar',hash]);await rpc('qf_comissao13_codigo_enviado',[r.codigo_id,'SM-4']);
  assert.equal((await rpc('qf_comissao13_cliente_confirmar',[token,'contestar',hash,true,'Serviço não foi concluído'])).status,'contestado');
  assert.equal((await rpc('qf_comissao13_codigo_criar',[token,'concluir',hash])).reason,'estado_invalido');
 });
 await t.test('permissões: clientes/profissionais não acessam tabelas, OTP nem RPC do servidor',async()=>{
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   for(const sql of ['select * from qf_comissao13_acordos','select * from private.qf_comissao13_codigos',"select qf_comissao13_cliente_info('x')","select qf_comissao13_codigo_criar('x','concluir','x')"]){await assert.rejects(q(sql),/permission denied/);}
   await db.exec('reset role');
  }
 });
 } finally {await db.close();}
});
test('HMAC vincula código ao link e à finalidade, sem expor o código',async()=>{
 const {gerarCodigo,hashCodigo,telefoneBR}=await import('../supabase/functions/quemfaz-comissao13/seguranca.mjs');
 const h=await hashCodigo('token','contratar','123456','secret'.repeat(8));
 assert.match(h,/^[a-f0-9]{64}$/);
 assert.notEqual(h,await hashCodigo('outro','contratar','123456','secret'.repeat(8)));
 assert.notEqual(h,await hashCodigo('token','concluir','123456','secret'.repeat(8)));
 assert.notEqual(h,await hashCodigo('token','contratar','654321','secret'.repeat(8)));
 for(let i=0;i<100;i++)assert.match(gerarCodigo(),/^\d{6}$/);
 assert.equal(telefoneBR('11999990000'),'+5511999990000');assert.throws(()=>telefoneBR('123'));
});
test('frontend: mostra bloqueio real e não expõe ação de desbloqueio antes da validação',()=>{
 const ui=require('../qf-comissao13.js');
 const off=ui.oferta({desbloqueio_gratuito_ativo:false});assert.match(off,/Em preparação/);assert.ok(!off.includes('data-qf13-desbloquear'));
 const on=ui.oferta({desbloqueio_gratuito_ativo:true});assert.match(on,/data-qf13-termos/);assert.match(on,/data-qf13-desbloquear/);
 assert.ok(!ui.painel([{profissional:'<img src=x>',valor_centavos:50000}]).includes('<img'));
});
