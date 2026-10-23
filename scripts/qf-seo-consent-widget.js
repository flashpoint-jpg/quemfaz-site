/* Consentimento SEO opt-in: não interfere em cadastro, pedidos ou carteira.
   Desabilitado até que a migração de consentimento esteja aplicada e validada. */
(function(global){
 'use strict';
 const STATEMENT='Autorizo a exibição pública das informações profissionais que selecionei no Quem Faz Serviço, incluindo meu nome profissional, serviços oferecidos e regiões atendidas, para que clientes possam encontrar meu perfil na plataforma e em mecanismos de busca.';
 const KEY='qf_seo_consent_pending';
 function consentFields(){
   const label=document.createElement('label');
   const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=false;
   label.append(checkbox,document.createTextNode(' '+STATEMENT));
   const details=document.createElement('p');
   details.textContent='Poderão aparecer no Quem Faz e no Google: nome profissional, serviços e cidades atendidas. CPF, telefone privado, e-mail, endereço exato, documentos, coordenadas e dados financeiros não serão divulgados.';
   const link=document.createElement('a');link.href='/politica-de-privacidade';link.textContent='Ler política de privacidade';
   return {label,checkbox,details,link};
 }
 function signup(form){
   if(form.querySelector('[data-qf-seo-signup]'))return;
   const section=document.createElement('details');section.className='qf-step__opt';section.dataset.qfSeoSignup='true';
   const title=document.createElement('summary');title.textContent='Divulgação pública (opcional)';
   const fields=consentFields();
   const note=document.createElement('p');note.textContent='Sua escolha não interfere no cadastro nem no recebimento de chamados. Se marcar, confirme novamente em Meu perfil após entrar. Nada será publicado automaticamente.';
   section.append(title,fields.label,fields.details,fields.link,note);
   const submit=form.querySelector('button[type="submit"]');
   if(submit)submit.parentElement.insertBefore(section,submit);else form.append(section);
   form.addEventListener('submit',()=>{try{if(fields.checkbox.checked)sessionStorage.setItem(KEY,'1');else sessionStorage.removeItem(KEY);}catch(_){}},true);
 }
 async function profile(host){
   if(host.querySelector('[data-qf-seo-profile]'))return;
   const section=document.createElement('section');section.dataset.qfSeoProfile='true';section.className='card stack';
   const title=document.createElement('h3');title.textContent='Visibilidade pública do perfil';
   const fields=consentFields();
   const status=document.createElement('p');status.setAttribute('role','status');
   const save=document.createElement('button');save.type='button';save.className='btn btn--outline';save.textContent='Salvar autorização';save.disabled=true;
   section.append(title,fields.label,fields.details,fields.link,save,status);
   host.append(section);
   const client=global.QFCloud&&global.QFCloud.client;
   if(!client){status.textContent='A divulgação pública ainda não está disponível.';fields.checkbox.disabled=true;return;}
   let user;
   try{const result=await client.auth.getUser();user=result.data&&result.data.user;}catch(_){}
   if(!user){status.textContent='Entre novamente na sua conta para configurar a divulgação.';fields.checkbox.disabled=true;return;}
   const read=await client.from('qf_seo_consentimentos').select('autorizado').eq('profissional_id',user.id).maybeSingle();
   if(read.error){status.textContent='Divulgação pública indisponível até a migração ser validada. Seu perfil permanece privado.';fields.checkbox.disabled=true;return;}
   fields.checkbox.checked=Boolean(read.data&&read.data.autorizado);
   try{if(!fields.checkbox.checked&&sessionStorage.getItem(KEY)==='1'){status.textContent='Você marcou interesse no cadastro. Para autorizar, marque a opção aqui e salve.';sessionStorage.removeItem(KEY);}}catch(_){}
   save.disabled=false;
   save.addEventListener('click',async()=>{
     save.disabled=true;
     const enabled=fields.checkbox.checked;
     const now=new Date().toISOString();
     const result=await client.from('qf_seo_consentimentos').upsert({
       profissional_id:user.id,autorizado:enabled,autorizado_em:enabled?now:null,atualizado_em:now
     },{onConflict:'profissional_id'});
     if(result.error){status.textContent='Não foi possível salvar. Consulte novamente seu status antes de alterar a preferência.';}
     else{status.textContent=enabled?'Autorização registrada.':'Autorização revogada. Seu perfil não deve aparecer em consultas públicas.';}
     save.disabled=false;
   });
 }
 let scheduled=false;
 function scan(){
   scheduled=false;
   const form=document.getElementById('cadastro-prof-form');if(form)signup(form);
   if((global.location.hash||'').startsWith('#/profissional/perfil')){
     const host=document.querySelector('#app-content .view.stack');
     if(host&&!host.querySelector('[data-qf-seo-profile]'))profile(host);
   }
 }
 function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(scan);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{
   new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});schedule();
 });else{new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});schedule();}
 global.QFSeoConsent={statement:STATEMENT,scan};
})(window);
