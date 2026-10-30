/* Quem Faz Livre: o navegador consulta; somente o servidor confirma e ativa. */
(function(g){
 'use strict';
 const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=v=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'';
 let identificationPending=false,openAvulso=false;
 function trialProgress(s){
  const end=Date.parse(s.valido_ate),now=Date.parse(s.servidor_agora);
  if(s.aguarda_identificacao)return '<p>As 48 horas começam após concluir sua identificação.</p>';
  if(!Number.isFinite(end)||!Number.isFinite(now))return '';
  const minutes=Math.max(0,Math.min(2880,Math.ceil((end-now)/60000))),pct=Math.round(minutes/2880*100);
  const text=minutes?Math.floor(minutes/60)+'h '+minutes%60+'min restantes':'Teste encerrado';
  return '<div class="qf-trial-progress"><span>'+text+'</span><progress max="2880" value="'+minutes+'" aria-label="Tempo restante do teste grátis" aria-valuetext="'+text+'">'+pct+'%</progress></div>';
 }
 g.QFLivreTrialProgress=trialProgress;
 function planSummary(s){
  const packages=Array.isArray(s.pacotes_ativos)?s.pacotes_ativos:[],legacy=!s.ativo&&!s.tipo_acesso&&packages.length>0;
  const packageHtml=packages.map(p=>{const end=Date.parse(p.valido_ate),start=Date.parse(p.inicio_em),now=Date.parse(s.servidor_agora)||Date.now(),left=Math.max(0,Math.ceil((end-now)/60000)),total=Number.isFinite(start)?Math.max(1,Math.ceil((end-start)/60000)):43200;const name=({mensal:'Mensal',pro:'Pro',basico:'Básico'})[p.plano]||p.plano;return '<section class="qf-existing-package"><strong>Plano '+esc(name)+' ativo</strong><p>'+Number(p.restantes||0)+' desbloqueios restantes · vence em '+esc(date(p.valido_ate))+'. Faltam '+Math.floor(left/1440)+' dia(s) e '+Math.floor(left%1440/60)+'h.</p><div class="qf-trial-progress"><progress max="'+total+'" value="'+Math.min(total,left)+'" aria-label="Validade do plano '+esc(name)+'"></progress></div></section>';}).join('');
  const trial=s.tipo_acesso==='teste',courtesy=s.tipo_acesso==='cortesia',paid=s.tipo_acesso==='pago',waiting=!!s.aguarda_identificacao,active=!!s.ativo;
  const end=Date.parse(s.valido_ate),begin=Date.parse(s.inicio_em),now=Date.parse(s.servidor_agora)||Date.now();
  const duration=Number.isFinite(begin)&&Number.isFinite(end)?Math.max(1,Math.round((end-begin)/60000)):Math.max(1,Number(s.duracao_dias)||(trial?2:30))*1440;
  const mins=Number.isFinite(end)?Math.max(0,Math.ceil((end-now)/60000)):0,days=Math.floor(mins/1440),hours=Math.floor(mins%1440/60);
  const remaining=days?days+' dia'+(days===1?'':'s')+' e '+hours+'h':Math.floor(mins/60)+'h '+mins%60+'min';
  const kind=trial?'Teste grátis':courtesy?'Cortesia':paid?'Quem Faz Livre':'Avulso';
  const title=waiting?kind+' aguardando identificação':active?(trial?'Versão de teste · Quem Faz Livre':courtesy?'Cortesia ativa · Quem Faz Livre':'Meu plano · Quem Faz Livre'):trial?'Seu teste grátis terminou':courtesy?'Sua cortesia terminou':paid?'Seu plano Livre venceu':legacy?'Seu plano de desbloqueios está ativo':'Avulso · sem assinatura mensal';
  const note=waiting?'Conclua seu CPF/CNPJ e confira sua foto no Perfil. A liberação de '+(Number(s.duracao_dias)||2)+' dias começa após a identificação.':active?'Faltam '+remaining+'. Termina em '+date(s.valido_ate)+'.':(trial||courtesy||paid)?'O acesso gratuito ou pelo plano terminou. Assine o Livre ou use saldo no Avulso para novos desbloqueios.':legacy?'Veja abaixo os desbloqueios e a validade do seu plano. A assinatura Livre é uma opção diferente.':'Use o saldo da carteira para pagar cada desbloqueio. Créditos pagos não vencem.';
  const timed=trial||courtesy||paid;
  const bar=timed?'<progress max="'+duration+'" value="'+(waiting?0:Math.min(duration,mins))+'" aria-label="Tempo restante do '+(trial?'teste':'plano')+'" aria-valuetext="'+esc(waiting?'Aguardando identificação':active?remaining:'Encerrado')+'"></progress>':'';
  const identify=waiting?'<button type="button" class="btn btn--primary" data-qf-livre-identificar>Concluir identificação</button>':'';
  const subscribe=!waiting&&(!active||trial||courtesy)?'<button type="button" class="btn btn--primary" data-qf-livre-pagar>Assine agora · R$ 39,90 / 30 dias</button>':'';
  return '<div class="qf-livre__copy"><strong>'+title+'</strong><p>'+esc(note)+'</p><div class="qf-trial-progress">'+bar+'</div>'+packageHtml+'<div class="qf-plan-actions">'+identify+subscribe+'<button type="button" class="btn btn--outline" data-qf-livre-trocar>Trocar plano</button></div><p class="text--sm">'+(legacy?'Seu pacote atual continua válido.':('Modo escolhido: '+(s.preferencia==='avulso'?'Avulso · pagar por desbloqueio':'Quem Faz Livre')+'.'))+' '+(trial?'Sem cobrança automática. ':'')+(s.preferencia==='avulso'&&active?'Seu benefício atual continua válido até a data acima.':'')+'</p></div><div data-qf-livre-pix></div><p role="status" data-qf-livre-msg></p>';
 }
 function divisao(){
  return '<section class="qf-divisao" aria-label="Divisão do valor do serviço no Quem Faz Livre"><h3>Você faz o serviço e fica com 87% do valor. O Quem Faz recebe 13% pela intermediação.</h3><div class="qf-divisao__bar" role="img" aria-label="87% para o profissional e 13% para o Quem Faz"><span class="qf-divisao__pro">87%</span><span class="qf-divisao__qf">13%</span></div><div class="qf-divisao__legenda"><span><i class="qf-divisao__verde"></i><b>Profissional · 87%</b><strong>R$ 174</strong></span><span><i class="qf-divisao__laranja"></i><b>Quem Faz · 13%</b><strong>R$ 26</strong></span></div><p>Exemplo: serviço de R$ 200. Você define o preço. Esta é a divisão do valor após a comissão no Quem Faz Livre; seus custos e tributos não estão descontados. Não representa lucro líquido garantido. No Avulso, não há comissão.</p></section>';
 }
 function oferta(s={}){
  return '<div class="qf-livre__eyebrow">QUEM FAZ LIVRE</div>' +
    '<h2 class="qf-livre__headline">Desbloqueie o quanto quiser <span>por R$ 1,33 ao dia</span></h2>' +
    '<p class="qf-livre__price">R$ 39,90 por 30 dias</p>' +
    (s.ativo ? '<p role="status">Plano ativo — desbloqueios ilimitados'+(s.valido_ate?' até '+esc(date(s.valido_ate)):'')+'</p>' : s.valido_ate ? '<p role="status">Plano vencido em '+esc(date(s.valido_ate))+'. Renove para continuar com os benefícios.</p>' : '') +
    '<div class="qf-livre__benefits">' +
      '<div><span aria-hidden="true" class="qf-livre__benefit-icon">∞</span><strong>Pedidos compatíveis ilimitados</strong></div>' +
      '<div><span aria-hidden="true" class="qf-livre__benefit-icon">%</span><strong>Você fica com 87% do valor do serviço</strong></div>' +
      '<div><span aria-hidden="true" class="qf-livre__benefit-icon">✓</span><strong>Ativação após a confirmação do Pix da assinatura</strong></div>' +
    '</div>' +
    '<p class="text--sm text--secondary">Por menos de R$ 1,50 por dia, tenha desbloqueios ilimitados de pedidos compatíveis durante 30 dias, enquanto houver vagas. Chat e WhatsApp do cliente após o desbloqueio, quando disponíveis. Comissão de 13% sobre serviços fechados e confirmados. Pagamentos de serviços pela plataforma, quando disponíveis para o pedido, seguem as condições informadas antes da confirmação.</p>' + '<details class="qf-livre__details"><summary>Saiba mais sobre o plano</summary>' +
      '<p>Sem cobrança por contato e sem renovação automática. São elegíveis apenas pedidos compatíveis, disponíveis e não exclusivos, com até 4 profissionais por pedido.</p>' +
      '<p>Você combina o valor do serviço com o cliente. Caso o pagamento pela plataforma esteja disponível para o pedido, as condições serão apresentadas antes de confirmar. Pagamentos e comissões anteriores permanecem registrados e separados.</p>' +
      '<p><strong>Como funciona:</strong> converse por chat ou WhatsApp após desbloquear um pedido, quando disponíveis. Informe o andamento em até 48 horas; se estiver negociando, poderá prorrogar uma vez. A comissão de 13% incide sobre serviço fechado e confirmado. Pendências de comissão confirmadas e vencidas precisam ser regularizadas. O plano não garante contratação.</p>' +
    '</details>' +
    (s.ativo ? '<a class="btn btn--primary btn--block" href="#/profissional/servicos/disponiveis">Ver pedidos disponíveis</a>' :
      '<button type="button" class="btn btn--primary btn--block qf-livre__cta" data-qf-livre-pagar>Assinar por R$ 39,90</button>') +
    '<div data-qf-livre-pix></div><p role="status" aria-live="polite" data-qf-livre-msg></p>';
 }
 g.QFLivre={oferta,divisao};if(typeof module!=='undefined')module.exports=g.QFLivre;
 if(!g.document)return;
 function install(){
  if(!g.Screens||g.QFLivre.installed)return;g.QFLivre.installed=true;
  // O catálogo antigo continua disponível para registros e assinaturas já contratadas.
  // A nova inscrição já contém exclusivamente Avulso e Livre.
  if(g.QFPlanoIncentivo)g.QFPlanoIncentivo.porChamado=()=>null;
  const css=document.createElement('style');css.textContent='.qf-livre{border:2px solid #1769d5!important;background:linear-gradient(120deg,#eef6ff,#fff8ed);border-radius:18px;padding:20px!important;margin:0 0 18px!important;min-width:0}.qf-livre h2{margin:8px 0;font-size:1.35rem}.qf-livre p{overflow-wrap:anywhere}.qf-livre textarea{width:100%;box-sizing:border-box;min-height:90px;overflow-wrap:anywhere}.qf-livre img{display:block;width:200px;max-width:100%;height:auto;margin:12px auto}.qf-livre label{display:flex;gap:10px;align-items:flex-start;margin:12px 0}.qf-livre input[type=checkbox]{width:20px;height:20px;flex:0 0 20px}.qf-livre .btn{white-space:normal}@media(max-width:639px){.qf-livre{padding:16px!important}.qf-livre .btn{width:100%}}';css.textContent += "\n/* Ajustes 23/10 — pedidos em evidência e estado do plano compacto */\n.qf-livre.qf-livre--compact{padding:12px 14px!important;margin:0 0 8px!important;display:flex;align-items:center;min-height:64px;gap:12px;border:1px solid #a7cdf6!important;background:#eef6ff!important;box-shadow:none!important;height:auto!important}\n.qf-livre--compact .qf-livre__icon{display:grid;place-items:center;flex:none;width:37px;height:37px;border:1px solid #b2d6fa;border-radius:10px;color:#075bbb;font-size:22px;font-weight:800}\n.qf-livre--compact .qf-livre__copy{min-width:0;flex:1}\n.qf-livre--compact .qf-livre__copy strong{display:block;color:#075bbb;font-size:14px;line-height:1.3}\n.qf-livre--compact .qf-livre__copy small{display:block;font-size:12.5px;line-height:1.35;color:#42526c;margin-top:3px}\n.qf-livre--compact .qf-livre__link{flex:none;white-space:nowrap;font-weight:750;font-size:13px;color:#075bbb;text-decoration:none}\n.qf-livre--compact .qf-livre__link:focus-visible{outline:2px solid #075bbb;outline-offset:3px}\n#app-shell[data-route=\"profissional-home\"] .view>.qf-livre--compact,\n#app-shell[data-route=\"profissional-carteira\"] .view>.qf-livre--compact{grid-column:1/-1;grid-row:auto;break-inside:avoid}\n#app-shell[data-route=\"profissional-home\"] .view>#chamados-disponiveis{grid-column:1/-1;order:0}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-order-heading h2{font-size:clamp(19px,4.8vw,25px);font-weight:850}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-order-tabs{gap:8px;border:0;margin:10px 0 14px;overflow-x:auto}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-order-tabs>*{flex:0 0 auto;min-height:42px;border:1px solid #c8d3e1;border-radius:999px;padding:9px 13px;background:#fff;font-size:13px;white-space:nowrap}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-order-tabs [aria-current]{border:1px solid #075bbb;background:#075bbb;color:#fff}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-status{height:auto!important}\n#app-shell[data-route=\"profissional-carteira\"] .view>.qf-livre{column-span:all}\n#app-shell[data-route=\"profissional-carteira\"] .view>.qf-livre+ .card{column-span:all}\n#cadastro-prof-form .qf-step__nav{position:sticky;bottom:env(safe-area-inset-bottom,0px);z-index:12;display:flex;gap:10px;background:rgba(255,255,255,.97);padding:12px;border:1px solid #e0e9f4;border-radius:16px;box-shadow:0 4px 22px rgba(17,43,76,.10);margin-top:12px}\n#cadastro-prof-form .qf-step__nav .btn{min-height:48px}\n#cadastro-prof-form .qf-step .field input,#cadastro-prof-form .qf-step .field select,#cadastro-prof-form .qf-step .field textarea{scroll-margin-bottom:95px}\n#cadastro-prof-form .qf-step__head .text--sm{max-width:43ch}\n#cadastro-prof-form .qf-cad-planos__nota{line-height:1.4}\n@media(min-width:768px){#cadastro-prof-form .qf-step__nav{position:static;box-shadow:none} }\n@media(max-width:380px){.qf-livre--compact .qf-livre__icon{display:none}.qf-livre--compact .qf-livre__link{font-size:12px} }\n\n/* Layout aprovado — divulgação do Livre, explicação e checkout Pix */\n.qf-livre:not(.qf-livre--compact){background:#fff!important;border:2px solid #1369d6!important;box-shadow:none}\n.qf-livre__eyebrow{font-size:12px;font-weight:850;letter-spacing:.035em;color:#101a35}\n.qf-livre .qf-livre__headline{margin:10px 0 0;font-size:clamp(21px,5.6vw,30px);line-height:1.2;letter-spacing:-.022em;color:#0b55be;font-weight:850}\n.qf-livre__headline span{display:block}\n.qf-livre .qf-livre__price{font-size:17px;color:#48546a;margin:6px 0 14px}\n.qf-livre__benefits{display:flex;flex-direction:column;gap:16px;margin:16px 0 18px}\n.qf-livre__benefits>div{display:flex;align-items:center;gap:12px;min-width:0}\n.qf-livre__benefits strong{font-size:15px;line-height:1.3;color:#14213d}\n.qf-livre__benefit-icon{display:grid;place-items:center;width:36px;height:36px;flex:0 0 36px;border-radius:50%;background:#e8f1ff;color:#0b63ce;font-size:24px;font-weight:850}\n.qf-livre__details{margin:4px 0 18px}\n.qf-livre__details summary{cursor:pointer;color:#075bbb;font-weight:750;font-size:14px;padding:8px 2px}\n.qf-livre__details p{font-size:13px;line-height:1.5;color:#4b5870;margin:9px 0}\n.qf-livre__cta{min-height:52px;font-weight:800}\n.qf-livre.qf-livre--compact.qf-livre--promo{border:0!important;background:linear-gradient(115deg,#064cae,#0067dd)!important;box-shadow:0 4px 14px rgba(3,81,176,.16)!important;min-height:80px;padding:12px 14px!important}\n.qf-livre--promo .qf-livre__icon{border:0;background:rgba(0,0,0,.12);color:#ffe37b;width:38px;height:38px}\n.qf-livre--promo .qf-livre__icon svg{width:24px;height:24px;stroke:currentColor}\n.qf-livre--promo .qf-livre__copy strong{font-size:clamp(13px,3.5vw,17px);line-height:1.22;font-weight:850;color:#fff}\n.qf-livre--promo .qf-livre__copy strong em{font-style:normal;color:#ffe073;white-space:nowrap}\n.qf-livre--promo .qf-livre__copy small{color:#f2f7ff;font-size:11.5px}\n.qf-livre--promo .qf-livre__link{display:inline-flex;justify-content:center;align-items:center;min-height:39px;padding:7px 10px;border-radius:999px;background:#fff;color:#075bbb;font-size:12px}\n.qf-livre--checkout .qf-livre-pix__title{font-size:24px;line-height:1.2;color:#12213b;margin:0;font-weight:850}\n.qf-livre--checkout .qf-livre-pix__sub{color:#55637a;margin:6px 0 18px;font-size:15px}\n.qf-livre--checkout .qf-livre-pix__qr{display:block;width:min(260px,78vw);max-width:100%;height:auto;margin:12px auto 20px}\n.qf-livre--checkout .qf-livre-pix__note{color:#43516a;font-size:14px;line-height:1.45;margin:0 0 16px}\n.qf-livre--checkout .qf-livre-pix__code{min-height:95px;max-height:115px;border:1px solid #cbd5e1;border-radius:12px;background:#f7f9fc;font-size:12px;line-height:1.45;resize:none;padding:12px;color:#26364d}\n.qf-livre--checkout .qf-livre-pix__actions{display:flex;flex-direction:column;gap:12px;margin-top:14px}\n.qf-livre--checkout .qf-livre-pix__actions .btn{min-height:49px;margin:0;width:100%;border-radius:12px}\n.qf-livre--checkout .qf-livre-pix__actions [data-qf-livre-copiar]{background:#075fcf;color:#fff;font-weight:800;border:1px solid #075fcf}\n.qf-livre--checkout .qf-livre-pix__actions [data-qf-livre-verificar]{background:#fff;color:#075fcf;font-weight:750;border:1px solid #0b68da}\n.qf-livre--checkout [data-qf-livre-msg]{font-size:13px;color:#55637a;line-height:1.4;margin:12px 0 0}\n@media(max-width:410px){.qf-livre--promo .qf-livre__icon{display:none}.qf-livre--promo .qf-livre__link{font-size:11.5px;padding:7px 9px}.qf-livre--promo .qf-livre__copy small{font-size:11px}}\n";css.textContent += '.qf-divisao{max-width:680px;min-width:0;margin:16px 0;padding:16px;border:1px solid #d6e3ed;border-radius:14px;background:#fff}.qf-divisao h3{font-size:16px;line-height:1.5;margin:0 0 14px;color:#172c42}.qf-divisao__bar{display:flex;width:100%;height:32px;overflow:hidden;border-radius:9px}.qf-divisao__bar span{display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;box-sizing:border-box}.qf-divisao__pro{width:87%;background:#167348}.qf-divisao__qf{width:13%;background:#f28c28;color:#222!important}.qf-divisao__legenda{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.qf-divisao__legenda span{display:grid;grid-template-columns:8px 1fr;gap:4px 6px;align-items:center;font-size:12px}.qf-divisao__legenda i{height:8px;width:8px;border-radius:50%}.qf-divisao__verde{background:#167348}.qf-divisao__laranja{background:#f28c28}.qf-divisao__legenda strong{grid-column:2;font-size:21px;color:#172c42}.qf-divisao p{font-size:12px!important;line-height:1.5;color:#46566a;margin:12px 0 0}.qf-divisao[hidden]{display:none}';css.textContent += "/* Cadastro profissional: comparação compacta dos planos. */\n#cadastro-prof-form .qf-cad-planos{gap:16px}\n#cadastro-prof-form .qf-cad-plano{background:#fff;gap:9px;padding:16px;border:1.5px solid #d8e1ee;box-shadow:none;min-width:0}\n#cadastro-prof-form .qf-cad-plano--top{padding-top:22px;border-color:#9ebfe9}\n#cadastro-prof-form .qf-cad-plano:has(input:checked){border:2px solid #1469d2;background:#f8fbff;box-shadow:0 4px 16px #1469d214}\n#cadastro-prof-form .qf-cad-plano__selo{background:#f28c28;color:#442300;font-size:11px}\n#cadastro-prof-form .qf-cad-plano__nome{font-size:19px;color:#124a92}\n#cadastro-prof-form .qf-cad-plano__dia{color:#075bbb;font-size:32px}\n#cadastro-prof-form .qf-cad-plano__dia small{font-size:14px}\n#cadastro-prof-form .qf-cad-plano__preco b{font-size:18px}\n#cadastro-prof-form .qf-cad-plano__lista{gap:6px}\n#cadastro-prof-form .qf-cad-plano__lista>span{font-size:13px;line-height:1.35;gap:7px}\n#cadastro-prof-form .qf-cad-plano__lista>span::before{content:'✓';color:#075bbb;font-weight:800;flex:none}\n#cadastro-prof-form .qf-cad-plano__lista svg{display:none}\n#cadastro-prof-form .qf-cad-plano:has(input:checked) .qf-cad-plano__radio{border-color:#1469d2}\n#cadastro-prof-form .qf-cad-plano:has(input:checked) .qf-cad-plano__radio::after{background:#1469d2}\n#cadastro-prof-form [data-step=\"5\"] .qf-step__nav{position:static!important;display:grid!important;grid-template-columns:auto minmax(0,1fr);box-shadow:none!important;padding:0!important;border:0!important;background:transparent!important}\n#cadastro-prof-form [data-step=\"5\"] .qf-step__nav>details{grid-column:1/-1;grid-row:1}\n#cadastro-prof-form [data-step=\"5\"] .qf-step__nav>button{grid-row:2;width:100%;min-height:48px}\n#cadastro-prof-form [data-step=\"5\"] .qf-step__nav>[data-step-back]{padding-inline:16px}\n.qf-cad-divisao{display:flex;flex-direction:column;gap:7px;padding-top:10px;border-top:1px solid #dbe6f3;margin-top:2px}\n.qf-cad-divisao__titulo{font-size:12px;font-weight:750;color:#334a65}\n.qf-cad-divisao__bar{display:flex;height:25px;width:100%;overflow:hidden;border-radius:7px}\n.qf-cad-divisao__bar>span{display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800}\n.qf-cad-divisao__pro{flex:0 0 87%;background:#1469d2;color:#fff}\n.qf-cad-divisao__qf{flex:0 0 13%;background:#f28c28;color:#442300}\n.qf-cad-divisao__legenda{display:flex;justify-content:space-between;gap:8px;font-size:11px;line-height:1.3;color:#713e0e}\n.qf-cad-divisao__legenda b{color:#1257ab}\n.qf-cad-divisao__nota{font-size:11.5px;line-height:1.4;color:#4c5e74}\n@media(min-width:760px){#cadastro-prof-form .qf-cad-planos{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);align-items:start}}\n";css.textContent += "\n#cadastro-prof-form .qf-trial-card{display:grid;grid-template-columns:26px minmax(0,1fr);align-items:start;gap:12px;border:2px solid #b8d0f2;border-radius:16px;background:linear-gradient(145deg,#eff6ff,#fff);padding:17px!important;cursor:pointer;box-sizing:border-box;margin:14px 0}\n#cadastro-prof-form .qf-trial-card--selected{border-color:#0f64c9;background:#eaf4ff;box-shadow:0 4px 15px rgba(14,88,189,.13)}\n#cadastro-prof-form .qf-trial-card>input{width:22px;height:22px;margin:3px 0;accent-color:#145fc5}\n#cadastro-prof-form .qf-trial-copy{display:flex;flex-direction:column;min-width:0;gap:8px;color:#152841;line-height:1.4}\n#cadastro-prof-form .qf-trial-eyebrow{font-size:12px;font-weight:850;color:#bb4d0b;letter-spacing:.025em}\n#cadastro-prof-form .qf-trial-title{font-size:clamp(19px,4.8vw,24px);line-height:1.2;font-weight:850;color:#0a4fa6}\n#cadastro-prof-form .qf-trial-benefits{display:flex;flex-direction:column;gap:5px;margin:4px 0;font-size:14px;font-weight:700;color:#143d75}\n#cadastro-prof-form .qf-trial-copy small{font-size:12.5px;line-height:1.45;font-weight:450;color:#42536b}\n@media(max-width:380px){#cadastro-prof-form .qf-trial-card{padding:12px!important;gap:10px}}\n";css.textContent += "\n/* Seleção explícita: dois planos pagos e teste de 48 horas, sem esconder o checkout. */\n#cadastro-prof-form .qf-cad-planos{display:grid!important;visibility:visible!important;gap:12px!important}\n#cadastro-prof-form .qf-cad-planos__chamada{display:flex;flex-direction:column;gap:5px;margin:14px 0 9px;padding:14px;border-radius:13px;background:#0c4eaf;color:#fff;line-height:1.35}\n#cadastro-prof-form .qf-cad-planos__chamada strong{font-size:clamp(15px,3.7vw,19px);font-weight:850;letter-spacing:-.01em;color:#fff}\n#cadastro-prof-form .qf-cad-planos__chamada span{font-size:12.5px;color:#e8f2ff}\n#cadastro-prof-form .qf-cad-plano__complemento{display:block;font-size:12px;line-height:1.5;color:#334764;margin:6px 0 0}\n#cadastro-prof-form .qf-trial-card{display:grid!important;grid-template-columns:26px minmax(0,1fr);align-items:start}\n#cadastro-prof-form .qf-trial-card input[type=checkbox]{display:block!important;appearance:auto;opacity:1;pointer-events:auto}\n@media(min-width:760px){#cadastro-prof-form .qf-cad-planos{grid-template-columns:repeat(2,minmax(0,1fr))}}\n";document.head.appendChild(css);
  document.addEventListener('click',e=>{const choice=e.target.closest?.('[data-qf-escolha-plano]');if(choice)try{sessionStorage.setItem('qf_cad_escolha_plano',choice.dataset.qfEscolhaPlano);}catch(_){}},true);
  const prior=g.Screens.afterRender,priorAnon=g.Screens.afterRenderAnon;
  function enhance(pattern,content,params={}){
   if(pattern==='/profissional/perfil'&&identificationPending){
    identificationPending=false;const form=content.querySelector('#prof-cadastro-update-form');
    if(form){form.hidden=false;content.querySelector('#prof-cadastro-toggle')?.setAttribute('aria-expanded','true');setTimeout(()=>{form.scrollIntoView({block:'start'});form.querySelector('[name=documento]')?.focus();},100);}
   }
   if(pattern==='/como-funciona'){if(!content.querySelector('.qf-divisao'))(content.querySelector('.view')||content).insertAdjacentHTML('beforeend',divisao());return;}
   const cadastro=pattern==='/auth/:role/cadastro'&&params.role==='profissional';
   // A entrada profissional permanece na lista de pedidos, inclusive após o cadastro.
   const pedido=['/profissional/pedido/:id','/profissional/chamada/:id'].includes(pattern);
   if(!cadastro&&!pedido&&!['/profissional/home','/profissional/perfil','/profissional/planos','/profissional/carteira','/profissional/servicos','/profissional/servicos/disponiveis'].includes(pattern))return;
   if(content.querySelector('[data-qf-livre],[data-qf-livre-cadastro]'))return;
   const client=g.QFCloud&&g.QFCloud.client;if(!client)return;
   const rpc=async(n,a={})=>{const r=await client.rpc(n,a);if(r.error)throw Error('Não foi possível consultar o plano. Tente novamente.');return r.data;};
   const box=document.createElement('section');box.className='section card stack--sm qf-livre';box.dataset.qfLivre='';
   const view=content.querySelector('.view')||content;
   if(pattern==='/profissional/carteira'){
    const recharge=view.querySelector('#carteira-recarga');
    if(recharge&&!recharge.querySelector('details')){
     const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Adicionar créditos para o Avulso';
     details.append(summary);recharge.querySelector('.section-head')?.remove();while(recharge.firstChild)details.append(recharge.firstChild);recharge.append(details);
     view.querySelector('[data-action="rolar-recarga"]')?.addEventListener('click',()=>{details.open=true;});
    }
    if(openAvulso&&recharge){openAvulso=false;const details=recharge.querySelector('details');if(details)details.open=true;setTimeout(()=>recharge.scrollIntoView({block:'start'}),100);}
   }
   if(!cadastro){
    if(pattern==='/profissional/carteira'){
     const balance=Array.from(view.children).find(el=>/Minha carteira.*saldo disponível/i.test(el.textContent||''));
     if(balance){balance.dataset.qfWalletBalance='';view.prepend(balance);balance.after(box);}else view.prepend(box);
    }else if(pattern==='/profissional/perfil'){
     const account=view.querySelector(':scope > .card');if(account)account.after(box);else view.prepend(box);
    }else view.prepend(box);
    if(pattern==='/profissional/home'){
     // O estado online continua visível, mas os pedidos ficam logo abaixo do plano.
     const online=view.querySelector('.qf-prof-status');
     if(online)online.after(box);
     const calls=view.querySelector('#chamados-disponiveis');
     if(calls)box.after(calls);
     const ready=view.querySelector('[data-ativacao="pronto"]');
     if(ready)setTimeout(()=>{if(ready.isConnected)ready.remove();},4500);
     const other=view.querySelector('#pedidos-abertos-a-todos');
     const tabs=view.querySelector('.qf-prof-order-tabs');
     if(other&&tabs&&!tabs.querySelector('[data-qf-ir-outros]')){
      const b=document.createElement('button');
      b.type='button';b.dataset.qfIrOutros='';b.textContent='Outros pedidos';
      b.addEventListener('click',()=>other.scrollIntoView({behavior:'smooth',block:'start'}));
      tabs.appendChild(b);
     }
    }
   }
   if(cadastro){
    content.querySelector('.qf-cad-planos__ex')?.remove();
    const group=content.querySelector('.qf-cad-planos'),form=content.querySelector('form');
    if(group&&form){
     group.dataset.qfLivreCadastro='';
     // Reexibir os dois planos de pagamento; o teste e opcional, nunca impede o checkout.
     group.style.removeProperty('display');
     group.hidden=false;
     const livre=group.querySelector('input[value="livre"]');
     const avulso=group.querySelector('input[value="avulso"]');
     const courtesyInput=form.elements.cortesiaLivre;
     if(courtesyInput){courtesyInput.checked=false;const courtesyRow=courtesyInput.closest('label');if(courtesyRow)courtesyRow.remove();}
     const trialInput=form.elements.testeLivre,trialLabel=trialInput?.closest('label');
     if(trialInput){trialInput.type='checkbox';trialInput.value='sim';trialInput.checked=true;trialInput.disabled=false;}
     if(livre)livre.checked=true;
     const step=group.closest('.qf-step');
     if(step){
      const heading=step.querySelector('.qf-step__head .h2'),sub=step.querySelector('.qf-step__head .text--sm');
      if(heading)heading.textContent='Escolha como começar no Quem Faz';
      if(sub)sub.textContent='Ative o Livre ou o Avulso por Pix agora, ou experimente 2 dias grátis. Você decide.';
     }
     if(!group.previousElementSibling?.matches('[data-qf-planos-chamada]')){
      const call=document.createElement('p');call.dataset.qfPlanosChamada='';
      call.className='qf-cad-planos__chamada';
      call.innerHTML='<strong>DESBLOQUEIOS ILIMITADOS POR MENOS DE R$ 1,50/DIA</strong><span>Quem Faz Livre: R$ 39,90 por 30 dias, equivalente a R$ 1,33 por dia.</span>';
      group.before(call);
     }
     // Textos comerciais sem modificar preços, cobranças ou permissões do servidor.
     if(avulso){
      const card=avulso.closest('label');
      if(card&&!card.querySelector('[data-qf-avulso-info]')){
       const info=document.createElement('small');info.dataset.qfAvulsoInfo='';
       info.className='qf-cad-plano__complemento';
       info.textContent='Recarga mínima obrigatória para ativar o Avulso: R$ 13,00. Esse valor vira saldo integral para desbloquear oportunidades. Pix ou cartão no checkout; sem mensalidade, sem comissão sobre o serviço. Chat e WhatsApp após desbloqueio, quando disponíveis.';
       card.append(info);
      }
     }
     if(livre){
      const card=livre.closest('label');
      if(card&&!card.querySelector('[data-qf-livre-info]')){
       const info=document.createElement('small');info.dataset.qfLivreInfo='';
       info.className='qf-cad-plano__complemento';
       info.textContent='Menos de R$ 1,50 por dia: desbloqueios ilimitados de pedidos compatíveis durante 30 dias, enquanto houver vagas. Chat e WhatsApp do cliente após o desbloqueio, quando disponíveis. Comissão de 13% apenas sobre serviços fechados e confirmados. Pague R$ 39,90 por Pix, sem recarga Avulso.';
       card.append(info);
      }
     }
     if(trialLabel&&!trialLabel.dataset.qfTrialReady){
      const extra=document.createElement('span');extra.className='qf-trial-copy';
      extra.innerHTML='<span class="qf-trial-eyebrow">OPCIONAL · TESTE GRÁTIS DE 48 HORAS</span>'+
       '<strong class="qf-trial-title">Experimente desbloqueios ilimitados por 2 dias</strong>'+
       '<span class="qf-trial-benefits"><span>✓ Pedidos compatíveis e chat no aplicativo</span><span>✓ WhatsApp após desbloqueio, quando disponível</span><span>✓ Sem Pix, recarga ou pagamento inicial</span></span>'+
       '<small>Um teste por profissional elegível, após identificação. Não há cobrança automática. Se preferir pagar agora, clique em um dos planos acima.</small>';
      trialLabel.replaceChildren(trialInput,extra);
      trialLabel.classList.add('qf-trial-card');trialLabel.dataset.qfTrialReady='';
     }
     let conditions=step?.querySelector('[data-qf-condicoes-planos]');
     if(!conditions){
      conditions=document.createElement('details');conditions.className='qf-step__opt';conditions.dataset.qfCondicoesPlanos='';
      conditions.innerHTML='<summary>Como funcionam os planos e os contatos?</summary><ul>'+
       '<li><strong>Avulso:</strong> recarga inicial mínima obrigatória de R$ 13,00, convertida em créditos; cada desbloqueio usa o saldo. Sem mensalidade e sem comissão.</li>'+
       '<li><strong>Livre:</strong> R$ 39,90 por 30 dias (R$ 1,33/dia), desbloqueios ilimitados de pedidos compatíveis enquanto houver vagas; comissão de 13% sobre os serviços fechados e confirmados.</li>'+
       '<li>Depois do desbloqueio, use o chat e, quando o telefone estiver disponível, o WhatsApp do cliente. Até 4 profissionais podem participar de um pedido; não há garantia de contratação.</li>'+
       '<li>O Pix de assinatura ou recarga é apresentado no checkout. Nenhum plano é ativado como pago antes da confirmação do pagamento.</li>'+
       '<li>O teste de 48 horas é opcional e não gera cobrança automática. Pagamentos de serviços pela plataforma, quando oferecidos, seguem as condições apresentadas no pedido.</li></ul>';
      group.after(conditions);
     }
     function updateChoice(){
      const test=!!trialInput?.checked;
      if(test&&livre)livre.checked=true;
      const selected=form.querySelector('[name=planoEscolhido]:checked')?.value||'livre';
      const b=form.querySelector('[data-cad-criar]');
      if(b)b.textContent=test?'Começar meu teste grátis de 2 dias':selected==='avulso'?'Ativar Avulso — pagar recarga R$ 13,00':'Ativar Livre por Pix — R$ 39,90';
      const note=form.querySelector('[data-plano-nota]');
      if(note){
       note.classList.remove('qf-cad-planos__nota--aviso');
       note.textContent=test?'Dois dias grátis, sem pagamento nem cobrança automática. Prefere pagar agora? Selecione Livre ou Avulso acima.':selected==='avulso'?'Recarga obrigatória de R$ 13,00 vira saldo integral para desbloquear pedidos. Escolha Pix ou cartão no próximo passo.': 'R$ 39,90 por 30 dias · menos de R$ 1,50/dia · desbloqueios ilimitados. O Pix é gerado no próximo passo, e a ativação ocorre após confirmação.';
      }
      if(trialLabel)trialLabel.classList.toggle('qf-trial-card--selected',test);
      if(conditions)conditions.hidden=false;
     }
     // O rádio Livre começa marcado. Até clicar nele novamente deve desmarcar o teste.
     group.addEventListener('click',e=>{
      const card=e.target.closest?.('label'),input=card?.querySelector('[name="planoEscolhido"]');
      if(!input)return;
      if(trialInput)trialInput.checked=false;
      if(input.value==='avulso'&&avulso)avulso.checked=true;
      if(input.value==='livre'&&livre)livre.checked=true;
      updateChoice();
     });
     form.addEventListener('change',e=>{
      if(e.target?.name==='planoEscolhido'){
       if(trialInput)trialInput.checked=false;
       updateChoice();
      }else if(e.target?.name==='testeLivre'){
       if(trialInput?.checked&&livre)livre.checked=true;
       updateChoice();
      }
     });
     updateChoice();
    }
   }
   let pending=false,busy=false,last={};
   // V12.1.17: compra do Quem Faz Livre só é medida após assinatura realmente aprovada.
   // O recarga_id vira eventID/transaction_id e impede duplicação no mesmo aparelho.
   function trackLivrePurchase(s){
    try{
     if(!s||!s.ativo||Number(s.valor_centavos)!==3990||!s.recarga_id||typeof g.fbq!=='function')return false;
     const paidAt=Date.parse(s.pago_em||'');
     const age=Date.now()-paidAt;
     // Não reconta a base antiga ao publicar o recurso; captura pagamentos recentes e os próximos em tempo real.
     if(!Number.isFinite(paidAt)||age<0||age>48*60*60*1000)return false;
     if(g.QFConversao&&typeof g.QFConversao.consentimento==='function'&&g.QFConversao.consentimento()!=='granted')return false;
     const recarga=String(s.recarga_id);
     const flag='qf_purchase_sent:'+recarga;
     if(localStorage.getItem(flag))return false;
     const eventID='qf-livre-'+recarga;
     g.fbq('track','Purchase',{
      value:39.90,
      currency:'BRL',
      content_name:'Quem Faz Livre - 30 dias',
      content_ids:['quem_faz_livre_30d'],
      content_type:'product',
      num_items:1
     },{eventID:eventID});
     localStorage.setItem(flag,'1');
     try{
      g.dataLayer=g.dataLayer||[];
      g.dataLayer.push({event:'qf_livre_purchase',transaction_id:recarga,value:39.90,currency:'BRL'});
     }catch(_){}
     return true;
    }catch(_){return false;}
   }
   g.QFTrackLivrePurchase=trackLivrePurchase;
   function bind(){
    const b=box.querySelector('[data-qf-livre-pagar]');if(b)b.onclick=pay;
    const identify=box.querySelector('[data-qf-livre-identificar]');if(identify)identify.onclick=()=>{identificationPending=true;g.navigate('/profissional/perfil',true);};
    const change=box.querySelector('[data-qf-livre-trocar]');if(change)change.onclick=()=>{
     const dialog=document.createElement('dialog');dialog.className='qf-plan-chooser';dialog.innerHTML='<h2>Como você quer desbloquear pedidos?</h2><p>Mudar a opção não cancela um benefício ainda válido nem faz cobrança automática.</p><button type="button" class="btn btn--primary" data-plan-choice="livre">Quem Faz Livre · R$ 39,90 / 30 dias</button><p>Pedidos compatíveis ilimitados enquanto houver vagas. Comissão de 13% nos serviços fechados e confirmados.</p><button type="button" class="btn btn--outline" data-plan-choice="avulso">Usar Avulso · pagar por desbloqueio</button><p>Usa créditos da carteira. Sem mensalidade e sem comissão sobre o serviço.</p><p role="alert"></p><button class="btn btn--outline" type="button" data-plan-close>Voltar</button>';
     document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-plan-close]').onclick=()=>dialog.close();dialog.showModal();
     dialog.querySelectorAll('[data-plan-choice]').forEach(button=>button.onclick=async()=>{dialog.querySelectorAll('button').forEach(x=>x.disabled=true);try{
      const choice=button.dataset.planChoice,result=await rpc('qf_livre_escolher_modalidade',{p_modalidade:choice});if(!result?.ok)throw Error('Não foi possível salvar sua escolha.');
      dialog.close();await refresh();if(choice==='avulso'){openAvulso=true;g.navigate('/profissional/carteira',true);}else if(!last.ativo&&!last.aguarda_identificacao)await pay();
     }catch(error){dialog.querySelector('[role=alert]').textContent=error.message;dialog.querySelectorAll('button').forEach(x=>x.disabled=false);}});
    };
   }
   async function mostrarContaPix(s){
    if(pattern!=='/profissional/carteira'||!box.isConnected)return;
    const parent=box.parentElement;
    if(!parent||parent.querySelector('[data-qf-livre-pix-cadastro]'))return;
    const area=document.createElement('section');
    area.dataset.qfLivrePixCadastro='';
    area.className='card stack--sm';
    area.style.cssText='border:1.5px solid #b5d1ef;border-radius:18px;background:#f7faff;padding:18px;margin:12px 0 18px';
    area.innerHTML='<details data-qf-pix-detalhes><summary style="color:#1458cc;font-weight:800;font-size:17px;cursor:pointer;padding:2px 0 10px" >Cadastre sua chave Pix</summary>'+
     '<p class="text--sm">Esta é a conta onde você poderá receber repasses de serviços pagos ao Quem Faz. Salvar a chave não faz cobrança nem transfere dinheiro.</p>'+
     '<form data-qf-pix-form class="stack--sm">'+
     '<label>Chave Pix<input class="input" name="chavePix" maxlength="100" autocomplete="off" required placeholder="CPF, CNPJ, e-mail, celular ou chave aleatória"></label>'+
     '<button type="submit" class="btn btn--primary" data-qf-pix-salvar>Salvar minha chave Pix</button></form></details>'+
     '<p role="status" aria-live="polite" data-qf-pix-status>Consultando chave Pix...</p>'+
     '<p class="text--sm text--secondary" style="font-size:13px">O recebimento do valor integral do serviço pelo Quem Faz ainda não está disponível. Quando for liberado, a equipe fará o repasse após confirmar o pagamento e a conclusão. Você não precisa abrir outra conta bancária.</p>'+ 
     '<details class="text--sm"><summary>Informações sobre recebimento</summary><p>Receba na conta que você já usa. Não precisa abrir conta Efí. O repasse será feito manualmente pelo administrador; não existe transferência automática.</p></details>';
    box.insertAdjacentElement('afterend',area);
    const status=area.querySelector('[data-qf-pix-status]'),form=area.querySelector('form');
    let userId=null;
    try{
      const auth=await client.auth.getUser();
      userId=auth?.data?.user?.id;
      if(!userId)throw Error('Entre na sua conta de profissional para cadastrar a chave.');
      const {data,error}=await client.from('qf_livre_pix_chaves')
        .select('chave_pix,status').eq('profissional_id',userId).maybeSingle();
      if(error)throw Error('Não foi possível consultar sua chave Pix.');
      if(!area.isConnected)return;
      if(data){
        form.elements.chavePix.value=data.chave_pix;
        status.textContent='Chave Pix cadastrada · aguardando validação.';
        area.querySelector('[data-qf-pix-detalhes] summary').textContent='Minha chave Pix · alterar';
        area.querySelector('[data-qf-pix-detalhes]').open=false;
      }else{
        status.textContent='Chave Pix não cadastrada.';
        area.querySelector('[data-qf-pix-detalhes]').open=true;
      }
    }catch(e){if(area.isConnected)status.textContent=e.message||'Cadastro indisponível.';}
    form.onsubmit=async event=>{
      event.preventDefault();
      const button=form.querySelector('[data-qf-pix-salvar]');
      const chave=String(form.elements.chavePix.value||'').trim();
      const valid=/^(?:[0-9]{11}|[0-9]{14}|\+55[1-9][0-9]{10,11}|[^\s@]+@[^\s@]+\.[^\s@]+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(chave);
      if(!valid){status.textContent='Chave inválida. Informe CPF, CNPJ, e-mail, telefone com +55 ou chave aleatória.';return;}
      button.disabled=true;status.textContent='Salvando chave Pix...';
      try{
        if(!userId){
          const auth=await client.auth.getUser();
          userId=auth?.data?.user?.id;
        }
        if(!userId)throw Error('Entre novamente na conta de profissional.');
        const {error}=await client.from('qf_livre_pix_chaves').upsert({
          profissional_id:userId,chave_pix:chave,status:'pendente',atualizado_em:new Date().toISOString()
        },{onConflict:'profissional_id'});
        if(error)throw Error('Não foi possível salvar a chave. Atualize a página e tente novamente.');
        status.textContent='Chave Pix salva · aguardando validação.';
      }catch(e){status.textContent=e.message||'Não foi possível salvar.';}
      finally{button.disabled=false;}
    };
   }
   function render(s){
    last=s||{};
    box.classList.remove('qf-livre--checkout','qf-livre--promo','qf-livre--compact');
    if(last.ativo&&!pedido&&pattern!=='/profissional/planos'){
     box.classList.add('qf-livre--compact');
     box.innerHTML='<span class="qf-livre__icon" aria-hidden="true">✓</span><span class="qf-livre__copy"><strong>Quem Faz Livre ativo</strong><small>Desbloqueios ilimitados · válido até '+esc(date(last.valido_ate))+'</small></span><a href="#/profissional/planos" class="qf-livre__link">Ver plano ›</a>';
    }else{
     box.innerHTML=oferta(last);
     if(pattern==='/profissional/home'){
      box.classList.add('qf-livre--compact','qf-livre--promo');
      box.innerHTML='<span class="qf-livre__icon" aria-hidden="true">'+(typeof g.icon==='function'?g.icon('crown'):'∞')+'</span><span class="qf-livre__copy"><strong>Desbloqueie o quanto quiser <em>por R$ 1,33/dia</em></strong><small>R$ 39,90 por 30 dias · ativação pelo Pix</small></span><a class="qf-livre__link" href="#/profissional/carteira">Ver plano ›</a>';
     }
    }
    if(last.tipo_acesso==='teste'||last.tipo_acesso==='cortesia'){
     const active=last.ativo;
     const title=last.tipo_acesso==='teste'?(active?'Teste grátis ativo':'Seu teste grátis terminou!'):(active?'Quem Faz Livre — cortesia ativa':'Cortesia encerrada');
     const note=active?'Termina em '+esc(date(last.valido_ate))+'. Comissão de 13% e prestação de contas mantidas.':last.aguarda_identificacao?'Conclua sua identificação para iniciar a contagem.':'Para continuar desbloqueando novas oportunidades, ative o Quem Faz Livre por R$ 39,90 durante 30 dias. Sem cobrança automática.';
     box.innerHTML='<div class="qf-livre__copy"><strong>'+title+'</strong><p>'+note+'</p></div>'+(!active&&!last.aguarda_identificacao?'<button type="button" class="btn btn--primary" data-qf-livre-pagar>ATIVAR PLANO — R$ 39,90</button>':'');
     if(last.tipo_acesso==='teste')box.querySelector('.qf-livre__copy').insertAdjacentHTML('beforeend',trialProgress(last));
     if(active&&last.tipo_acesso==='teste'&&Date.parse(last.valido_ate)-Date.parse(last.servidor_agora)<12*3600000)box.insertAdjacentHTML('beforeend','<p>Seu teste termina em breve. Continue com o Plano Livre por R$ 39,90.</p>');
    }
    if(!cadastro&&!pedido){
     box.classList.remove('qf-livre--promo');box.classList.add('qf-livre--compact','qf-plan-status');box.innerHTML=planSummary(last);
    }
    if(pattern==='/profissional/perfil'){
     const account=Array.from(view.children).find(x=>x.classList.contains('card')&&!x.hasAttribute('data-qf-livre'));const badge=account?.querySelector('.badge');
     if(badge)badge.textContent=last.aguarda_identificacao?'Identificação pendente':last.ativo?(last.tipo_acesso==='teste'?'Teste grátis':last.tipo_acesso==='cortesia'?'Cortesia ativa':'Plano Livre ativo'):last.pacotes_ativos?.length?'Plano '+String(last.pacotes_ativos[0].plano)+' ativo':last.tipo_acesso==='pago'?'Livre vencido':last.tipo_acesso==='teste'?'Teste encerrado':last.tipo_acesso==='cortesia'?'Cortesia encerrada':'Plano Avulso';
    }
    bind();
    mostrarContaPix(s).catch(()=>{});
    if(cadastro){box.querySelector('[data-qf-livre-pagar]')?.remove();box.querySelector('[data-qf-livre-pix]')?.remove();}
   }
   function unlock(s){
    // Somente assinatura Livre paga e ativa autoriza o desbloqueio do plano.
    if(!pedido||box.querySelector('[data-qf-livre-desbloquear],[data-qf-livre-credito]'))return;
    const req=g.DB&&g.DB.requestById(params.id),pago=content.querySelector('[data-action="desbloquear-chamada"]');
    if(!req||!pago)return;
    if(req.atendimentoTipo==='garante'||req.modalidade==='valor_definido')return;
    if(!s.ativo||s.preferencia==='avulso')return;
    box.insertAdjacentHTML('beforeend','<label><input type="checkbox" data-qf-livre-termos><span>Aceito prestar contas e pagar 13% somente por serviço fechado e confirmado, conforme as condições da modalidade.</span></label><button type="button" class="btn btn--primary" data-qf-livre-desbloquear>Desbloquear com Quem Faz Livre</button>');
    const b=box.querySelector('[data-qf-livre-desbloquear]');b.onclick=async()=>{
     const msg=box.querySelector('[data-qf-livre-msg]');if(!box.querySelector('[data-qf-livre-termos]').checked){msg.textContent='Aceite as condições para desbloquear com o plano.';return;}
     b.disabled=true;try{const r=await rpc('qf_livre_desbloquear',{p_chamado_id:params.id,p_aceitar:true});if(!r.ok&&r.reason==='comissao_pendente'){msg.textContent='Comissão pendente. Abrindo o Pix automático na carteira.';g.navigate('/profissional/carteira',true);return;}if(!r.ok)throw Error(({credito_necessario:'Assine o Quem Faz Livre ou utilize o Avulso com saldo na carteira.',plano_inativo:'Plano vencido ou inativo. Renove ou utilize créditos.',reservado:'O pedido já atingiu o limite de participantes.',nao_elegivel:'Pedido incompatível com sua profissão, região ou raio.',indisponivel:'Pedido indisponível para este plano.',selfie_obrigatoria:'Conclua seu perfil com uma foto.',perfil_inativo:'Confira a situação do seu perfil e do plano.',prestacao_contas_vencida:'Regularize sua prestação de contas na carteira.',comissao_vencida:'Regularize a comissão confirmada na carteira.',comissao_pendente:'A comissão pendente deve ser paga por Pix na carteira antes de outro desbloqueio.'})[r.reason]||'Não foi possível autorizar o desbloqueio. Atualize o pedido.');if(g.QFCloud.syncForCurrentSession)await g.QFCloud.syncForCurrentSession(true);g.navigate('/profissional/chat/'+params.id,true);}catch(e){msg.textContent=e.message;b.disabled=false;}
    };
   }
   async function refresh(){const s=await rpc('qf_livre_status');if(!box.isConnected)return false;if(!s||!s.ok)return false;if(pending&&s.ativo&&['teste','cortesia'].includes(s.tipo_acesso))return false;if(s.ativo){trackLivrePurchase(s);pending=false;render(s);unlock(s);return true;}if(!pending){render(s);unlock(s);}return false;}
   async function pay(){
    if(busy)return;
    busy=true;pending=true;const button=box.querySelector('[data-qf-livre-pagar]'),msg=box.querySelector('[data-qf-livre-msg]');if(button)button.disabled=true;msg.textContent='Preparando seu Pix…';
    try{
     const current=await rpc('qf_livre_status');if(!current?.ok)throw Error('Não foi possível confirmar a situação do seu plano.');if(current.ativo&&!['teste','cortesia'].includes(current.tipo_acesso)){pending=false;render(current);unlock(current);return;}
     const r=await rpc('qf_livre_solicitar_pix');if(!r||!r.ok)throw Error('Conclua seu cadastro de profissional antes de assinar.');
     const fn=await client.functions.invoke('quemfaz-efi-checkout',{body:{tipo:'recarga',pagamento_id:r.recarga_id}});
     if(fn.error||!fn.data?.ok)throw Error('Não foi possível gerar o Pix. Tente novamente em instantes.');
     if(await refresh())return;
     const x=fn.data;pending=true;
     if(!x.pix_copy_paste)throw Error('O Pix ainda está sendo preparado. Tente novamente.');
     box.classList.remove('qf-livre--compact','qf-livre--promo');
     box.classList.add('qf-livre--checkout');
     box.innerHTML='<div data-qf-livre-pix>' +
       '<h2 class="qf-livre-pix__title">Pague por Pix</h2>' +
       '<p class="qf-livre-pix__sub">Plano Quem Faz Livre · R$ 39,90</p>' +
       (typeof x.qr_image==='string'&&/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(x.qr_image)?'<img class="qf-livre-pix__qr" src="'+esc(x.qr_image)+'" alt="QR Code Pix do Quem Faz Livre">':'') +
       '<p class="qf-livre-pix__note">Pix válido por 24 horas. O plano ativa automaticamente após a confirmação do pagamento.</p>' +
       '<textarea class="qf-livre-pix__code" readonly aria-label="Código Pix copia e cola">'+esc(x.pix_copy_paste)+'</textarea>' +
       '<div class="qf-livre-pix__actions"><button type="button" class="btn btn--primary" data-qf-livre-copiar>Copiar Pix</button><button type="button" class="btn btn--outline" data-qf-livre-verificar>Verificar ativação</button></div></div>' +
       '<p role="status" aria-live="polite" data-qf-livre-msg>Aguardando confirmação do Pix da assinatura de R$ 39,90.</p>';
     const pix=box.querySelector('[data-qf-livre-pix]'),status=box.querySelector('[data-qf-livre-msg]');
     pix.querySelector('[data-qf-livre-copiar]').onclick=async()=>{try{await navigator.clipboard.writeText(x.pix_copy_paste);status.textContent='Pix copiado. Abra o aplicativo do seu banco para pagar.';}catch(_){const t=pix.querySelector('textarea');t.focus();t.select();status.textContent='Selecione e copie o código Pix.';}};
     pix.querySelector('[data-qf-livre-verificar]').onclick=()=>refresh().then(active=>{if(!active&&box.isConnected)status.textContent='Pagamento ainda não confirmado. Você pode verificar novamente.';}).catch(()=>status.textContent='Não foi possível consultar agora. Tente novamente.');
     // Troca a oferta pelo checkout: sem botão de assinar ou valores repetidos sobre o QR Code.
     try{box.scrollIntoView({behavior:'smooth',block:'start'});}catch(_){}

     let tries=0;const poll=async()=>{if(!box.isConnected||!pending||++tries>180)return;try{if(await refresh())return;}catch(_){}if(box.isConnected&&pending)setTimeout(poll,5000);};setTimeout(poll,5000);
    }catch(e){pending=false;const visible=box.querySelector('[data-qf-livre-msg]');if(visible)visible.textContent=e.message;}finally{busy=false;if(button&&button.isConnected)button.disabled=false;}
   }
   if(cadastro){render({});return;}
   const validityTimer=setInterval(()=>{if(!box.isConnected){clearInterval(validityTimer);return;}if(!pending&&!busy)refresh().catch(()=>{});},60000);
   box.innerHTML='<p role="status">Consultando seu plano…</p>';
   async function load(){
    const s=await rpc('qf_livre_status');if(!box.isConnected)return;
    if(!s?.ok)throw Error('Entre novamente para consultar seu plano.');
    if(s.ativo)trackLivrePurchase(s);
    render(s);unlock(s);
    // O pagamento só começa quando o profissional escolhe Assinar.
    try{sessionStorage.removeItem('qf_plano_pos_cadastro');sessionStorage.removeItem('qf_plano_pos_cadastro_metodo');}catch(_){}
   }
   // Cadastro bancário independente do estado e da disponibilidade da assinatura.
   mostrarContaPix(null).catch(()=>{});
   load().catch(()=>{if(box.isConnected)box.innerHTML='<p role="status">Não foi possível consultar seu plano.</p><button class="btn btn--outline" data-qf-livre-retry>Tentar novamente</button>';const retry=box.querySelector('[data-qf-livre-retry]');if(retry)retry.onclick=load;});
  }
  g.QFLivre.enhance=enhance;
  g.Screens.afterRender=function(){if(prior)prior.apply(this,arguments);enhance.apply(this,arguments);};
  g.Screens.afterRenderAnon=function(){if(priorAnon)priorAnon.apply(this,arguments);enhance.apply(this,arguments);};
  let path=(g.location.hash||'').replace(/^#/,''),params={};const m=path.match(/^\/profissional\/(pedido|chamada)\/([^/]+)$/);if(m){path='/profissional/'+m[1]+'/:id';params.id=m[2];}if(path==='/auth/profissional/cadastro'){path='/auth/:role/cadastro';params.role='profissional';}const c=document.getElementById('app-content');if(c)enhance(path,c,params);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(typeof window!=='undefined'?window:globalThis);


/* QF etapa 5: três cartões aprovados - 2026-10-30 */
(function () {
  'use strict';
  if (typeof document === 'undefined') return; // testes Node sem DOM
  const STYLE_ID = 'qf-planos-etapa5-20261030';
  const CSS = [
    '#cadastro-prof-form [data-step="5"] .qf-options-final{display:grid;gap:14px;margin:18px 0 12px;padding-bottom:8px}',
    '#cadastro-prof-form [data-step="5"] .qf-step__head .h2{font-size:clamp(23px,5vw,30px);line-height:1.2;letter-spacing:-.025em;color:#123666}',
    '#cadastro-prof-form [data-step="5"] .qf-step__head .text--sm{font-size:14px;line-height:1.5}',
    '#cadastro-prof-form [data-step="5"] .qf-options-card{position:relative;min-width:0;display:grid;gap:10px;padding:20px 16px 16px;border:1px solid #dce4ee;border-radius:20px;background:#fff;box-shadow:0 7px 25px rgba(16,46,81,.075);overflow:hidden}',
    '#cadastro-prof-form [data-step="5"] .qf-options-card--trial{background:linear-gradient(145deg,#eff7ff,#e6f1ff);border:2px solid #1886f3}',
    '#cadastro-prof-form [data-step="5"] .qf-options-card--trial .qf-options-price{color:#085eb8}',
    '#cadastro-prof-form [data-step="5"] .qf-options-card--livre .qf-options-price{color:#f36b09}',
    '#cadastro-prof-form [data-step="5"] .qf-options-card--avulso .qf-options-price{color:#08804c}',
    '#cadastro-prof-form [data-step="5"] .qf-options-top{display:flex;gap:12px;align-items:flex-start;min-width:0}',
    '#cadastro-prof-form [data-step="5"] .qf-options-icon{display:grid;place-items:center;flex:none;width:45px;height:45px;border-radius:14px;background:#0966cd;color:#fff;font-weight:900;font-size:20px;letter-spacing:-.05em}',
    '#cadastro-prof-form [data-step="5"] .qf-options-card--livre .qf-options-icon{background:#ff8c1a}',
    '#cadastro-prof-form [data-step="5"] .qf-options-card--avulso .qf-options-icon{background:#079d62}',
    '#cadastro-prof-form [data-step="5"] .qf-options-headings{flex:1;min-width:0}',
    '#cadastro-prof-form [data-step="5"] .qf-options-name{font-size:20px;line-height:1.25;font-weight:800;color:#13335d;margin:0}',
    '#cadastro-prof-form [data-step="5"] .qf-options-price{margin-top:5px;font-size:28px;line-height:1.1;font-weight:900;letter-spacing:-.025em}',
    '#cadastro-prof-form [data-step="5"] .qf-options-price small{font-size:14px;color:#5b6879;font-weight:600;letter-spacing:0}',
    '#cadastro-prof-form [data-step="5"] .qf-options-badge{display:inline-block;justify-self:start;padding:5px 10px;background:#d0ecff;color:#074f99;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.025em}',
    '#cadastro-prof-form [data-step="5"] .qf-options-card--livre .qf-options-badge{background:#fff0d9;color:#b85b00}',
    '#cadastro-prof-form [data-step="5"] .qf-options-list{margin:0;padding:0;display:grid;gap:7px;list-style:none}',
    '#cadastro-prof-form [data-step="5"] .qf-options-list li{display:flex;gap:9px;align-items:start;font-size:14px;line-height:1.35;color:#264565}',
    '#cadastro-prof-form [data-step="5"] .qf-options-list li::before{content:"✓";display:grid;place-items:center;flex:none;width:18px;height:18px;border-radius:50%;background:#096bcd;color:#fff;font-size:12px;font-weight:900}',
    '#cadastro-prof-form [data-step="5"] .qf-options-card--livre .qf-options-list li::before{background:#f6790e}',
    '#cadastro-prof-form [data-step="5"] .qf-options-card--avulso .qf-options-list li::before{background:#008e53}',
    '#cadastro-prof-form [data-step="5"] .qf-options-note{font-size:12.5px;color:#526478;line-height:1.4}',
    '#cadastro-prof-form [data-step="5"] .qf-options-button{display:block;width:100%;min-height:51px;margin-top:4px;padding:12px;border:0;border-radius:13px;background:#0869db;color:#fff;font-size:15px;font-weight:800;line-height:1.3;cursor:pointer;white-space:normal;text-align:center;box-shadow:0 5px 12px rgba(5,85,178,.12)}',
    '#cadastro-prof-form [data-step="5"] .qf-options-card--livre .qf-options-button{background:#ff7b0a}',
    '#cadastro-prof-form [data-step="5"] .qf-options-card--avulso .qf-options-button{background:#08945a}',
    '#cadastro-prof-form [data-step="5"] .qf-options-button:focus-visible{outline:3px solid #123c74;outline-offset:3px}',
    '#cadastro-prof-form [data-step="5"] .qf-options-button:disabled{opacity:.7;cursor:wait}',
    '#cadastro-prof-form [data-step="5"] .qf-options-original,.qf-options-original{display:none!important}',
    '#cadastro-prof-form [data-step="5"] .qf-step__nav{padding-bottom:calc(90px + env(safe-area-inset-bottom,0px));margin-top:4px;display:flex;flex-direction:row!important;justify-content:flex-start}',
    '#cadastro-prof-form [data-step="5"] .qf-step__nav button[data-step-back]{flex:0 0 auto;width:auto;min-height:44px}',
    '#cadastro-prof-form [data-step="5"] .qf-step__nav [data-cad-criar]{display:none!important}',
    '@media(max-width:390px){#cadastro-prof-form [data-step="5"] .qf-options-card{padding:16px 13px 14px}#cadastro-prof-form [data-step="5"] .qf-options-name{font-size:18px}#cadastro-prof-form [data-step="5"] .qf-options-price{font-size:25px}#cadastro-prof-form [data-step="5"] .qf-options-button{font-size:14px}}'
  ].join('\n');
  function mount() {
    const form = document.getElementById('cadastro-prof-form');
    if (!form || form.dataset.qfOptions20261030 === 'yes') return;
    const step = form.querySelector('[data-step="5"]');
    if (!step || !form.querySelector('[name="testeLivre"]') || !form.querySelector('[name="planoEscolhido"][value="livre"]')) return;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const header = step.querySelector('.qf-step__head');
    if (header) header.innerHTML =
      '<div class="qf-step__count">Etapa 5 de 5</div>' +
      '<div class="h2">Escolha como quer começar</div>' +
      '<div class="text--sm text--secondary">Seus dados estão preenchidos. Escolha a melhor forma de usar o Quem Faz.</div>' +
      '<div class="qf-step__bar"><span style="width:100%"></span></div>';
    const list = step.querySelector('.qf-cad-planos');
    if (!list) return;
    list.classList.add('qf-options-original');
    const note = step.querySelector('[data-plano-nota]');
    if (note) note.classList.add('qf-options-original');
    const trial = step.querySelector('[name="testeLivre"]');
    if (trial && trial.closest('label')) trial.closest('label').classList.add('qf-options-original');
    const courtesy = step.querySelector('[name="cortesiaLivre"]');
    if (courtesy && courtesy.closest('label')) courtesy.closest('label').classList.add('qf-options-original');
    const notes = Array.from(step.children).filter(node => node.tagName === 'P' && node.textContent.includes('Avulso: R$ 13'));
    notes.forEach(node => node.classList.add('qf-options-original'));
    const ui = document.createElement('div');
    ui.className = 'qf-options-final';
    ui.setAttribute('aria-label', 'Escolha sua forma de começar');
    ui.innerHTML = [
      '<section class="qf-options-card qf-options-card--trial">',
      '<span class="qf-options-badge">TESTE GRÁTIS · 48 HORAS</span>',
      '<div class="qf-options-top"><span class="qf-options-icon" aria-hidden="true">48h</span><div class="qf-options-headings"><h3 class="qf-options-name">Teste grátis — 48 horas</h3><div class="qf-options-price">R$ 0,00</div></div></div>',
      '<ul class="qf-options-list"><li>Desbloqueios ilimitados por 2 dias</li><li>Chat com clientes e pedidos compatíveis</li><li>Sem Pix, recarga ou pagamento inicial</li></ul>',
      '<p class="qf-options-note">O teste começa após a identificação. Um por profissional, sem cobrança automática.</p>',
      '<button class="qf-options-button" type="button" data-qf-opcao="trial">Começar com teste grátis</button>',
      '</section>',
      '<section class="qf-options-card qf-options-card--livre">',
      '<span class="qf-options-badge">PLANO MENSAL</span>',
      '<div class="qf-options-top"><span class="qf-options-icon" aria-hidden="true">∞</span><div class="qf-options-headings"><h3 class="qf-options-name">Quem Faz Livre</h3><div class="qf-options-price">R$ 39,90 <small>/ 30 dias</small></div></div></div>',
      '<ul class="qf-options-list"><li>Desbloqueios ilimitados de pedidos compatíveis</li><li>Chat com clientes</li><li>Comissão de 13% somente em serviços fechados e confirmados</li></ul>',
      '<p class="qf-options-note">Equivale a R$ 1,33 por dia. Pagamento antes da ativação, sem renovação automática.</p>',
      '<button class="qf-options-button" type="button" data-qf-opcao="livre">Ativar Plano Livre</button>',
      '</section>',
      '<section class="qf-options-card qf-options-card--avulso">',
      '<span class="qf-options-badge">SEM MENSALIDADE</span>',
      '<div class="qf-options-top"><span class="qf-options-icon" aria-hidden="true">R$</span><div class="qf-options-headings"><h3 class="qf-options-name">Avulso — créditos</h3><div class="qf-options-price">R$ 13,00 <small>recarga mínima</small></div></div></div>',
      '<ul class="qf-options-list"><li>Valor integral convertido em saldo na carteira</li><li>Desbloqueie apenas os pedidos que interessarem</li><li>Não é taxa: é crédito para usar</li></ul>',
      '<p class="qf-options-note">Sem mensalidade e sem comissão sobre os serviços do plano Avulso.</p>',
      '<button class="qf-options-button" type="button" data-qf-opcao="avulso">Recarregar e começar</button>',
      '</section>'
    ].join('');
    list.parentNode.insertBefore(ui, list);
    form.dataset.qfOptions20261030 = 'yes';
    ui.addEventListener('click', function (event) {
      const button = event.target.closest('[data-qf-opcao]');
      if (!button || button.disabled) return;
      const mode = button.getAttribute('data-qf-opcao');
      const radio = form.querySelector('[name="planoEscolhido"][value="' + (mode === 'avulso' ? 'avulso' : 'livre') + '"]');
      const trialInput = form.querySelector('[name="testeLivre"]');
      const courtesyInput = form.querySelector('[name="cortesiaLivre"]');
      const submit = form.querySelector('[data-cad-criar]');
      if (!radio || !trialInput || !submit) return;
      if (courtesyInput) courtesyInput.checked = false;
      radio.checked = true;
      trialInput.checked = mode === 'trial';
      // Reaproveitar a validação de cadastro e os fluxos originais de Pix e de ativação do teste.
      (mode === 'trial' ? trialInput : radio).dispatchEvent(new Event('change', { bubbles:true }));
      if (typeof form.requestSubmit === 'function') form.requestSubmit(submit);
      else submit.click();
    });
  }
  function install() {
    mount();
    if (!document.body) return;
    const observer = new MutationObserver(function () {
      const form = document.getElementById('cadastro-prof-form');
      if (form && form.dataset.qfOptions20261030 !== 'yes') mount();
    });
    observer.observe(document.body, { childList:true, subtree:true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();

