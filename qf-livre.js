/* Quem Faz Livre: o navegador consulta; somente o servidor confirma e ativa. */
(function(g){
 'use strict';
 const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=v=>v?new Date(v).toLocaleDateString('pt-BR'):'';
 function divisao(){
  return '<section class="qf-divisao" aria-label="Divisão do valor do serviço no Quem Faz Livre"><h3>Você faz o serviço e fica com 87% do valor. O Quem Faz recebe 13% pela intermediação.</h3><div class="qf-divisao__bar" role="img" aria-label="87% para o profissional e 13% para o Quem Faz"><span class="qf-divisao__pro">87%</span><span class="qf-divisao__qf">13%</span></div><div class="qf-divisao__legenda"><span><i class="qf-divisao__verde"></i><b>Profissional · 87%</b><strong>R$ 174</strong></span><span><i class="qf-divisao__laranja"></i><b>Quem Faz · 13%</b><strong>R$ 26</strong></span></div><p>Exemplo: serviço de R$ 200. Você define o preço. Esta é a divisão do valor após a comissão no Quem Faz Livre; seus custos e tributos não estão descontados. Não representa lucro líquido garantido. No Avulso, não há comissão.</p></section>';
 }
 function oferta(s={}){
  return '<div class="qf-livre__eyebrow">QUEM FAZ LIVRE</div>' +
    '<h2 class="qf-livre__headline">Desbloqueie o quanto quiser <span>por R$ 1,33 ao dia</span></h2>' +
    '<p class="qf-livre__price">R$ 39,90 por 30 dias</p>' +
    '<div class="qf-livre__benefits">' +
      '<div><span aria-hidden="true" class="qf-livre__benefit-icon">∞</span><strong>Pedidos compatíveis ilimitados</strong></div>' +
      '<div><span aria-hidden="true" class="qf-livre__benefit-icon">%</span><strong>Você fica com 87% do valor do serviço</strong></div>' +
      '<div><span aria-hidden="true" class="qf-livre__benefit-icon">✓</span><strong>Ativação após a confirmação do Pix</strong></div>' +
    '</div>' +
    divisao() + '<details class="qf-livre__details"><summary>Saiba mais sobre o plano</summary>' +
      '<p>Sem cobrança por contato e sem renovação automática. São elegíveis apenas pedidos compatíveis, disponíveis e não exclusivos, com até 4 profissionais por pedido.</p>' +
      '<p>A comissão de 13% é gerada automaticamente quando o profissional informa o fechamento e valor, o cliente confirma a contratação, a conclusão e o valor com o código de segurança do pedido. Se houver divergência, a cobrança fica para análise. É necessário prestar contas em 48 horas; se estiver negociando, é possível prorrogar uma vez por mais 48 horas. Pendências vencidas impedem novos desbloqueios. O plano não garante contratação.</p>' +
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
  if(Array.isArray(g.QFCadPlanos))g.QFCadPlanos.splice(1);
  if(g.QFPlanoIncentivo)g.QFPlanoIncentivo.porChamado=()=>null;
  const css=document.createElement('style');css.textContent='.qf-livre{border:2px solid #1769d5!important;background:linear-gradient(120deg,#eef6ff,#fff8ed);border-radius:18px;padding:20px!important;margin:0 0 18px!important;min-width:0}.qf-livre h2{margin:8px 0;font-size:1.35rem}.qf-livre p{overflow-wrap:anywhere}.qf-livre textarea{width:100%;box-sizing:border-box;min-height:90px;overflow-wrap:anywhere}.qf-livre img{display:block;width:200px;max-width:100%;height:auto;margin:12px auto}.qf-livre label{display:flex;gap:10px;align-items:flex-start;margin:12px 0}.qf-livre input[type=checkbox]{width:20px;height:20px;flex:0 0 20px}.qf-livre .btn{white-space:normal}@media(max-width:639px){.qf-livre{padding:16px!important}.qf-livre .btn{width:100%}}';css.textContent += "\n/* Ajustes 23/10 — pedidos em evidência e estado do plano compacto */\n.qf-livre.qf-livre--compact{padding:12px 14px!important;margin:0 0 8px!important;display:flex;align-items:center;min-height:64px;gap:12px;border:1px solid #a7cdf6!important;background:#eef6ff!important;box-shadow:none!important;height:auto!important}\n.qf-livre--compact .qf-livre__icon{display:grid;place-items:center;flex:none;width:37px;height:37px;border:1px solid #b2d6fa;border-radius:10px;color:#075bbb;font-size:22px;font-weight:800}\n.qf-livre--compact .qf-livre__copy{min-width:0;flex:1}\n.qf-livre--compact .qf-livre__copy strong{display:block;color:#075bbb;font-size:14px;line-height:1.3}\n.qf-livre--compact .qf-livre__copy small{display:block;font-size:12.5px;line-height:1.35;color:#42526c;margin-top:3px}\n.qf-livre--compact .qf-livre__link{flex:none;white-space:nowrap;font-weight:750;font-size:13px;color:#075bbb;text-decoration:none}\n.qf-livre--compact .qf-livre__link:focus-visible{outline:2px solid #075bbb;outline-offset:3px}\n#app-shell[data-route=\"profissional-home\"] .view>.qf-livre--compact,\n#app-shell[data-route=\"profissional-carteira\"] .view>.qf-livre--compact{grid-column:1/-1;grid-row:auto;break-inside:avoid}\n#app-shell[data-route=\"profissional-home\"] .view>#chamados-disponiveis{grid-column:1/-1;order:0}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-order-heading h2{font-size:clamp(19px,4.8vw,25px);font-weight:850}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-order-tabs{gap:8px;border:0;margin:10px 0 14px;overflow-x:auto}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-order-tabs>*{flex:0 0 auto;min-height:42px;border:1px solid #c8d3e1;border-radius:999px;padding:9px 13px;background:#fff;font-size:13px;white-space:nowrap}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-order-tabs [aria-current]{border:1px solid #075bbb;background:#075bbb;color:#fff}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-status{height:auto!important}\n#app-shell[data-route=\"profissional-carteira\"] .view>.qf-livre{column-span:all}\n#app-shell[data-route=\"profissional-carteira\"] .view>.qf-livre+ .card{column-span:all}\n#cadastro-prof-form .qf-step__nav{position:sticky;bottom:env(safe-area-inset-bottom,0px);z-index:12;display:flex;gap:10px;background:rgba(255,255,255,.97);padding:12px;border:1px solid #e0e9f4;border-radius:16px;box-shadow:0 4px 22px rgba(17,43,76,.10);margin-top:12px}\n#cadastro-prof-form .qf-step__nav .btn{min-height:48px}\n#cadastro-prof-form .qf-step .field input,#cadastro-prof-form .qf-step .field select,#cadastro-prof-form .qf-step .field textarea{scroll-margin-bottom:95px}\n#cadastro-prof-form .qf-step__head .text--sm{max-width:43ch}\n#cadastro-prof-form .qf-cad-planos__nota{line-height:1.4}\n@media(min-width:768px){#cadastro-prof-form .qf-step__nav{position:static;box-shadow:none} }\n@media(max-width:380px){.qf-livre--compact .qf-livre__icon{display:none}.qf-livre--compact .qf-livre__link{font-size:12px} }\n\n/* Layout aprovado — divulgação do Livre, explicação e checkout Pix */\n.qf-livre:not(.qf-livre--compact){background:#fff!important;border:2px solid #1369d6!important;box-shadow:none}\n.qf-livre__eyebrow{font-size:12px;font-weight:850;letter-spacing:.035em;color:#101a35}\n.qf-livre .qf-livre__headline{margin:10px 0 0;font-size:clamp(21px,5.6vw,30px);line-height:1.2;letter-spacing:-.022em;color:#0b55be;font-weight:850}\n.qf-livre__headline span{display:block}\n.qf-livre .qf-livre__price{font-size:17px;color:#48546a;margin:6px 0 14px}\n.qf-livre__benefits{display:flex;flex-direction:column;gap:16px;margin:16px 0 18px}\n.qf-livre__benefits>div{display:flex;align-items:center;gap:12px;min-width:0}\n.qf-livre__benefits strong{font-size:15px;line-height:1.3;color:#14213d}\n.qf-livre__benefit-icon{display:grid;place-items:center;width:36px;height:36px;flex:0 0 36px;border-radius:50%;background:#e8f1ff;color:#0b63ce;font-size:24px;font-weight:850}\n.qf-livre__details{margin:4px 0 18px}\n.qf-livre__details summary{cursor:pointer;color:#075bbb;font-weight:750;font-size:14px;padding:8px 2px}\n.qf-livre__details p{font-size:13px;line-height:1.5;color:#4b5870;margin:9px 0}\n.qf-livre__cta{min-height:52px;font-weight:800}\n.qf-livre.qf-livre--compact.qf-livre--promo{border:0!important;background:linear-gradient(115deg,#064cae,#0067dd)!important;box-shadow:0 4px 14px rgba(3,81,176,.16)!important;min-height:80px;padding:12px 14px!important}\n.qf-livre--promo .qf-livre__icon{border:0;background:rgba(0,0,0,.12);color:#ffe37b;width:38px;height:38px}\n.qf-livre--promo .qf-livre__icon svg{width:24px;height:24px;stroke:currentColor}\n.qf-livre--promo .qf-livre__copy strong{font-size:clamp(13px,3.5vw,17px);line-height:1.22;font-weight:850;color:#fff}\n.qf-livre--promo .qf-livre__copy strong em{font-style:normal;color:#ffe073;white-space:nowrap}\n.qf-livre--promo .qf-livre__copy small{color:#f2f7ff;font-size:11.5px}\n.qf-livre--promo .qf-livre__link{display:inline-flex;justify-content:center;align-items:center;min-height:39px;padding:7px 10px;border-radius:999px;background:#fff;color:#075bbb;font-size:12px}\n.qf-livre--checkout .qf-livre-pix__title{font-size:24px;line-height:1.2;color:#12213b;margin:0;font-weight:850}\n.qf-livre--checkout .qf-livre-pix__sub{color:#55637a;margin:6px 0 18px;font-size:15px}\n.qf-livre--checkout .qf-livre-pix__qr{display:block;width:min(260px,78vw);max-width:100%;height:auto;margin:12px auto 20px}\n.qf-livre--checkout .qf-livre-pix__note{color:#43516a;font-size:14px;line-height:1.45;margin:0 0 16px}\n.qf-livre--checkout .qf-livre-pix__code{min-height:95px;max-height:115px;border:1px solid #cbd5e1;border-radius:12px;background:#f7f9fc;font-size:12px;line-height:1.45;resize:none;padding:12px;color:#26364d}\n.qf-livre--checkout .qf-livre-pix__actions{display:flex;flex-direction:column;gap:12px;margin-top:14px}\n.qf-livre--checkout .qf-livre-pix__actions .btn{min-height:49px;margin:0;width:100%;border-radius:12px}\n.qf-livre--checkout .qf-livre-pix__actions [data-qf-livre-copiar]{background:#075fcf;color:#fff;font-weight:800;border:1px solid #075fcf}\n.qf-livre--checkout .qf-livre-pix__actions [data-qf-livre-verificar]{background:#fff;color:#075fcf;font-weight:750;border:1px solid #0b68da}\n.qf-livre--checkout [data-qf-livre-msg]{font-size:13px;color:#55637a;line-height:1.4;margin:12px 0 0}\n@media(max-width:410px){.qf-livre--promo .qf-livre__icon{display:none}.qf-livre--promo .qf-livre__link{font-size:11.5px;padding:7px 9px}.qf-livre--promo .qf-livre__copy small{font-size:11px}}\n";css.textContent += '.qf-divisao{max-width:680px;min-width:0;margin:16px 0;padding:16px;border:1px solid #d6e3ed;border-radius:14px;background:#fff}.qf-divisao h3{font-size:16px;line-height:1.5;margin:0 0 14px;color:#172c42}.qf-divisao__bar{display:flex;width:100%;height:32px;overflow:hidden;border-radius:9px}.qf-divisao__bar span{display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;box-sizing:border-box}.qf-divisao__pro{width:87%;background:#167348}.qf-divisao__qf{width:13%;background:#f28c28;color:#222!important}.qf-divisao__legenda{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.qf-divisao__legenda span{display:grid;grid-template-columns:8px 1fr;gap:4px 6px;align-items:center;font-size:12px}.qf-divisao__legenda i{height:8px;width:8px;border-radius:50%}.qf-divisao__verde{background:#167348}.qf-divisao__laranja{background:#f28c28}.qf-divisao__legenda strong{grid-column:2;font-size:21px;color:#172c42}.qf-divisao p{font-size:12px!important;line-height:1.5;color:#46566a;margin:12px 0 0}.qf-divisao[hidden]{display:none}';css.textContent += "/* Cadastro profissional: comparação compacta dos planos. */\n#cadastro-prof-form .qf-cad-planos{gap:16px}\n#cadastro-prof-form .qf-cad-plano{background:#fff;gap:9px;padding:16px;border:1.5px solid #d8e1ee;box-shadow:none;min-width:0}\n#cadastro-prof-form .qf-cad-plano--top{padding-top:22px;border-color:#9ebfe9}\n#cadastro-prof-form .qf-cad-plano:has(input:checked){border:2px solid #1469d2;background:#f8fbff;box-shadow:0 4px 16px #1469d214}\n#cadastro-prof-form .qf-cad-plano__selo{background:#f28c28;color:#442300;font-size:11px}\n#cadastro-prof-form .qf-cad-plano__nome{font-size:19px;color:#124a92}\n#cadastro-prof-form .qf-cad-plano__dia{color:#075bbb;font-size:32px}\n#cadastro-prof-form .qf-cad-plano__dia small{font-size:14px}\n#cadastro-prof-form .qf-cad-plano__preco b{font-size:18px}\n#cadastro-prof-form .qf-cad-plano__lista{gap:6px}\n#cadastro-prof-form .qf-cad-plano__lista>span{font-size:13px;line-height:1.35;gap:7px}\n#cadastro-prof-form .qf-cad-plano__lista>span::before{content:'✓';color:#075bbb;font-weight:800;flex:none}\n#cadastro-prof-form .qf-cad-plano__lista svg{display:none}\n#cadastro-prof-form .qf-cad-plano:has(input:checked) .qf-cad-plano__radio{border-color:#1469d2}\n#cadastro-prof-form .qf-cad-plano:has(input:checked) .qf-cad-plano__radio::after{background:#1469d2}\n#cadastro-prof-form [data-step=\"5\"] .qf-step__nav{position:static!important;display:grid!important;grid-template-columns:auto minmax(0,1fr);box-shadow:none!important;padding:0!important;border:0!important;background:transparent!important}\n#cadastro-prof-form [data-step=\"5\"] .qf-step__nav>details{grid-column:1/-1;grid-row:1}\n#cadastro-prof-form [data-step=\"5\"] .qf-step__nav>button{grid-row:2;width:100%;min-height:48px}\n#cadastro-prof-form [data-step=\"5\"] .qf-step__nav>[data-step-back]{padding-inline:16px}\n.qf-cad-divisao{display:flex;flex-direction:column;gap:7px;padding-top:10px;border-top:1px solid #dbe6f3;margin-top:2px}\n.qf-cad-divisao__titulo{font-size:12px;font-weight:750;color:#334a65}\n.qf-cad-divisao__bar{display:flex;height:25px;width:100%;overflow:hidden;border-radius:7px}\n.qf-cad-divisao__bar>span{display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800}\n.qf-cad-divisao__pro{flex:0 0 87%;background:#1469d2;color:#fff}\n.qf-cad-divisao__qf{flex:0 0 13%;background:#f28c28;color:#442300}\n.qf-cad-divisao__legenda{display:flex;justify-content:space-between;gap:8px;font-size:11px;line-height:1.3;color:#713e0e}\n.qf-cad-divisao__legenda b{color:#1257ab}\n.qf-cad-divisao__nota{font-size:11.5px;line-height:1.4;color:#4c5e74}\n@media(min-width:760px){#cadastro-prof-form .qf-cad-planos{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);align-items:start}}\n";document.head.appendChild(css);
  document.addEventListener('click',e=>{const choice=e.target.closest?.('[data-qf-escolha-plano]');if(choice)try{sessionStorage.setItem('qf_cad_escolha_plano',choice.dataset.qfEscolhaPlano);}catch(_){}},true);
  const prior=g.Screens.afterRender,priorAnon=g.Screens.afterRenderAnon;
  function enhance(pattern,content,params={}){
   if(pattern==='/como-funciona'){if(!content.querySelector('.qf-divisao'))(content.querySelector('.view')||content).insertAdjacentHTML('beforeend',divisao());return;}
   const cadastro=pattern==='/auth/:role/cadastro'&&params.role==='profissional';
   if(pattern==='/profissional/home'){try{if(sessionStorage.getItem('qf_plano_pos_cadastro')==='livre'){g.navigate('/profissional/carteira',true);return;}}catch(_){}}
   const pedido=['/profissional/pedido/:id','/profissional/chamada/:id'].includes(pattern);
   if(!cadastro&&!pedido&&!['/profissional/home','/profissional/planos','/profissional/carteira','/profissional/servicos','/profissional/servicos/disponiveis'].includes(pattern))return;
   if(content.querySelector('[data-qf-livre],[data-qf-livre-cadastro]'))return;
   const client=g.QFCloud&&g.QFCloud.client;if(!client)return;
   const rpc=async(n,a={})=>{const r=await client.rpc(n,a);if(r.error)throw Error('Não foi possível consultar o plano. Tente novamente.');return r.data;};
   const box=document.createElement('section');box.className='section card stack--sm qf-livre';box.dataset.qfLivre='';
   const view=content.querySelector('.view')||content;
   if(!cadastro){
    view.prepend(box);
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
    content.querySelectorAll('[name=planoEscolhido]').forEach(r=>{if(r.value!=='avulso')r.closest('label')?.remove();else r.checked=true;});
    content.querySelector('.qf-cad-planos__ex')?.remove();
    const submit=content.querySelector('[data-cad-criar]');if(submit)submit.textContent='Criar conta grátis';
    // O aviso do Quem Faz Livre aparece no fim do cadastro (etapa 5), só quando o profissional escolhe esse plano.
    const group=content.querySelector('.qf-cad-planos'),form=content.querySelector('form');
    if(group&&form){
     group.dataset.qfLivreCadastro='';
     group.insertAdjacentHTML('afterbegin','<label class="qf-cad-plano qf-cad-plano--top"><span class="qf-cad-plano__selo">MAIS VANTAJOSO</span><input type="radio" name="planoEscolhido" value="livre" checked><span class="qf-cad-plano__topo"><span class="qf-cad-plano__nome">Quem Faz Livre</span><span class="qf-cad-plano__radio" aria-hidden="true"></span></span><span class="qf-cad-plano__dia">R$ 1,33 <small>por dia</small></span><span class="qf-cad-plano__preco"><b>R$ 39,90</b><span>por 30 dias</span></span><span class="qf-cad-plano__lista"><span>Desbloqueios ilimitados de pedidos compatíveis</span><span>Sem pagar por contato</span><span>Pedidos na sua profissão e região</span><span>Sem renovação automática</span></span><span class="qf-cad-divisao"><span class="qf-cad-divisao__titulo">O valor do serviço fica assim</span><span class="qf-cad-divisao__bar" role="img" aria-label="87% para o profissional e 13% para o Quem Faz"><span class="qf-cad-divisao__pro">87%</span><span class="qf-cad-divisao__qf">13%</span></span><span class="qf-cad-divisao__legenda"><b>87% — Profissional</b><span>13% — Quem Faz</span></span><span class="qf-cad-divisao__nota">Você fica com 87% do valor do serviço. O Quem Faz recebe 13% somente sobre serviços fechados, confirmados e aprovados.</span></span></label>');
     const avulso=group.querySelector('input[value="avulso"]');
     if(avulso){avulso.checked=false;avulso.closest('label').querySelector('.qf-cad-plano__lista').innerHTML='<span>Pague só pelos pedidos que desbloquear</span><span>Sem mensalidade e sem comissão</span>';}
     try{if(sessionStorage.getItem('qf_cad_escolha_plano')==='avulso'&&avulso){group.querySelector('input[value="livre"]').checked=false;avulso.checked=true;}sessionStorage.removeItem('qf_cad_escolha_plano');}catch(_){}
     // Detalhes acessíveis sem repetir toda a oferta abaixo dos cartões.
     const conditions=document.createElement('details');conditions.className='qf-step__opt';
     conditions.innerHTML='<summary>Condições do Quem Faz Livre</summary><p>Pedidos disponíveis e compatíveis, com até quatro profissionais por pedido. Pedidos exclusivos não participam. A confirmação do cliente sobre a contratação e o valor aprova automaticamente a comissão de 13%; divergências seguem para análise. Preste contas em até 48 horas, com uma prorrogação de 48 horas durante a negociação. Pendências vencidas bloqueiam novos desbloqueios. Não há garantia de contratação.</p>';
     group.after(conditions);
     function updateChoice(){
      const livre=form.querySelector('[name=planoEscolhido]:checked')?.value==='livre';
      const b=form.querySelector('[data-cad-criar]');if(b)b.textContent=livre?'Criar conta e pagar por Pix':'Criar conta grátis';
      const nota=form.querySelector('[data-plano-nota]');
      if(nota){nota.classList.remove('qf-cad-planos__nota--aviso');nota.textContent=livre?'Ativação após confirmar o Pix. Sem pagamento, só o Avulso com saldo.':'No Avulso, você coloca créditos na Carteira quando precisar.';}
      conditions.hidden=!livre;
     }
     form.addEventListener('change',e=>{if(e.target?.name==='planoEscolhido')updateChoice();});
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
   function bind(){const b=box.querySelector('[data-qf-livre-pagar]');if(b)b.onclick=pay;}
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
    bind();
    if(cadastro){box.querySelector('[data-qf-livre-pagar]')?.remove();box.querySelector('[data-qf-livre-pix]')?.remove();}
   }
   function unlock(s){
    // Somente assinatura Livre paga e ativa autoriza o desbloqueio do plano.
    if(!pedido||box.querySelector('[data-qf-livre-desbloquear],[data-qf-livre-credito]'))return;
    const req=g.DB&&g.DB.requestById(params.id),pago=content.querySelector('[data-action="desbloquear-chamada"]');
    if(!req||!pago)return;
    if(req.atendimentoTipo==='garante'||req.modalidade==='valor_definido')return;
    if(!s.ativo)return;
    box.insertAdjacentHTML('beforeend','<label><input type="checkbox" data-qf-livre-termos><span>Aceito prestar contas e pagar 13% somente por serviço fechado e confirmado, conforme as condições da modalidade.</span></label><button type="button" class="btn btn--primary" data-qf-livre-desbloquear>Desbloquear com Quem Faz Livre</button>');
    const b=box.querySelector('[data-qf-livre-desbloquear]');b.onclick=async()=>{
     const msg=box.querySelector('[data-qf-livre-msg]');if(!box.querySelector('[data-qf-livre-termos]').checked){msg.textContent='Aceite as condições para desbloquear com o plano.';return;}
     b.disabled=true;try{const r=await rpc('qf_livre_desbloquear',{p_chamado_id:params.id,p_aceitar:true});if(!r.ok&&r.reason==='comissao_pendente'){msg.textContent='Comissão pendente. Abrindo o Pix automático na carteira.';g.navigate('/profissional/carteira',true);return;}if(!r.ok)throw Error(({credito_necessario:'Assine o Quem Faz Livre ou utilize o Avulso com saldo na carteira.',plano_inativo:'Plano vencido ou inativo. Renove ou utilize créditos.',reservado:'O pedido já atingiu o limite de participantes.',nao_elegivel:'Pedido incompatível com sua profissão, região ou raio.',indisponivel:'Pedido indisponível para este plano.',selfie_obrigatoria:'Conclua seu perfil com uma foto.',perfil_inativo:'Confira a situação do seu perfil e do plano.',prestacao_contas_vencida:'Regularize sua prestação de contas na carteira.',comissao_vencida:'Regularize a comissão confirmada na carteira.',comissao_pendente:'A comissão pendente deve ser paga por Pix na carteira antes de outro desbloqueio.'})[r.reason]||'Não foi possível autorizar o desbloqueio. Atualize o pedido.');if(g.QFCloud.syncForCurrentSession)await g.QFCloud.syncForCurrentSession();g.navigate('/profissional/chat/'+params.id,true);}catch(e){msg.textContent=e.message;b.disabled=false;}
    };
   }
   async function refresh(){const s=await rpc('qf_livre_status');if(!box.isConnected)return false;if(!s||!s.ok)return false;if(s.ativo){trackLivrePurchase(s);pending=false;render(s);unlock(s);return true;}if(!pending){render(s);unlock(s);}return false;}
   async function pay(){
    if(busy)return;
    busy=true;pending=true;const button=box.querySelector('[data-qf-livre-pagar]'),msg=box.querySelector('[data-qf-livre-msg]');if(button)button.disabled=true;msg.textContent='Preparando seu Pix…';
    try{
     const current=await rpc('qf_livre_status');if(!current?.ok)throw Error('Não foi possível confirmar a situação do seu plano.');if(current.ativo){pending=false;render(current);unlock(current);return;}
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
       '<p role="status" aria-live="polite" data-qf-livre-msg>Aguardando confirmação do Pix.</p>';
     const pix=box.querySelector('[data-qf-livre-pix]'),status=box.querySelector('[data-qf-livre-msg]');
     pix.querySelector('[data-qf-livre-copiar]').onclick=async()=>{try{await navigator.clipboard.writeText(x.pix_copy_paste);status.textContent='Pix copiado. Abra o aplicativo do seu banco para pagar.';}catch(_){const t=pix.querySelector('textarea');t.focus();t.select();status.textContent='Selecione e copie o código Pix.';}};
     pix.querySelector('[data-qf-livre-verificar]').onclick=()=>refresh().then(active=>{if(!active&&box.isConnected)status.textContent='Pagamento ainda não confirmado. Você pode verificar novamente.';}).catch(()=>status.textContent='Não foi possível consultar agora. Tente novamente.');
     // Troca a oferta pelo checkout: sem botão de assinar ou valores repetidos sobre o QR Code.
     try{box.scrollIntoView({behavior:'smooth',block:'start'});}catch(_){}

     let tries=0;const poll=async()=>{if(!box.isConnected||!pending||++tries>180)return;try{if(await refresh())return;}catch(_){}if(box.isConnected&&pending)setTimeout(poll,5000);};setTimeout(poll,5000);
    }catch(e){pending=false;const visible=box.querySelector('[data-qf-livre-msg]');if(visible)visible.textContent=e.message;}finally{busy=false;if(button&&button.isConnected)button.disabled=false;}
   }
   if(cadastro){render({});return;}
   box.innerHTML='<p role="status">Consultando seu plano…</p>';
   async function load(){
    const s=await rpc('qf_livre_status');if(!box.isConnected)return;
    if(!s?.ok)throw Error('Entre novamente para consultar seu plano.');
    if(s.ativo)trackLivrePurchase(s);
    render(s);unlock(s);
    let auto=false;try{auto=sessionStorage.getItem('qf_plano_pos_cadastro')==='livre'&&['/profissional/carteira','/profissional/planos'].includes(pattern);}catch(_){}
    if(auto){try{sessionStorage.removeItem('qf_plano_pos_cadastro');sessionStorage.removeItem('qf_plano_pos_cadastro_metodo');}catch(_){}if(!s.ativo)await pay();}
   }
   load().catch(()=>{if(box.isConnected)box.innerHTML='<p role="status">Não foi possível consultar seu plano.</p><button class="btn btn--outline" data-qf-livre-retry>Tentar novamente</button>';const retry=box.querySelector('[data-qf-livre-retry]');if(retry)retry.onclick=load;});
  }
  g.QFLivre.enhance=enhance;
  g.Screens.afterRender=function(){if(prior)prior.apply(this,arguments);enhance.apply(this,arguments);};
  g.Screens.afterRenderAnon=function(){if(priorAnon)priorAnon.apply(this,arguments);enhance.apply(this,arguments);};
  let path=(g.location.hash||'').replace(/^#/,''),params={};const m=path.match(/^\/profissional\/(pedido|chamada)\/([^/]+)$/);if(m){path='/profissional/'+m[1]+'/:id';params.id=m[2];}if(path==='/auth/profissional/cadastro'){path='/auth/:role/cadastro';params.role='profissional';}const c=document.getElementById('app-content');if(c)enhance(path,c,params);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(typeof window!=='undefined'?window:globalThis);
