/* Livro de Pix integral: somente liquidações bancárias compõem entradas e obrigações. */
(function(g){
 'use strict';
 if(g.document){const style=g.document.createElement('style');style.textContent='[data-qf-manual-config] .btn-row,[data-qf-pix-ledger] .btn-row,.qf-md .btn-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}[data-qf-manual-config] .btn,[data-qf-pix-ledger] .btn,.qf-md .btn{height:auto!important;min-height:46px;white-space:normal;line-height:1.4;padding:12px!important;width:100%!important}@media(max-width:600px){[data-qf-manual-config] .btn-row,[data-qf-pix-ledger] .btn-row,.qf-md .btn-row{grid-template-columns:1fr}}';g.document.head.append(style);}
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>(Number(v||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const date=v=>v?new Date(v).toLocaleString('pt-BR'):'—';
 const reconciled=r=>['pago','repassado'].includes(r.status)&&!!r.end_to_end_id&&!!r.confirmado_em;
 function totals(rows){
  const out={emitidos:rows.length,aguardando:0,recebidos:0,comissao:0,obrigacao:0,repassados:0,analise:0};
  for(const r of rows){
   if(['criando','pix_pronto'].includes(r.status))out.aguardando++;
   if(reconciled(r)){out.recebidos+=Number(r.valor_centavos);out.comissao+=Number(r.comissao_centavos);
    if(r.status==='repassado'&&r.repassado_em&&r.repasse_referencia&&r.repasse_comprovante)out.repassados+=Number(r.profissional_centavos);
    else out.obrigacao+=Number(r.profissional_centavos);
   }else if(r.status==='bloqueado')out.analise++;
  }return out;
 }
 const fields=['id','chamado_id','profissional','txid','end_to_end_id','valor_centavos','comissao_centavos','profissional_centavos','criado_em','confirmado_em','status','repassado_em','repasse_referencia','repasse_comprovante'];
 function csv(rows){
  const cell=x=>'"'+String(x??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
  return '\ufeff'+[fields,...rows.map(r=>fields.map(f=>r[f]))].map(r=>r.map(cell).join(';')).join('\r\n');
 }
 function mount(view,c){
  if(view.querySelector('[data-qf-pix-ledger]'))return;
  const box=g.document.createElement('section');box.dataset.qfPixLedger='';box.className='card stack--sm';
  box.style.cssText='padding:16px;border:2px solid #1458cc;border-radius:16px;background:#f8fbff;min-width:0;margin:0 0 16px';view.append(box);
  let rows=[],search='',status='todos',from='',until='',loading=false;
  const rpc=async(n,a={})=>{const r=await c.rpc(n,a);if(r.error)throw Error(r.error.message);return r.data;};
  function filtered(){return rows.filter(r=>(status==='todos'||r.status===status)&&(!from||String(r.criado_em)>=from)&&(!until||String(r.criado_em).slice(0,10)<=until)&&JSON.stringify([r.profissional,r.chamado_id,r.txid,r.end_to_end_id]).toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));}
  function render(){
   const current=filtered(),t=totals(current);
   box.innerHTML='<h2 class="h3">Pagamentos dos serviços (Plano Livre)</h2><p>Pix integral do cliente, comissão de 13% e repasse manual de 87%. Assinaturas e Marketing Dedicado são contabilizados separadamente.</p><p><strong>Repasse pendente é uma obrigação com o profissional.</strong> Não é lucro nem saldo livre da empresa.</p>'+
    '<div class="qff-cards">'+[['Pix emitidos',t.emitidos],['Aguardando pagamento',t.aguardando],['Recebidos conciliados',money(t.recebidos)],['Comissão 13% conciliada',money(t.comissao)],['Obrigação · 87% a repassar',money(t.obrigacao)],['87% repassados',money(t.repassados)],['Bloqueados / em análise',t.analise]].map(([label,v])=>'<div class="qff-card">'+label+'<strong>'+esc(v)+'</strong></div>').join('')+'</div>'+
    '<div class="qff-controls"><label>Profissional, pedido ou transação<input class="input" type="search" data-pix-search value="'+esc(search)+'"></label><label>Situação<select class="input" data-pix-status>'+[['todos','Todas'],['criando','Preparando cobrança'],['pix_pronto','Aguardando Pix'],['pago','Conciliado · a repassar'],['repassado','Repassado'],['bloqueado','Em análise']].map(([k,v])=>'<option value="'+k+'"'+(status===k?' selected':'')+'>'+v+'</option>').join('')+'</select></label><label>De<input class="input" type="date" data-pix-from value="'+esc(from)+'"></label><label>Até<input class="input" type="date" data-pix-until value="'+esc(until)+'"></label></div>'+
    '<div class="btn-row"><button class="btn btn--primary" data-pix-sync>Conferir Pix na Efí</button><button class="btn btn--outline" data-pix-export>Exportar CSV</button><button class="btn btn--outline" data-pix-refresh>Atualizar histórico</button></div><p role="status" data-pix-feedback></p>'+
    (current.length?'<div class="qff-scroll"><table><thead><tr>'+['Pedido / profissional','Transação bancária','Valores','Datas / situação','Repasse / auditoria'].map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+current.map(r=>'<tr data-pix-row="'+esc(r.id)+'"><td>'+esc(r.chamado_id)+'<br>'+esc(r.profissional)+'</td><td>txid: '+esc(r.txid)+'<br>E2E: '+esc(r.end_to_end_id||'Ainda não liquidado')+'</td><td>Bruto: '+money(r.valor_centavos)+'<br>13%: '+money(r.comissao_centavos)+'<br>87%: '+money(r.profissional_centavos)+'</td><td>Emitido: '+date(r.criado_em)+'<br>Liquidado: '+date(r.confirmado_em)+'<br>'+esc(r.status)+'</td><td>'+(!reconciled(r)?'Sem liberação bancária':r.status==='repassado'?'Repassado em '+date(r.repassado_em)+'<br>Referência: '+esc(r.repasse_referencia)+'<br>Comprovante: '+esc(r.repasse_comprovante):'<form data-pix-transfer><label>Referência bancária<input class="input" name="referencia" minlength="16" maxlength="150" required></label><label>Referência do comprovante<input class="input" name="comprovante" minlength="8" maxlength="500" required></label><p>Chave Pix: '+esc(r.pix_chave||'Não cadastrada')+'</p><label style="display:flex;gap:8px"><input type="checkbox" name="confirmado" required> Já fiz e conferi a transferência no banco</label><button class="btn btn--primary" type="submit">Registrar repasse</button><p role="status"></p></form>')+'<details><summary>Histórico de alterações</summary>'+(r.eventos||[]).map(e=>'<p>'+date(e.criado_em)+' · '+esc(e.tipo)+' · Operador: '+esc(e.ator||'Servidor bancário')+'</p>').join('')+'</details></td></tr>').join('')+'</tbody></table></div>':'<p role="status">Nenhum Pix de serviço neste filtro. Não há valores bancários a presumir.</p>');
   for(const [selector,key] of [['[data-pix-status]','status'],['[data-pix-from]','from'],['[data-pix-until]','until']])box.querySelector(selector).onchange=e=>{if(key==='status')status=e.target.value;else if(key==='from')from=e.target.value;else until=e.target.value;render();};
   box.querySelector('[data-pix-search]').oninput=e=>{search=e.target.value;const pos=e.target.selectionStart;render();const input=box.querySelector('[data-pix-search]');input.focus();input.setSelectionRange(pos,pos);};
   box.querySelector('[data-pix-refresh]').onclick=load;
   box.querySelector('[data-pix-export]').onclick=()=>{const url=URL.createObjectURL(new Blob([csv(current)],{type:'text/csv;charset=utf-8'}));const a=g.document.createElement('a');a.href=url;a.download='pagamentos-servicos-livre.csv';a.click();g.setTimeout(()=>URL.revokeObjectURL(url),1000);};
   box.querySelector('[data-pix-sync]').onclick=async e=>{e.target.disabled=true;const msg=box.querySelector('[data-pix-feedback]');msg.textContent='Consultando o banco…';try{const r=await c.functions.invoke('quemfaz-livre-pix-manual',{body:{action:'sync_admin'}});if(r.error||!r.data?.ok)throw Error('A Efí não confirmou a consulta. Nenhum pagamento foi marcado manualmente.');await load();box.querySelector('[data-pix-feedback]').textContent=Number(r.data.consultados||0)+' consultados · '+Number(r.data.confirmados||0)+' confirmados · '+Number(r.data.erros||0)+' falhas.';}catch(ex){msg.textContent=ex.message;e.target.disabled=false;}};
   box.querySelectorAll('[data-pix-transfer]').forEach(form=>form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;const msg=form.querySelector('[role=status]'),b=form.querySelector('button');b.disabled=true;try{const result=await rpc('qf_livre_manual_pix_repassar',{p_id:form.closest('[data-pix-row]').dataset.pixRow,p_referencia:form.elements.referencia.value.trim(),p_comprovante:form.elements.comprovante.value.trim()});if(!result?.ok)throw Error(result?.reason||'Repasse não autorizado');await load();}catch(ex){msg.textContent=ex.message;b.disabled=false;}});
  }
  async function load(){if(loading)return;loading=true;try{const data=await rpc('qf_livre_manual_pix_admin_ledger');if(!Array.isArray(data))throw Error('Histórico indisponível');if(!box.isConnected)return;rows=data;render();}catch(ex){box.innerHTML='<h2 class="h3">Pagamentos dos serviços (Plano Livre)</h2><p role="status">'+esc(ex.message)+'</p><button class="btn btn--outline" data-pix-retry>Tentar novamente</button>';box.querySelector('button').onclick=load;}finally{loading=false;}}
  load();
 }
 g.QFPixFinanceiro={mount,totals,csv,reconciled};if(typeof module!=='undefined')module.exports=g.QFPixFinanceiro;
})(typeof window!=='undefined'?window:globalThis);

