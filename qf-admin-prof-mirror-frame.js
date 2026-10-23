(function(g){'use strict';if(g.parent===g)return;
 document.addEventListener('click',e=>{if(e.target.closest('[data-prof-voltar]')){e.preventDefault();e.stopImmediatePropagation();g.parent.postMessage({type:'qf-espelho-abrir',id:null},location.origin);return;}const nav=e.target.closest('[data-nav]');e.preventDefault();e.stopImmediatePropagation();const path=nav?.getAttribute('data-nav')||'';const id=path.match(/^\/profissional\/chamada\/([^/]+)$/)?.[1];if(id)g.parent.postMessage({type:'qf-espelho-abrir',id},location.origin);},true);document.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();},true);
 g.addEventListener('message',e=>{if(e.source!==g.parent||e.origin!==location.origin||e.data?.type!=='qf-admin-espelho-profissional')return;const d=e.data.data,DB=g.DB;if(!DB||!g.QFRequestFromCloud)return;
  if(g.QFCloud?.client)g.QFCloud.client.rpc=async name=>({data:name==='qf_comissao13_status'?d.estado:{ok:false},error:null});
  const reqs=d.itens.map(p=>{const r=g.QFRequestFromCloud(p,null);r.modalidade=p.modalidade;r.atendimentoTipo=p.atendimento_tipo;return r;});const prof=d.profissional||{id:'espelho-admin',nome:'Visão geral dos pedidos',online:true,statusAprovacao:'aprovado',bloqueado:false,categorias:[...new Set(reqs.map(r=>r.categoriaId))],creditos:0,raioKm:0,fotoUrl:'',areasAtendimento:[]};DB.state.requests=reqs;DB.state.users.profissionais=[prof];
  const shell=document.getElementById('app-shell');const root=document.createElement('main');root.dataset.espelhoProfLeitura='';root.style.cssText='padding:16px;overflow-wrap:anywhere';shell.replaceChildren(root);
  if(d.detalhe){const req=DB.requestById(d.detalhe);if(!req)return;root.innerHTML='<button class="btn btn--outline" data-prof-voltar>Voltar aos pedidos</button>'+g.Screens.profChamadaRender({id:req.id},prof);g.QFComissao13.enhance('/profissional/chamada/:id',root,{id:req.id},prof);root.querySelector('[data-prof-voltar]').disabled=false;}
  else{
   // Evita montar a home completa dentro de um iframe estreito: o banner de
   // boas-vindas tem largura mínima e quebrava cada letra no celular.
   // Os cartões continuam sendo os componentes reais usados pelo profissional.
   const title=d.profissional?'Pedidos disponíveis para '+g.PU.escapeHtml(prof.nome||'profissional'):'Todos os pedidos — tela dos profissionais';
   root.innerHTML='<div class="view" style="display:block;width:100%;min-width:0;max-width:100%;box-sizing:border-box"><h1 class="h2">'+title+'</h1><p class="text--sm">Visualização de leitura. A disponibilidade depende do profissional selecionado.</p><div class="stack--sm">'+(reqs.length?reqs.map(r=>'<section style="min-width:0;max-width:100%"><p class="text--sm text--secondary">Situação no sistema: '+g.PU.escapeHtml((d.itens.find(p=>p.id===r.id)||{}).status_banco||'aberto')+'</p>'+g.QFHomeProCard(r)+'</section>').join(''):'<p>Nenhum pedido encontrado para os filtros selecionados.</p>')+'</div></div>';
   g.QFComissao13.decorateCards(root,d.estado);
  }
  root.querySelectorAll('.view').forEach(x=>{x.style.opacity='1';x.style.transform='none';});
  const lock=()=>{root.querySelectorAll('button,input,select,textarea').forEach(x=>{const nav=x.getAttribute('data-nav')||'';x.disabled=!(x.hasAttribute('data-prof-voltar')||/^\/profissional\/chamada\//.test(nav));});root.querySelectorAll('a').forEach(x=>x.removeAttribute('href'));};lock();const observer=new MutationObserver(lock);observer.observe(root,{childList:true,subtree:true});
 });
})(window);
