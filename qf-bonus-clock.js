/* Quem Faz: relógio/avisos visuais de bônus removidos a pedido do administrador.
   Créditos e recargas são tratados exclusivamente pelo banco de dados. */
(function(){
  'use strict';
  function removerRelogio(){
    document.querySelectorAll('#qf-bonus-validade-card').forEach(function(el){el.remove();});
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',removerRelogio,{once:true});
  } else {
    removerRelogio();
  }
  window.addEventListener('hashchange',removerRelogio);
  new MutationObserver(removerRelogio).observe(document.documentElement,{childList:true,subtree:true});
})();