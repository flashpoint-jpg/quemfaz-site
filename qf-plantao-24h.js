/* Chamado Urgente 24h e painel de plantão na mesma página. */
(function (app) {
 'use strict';
 const d = app.document;
 const services = {
  cat_eletricista:'Eletricista', cat_guincho:'Guincho', cat_encanador:'Encanador', cat_chaveiro:'Chaveiro'
 };
 app.QFPlantao24h = {categorias:Object.freeze(Object.keys(services))};
 const escape = value => String(value??'').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const db = () => app.QFCloud?.client;
 const button = (label, action, primary=false) => '<button type="button" class="btn btn--'+(primary?'primary':'outline')+'" data-plantao-action="'+action+'">'+label+'</button>';
 const money = (text) => '<strong class="qf-plantao-price">'+text+'</strong>';
 async function rpc(name, params={}) {
  const result = await db().rpc(name, params);
  if(result.error)throw new Error(result.error.message);
  return result.data;
 }
 async function edge(action, data={}) {
  const result = await db().functions.invoke('quemfaz-plantao', {body:{...data,action}});
  if(result.error){
   let details;
   try{details=await result.error.context?.json();}catch(_){}
   throw new Error(details?.error||'Não foi possível concluir agora. Tente novamente.');
  }
  return result.data;
 }
 function open(role) {
  if(d.querySelector('#qf-plantao-dialog'))return;
  const panel=d.createElement('dialog');
  panel.id='qf-plantao-dialog';panel.className='qf-plantao-dialog';
  panel.setAttribute('aria-labelledby','qf-plantao-title');
  panel.innerHTML='<header><h2 id="qf-plantao-title">'+(role==='cliente'?'Chamado Urgente 24h':'Chamados 24h')+'</h2><button type="button" aria-label="Fechar" data-plantao-action="close">×</button></header><div class="qf-plantao-body"></div><p class="qf-plantao-msg" role="status"></p>';
  d.body.append(panel);panel.showModal();
  const body=panel.querySelector('.qf-plantao-body'), status=panel.querySelector('.qf-plantao-msg');
  let loading=false, payment=null, plan=null, list=[], currentId=null, userId=null, timer;
  let rendered='', newRequest=false;
  const expiryText=value=>value?new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'';
  const waitingStates=['buscando','oferta','pix'];
  const own=()=>list.find(item=>item.id===currentId);
  const payUI=code=>'<label>Pix copia e cola<textarea readonly rows="3">'+escape(code)+'</textarea></label>'+button('Copiar código Pix','copy');
  const show = html => { if(html!==rendered){body.innerHTML=html;rendered=html;} };
  function contact(item, professional) {
   return '<p><strong>'+escape(services[item.categoria])+'</strong> · '+escape(item.bairro)+' · '+escape(item.cidade)+'</p>'+
    (professional?'<p>Endereço: '+escape(item.endereco)+'</p>':'')+
    '<p>Telefone: '+escape(item.telefone)+'</p><p>Combine o valor do serviço diretamente.</p>';
  }
  function clientForm() {
   show('<p>Ficou sem energia só na sua casa? O carro quebrou de madrugada? Estourou um cano? Busque um profissional de plantão.</p>'+
    '<form data-plantao-form><label>Serviço<select name="categoria" required><option value="">Selecione</option>'+
    Object.entries(services).map(([id,name])=>'<option value="'+id+'">'+name+'</option>').join('')+'</select></label>'+
    '<label>CEP do atendimento<input name="cep" inputmode="numeric" autocomplete="postal-code" maxlength="9" required></label>'+
    '<details><summary>Não sei o CEP</summary><p>Busque pelo nome da sua rua.</p>'+
    '<label>UF<input name="buscaUf" maxlength="2" placeholder="SP"></label><label>Cidade<input name="buscaCidade"></label>'+
    '<label>Rua<input name="buscaRua"></label>'+button('Buscar CEP','find-cep')+'<div data-qf-cep-results></div></details>'+
    '<label>Endereço completo<input name="endereco" autocomplete="street-address" maxlength="300" required></label>'+
    '<label>Bairro<input name="bairro" autocomplete="address-level3" maxlength="100"></label>'+
    '<label>Descreva o problema<textarea name="descricao" rows="3" minlength="8" maxlength="500" required></textarea></label>'+
    (userId?'':'<label>Seu nome<input name="nome" autocomplete="name" required></label><label>Seu celular<input name="telefone" type="tel" autocomplete="tel" required></label>')+
    '<div class="qf-plantao-card">'+money('R$ 20,00')+'<p>Taxa ao Quem Faz, cobrada se você confirmar um atendimento. O serviço é combinado à parte.</p></div>'+
    '<button class="btn btn--primary" type="submit">Buscar profissional de plantão</button></form>');
  }
  function renderClient() {
   const item=own();
   if(newRequest||!item){clientForm();return;}
   const available=item.profissionais_disponiveis;
   if(item.estado==='sem_profissional'||(item.estado==='buscando'&&available===0)){
    show('<h3>Nenhum profissional disponível agora</h3><p>Não encontramos ninguém de plantão para este serviço na sua região. Nenhuma taxa foi cobrada.</p>'+
      button('Publicar pedido grátis','ordinary',true)+button('Buscar novamente','new'));
    return;
   }
   switch(item.estado){
    case 'buscando':{
     const summary=available===1?'1 profissional disponível na sua região':
       available>1?available+' profissionais disponíveis na sua região':'Buscando profissionais de plantão na sua região';
     show('<div class="qf-plantao-search" role="status"><span class="qf-plantao-spinner" aria-hidden="true"></span><div><strong>'+summary+'</strong>'+
       '<p>'+(available>0?'Aguardando um profissional aceitar o chamado.':'Consultando o plantão…')+'</p></div></div>'+button('Cancelar busca','decline'));
     break;
    }
    case 'oferta':show('<h3>'+escape(item.profissional_nome||'Profissional de plantão')+' pode atender</h3>'+
      '<p>Previsão de chegada: <strong>'+escape(item.chegada_minutos)+' minutos</strong> após o Pix confirmado.</p>'+money('R$ 20,00')+
      '<p>Taxa de urgência ao Quem Faz. O valor do serviço é combinado à parte.</p>'+
      button('Aceitar e pagar via Pix','pix',true)+button('Recusar prazo','decline'));break;
    case 'pix':show('<h3>Pix da taxa de urgência</h3>'+money('R$ 20,00')+
      '<p>Recebedor · Quem Faz Serviços. Válido até '+expiryText(item.prazo_pix)+'.</p>'+
      (payment?.pix?payUI(payment.pix):button('Carregar código Pix','pix',true))+
      '<p>Os contatos aparecem após a confirmação do banco.</p>'+button('Verificar pagamento','refresh'));break;
    case 'confirmado':show('<h3>Atendimento confirmado</h3>'+contact(item,false)+button('Novo chamado urgente','new'));break;
    case 'sem_atendimento':show('<h3>Tempo de busca encerrado</h3><p>A busca terminou sem atendimento confirmado. Nenhuma taxa foi cobrada.</p>'+
      button('Publicar pedido grátis','ordinary',true)+button('Buscar novamente','new'));break;
    case 'reembolso_pendente':show('<p>O Pix foi recebido depois do horário reservado. A devolução está em processamento.</p>');break;
    case 'reembolsado':show('<p>O Pix de R$ 20,00 foi devolvido.</p>'+button('Buscar novamente','new'));break;
    default:show('<h3>Atendimento não confirmado</h3><p>Você pode procurar novamente ou publicar um pedido comum grátis.</p>'+
      button('Publicar pedido grátis','ordinary',true)+button('Buscar novamente','new'));
   }
  }
  function renderProfessional(shift) {
   const categorias=shift.categorias_elegiveis||[];
   const profissoes=Object.values(services).join(', ');
   const statusPlano=shift.plano_ativo
    ? '<p><strong>24 Livre ativo</strong> · '+escape(shift.desbloqueios_restantes)+' desbloqueios comuns restantes.</p>'
    : '<p><strong>Plantão 24h grátis</strong> · somente chamados urgentes. Pedidos comuns exigem saldo ou um plano próprio.</p>';
   let acoes='';
   if(!categorias.length){
    acoes='<p>Para entrar no plantão, seu perfil precisa ter uma destas profissões: '+profissoes+'.</p>';
   }else if(shift.inscrito_gratis||shift.plano_ativo){
    acoes='<p>Profissões no plantão: '+categorias.map(id=>escape(services[id])).join(', ')+'.</p>'+
     button(shift.disponivel?'Sair do plantão':'Estou de plantão',shift.disponivel?'off':'on',true);
   }else{
    acoes='<p>Inscreva-se sem pagar. Depois, marque Estou de plantão quando puder atender.</p>'+
     button('Inscrever-me grátis','enroll',true);
   }
   if(categorias.length&&!shift.plano_ativo){
    acoes+='<details><summary>24 Livre com pedidos comuns</summary><p>R$ 59,00 por 30 dias, com 20 desbloqueios comuns.</p>'+
     (app.QFLivre?.planHelpButton('livre_24h')||'')+
     (plan?.code?payUI(plan.code)+button('Verificar ativação','refresh'):button('Ativar 24 Livre via Pix','buy'))+'</details>';
   }
   const cards=list.map(item=>{
    const id=escape(item.id), label=escape(services[item.categoria]);
    if(item.estado==='confirmado'&&item.meu_aceite)return '<article class="qf-plantao-card"><h3>Atendimento confirmado</h3>'+contact(item,true)+'</article>';
    if(item.meu_aceite&&['pix','oferta'].includes(item.estado))return '<article class="qf-plantao-card"><strong>'+label+'</strong><p>Aguardando confirmação do cliente e do Pix. O contato será liberado após o pagamento.</p></article>';
    if(item.estado!=='buscando')return '';
    return '<article class="qf-plantao-card"><strong>'+label+' · '+escape(item.bairro)+' · '+escape(item.cidade)+'</strong><p>'+escape(item.descricao)+'</p>'+
     '<form data-plantao-offer="'+id+'"><label>Previsão de chegada<select name="eta">'+[15,20,30,45,60].map(n=>'<option value="'+n+'">'+n+' min</option>').join('')+
     '</select></label><button class="btn btn--primary">Aceitar chamado</button></form></article>';
   }).join('');
   show(statusPlano+acoes+
    (shift.disponivel&&!cards?'<p>Nenhum chamado urgente para os serviços e cidades do seu perfil.</p>':'')+cards);
  }
  async function refresh() {
   if(!db())throw new Error('Conexão indisponível. Atualize a página.');
   if(!userId){const auth=await db().auth.getSession();userId=auth.data?.session?.user?.id||null;}
   if(!userId&&role==='cliente'){renderClient();return;}
   list=await rpc('qf_plantao_listar');
   if(role==='profissional'){
    if(plan?.id)await app.QFCloud.syncForCurrentSession(true);
    renderProfessional(await rpc('qf_plantao_disponibilidade'));return;
   }
   if(!currentId&&!newRequest)currentId=(list.find(item=>item.cliente&&waitingStates.includes(item.estado))||list.find(item=>item.cliente))?.id;
   const item=own();
   if(item?.estado==='pix'){
    const result=await edge(payment?.pix?'consultar':'pix',{id:item.id});
    if(result.estado!=='pix')list=await rpc('qf_plantao_listar');
    payment=result;
   }
   renderClient();
  }
  async function run(fn, silent=false) {
   if(loading||!panel.open)return;
   loading=true;
   if(!silent)status.textContent='Aguarde…';
   try{await fn();if(!silent)status.textContent='';}
   catch(error){if(!silent||!rendered)status.textContent=error.message;}
   finally{loading=false;}
  }
  panel.addEventListener('close',()=>{clearInterval(timer);panel.remove();},{once:true});
  panel.addEventListener('click',event=>{
   const action=event.target.closest('[data-plantao-action]')?.dataset.plantaoAction;
   if(!action)return;
   if(action==='close'){panel.close();return;}
   run(async()=>{
    switch(action){
     case 'find-cep':{
      const form=body.querySelector('form'), el=form.elements;
      const uf=el.buscaUf.value.trim().toUpperCase(), city=el.buscaCidade.value.trim(), street=el.buscaRua.value.trim();
      if(!/^[A-Z]{2}$/.test(uf)||city.length<3||street.length<3)throw new Error('Informe a UF, a cidade e o nome da rua.');
      const url='https://viacep.com.br/ws/'+[uf,city,street].map(encodeURIComponent).join('/')+'/json/';
      const response=await app.fetch(url,{signal:AbortSignal.timeout(5500)});
      if(!response.ok)throw new Error('Busca indisponível. Informe os 8 números do CEP ou tente de novo.');
      const records=await response.json(), results=body.querySelector('[data-qf-cep-results]');
      results.replaceChildren();
      if(!Array.isArray(records)||!records.length)throw new Error('Rua não encontrada. Confira o nome ou informe o CEP.');
      records.slice(0,8).forEach(row=>{
       const option=d.createElement('button');option.type='button';option.className='btn btn--outline';
       option.textContent=[row.logradouro,row.bairro,row.cep].filter(Boolean).join(' · ');
       option.onclick=()=>{el.cep.value=row.cep;el.bairro.value=row.bairro||'';el.endereco.value=row.logradouro||'';el.endereco.focus();};
       results.append(option);
      });
      return;
     }
     case 'copy':{
      const field=body.querySelector('textarea[readonly]');
      try{await app.navigator.clipboard.writeText(field.value);}catch(_){field.focus();field.select();}
      return;
     }
     case 'new':
      if(own()?.estado==='buscando')await rpc('qf_plantao_recusar',{p_id:currentId});
      currentId=null;payment=null;newRequest=true;break;
     case 'ordinary':
      if(own()?.estado==='buscando')await rpc('qf_plantao_recusar',{p_id:currentId});
      panel.close();d.querySelector('.qf-approved-picker [data-action="landing-all-services"]')?.click();return;
     case 'decline':await rpc('qf_plantao_recusar',{p_id:currentId});break;
     case 'pix':payment=await edge('pix',{id:currentId});break;
     case 'buy':{
      const rec=await app.QFCloud.createPlan('livre_24h','pix');plan={id:rec.id,code:rec.pixCopyPaste};break;
     }
     case 'enroll':await rpc('qf_plantao_inscrever');break;
     case 'on':case 'off':await rpc('qf_plantao_disponibilidade',{p_disponivel:action==='on'});break;
    }
    await refresh();
   });
  });
  panel.addEventListener('submit',event=>{
   const form=event.target;
   if(!form.matches('[data-plantao-form],[data-plantao-offer]'))return;
   event.preventDefault();
   run(async()=>{
    const data=Object.fromEntries(new FormData(form));
    if(form.hasAttribute('data-plantao-offer')){
     await rpc('qf_plantao_aceitar',{p_id:form.dataset.plantaoOffer,p_minutos:Number(data.eta)});
    }else{
     if(!userId){
      const profile=await app.QFClienteAcesso.guest(data.nome,data.telefone);
      userId=profile.id;
     }
     const {id}=await edge('criar',{categoria:data.categoria,cep:data.cep,bairro:data.bairro,endereco:data.endereco,descricao:data.descricao});
     currentId=id;newRequest=false;
    }
    await refresh();
   });
  });
  run(refresh);timer=setInterval(()=>run(refresh,true),6000);
 }
 function install() {
  const style=d.createElement('style');
  style.textContent='.qf-approved-picker-actions:has([data-qf-plantao-client]){width:min(100%,580px);grid-template-columns:repeat(3,minmax(0,1fr))}.qf-approved-picker-actions [data-qf-plantao-client]{font-size:clamp(12px,3.05vw,15px)!important}.qf-plantao-exemplos{margin:10px 0 0;text-align:center;color:#435973;font-size:13px}.qf-plantao-dialog{box-sizing:border-box;width:min(520px,calc(100% - 24px));max-height:calc(100dvh - 24px);padding:18px;overflow:auto;border:1px solid #cddff1;border-radius:16px;background:#fff;color:#173150}.qf-plantao-dialog::backdrop{background:#0b203c8c}.qf-plantao-dialog header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.qf-plantao-dialog header h2,.qf-plantao-dialog h3,.qf-plantao-dialog p{margin:0}.qf-plantao-dialog header button{border:0;background:#edf3fa;color:#173150;border-radius:8px;width:44px;height:44px;font-size:25px}.qf-plantao-body,.qf-plantao-body form,.qf-plantao-card{display:grid;gap:10px}.qf-plantao-dialog label{font-weight:700}.qf-plantao-dialog :is(input,select,textarea){display:block;width:100%;min-height:44px;margin-top:4px;padding:8px;border:1px solid #afc6df;border-radius:8px;background:#fff;color:#173150;font-size:16px}.qf-plantao-dialog .btn{min-height:44px;white-space:normal}.qf-plantao-card{padding:12px;border:1px solid #d6e4f4;border-radius:10px;background:#f3f8ff}.qf-plantao-price{font-size:26px}.qf-plantao-msg{margin-top:10px!important}';
  style.textContent += `
   .qf-plantao-exemplos a{color:#0b509f;font-weight:700}
   .qf-plantao-search{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #d6e4f4;border-radius:10px;background:#f3f8ff}
   .qf-plantao-spinner{width:24px;height:24px;flex:none;border:2px solid #c7d8ec;border-top-color:#1459ad;border-radius:50%;animation:qf-plantao-spin 1.25s linear infinite}
   @keyframes qf-plantao-spin{to{transform:rotate(360deg)}}
   @media(prefers-reduced-motion:reduce){.qf-plantao-spinner{animation:none}}
  `;
  d.head.append(style);
  function mount() {
   const client=d.querySelector('.qf-approved-picker-actions');
   if(client&&!client.querySelector('[data-qf-plantao-client]')){
    const c=d.createElement('button');c.type='button';c.className='qf-approved-cta';
    c.dataset.qfPlantaoClient='';c.textContent='Chamado Urgente 24h';c.setAttribute('aria-haspopup','dialog');
    c.onclick=()=>open('cliente');client.append(c);
    const url=new URL(app.location.href);
    if(url.searchParams.get('plantao')==='cliente'){
     url.searchParams.delete('plantao');app.history.replaceState(app.history.state,'',url);
     open('cliente');
    }
   }
   const pro=d.querySelector('#app-shell[data-route="profissional/home"] .view');
   if(pro&&!pro.querySelector('[data-qf-plantao-pro]')){
    const c=d.createElement('button');c.type='button';c.className='btn btn--outline';
    c.dataset.qfPlantaoPro='';c.textContent='Plantão 24h';c.setAttribute('aria-haspopup','dialog');
    c.onclick=()=>open('profissional');pro.prepend(c);
    const url=new URL(app.location.href);
    if(url.searchParams.get('plantao')==='1'){
     url.searchParams.delete('plantao');app.history.replaceState(app.history.state,'',url);
     open('profissional');
    }
   }
  }
  new MutationObserver(mount).observe(d.body,{subtree:true,childList:true});mount();
 }
 if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
