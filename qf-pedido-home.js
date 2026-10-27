/* Pedido Fácil: formulário, pedidos e conversas dentro da home existente. */
(function(g){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const uuid=v=>/^[a-f0-9-]{36}$/i.test(v||'');
 const state={mode:'orders',user:null,selected:null,prof:null,notice:'',pending:null};
 let slot=null,loading=null,originalNavigate=null,after=null;
 function toolbar(){return '<div class="qf-home-orders__bar"><h2>Seu pedido, aqui mesmo</h2><div><button type="button" class="btn btn--outline" data-home-orders>Meus pedidos</button><button type="button" class="btn btn--primary" data-home-new>Novo pedido</button></div></div>'+(state.notice?'<p class="qf-home-orders__notice" role="status">'+esc(state.notice)+'</p>':'')+'<div data-home-work></div>';}
 function host(){
  if(slot?.isConnected)return slot;
  const content=g.document.getElementById('app-content');const anchor=content?.querySelector('[data-landing-service-form]');if(!anchor)return null;
  slot=g.document.createElement('section');slot.className='qf-home-orders';slot.id='qf-pedido-facil';slot.setAttribute('aria-label','Publicar e acompanhar pedidos');
  (anchor.closest('.qf-landing-hero')||anchor).insertAdjacentElement('afterend',slot);
  slot.innerHTML=toolbar();
  slot.addEventListener('click',e=>{if(!e.target.closest('[data-home-new],[data-home-orders],[data-home-order]'))return;if(slot.querySelector('.qf-client-access button:disabled'))return;const cancel=slot.querySelector('[data-access-cancel]');if(cancel)cancel.click();if(e.target.closest('[data-home-new]')){state.notice='';showForm();}else if(e.target.closest('[data-home-orders]')){state.notice='';orders();}else{const order=e.target.closest('[data-home-order]');if(order)detail(order.dataset.homeOrder);}});
  return slot;
 }
 function work(){return host()?.querySelector('[data-home-work]');}
 function reveal(){host()?.scrollIntoView({behavior:'auto',block:'start'});}
 function message(text){const node=work();if(node)node.innerHTML='<p role="status">'+esc(text)+'</p>';}
 async function user(){
  const session=await g.QFCloud?.syncForCurrentSession(true);
  state.user=session?.role==='cliente'?(session.user||g.DB.clienteById(session.userId)):null;
  return state.user;
 }
 function list(){return state.user?(g.DB?.state?.requests||[]).filter(r=>r.clienteId===state.user.id).sort((a,b)=>new Date(b.criadoEm||0)-new Date(a.criadoEm||0)):[];}
 function reset(){const el=host();if(el)el.innerHTML=toolbar();}
 async function orders(){
  state.mode='orders';state.selected=null;reset();const target=work();if(!target)return;
  target.innerHTML='<p role="status">Consultando seus pedidos…</p>';
  try{if(!await user())return login();if(!target.isConnected||state.mode!=='orders')return;
   const rows=list();target.innerHTML=rows.length?'<p>Escolha um pedido para acompanhar e conversar nesta página.</p><div class="qf-home-orders__list">'+rows.map(r=>'<button type="button" class="card qf-home-order" data-home-order="'+esc(r.id)+'"><strong>'+esc(r.titulo||g.DB.categoryById(r.categoriaId)?.nome||'Pedido de serviço')+'</strong><span>'+esc(r.endereco?.bairro||r.bairro||'')+' · '+esc(r.endereco?.cidade||r.cidadeNome||g.DB.cityById?.(r.cidadeId)?.nome||'')+'</span><span class="badge">'+esc(({aberto:'Buscando profissionais',buscando:'Buscando profissionais',em_negociacao:'Em negociação',cancelado:'Cancelado',concluido:'Concluído',finalizado:'Finalizado'})[r.status]||r.status)+'</span><span>Ver pedido e conversas</span></button>').join('')+'</div>':'<p>Você ainda não tem pedidos. Toque em Novo pedido para começar aqui mesmo.</p>';
  }catch(err){message('Não foi possível consultar seus pedidos. '+err.message);}
 }
 function login(){
  state.mode='login';const target=work();if(!target)return;
  target.innerHTML='<p>Entre para ver seus pedidos sem sair desta página.</p><form class="stack" data-home-login><label>Telefone<input class="input" name="telefone" type="tel" autocomplete="tel" required></label><button class="btn btn--primary" type="submit">Entrar e ver pedidos</button><p role="alert"></p></form><div data-home-access></div>';
  const form=target.querySelector('form');form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;const b=form.querySelector('button');b.disabled=true;try{await g.QFClienteAcesso.authenticate({nome:'',telefone:form.elements.telefone.value,container:target.querySelector('[data-home-access]')});await orders();}catch(err){if(form.isConnected)form.querySelector('[role=alert]').textContent=err.message;}finally{b.disabled=false;}};
 }
 function showForm(service){
  const suggestions=g.document.querySelector('[data-landing-service-suggestions]');if(suggestions)suggestions.hidden=true;
  state.mode='form';state.selected=null;state.prof=null;state.notice='';reset();
  if(service){g.QFHomeDraft={service};try{g.sessionStorage.removeItem('qf_pending_category');}catch(_){}}
  const target=work();if(!target)return;
  target.innerHTML=g.QFAtendimento.html();g.QFAtendimento.mount(target,{embedded:true},state.user);reveal();
 }
 async function detail(id,refresh=true){
  if(!uuid(id))return;
  state.mode='detail';state.selected=id;state.prof=null;reset();const target=work();if(!target)return;
  target.innerHTML='<p role="status">Carregando seu pedido…</p>';
  try{
   if(refresh&&!await user())return login();
   const request=g.DB.requestById(id);if(!request||request.clienteId!==state.user?.id)throw Error('Entre com a conta que publicou este pedido.');
   if(!target.isConnected||state.selected!==id)return;
   const params={id};target.innerHTML=g.Screens.clientePedidoDetalheRender(params,state.user);
   const view=target.querySelector('.view');
   if(view){
    const conversations=view.querySelector('[data-qf-client-conversations]');if(conversations)conversations.remove();
    const heading=view.querySelector(':scope > .row-between');if(heading)heading.remove();
    const extra=g.document.createElement('details');extra.className='qf-home-more';
    const summary=g.document.createElement('summary');summary.textContent='Detalhes e opções do pedido';extra.append(summary);
    while(view.firstChild)extra.append(view.firstChild);
    if(heading)view.append(heading);
    const help=g.document.createElement('p');help.className='text--sm text--secondary';help.textContent='Converse com os profissionais e confirme a conclusão por aqui.';view.append(help);
    if(conversations)view.append(conversations);
    view.append(extra);
   }

   after?.call(g.Screens,'/cliente/pedido/:id',target,params,state.user);
  }catch(err){message('Seu pedido continua salvo. '+err.message);}
 }
 async function chat(id,profId){
  if(!uuid(id)||!uuid(profId))return;
  state.mode='chat';state.selected=id;state.prof=profId;reset();const target=work();if(!target)return;
  target.innerHTML='<p role="status">Abrindo conversa…</p>';
  try{
   if(!await user())return login();const request=g.DB.requestById(id);if(!request||request.clienteId!==state.user.id)throw Error('Você não tem acesso a este pedido.');
   if(!target.isConnected||state.selected!==id||state.prof!==profId)return;
   const params={id,profId};target.innerHTML='<button type="button" class="btn btn--outline" data-home-order="'+esc(id)+'">Voltar ao pedido</button>'+g.Screens.clienteChatRender(params,state.user);
   after?.call(g.Screens,'/cliente/chat/:id/:profId',target,params,state.user);
  }catch(err){message(err.message);}
 }
 function openPath(path){
  const action=String(path||'');state.pending=action;if(inlinePath((g.location.hash||'').slice(1)))g.history.replaceState(null,'',g.location.pathname+g.location.search+'#/');
  if(!host()){
   // A única navegação é entre estados da própria index; pedidos e chats não recebem outra URL.
   originalNavigate('/',true);return;
  }
  execute(action);reveal();
 }
 function execute(path){
  state.pending=null;let m;
  if((m=path.match(/^\/cliente\/chat\/([^/]+)\/([^/]+)$/)))chat(m[1],m[2]);
  else if((m=path.match(/^\/cliente\/pedido\/([^/]+)$/)))detail(m[1]);
  else if((m=path.match(/^\/auth\/cliente\/(verificar|redefinir)\/([^/]+)$/))){state.mode='token';state.tokenPath=path;reset();const node=work();node.innerHTML='<div data-client-token data-kind="'+esc(m[1])+'" data-token="'+esc(m[2])+'"></div>';g.QFClienteAcesso.tokenPage();}
  else if(path==='/auth/cliente/login')login();
  else if(path==='/auth/cliente/cadastro'||path.startsWith('/cliente/novo-pedido'))showForm(g.QFHomeDraft?.service);
  else orders();
 }
 function inlinePath(path){return /^\/auth\/cliente\/(verificar|redefinir)\//.test(path||'')||path==='/auth/cliente/cadastro'||path==='/auth/cliente/login'||/^\/cliente\/(home|pedidos|pedido\/|chat\/|novo-pedido)/.test(path);}
 async function published(req,owner){
  state.user=owner;state.notice='Pedido publicado! Estamos buscando profissionais para você.';state.mode='detail';state.selected=req.id;
  try{await detail(req.id,false);reveal();}catch(err){reset();message('Pedido publicado. Toque em Meus pedidos para atualizar o acompanhamento.');}
 }
 function bindHome(){
  if(!host())return;
  if(g.location.hash==='#/cliente/home')g.history.replaceState(null,'',g.location.pathname+g.location.search+'#/');
  const action=state.pending;
  if(action)execute(action);
  else if(state.mode==='token')execute(state.tokenPath);
  else if(state.mode==='login')login();
  else if(state.mode==='form')showForm();
  else if(state.mode==='chat'&&state.selected&&state.prof)chat(state.selected,state.prof);
  else if(state.mode==='detail'&&state.selected)detail(state.selected);
  else orders();
 }
 function install(){
  if(!g.PROAKI_APP||!g.Screens?.landing||!g.QFClienteAcesso||!g.QFAtendimento)return false;
  if(g.QFPedidoHome.installed)return true;g.QFPedidoHome.installed=true;
  const css=g.document.createElement('style');css.textContent='.qf-hero-search .qf-service-suggestions{position:static;max-height:220px;overflow:auto;margin-top:6px}.qf-home-orders{grid-column:1/-1;width:calc(100% - 24px);max-width:1100px;margin:20px auto;padding:18px;border:1px solid #dce6f3;background:#fff;border-radius:20px;scroll-margin-top:14px;min-width:0;box-sizing:border-box}.qf-home-orders__bar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}.qf-home-orders__bar h2{font-size:21px;color:#1458cc;margin:0}.qf-home-orders__bar>div{display:flex;gap:8px;flex-wrap:wrap}.qf-home-orders .btn{min-height:44px;white-space:normal}.qf-home-orders__notice{padding:12px;border-radius:12px;background:#eef5ff;color:#1458cc;font-weight:700}.qf-home-orders__list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px}.qf-home-order{display:grid;gap:7px;text-align:left;width:100%;color:#173150;cursor:pointer}.qf-home-order>strong{font-size:18px}.qf-home-orders .view{min-height:0!important;max-width:100%;width:100%;padding:0!important;margin:0!important;box-sizing:border-box}.qf-home-orders [data-qf-atendimento-layout]{min-height:0!important;padding:0!important;justify-content:flex-start!important}.qf-home-orders .qf-chat-view{height:auto!important;min-height:0!important;padding:0!important}.qf-home-orders .qf-chat-list{max-height:50vh;overflow:auto;min-height:140px}.qf-home-orders .qf-chat-composer{position:static!important}.qf-home-orders [data-qf-atendimento]{box-shadow:none!important;border:0!important}.qf-home-orders [data-home-work]{min-width:0}.qf-home-orders .view>.row-between,.qf-home-orders .view>.row-between>.row{flex-wrap:wrap;gap:8px;max-width:100%}.qf-home-orders .qf-conversation-card .btn-row{display:grid!important;grid-template-columns:1fr!important}.qf-home-orders .qf-conversation-card .btn-row .btn{font-size:14px!important;padding:10px!important;word-break:normal!important;overflow-wrap:normal!important}.qf-home-orders .qf-cli-vagas__barras .is-on{background:#1469d2}.qf-home-more{border:1px solid #dce6f3;border-radius:12px;padding:12px;margin-top:12px}.qf-home-more>summary{color:#1458cc;font-weight:700;cursor:pointer}.qf-home-orders__bar .btn{font-size:13px;padding:9px 12px}@media(max-width:600px){.qf-home-orders{margin:14px 12px;padding:14px}.qf-home-orders__bar{gap:10px}.qf-home-orders__bar h2{font-size:19px}}';g.document.head.appendChild(css);
  originalNavigate=g.navigate;
  g.navigate=function(path,replace){if(inlinePath(path)){openPath(path);return;}return originalNavigate.apply(this,arguments);};
  const oldHome=g.Screens.clienteHomeRender;g.Screens.clienteHomeRender=()=>g.Screens.landing();
  after=g.Screens.afterRender;const anon=g.Screens.afterRenderAnon;
  g.Screens.afterRender=function(pattern,content,params,current){if(pattern==='/cliente/home'){state.user=current;bindHome();return;}return after?.apply(this,arguments);};
  g.Screens.afterRenderAnon=function(pattern){const result=anon?.apply(this,arguments);if(pattern==='/')bindHome();return result;};
  g.document.addEventListener('submit',e=>{if(!e.target.matches('[data-landing-service-form]'))return;e.preventDefault();e.stopImmediatePropagation();const value=e.target.querySelector('[data-landing-service-search]')?.value.trim();showForm(value);},true);
  g.document.addEventListener('click',e=>{
   const button=e.target.closest('[data-action="landing-my-orders"],[data-nav],a[href*="#/cliente/"],a[href*="#/auth/cliente/"]');if(!button)return;
   const path=button.dataset.nav||button.getAttribute('href')?.split('#')[1];
   if(button.dataset.action==='landing-my-orders'||inlinePath(path)){e.preventDefault();e.stopImmediatePropagation();openPath(button.dataset.action==='landing-my-orders'?'/cliente/pedidos':path);}
  },true);
  const path=(g.location.hash||'#/').slice(1);if(inlinePath(path))openPath(path);else if(path==='/')bindHome();
  return true;
 }
 g.QFPedidoHome={published,openPath,isInlinePath:inlinePath,isBusy:()=>!!slot?.isConnected&&['form','chat','token','login'].includes(state.mode),installed:false};
 if(!install()){const timer=g.setInterval(()=>{if(install())g.clearInterval(timer);},40);}
})(window);
