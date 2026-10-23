/* Quem Faz Livre: o navegador consulta; somente o servidor confirma e ativa. */
(function(g){
 'use strict';
 const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=v=>v?new Date(v).toLocaleDateString('pt-BR'):'';
 function oferta(s={}){
  return '<span class="badge">QUEM FAZ LIVRE</span><h2 class="h3">'+(s.ativo?'Plano ativo — desbloqueios ilimitados':'Desbloqueie mais pedidos com o Quem Faz Livre')+'</h2><p><strong>R$ 39,90 por 30 dias</strong></p><p>Desbloqueios ilimitados de pedidos tradicionais compatíveis com sua profissão e região, sem consumir créditos. Até quatro profissionais por pedido. Pedidos exclusivos e Quem Faz Garante não participam.</p><p>Comissão de 13% somente sobre serviços fechados e confirmados pelo fluxo de confirmação com o cliente. Renovação manual, sem cobrança automática. Não há garantia de contratação.</p>'+(s.valido_ate?'<p><strong>'+(s.ativo?'Válido até ':'Plano vencido em ')+esc(date(s.valido_ate))+'</strong></p>':'<p>Ativação após confirmação do Pix pelo servidor.</p>')+(s.ativo?'<a class="btn btn--primary" href="#/profissional/servicos/disponiveis">Ver pedidos disponíveis</a>':'<button type="button" class="btn btn--primary btn--block" data-qf-livre-pagar>Assinar por R$ 39,90</button>')+'<div data-qf-livre-pix></div><p role="status" aria-live="polite" data-qf-livre-msg></p>';
 }
 g.QFLivre={oferta};if(typeof module!=='undefined')module.exports=g.QFLivre;
 if(!g.document)return;
 function install(){
  if(!g.Screens||g.QFLivre.installed)return;g.QFLivre.installed=true;
  const css=document.createElement('style');css.textContent='.qf-livre{border:2px solid #1769d5!important;background:linear-gradient(120deg,#eef6ff,#fff8ed);border-radius:18px;padding:20px!important;margin:0 0 18px!important;min-width:0}.qf-livre h2{margin:8px 0;font-size:1.35rem}.qf-livre p{overflow-wrap:anywhere}.qf-livre textarea{width:100%;box-sizing:border-box;min-height:90px;overflow-wrap:anywhere}.qf-livre img{display:block;width:200px;max-width:100%;height:auto;margin:12px auto}.qf-livre label{display:flex;gap:10px;align-items:flex-start;margin:12px 0}.qf-livre input[type=checkbox]{width:20px;height:20px;flex:0 0 20px}.qf-livre .btn{white-space:normal}@media(max-width:639px){.qf-livre{padding:16px!important}.qf-livre .btn{width:100%}}';document.head.appendChild(css);
  const prior=g.Screens.afterRender;
  function enhance(pattern,content,params={}){
   const cadastro=pattern==='/auth/:role/cadastro'&&params.role==='profissional';
   const pedido=['/profissional/pedido/:id','/profissional/chamada/:id'].includes(pattern);
   if(!cadastro&&!pedido&&!['/profissional/home','/profissional/planos','/profissional/carteira','/profissional/servicos','/profissional/servicos/disponiveis'].includes(pattern))return;
   if(content.querySelector('[data-qf-livre]'))return;
   const client=g.QFCloud&&g.QFCloud.client;if(!client)return;
   const rpc=async(n,a={})=>{const r=await client.rpc(n,a);if(r.error)throw Error('Não foi possível consultar o plano. Tente novamente.');return r.data;};
   const box=document.createElement('section');box.className='section card stack--sm qf-livre';box.dataset.qfLivre='';
   const view=content.querySelector('.view')||content;view.prepend(box);
   let pending=false,busy=false,last={};
   function bind(){const b=box.querySelector('[data-qf-livre-pagar]');if(b)b.onclick=pay;}
   function render(s){last=s||{};box.innerHTML=oferta(last);bind();if(cadastro){const b=box.querySelector('[data-qf-livre-pagar]');if(b)b.onclick=()=>{const form=content.querySelector('form');if(form){form.scrollIntoView({behavior:'smooth',block:'start'});form.querySelector('input')?.focus();}box.querySelector('[data-qf-livre-msg]').textContent='Conclua seu cadastro para contratar o plano com segurança.';};}}
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
    if(busy)return;busy=true;pending=true;const button=box.querySelector('[data-qf-livre-pagar]'),msg=box.querySelector('[data-qf-livre-msg]');if(button)button.disabled=true;msg.textContent='Preparando seu Pix…';
    try{
     const r=await rpc('qf_livre_solicitar_pix');if(!r||!r.ok)throw Error('Conclua seu cadastro de profissional antes de assinar.');
     const fn=await client.functions.invoke('quemfaz-efi-checkout',{body:{tipo:'recarga',pagamento_id:r.recarga_id}});
     if(fn.error||!fn.data?.ok)throw Error('Não foi possível gerar o Pix. Tente novamente em instantes.');
     if(await refresh())return;
     const x=fn.data,pix=box.querySelector('[data-qf-livre-pix]');pending=true;
     if(!x.pix_copy_paste)throw Error('O Pix ainda está sendo preparado. Tente novamente.');
     pix.innerHTML='<h3>Pague R$ 39,90 por Pix</h3>'+(typeof x.qr_image==='string'&&/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(x.qr_image)?'<img src="'+esc(x.qr_image)+'" alt="QR Code Pix do plano Quem Faz Livre">':'')+'<p>Pix válido por 24 horas. O plano será ativado automaticamente após a confirmação do pagamento.</p><textarea readonly aria-label="Pix copia e cola">'+esc(x.pix_copy_paste)+'</textarea><button type="button" class="btn btn--outline" data-qf-livre-copiar>Copiar Pix</button><button type="button" class="btn btn--outline" data-qf-livre-verificar>Verificar ativação</button>';
     pix.querySelector('[data-qf-livre-copiar]').onclick=async()=>{try{await navigator.clipboard.writeText(x.pix_copy_paste);msg.textContent='Pix copiado.';}catch(_){const t=pix.querySelector('textarea');t.focus();t.select();msg.textContent='Selecione e copie o código Pix.';}};
     pix.querySelector('[data-qf-livre-verificar]').onclick=()=>refresh().then(active=>{if(!active&&box.isConnected)msg.textContent='Aguardando confirmação do pagamento pelo servidor. Isso pode levar alguns instantes.';}).catch(()=>msg.textContent='Não foi possível consultar agora. Tente novamente.');
     msg.textContent='Aguardando pagamento. Você pode continuar usando créditos ou a modalidade gratuita.';
     let tries=0;const poll=async()=>{if(!box.isConnected||!pending||++tries>180)return;try{if(await refresh())return;}catch(_){}if(box.isConnected&&pending)setTimeout(poll,5000);};setTimeout(poll,5000);
    }catch(e){pending=false;msg.textContent=e.message;}finally{busy=false;if(button&&button.isConnected)button.disabled=false;}
   }
   render({});if(!cadastro)refresh().catch(()=>{box.querySelector('[data-qf-livre-msg]').textContent='Não foi possível consultar a situação do plano. Atualize a tela.';});
  }
  g.QFLivre.enhance=enhance;
  g.Screens.afterRender=function(){if(prior)prior.apply(this,arguments);enhance.apply(this,arguments);};
  let path=(g.location.hash||'').replace(/^#/,''),params={};const m=path.match(/^\/profissional\/(pedido|chamada)\/([^/]+)$/);if(m){path='/profissional/'+m[1]+'/:id';params.id=m[2];}const c=document.getElementById('app-content');if(c)enhance(path,c,params);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(typeof window!=='undefined'?window:globalThis);
