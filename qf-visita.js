/* Quem Faz: orçamento presencial opcional. Pix Efí validado no servidor; repasse sempre manual. */
(function(root){
 'use strict';
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const paidStatus=s=>s==='paga';
 function selo(req){
  const status=String(req?.visitaPresencialStatus||'');
  if(!status||status==='cancelada')return '';
  if(paidStatus(status))return '<span class="badge badge--success qf-visita-paga" style="font-size:12px;padding:7px 10px;white-space:normal" data-qf-visita-status="paga">Visita técnica paga · R$ 25,00</span>';
  return '<span class="badge badge--warning qf-visita-pendente" style="font-size:12px;padding:7px 10px;white-space:normal" data-qf-visita-status="pendente">Orçamento presencial solicitado · Pix pendente</span>';
 }
 function clienteHtml(req){
  const status=String(req?.visitaPresencialStatus||'');
  if(!status||status==='cancelada')return '';
  return '<section class="card stack--sm qf-visita-cliente" style="border:1px solid #d9e6f4;border-radius:16px;padding:16px;margin:14px 0">'+
    '<h3 class="h3">Orçamento presencial</h3>'+
    selo(req)+
    (paidStatus(status)
      ? '<p class="text--sm">O Quem Faz confirmou o Pix de R$ 25,00. O profissional verá que sua visita técnica está paga. Você escolhe com quem combinar o atendimento.</p>'
      : '<p class="text--sm">A visita é opcional e só será considerada paga depois do Pix de R$ 25,00 ser confirmado. Seu pedido foi publicado normalmente.</p>'+
        '<button class="btn btn--primary" type="button" data-qf-visita-pagar="'+escape(req.id)+'">Pagar visita técnica · R$ 25,00</button>')+
    '</section>';
 }
 const rpc=async(name,args)=>{
   const c=root.QFCloud?.client;
   if(!c)throw Error('Conecte-se para gerar o Pix da visita.');
   const r=await c.rpc(name,args);
   if(r.error)throw Error('Não foi possível consultar o pagamento da visita. Atualize e tente novamente.');
   return r.data||{};
 };
 async function abrir(req){
  const id=String(req?.id||'');
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(id))throw Error('Pedido inválido para a visita.');
  const p=await rpc('qf_solicitar_visita',{p_chamado_id:id});
  if(!p?.ok)throw Error(({
    visita_nao_escolhida:'O orçamento presencial não foi selecionado neste pedido.',
    pedido_nao_encontrado:'Entre na conta do cliente que publicou este pedido.',
    pedido_encerrado:'Este pedido já foi encerrado.',
    pagamento_encerrado:'O Pix desta visita foi encerrado.'
   })[p?.reason]||'Não foi possível preparar o Pix da visita.');
  if(p.status==='aprovado'){
   root.PU?.toast?.('Visita técnica já paga. O profissional verá a confirmação.','success');
   return true;
  }
  const client=root.QFCloud.client;
  const resp=await client.functions.invoke('quemfaz-efi-checkout',{
    body:{tipo:'visita',pagamento_id:p.pagamento_id}
  });
  if(resp.error||!resp.data?.ok)throw Error('Não foi possível gerar o Pix de R$ 25,00. Tente novamente no pedido.');
  const pix=resp.data;
  const code=String(pix.pix_copy_paste||'');
  const qr=String(pix.qr_image||'');
  if(!code&&!pix.checkout_url)throw Error('O Pix ainda não está disponível. Volte ao pedido e tente novamente.');
  if(!root.PU?.openSheet)throw Error('Atualize o aplicativo para abrir o pagamento.');
  root.PU.openSheet(
   '<section class="stack qf-visita-pix" data-qf-visita-sheet="'+escape(id)+'" style="padding:8px 0">'+
   '<h2 class="h2">Orçamento presencial · R$ 25,00</h2>'+
   '<p class="text--sm">Pagamento opcional ao Quem Faz por Pix. A visita será marcada como paga somente após confirmação pela Efí. O repasse ao profissional escolhido será manual.</p>'+
   (/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(qr)?'<img src="'+escape(qr)+'" alt="QR Code Pix da visita técnica" style="width:200px;max-width:90%;height:auto;margin:auto">':'')+
   (code?'<label class="field"><span class="field__label">Pix copia e cola</span><textarea class="textarea" rows="4" readonly data-qf-visita-codigo>'+escape(code)+'</textarea></label>':'')+
   (code?'<button class="btn btn--primary" type="button" data-qf-visita-copiar>Copiar Pix</button>':'')+
   (!code&&/^https:\/\//.test(pix.checkout_url||'')?'<a class="btn btn--primary" href="'+escape(pix.checkout_url)+'" target="_blank" rel="noopener">Abrir Pix</a>':'')+
   '<button class="btn btn--outline" type="button" data-qf-visita-verificar>Já paguei · verificar pagamento</button>'+
   '<p class="text--sm" role="status" aria-live="polite" data-qf-visita-aviso>Aguardando confirmação bancária. A visita ainda não está paga.</p>'+
   '<button class="btn btn--ghost" type="button" data-qf-visita-fechar>Voltar ao pedido</button></section>'
  );
  const area=root.document.querySelector('[data-qf-visita-sheet="'+id+'"]');
  if(!area)return false;
  const aviso=area.querySelector('[data-qf-visita-aviso]');
  const verificar=async()=>{
   const d=await rpc('qf_visita_status',{p_chamado_id:id});
   if(d.ok&&d.pago===true&&d.status==='aprovado'){
    aviso.textContent='Pagamento confirmado pela Efí! Visita técnica paga · R$ 25,00.';
    aviso.style.color='#167348';
    area.querySelector('[data-qf-visita-verificar]').disabled=true;
    area.querySelector('[data-qf-visita-verificar]').setAttribute('data-paid','1');
    try{await root.QFCloud.syncForCurrentSession?.(true);}catch(_){}
    return true;
   }
   aviso.textContent='Pix ainda não confirmado. Sua visita só ficará paga depois da confirmação bancária.';
   return false;
  };
  const btn=area.querySelector('[data-qf-visita-verificar]');
  btn.onclick=async()=>{btn.disabled=true;try{await verificar();}catch(e){aviso.textContent=e.message;}finally{if(area.isConnected&&btn.getAttribute('data-paid')!=='1'&&btn.isConnected)btn.disabled=false;}};
  const copiar=area.querySelector('[data-qf-visita-copiar]');
  if(copiar)copiar.onclick=async()=>{
   try{await root.navigator.clipboard.writeText(code);aviso.textContent='Pix copiado. Abra seu banco e pague os R$ 25,00.';}
   catch(_){const input=area.querySelector('[data-qf-visita-codigo]');input?.focus();input?.select();aviso.textContent='Selecione e copie o código Pix.';}
  };
  area.querySelector('[data-qf-visita-fechar]').onclick=()=>root.PU.closeSheet();
  let checks=0;
  const poll=async()=>{
   if(!area.isConnected||++checks>36||btn.disabled&&btn.getAttribute('data-paid')==='1')return;
   try{if(await verificar()){btn.setAttribute('data-paid','1');return;}}catch(_){}
   if(area.isConnected)setTimeout(poll,8000);
  };
  setTimeout(poll,8000);
  return true;
 }
 if(root.document)root.document.addEventListener('click',e=>{
   const b=e.target.closest?.('[data-qf-visita-pagar]');
   if(!b)return;
   e.preventDefault();
   if(b.disabled)return;
   b.disabled=true;
   abrir({id:b.getAttribute('data-qf-visita-pagar')}).catch(error=>root.PU?.toast?.(error.message,'danger',7000)).finally(()=>{if(b.isConnected)b.disabled=false;});
 });
 root.QFVisita={selo,clienteHtml,abrir};
 if(typeof module!=='undefined'&&module.exports)module.exports={selo,clienteHtml};
})(typeof window!=='undefined'?window:globalThis);
