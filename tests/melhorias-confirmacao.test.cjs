const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {setup}=require('./helpers/contratacao-sem-codigo.cjs');
const {rpc}=require('./helpers/comissao13-owner.cjs'),{as,uid}=require('./helpers/atendimento-db.cjs');
const ui=require('../qf-comissao13.js');
async function notices(d,prefix){await d.exec('reset role');return (await d.query('select * from private.qf_comissao13_notificacoes where chave like $1 order by criado_em',[prefix+'%'])).rows;}
test('Aviso imediato correto; um lembrete depois de 24h pelo cron e nenhuma comissão pelo silêncio',async()=>{
 const {d,call,f}=await setup({melhorias:true});try{
  await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'propor',35000]);
  let n=await notices(d,'confirmacao13:');assert.equal(n.length,1);assert.equal(n[0].user_id,uid(1));assert.match(n[0].corpo,/Pro 11.*R\$ 350,00/);assert.equal(n[0].rota,'/?app=1#/cliente/chat/'+call.id+'/'+uid(11));
  await d.exec('select private.qf_comissao13_reprocessar_notificacoes()');assert.equal((await notices(d,'lembrete13:')).length,0);
  await d.query("update qf_comissao13_fechamentos set proposta_chat_em=now()-interval '24 hours 1 minute' where id=$1",[f.id]);
  await d.exec('select private.qf_comissao13_reprocessar_notificacoes()');
  await d.exec('select private.qf_comissao13_reprocessar_notificacoes()');n=await notices(d,'lembrete13:');assert.equal(n.length,1);assert.match(n[0].titulo,/aguarda confirmação/);
  const row=(await d.query('select * from qf_comissao13_fechamentos where id=$1',[f.id])).rows[0];assert.equal(row.comissao_centavos,null);assert.equal(row.cobranca_status,'nao_gerada');
  await as(d,1);assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',35000])).ok,true);
  await d.exec('reset role;set role service_role');const reserved=await rpc(d,'qf_comissao13_notificacao_reservar',[n[0].id]);assert.equal(reserved.ok,false);assert.equal(reserved.reason,'confirmacao_ja_resolvida_ou_atualizada');
  const discarded=(await notices(d,'lembrete13:'))[0];assert.equal(discarded.status,'falhou');assert.equal(discarded.tentativas,0);
 }finally{await d.close();}
});
test('Valor reenviado invalida aviso antigo; correção e cancelamento impedem lembretes',async()=>{
 const {d,call,f}=await setup({melhorias:true});try{
  await rpc(d,'qf_comissao13_prestar_contas',[f.id,'informado',35000]);const old=(await notices(d,'confirmacao13:'))[0];
  await as(d,1);await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'corrigir_valor']);
  await d.exec('reset role');await d.query("update qf_comissao13_fechamentos set proposta_chat_em=now()-interval '25 hours' where id=$1",[f.id]);await d.exec('select private.qf13_lembretes_confirmacao()');assert.equal((await notices(d,'lembrete13:')).length,0);
  await as(d,11);assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'propor',40000])).ok,true);
  await d.exec('reset role;set role service_role');assert.equal((await rpc(d,'qf_comissao13_notificacao_reservar',[old.id])).ok,false);
  await d.exec('reset role');await d.query("update qf_comissao13_fechamentos set proposta_chat_em=now()-interval '25 hours' where id=$1",[f.id]);await d.query("update qf_chamados set status='cancelado' where id=$1",[call.id]);
  await d.exec('select private.qf13_lembretes_confirmacao()');assert.equal((await notices(d,'lembrete13:')).length,0);
 }finally{await d.close();}
});
test('Pendências do cliente isoladas por sessão; nome e link corretos no chat',async()=>{
 const {d,call}=await setup({melhorias:true});try{
  await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'propor',35000]);
  await as(d,1);const rows=await rpc(d,'qf13_minhas_confirmacoes');assert.equal(rows.length,1);assert.equal(rows[0].valor_centavos,35000);assert.equal(rows[0].profissional,'Pro 11');assert.ok(!JSON.stringify(rows).includes('telefone'));
  const chat=await rpc(d,'qf_chat_contratacao',[call.id,uid(11)]);assert.equal(chat.profissional_nome,'Pro 11');
  await as(d,12);assert.deepEqual(await rpc(d,'qf13_minhas_confirmacoes'),[]);
  await as(d,0);await assert.rejects(rpc(d,'qf13_minhas_confirmacoes'),/permission denied/);
 }finally{await d.close();}
});
test('Resumo de valores atualiza antes do envio e arredonda a comissão em centavos',()=>{
 const {JSDOM}=require('jsdom');const dom=new JSDOM('<form><input name="valor"><button type="submit">Enviar</button></form>');try{
  const f=dom.window.document.querySelector('form');ui.bindResumo(f);f.elements.valor.value='350,00';f.elements.valor.dispatchEvent(new dom.window.Event('input'));
  const text=f.querySelector('[data-qf13-resumo]').textContent;assert.match(text,/350,00/);assert.match(text,/45,50/);assert.match(text,/304,50/);assert.ok(f.querySelector('[data-qf13-resumo]').nextElementSibling.matches('button'));
  assert.equal(ui.valorCentavos('1.234,50'),123450);assert.equal(ui.valorCentavos('350.50'),35050);assert.equal(ui.valorCentavos('1.000'),100000);assert.equal(ui.valorCentavos('-1'),null);assert.equal(ui.valorCentavos('abc'),null);
  assert.match(ui.resumoValor(101),/0,13/);assert.match(ui.resumoValor(101),/0,88/);
 }finally{dom.window.close();}
});
test('Painel separa aguardando cliente, correção e vencidas com tempo e filtros rápidos',async()=>{
 const {JSDOM}=require('jsdom'),now=Date.now(),past=new Date(now-27*3600000).toISOString();
 const base={id:'c',status:'informado',profissional:'Carlos',cliente:'Ana',informado_em:past,proposta_chat_em:past,valor_informado_centavos:35000,cobranca_status:'nao_gerada'};
 const rows=[base,{...base,id:'v',status:'confirmado',cobranca_status:'pendente',comissao_vence_em:past},{...base,id:'r',cliente_resposta:'divergencia',cliente_respondeu_em:past}];
 assert.deepEqual(rows.map(ui.etapa),['cliente','vencida','corrigir']);assert.match(ui.tempoDecorrido(past,now),/1 dia e 3h/);
 const dom=new JSDOM('<main id="app-content"></main>',{url:'https://quemfazservico.com.br/admin.html',runScripts:'outside-only'});try{
  const w=dom.window;w.Screens={};w.QFAdminCloud={client:{rpc:async()=>({data:rows})}};
  w.eval(fs.readFileSync('qf-comissao13.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));w.Screens.afterRender('/admin/comissao13',w.document.querySelector('main'),{},{});
  await new Promise(r=>setTimeout(r,20));assert.equal(w.document.querySelectorAll('[data-qf13-quick]').length,3);assert.match(w.document.body.textContent,/há 1 dia e 3h/);
  w.document.querySelector('[data-qf13-quick=corrigir]').click();await new Promise(r=>setTimeout(r,10));assert.equal(w.document.querySelectorAll('[data-qf13-row]').length,1);assert.equal(w.document.querySelector('[data-qf13-row]').dataset.qf13Row,'r');
 }finally{dom.window.close();}
});
test('Aviso dentro do app mostra nome, valor e acesso direto, sem fazer confirmação',async()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<main><div class="view"></div></main>',{url:'https://quemfazservico.com.br',runScripts:'outside-only'});try{
  const w=dom.window;w.Screens={};w.QFCloud={client:{rpc:async name=>{assert.equal(name,'qf13_minhas_confirmacoes');return {data:[{profissional:'Carlos <teste>',valor_centavos:35000,rota:'/?app=1#/cliente/chat/p/f'}]};}}};
  w.eval(fs.readFileSync('qf-chat-contratacao.js','utf8'));await w.QFChatContratacao.avisosCliente(w.document.querySelector('main'),{id:uid(1)});
  assert.match(w.document.body.textContent,/Carlos <teste> informou.*350,00/);assert.equal(w.document.querySelector('a').getAttribute('href'),'/?app=1#/cliente/chat/p/f');assert.equal(w.document.querySelector('teste'),null);
 }finally{dom.window.close();}
});
