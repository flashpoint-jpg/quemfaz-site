/* Quem Faz Livre: o navegador consulta; somente o servidor confirma e ativa. */
(function(g){
 'use strict';
 const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=v=>v?new Date(v).toLocaleDateString('pt-BR'):'';
 function oferta(s={}){
  return '<span class="badge">QUEM FAZ LIVRE</span><h2 class="h3">'+(s.ativo?'Desbloqueios ilimitados':'R$ 39,90 por 30 dias · R$ 1,33/dia')+'</h2><p>Pedidos compatíveis ilimitados. <strong>13% só ao fechar.</strong></p><details><summary>Saiba mais sobre o plano</summary><p>Sem pagar por contato. Sem renovação automática.</p><p>Até quatro profissionais por pedido. Pedidos exclusivos não participam. Comissão somente sobre serviços fechados, confirmados e aprovados pela administração. Preste contas em até 48 horas; enquanto negocia, você pode prorrogar uma única vez por mais 48 horas. Pendências vencidas bloqueiam novos desbloqueios em todas as modalidades. Não há garantia de contratação. Ativação após confirmação do Pix.</p></details>'+(s.valido_ate?'<p><strong>'+(s.ativo?'Válido até ':'Plano vencido em ')+esc(date(s.valido_ate))+'</strong></p>':'<p>Ativação após confirmação do Pix pelo servidor.</p>')+(s.ativo?'<a class="btn btn--primary" href="#/profissional/servicos/disponiveis">Ver pedidos disponíveis</a>':'<button type="button" class="btn btn--primary btn--block" data-qf-livre-pagar>Assinar por R$ 39,90</button>')+'<div data-qf-livre-pix></div><p role="status" aria-live="polite" data-qf-livre-msg></p>';
 }
 g.QFLivre={oferta};if(typeof module!=='undefined')module.exports=g.QFLivre;
 if(!g.document)return;
 function install(){
  if(!g.Screens||g.QFLivre.installed)return;g.QFLivre.installed=true;
  // O catálogo antigo continua disponível para registros e assinaturas já contratadas.
  if(Array.isArray(g.QFCadPlanos))g.QFCadPlanos.splice(1);
  if(g.QFPlanoIncentivo)g.QFPlanoIncentivo.porChamado=()=>null;
  const css=document.createElement('style');css.textContent='.qf-livre{border:2px solid #1769d5!important;background:linear-gradient(120deg,#eef6ff,#fff8ed);border-radius:18px;padding:20px!important;margin:0 0 18px!important;min-width:0}.qf-livre h2{margin:8px 0;font-size:1.35rem}.qf-livre p{overflow-wrap:anywhere}.qf-livre textarea{width:100%;box-sizing:border-box;min-height:90px;overflow-wrap:anywhere}.qf-livre img{display:block;width:200px;max-width:100%;height:auto;margin:12px auto}.qf-livre label{display:flex;gap:10px;align-items:flex-start;margin:12px 0}.qf-livre input[type=checkbox]{width:20px;height:20px;flex:0 0 20px}.qf-livre .btn{white-space:normal}@media(max-width:639px){.qf-livre{padding:16px!important}.qf-livre .btn{width:100%}}';css.textContent += "\n/* Ajustes 23/10 — pedidos em evidência e estado do plano compacto */\n.qf-livre.qf-livre--compact{padding:12px 14px!important;margin:0 0 8px!important;display:flex;align-items:center;min-height:64px;gap:12px;border:1px solid #a7cdf6!important;background:#eef6ff!important;box-shadow:none!important;height:auto!important}\n.qf-livre--compact .qf-livre__icon{display:grid;place-items:center;flex:none;width:37px;height:37px;border:1px solid #b2d6fa;border-radius:10px;color:#075bbb;font-size:22px;font-weight:800}\n.qf-livre--compact .qf-livre__copy{min-width:0;flex:1}\n.qf-livre--compact .qf-livre__copy strong{display:block;color:#075bbb;font-size:14px;line-height:1.3}\n.qf-livre--compact .qf-livre__copy small{display:block;font-size:12.5px;line-height:1.35;color:#42526c;margin-top:3px}\n.qf-livre--compact .qf-livre__link{flex:none;white-space:nowrap;font-weight:750;font-size:13px;color:#075bbb;text-decoration:none}\n.qf-livre--compact .qf-livre__link:focus-visible{outline:2px solid #075bbb;outline-offset:3px}\n#app-shell[data-route=\"profissional-home\"] .view>.qf-livre--compact,\n#app-shell[data-route=\"profissional-carteira\"] .view>.qf-livre--compact{grid-column:1/-1;grid-row:auto;break-inside:avoid}\n#app-shell[data-route=\"profissional-home\"] .view>#chamados-disponiveis{grid-column:1/-1;order:0}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-order-heading h2{font-size:clamp(19px,4.8vw,25px);font-weight:850}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-order-tabs{gap:8px;border:0;margin:10px 0 14px;overflow-x:auto}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-order-tabs>*{flex:0 0 auto;min-height:42px;border:1px solid #c8d3e1;border-radius:999px;padding:9px 13px;background:#fff;font-size:13px;white-space:nowrap}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-order-tabs [aria-current]{border:1px solid #075bbb;background:#075bbb;color:#fff}\n#app-shell[data-route=\"profissional-home\"] .qf-prof-status{height:auto!important}\n#app-shell[data-route=\"profissional-carteira\"] .view>.qf-livre{column-span:all}\n#app-shell[data-route=\"profissional-carteira\"] .view>.qf-livre+ .card{column-span:all}\n#cadastro-prof-form .qf-step__nav{position:sticky;bottom:env(safe-area-inset-bottom,0px);z-index:12;display:flex;gap:10px;background:rgba(255,255,255,.97);padding:12px;border:1px solid #e0e9f4;border-radius:16px;box-shadow:0 4px 22px rgba(17,43,76,.10);margin-top:12px}\n#cadastro-prof-form .qf-step__nav .btn{min-height:48px}\n#cadastro-prof-form .qf-step .field input,#cadastro-prof-form .qf-step .field select,#cadastro-prof-form .qf-step .field textarea{scroll-margin-bottom:95px}\n#cadastro-prof-form .qf-step__head .text--sm{max-width:43ch}\n#cadastro-prof-form .qf-cad-planos__nota{line-height:1.4}\n@media(min-width:768px){#cadastro-prof-form .qf-step__nav{position:static;box-shadow:none} }\n@media(max-width:380px){.qf-livre--compact .qf-livre__icon{display:none}.qf-livre--compact .qf-livre__link{font-size:12px} }\n";document.head.appendChild(css);
  const prior=g.Screens.afterRender,priorAnon=g.Screens.afterRenderAnon;
  function enhance(pattern,content,params={}){
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
     group.insertAdjacentHTML('afterbegin','<label class="qf-cad-plano qf-cad-plano--top"><span class="qf-cad-plano__selo">RECOMENDADO</span><input type="radio" name="planoEscolhido" value="livre" checked><span class="qf-cad-plano__topo"><span class="qf-cad-plano__nome">Quem Faz Livre</span><span class="qf-cad-plano__radio" aria-hidden="true"></span></span><span class="qf-cad-plano__dia">R$ 1,33 <small>por dia</small></span><span class="qf-cad-plano__preco"><b>R$ 39,90</b><span>por 30 dias</span></span><span class="qf-cad-plano__lista"><span>Desbloqueios ilimitados de pedidos compatíveis</span><span>Sem pagar por contato</span><span>13% de comissão somente se fechar o serviço</span><span>Sem renovação automática</span></span></label>');
     const avulso=group.querySelector('input[value="avulso"]');
     if(avulso){avulso.checked=false;avulso.closest('label').querySelector('.qf-cad-plano__lista').innerHTML='<span>Pague só pelos pedidos que desbloquear</span><span>Sem mensalidade e sem comissão</span>';}
     // Detalhes acessíveis sem repetir toda a oferta abaixo dos cartões.
     const conditions=document.createElement('details');conditions.className='qf-step__opt';
     conditions.innerHTML='<summary>Condições do Quem Faz Livre</summary><p>Pedidos disponíveis e compatíveis, com até quatro profissionais por pedido. Pedidos exclusivos não participam. Comissão de 13% somente em serviços fechados, confirmados e aprovados pela administração. Preste contas em até 48 horas, com uma prorrogação de 48 horas durante a negociação. Pendências vencidas bloqueiam novos desbloqueios. Não há garantia de contratação.</p>';
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
   function bind(){const b=box.querySelector('[data-qf-livre-pagar]');if(b)b.onclick=pay;}
   function render(s){
    last=s||{};
    if(last.ativo&&!pedido){
     box.classList.add('qf-livre--compact');
     box.innerHTML='<span class="qf-livre__icon" aria-hidden="true">✓</span><span class="qf-livre__copy"><strong>Quem Faz Livre ativo</strong><small>Desbloqueios ilimitados · válido até '+esc(date(last.valido_ate))+'</small></span><a href="#/profissional/planos" class="qf-livre__link">Ver plano ›</a>';
    }else{
     box.innerHTML=oferta(last);
     if(pattern==='/profissional/home'){
      box.classList.add('qf-livre--compact');
      box.innerHTML='<span class="qf-livre__icon" aria-hidden="true">i</span><span class="qf-livre__copy"><strong>Quem Faz Livre · R$ 1,33/dia</strong><small>R$ 39,90 por 30 dias · ativação pelo Pix</small></span><a class="qf-livre__link" href="#/profissional/carteira">Ver plano ›</a>';
     }
    }
    bind();
    if(cadastro){box.querySelector('[data-qf-livre-pagar]')?.remove();box.querySelector('[data-qf-livre-pix]')?.remove();}
   }
   function unlock(s){
    if(!pedido||!s.ativo||box.querySelector('[data-qf-livre-desbloquear]'))return;
    const req=g.DB&&g.DB.requestById(params.id),pago=content.querySelector('[data-action="desbloquear-chamada"]');
    if(!req||!pago)return;
    if(req.atendimentoTipo==='garante'||req.modalidade==='valor_definido')return;
    box.insertAdjacentHTML('beforeend','<label><input type="checkbox" data-qf-livre-termos><span>Aceito prestar contas e pagar 13% somente por serviço fechado e confirmado, conforme as condições da modalidade.</span></label><button type="button" class="btn btn--primary" data-qf-livre-desbloquear>Desbloquear com Quem Faz Livre</button>');
    const b=box.querySelector('[data-qf-livre-desbloquear]');b.onclick=async()=>{
     const msg=box.querySelector('[data-qf-livre-msg]');if(!box.querySelector('[data-qf-livre-termos]').checked){msg.textContent='Aceite as condições para desbloquear com o plano.';return;}
     b.disabled=true;try{const r=await rpc('qf_livre_desbloquear',{p_chamado_id:params.id,p_aceitar:true});if(!r.ok)throw Error(({plano_inativo:'Plano vencido ou inativo. Renove ou utilize créditos.',reservado:'O pedido já atingiu o limite de participantes.',nao_elegivel:'Pedido incompatível com sua profissão, região ou raio.',indisponivel:'Pedido indisponível para este plano.',selfie_obrigatoria:'Conclua seu perfil com uma foto.',perfil_inativo:'Fique online e confira seu perfil.',prestacao_contas_vencida:'Regularize sua prestação de contas na carteira.',comissao_vencida:'Regularize a comissão confirmada na carteira.'})[r.reason]||'Não foi possível autorizar o desbloqueio. Atualize o pedido.');if(g.QFCloud.syncForCurrentSession)await g.QFCloud.syncForCurrentSession();g.navigate('/profissional/chat/'+params.id,true);}catch(e){msg.textContent=e.message;b.disabled=false;}
    };
   }
   async function refresh(){const s=await rpc('qf_livre_status');if(!box.isConnected)return false;if(!s||!s.ok)return false;if(s.ativo){pending=false;render(s);unlock(s);return true;}if(!pending){render(s);unlock(s);}return false;}
   async function pay(){
    if(busy)return;
    busy=true;pending=true;const button=box.querySelector('[data-qf-livre-pagar]'),msg=box.querySelector('[data-qf-livre-msg]');if(button)button.disabled=true;msg.textContent='Preparando seu Pix…';
    try{
     const current=await rpc('qf_livre_status');if(!current?.ok)throw Error('Não foi possível confirmar a situação do seu plano.');if(current.ativo){pending=false;render(current);unlock(current);return;}
     const r=await rpc('qf_livre_solicitar_pix');if(!r||!r.ok)throw Error('Conclua seu cadastro de profissional antes de assinar.');
     const fn=await client.functions.invoke('quemfaz-efi-checkout',{body:{tipo:'recarga',pagamento_id:r.recarga_id}});
     if(fn.error||!fn.data?.ok)throw Error('Não foi possível gerar o Pix. Tente novamente em instantes.');
     if(await refresh())return;
     const x=fn.data,pix=box.querySelector('[data-qf-livre-pix]');pending=true;
     if(!x.pix_copy_paste)throw Error('O Pix ainda está sendo preparado. Tente novamente.');
     pix.innerHTML='<h3>Pague R$ 39,90 por Pix</h3>'+(typeof x.qr_image==='string'&&/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(x.qr_image)?'<img src="'+esc(x.qr_image)+'" alt="QR Code Pix do plano Quem Faz Livre">':'')+'<p>Pix válido por 24 horas. O plano será ativado automaticamente após a confirmação do pagamento.</p><textarea readonly aria-label="Pix copia e cola">'+esc(x.pix_copy_paste)+'</textarea><button type="button" class="btn btn--outline" data-qf-livre-copiar>Copiar Pix</button><button type="button" class="btn btn--outline" data-qf-livre-verificar>Verificar ativação</button>';
     pix.querySelector('[data-qf-livre-copiar]').onclick=async()=>{try{await navigator.clipboard.writeText(x.pix_copy_paste);msg.textContent='Pix copiado.';}catch(_){const t=pix.querySelector('textarea');t.focus();t.select();msg.textContent='Selecione e copie o código Pix.';}};
     pix.querySelector('[data-qf-livre-verificar]').onclick=()=>refresh().then(active=>{if(!active&&box.isConnected)msg.textContent='Aguardando confirmação do pagamento pelo servidor. Isso pode levar alguns instantes.';}).catch(()=>msg.textContent='Não foi possível consultar agora. Tente novamente.');
     msg.textContent='Aguardando confirmação do Pix. O Livre ainda não está ativo. Sem saldo no Avulso, os desbloqueios ficam bloqueados.';
     let tries=0;const poll=async()=>{if(!box.isConnected||!pending||++tries>180)return;try{if(await refresh())return;}catch(_){}if(box.isConnected&&pending)setTimeout(poll,5000);};setTimeout(poll,5000);
    }catch(e){pending=false;msg.textContent=e.message;}finally{busy=false;if(button&&button.isConnected)button.disabled=false;}
   }
   if(cadastro){render({});return;}
   box.innerHTML='<p role="status">Consultando seu plano…</p>';
   async function load(){
    const s=await rpc('qf_livre_status');if(!box.isConnected)return;
    if(!s?.ok)throw Error('Entre novamente para consultar seu plano.');
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
