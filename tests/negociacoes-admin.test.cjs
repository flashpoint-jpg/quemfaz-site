const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {setup}=require('./helpers/contratacao-sem-codigo.cjs'),{rpc}=require('./helpers/comissao13-owner.cjs'),{as,uid}=require('./helpers/atendimento-db.cjs');
const ui=require('../qf-admin-negociacoes.js');
const {ready}=require('./helpers/negociacoes-admin.cjs');
test('Orçamento, negociação, contratação separada da conclusão, valor final, Pix único e 48h',async()=>{
 const {d,a,call,f}=await ready();try{
  assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'propor',35000])).ok,true);
  await as(d,12);assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'contratar',35000])).ok,false);
  await as(d,1);assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'negociando'])).comissao_devida,false);
  assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'contratar',40000])).reason,'valor_alterado');
  assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'contratar',35000])).comissao_devida,false);
  const view=await rpc(d,'qf_chat_contratacao',[call.id,uid(11)]);assert.ok(view.contratado_em);assert.equal(view.etapas_separadas,true);
  await d.exec('reset role');let row=(await d.query('select * from qf_comissao13_fechamentos where id=$1',[f.id])).rows[0];assert.equal(Number(row.valor_aceito_centavos),35000);assert.equal(row.comissao_centavos,null);assert.equal(row.comissao_vence_em,null);assert.equal((await d.query('select count(*)::int n from qf_comissao13_pix')).rows[0].n,0);
  await as(d,1);assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',40000,'000000',true])).ok,false);
  assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',40000,view.codigo_seguranca,true])).ok,true);
  assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',40000,view.codigo_seguranca,true])).ok,true);
  await d.exec('reset role');row=(await d.query('select * from qf_comissao13_fechamentos where id=$1',[f.id])).rows[0];assert.equal(Number(row.valor_informado_centavos),35000);assert.equal(Number(row.valor_aceito_centavos),35000);assert.equal(Number(row.valor_confirmado_centavos),40000);assert.equal(Number(row.comissao_centavos),5200);assert.ok(row.cliente_concluiu_em);assert.equal(new Date(row.comissao_vence_em)-new Date(row.confirmado_em),48*3600000);assert.equal((await d.query('select count(*)::int n from qf_comissao13_pix')).rows[0].n,1);
  await d.query("update qf_comissao13_fechamentos set comissao_vence_em=now()-interval '1 second' where id=$1",[f.id]);
  assert.equal((await d.query('select private.qf13_bloqueio($1) b',[uid(11)])).rows[0].b,'comissao_pendente');
  await as(d,1);assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11)])).ok,true,'cliente nunca bloqueado');
  await as(d,0);assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento])).ok,true,'acesso proprietário preservado');
 }finally{await d.close();}
});
test('Painel exige administrador, detalha chat sem marcar leitura, audita acesso e não cobra recusa',async()=>{
 const {d,a,call,f}=await ready();try{
  await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'propor',35000]);
  await assert.rejects(rpc(d,'qf_admin_negociacoes'),/admin authentication required/);
  await d.exec("reset role;select set_config('test.admin','true',false)");await as(d,1);
  let rows=await rpc(d,'qf_admin_negociacoes');assert.equal(rows.length,1);assert.equal(ui.totals(rows).previsao_orcamento,4550);assert.equal(ui.totals(rows).receber,0);
  let detail=await rpc(d,'qf_admin_negociacao_detalhe',[f.desbloqueio_id]);assert.ok(detail.mensagens.length);assert.equal(detail.mensagens[0].lida_em,null);assert.equal(detail.contato_autorizado,true);assert.equal(detail.telefone_suporte,'11988887777');
  await d.exec('reset role');assert.equal((await d.query('select count(*)::int n from private.qf_negociacoes_acessos')).rows[0].n,1);
  await d.exec("select set_config('test.admin','false',false)");await as(d,11);rows=await rpc(d,'qf_comissao13_fechamentos_painel');assert.equal(rows[0].telefone,null);assert.equal(rows[0].whatsapp,null);
  await as(d,0);assert.equal((await rpc(d,'qf13_acompanhar',[call.id,'b'.repeat(64),'contratar',f.id,true,35000])).ok,false);
  assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'negociando',f.id])).ok,true);
  assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'contratar',f.id,null,35000])).ok,true);
  let owner=await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento]);assert.equal(owner.profissionais[0].etapas_separadas,true);assert.ok(owner.profissionais[0].contratado_em);
  assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'responder',f.id,false])).ok,true);
  await d.exec('reset role');const row=(await d.query('select * from qf_comissao13_fechamentos where id=$1',[f.id])).rows[0];assert.equal(row.contratado_em,null);assert.equal(row.comissao_centavos,null);
  assert.ok((await d.query("select count(*)::int n from private.test_dispatch where evento='chat_message'")).rows[0].n>=4);
 }finally{await d.close();}
});
test('Indicadores separam previsão de orçamento, contratação, vencido, pago conciliado e cancelado',()=>{
 const r={origem:'comissao13',ativo:true,pedido_status:'em_negociacao',status:'negociando',valor_informado_centavos:35000};
 const t=ui.totals([r,{...r,contratado_em:'2026-10-27',cliente_resposta:'confirmado',valor_aceito_centavos:40000},{...r,pedido_status:'cancelado'},{...r,status:'confirmado',comissao_centavos:6500,cobranca_status:'pendente',comissao_vence_em:'2000-01-01'},{...r,status:'confirmado',comissao_centavos:3900,cobranca_status:'paga',pagamento_conciliado:true},{...r,status:'confirmado',comissao_centavos:99999,cobranca_status:'paga',pagamento_conciliado:false}]);
 assert.equal(t.previsao_orcamento,4550);assert.equal(t.previsao_contratacao,5200);assert.equal(t.receber,6500);assert.equal(t.vencida,6500);assert.equal(t.paga,3900);
 assert.ok(ui.state({...r,pedido_status:'cancelado'}).includes('conferir'));assert.ok(!ui.row({...r,profissional:'<script>alert(1)</script>'}).includes('<script>'));
});
