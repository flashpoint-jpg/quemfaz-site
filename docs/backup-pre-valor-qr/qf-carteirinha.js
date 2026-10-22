/* Quem Faz — acesso à carteirinha exclusiva no Perfil do profissional. */
(function (global) {
 'use strict';
 var tokenCache=null, carregando=false;
 function sessionId() {
   try {
     var s=global.DB&&DB.getSession&&DB.getSession();
     return s&&s.role==='profissional'&&/^[0-9a-f-]{36}$/i.test(String(s.userId||''))?String(s.userId):'';
   } catch(_){return '';}
 }
 function show() {
   var shell=document.getElementById('app-shell'),id=sessionId();
   // V11.85: a carteirinha saiu da tela inicial e fica no Perfil, logo abaixo dos atalhos.
   if(!shell||shell.dataset.route!=='profissional-perfil'||!id)return;
   var status=shell.querySelector('[data-qf-perfil-atalhos]');
   if(!status)return;
   var card=shell.querySelector('[data-qf-carteirinha-home]');
   if(!card){
     card=document.createElement('section');
     card.className='card qf-carteirinha-home';
     card.setAttribute('data-qf-carteirinha-home','');
     card.innerHTML='<div class="qf-carteirinha-home__top"><span class="qf-carteirinha-home__icon" aria-hidden="true">▣</span><div><h2>Ganhe pontos com avaliações</h2><p>Imprima sua carteirinha e peça ao cliente para avaliar seu atendimento pelo QR Code.</p></div></div><div data-qf-carteirinha-acoes class="qf-carteirinha-home__acoes">Preparando sua carteirinha...</div>';
     status.insertAdjacentElement('afterend',card);
   }
   if(tokenCache&&tokenCache.id===id){
     var acoes=card.querySelector('[data-qf-carteirinha-acoes]');
     if(acoes&&!acoes.querySelector('a')){
       var link='/carteirinha.html?token='+encodeURIComponent(tokenCache.token);
       acoes.innerHTML='<a class="btn btn--primary qf-carteirinha-home__btn" href="'+link+'&imprimir=1">Imprimir minha carteirinha</a><a class="qf-carteirinha-home__view" href="'+link+'">Ver carteirinha</a>';
     }
     return;
   }
   if(carregando||!global.QFCloud||!QFCloud.client)return;
   carregando=true;
   QFCloud.client.rpc('qf_minha_carteirinha').then(function(r){
     if(r.error||!r.data||!r.data.ok||!/^[0-9a-f-]{36}$/i.test(String(r.data.token||'')))throw new Error('Não foi possível preparar a carteirinha.');
     tokenCache={id:id,token:r.data.token};
     if(sessionId()===id)show();
   }).catch(function(){
     var ativo=document.querySelector('[data-qf-carteirinha-acoes]');
     if(ativo&&sessionId()===id)ativo.textContent='Não foi possível abrir a carteirinha agora. Atualize a tela para tentar novamente.';
   }).finally(function(){carregando=false;});
 }
 var style=document.createElement('style');
 style.textContent='.qf-carteirinha-home{margin-top:12px;padding:18px!important;border-left:4px solid #ff790a!important}.qf-carteirinha-home__top{display:flex;align-items:flex-start;gap:13px}.qf-carteirinha-home__icon{flex:0 0 44px;width:44px;height:44px;border:2px solid #ff790a;border-radius:12px;display:grid;place-items:center;color:#fa7400;font-size:29px;font-weight:bold}.qf-carteirinha-home h2{font-size:18px;line-height:1.3;color:#102a52;margin:0 0 5px;font-weight:800}.qf-carteirinha-home p{font-size:14px;line-height:1.48;color:#48566b;margin:0}.qf-carteirinha-home__acoes{font-size:13px;color:#48566b;margin-top:12px}.qf-carteirinha-home__btn{display:flex;justify-content:center;margin-top:15px;width:100%;background:#ff790a!important;color:#101d38!important;font-weight:800}.qf-carteirinha-home__view{display:block;text-align:center;font-size:14px;color:#102a52;font-weight:700;text-decoration:underline;margin-top:14px}';
 document.head.appendChild(style);
 var queued=false;
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(function(){queued=false;show();});}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule);else schedule();
 global.addEventListener('hashchange',schedule);
 new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
})(window);
