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
 await db.exec("alter table public.qf_chamados add column atendimento_tipo text default 'tradicional'; alter table public.qf_profissionais add column horario_inicio time; alter table public.qf_profissionais add column horario_fim time; alter table public.qf_profissionais add column alerta_modo text; alter table public.qf_profissionais add column documento text default '12345678909'; create table public.qf_admins(user_id uuid primary key);");
 await db.exec(read('supabase/migrations/20261022183000_comissao13_piloto.sql'));
 await db.exec(read('supabase/migrations/20261022184500_comissao13_adesao_carteirinha.sql'));
 await db.exec(read('supabase/migrations/20261022184616_comissao13_fluxo_validado.sql'));
 await db.exec(read('supabase/migrations/20261022185059_comissao13_validacao_acordo.sql'));
 // A segunda aplicação prova idempotência do esquema e permissões.
 await db.exec(read('supabase/migrations/20261022184616_comissao13_fluxo_validado.sql'));
 await db.exec(read('supabase/migrations/20261022185059_comissao13_validacao_acordo.sql'));
 await db.exec(read('supabase/migrations/20261022185945_comissao13_qr_notificacoes.sql'));
 await db.exec(read('supabase/migrations/20261022185945_comissao13_qr_notificacoes.sql'));
 await db.exec(read('supabase/migrations/20261022190530_comissao13_financeiro_seguro.sql'));
 await db.exec(read('supabase/migrations/20261022190530_comissao13_financeiro_seguro.sql'));
 for(let n=1;n<=7;n++){
  await q("insert into public.qf_profiles(id,tipo,ativo,foto_url,telefone,nome) values($1,$2,true,'selfie','11999990000',$3)",[id(n),n===7?'cliente':'profissional','Pessoa '+n]);
  if(n!==7){await q("update qf_profiles set telefone='11888880000' where id=$1",[id(n)]);await q("insert into public.qf_profissionais(user_id,especialidades,raio_km,latitude,longitude) values($1,array['cat_eletricista'],22,0,0)",[id(n)]);await q('insert into public.qf_carteirinhas(profissional_id) values($1)',[id(n)]);await q("insert into private.qf_comissao13_recebedores(profissional_id,payee_code,conta_efi,documento,status) values($1,'receiver_test','1234567','12345678909','validado')",[id(n)]);}
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
 await t.test('QR da carteirinha confere o profissional; link novo preserva o anterior',async()=>{
  const original=token;
  const r=await rpc('qf_comissao13_gerar_link',[acordo]);assert.equal(r.ok,true);
  assert.equal((await rpc('qf_comissao13_cliente_info',[r.token])).ok,true);
  assert.equal((await rpc('qf_comissao13_cliente_info',[original])).ok,true);
  assert.equal((await rpc('qf_comissao13_carteirinha_info',[r.carteirinha_token,r.token])).ok,true);
  const outra=(await q('select token from qf_carteirinhas where profissional_id=$1',[id(2)]))[0].token;
  assert.equal((await rpc('qf_comissao13_carteirinha_info',[outra,r.token])).reason,'carteirinha_incompativel');
  assert.equal((await rpc('qf_comissao13_cliente_info',[r.token])).status,'proposto');
  token=r.token;
  await user(2);assert.equal((await rpc('qf_comissao13_gerar_link',[acordo])).ok,false);await user(1);
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
  assert.equal((await rpc('qf_comissao13_pagamento_preparar',[token,'pix'])).reason,'conclusao_nao_confirmada');
  assert.equal((await rpc('qf_comissao13_cliente_info',[token])).status,'contratado');
  await q("update private.qf_comissao13_codigos set criado_em=now()-interval '10 minutes'");
  let r=await rpc('qf_comissao13_codigo_criar',[token,'concluir',hash]);await rpc('qf_comissao13_codigo_enviado',[r.codigo_id,'SM-3']);
  assert.equal((await rpc('qf_comissao13_cliente_confirmar',[token,'concluir',hash,true,null])).status,'concluido');
  let a=(await q('select * from qf_comissao13_acordos where id=$1',[acordo]))[0];assert.equal(a.pago_em,null);assert.equal(a.repassado_em,null);
  let p=(await rpc('qf_comissao13_painel'))[0];assert.equal(p.comissao_centavos,6500);assert.equal(p.profissional_centavos,43500);
  assert.equal((await rpc('qf_comissao13_pagamento_preparar',[token,'pix'])).reason,'tarifa_nao_validada');
  await q("insert into private.qf_comissao13_tarifas(metodo,fixo_centavos,percentual_bps,responsavel,evidencia,verificado_em,verificado_por) values('pix',0,100,'quemfaz','Fixture apenas de teste, não tarifa real',now(),$1)",[id(7)]);
  const fin=await rpc('qf_comissao13_pagamento_preparar',[token,'pix']);assert.equal(fin.novo,true);
  const again=await rpc('qf_comissao13_pagamento_preparar',[token,'pix']);assert.equal(again.novo,false);assert.equal(again.financeiro_id,fin.financeiro_id);
  await rpc('qf_comissao13_pagamento_emitido',[fin.financeiro_id,'EFI_TEST_PIX',null]);
  assert.equal((await rpc('qf_comissao13_financeiro_evento',['EFI_TEST_PIX','evt-repasse-cedo','repassado',50000,500])).reason,'repasse_bloqueado');
  assert.equal((await rpc('qf_comissao13_financeiro_evento',['EFI_TEST_PIX','evt-valor-errado','pago',49000,500])).reason,'valor_ou_cobranca_incompativel');
  const paid=await rpc('qf_comissao13_financeiro_evento',['EFI_TEST_PIX','evt-pagamento-1','pago',50000,500]);assert.equal(paid.ok,true);
  assert.equal((await rpc('qf_comissao13_financeiro_evento',['EFI_TEST_PIX','evt-pagamento-1','pago',50000,500])).duplicado,true);
  await q("update private.qf_comissao13_codigos set criado_em=now()-interval '10 minutes'");
  r=await rpc('qf_comissao13_codigo_criar',[token,'contestar',hash]);await rpc('qf_comissao13_codigo_enviado',[r.codigo_id,'SM-4']);
  assert.equal((await rpc('qf_comissao13_cliente_confirmar',[token,'contestar',hash,true,'Serviço não foi concluído'])).status,'contestado');
  assert.equal((await rpc('qf_comissao13_codigo_criar',[token,'concluir',hash])).reason,'estado_invalido');
  assert.equal((await rpc('qf_comissao13_financeiro_evento',['EFI_TEST_PIX','evt-repasse-contestado','repassado',50000,500])).reason,'repasse_bloqueado');
  assert.equal((await q("select repasse_status from qf_comissao13_financeiro where provedor_id='EFI_TEST_PIX'"))[0].repasse_status,'bloqueado');
  assert.equal((await rpc('qf_comissao13_financeiro_evento',['EFI_TEST_PIX','evt-estorno-total','estornado',50000,500,50000])).ok,true);
  assert.equal((await rpc('qf_comissao13_financeiro_evento',['EFI_TEST_PIX','evt-pagamento-atrasado','pago',50000,500])).reason,'evento_fora_ordem');
 });
 await t.test('repasse confirmado apenas após pagamento, sem regressão por webhook repetido',async()=>{
  await q("insert into qf_chamados(id,cliente_id,categoria,status,max_orcamentos,latitude,longitude) values($1,$2,'cat_eletricista','em_negociacao',4,0.09,0)",[id(200),id(7)]);
  const d=(await q("insert into qf_desbloqueios(chamado_id,profissional_id,valor_centavos,origem) values($1,$2,0,'comissao13') returning id",[id(200),id(2)]))[0].id;
  const tok=id(201);await q("insert into qf_comissao13_acordos(chamado_id,desbloqueio_id,profissional_id,cliente_id,valor_centavos,status,contratado_em,concluido_em,telefone_verificado_em,token_hash,token_expira_em) values($1,$2,$3,$4,50000,'concluido',now(),now(),now(),md5($5),now()+interval '1 day')",[id(200),d,id(2),id(7),tok]);
  const f=await rpc('qf_comissao13_pagamento_preparar',[tok,'pix']);assert.equal(f.ok,true);
  await rpc('qf_comissao13_pagamento_emitido',[f.financeiro_id,'EFI_TEST_REPASSE',null]);
  assert.equal((await rpc('qf_comissao13_financeiro_evento',['EFI_TEST_REPASSE','evt-liquidado-2','pago',50000,500])).ok,true);
  assert.equal((await rpc('qf_comissao13_financeiro_evento',['EFI_TEST_REPASSE','evt-repasse-2','repassado',50000,500])).ok,true);
  assert.equal((await rpc('qf_comissao13_financeiro_evento',['EFI_TEST_REPASSE','evt-liquidado-tardio-2','pago',50000,500])).duplicado,true);
  const row=(await q('select a.status,f.repasse_status,f.profissional_centavos,f.taxa_real_centavos from qf_comissao13_acordos a join qf_comissao13_financeiro f on f.acordo_id=a.id where f.id=$1',[f.financeiro_id]))[0];
  assert.equal(row.status,'repassado');assert.equal(row.repasse_status,'concluido');assert.equal(row.profissional_centavos,43500);assert.equal(row.taxa_real_centavos,500);
 });
 await t.test('notificações: reserva única, horários, disponibilidade e sem entrega fictícia',async()=>{
  const fila=await q('select * from private.qf_comissao13_notificacoes where acordo_id=$1 order by criado_em',[acordo]);assert.ok(fila.length>=4);
  const nid=fila[0].id;
  await q('update qf_profissionais set online=false where user_id=$1',[id(1)]);
  assert.equal((await rpc('qf_comissao13_notificacao_reservar',[nid])).reason,'fora_disponibilidade');
  await q("update qf_profissionais set online=true,horario_inicio=(timezone('America/Sao_Paulo',now())+interval '1 hour')::time,horario_fim=(timezone('America/Sao_Paulo',now())+interval '2 hours')::time where user_id=$1",[id(1)]);
  assert.equal((await rpc('qf_comissao13_notificacao_reservar',[nid])).reason,'fora_horario');
  await q('update qf_profissionais set horario_inicio=null,horario_fim=null where user_id=$1',[id(1)]);
  assert.equal((await rpc('qf_comissao13_notificacao_reservar',[nid])).ok,true);
  assert.equal((await rpc('qf_comissao13_notificacao_reservar',[nid])).reason,'ja_processado');
  let n=(await q('select * from private.qf_comissao13_notificacoes where id=$1',[nid]))[0];assert.equal(n.aceito_provedor_em,null);
  await rpc('qf_comissao13_notificacao_resultado',[nid,'aceito_provedor',null]);
  assert.equal((await rpc('qf_comissao13_notificacao_reservar',[nid])).ok,false);
  await q("select set_config('test.admin','true',false)");
  const first=await rpc('qf_comissao13_anunciar');assert.equal(first.enfileirados,6);assert.equal(first.entrega_confirmada,false);
  assert.equal((await rpc('qf_comissao13_anunciar')).enfileirados,0);
  const stats=await rpc('qf_comissao13_notificacoes_status');assert.equal(stats.resumo.aceito_provedor,1);assert.equal(stats.entrega_confirmada,false);
  await q("select set_config('test.admin','false',false)");
 });
 await t.test('permissões: clientes/profissionais não acessam tabelas, OTP nem RPC do servidor',async()=>{
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   for(const sql of ['select * from qf_comissao13_acordos','select * from private.qf_comissao13_codigos','select * from private.qf_comissao13_notificacoes','select * from private.qf_comissao13_links','select * from qf_comissao13_financeiro','select * from private.qf_comissao13_recebedores','select * from private.qf_comissao13_tarifas',"select qf_comissao13_pagamento_preparar('x','pix')","select qf_comissao13_notificacao_reservar('00000000-0000-4000-8000-000000000000')","select qf_comissao13_cliente_info('x')","select qf_comissao13_codigo_criar('x','concluir','x')"]){await assert.rejects(q(sql),/permission denied/);}
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
