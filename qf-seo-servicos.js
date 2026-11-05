/* Integração exclusiva das páginas SEO: usa o atendimento e a publicação existentes. */
(function(g){
 'use strict';
 const config=JSON.parse(document.getElementById('seo-config').textContent),target=document.getElementById('seo-order');
 let attempts=0;
 function ready(){
  if(!g.QFAtendimento||!g.DB||!g.QFCloud||!g.QFClienteAcesso){
   if(++attempts<100){g.setTimeout(ready,100);return;}
   target.replaceChildren();const p=document.createElement('p');p.setAttribute('role','alert');p.textContent='Não foi possível carregar o formulário. Atualize a página ou abra o Quem Faz.';const a=document.createElement('a');a.href='/?servico='+encodeURIComponent(config.id);a.textContent='Abrir formulário no Quem Faz';target.append(p,a);return;
  }
  if(!g.DB.state)g.DB.load();
  if(g.QFCloud.enabled)g.QFCloud.prepareLocalState();
  // O shell do app permanece fora da apresentação; o atendimento é montado nesta URL.
  g.QFPedidoHome={start:()=>intro(),isBusy:()=>!!target.querySelector('[data-qf-atendimento]'),published:async(req)=>{
   target.replaceChildren();const h=document.createElement('h2');h.textContent='Pedido publicado!';const p=document.createElement('p');p.textContent='Seu pedido foi registrado. Acompanhe as respostas dos profissionais no Quem Faz.';const a=document.createElement('a');a.className='seo-cta';a.href='/#/cliente/pedido/'+encodeURIComponent(req.id);a.textContent='Acompanhar meu pedido';target.append(h,p,a);
  }};
  function intro(){start();}
  function start(){target.innerHTML=g.QFAtendimento.html();g.QFAtendimento.mount(target,{catId:config.id,embedded:true,compact:true,service:config.service,placeholder:config.placeholder},null);}
  start();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})(window);
