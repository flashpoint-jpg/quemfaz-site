/* Registra somente cartões realmente visíveis; consulta administrativa separa cada etapa. */
(function(g){'use strict';
 const S=g.Screens;if(!S)return;const previous=S.afterRender;
 const esc=v=>g.PU.escapeHtml(String(v==null?'—':v));
 const dt=v=>v?new Date(v).toLocaleString('pt-BR'):'Sem plano Livre ativo';
 function adminHtml(d){
  const p=d.profissional,t=d.totais;
  const nomes=(p.profissoes||[]).map(id=>g.DB.categoryById(id)?.nome||id).join(', ');
  const rows=[['Plano Quem Faz Livre',dt(p.livre_ate)],['Outros planos ativos',(p.outros_planos||[]).map(x=>x.plano+' · '+dt(x.valido_ate)).join('; ')||'Nenhum'],['Profissões',nomes],['Cidade principal',[p.cidade,p.uf].filter(Boolean).join('/')],['Raio principal',p.raio_km+' km'],['Cidades e raios',(p.cidades||[]).map(x=>x.cidade+'/'+x.uf+' · '+x.raio_km+' km').join('; ')||'Cidade principal'],['Horários',String(p.horario_inicio).slice(0,5)+' às '+String(p.horario_fim).slice(0,5)],['Avisos agora',p.no_horario?'Dentro do horário':'Pausados pelo horário; pedidos continuam visíveis'],['Pedidos compatíveis agora',d.compativeis.length],['Oportunidades fora do raio',d.mais_oportunidades],['Exibidos desde 26/10/2026',t.exibidos],['Com registro de distribuição',t.distribuidos],['Envios aceitos pelo serviço de push',t.notificados],['Pedidos desbloqueados',t.desbloqueados],['Orçamentos aceitos',t.orcamentos_aceitos],['Serviços finalizados confirmados',t.finalizados]];
  return '<h2 class="h3">Atendimento e entrega de pedidos</h2><dl style="display:grid;gap:12px;margin:0">'+rows.map(x=>'<div style="overflow-wrap:anywhere"><dt class="text--sm text--secondary">'+esc(x[0])+'</dt><dd style="margin:3px 0 0;font-weight:650">'+esc(x[1])+'</dd></div>').join('')+'</dl><p class="text--sm">Exibido: cartão observado na tela pelo aplicativo desde 26/10. Sem registro anterior não significa que não recebeu pedidos. Push aceito não comprova entrega no aparelho. Distribuição, visualização, aceite e desbloqueio são etapas distintas. Finalizados: pedido encerrado com orçamento aceito para o profissional ou conclusão confirmada pelo cliente no Quem Faz Livre.</p>'+ (d.compativeis.length?'<h3 class="h3">Compatíveis neste momento</h3>'+d.compativeis.map(x=>'<p><a href="#/admin/servicos/'+esc(x.id)+'">'+esc(x.titulo)+'</a> · '+esc(x.cidade)+' · '+esc(x.bairro)+' · '+esc(x.distancia_km)+' km · '+esc(x.participantes)+'/'+esc(x.limite)+' vagas ocupadas</p>').join(''):'');
 }
 g.QFEntregasAdminHtml=adminHtml;
 S.afterRender=function(pattern,content,params,user){
  if(previous)previous.apply(this,arguments);
  if(pattern==='/admin/profissionais/:id'){
   const box=document.createElement('section');box.className='section card stack--sm';box.textContent='Consultando atendimento e entrega de pedidos…';(content.querySelector('.view')||content).append(box);
   const load=async()=>{try{const r=await g.QFAdminCloud.client.rpc('qf_admin_profissional_entregas',{p_profissional_id:params.id});if(r.error||!r.data?.ok)throw Error();if(box.isConnected)box.innerHTML=adminHtml(r.data);}catch(_){if(box.isConnected)box.innerHTML='<p>Não foi possível consultar os registros.</p><button type="button" class="btn btn--outline" data-entregas-retry>Tentar novamente</button>';const b=box.querySelector('button');if(b)b.onclick=load;}};load();
  }
  if(!['/profissional/home','/profissional/servicos/disponiveis','/profissional/outros-pedidos'].includes(pattern)||!g.QFCloud?.enabled||!g.IntersectionObserver)return;
  const seen=new Set();let pending=new Set(),timer;
  const flush=()=>{const ids=[...pending];pending.clear();if(!ids.length||!content.isConnected)return;g.QFCloud.client.rpc('qf_registrar_pedidos_exibidos',{p_ids:ids}).then(r=>{if(r.error)ids.forEach(id=>seen.delete(id));}).catch(()=>ids.forEach(id=>seen.delete(id)));};
  const observer=new IntersectionObserver(entries=>{for(const e of entries){const id=e.target.dataset.requestId;if(e.isIntersecting&&e.intersectionRatio>=.5&&id&&!seen.has(id)&&!document.hidden){seen.add(id);pending.add(id);clearTimeout(timer);timer=setTimeout(flush,300);}}},{threshold:.5});
  const watch=()=>content.querySelectorAll('[data-request-id]').forEach(e=>observer.observe(e));watch();
  const mutations=new MutationObserver(watch);mutations.observe(content,{childList:true,subtree:true});
  const cleanup=setInterval(()=>{if(!content.isConnected){observer.disconnect();mutations.disconnect();clearInterval(cleanup);clearTimeout(timer);}},3000);
 };
})(window);
