/* Quem Faz - relogio de validade do bonus promocional.
   Dados verificados em tempo real na funcao qf_meu_bonus_validade; recargas pagas nao vencem. */
(function(global){
  'use strict';
  var CARD_ID='qf-bonus-validade-card';
  var lastUser='',lastFetch=0,loading=false,data=null,queued=false;
  function userId(){
    try{
      var session=global.DB&&DB.getSession&&DB.getSession();
      return session&&session.role==='profissional'&&/^[0-9a-f-]{36}$/i.test(String(session.userId||''))?String(session.userId):'';
    }catch(e){return '';}
  }
  function money(centavos){
    return (Number(centavos||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  }
  function view(){
    var shell=document.getElementById('app-shell');
    if(!shell)return null;
    var hash=location.hash||'';
    var home=shell.dataset.route==='profissional-home'||hash==='#/profissional/home';
    var wallet=/^#\/profissional\/carteira(?:$|[?/])/.test(hash);
    var services=/^#\/profissional\/servicos(?:$|[?/])/.test(hash);
    if(!home&&!wallet&&!services)return null;
    var root=document.getElementById('app-content')||shell;
    var anchor=null;
    if(home)anchor=root.querySelector('.qf-prof-status');
    else if(wallet){
      var candidates=root.querySelectorAll('.view .card');
      for(var i=0;i<candidates.length;i++){
        if((candidates[i].textContent||'').indexOf('Saldo disponível')!==-1){anchor=candidates[i];break;}
      }
    }else anchor=root.querySelector('.qf-services-tabs,.qf-outros-tabs');
    return {root:root,anchor:anchor};
  }
  function remove(){var card=document.getElementById(CARD_ID);if(card)card.remove();}
  function display(){
    var u=userId(),v=view();
    if(!u||!v||!data||lastUser!==u||!data.ok||!data.tem_bonus||Number(data.saldo_bonus_centavos||0)<=0){
      remove();return;
    }
    var ends=Date.parse(data.expira_em||'');
    if(!Number.isFinite(ends)||ends<=Date.now()){remove();refresh(true);return;}
    var card=document.getElementById(CARD_ID);
    if(!card){
      card=document.createElement('section');
      card.id=CARD_ID;
      card.className='qf-bonus-validade';
      card.setAttribute('aria-label','Prazo de validade do seu bônus promocional');
      card.innerHTML='<div class="qf-bonus-top"><span class="qf-bonus-clockicon" aria-hidden="true"></span>'+
        '<div><strong>Faltam <span data-qf-bonus-days>10</span> dias para o seu bônus acabar</strong>'+
        '<small>Bônus promocional disponível: <b data-qf-bonus-money></b></small></div></div>'+
        '<div class="qf-bonus-timer" data-qf-bonus-timer aria-label="Contagem regressiva"></div>'+
        '<p>Clientes estão publicando serviços. Aproveite seus créditos promocionais para <b>desbloquear pedidos</b> antes do vencimento.</p>'+
        '<button type="button" class="btn btn--primary qf-bonus-cta" data-nav="/profissional/servicos/disponiveis">Ver pedidos disponíveis</button>'+
        '<small class="qf-bonus-note">Somente o bônus promocional tem prazo. Seu saldo de recargas pagas não expira.</small>';
    }
    if(!card.isConnected){
      if(v.anchor)v.anchor.insertAdjacentElement('afterend',card);
      else{
        var target=v.root.querySelector('.view')||v.root;
        target.insertAdjacentElement('afterbegin',card);
      }
    }
    var el=card.querySelector('[data-qf-bonus-money]');
    var value=money(data.saldo_bonus_centavos);
    if(el&&el.textContent!==value)el.textContent=value;
    tick();
  }
  function tick(){
    var card=document.getElementById(CARD_ID);
    if(!card||!data||!data.expira_em)return;
    var ms=Date.parse(data.expira_em)-Date.now();
    if(!Number.isFinite(ms)||ms<=0){remove();refresh(true);return;}
    var d=Math.floor(ms/86400000),h=Math.floor(ms%86400000/3600000);
    var m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000);
    var headerDays=Math.ceil(ms/86400000);
    var daysEl=card.querySelector('[data-qf-bonus-days]');
    if(daysEl){
      daysEl.textContent=String(headerDays);
      var strong=daysEl.closest('strong');
      if(strong)strong.lastChild.textContent=headerDays===1?' dia para o seu bônus acabar':' dias para o seu bônus acabar';
    }
    function pad(x){return String(x).padStart(2,'0');}
    var clock=card.querySelector('[data-qf-bonus-timer]');
    var clockText=pad(d)+'d  '+pad(h)+'h  '+pad(m)+'min  '+pad(s)+'s';
    if(clock&&clock.textContent!==clockText)clock.textContent=clockText;
  }
  function refresh(force){
    var id=userId();
    if(id!==lastUser){lastUser=id;data=null;lastFetch=0;remove();}
    if(!id||!view()||loading||!global.QFCloud||!QFCloud.client)return;
    if(!force&&Date.now()-lastFetch<60000)return;
    loading=true;lastFetch=Date.now();
    QFCloud.client.rpc('qf_meu_bonus_validade').then(function(r){
      if(userId()!==id)return;
      if(r.error||!r.data||!r.data.ok)throw new Error('Falha ao consultar a validade do bônus');
      data=r.data;display();
    }).catch(function(e){
      if(userId()===id){data=null;remove();}
      if(global.console&&console.warn)console.warn('Quem Faz: prazo do bônus indisponível',e);
    }).finally(function(){loading=false;});
  }
  function schedule(){
    if(queued)return;
    queued=true;
    requestAnimationFrame(function(){queued=false;display();refresh(false);});
  }
  var style=document.createElement('style');
  style.textContent=
    '#'+CARD_ID+'{background:#fff;border:1px solid #ffcf9d;border-left:5px solid #f5821f;'+
    'border-radius:17px;box-shadow:0 6px 20px rgba(10,38,80,.08);padding:16px;margin:14px 0;'+
    'color:#102c55;max-width:100%;box-sizing:border-box}'+
    '#'+CARD_ID+' .qf-bonus-top{display:flex;gap:12px;align-items:center}'+
    '#'+CARD_ID+' .qf-bonus-clockicon{flex:0 0 40px;height:40px;border:3px solid #f5821f;'+
    'border-radius:50%;position:relative;box-sizing:border-box}'+
    '#'+CARD_ID+' .qf-bonus-clockicon:before{content:"";position:absolute;width:2px;height:12px;'+
    'background:#102c55;left:17px;top:6px;border-radius:2px}'+
    '#'+CARD_ID+' .qf-bonus-clockicon:after{content:"";position:absolute;width:10px;height:2px;'+
    'background:#102c55;left:17px;top:18px;border-radius:2px}'+
    '#'+CARD_ID+' .qf-bonus-top strong{display:block;font-weight:800;font-size:16px;line-height:1.35}'+
    '#'+CARD_ID+' .qf-bonus-top small{display:block;color:#51617a;margin-top:3px;font-size:12px}'+
    '#'+CARD_ID+' .qf-bonus-timer{margin:13px 0 10px;padding:11px 8px;border-radius:12px;'+
    'background:#f1f5fb;font-size:23px;line-height:1.2;font-variant-numeric:tabular-nums;'+
    'text-align:center;font-weight:800;letter-spacing:1px;color:#0c2b58}'+
    '#'+CARD_ID+' p{font-size:13px;line-height:1.5;margin:0 0 12px;color:#455775}'+
    '#'+CARD_ID+' .qf-bonus-cta{display:flex;justify-content:center;align-items:center;'+
    'background:#f5821f!important;color:#10203e!important;font-weight:800;width:100%;'+
    'min-height:43px;border-radius:10px}'+
    '#'+CARD_ID+' .qf-bonus-note{display:block;font-size:11px;color:#64748b;line-height:1.45;margin-top:10px}';
  document.head.appendChild(style);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule);
  else schedule();
  global.addEventListener('hashchange',schedule);
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
  global.setInterval(function(){tick();refresh(false);},1000);
})(window);
