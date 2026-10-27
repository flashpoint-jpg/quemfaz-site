const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {setup}=require('./helpers/contratacao-sem-codigo.cjs');
test('Espera do cliente e prestação vencida não bloqueiam; comissão confirmada vencida mantém cobrança',async()=>{
 const {d,f}=await setup({melhorias:true,seguranca:true});
 try{await d.exec('reset role');await d.exec(fs.readFileSync('supabase/migrations/20261027120926_liberar_pedidos_sem_resposta_cliente.sql','utf8'));
 const query=async()=> (await d.query('select private.qf13_bloqueio(profissional_id) as b from qf_comissao13_fechamentos where id=$1',[f.id])).rows[0].b;
 for(const status of ['pendente','negociando','informado']){
 await d.query("update qf_comissao13_fechamentos set status=$1,prazo_contas=now()-interval '5 days',cliente_resposta=null,cobranca_status='nao_gerada',proposta_chat_em=null where id=$2",[status,f.id]);assert.equal(await query(),null,status);
 }
 await d.query("update qf_comissao13_fechamentos set status='confirmado',cliente_resposta='confirmado',cobranca_status='pendente',comissao_vence_em=now()+interval '1 day' where id=$1",[f.id]);assert.equal(await query(),null);
 await d.query("update qf_comissao13_fechamentos set comissao_vence_em=now()-interval '1 minute' where id=$1",[f.id]);assert.equal(await query(),'comissao_pendente');
 await d.query("update qf_comissao13_fechamentos set cobranca_status='paga' where id=$1",[f.id]);assert.equal(await query(),null);
 assert.equal((await d.query("select has_function_privilege('anon','private.qf13_bloqueio(uuid)','execute') as allowed")).rows[0].allowed,false);
 }finally{await d.close()}
});
