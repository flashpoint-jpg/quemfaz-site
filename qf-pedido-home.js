/* Pedido Fácil: formulário, pedidos e conversas dentro da home existente. */
(function(g){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const uuid=v=>/^[a-f0-9-]{36}$/i.test(v||'');
 if(g.visualViewport){const adjust=()=>g.document.documentElement.classList.toggle('qf-keyboard-open',g.innerHeight-g.visualViewport.height>150);g.visualViewport.addEventListener('resize',adjust);g.visualViewport.addEventListener('scroll',adjust);}
 const state={mode:'intro',user:null,selected:null,prof:null,notice:'',pending:null};
 let slot=null,loading=null,originalNavigate=null,after=null;
 function toolbar(){return (['orders','detail','chat'].includes(state.mode)?'<div class="qf-home-orders__bar"><button type="button" class="btn btn--outline" data-home-orders>Meus pedidos</button><button type="button" class="btn btn--outline" data-home-new>Novo pedido</button></div>':'')+(state.notice?'<p class="qf-home-orders__notice" role="status">'+esc(state.notice)+'</p>':'')+'<div data-home-work></div>';}
 function host(){
  if(slot?.isConnected)return slot;
  const anchor=g.document.querySelector('[data-landing-service-form]');if(!anchor)return null;
  const seed=anchor.querySelector('[data-landing-service-search]')?.value||'';if(!state.problem&&seed)state.problem=seed;
  slot=g.document.createElement('section');slot.className='qf-landing-service-search qf-hero-search qf-home-orders';slot.id='qf-pedido-facil';slot.setAttribute('aria-label','Escolha o serviço que você precisa');
  anchor.replaceWith(slot);slot.innerHTML=toolbar();
  slot.addEventListener('click',e=>{if(!e.target.closest('[data-home-new],[data-home-orders],[data-home-order]'))return;if(slot.querySelector('.qf-client-access button:disabled'))return;const cancel=slot.querySelector('[data-access-cancel]');if(cancel)cancel.click();if(e.target.closest('[data-home-new]')){state.notice='';intro();}else if(e.target.closest('[data-home-orders]')){state.notice='';orders();}else{const order=e.target.closest('[data-home-order]');if(order)detail(order.dataset.homeOrder);}});
  return slot;
 }
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 const serviceCategories=()=>(g.DB?.categories()||[]).filter(c=>c.id!=='cat_outros'&&!/^outros?( servicos?)?$/.test(norm(c.nome))).slice().sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
 function classify(problem){
  const text=norm(problem);
  const rules=[
   [/\beletric/,/tomada|disjuntor|curto.circuito|chuveiro|fiacao|energia|eletric/,10],
   [/encanador|hidraul/,/torneira|vazament|cano|descarga|registro|encan|hidraul|pia entup/,11],
   [/desentupid/,/desentup|entupid|esgoto/,12],
   [/pintor|pintura/,/pintar|pintura|tinta|pintor/,12],
   [/serralheir|soldador|soldagem|metalurg/,/soldar|solda|soldagem|portao de ferro|portao de metal|grade de ferro|estrutura metalica|serralheria|corrimao|metalico/,16],
   [/limpeza.*estof|higien.*estof|limpeza.*sofa/,/sofa|estofado|poltrona|colchao|tapete/,12],
   [/diarista|faxineira|limpeza residencial/,/faxina|diarista|faxineira|limpar.*casa|limpeza.*casa|limpeza.*apartamento/,11],
   [/montador|montagem.*moveis/,/montar|montagem|desmontar|guarda.roupa|montador/,12],
   [/chaveiro/,/chave|fechadura|porta trancada/,12],
   [/ar.condicionado|refrigeracao/,/ar.condicionado|ar nao gela|ar nao esta gelando|climatiz/,12],
   [/geladeira/,/geladeira|freezer|refrigerador|frigobar/,12],
   [/fogao|micro.ondas/,/fogao|forno|micro.ondas/,12],
   [/maquina de lavar|lavadora/,/lavadora|maquina de lavar/,12],
   [/informatica/,/\b(computador|computadores|notebook|notebooks|laptop|laptops|pc|desktop|impressora|windows|informatica)\b|formatar|formatacao|instalar.*programa|remover.*virus/,16],
   [/celular/,/\b(celular|smartphone|iphone|android)\b/,16],
   [/internet.*redes/,/\b(internet|wi[ -]?fi|roteador|modem)\b|rede.*(cai|lenta|conecta)/,16],
   [/tecnico.*tv.*som/,/\b(tv|televisao|televisor)\b/,16],
   [/pedreir|alvenaria/,/pedreir|reformar|reforma|alvenaria|assentar|azulejo|reboc|chapisc|emboc|argamassa|contrapiso|concret|levantar muro|construir muro|cimento|trocar piso|colocar piso|colocar revestimento/,13],
   [/telhadista|telhado/,/telhado|goteira|telha quebrada/,12],
   [/impermeabiliz/,/impermeabilizar|impermeabilizacao|infiltracao/,12],
   [/jardineiro|jardinagem/,/grama|podar|poda|jardim|jardinagem/,12],
   [/marido de aluguel/,/marido de aluguel|pequenos reparos/,12],
   [/frete|carreto/,/frete|carreto|mudanca|transportar.*movel/,11]
  ];
  return (g.DB?.categories()||[]).filter(c=>c.id!=='cat_outros').map(c=>{const name=norm(c.nome);let score=name===text||name.length>=4&&text.includes(name)?100:0;for(const [category,words,weight] of rules)if(category.test(name)&&words.test(text))score+=weight;return {category:c,score};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
 }
 function intro(prefill,service){
  try{const saved=JSON.parse(sessionStorage.getItem('qf_home_oauth_draft')||'null');if(saved){state.problem=saved.problem;state.service=saved.service;sessionStorage.removeItem('qf_home_oauth_draft');}}catch(_){}
  state.mode='intro';state.notice='';state.selected=null;state.prof=null;if(prefill)state.problem=prefill;reset();
  const target=work();if(!target)return;
  const categories=serviceCategories();
  target.innerHTML='<h2 class="qf-home-problem-title" id="home-problem-title">Qual serviço você precisa?</h2><p class="qf-home-problem-sub">Escolha o serviço e conte o que aconteceu. Vamos encontrar profissionais perto de você.</p><div class="qf-home-auth"><button type="button" class="qf-google-button" data-home-google><img src="/assets/google-g.svg" alt="" width="22" height="22">Entrar com Google</button><span class="qf-auth-or">ou</span><button type="button" class="qf-phone-button" data-home-login-start><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.8 15.8 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.2 11 11 0 0 0 3.5.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11 11 0 0 0 .6 3.5 1 1 0 0 1-.2 1z" fill="currentColor"/></svg>Entrar com telefone</button></div><form class="stack" data-home-problem novalidate><label for="home-service">Serviço<select class="input" id="home-service" required aria-describedby="home-service-error"><option value="">Selecione o serviço</option>'+categories.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.nome)+'</option>').join('')+'</select></label><label for="home-problem">Descreva o que você precisa<textarea class="input" id="home-problem" rows="3" minlength="8" maxlength="1500" required aria-describedby="home-problem-hint home-service-error" placeholder="Ex.: meu computador não liga">'+esc(state.problem||'')+'</textarea></label><p class="text--sm text--secondary" id="home-problem-hint">Explique em uma frase o motivo do chamado. O profissional verá a descrição antes de desbloquear o pedido.</p><p role="alert" id="home-service-error"></p><button class="btn btn--primary" type="submit">Continuar</button></form><p class="text--sm text--secondary" style="margin-bottom:0">Pedido grátis. Uma etapa por vez, aqui mesmo.</p>';
  const form=target.querySelector('form'),input=form.querySelector('textarea'),select=form.querySelector('select');
  // O catálogo completo permanece interno. No celular, só aparecem resultados da busca.
  select.hidden=true;select.required=false;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  select.insertAdjacentHTML('beforebegin','<input class="input" id="home-service-search" type="search" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="home-service-results" aria-describedby="home-service-hint home-service-error" placeholder="Digite o serviço. Ex.: informática, pintor"><div id="home-service-results" role="listbox" aria-label="Serviços encontrados" hidden></div><span class="text--sm text--secondary" id="home-service-hint" role="status">Digite pelo menos 2 letras para buscar.</span>');
  form.querySelector('label[for="home-service"]').htmlFor='home-service-search';
  const search=form.querySelector('#home-service-search'),results=form.querySelector('#home-service-results'),hint=form.querySelector('#home-service-hint');
  select.closest('label').after(results,hint);search.required=true;
  let active=-1;
  const closeResults=()=>{results.hidden=true;search.setAttribute('aria-expanded','false');search.removeAttribute('aria-activedescendant');active=-1;};
  const pick=category=>{select.value=category.id;search.value=category.nome;search.removeAttribute('aria-invalid');form.querySelector('[role=alert]').textContent='';closeResults();hint.textContent='Serviço selecionado. Você pode digitar para trocar.';};
  const suggest=()=>{
   const query=norm(search.value),tokens=query.split(/[^a-z0-9]+/).filter(Boolean);results.innerHTML='';closeResults();
   if(query.length<2){hint.textContent='Digite pelo menos 2 letras para buscar.';return;}
   const inferred=new Map(classify(query).map(x=>[x.category.id,x.score]));
   const found=categories.map(c=>({category:c,score:norm(c.nome)===query?1000:tokens.length&&tokens.every(t=>norm(c.nome).includes(t))?200:(inferred.get(c.id)||0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,5);
   if(!found.length){hint.textContent='Nenhum serviço encontrado. Tente outro nome ou descreva o aparelho, como computador.';return;}
   results.innerHTML=found.map(({category:c},i)=>'<button class="btn btn--outline" style="display:block;width:100%;text-align:left;margin-top:6px;white-space:normal" type="button" role="option" aria-selected="false" id="home-service-option-'+i+'" data-service-id="'+esc(c.id)+'">'+esc(c.nome)+'</button>').join('');
   results.hidden=false;search.setAttribute('aria-expanded','true');hint.textContent='Toque no serviço correspondente.';
   results.querySelectorAll('button').forEach(b=>b.onclick=()=>pick(categories.find(c=>c.id===b.dataset.serviceId)));
  };
  search.oninput=()=>{select.value='';search.removeAttribute('aria-invalid');form.querySelector('[role=alert]').textContent='';suggest();};
  search.onfocus=()=>{if(!select.value)suggest();};
  search.onkeydown=e=>{const buttons=[...results.querySelectorAll('button')];if(e.key==='Escape'){closeResults();return;}if(results.hidden||!buttons.length)return;
   if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();active=(active+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons.forEach((b,i)=>b.setAttribute('aria-selected',String(i===active)));search.setAttribute('aria-activedescendant',buttons[active].id);}
   else if(e.key==='Enter'){e.preventDefault();buttons[active<0?0:active].click();}
  };
  target.querySelector('[data-home-login-start]').onclick=()=>{state.service=select.value;login();};
  target.querySelector('[data-home-google]').onclick=async()=>{state.problem=input.value;state.service=select.value;try{sessionStorage.setItem('qf_home_oauth_draft',JSON.stringify({problem:input.value,service:select.value}));const r=await g.QFCloud.client.auth.signInWithOAuth({provider:'google',options:{redirectTo:'https://quemfazservico.com.br/?app=1',queryParams:{prompt:'select_account'}}});if(r.error)throw r.error;}catch(e){target.querySelector('[role=alert]').textContent=e.message||'Não foi possível entrar com Google.';}};
  const track=(name,detail)=>{try{g.QFClientAcquisition?.track(name,detail||{},true);}catch(_){}};
  if(service||state.service){const category=categories.find(c=>c.id===(service||state.service)||norm(c.nome)===norm(service));if(category)pick(category);}
  input.onfocus=()=>track('home_focus');
  input.oninput=()=>{input.removeAttribute('aria-invalid');track('home_type');state.problem=input.value;form.querySelector('[role=alert]').textContent='';};
  select.onchange=()=>{select.removeAttribute('aria-invalid');form.querySelector('[role=alert]').textContent='';};
  form.onsubmit=e=>{e.preventDefault();track('home_submit');const problem=input.value.trim();state.problem=problem;
   // A escolha explícita usa o catálogo dos profissionais, inclusive categorias novas.
   const category=categories.find(c=>c.id===select.value);
   if(!category){track('validation_error',{error_code:'service'});form.querySelector('[role=alert]').textContent='Digite o serviço e escolha uma das opções encontradas.';search.setAttribute('aria-invalid','true');search.focus();return;}
   if(problem.length<8||problem.length>1500){track('validation_error',{error_code:'description'});form.querySelector('[role=alert]').textContent='Descreva o que precisa ser feito, com 8 a 1.500 caracteres. Ex.: meu computador não liga.';input.setAttribute('aria-invalid','true');input.focus();return;}
   showForm(category.nome,problem);
  };
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
  target.innerHTML='<h2 class="h3">Acessar meus pedidos</h2><p>Entre com seu telefone e senha, nesta mesma página.</p><form class="stack" data-home-login><label>Telefone com DDD<input class="input" name="telefone" type="tel" autocomplete="tel" required></label><button class="btn btn--primary" type="submit">Entrar com telefone</button><p role="alert"></p></form><div data-home-access></div><button type="button" class="btn btn--outline" data-home-back style="margin-top:12px">Voltar ao pedido</button>';
  target.querySelector('[data-home-back]').onclick=()=>intro();
  const form=target.querySelector('form');form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;const b=form.querySelector('button');b.disabled=true;try{await g.QFClienteAcesso.authenticate({nome:'',telefone:form.elements.telefone.value,container:target.querySelector('[data-home-access]')});await orders();}catch(err){if(form.isConnected)form.querySelector('[role=alert]').textContent=err.message;}finally{b.disabled=false;}};
 }
 function showForm(service,problem){
  if(!service&&!g.QFAtendimento?.hasGoogleDraft?.()&&!g.QFAtendimento?.hasActiveDraft?.()){intro();return;}
  if(service&&!serviceCategories().some(c=>norm(c.nome)===norm(service))){intro(problem||service);return;}
  if(service&&String(problem||'').trim().length<8){intro(problem,service);return;}
  const suggestions=g.document.querySelector('[data-landing-service-suggestions]');if(suggestions)suggestions.hidden=true;
  state.mode='form';state.service=service;state.selected=null;state.prof=null;state.notice='';reset();
  try{g.sessionStorage.removeItem('qf_pending_category');}catch(_){}
  const target=work();if(!target)return;
  target.innerHTML=g.QFAtendimento.html();
  g.QFAtendimento.mount(target,{embedded:true,service,problem:problem||state.problem},state.user);reveal();
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
  else if(path==='/auth/cliente/cadastro'||path.startsWith('/cliente/novo-pedido')){
   let catId;try{catId=g.sessionStorage.getItem('qf_pending_category');}catch(_){}
   const linked=g.QFClientAcquisition?.serviceFromLink(g.location.search);
   const selected=g.DB.categoryById(path.startsWith('/cliente/novo-pedido/')?decodeURIComponent(path.split('/').pop()):catId||linked);
   if(selected)showForm(selected.nome,'');else intro(g.QFHomeDraft?.service);
  }
  else orders();
 }
 function inlinePath(path){return /^\/auth\/cliente\/(verificar|redefinir)\//.test(path||'')||path==='/auth/cliente/cadastro'||path==='/auth/cliente/login'||/^\/cliente\/(home|pedidos|pedido\/|chat\/|novo-pedido)/.test(path);}
 async function published(req,owner){
  state.user=owner;state.notice='Pedido publicado! Estamos buscando profissionais para você.';state.mode='detail';state.selected=req.id;
  try{await detail(req.id,false);reveal();}catch(err){reset();message('Pedido publicado. Toque em Meus pedidos para atualizar o acompanhamento.');}
 }
 function bindHome(){
  if(!host())return;
  if(g.QFAtendimento?.hasGoogleDraft?.()){showForm('');return;}
  if(g.location.hash==='#/cliente/home')g.history.replaceState(null,'',g.location.pathname+g.location.search+'#/');
  const action=state.pending;
  if(action)execute(action);
  else if(state.mode==='token')execute(state.tokenPath);
  else if(state.mode==='login')login();
  else if(state.mode==='form')showForm(state.service,state.problem);
  else if(state.mode==='intro')intro();
  else if(state.mode==='chat'&&state.selected&&state.prof)chat(state.selected,state.prof);
  else if(state.mode==='detail'&&state.selected)detail(state.selected);
  else intro(); // Na entrada, nunca mostrar automaticamente os pedidos do cliente.
 }
 function install(){
  if(!g.PROAKI_APP||!g.Screens?.landing||!g.QFClienteAcesso||!g.QFAtendimento)return false;
  if(g.QFPedidoHome.installed)return true;g.QFPedidoHome.installed=true;
  const css=g.document.createElement('style');css.textContent='.qf-hero-search .qf-service-suggestions{position:static;max-height:220px;overflow:auto;margin-top:6px}.qf-home-orders{width:100%;max-width:100%;margin:0;padding:18px;border:1px solid #dce6f3;background:#fff;border-radius:20px;scroll-margin-top:14px;min-width:0;box-sizing:border-box}.qf-home-problem-title{font-size:22px;line-height:1.25;color:#1458cc;margin:0 0 6px}.qf-home-problem-sub{font-size:15px;color:#46566b;margin:0 0 14px}.qf-home-orders textarea{min-height:96px!important;height:auto!important;box-sizing:border-box;max-width:100%;width:100%;font-size:16px;resize:vertical}.qf-home-type-options{display:grid;gap:8px;margin-top:8px}.qf-home-orders__bar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}.qf-home-orders__bar h2{font-size:21px;color:#1458cc;margin:0}.qf-home-orders__bar>div{display:flex;gap:8px;flex-wrap:wrap}.qf-home-orders .btn{min-height:44px;white-space:normal}.qf-home-orders__notice{padding:12px;border-radius:12px;background:#eef5ff;color:#1458cc;font-weight:700}.qf-home-orders__list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px}.qf-home-order{display:grid;gap:7px;text-align:left;width:100%;color:#173150;cursor:pointer}.qf-home-order>strong{font-size:18px}.qf-home-orders .view{min-height:0!important;max-width:100%;width:100%;padding:0!important;margin:0!important;box-sizing:border-box}.qf-home-orders [data-qf-atendimento-layout]{min-height:0!important;padding:0!important;justify-content:flex-start!important}.qf-home-orders .qf-chat-view{height:auto!important;min-height:0!important;padding:0!important}.qf-home-orders .qf-chat-list{max-height:50vh;overflow:auto;min-height:140px}.qf-home-orders .qf-chat-composer{position:static!important}.qf-home-orders [data-qf-atendimento]{box-shadow:none!important;border:0!important}.qf-home-orders [data-home-work]{min-width:0}.qf-home-orders .view>.row-between,.qf-home-orders .view>.row-between>.row{flex-wrap:wrap;gap:8px;max-width:100%}.qf-home-orders .qf-conversation-card .btn-row{display:grid!important;grid-template-columns:1fr!important}.qf-home-orders .qf-conversation-card .btn-row .btn{font-size:14px!important;padding:10px!important;word-break:normal!important;overflow-wrap:normal!important}.qf-home-orders .qf-cli-vagas__barras .is-on{background:#1469d2}.qf-home-more{border:1px solid #dce6f3;border-radius:12px;padding:12px;margin-top:12px}.qf-home-more>summary{color:#1458cc;font-weight:700;cursor:pointer}.qf-home-orders__bar .btn{font-size:13px;padding:9px 12px}@media(max-width:600px){.qf-home-orders{margin:0;padding:14px}.qf-home-orders__bar{gap:10px}.qf-home-orders__bar h2{font-size:19px}}';g.document.head.appendChild(css);
  css.textContent += '.qf-public-faq{margin-top:12px;padding:16px 18px;border:1px solid #d7e2f1;border-radius:16px;background:#fff;text-align:left;box-shadow:0 4px 14px #142e4b0c}.qf-public-faq[hidden]{display:none!important}.qf-public-faq h3{font-size:19px;margin:0 0 10px;color:#102f5c}.qf-public-faq p{margin:0 0 12px;line-height:1.55;font-size:14px;color:#33465b}.qf-public-faq p:last-child{margin-bottom:0}.qf-play-badge--hero{display:none!important}.qf-play-link{margin-top:14px}';
  originalNavigate=g.navigate;
  g.navigate=function(path,replace){if(inlinePath(path)){openPath(path);return;}return originalNavigate.apply(this,arguments);};
  const oldHome=g.Screens.clienteHomeRender;g.Screens.clienteHomeRender=()=>g.Screens.landing();
  after=g.Screens.afterRender;const anon=g.Screens.afterRenderAnon;
  g.Screens.afterRender=function(pattern,content,params,current){if(pattern==='/cliente/home'){state.user=current;bindHome();return;}return after?.apply(this,arguments);};
  g.Screens.afterRenderAnon=function(pattern){const result=anon?.apply(this,arguments);if(pattern==='/')bindHome();return result;};
  g.document.addEventListener('submit',e=>{if(!e.target.matches('[data-landing-service-form]'))return;e.preventDefault();e.stopImmediatePropagation();const value=e.target.querySelector('[data-landing-service-search]')?.value.trim();showForm(value);},true);
  g.document.addEventListener('click',e=>{
   // O formulário antigo é substituído na home; seus atalhos precisam apontar ao card atual.
   const service=e.target.closest('[data-desk-service],[data-landing-cat]');
   if(service){e.preventDefault();e.stopImmediatePropagation();const cat=g.DB.categoryById(service.dataset.landingCat);state.problem='';showForm(cat?.nome||service.dataset.deskService,'');return;}
   const start=e.target.closest('[data-home-services],[data-action="landing-all-services"]');
   if(start){e.preventDefault();e.stopImmediatePropagation();intro();reveal();host()?.querySelector('#home-problem')?.focus();return;}
   const button=e.target.closest('[data-action="landing-my-orders"],[data-nav],a[href*="#/cliente/"],a[href*="#/auth/cliente/"]');if(!button)return;
   const path=button.dataset.nav||button.getAttribute('href')?.split('#')[1];
   if(button.dataset.action==='landing-my-orders'||inlinePath(path)){e.preventDefault();e.stopImmediatePropagation();openPath(button.dataset.action==='landing-my-orders'?'/cliente/pedidos':path);}
  },true);

  // Atalhos públicos: não reutilizar o estado de pedidos do cliente para entrar como profissional.
  g.document.addEventListener('click',function(e){
    const professional=e.target.closest?.('.qf-home-prof-btn[data-nav="/auth/profissional/login"]');
    if(professional){
      e.preventDefault();e.stopImmediatePropagation();
      state.mode='intro';state.pending=null;state.selected=null;
      if(typeof originalNavigate==='function')originalNavigate.call(g,'/auth/profissional/login');
      else g.location.hash='#/auth/profissional/login';
      return;
    }
    const pricing=e.target.closest?.('button[data-nav="/como-funciona"]');
    if(!pricing)return;
    e.preventDefault();e.stopImmediatePropagation();
    let info=g.document.getElementById('qf-precos-duvidas');
    if(!info){
      info=g.document.createElement('section');
      info.id='qf-precos-duvidas';info.className='qf-public-faq';
      info.setAttribute('aria-label','Preços, planos e dúvidas');
      info.innerHTML='<h3>Preços, planos e dúvidas</h3>'+
        '<p><strong>Para clientes:</strong> publicar um pedido é grátis. Até quatro profissionais podem desbloquear o contato.</p>'+
        '<p><strong>Para profissionais:</strong> no avulso, cada contato é pago individualmente, sem comissão por serviço. No Quem Faz Livre são R$ 39,90 por 30 dias, com desbloqueios compatíveis ilimitados; em serviços fechados e confirmados, 87% ficam com o profissional e 13% com o Quem Faz.</p>'+
        '<p><strong>Pagamento e repasse Pix após o serviço:</strong> a automatização ainda depende de homologação bancária. Não significa recebimento ou repasse confirmado.</p>'+
        '<p>Você acompanha seu pedido em <strong>Meus pedidos</strong>. Profissionais podem acessar cadastro, plano e carteira pela <strong>Área de profissionais</strong>.</p>';
      pricing.insertAdjacentElement('afterend',info);
      pricing.setAttribute('aria-controls','qf-precos-duvidas');
      pricing.setAttribute('aria-expanded','true');
    }else{
      info.hidden=!info.hidden;
      pricing.setAttribute('aria-expanded',String(!info.hidden));
    }
  },true);

  const path=(g.location.hash||'#/').slice(1);if(inlinePath(path))openPath(path);else if(g.QFAtendimento?.hasGoogleDraft?.())bindHome();else if(path==='/'&&!g.document.getElementById('app-shell')?.hasAttribute('data-qf-prerender'))bindHome();
  return true;
 }
 g.QFPedidoHome={published,openPath,start:()=>intro(),classify,isInlinePath:inlinePath,isBusy:()=>!!slot?.isConnected&&['form','chat','token','login'].includes(state.mode),installed:false};
 if(!install()){const timer=g.setInterval(()=>{if(install())g.clearInterval(timer);},40);}
})(window);
