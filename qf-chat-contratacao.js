/* Quem Faz Livre — proposta e confirmacao autenticadas dentro do chat. */
(function(g){
 'use strict';
 const price=v=>(Number(v||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const messages={
  codigo_obrigatorio:'Informe os seis dígitos do código do pedido.',codigo_invalido:'Código incorreto. Confira o código deste pedido.',limite_codigo:'Limite de tentativas. Aguarde uma hora para tentar novamente.',conclusao_obrigatoria:'Confirme que o serviço foi concluído antes de enviar.',sem_proposta_pendente:'Não há proposta aguardando sua confirmação.',
  proposta_indisponivel:'Esta proposta não pode mais ser enviada.',
  prestacao_indisponivel:'O resultado deste pedido já foi registrado.',
  valor_alterado:'O valor mudou. Aguarde a atualização e confira antes de confirmar.',estado_invalido:'Esta proposta não está mais disponível. Atualize o chat.',outro_profissional_contratado:'Este pedido já foi contratado com outro profissional.',
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
  pane.innerHTML='<strong>Orçamento e contratação · Quem Faz Livre</strong><p class="text--sm" role="status">Consultando seu pedido…</p>';
  // O chat é a ação principal: primeiro mensagens e caixa de digitar, depois orçamento e comissão.
  const composer=root.querySelector('[data-qf-chat-form]');
  const msgs=root.querySelector('[data-qf-chat-list]');
  if(composer)composer.after(pane);else if(msgs)msgs.after(pane);else root.append(pane);
  let closed=false,busy=false,last='',timer=null;
  async function rpc(acao,valor,codigo=null,concluido=false){
   const {data,error}=await client.rpc('qf_chat_contratacao',{p_chamado_id:callId,p_profissional_id:profId,p_acao:acao,p_valor_centavos:valor??null,p_codigo:codigo,p_concluido:concluido});
   if(error)throw error;
   if(!data?.ok)throw Error(messages[data?.reason]||'Não foi possível registrar. '+String(data?.reason||''));
   return data;
  }
  function render(s){
   const who=s.papel,estado=s.estado,resposta=s.cliente_resposta,valor=s.valor_centavos||0,prop=!!s.proposta_em,separado=s.etapas_separadas===true;
   const row=[];
   let headline='Negociação dentro do aplicativo';
   if(resposta==='divergencia')headline=['informado','negociando'].includes(estado)?'Cliente solicitou correção do valor':'Divergência em análise';
   else if(resposta==='nao_contratou')headline='Cliente informou que não contratou';
   else if(resposta==='confirmado')headline='Contratação confirmada pelo cliente';
   else if(estado==='recusado')headline='Profissional declarou que não fechou';
   else if(prop&&estado==='negociando')headline='Proposta aguardando resposta do cliente';
   else if(estado==='informado')headline='Profissional informou contratação — confirme o resultado';
   row.push('<strong>Contratação</strong><p style="margin:0">'+escapeHTML(who==='cliente'&&['informado','negociando'].includes(estado)&&valor&&!resposta?(s.profissional_nome||'O profissional')+' apresentou um orçamento de '+price(valor)+'. Você contratou esse serviço?':headline)+'</p>');
   if(g.QFPush&&!g.QFPush.isActive())row.push('<div style="display:grid;gap:6px;padding:10px;border-radius:10px;background:#fff4e9"><strong>Ative os avisos sonoros do chat</strong><p class="text--sm" style="margin:0">Para ouvir mensagens com o app fechado, permita as notificações nas configurações do celular.</p><button class="btn btn--primary" type="button" data-qfc-notify>Ativar notificações</button></div>');
   row.push('<button type="button" class="btn btn--outline" data-qfc-sound style="font-size:.85rem">Testar som de mensagem</button>');
   if(who==='cliente')row.push('<section data-qfc-pix-rule style="border:1px solid #f3b761;border-radius:12px;padding:11px;background:#fff8ed"><strong>Plano Livre: Pix somente pelo Quem Faz</strong><p class="text--sm" style="margin:4px 0 0">Depois de confirmar a conclusão, pague o valor integral do serviço apenas pelo Pix gerado no aplicativo. Nunca pague diretamente ao profissional deste atendimento. O repasse de 87% será feito manualmente pelo Quem Faz após a confirmação do banco.</p></section>');
   if(valor)row.push('<p style="margin:0">Valor proposto: <strong>'+price(valor)+'</strong>'+(who==='profissional'?' · comissão '+(estado==='confirmado'?'confirmada':'prevista')+' (13%): <strong>'+price(Math.round(valor*0.13))+'</strong> · sua parte (87%): <strong>'+price(valor-Math.round(valor*0.13))+'</strong>':'')+'</p>');
   if(who==='profissional' && s.contratado_em && estado!=='confirmado')row.push('<p class="text--sm" style="margin:0">Orçamento aceito pelo cliente. A comissão é somente prevista até ele confirmar a conclusão e o valor final com o código de seis dígitos.</p>');
   if(estado==='confirmado')row.push('<p class="text--sm" style="margin:0">Contratação, valor e conclusão confirmados.</p>'+(who==='profissional'?'<p>A comissão de 13% foi gerada automaticamente. Pague em até 48 horas pela carteira.</p><a class="btn btn--primary" href="#/profissional/carteira">Ver Pix da comissão</a>':''));
   if(resposta==='divergencia')row.push('<p class="text--sm" style="margin:0">As respostas não coincidem. Nenhuma comissão foi aprovada automaticamente.</p>');
   if(who==='profissional'&&(['pendente','negociando'].includes(estado)||(estado==='informado'&&resposta==='divergencia'))&&(!resposta||resposta==='divergencia'||resposta==='negociando')){
    row.push('<form data-qfc-form style="display:grid;gap:8px"><label class="text--sm" for="qfc-valor">Valor combinado do serviço (R$)</label><input id="qfc-valor" data-qfc-valor class="input" inputmode="decimal" autocomplete="off" placeholder="Ex.: 350,00" required style="min-height:44px" value="'+(valor?(valor/100).toFixed(2).replace('.',','):'')+'"><button type="submit" class="btn btn--primary">'+(prop?'Atualizar orçamento do cliente':'Apresentar orçamento ao cliente')+'</button></form>');
    row.push('<button type="button" class="btn btn--outline" data-qfc-action="nao_fechou">Não fechei este serviço</button>');
   }
   if(who==='cliente'){
    if(['negociando','informado'].includes(estado)&&valor&&(!resposta||resposta==='confirmado'||resposta==='negociando')){
      if(separado&&resposta!=='confirmado')row.push('<p>O profissional apresentou um orçamento. Você contratou esse serviço?</p><button type="button" class="btn btn--primary" data-qfc-action="contratar">Aceitei o orçamento</button><button type="button" class="btn btn--outline" data-qfc-action="negociando">Ainda estou negociando</button>');
      if(!separado||resposta==='confirmado')

      row.push('<form data-qfc-concluir style="display:grid;gap:10px"><p style="margin:0">Código de segurança do seu pedido: <strong>'+escapeHTML(s.codigo_seguranca||'Atualize o chat')+'</strong></p><label>Valor final do serviço (R$)<input class="input" name="valor_final" inputmode="decimal" value="'+(Number(s.valor_aceito_centavos??valor)/100).toFixed(2).replace('.',',')+'" required></label><label>Digite o código do pedido<input class="input" name="codigo_seguranca" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required></label><label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="concluido" required>Confirmo que contratei este profissional, que o serviço foi concluído e confirmo o valor final informado acima.</label><button type="submit" class="btn btn--primary">Confirmar conclusão e valor</button></form>');
      row.push('<button type="button" class="btn btn--outline" data-qfc-action="corrigir_valor">Corrigir valor</button>');
      row.push('<button type="button" class="btn btn--outline" data-qfc-action="nao_contratei">Não contratei</button>');
    }else if(estado==='recusado'&&!resposta){
      row.push('<p class="text--sm" style="margin:0">O profissional disse que não fechou. Você o contratou?</p>');
      row.push('<button type="button" class="btn btn--primary" data-qfc-action="contestar">Sim, contratei — contestar</button>');
      row.push('<button type="button" class="btn btn--outline" data-qfc-action="nao_contratei">Não contratei</button>');
    }else if(estado==='pendente'&&!resposta){
      row.push('<button type="button" class="btn btn--outline" data-qfc-action="nao_contratei">Não contratei este profissional</button>');
    }
   }
   if(who==='profissional'){
    const suporteMensagem='Olá, suporte Quem Faz! Sou profissional do plano Quem Faz Livre. Desbloqueei o pedido #'+callId+' e o cliente não respondeu. Poderiam verificar o contato?';
    const suporteUrl='https://wa.me/5535998845703?text='+encodeURIComponent(suporteMensagem);
    row.push('<details class="qfc-support" style="padding:10px;border:1px solid #cad9ec;border-radius:12px;background:#fff"><summary class="text--sm" style="cursor:pointer;font-weight:650">Precisa de ajuda da equipe Quem Faz?</summary><p class="text--sm">O suporte não é o chat com o cliente. Use a conversa acima para negociar.</p><a class="btn btn--outline btn--sm" style="width:auto;min-height:40px" href="'+escapeHTML(suporteUrl)+'" target="_blank" rel="noopener noreferrer">Falar com suporte no WhatsApp</a></details>');
   }
   row.push('<p class="text--sm" data-qfc-status role="status" style="margin:0">Confira o valor combinado antes de confirmar a contratação.</p>');
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
   g.QFComissao13?.bindResumo(pane.querySelector('[data-qfc-form]'));
   pane.querySelector('[data-qfc-form]')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const raw=pane.querySelector('[data-qfc-valor]').value.trim();
    if(!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(raw)){setStatus('Informe um valor em reais, como 350,00.');return;}
    const cents=Math.round(Number(raw.replace(',','.'))*100);
    if(!Number.isSafeInteger(cents)||cents<100||cents>100000000){setStatus('Informe um valor entre R$ 1 e R$ 1.000.000.');return;}
    await run('propor',cents);
   });
   pane.querySelector('[data-qfc-concluir]')?.addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;const codigo=form.elements.codigo_seguranca.value.trim();if(!/^[0-9]{6}$/.test(codigo)||!form.elements.concluido.checked){setStatus('Confira o código e confirme a conclusão do serviço.');return;}const finalValue=Math.round(Number(form.elements.valor_final.value.replace(',','.'))*100);if(!Number.isSafeInteger(finalValue)||finalValue<100||finalValue>100000000){setStatus('Confira o valor final.');return;}await run('aceitar',finalValue,codigo,true);});
   pane.querySelectorAll('[data-qfc-action]').forEach(button=>button.addEventListener('click',async()=>{
    const acao=button.dataset.qfcAction;
    const ask={aceitar:'Confirmar a contratação pelo valor informado?',nao_fechou:'Informar que não fechou? O cliente poderá confirmar ou contestar.',nao_contratei:'Confirmar que NÃO contratou este profissional?',contestar:'Você realmente contratou este profissional? O administrador analisará a divergência.'};
    if(ask[acao]&&acao!=='aceitar'&&acao!=='corrigir_valor'&&!g.confirm(ask[acao]))return;
    await run(acao,['aceitar','contratar'].includes(acao)?valor:null);
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
  async function run(acao,valor,codigo=null,concluido=false){
    if(busy)return;
    busy=true;pane.querySelectorAll('button,input').forEach(x=>x.disabled=true);
    setStatus('Registrando no Quem Faz…');
    try{
      await rpc(acao,valor,codigo,concluido);
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
 async function avisosCliente(content,user){
  if(!content||!user?.id||!g.QFCloud?.client)return;
  try{
   const {data,error}=await g.QFCloud.client.rpc('qf13_minhas_confirmacoes');if(error||!content.isConnected||!Array.isArray(data)||!data.length)return;
   if(content.querySelector('[data-qf13-client-notices]'))return;
   const box=g.document.createElement('section');box.dataset.qf13ClientNotices='';box.className='card stack--sm';box.style.cssText='border:1px solid #efaa57;background:#fff8ef;padding:14px;border-radius:14px;margin:12px 0';
   box.innerHTML='<strong>Confirme sua contratação</strong>'+data.map(x=>'<div style="display:grid;gap:8px;margin-top:8px"><p style="margin:0">'+escapeHTML(x.profissional)+' informou que vocês fecharam por <strong>'+price(x.valor_centavos)+'</strong>. Confira e confirme.</p><a class="btn btn--primary" href="'+escapeHTML(x.rota)+'">Conferir contratação</a></div>').join('');
   (content.querySelector('.view')||content).prepend(box);
  }catch(_){}
 }
 function install(){
  const Screens=g.Screens;
  if(!Screens||Screens._qfChatContratoInstalled)return;
  Screens._qfChatContratoInstalled=true;
  const prev=Screens.afterRender;
  Screens.afterRender=function(pattern,content,params,user){
    if(prev)prev.apply(this,arguments);
    if(['/cliente/home','/cliente/pedidos','/cliente/pedido/:id'].includes(pattern))avisosCliente(content,user);
    if(pattern==='/profissional/chat/:id'||pattern==='/cliente/chat/:id/:profId'){
      mount(content.querySelector('[data-qf-chat-root]'),params,user,pattern.startsWith('/profissional/')?'profissional':'cliente');
    }
  };
  const path=g.location?.hash||'',session=g.DB?.getSession?.();
  if(/^#\/cliente\/(home|pedidos|pedido\/)/.test(path)&&session?.userId)avisosCliente(g.document.getElementById('app-content'),{id:session.userId});
 }
 g.QFChatContratacao={mount,install,avisosCliente};
 install();
 if(g.document?.readyState==='loading')g.document.addEventListener('DOMContentLoaded',install,{once:true});
})(window);
