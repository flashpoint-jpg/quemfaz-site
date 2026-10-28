/* Quem Faz — resumo real dos cadastros pagos (somente admin, sem indicadores fictícios). */
(function (global) {
  'use strict';
  var PANEL='qf-admin-cadastro-pago';
  var busy=false,lastAt=0,connected=false;
  function toInt(v){ return Math.max(0,Math.floor(Number(v)||0)); }
  function reais(v){return (toInt(v)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function esc(v){return String(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&quot;'}[c];});}
  function metric(title,value){return '<div class="qf-adm-paid-stat"><strong>'+esc(value)+'</strong><span>'+esc(title)+'</span></div>';}
  function inAdmin(){var s=global.DB&&global.DB.getSession&&global.DB.getSession();return !!(s&&s.role==='admin');}
  function host(){
    if(!/^#\/admin\/dashboard(?:$|[/?])/.test(location.hash||''))return null;
    if(!document.body.classList.contains('qf-adm-body')||!inAdmin())return null;
    return document.getElementById('app-content');
  }
  function render(panel,v){
    panel.innerHTML='<div class="qf-adm-paid-title"><h2>Cadastros e pagamentos confirmados</h2><small>Valores reais do banco · atualização sob demanda</small></div>'
      +'<div class="qf-adm-paid-grid">'
      +metric('Pré-cadastros aguardando',toInt(v.pre_cadastros_pendentes))
      +metric('Profissionais ativos',toInt(v.profissionais_ativos))
      +metric('Avulso R$ 13 pagos',toInt(v.avulsos_iniciais_pagos))
      +metric('Livre R$ 39,90 pagos',toInt(v.livres_iniciais_pagos))
      +'</div>'
      +'<details><summary>Conciliação e valores</summary><div class="qf-adm-paid-extra">'
      +'<p>Pagos ainda sem ativar: <b>'+toInt(v.pagos_ainda_nao_resgatados)+'</b> · Pendentes há mais de 72h: <b>'+toInt(v.pre_cadastros_abandonados)+'</b></p>'
      +'<p>Assinaturas Livre vigentes: <b>'+toInt(v.livres_vigentes)+'</b> · Vencidas: <b>'+toInt(v.livres_vencidos)+'</b></p>'
      +'<p>Avulso recebido em crédito pré-pago: <b>'+reais(v.recebido_avulso_inicial_centavos)+'</b> · Livre inicial recebido: <b>'+reais(v.recebido_livre_inicial_centavos)+'</b></p>'
      +'<p>Saldos totais em carteiras: <b>'+reais(v.saldo_carteiras_total_centavos)+'</b> (inclui outros créditos e possíveis bônus).</p>'
      +'<p><strong>Importante:</strong> saldo antecipado do profissional não é receita reconhecida da plataforma. Repasses automáticos continuam indisponíveis até homologação bancária.</p>'
      +'</div></details><button class="btn btn--outline" type="button" data-qf-admin-paid-refresh>Atualizar indicadores</button>';
    var b=panel.querySelector('[data-qf-admin-paid-refresh]');
    if(b)b.onclick=function(){lastAt=0;load(panel);};
  }
  function load(panel){
    var client=global.QFCloud&&global.QFCloud.client;
    if(!client||busy||!panel.isConnected||!inAdmin())return;
    busy=true; lastAt=Date.now();
    var status=panel.querySelector('[data-qf-admin-paid-status]');
    if(status)status.textContent='Consultando pagamentos...';
    client.rpc('qf_admin_cadastro_pagamentos').then(function(r){
      if(!panel.isConnected||!inAdmin())return;
      if(r.error||!r.data){panel.innerHTML='<p>Indicadores indisponíveis. A atualização do banco ainda não foi aplicada ou o acesso administrativo expirou.</p>';return;}
      render(panel,r.data);
    }).catch(function(){if(panel.isConnected)panel.innerHTML='<p>Não foi possível consultar os indicadores. Confira a conexão.</p>';})
    .finally(function(){busy=false;});
  }
  function place(){
    var h=host();if(!h)return;
    var panel=h.querySelector('#'+PANEL);
    if(!panel){
      panel=document.createElement('section');
      panel.id=PANEL;panel.className='card qf-adm-paid';
      panel.setAttribute('aria-label','Cadastros profissionais pagos');
      panel.innerHTML='<p data-qf-admin-paid-status>Consultando cadastros pagos...</p>';
      h.prepend(panel);lastAt=0;
    }
    if(!busy&&Date.now()-lastAt>120000)load(panel);
  }
  function install(){
    if(connected)return;connected=true;
    var css=document.createElement('style');
    css.textContent='.qf-adm-paid{padding:18px!important;margin:0 0 18px!important;border-radius:18px!important;border:1px solid #d4e0ef;background:#fff}'
      +'.qf-adm-paid-title{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:12px}.qf-adm-paid-title h2{font-size:17px;margin:0;color:#122d53}.qf-adm-paid-title small{color:#64748b}'
      +'.qf-adm-paid-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.qf-adm-paid-stat{display:flex;flex-direction:column;gap:5px;background:#f6f9fe;border-radius:13px;padding:12px;min-width:0}'
      +'.qf-adm-paid-stat strong{font-size:22px;color:#1256ad}.qf-adm-paid-stat span{font-size:12px;line-height:1.3;color:#4d6179}'
      +'.qf-adm-paid details{margin:12px 0}.qf-adm-paid details summary{font-size:13px;font-weight:700;cursor:pointer}.qf-adm-paid-extra p{font-size:13px;line-height:1.5;margin:8px 0}'
      +'@media(max-width:700px){.qf-adm-paid-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.qf-adm-paid{padding:14px!important}}';
    document.head.appendChild(css);
    var queued=false;
    new MutationObserver(function(){if(queued)return;queued=true;setTimeout(function(){queued=false;place();},100);})
      .observe(document.body,{subtree:true,childList:true});
    global.addEventListener('hashchange',place);
    place();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);
  else install();
})(window);
