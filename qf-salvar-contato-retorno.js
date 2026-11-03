/* Quem Faz — salvar contato para continuar mais tarde, clientes e profissionais. */
(function(){
'use strict';
var CSS='.qf-salvar-contato{display:flex;align-items:center;gap:8px;justify-content:center;width:100%;min-height:46px;margin:10px 0;padding:10px 14px;border:1px solid #b7cde5;border-radius:12px;background:#f1f7ff;color:#164b86;font-size:14px;font-weight:750;cursor:pointer;line-height:1.35}.qf-salvar-contato:hover{background:#e6f1fe}.qf-salvar-contato svg{width:19px;height:19px;flex-shrink:0}.qf-salvar-info{font-size:12px;color:#58677b;line-height:1.5;margin:3px 0 9px}.qf-salvar-sheet .input,.qf-salvar-sheet .select{width:100%}.qf-salvar-confirm{padding:12px;background:#eff8f0;border-radius:12px;margin-bottom:12px}.qf-salvar-confirm input{width:100%}';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function getType(){var h=location.hash||'';if(/^#\/auth\/profissional\/(cadastro|login)/.test(h))return 'profissional';if(/^#\/auth\/cliente\/cadastro/.test(h))return 'cliente';return ''}
function url(tipo){return 'https://quemfazservico.com.br/#/auth/'+(tipo==='cliente'?'cliente':'profissional')+'/cadastro'}
function input(f,name){var e=f&&f.querySelector('[name="'+name+'"]');return e?String(e.value||'').trim():''}
function open(tipo,from){
 var pu=window.PU,cl=window.QFCloud;
 if(!pu||!pu.openSheet){alert('Abra o site novamente para salvar o contato.');return}
 var f=from.closest('form')||document;
 var nome=input(f,'nome'),whats=input(f,'telefone')||input(f,'whatsapp'),email=input(f,'email');
 pu.openSheet('<div class="stack qf-salvar-sheet"><h3 class="sheet__title">Continuar depois</h3>'+
  '<p class="text text--secondary">Deixe seu contato salvo com a equipe Quem Faz. Você poderá voltar pelo link quando quiser. '+(tipo==='profissional'?'Não há cobrança agora.':'Publicar pedido é grátis.')+'</p>'+
  '<form id="qf-salvar-contato-form" class="stack" novalidate>'+
  '<label class="field"><span class="field__label">Seu nome</span><input class="input" name="nome" maxlength="120" required value="'+esc(nome)+'" placeholder="Seu nome"></label>'+
  '<label class="field"><span class="field__label">Seu WhatsApp com DDD</span><input class="input" name="whatsapp" inputmode="tel" type="tel" required value="'+esc(whats)+'" placeholder="(11) 99999-9999"></label>'+
  '<label class="field"><span class="field__label">E-mail (opcional)</span><input class="input" name="email" type="email" maxlength="160" value="'+esc(email)+'"></label>'+
  '<label class="field"><span class="field__label">Quando pretende voltar?</span><select class="select" name="quando"><option value="semana_que_vem">Na próxima semana</option><option value="amanha">Amanhã</option><option value="quando_puder">Ainda não sei</option></select></label>'+
  '<label class="field"><span class="field__label">Observação (opcional)</span><textarea class="textarea" name="obs" maxlength="350" rows="2" placeholder="'+(tipo==='profissional'?'Ex.: vou pagar meu plano semana que vem':'Ex.: vou publicar meu pedido quando estiver em casa')+'"></textarea></label>'+
  '<label class="row" style="gap:9px;align-items:flex-start;font-size:13px;line-height:1.45"><input type="checkbox" name="consent" required style="width:20px;height:20px;flex-shrink:0"> Autorizo o Quem Faz a guardar estes dados e me chamar pelo WhatsApp para concluir meu '+(tipo==='profissional'?'cadastro':'pedido')+'.</label>'+
  '<button type="submit" class="btn btn--primary" style="width:100%">Salvar meu contato</button><div id="qf-salvar-erro" role="alert" class="text--sm" style="color:#b42318"></div>'+
  '</form></div>');
 var form=document.getElementById('qf-salvar-contato-form');if(!form)return;
 form.addEventListener('submit',async function(ev){
  ev.preventDefault();var btn=form.querySelector('button[type="submit"]'),err=document.getElementById('qf-salvar-erro'),fd=new FormData(form);
  if(!form.querySelector('[name="consent"]').checked){err.textContent='Autorize o contato para salvar.';return}
  var telefone=String(fd.get('whatsapp')||'').replace(/[^0-9]/g,'');
  if(telefone.indexOf('55')===0&&telefone.length===13)telefone=telefone.slice(2);
  if(!/^[0-9]{2}9[0-9]{8}$/.test(telefone)){err.textContent='Informe um WhatsApp com DDD e 9 dígitos.';return}
  if(!cl||!cl.client){err.textContent='Sem conexão com o sistema. Tente novamente.';return}
  btn.disabled=true;err.textContent='Salvando…';
  try{
   var r=await cl.client.rpc('qf_retorno_salvar',{
    p_tipo:tipo,p_nome:String(fd.get('nome')||''),p_whatsapp:telefone,
    p_email:String(fd.get('email')||''),p_proximo_contato:String(fd.get('quando')||'semana_que_vem'),
    p_observacao:String(fd.get('obs')||''),p_consent:true
   });
   if(r.error||!r.data||!r.data.ok)throw Error(r.error&&r.error.message||r.data&&r.data.error||'Não foi possível salvar.');
   var link=url(tipo),texto='Meu link para voltar ao Quem Faz Serviços quando eu puder: '+link;
   var wa='https://wa.me/55'+telefone+'?text='+encodeURIComponent(texto);
   pu.openSheet('<div class="stack qf-salvar-sheet"><div class="qf-salvar-confirm"><strong>Contato salvo com sucesso!</strong><p class="qf-salvar-info">A equipe já pode localizar seu contato e chamá-lo depois. Não houve cobrança nem ativação de plano.</p></div>'+
   '<p class="text--sm">Guarde também este link para voltar ao '+(tipo==='profissional'?'cadastro profissional':'pedido grátis')+'. O preenchimento anterior pode precisar ser repetido.</p>'+
   '<input class="input" id="qf-link-cadastro-salvo" readonly value="'+esc(link)+'">'+
   '<button type="button" class="btn btn--outline" id="qf-copy-link-salvo">Copiar meu link</button>'+
   '<a class="btn btn--primary" target="_blank" rel="noopener noreferrer" href="'+esc(wa)+'">Enviar link para meu WhatsApp</a>'+
   '<button type="button" class="btn btn--ghost" id="qf-fechar-salvo">Fechar</button></div>');
   var copiar=document.getElementById('qf-copy-link-salvo');if(copiar)copiar.onclick=async function(){try{await navigator.clipboard.writeText(link);pu.toast('Link copiado.','success')}catch(_){var t=document.getElementById('qf-link-cadastro-salvo');if(t){t.select();document.execCommand('copy')}}};
   var close=document.getElementById('qf-fechar-salvo');if(close)close.onclick=function(){pu.closeSheet()};
  }catch(e){err.textContent=e.message||'Não foi possível salvar.';btn.disabled=false}
 });
}
function mount(){
 var tipo=getType();if(!tipo)return;
 var supports=document.querySelectorAll('#app-content .qf-whatsapp-support');
 supports.forEach(function(s){
  if(s.nextElementSibling&&s.nextElementSibling.classList.contains('qf-salvar-contato'))return;
  var b=document.createElement('button');b.type='button';b.className='qf-salvar-contato';
  b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>'+
    '<span>Vou continuar depois — salvar meu contato</span>';
  s.insertAdjacentElement('afterend',b);
  b.addEventListener('click',function(){open(tipo,b)});
 });
 if(tipo==='profissional'){
  ['5','6'].forEach(function(n){
   var step=document.querySelector('#cadastro-prof-form [data-step="'+n+'"]');if(!step||step.querySelector('.qf-salvar-contato'))return;
   var b=document.createElement('button');b.type='button';b.className='qf-salvar-contato';
   b.textContent='Vou pagar depois — guardar meu contato e link';
   step.appendChild(b);b.addEventListener('click',function(){open(tipo,b)});
  });
 }
}
var scheduled=false;function soon(){if(scheduled)return;scheduled=true;setTimeout(function(){scheduled=false;mount()},120)}
function start(){
 if(!document.getElementById('qf-salvar-style')){var st=document.createElement('style');st.id='qf-salvar-style';st.textContent=CSS;document.head.appendChild(st)}
 var root=document.getElementById('app-shell');if(root)new MutationObserver(soon).observe(root,{childList:true,subtree:true});
 window.addEventListener('hashchange',soon);mount();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();