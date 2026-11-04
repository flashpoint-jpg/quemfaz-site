/* Visão geral: consultas administrativas existentes, sem alterar regras financeiras. */
(function(g){
'use strict';
function install(){
 const S=g.Screens;if(!S||S._qfd)return;S._qfd=true;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>(Number(v)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const link=(route,label)=>'<a href="#'+route+'">'+label+'<span aria-hidden="true">›</span></a>';
 const previous=S.afterRender;
 S.afterRender=function(pattern,content){
  if(previous)previous.apply(this,arguments);
  if(!['/admin/dashboard','/admin/mais'].includes(pattern)||content.querySelector('[data-qfd]'))return;
  const view=content.querySelector('.view')||content;
  const root=g.document.createElement('section');root.dataset.qfd='';root.className='qfd';
  root.innerHTML='<div class="qfd-toolbar"><p>Acompanhe a operação em um só lugar</p><div class="qfd-period" role="group" aria-label="Período dos pedidos e entradas">'+[[1,'Hoje'],[7,'7 dias'],[30,'30 dias']].map(([n,t])=>'<button type="button" data-qfd-days="'+n+'" aria-pressed="'+(n===1)+'">'+t+'</button>').join('')+'<button type="button" data-qfd-refresh>↻ Atualizar</button></div></div><p class="qfd-status" role="status" data-qfd-status>Consultando indicadores…</p><div class="qfd-stats">'+[['published','Pedidos publicados','No período selecionado'],['locked','Pedidos sem desbloqueio','Abertos ou em negociação agora'],['online','Profissionais online','Disponíveis agora'],['paid','Entradas confirmadas','No período selecionado']].map(([key,title,hint])=>'<article><span>'+title+'</span><strong data-qfd-stat="'+key+'">—</strong><small>'+hint+'</small></article>').join('')+'</div><section class="qfd-attention"><h2>Precisa da sua atenção</h2><div><span>Pedidos sem profissional</span>'+link('/admin/sem-profissional','Ver pedidos')+'</div><div><span>Cadastros e pagamentos pendentes</span>'+link('/admin/profissionais','Ver cadastros')+'</div><div><span>Profissionais sem notificação</span>'+link('/admin/sem-push','Verificar')+'</div></section><div class="qfd-columns"><div data-qfd-balance></div><section class="qfd-quick"><h2>Acesso rápido</h2>'+link('/admin/servicos','Todos os pedidos')+link('/admin/profissionais','Profissionais')+link('/admin/planos','Planos e pagamentos')+link('/admin/movimentacoes','Movimentações')+'</section></div><div data-qfd-details></div>';
  const details=root.querySelector('[data-qfd-details]');
  function fold(node,title){if(!node||!node.isConnected)return;const d=g.document.createElement('details');d.className='qfd-fold';const summary=g.document.createElement('summary');summary.textContent=title;d.append(summary);d.append(node);details.append(d);}
  const balance=content.querySelector('[data-qfo-balanco]');
  if(balance)root.querySelector('[data-qfd-balance]').append(balance);
  fold(content.querySelector('[data-commercial-report]')?.parentElement,'Notificações, publicações e distribuição');
  fold(content.querySelector('[data-qf-funnel-report]')?.parentElement,'Captação e origem dos clientes');
  fold(content.querySelector('[data-qfn]'),'Orçamentos e negociações');
  fold(content.querySelector('[data-qff]'),'Solicitações de repasse Pix');
  view.prepend(root);
  let selected=1,version=0;
  const rpc=async(name,args)=>{const r=await g.QFAdminCloud.client.rpc(name,args);if(r.error||!r.data||r.data.ok===false)throw Error('Consulta indisponível');return r.data;};
  function startOfPeriod(days){const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});return Date.parse(today+'T00:00:00-03:00')-(days-1)*86400000;}
  async function refresh(){
   const token=++version,days=selected;root.setAttribute('aria-busy','true');const status=root.querySelector('[data-qfd-status]');status.textContent='Atualizando indicadores…';
   root.querySelectorAll('[data-qfd-stat]').forEach(e=>e.textContent='—');
   const results=await Promise.allSettled([rpc('qf_admin_snapshot'),rpc('qf_admin_funil_comercial'),rpc('qf_admin_balanco',{p_dias:days})]);
   if(!root.isConnected||token!==version)return;
   const value=(key,v)=>{root.querySelector('[data-qfd-stat="'+key+'"]').textContent=String(v);};
   const [snapshot,commercial,balanceResult]=results;
   if(snapshot.status==='fulfilled'){
    const d=snapshot.value;
    if(Array.isArray(d.chamados))value('published',d.chamados.filter(c=>Date.parse(c.criado_em)>=startOfPeriod(days)&&Date.parse(c.criado_em)<=Date.now()).length);
    if(Array.isArray(d.profissionais))value('online',d.profissionais.filter(p=>p.online&&!p.bloqueado).length);
   }
   if(commercial.status==='fulfilled')value('locked',Number(commercial.value.pedidos_ativos?.['0']||0));
   if(balanceResult.status==='fulfilled'&&balanceResult.value.entradas_centavos!=null)value('paid',money(balanceResult.value.entradas_centavos));
   const failed=results.some(r=>r.status==='rejected');status.textContent=(failed?'Alguns indicadores estão indisponíveis. Use Atualizar para tentar novamente.':'Atualizado às '+new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}))+' · Online e sem desbloqueio mostram a situação atual.';
   root.removeAttribute('aria-busy');
  }
  root.querySelectorAll('[data-qfd-days]').forEach(b=>b.onclick=()=>{selected=Number(b.dataset.qfdDays);root.querySelectorAll('[data-qfd-days]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));refresh();});
  root.querySelector('[data-qfd-refresh]').onclick=refresh;
  refresh();
 };
}
if(g.document.readyState==='loading')g.document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
