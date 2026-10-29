/* Recuperação por link ao titular. Nunca mostra senha nem troca a sessão do administrador. */
(function(g){'use strict';
 const esc=v=>String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const admin=()=>g.DB?.getSession()?.role==='admin';
 function open(email='',kind='profissional',phone=''){
  if(!admin())return;const client=g.QFAdminCloud?.client;if(!client)return;
  const dialog=document.createElement('dialog');dialog.className='qf-benefit-modal';
  dialog.innerHTML='<h2>Recuperar senha</h2><p>O titular recebe um link para escolher a nova senha. A senha atual não fica visível para o administrador.</p><form><label>Tipo de acesso<select name="tipo"><option value="profissional">Profissional / pré-cadastro profissional</option><option value="cliente">Cliente com telefone e senha</option></select></label><label>E-mail cadastrado<input class="input" name="email" type="email" required value="'+esc(email)+'" autocomplete="off"></label><label data-reset-phone>Telefone cadastrado do cliente<input class="input" name="telefone" inputmode="tel" value="'+esc(phone)+'" autocomplete="off"></label><p>Para pré-cadastro ainda sem conta criada, primeiro é necessário concluir o cadastro. O link só funciona para uma conta existente e para o e-mail correto.</p><button class="btn btn--primary" type="submit">Enviar link de recuperação</button><p role="status" aria-live="polite"></p></form><button type="button" class="btn btn--outline" data-reset-close>Fechar</button>';
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-reset-close]').onclick=()=>dialog.close();
  const form=dialog.querySelector('form'),status=form.querySelector('[role=status]');form.elements.tipo.value=kind;
  const update=()=>{const isClient=form.elements.tipo.value==='cliente';form.querySelector('[data-reset-phone]').hidden=!isClient;form.elements.telefone.required=isClient;};form.elements.tipo.onchange=update;update();
  form.onsubmit=async e=>{e.preventDefault();if(!admin()||!form.reportValidity())return;const button=form.querySelector('[type=submit]');button.disabled=true;status.textContent='Solicitando recuperação…';try{
   const address=form.elements.email.value.trim();
   if(form.elements.tipo.value==='cliente'){
    const response=await client.functions.invoke('quemfaz-cliente-conta',{body:{acao:'esqueci_senha',email:address,telefone:form.elements.telefone.value}});
    if(response.error||!response.data?.ok)throw Error('Não foi possível solicitar a recuperação. Confira e-mail e telefone cadastrados.');
    status.textContent=response.data.mensagem||'Se os dados conferirem com uma conta verificada, o titular receberá o link de recuperação.';
   }else{
    const response=await client.auth.resetPasswordForEmail(address,{redirectTo:'https://quemfazservico.com.br/'});
    if(response.error)throw Error(/rate.limit|too.many/i.test(response.error.message||'')?'Muitas tentativas. Aguarde um minuto.':'Não foi possível solicitar o link agora.');
    status.textContent='Solicitação registrada. Se houver uma conta com esse e-mail, o titular receberá o link. Peça para conferir a caixa de spam.';
   }
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}};dialog.showModal();
 }
 function scan(){
  if(!admin())return;const hash=g.location.hash||'',host=document.getElementById('app-content');if(!host)return;
  if(/^#\/admin\/(planos|clientes|profissionais)(?:$|[/?])/.test(hash)&&!host.querySelector('[data-admin-reset-tools]')){
   const row=document.createElement('section');row.className='card qf-reset-tools';row.dataset.adminResetTools='';row.innerHTML='<div><strong>Recuperação de senha</strong><p>Envie ao titular o link para criar uma nova senha.</p></div><button type="button" class="btn btn--outline" data-admin-reset>Recuperar senha de uma conta</button>';host.prepend(row);
  }
  host.querySelectorAll('.qf-pre-record').forEach(record=>{
   const actions=record.querySelector('.qf-pre-actions'),email=record.querySelector('.qf-pre-record-head small')?.textContent?.trim();
   if(!actions||!email||actions.querySelector('[data-admin-reset]'))return;
   const button=document.createElement('button');button.type='button';button.className='btn btn--outline';button.dataset.adminReset=email;button.textContent='Recuperar senha';actions.append(button);
  });
 }
 document.addEventListener('click',e=>{const button=e.target.closest('[data-admin-reset]');if(!button)return;e.preventDefault();let email=button.dataset.adminReset,kind='profissional',phone='';const match=(g.location.hash||'').match(/^#\/admin\/clientes\/([^/?]+)/);if(match){const user=g.DB?.clienteById?.(match[1]);email=email||user?.email;phone=user?.telefone||user?.whatsapp;kind='cliente';}open(email,kind,phone);});
 let pending=false;const schedule=()=>{if(pending)return;pending=true;queueMicrotask(()=>{pending=false;scan();});};
 const init=()=>{new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});g.addEventListener('hashchange',schedule);scan();};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
