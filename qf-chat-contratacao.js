/* Quem Faz Livre — proposta e confirmacao autenticadas dentro do chat. */
(function(g){
 'use strict';
 const price=v=>(Number(v||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const messages={
  sem_proposta_pendente:'Não há proposta aguardando sua confirmação.',
  proposta_indisponivel:'Esta proposta não pode mais ser enviada.',
  prestacao_indisponivel:'O resultado deste pedido já foi registrado.',
  outro_profissional_contratado:'Este pedido já foi contratado com outro profissional.',
  resposta_indisponivel:'Este resultado precisa ser conferido pela administração.',
  pedido_encerrado:'Este pedido foi encerrado.',
  sem_permissao:'Você não tem acesso à contratação deste pedido.',
  nao_autenticado:'Abra o Quem Faz com sua sessão ativa para confirmar.'
 };
 function mount(root, params, user, role){
  if(!root||root.dataset.qfContratoMounted||!g.QFCloud?.client||!user?.id)return;
  root.dataset.qfContratoMounted='1';
  const client=g.QFCloud.client, profId=role==='profissional'?user.id:params.profId,callId=params.id;
  if(!profId||!callId)return;
  const pane=g.document.createElement('section');
  pane.className='card qf-chat-contract';
  pane.style.cssText='border:1.5px solid #b5cff5;border-radius:16px;padding:14px;background:#f3f8ff;display:grid;gap:10px;margin:12px 0;color:#173b66';
  pane.innerHTML='<strong>Contratação no Quem Faz Livre</strong><p class="text--sm" role="status">Consultando seu pedido…</p>';
  const msgs=root.querySelector('[data-qf-chat-list]');
  if(msgs)msgs.before(pane);else root.prepend(pane);
  let closed=false,busy=false,last='',timer=null;
  async function rpc(acao,valor){
   const {data,error}=await client.rpc('qf_chat_contratacao',{p_chamado_id:callId,p_profissional_id:profId,p_acao:acao,p_valor_centavos:valor??null});
   if(error)throw error;
   if(!data?.ok)throw Error(messages[data?.reason]||'Não foi possível registrar. '+String(data?.reason||''));
   return data;
  }
  function render(s){
   const who=s.papel,estado=s.estado,resposta=s.cliente_resposta,valor=s.valor_centavos||0,prop=!!s.proposta_em;
   const row=[];
   let headline='Negociação dentro do aplicativo';
   if(resposta==='divergencia')headline='Divergência: administração precisa analisar';
   else if(resposta==='nao_contratou')headline='Cliente informou que não contratou';
   else if(resposta==='confirmado')headline='Contratação confirmada pelo cliente';
   else if(estado==='recusado')headline='Profissional declarou que não fechou';
   else if(prop&&estado==='negociando')headline='Proposta aguardando resposta do cliente';
   else if(estado==='informado')headline='Profissional informou contratação — confirme o resultado';
   row.push('<strong>Quem Faz Livre · 13%</strong><p style="margin:0">'+escapeHTML(headline)+'</p>');
   if(g.QFPush&&!g.QFPush.isActive())row.push('<div style="display:grid;gap:6px;padding:10px;border-radius:10px;background:#fff4e9"><strong>Ative os avisos sonoros do chat</strong><p class="text--sm" style="margin:0">Para ouvir mensagens com o app fechado, permita as notificações nas configurações do celular.</p><button class="btn btn--primary" type="button" data-qfc-notify>Ativar notificações</button></div>');
   row.push('<button type="button" class="btn btn--outline" data-qfc-sound style="font-size:.85rem">Testar som de mensagem</button>');
   if(valor)row.push('<p style="margin:0">Valor informado: <strong>'+price(valor)+'</strong> · comissão estimada: <strong>'+price(Math.round(valor*0.13))+'</strong></p>');
   if(resposta==='confirmado')row.push('<p class="text--sm" style="margin:0">O cliente confirmou. A comissão ainda depende de aprovação manual do administrador.</p>');
   if(resposta==='divergencia')row.push('<p class="text--sm" style="margin:0">As respostas não coincidem. Nenhuma comissão foi aprovada automaticamente.</p>');
   if(who==='profissional'&&['pendente','negociando'].includes(estado)&&!resposta){
    row.push('<form data-qfc-form style="display:grid;gap:8px"><label class="text--sm" for="qfc-valor">Valor combinado do serviço (R$)</label><input id="qfc-valor" data-qfc-valor class="input" inputmode="decimal" autocomplete="off" placeholder="Ex.: 350,00" required style="min-height:44px" value="'+(valor?(valor/100).toFixed(2).replace('.',','):'')+'"><button type="submit" class="btn btn--primary">Enviar proposta para o cliente</button></form>');
    row.push('<button type="button" class="btn btn--outline" data-qfc-action="nao_fechou">Não fechei este serviço</button>');
   }
   if(who==='cliente'){
    if(estado==='negociando'&&prop&&!resposta){
      row.push('<button type="button" class="btn btn--primary" data-qfc-action="aceitar">Aceitar e contratar por '+price(valor)+'</button>');
      row.push('<button type="button" class="btn btn--outline" data-qfc-action="nao_contratei">Não contratei</button>');
    }else if(estado==='recusado'&&!resposta){
      row.push('<p class="text--sm" style="margin:0">O profissional disse que não fechou. Você o contratou?</p>');
      row.push('<button type="button" class="btn btn--primary" data-qfc-action="contestar">Sim, contratei — contestar</button>');
      row.push('<button type="button" class="btn btn--outline" data-qfc-action="nao_contratei">Não contratei</button>');
    }else if(estado==='pendente'&&!resposta){
      row.push('<button type="button" class="btn btn--outline" data-qfc-action="nao_contratei">Não contratei este profissional</button>');
    }
   }
   row.push('<p class="text--sm" data-qfc-status role="status" style="margin:0">A confirmação é registrada no pedido. Não é necessário WhatsApp.</p>');
   pane.innerHTML=row.join('');
   pane.querySelector('[data-qfc-sound]')?.addEventListener('click',()=>{
     try{g.PU?.playNotificationSound(false);g.navigator?.vibrate?.(100);setStatus('Teste de som solicitado. Confira volume e permissões do aparelho.');}
     catch(_){setStatus('Verifique se o volume de notificações do celular está ativado.');}
   });
   pane.querySelector('[data-qfc-notify]')?.addEventListener('click',async(e)=>{
     const btn=e.currentTarget;btn.disabled=true;setStatus('Ativando notificações deste aparelho…');
     try{await g.QFPush.activate();setStatus('Notificações ativadas. Abra o chat para receber os avisos.');}
     catch(err){setStatus('Não foi possível ativar: '+String(err.message||'verifique as configurações do celular'));}
     finally{btn.disabled=false;}
   });
   pane.querySelector('[data-qfc-form]')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const raw=pane.querySelector('[data-qfc-valor]').value.trim();
    if(!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(raw)){setStatus('Informe um valor em reais, como 350,00.');return;}
    const cents=Math.round(Number(raw.replace(',','.'))*100);
    if(!Number.isSafeInteger(cents)||cents<100||cents>100000000){setStatus('Informe um valor entre R$ 1 e R$ 1.000.000.');return;}
    await run('propor',cents);
   });
   pane.querySelectorAll('[data-qfc-action]').forEach(button=>button.addEventListener('click',async()=>{
    const acao=button.dataset.qfcAction;
    const ask={aceitar:'Confirmar a contratação pelo valor informado? O administrador ainda analisará a comissão.',nao_fechou:'Informar que não fechou? O cliente poderá confirmar ou contestar.',nao_contratei:'Confirmar que NÃO contratou este profissional?',contestar:'Você realmente contratou este profissional? O administrador analisará a divergência.'};
    if(!g.confirm(ask[acao]))return;
    await run(acao);
   }));
  }
  function setStatus(value){const node=pane.querySelector('[data-qfc-status]')||pane.querySelector('[role=status]');if(node)node.textContent=value;}
  async function update(){
   if(closed||!pane.isConnected||busy)return;
   try{
    const s=await rpc('ver');
    if(closed)return;
    const key=JSON.stringify(s);
    if(key!==last){last=key;render(s);}
   }catch(err){
    if(String(err.message).includes('nao_plano_livre')){closed=true;pane.remove();if(timer)clearInterval(timer);return;}
    setStatus('Não foi possível atualizar: '+String(err.message||'erro de conexão'));
   }
  }
  async function run(acao,valor){
    if(busy)return;
    busy=true;pane.querySelectorAll('button,input').forEach(x=>x.disabled=true);
    setStatus('Registrando no Quem Faz…');
    try{
      await rpc(acao,valor);
      last='';
      busy=false;
      await update();
      try{g.dispatchEvent(new Event('qf-chat-refresh'));}catch(_){}
    }catch(err){
      busy=false;setStatus('Não foi possível registrar: '+String(err.message||'erro'));
      pane.querySelectorAll('button,input').forEach(x=>x.disabled=false);
    }
  }
  const onVis=()=>{if(!g.document.hidden)update();};
  g.document.addEventListener('visibilitychange',onVis);
  timer=g.setInterval(()=>{
    if(!pane.isConnected){closed=true;g.clearInterval(timer);g.document.removeEventListener('visibilitychange',onVis);return;}
    if(!g.document.hidden)update();
  },10000);
  update();
 }
 function install(){
  const Screens=g.Screens;
  if(!Screens||Screens._qfChatContratoInstalled)return;
  Screens._qfChatContratoInstalled=true;
  const prev=Screens.afterRender;
  Screens.afterRender=function(pattern,content,params,user){
    if(prev)prev.apply(this,arguments);
    if(pattern==='/profissional/chat/:id'||pattern==='/cliente/chat/:id/:profId'){
      mount(content.querySelector('[data-qf-chat-root]'),params,user,pattern.startsWith('/profissional/')?'profissional':'cliente');
    }
  };
 }
 g.QFChatContratacao={mount,install};
 install();
 if(g.document?.readyState==='loading')g.document.addEventListener('DOMContentLoaded',install,{once:true});
})(window);
