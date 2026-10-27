/* Real negotiations, with forecasts separate from bank-confirmed receipts. */
(function(g){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>(Number(v||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const date=v=>v?new Date(v).toLocaleString('pt-BR'):'Não registrado';
 const elapsed=v=>{const n=Date.parse(v);if(!Number.isFinite(n))return 'Sem data';const h=Math.max(0,Math.floor((Date.now()-n)/3600000));return h<1?'menos de 1 h':h<24?h+' h':Math.floor(h/24)+' d '+h%24+' h';};
 const active=r=>!['cancelado','expirado'].includes(r.pedido_status)&&r.ativo!==false&&!['recusado','contestado'].includes(r.status)&&!['nao_contratou','divergencia'].includes(r.cliente_resposta);
 function state(r){
  if(r.cobranca_status==='paga')return r.pagamento_conciliado?'Comissão paga e conciliada':'Marcada paga · conciliação não comprovada';
  if(r.status==='confirmado')return r.cliente_concluiu_em?'Concluído':'Comissão confirmada · conferir evidência';
  if(['cancelado','expirado'].includes(r.pedido_status))return 'Pedido '+r.pedido_status+' · conferir negociação';
  if(r.cliente_resposta==='nao_contratou')return 'Recusado pelo cliente';
  if(r.cliente_resposta==='divergencia'||r.status==='contestado')return 'Divergência';
  if(r.contratado_em||r.cliente_resposta==='confirmado')return 'Contratado · aguardando conclusão';
  if(r.status==='recusado')return 'Profissional informou não fechado';
  if(r.cliente_resposta==='negociando')return 'Cliente ainda negociando';
  return r.valor_informado_centavos!=null?'Orçamento · aguardando cliente':'Desbloqueado · sem orçamento registrado';
 }
 function totals(rows,now=Date.now()){
  const t={abertas:0,orcamentos:0,aguardando:0,aceitos:0,contratados:0,concluidos:0,previsao_orcamento:0,previsao_contratacao:0,receber:0,vencida:0,paga:0};
  rows.forEach(r=>{
   const live=active(r),accepted=!!(r.contratado_em||r.cliente_resposta==='confirmado');
   if(live&&r.status!=='confirmado')t.abertas++;
   if(r.valor_informado_centavos!=null)t.orcamentos++;
   if(live&&r.valor_informado_centavos!=null&&!r.cliente_resposta)t.aguardando++;
   if(accepted){t.aceitos++;t.contratados++;}
   if(r.cliente_concluiu_em)t.concluidos++;
   if(r.origem==='comissao13'&&live&&r.status!=='confirmado'){
    const value=accepted?r.valor_aceito_centavos??r.valor_informado_centavos:r.valor_informado_centavos;
    if(value!=null)t[accepted?'previsao_contratacao':'previsao_orcamento']+=Math.round(Number(value)*.13);
   }
   if(r.status==='confirmado'&&r.comissao_centavos!=null){
    if(r.cobranca_status==='paga'&&r.pagamento_conciliado)t.paga+=Number(r.comissao_centavos);
    if(r.cobranca_status==='pendente'){
     t.receber+=Number(r.comissao_centavos);
     if(r.comissao_vence_em&&Date.parse(r.comissao_vence_em)<=now)t.vencida+=Number(r.comissao_centavos);
    }
   }
  });return t;
 }
 function kpis(rows){const t=totals(rows);return '<div class="qfn-kpis">'+[['abertas','Negociações abertas'],['orcamentos','Orçamentos apresentados'],['aguardando','Aguardando resposta'],['aceitos','Orçamentos aceitos'],['contratados','Serviços contratados'],['concluidos','Conclusões confirmadas'],['previsao_orcamento','Prevista · orçamento'],['previsao_contratacao','Prevista · contratação'],['receber','Confirmadas a receber'],['vencida','Vencidas (incluídas a receber)'],['paga','Pagas e conciliadas']].map(([key,label])=>'<div><small>'+label+'</small><strong>'+esc(key.startsWith('previsao')||['receber','vencida','paga'].includes(key)?money(t[key]):t[key])+'</strong></div>').join('')+'</div><p class="text--sm">Previsões não são receitas. Pedidos cancelados e recusas ficam no histórico, fora das previsões ativas. Contatos externos não comprovam conversa ou contratação.</p>';}
 function row(r){const value=r.valor_confirmado_centavos??r.valor_aceito_centavos??r.valor_informado_centavos;return '<tr><td><strong>'+esc(r.profissional||r.profissional_id)+'</strong><small>'+esc(r.profissional_id)+'</small></td><td>'+esc(r.cliente)+'<small>#'+esc(r.chamado_id)+'</small></td><td>'+esc((r.categoria||'').replace(/^cat_/,'').replace(/_/g,' '))+'<details><summary>Descrição completa</summary>'+esc(r.descricao)+'</details></td><td>'+esc(r.cidade)+'<small>'+esc(r.bairro)+'</small></td><td>'+esc(value==null?'Não informado':money(value))+'<small>'+esc(r.origem==='comissao13'&&value!=null?'13% previstos: '+money(Math.round(Number(value)*.13)):'Avulso · sem comissão do Livre')+'</small></td><td>'+esc(state(r))+'</td><td>'+esc(r.ultima_mensagem?.remetente||'Sem mensagem interna')+'<small>'+esc(date(r.ultima_mensagem?.criado_em))+'</small></td><td>'+esc(r.cliente_respondeu_em?'Resposta registrada':Number(r.mensagens_cliente)>0?'Mensagem do cliente; sem decisão':'Aguardando')+'</td><td><button class="btn btn--outline btn--sm" data-qfn-open="'+esc(r.desbloqueio_id)+'">Abrir detalhes</button></td></tr>';}
 function graph(rows){const counts={};rows.forEach(r=>{const k=state(r);counts[k]=(counts[k]||0)+1;});const max=Math.max(1,...Object.values(counts));return '<details><summary>Desempenho das negociações</summary>'+Object.entries(counts).map(([label,n])=>'<div class="qfn-chart"><span>'+esc(label)+' · '+n+'</span><progress max="'+max+'" value="'+n+'">'+n+'</progress></div>').join('')+'</details>';}
 function financial(r){const value=r.valor_confirmado_centavos??r.valor_aceito_centavos??r.valor_informado_centavos;return '<h3>Valores e comissão</h3><p>'+esc(state(r))+' · cobrança: '+esc(r.cobranca_status||'Não aplicável')+'</p>'+(value==null?'<p>Valor não informado.</p>':'<div class="qfn-split" aria-label="87% profissional e 13% Quem Faz"><span>87% profissional</span><span>13% Quem Faz</span></div><p>Serviço: <strong>'+money(value)+'</strong> · 87% profissional: '+money(Number(value)-Math.round(Number(value)*.13))+' · 13% '+(r.status==='confirmado'?'confirmados':'potenciais')+': '+money(Math.round(Number(value)*.13))+'</p>')+'<p>Orçamento: '+(r.valor_informado_centavos==null?'Não informado':money(r.valor_informado_centavos))+' · Aceito: '+(r.valor_aceito_centavos==null?'Não registrado':money(r.valor_aceito_centavos))+'</p><p>Contratação: '+esc(date(r.contratado_em))+' · Conclusão: '+esc(date(r.cliente_concluiu_em))+' · Confirmação financeira: '+esc(date(r.confirmado_em))+'</p><p>Prestação de contas: '+esc(date(r.prazo_contas))+' · Vencimento da comissão: '+esc(date(r.comissao_vence_em))+' · Pagamento: '+esc(date(r.comissao_paga_em))+'</p><p>Restrição do profissional: '+esc(({comissao_pendente:'Comissão confirmada vencida',prestacao_contas_vencida:'Prestação de contas vencida'})[r.restricao_profissional]||r.restricao_profissional||'Nenhuma registrada')+'. O cliente continua com acesso ao pedido.</p>';}
 function install(){if(!g.Screens||g.Screens._qfn)return;g.Screens._qfn=true;
  const style=g.document.createElement('style');style.textContent='.qfn{display:grid;gap:16px;min-width:0;overflow-wrap:anywhere}.qfn-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px}.qfn-kpis>div{background:white;border:1px solid #dbe4ee;border-radius:16px;padding:16px}.qfn-kpis strong{display:block;font-size:23px;color:#1356a3}.qfn small{display:block;color:#596a7e}.qfn-table{overflow-x:auto}.qfn table{width:100%;border-collapse:collapse;font-size:13px}.qfn td,.qfn th{padding:12px;text-align:left;vertical-align:top;border-bottom:1px solid #e2e8f0;min-width:130px}.qfn td small{max-width:210px;overflow-wrap:anywhere}.qfn-alert{padding:14px;border:1px solid #f5b25e;border-radius:14px;background:#fff8ef;margin-bottom:10px}.qfn-detail{border:1px solid #bfd3ed;border-radius:16px;background:#fff;padding:18px}.qfn-message{white-space:pre-wrap;border-bottom:1px solid #e0e8f0;padding:12px 0}.qfn-split{display:flex;border-radius:10px;overflow:hidden;color:#fff;font-size:12px;font-weight:700}.qfn-split span:first-child{width:87%;background:#1458cc;padding:12px}.qfn-split span:last-child{width:13%;min-width:80px;background:#db7700;padding:12px}.qfn-chart{display:grid;gap:6px;margin:10px 0}.qfn progress{width:100%;accent-color:#1458cc}.qfn .btn{width:auto;white-space:normal;height:auto;min-height:42px}.qf-adm-side{background:#0b2744!important;color:white}.qf-adm-side .qf-adm-nav__item{color:#e5edf7}.qf-adm-side .qf-adm-nav__item:hover{background:#193e62}.qf-adm-side .qf-adm-nav__secao{color:#a8c2df}@media(max-width:500px){.qfn-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.qfn-kpis>div{padding:12px}.qfn-kpis strong{font-size:19px}.qfn-detail{padding:12px}}';g.document.head.appendChild(style);
  const prev=g.Screens.afterRender;
  async function enhance(pattern,content){
   if(!['/admin/dashboard','/admin/negociacoes'].includes(pattern)||content.querySelector('[data-qfn]'))return;
   const client=g.QFAdminCloud?.client;if(!client)return;
   const root=g.document.createElement('section');root.className='section qfn';root.dataset.qfn='';(content.querySelector('.view')||content).prepend(root);
   let rows=[],page=0,query='',busy=false,detailId=null;
   async function rpc(name,args={}){const r=await client.rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;}
   const error=e=>{let box=root.querySelector('[data-qfn-status]');if(!box){box=g.document.createElement('p');box.dataset.qfnStatus='';box.setAttribute('role','status');root.prepend(box);}box.textContent='Não foi possível atualizar: '+e.message;};
   async function open(id){
    const r=rows.find(x=>x.desbloqueio_id===id);if(!r)return;
    const panel=root.querySelector('[data-qfn-detail]');panel.innerHTML='<p role="status">Carregando detalhe protegido…</p>';detailId=id;
    try{const d=await rpc('qf_admin_negociacao_detalhe',{p_desbloqueio:id});if(!d?.ok)throw Error('Detalhe indisponível');if(detailId!==id||!root.isConnected)return;
     panel.innerHTML='<article class="qfn-detail"><button class="btn btn--outline" data-qfn-close>Fechar detalhes</button><h2>'+esc(r.profissional)+' · '+esc(r.cliente)+'</h2><p>Profissional: '+esc(r.profissional_id)+' · Pedido: '+esc(r.chamado_id)+'</p><p>'+esc(r.descricao)+'</p><p>'+esc(r.cidade)+' · '+esc(r.bairro)+' · Pedido '+esc(r.pedido_status)+'</p>'+financial(r)+'<h3>Contato e resposta</h3><p>Última atividade há '+esc(elapsed(r.ultima_atividade))+' · Última mensagem: '+esc(r.ultima_mensagem?.remetente||'Não registrada')+' em '+esc(date(r.ultima_mensagem?.criado_em))+'</p><div data-qfn-reminder></div><h3>Conversa interna</h3>'+(d.mensagens||[]).map(m=>'<div class="qfn-message"><strong>'+esc(m.remetente||m.remetente_id)+'</strong><small>'+esc(date(m.criado_em))+' · '+(m.lida_em?'Leitura registrada em '+esc(date(m.lida_em)):'Sem leitura registrada')+'</small>'+esc(m.mensagem)+'</div>').join('')+(!(d.mensagens||[]).length?'<p>Sem mensagens internas. Conversas externas não são verificáveis pelo sistema.</p>':'')+ '<h3>Distribuição do pedido e notificações</h3><p class="text--sm">Envio aceito pelo serviço de push não comprova exibição nem leitura no aparelho.</p>'+(d.recebimentos||[]).map(x=>'<p>'+esc(x.profissional||x.profissional_id)+' · '+esc(x.evento)+' · '+esc(x.envio_status)+' · '+esc(date(x.enviado_em||x.criado_em))+(x.erro?' · '+esc(x.erro):'')+'</p>').join('')+'<h3>Histórico do pedido</h3>'+(d.historico_pedido||[]).map(x=>'<p>'+esc(date(x.criado_em))+' · '+esc(x.de)+' → '+esc(x.para)+'</p>').join('')+'<h3>Referências financeiras</h3>'+(d.pagamentos||[]).map(p=>'<p>'+esc(p.status)+' · '+money(p.valor_centavos)+' · Txid: '+esc(p.txid||'Não emitido')+' · EndToEnd: '+esc(p.end_to_end_id||'Sem conciliação')+' · Pago em: '+esc(date(p.pago_em))+'</p>').join('')+'<details><summary>Histórico de auditoria ('+(d.auditoria||[]).length+')</summary>'+(d.auditoria||[]).map(a=>'<p>'+esc(date(a.criado_em))+' · '+esc(a.ator||'Acesso protegido do cliente / sistema')+'</p><pre style="white-space:pre-wrap">'+esc(JSON.stringify({antes:a.antes,depois:a.depois},null,2))+'</pre>').join('')+'</details><a class="btn btn--outline" href="#/admin/servicos/'+esc(r.chamado_id)+'">Abrir pedido</a>'+(r.fechamento_id?'<a class="btn btn--outline" href="#/admin/comissao13">Revisão financeira existente</a>':'')+'</article>';
     panel.querySelector('[data-qfn-close]').onclick=()=>{panel.innerHTML='';detailId=null;};
     const target=panel.querySelector('[data-qfn-reminder]');let phone=String(d.telefone_suporte||'').replace(/\D/g,'');if(phone.length===10||phone.length===11)phone='55'+phone;
     if(d.contato_autorizado&&/^55\d{10,11}$/.test(phone)){
      const message='Olá! Aqui é do Quem Faz Serviços. Vimos que um profissional apresentou um orçamento para seu pedido. Você chegou a contratar o serviço ou ainda está avaliando? Acesse seu pedido no Quem Faz para atualizar a negociação. https://quemfazservico.com.br/?app=1';
      const a=g.document.createElement('a');a.className='btn btn--primary';a.textContent='Lembrar cliente';a.href='https://wa.me/'+phone+'?text='+encodeURIComponent(message);a.target='_blank';a.rel='noopener noreferrer';target.appendChild(a);
      target.insertAdjacentHTML('beforeend','<p class="text--sm">Abre o WhatsApp administrativo. Abrir não comprova envio, entrega ou resposta.</p>');
     }else target.textContent='Lembrete indisponível: falta telefone válido ou autorização de contato registrada.';
     panel.scrollIntoView?.({behavior:'smooth',block:'start'});
    }catch(e){panel.textContent='Não foi possível abrir: '+e.message;}
   }
   function render(){
    const dashboard=pattern==='/admin/dashboard';const attention=rows.filter(r=>r.valor_informado_centavos!=null&&r.status!=='confirmado'&&(!r.cliente_respondeu_em||r.ultima_mensagem?.remetente_id!==r.cliente_id||r.contratado_em&&Date.now()-Date.parse(r.ultima_atividade)>86400000));
    const filtered=rows.filter(r=>[r.profissional,r.cliente,r.chamado_id,r.categoria,state(r)].join(' ').toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));page=Math.min(page,Math.max(0,Math.ceil(filtered.length/12)-1));
    root.innerHTML='<h2>Negociações aguardando confirmação</h2>'+attention.slice(0,dashboard?5:8).map(r=>'<div class="qfn-alert"><strong>'+esc(r.profissional)+' · '+esc(r.categoria?.replace(/^cat_/,''))+'</strong><p>Cliente: '+esc(r.cliente)+' · Orçamento '+money(r.valor_informado_centavos)+' · Comissão potencial '+money(Math.round(Number(r.valor_informado_centavos)*.13))+' · Última atividade há '+esc(elapsed(r.ultima_atividade||r.proposta_chat_em||r.desbloqueado_em))+'</p><p>'+esc(state(r))+'</p><button class="btn btn--outline" data-qfn-open="'+esc(r.desbloqueio_id)+'">Abrir negociação</button></div>').join('')+(!attention.length?'<p>Nenhum orçamento aguardando primeira resposta.</p>':'')+'<h2>Orçamentos e negociações</h2>'+kpis(rows)+'<button class="btn btn--outline" data-qfn-refresh>Atualizar dados</button><p role="status" data-qfn-status>Atualização automática a cada 15 segundos enquanto esta tela está aberta.</p><div data-qfn-detail></div>'+(dashboard?'<a class="btn btn--primary" href="#/admin/negociacoes">Ver todas as negociações</a>':graph(rows)+'<label>Buscar profissional, cliente, pedido ou situação<input class="input" data-qfn-search value="'+esc(query)+'"></label><div class="qfn-table"><table><thead><tr>'+['Profissional','Cliente e pedido','Serviço','Localização','Valores','Situação','Última mensagem','Resposta do cliente','Ação'].map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+filtered.slice(page*12,page*12+12).map(row).join('')+'</tbody></table></div><p>'+filtered.length+' negociações · página '+(page+1)+'</p><div class="btn-row"><button class="btn btn--outline" data-qfn-page="-1" '+(!page?'disabled':'')+'>Anterior</button><button class="btn btn--outline" data-qfn-page="1" '+((page+1)*12>=filtered.length?'disabled':'')+'>Próxima</button></div>');
    root.querySelectorAll('[data-qfn-open]').forEach(b=>b.onclick=()=>open(b.dataset.qfnOpen));
    root.querySelector('[data-qfn-refresh]').onclick=()=>load(true);
    root.querySelectorAll('[data-qfn-page]').forEach(b=>b.onclick=()=>{page+=Number(b.dataset.qfnPage);render();});
    const search=root.querySelector('[data-qfn-search]');if(search)search.onchange=()=>{query=search.value;page=0;render();};
   }
   async function load(force=false){if(busy||!root.isConnected||(!force&&(detailId||root.contains(g.document.activeElement))))return;busy=true;try{rows=await rpc('qf_admin_negociacoes');if(!Array.isArray(rows))throw Error('Resposta inválida');if(root.isConnected){detailId=null;render();}}catch(e){error(e);}finally{busy=false;}}
   await load(true);const timer=g.setInterval(()=>{if(!root.isConnected){g.clearInterval(timer);return;}if(!g.document.hidden)load();},15000);
  }
  g.Screens.afterRender=function(){if(prev)prev.apply(this,arguments);enhance.apply(this,arguments);};
  const content=g.document.getElementById('app-content');if(content)enhance((g.location.hash||'').replace(/^#/,''),content);
 }
 g.QFAdminNegociacoes={totals,state,kpis,row};
 if(typeof module!=='undefined')module.exports=g.QFAdminNegociacoes;
 if(g.document){if(g.document.readyState==='loading')g.document.addEventListener('DOMContentLoaded',install,{once:true});else install();}
})(typeof window!=='undefined'?window:globalThis);
