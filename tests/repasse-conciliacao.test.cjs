const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {setup}=require('./helpers/contratacao-sem-codigo.cjs');
const {rpc}=require('./helpers/comissao13-owner.cjs');
const {uid,as}=require('./helpers/atendimento-db.cjs');
test('SQL: entrada não baixa comissão; saída exige entrada; reprocessamento não duplica baixa nem avisos',async()=>{
 const {d,call,f}=await setup({seguranca:true});
 try{
  await d.exec(`reset role;
  create table private.qf_livre_split_config(id boolean,habilitado boolean,homologado boolean);
  create table private.qf_livre_split_recebedores(profissional_id uuid,status text,validado_em timestamptz);
  create table private.qf_livre_split_pagamentos(fechamento_id uuid);

  `);
  await d.exec(fs.readFileSync('supabase/migrations/20261028043500_livre_pix_qualquer_banco.sql','utf8'));
  await d.exec(fs.readFileSync('supabase/migrations/20261028044500_chave_pix_perfil_existente.sql','utf8'));
  await d.exec(fs.readFileSync('supabase/migrations/20261028051000_seguranca_repasse_cadastro_unico.sql','utf8'));
  await d.exec(`update public.qf_comissao13_fechamentos set status='confirmado',cliente_resposta='confirmado',codigo_validado_em=now(),cliente_concluiu_em=now(),valor_confirmado_centavos=10000,comissao_centavos=1300,cobranca_status='pendente' where id='${f.id}';
   insert into private.qf_livre_pix_pagamentos(id,fechamento_id,chamado_id,profissional_id,txid,id_envio,chave_pix,documento,valor_centavos,comissao_centavos,repasse_centavos,status)
   values('${uid(900)}','${f.id}','${call.id}','${uid(11)}',repeat('T',32),repeat('S',32),'test@example.com','52998224725',10000,1300,8700,'pix_pronto');`);
  const outArgs=[uid(900),'S'.repeat(32),'E000000000000000002',8700];
  assert.equal((await rpc(d,'qf_livre_pix_confirmar_saida',outArgs)).ok,false);
  assert.equal((await rpc(d,'qf_livre_pix_confirmar_entrada',[uid(900),'T'.repeat(32),'E000000000000000001',9999])).ok,false);
  const inArgs=[uid(900),'T'.repeat(32),'E000000000000000001',10000];
  assert.equal((await rpc(d,'qf_livre_pix_confirmar_entrada',inArgs)).novo,true);
  assert.equal((await rpc(d,'qf_livre_pix_confirmar_entrada',inArgs)).novo,false);
  assert.equal((await d.query('select cobranca_status from qf_comissao13_fechamentos')).rows[0].cobranca_status,'pendente');
  assert.equal((await rpc(d,'qf_livre_pix_reservar_envio',[uid(900)])).ok,false,'flags desligadas impedem envio');
  assert.equal((await rpc(d,'qf_livre_pix_confirmar_saida',outArgs)).novo,true);
  assert.equal((await rpc(d,'qf_livre_pix_confirmar_saida',outArgs)).novo,false);
  assert.equal((await d.query('select cobranca_status from qf_comissao13_fechamentos')).rows[0].cobranca_status,'paga');
  for(const credit of [false,true]){assert.equal((await rpc(d,'qf_livre_pix_avisar',[uid(900),credit])).novo,true);assert.equal((await rpc(d,'qf_livre_pix_avisar',[uid(900),credit])).novo,false);}
  assert.equal(Number((await d.query('select count(*) n from private.qf_livre_pix_avisos')).rows[0].n),2);
  await as(d,11);
  await assert.rejects(()=>rpc(d,'qf_livre_pix_confirmar_saida',outArgs),/permission denied/);
 }finally{await d.close();}
});
