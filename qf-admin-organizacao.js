/* Shared administrative actions; all persistent changes are checked by the server. */
(function(g){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>(Number(v||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const date=v=>new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
 async function rpc(name,args){const r=await g.QFAdminCloud.client.rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;}
 function dialog(title,body){
  const d=g.document.createElement('dialog');d.className='qfo-dialog';
  d.innerHTML='<h2>'+esc(title)+'</h2>'+body+'<p role="alert"></p><button type="button" class="btn btn--outline" data-close>Fechar</button>';
  g.document.body.append(d);d.querySelector('[data-close]').onclick=()=>d.close();d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();return d;
 }
 function button(host,label,fn){const b=g.document.createElement('button');b.type='button';b.className='btn btn--outline';b.textContent=label;b.onclick=fn;host.append(b);return b;}
 function remove(tipo,chave,control,done){
  const restore=!!control?.excluido;
  const d=dialog(restore?'Restaurar registro':'Excluir da lista','<p>'+(restore?'O registro voltará à lista ativa.':'O registro sairá desta lista. Pagamentos, acesso do profissional, conversas e comprovantes serão preservados. Você poderá restaurá-lo em “Ver excluídos”.')+'</p><button type="button" class="btn btn--primary" data-confirm>'+ (restore?'Restaurar':'Excluir da lista')+'</button>');
  d.querySelector('[data-confirm]').onclick=async e=>{e.target.disabled=true;try{const result=await rpc('qf_admin_lista_controle',{p_tipo:tipo,p_chave:chave,p_dados:{excluido:!restore}});if(!result?.ok)throw Error('O banco não confirmou a alteração.');d.close();await done();}catch(err){d.querySelector('[role=alert]').textContent=err.message;e.target.disabled=false;}};
 }
 function negotiationActions(host,r,control,done){
  if(!host||!r)return;
  if(!control?.excluido)button(host,'Editar',()=>{
   const editable=!!r.fechamento_id&&!r.contratado_em&&r.cliente_resposta!=='confirmado'&&r.status!=='confirmado'&&!['pendente','paga'].includes(r.cobranca_status);
   const d=dialog('Editar negociação','<p>'+esc(r.cliente)+' · '+esc(r.profissional)+'</p><form class="stack">'+
    (editable?'<label>Orçamento (R$)<input class="input" type="number" name="valor" min="0.01" max="1000000" step="0.01" value="'+(r.valor_informado_centavos==null?'':(Number(r.valor_informado_centavos)/100).toFixed(2))+'"></label>':'<p>Para revisar contratação, conclusão ou cobrança, abra o pedido ou a comissão.</p>')+
    '<label>Observação administrativa<textarea class="input" name="observacao" maxlength="2000" rows="4">'+esc(control?.observacao||'')+'</textarea></label><button type="submit" class="btn btn--primary">Salvar alterações</button></form><a class="btn btn--outline" href="#/admin/servicos/'+esc(r.chamado_id)+'" data-order>Editar dados do pedido</a>'+
    (r.fechamento_id?'<a class="btn btn--outline" href="#/admin/comissao13" data-order>Revisar comissão e fechamento</a>':''));
   d.querySelectorAll('[data-order]').forEach(a=>a.onclick=()=>d.close());
   d.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.target,b=f.querySelector('button');b.disabled=true;
    try{const dados={observacao:f.elements.observacao.value.trim()};const v=f.elements.valor;
     if(v&&v.value!==''&&Math.round(Number(v.value)*100)!==r.valor_informado_centavos)dados.valor_centavos=Math.round(Number(v.value)*100);
     const result=await rpc('qf_admin_lista_controle',{p_tipo:'negociacao',p_chave:r.desbloqueio_id,p_dados:dados});if(!result?.ok)throw Error('O banco não confirmou a edição.');d.close();await done();
    }catch(err){d.querySelector('[role=alert]').textContent=err.message;b.disabled=false;}
   };
  });
  button(host,control?.excluido?'Restaurar':'Excluir da lista',()=>remove('negociacao',r.desbloqueio_id,control,done));
 }
 function cadastroActions(host,r,control,done){
  if(!host||!r?.email)return;
  if(r.profissional_id){const a=g.document.createElement('a');a.className='btn btn--outline';a.href='#/admin/profissionais/'+encodeURIComponent(r.profissional_id);a.textContent='Editar cadastro';host.append(a);}
  button(host,control?.excluido?'Restaurar':'Excluir da lista',()=>remove('cadastro',r.email,control,done));
 }
 function balanceHtml(d){
  const card=(label,value)=>'<div class="qfo-stat"><small>'+label+'</small><strong>'+money(value)+'</strong></div>';
  return '<h2>Balanço do período</h2><p>Atualizado em '+esc(date(d.gerado_em))+' · dados do banco</p><div class="qfo-stats">'+card('Entradas confirmadas',d.entradas_centavos)+card('Saídas registradas',d.saidas_centavos)+card('Resultado do período',d.saldo_periodo_centavos)+card('Planos pagos',d.planos_centavos)+'</div>'+
   '<p>'+Number(d.fechamentos||0)+' contratações no período · Comissões pendentes de todos os períodos: '+money(d.comissoes_pendentes_centavos)+'</p>'+
   '<p class="text--sm">Resultado dos registros da plataforma. Não é o saldo bancário: despesas externas, tarifas e estornos ainda não registrados exigem conciliação. Bônus, testes e consumo de créditos não somam novamente nas entradas.</p><div class="btn-row"><a class="btn btn--outline" href="#/admin/financeiro">Financeiro e repasses</a><a class="btn btn--outline" href="#/admin/negociacoes">Negociações e fechamentos</a><a class="btn btn--outline" href="#/admin/planos">Gerenciar planos</a></div>'+
   '<details><summary>Ver entradas e saídas ('+Number(d.eventos_total||0)+')</summary><div style="overflow:auto"><table><thead><tr><th>Quando</th><th>Tipo</th><th>Entrada</th><th>Saída</th><th>Ação</th></tr></thead><tbody>'+(d.eventos||[]).map(e=>'<tr><td>'+esc(date(e.em))+'</td><td>'+esc(e.tipo)+'</td><td>'+money(e.entrada)+'</td><td>'+money(e.saida)+'</td><td><a href="#'+esc(e.rota)+'">Ver detalhes</a></td></tr>').join('')+'</tbody></table></div><p>Até 100 registros mais recentes. Os totais consideram o período completo.</p></details>';
 }
 function install(){
  if(!g.Screens)return;
  const style=g.document.createElement('style');style.textContent='.qfo-dialog{width:min(560px,calc(100vw - 24px));max-height:90dvh;overflow:auto;border:1px solid #ccd8e6;border-radius:18px;padding:24px;color:#17324d}.qfo-dialog::backdrop{background:#0b274477}.qfo-dialog .stack,.qfo-dialog label{display:grid;gap:10px}.qfo-dialog .btn{margin:6px 4px 0 0;min-height:44px;width:auto}.qfo-balance{display:grid;gap:14px;padding:22px;background:#fff;border:1px solid #dbe4ee;border-radius:20px;margin-bottom:20px}.qfo-balance h2,.qfo-balance p{margin:0}.qfo-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.qfo-stat{padding:16px;background:#f3f7fd;border-radius:12px}.qfo-stat strong{display:block;font-size:23px;color:#1458cc}.qfo-balance td,.qfo-balance th{padding:10px;text-align:left;border-bottom:1px solid #eee}.qfo-balance summary{cursor:pointer;font-weight:700}@media(max-width:700px){.qfo-stats{grid-template-columns:1fr 1fr}.qfo-stat strong{font-size:18px}.qfo-balance{padding:14px}}';g.document.head.append(style);
  const previous=g.Screens.afterRender;
  function enhance(pattern,content){if(!['/admin/dashboard','/admin/movimentacoes'].includes(pattern)||content.querySelector('[data-qfo-balanco]')||!g.QFAdminCloud?.client)return;
   const host=g.document.createElement('section');host.dataset.qfoBalanco='';host.className='qfo-balance';host.innerHTML='<h2>Balanço do período</h2><p role="status">Consultando dados…</p>';(content.querySelector('.view')||content).prepend(host);
   let busy=false;let selected=1;
   async function refresh(){if(busy||!host.isConnected)return;busy=true;const days=selected;try{const d=await rpc('qf_admin_balanco',{p_dias:days});if(!d?.ok)throw Error('Balanço indisponível');if(!host.isConnected||days!==selected)return;
    const expanded=host.querySelector('details')?.open;
    host.innerHTML='<div class="btn-row">'+[[1,'Hoje'],[7,'7 dias'],[30,'30 dias']].map(([n,label])=>'<button type="button" class="btn btn--outline" data-qfo-days="'+n+'" aria-pressed="'+(selected===n)+'">'+label+'</button>').join('')+'<button type="button" class="btn btn--outline" data-qfo-refresh>Atualizar</button></div>'+balanceHtml(d);
    if(expanded)host.querySelector('details').open=true;
    host.querySelectorAll('[data-qfo-days]').forEach(b=>b.onclick=()=>{selected=Number(b.dataset.qfoDays);refresh();});host.querySelector('[data-qfo-refresh]').onclick=refresh;
   }catch(e){if(host.isConnected){host.innerHTML='<h2>Balanço do período</h2><p role="alert">Não foi possível atualizar: '+esc(e.message)+'</p>';button(host,'Tentar novamente',refresh);}}finally{busy=false;if(days!==selected)refresh();}}
   refresh();const timer=g.setInterval(()=>{if(!host.isConnected){g.clearInterval(timer);return;}if(!g.document.hidden&&!g.document.querySelector('.qfo-dialog[open]'))refresh();},10000);
  }
  g.Screens.afterRender=function(){if(previous)previous.apply(this,arguments);enhance.apply(this,arguments);};
  const content=g.document.getElementById('app-content');if(content)enhance((g.location.hash||'').replace(/^#/,''),content);
 }
 g.QFAdminOrganizacao={negotiationActions,cadastroActions,balanceHtml};
 if(typeof module!=='undefined')module.exports=g.QFAdminOrganizacao;
 if(g.document){if(g.document.readyState==='loading')g.document.addEventListener('DOMContentLoaded',install,{once:true});else install();}
})(typeof window!=='undefined'?window:globalThis);

