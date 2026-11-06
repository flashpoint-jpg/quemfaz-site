/* Visão geral aprovada: somente leitura; mantém as rotas e regras administrativas. */
(function(g){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>(Number(v||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const when=v=>Date.parse(v)?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const today=v=>Date.parse(v)&&new Date(v).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})===new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
const ico=n=>g.icon?g.icon(n):'';
const link=(route,label,cls='qfd-link')=>'<a class="'+cls+'" href="#'+esc(route)+'">'+label+'</a>';
let timer,extraLinks=[];
function shell(pattern,content){
 g.document.body.classList.add('qfd-modern');
 const nav=g.document.querySelector('.qf-adm-nav');
 if(nav&&!nav.dataset.qfdMenu){
  nav.dataset.qfdMenu='1';
  const all=[...nav.querySelectorAll('[data-nav]')];
  extraLinks=all.map(b=>({route:b.dataset.nav,label:b.textContent.trim()}));
  const items=[['/admin/dashboard','Visão geral'],['/admin/servicos','Pedidos'],['/admin/profissionais','Profissionais'],['/admin/financeiro','Financeiro'],['/admin/suporte','Suporte'],['/admin/comunicados','Comunicados'],['/admin/configuracoes','Configurações']];
  nav.replaceChildren(...items.map(([route,label])=>{const b=all.find(x=>x.dataset.nav===route);if(!b)return g.document.createElement('span');b.querySelector('span').textContent=label;return b;}));
  const brand=g.document.querySelector('.qf-adm-site');if(brand){brand.className='qfd-brand';brand.innerHTML='Quem <span>Faz</span>';}
 }
 if(pattern==='/admin/configuracoes'&&!content.querySelector('[data-qfd-tools]')){
  const tools=g.document.createElement('section');tools.dataset.qfdTools='';tools.className='qfd-tools';tools.innerHTML='<h2>Todas as ferramentas do painel</h2><div>'+extraLinks.map(x=>link(x.route,esc(x.label))).join('')+link('/admin/mais','Visão detalhada e relatórios')+'</div>';content.append(tools);
 }
}
function install(){
 const S=g.Screens;if(!S||S._qfd)return;S._qfd=true;
 const previous=S.afterRender;
 S.afterRender=function(pattern,content){
  clearTimeout(timer);if(previous)previous.apply(this,arguments);shell(pattern,content);
  if(pattern!=='/admin/dashboard'||content.querySelector('[data-qfd]'))return;
  [...content.children].forEach(e=>e.hidden=true);
  const root=g.document.createElement('section');root.dataset.qfd='';root.className='qfd';
  root.innerHTML='<div class="qfd-intro"><p>Tudo o que precisa da sua atenção, em um só lugar.</p><label class="qfd-search">'+ico('search')+'<input type="search" data-qfd-search aria-label="Buscar profissional, pedido ou pagamento" placeholder="Buscar profissional, pedido ou pagamento"></label></div><div class="qfd-stats">'+[['open','Pedidos abertos','clipboard','blue'],['unlocks','Desbloqueios hoje','unlock','blue'],['paid','Pagamentos confirmados','wallet','green'],['support','Suporte pendente','chat','orange']].map(([key,title,icon,color])=>'<article class="qfd-stat '+color+'"><span class="qfd-icon">'+ico(icon)+'</span><div><span>'+title+'</span><strong data-qfd-stat="'+key+'">—</strong></div></article>').join('')+'</div><div class="qfd-work"><section class="qfd-panel"><h2>Atividades recentes</h2><div class="qfd-filters" role="group" aria-label="Filtrar atividades">'+[['all','Todas'],['unlock','Desbloqueios'],['payment','Pagamentos'],['support','Suporte']].map(([k,l])=>'<button type="button" data-qfd-filter="'+k+'" aria-pressed="'+(k==='all')+'">'+l+'</button>').join('')+'</div><div data-qfd-events><p class="qfd-empty">Consultando atividades…</p></div></section><section class="qfd-panel qfd-attention qf-p-precisa"><h2>Precisa de atenção</h2><div data-qfd-attention><p class="qfd-empty">Consultando pendências…</p></div></section></div><section class="qfd-panel"><h2>'+ico('users')+' Quem desbloqueou cada pedido</h2><div class="qfd-table-wrap"><table><thead><tr><th>Pedido</th><th>Serviço / Cidade</th><th>Profissional</th><th>Valor</th><th>Horário</th><th>Ação</th></tr></thead><tbody data-qfd-unlocks><tr><td colspan="6">Consultando desbloqueios…</td></tr></tbody></table></div></section><div class="qfd-footer"><p role="status" data-qfd-status>Consultando dados do banco…</p><button type="button" data-qfd-refresh>↻ Atualizar</button></div>';
  content.append(root);
  let filter='all',query='',events=[],unlocks=[],busy=false;
  const DB=g.DB;
  const pro=id=>DB?.profissionalById?.(id)?.nome||DB?.clienteById?.(id)?.nome||'Usuário';
  const searchText=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const matches=v=>!query||searchText(v).includes(searchText(query));
  function paint(){
   const rows=events.filter(e=>(filter==='all'||e.kind===filter)&&matches([e.title,e.name,e.detail,e.id].join(' ')));
   root.querySelector('[data-qfd-events]').innerHTML=rows.length?rows.slice(0,12).map(e=>'<article class="qfd-event '+e.color+'"><span class="qfd-icon">'+ico(e.icon)+'</span><div class="qfd-event-body"><h3>'+esc(e.title)+'</h3><p><b>'+esc(e.name)+'</b>'+ (e.detail?' • '+esc(e.detail):'')+'</p><time datetime="'+esc(e.at)+'">'+esc(when(e.at))+'</time></div>'+link(e.route,e.action)+'</article>').join(''):'<p class="qfd-empty">Nenhuma atividade encontrada neste filtro.</p>';
   const ds=unlocks.filter(x=>matches([x.id,x.service,x.city,x.name].join(' ')));
   root.querySelector('[data-qfd-unlocks]').innerHTML=ds.length?ds.slice(0,50).map(x=>'<tr><td>'+link(x.route,'#'+esc(x.id.slice(0,8)),'qfd-order')+'</td><td>'+esc(x.service)+'<small>'+esc(x.city)+'</small></td><td>'+link('/admin/profissionais/'+encodeURIComponent(x.proId),esc(x.name),'qfd-person')+'</td><td class="qfd-value">'+(x.origin==='plano'?'Pelo plano':money(x.value))+'</td><td>'+esc(when(x.at))+'</td><td>'+link(x.route,'Ver pedido')+'</td></tr>').join(''):'<tr><td colspan="6">Nenhum desbloqueio encontrado.</td></tr>';
  }
  async function rpc(name,args){const r=await g.QFAdminCloud.client.rpc(name,args);if(r.error||!r.data||r.data.ok===false)throw Error('Consulta indisponível');return r.data;}
  const value=(key,v)=>root.querySelector('[data-qfd-stat="'+key+'"]').textContent=String(v);
  async function refresh(){
   if(busy||!root.isConnected)return;busy=true;root.setAttribute('aria-busy','true');
   const status=root.querySelector('[data-qfd-status]');status.textContent='Atualizando dados…';
   const results=await Promise.allSettled([g.QFAdminCloud.syncSnapshot(true),rpc('qf_admin_balanco',{p_dias:1}),g.QFAdminCloud.syncSupport(),rpc('qf_admin_movimentacoes',{p_dias:30})]);
   if(!root.isConnected){busy=false;return;}
   const [snapshot,balance,support,movement]=results;
   events=[];unlocks=[];
   if(snapshot.status==='fulfilled'){
    const requests=DB.allRequests();
    value('open',requests.filter(r=>['aberto','em_negociacao'].includes(r.statusDb)).length);
    requests.forEach(r=>(r.desbloqueios||[]).filter(x=>x.ativo!==false).forEach(x=>{
     const service=DB.categoryById?.(r.categoriaId)?.nome||r.titulo||'Serviço';
     const row={id:r.id,route:'/admin/servicos/'+r.id,service,city:r.endereco?.cidade||'',proId:x.profissionalId,name:pro(x.profissionalId),value:x.valor,origin:x.origem,at:x.criadoEm};unlocks.push(row);
     events.push({kind:'unlock',color:'blue',icon:'unlock',title:'Pedido desbloqueado',name:row.name,detail:service+' • '+row.city+' • '+(x.origem==='plano'?'Pelo plano':money(x.valor)),at:x.criadoEm,route:row.route,action:'Ver desbloqueio',id:r.id});
    }));
    unlocks.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));value('unlocks',unlocks.filter(x=>today(x.at)).length);
   }else{value('open','—');value('unlocks','—');}
   if(balance.status==='fulfilled')value('paid',money(balance.value.entradas_centavos));else value('paid','—');
   // Movimentações confirmadas, sem contar consumo de saldo como novo pagamento.
   if(movement.status==='fulfilled')for(const m of movement.value.movimentos||[])if(!['desbloqueio','desbloqueio_exclusivo'].includes(m.tipo)&&Number(m.centavos)>0)events.push({kind:'payment',color:'green',icon:'wallet',title:'Pagamento confirmado',name:m.quem||'Usuário',detail:(m.detalhe||m.tipo)+' • '+money(m.centavos),at:m.em,route:m.rota||'/admin/movimentacoes',action:'Ver pagamento',id:m.rota});
   let pending=null;
   if(support.status==='fulfilled'){
    const tickets=support.value||g.QFAdminCloud.supportTickets||[];pending=tickets.filter(t=>t.status!=='resolvido');value('support',pending.length);
    for(const t of pending)events.push({kind:'support',color:'orange',icon:'chat',title:'Chamado de suporte',name:t.visitante_nome||pro(t.usuario_id),detail:(t.assunto||'Suporte')+' • '+(t.status==='aberto'?'Aguardando resposta':t.status),at:t.ultima_mensagem_em||t.atualizado_em||t.criado_em,route:'/admin/suporte/'+t.id,action:'Responder',id:t.id});
   }else value('support','—');
   // Não inventar contagem de pagamentos pendentes: abrir a consulta financeira real.
   root.querySelector('[data-qfd-attention]').innerHTML='<article class="qfd-attention-card orange"><span class="qfd-icon">'+ico('chat')+'</span><div><h3>'+(pending===null?'Suporte indisponível':pending.length+' chamado(s) em aberto')+'</h3><p>Acompanhe os atendimentos que precisam de retorno.</p>'+link('/admin/suporte','Ver chamados')+'</div></article><article class="qfd-attention-card blue"><span class="qfd-icon">'+ico('wallet')+'</span><div><h3>Pagamentos e confirmações</h3><p>Consulte o status de cada pagamento e a liberação correspondente.</p>'+link('/admin/planos','Ver pagamentos')+'</div></article>';
   events.sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));paint();
   const failed=results.some(x=>x.status==='rejected');status.textContent=failed?'Alguns dados estão indisponíveis. Atualize para tentar novamente.':'Atualizado às '+new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo'})+' • Pagamentos de hoje; atividades dos últimos 30 dias.';
   if(snapshot.status==='rejected')root.querySelector('[data-qfd-unlocks]').innerHTML='<tr><td colspan="6">Não foi possível consultar os desbloqueios.</td></tr>';
   if(movement.status==='rejected')status.textContent+=' Pagamentos recentes indisponíveis.';
   root.removeAttribute('aria-busy');busy=false;
   timer=setTimeout(()=>{if(root.isConnected)refresh();},30000);
  }
  root.querySelectorAll('[data-qfd-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.qfdFilter;root.querySelectorAll('[data-qfd-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));paint();});
  root.querySelector('[data-qfd-search]').oninput=e=>{query=e.target.value;paint();};
  root.querySelector('[data-qfd-refresh]').onclick=()=>{clearTimeout(timer);refresh();};
  refresh();
 };
}
if(g.document.readyState==='loading')g.document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
