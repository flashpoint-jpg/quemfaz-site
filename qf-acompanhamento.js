/* Acompanhamento real do pedido pelo navegador que o publicou. Sem cadastro, SMS ou confirmação externa. */
(function(g){
 'use strict';
 const prefix='qf_pedido_owner_',url='https://dczlyrgnzlxmzghzaooz.supabase.co/rest/v1/rpc/qf13_acompanhar';
 const key='sb_publishable_-WiYw_1QTzW0l9o0d4ZU9Q_kSadNA2A';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const isIos=()=>/iPhone|iPad|iPod/i.test(g.navigator?.userAgent||'')||(g.navigator?.platform==='MacIntel'&&g.navigator?.maxTouchPoints>1);
 const isStandalone=()=>g.matchMedia?.('(display-mode: standalone)')?.matches===true||g.navigator?.standalone===true;
 function iosInstallHtml(publicado){
  if(!publicado||!isIos()||isStandalone())return '';
  return '<section class="card stack--sm" data-qf-ios-install-card><h2 class="h3">Quer o Quem Faz na Tela de Início?</h2><p>Seu pedido já está publicado. Adicione um atalho para acessar o Quem Faz mais facilmente.</p><button class="btn btn--outline" type="button" data-qf-ios-install aria-expanded="false" aria-controls="qf-ios-install-guide">Adicionar à Tela de Início</button><div id="qf-ios-install-guide" hidden><p><strong>No Safari do iPhone:</strong></p><ol style="line-height:1.7;padding-left:22px"><li>Toque em Compartilhar (pode estar dentro do menu da página).</li><li>Selecione <strong>Adicionar à Tela de Início</strong>.</li><li>Ative <strong>Abrir como App da Web</strong>, se aparecer, e toque em <strong>Adicionar</strong>.</li></ol><p class="text--sm">Se abriu por Instagram ou Facebook, use o menu para abrir este site no Safari primeiro.</p></div><p class="text--sm"><strong>Importante:</strong> acompanhe este pedido no mesmo Safari em que publicou. O atalho é para facilitar os próximos acessos.</p></section>';
 }
 function bindIosInstall(container){const button=container.querySelector('[data-qf-ios-install]');if(!button)return;button.onclick=()=>{const guide=container.querySelector('#qf-ios-install-guide');if(!guide)return;guide.hidden=!guide.hidden;button.setAttribute('aria-expanded',String(!guide.hidden));};}
 function draft(id){const k=prefix+'draft_'+id;let secret=g.localStorage.getItem(k);if(!secret){secret=Array.from(g.crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');g.localStorage.setItem(k,secret);}if(!/^[a-f0-9]{64}$/.test(secret))throw Error('Não foi possível proteger o acesso ao pedido neste navegador.');return secret;}
 function remember(id,secret){g.localStorage.setItem(prefix+id,secret);if(g.localStorage.getItem(prefix+id)!==secret)throw Error('Permita o armazenamento do site para acompanhar seu pedido.');try{g.localStorage.setItem(prefix+'ultimo',id);}catch(_){}}
 function lastId(){try{const v=g.localStorage.getItem(prefix+'ultimo');return /^[a-f0-9-]{36}$/i.test(v||'')?v:'';}catch(_){return '';}}
 async function cancelar(id){const secret=g.localStorage.getItem(prefix+id);if(!secret)throw Error('Abra este pedido no navegador ou aparelho em que você o publicou.');const r=await g.fetch(url.replace('qf13_acompanhar','qf13_cancelar_pedido'),{method:'POST',cache:'no-store',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({p_chamado_id:id,p_segredo:secret})});const out=await r.json().catch(()=>null);if(!r.ok||!out?.ok)throw Error(out?.reason==='ja_desbloqueado'?'Um profissional já desbloqueou este pedido. Fale com a equipe Quem Faz para cancelar.':'Não foi possível cancelar. Tente novamente.');return out;}
 async function api(id,args={}){const secret=g.localStorage.getItem(prefix+id);if(!secret)throw Error('Abra este pedido no navegador ou aparelho em que você o publicou.');const r=await g.fetch(url,{method:'POST',cache:'no-store',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({p_chamado_id:id,p_segredo:secret,...args})});const out=await r.json();if(!r.ok||!out?.ok)throw Error(({codigo_obrigatorio:'Informe os seis dígitos do código do pedido.',codigo_invalido:'Código incorreto. Confira o código deste pedido.',limite_codigo:'Limite de tentativas. Aguarde uma hora.',conclusao_obrigatoria:'Confirme a conclusão do serviço.',valor_alterado:'O valor foi atualizado. Toque em Atualizar acompanhamento e confira antes de confirmar.',estado_invalido:'Essa proposta não está mais disponível. Atualize o acompanhamento.',outro_profissional_contratado:'Você já confirmou outro profissional neste pedido.',resposta_indisponivel:'Contratação já confirmada. Fale com o suporte para revisar.'})[out?.reason]||'Não foi possível validar o acesso a este pedido. Abra no navegador em que fez a publicação.');return out;}
 async function informarContratacao(id,fechamento,valor){
  const secret=g.localStorage.getItem(prefix+id);
  if(!secret)throw Error('Abra este pedido no navegador em que foi publicado.');
  const response=await g.fetch(url.replace('qf13_acompanhar','qf13_cliente_informar_fechamento'),{
   method:'POST',cache:'no-store',headers:{apikey:key,'Content-Type':'application/json'},
   body:JSON.stringify({p_chamado_id:id,p_segredo:secret,p_fechamento:fechamento,p_valor_centavos:valor})
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.ok){
   const reason=data?.reason;
   const messages={acesso_invalido:'Pedido não reconhecido neste aparelho.',valor_invalido:'Confira o valor informado.',ja_declarado:'Este atendimento já tem uma resposta. Atualize o pedido.',outro_profissional_contratado:'Já existe outro profissional contratado para esse pedido.',fechamento_indisponivel:'Este profissional não está disponível para confirmação.'};
   throw Error(messages[reason]||'Não conseguimos registrar a declaração. Atualize o pedido e tente novamente.');
  }
  return data;
 }
 async function mountList(container){
  container.querySelectorAll('[data-qf-list-code]').forEach(el=>el.remove());
 }
 const money=v=>(v/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 function profissionalHtml(f,codigo){
  const confirmado=f.status==='confirmado',pendente=['informado','negociando'].includes(f.status)&&f.valor_centavos!=null&&(!f.cliente_resposta||f.cliente_resposta==='confirmado'||f.cliente_resposta==='negociando');
  const semDeclaracao=['pendente','negociando','recusado'].includes(f.status)&&!f.cliente_resposta&&!pendente;
  return '<article class="card stack--sm" data-qf-owner-fechamento="'+esc(f.id)+'"><h2 class="h3">'+esc(f.profissional)+'</h2>'+
   (f.plano_livre_ativo===true?'<div class="card" data-qf-livre-rule style="padding:12px;background:#edf5ff;border:1px solid #bcd6fa;border-radius:12px"><strong>Plano Livre — pagamento somente por Pix no Quem Faz</strong><p class="text--sm" style="margin:5px 0 0">Não pague diretamente ao profissional. Depois da conclusão, use exclusivamente o Pix gerado neste acompanhamento. O Quem Faz repassa manualmente 87% ao profissional após confirmar o recebimento. Se o Pix ainda não estiver disponível, não transfira valores por fora.</p></div>':'')+
   (confirmado?'<p data-qf-owner-saved><strong>Contratação confirmada por '+esc(money(f.valor_centavos))+'.</strong></p>':
    pendente?'<p style="padding:12px;background:#fff8ef;border:1px solid #efaa57;border-radius:12px">'+esc(f.profissional)+' apresentou um orçamento de <strong>'+esc(money(f.valor_centavos))+'</strong>. Você contratou esse serviço?</p><div class="btn-row">'+(f.etapas_separadas&&f.cliente_resposta!=='confirmado'?'<button class="btn btn--primary" type="button" data-qf-owner-answer="contratar">Aceitei o orçamento</button><button class="btn btn--outline" type="button" data-qf-owner-answer="negociando">Ainda estou negociando</button>':'<form data-qf-owner-concluir class="qf-owner-form"><p>Código de segurança do pedido: <strong>'+esc(codigo||'Atualize o acompanhamento')+'</strong></p><label>Valor final do serviço (R$)<input class="input" name="valor_final" inputmode="decimal" value="'+(Number(f.valor_aceito_centavos??f.valor_centavos)/100).toFixed(2).replace('.',',')+'" required></label><label>Digite o código<input class="input" name="codigo_seguranca" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required></label><label class="qf-owner-check"><input type="checkbox" name="concluido" required><span>Confirmo a contratação, a conclusão do serviço e o valor final informado acima.</span></label><button class="btn btn--primary" type="submit">Confirmar conclusão e valor</button></form>')+'<button class="btn btn--outline" type="button" data-qf-owner-answer="corrigir">Corrigir valor</button><button class="btn btn--outline" type="button" data-qf-owner-answer="nao">Não contratei</button></div>':
    semDeclaracao?'<p>Este profissional ainda não informou um fechamento confirmado. Você contratou? Pode registrar a contratação independentemente, sem aguardar o profissional.</p><form data-qf-owner-relato class="stack--sm"><label>Valor combinado (R$)<input class="input" name="valor" inputmode="decimal" placeholder="Ex.: 500,00" required></label><label class="qf-owner-check"><input type="checkbox" name="confirma" required><span>Confirmo que contratei este profissional pelo valor informado. Entendo que a equipe vai conferir o registro.</span></label><button type="submit" class="btn btn--primary">Sim, contratei — comunicar ao Quem Faz</button></form><p class="text--sm">A declaração será analisada. Não cria comissão ou cobrança automaticamente.</p>':
    '<p>'+esc(f.status==='contestado'&&f.contratado_em?'Você informou que contratou este profissional por '+money(f.valor_aceito_centavos||0)+'. A equipe está conferindo a declaração. Nenhuma cobrança foi gerada.':f.cliente_resposta==='divergencia'?'Correção ou divergência em análise. Aguarde a conferência.':f.cliente_resposta==='nao_contratou'?'Você informou que não contratou este profissional.':f.status==='recusado'?'O profissional informou que não fechou. Fale com o suporte se houver divergência.':'Aguardando o profissional informar o valor combinado.')+'</p>')+(confirmado&&f.cliente_concluiu_em?'<section class="card stack--sm" data-qf-livre-split aria-label="Pagamento pós-serviço"><p role="status">Consultando pagamento...</p></section>':'')+'<p role="status"></p></article>';
 }
 async function montarSplit(area,id,f){
  if(area.dataset.qfSplitMounted)return;area.dataset.qfSplitMounted='1';
  const segredo=g.localStorage.getItem(prefix+id);
  if(!segredo){area.hidden=true;return;}
  const endpoint='https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-livre-pix-manual';
  const call=async action=>{
   const r=await g.fetch(endpoint,{method:'POST',cache:'no-store',
    headers:{apikey:key,'Content-Type':'application/json'},
    body:JSON.stringify({action,chamado_id:id,fechamento_id:f.id,segredo})});
   const d=await r.json().catch(()=>({}));
   if(!d.ok)throw Error(({pagamento_em_preparacao:'A emissão do Pix integral está em validação.',conclusao_nao_confirmada:'Aguarde a confirmação do serviço e do código.',cobranca_antiga_existente:'O fechamento já possui outra cobrança: não vamos gerar um segundo Pix.',pagamento_temporariamente_indisponivel:'Não foi possível emitir Pix seguro. Não faça pagamento fora da plataforma.'})[d.reason]||'Pagamento indisponível. Consulte o suporte.');
   return d;
  };
  let busy=false;
  const fill=d=>{
   if(!area.isConnected)return;
   if(!d.disponivel&&d.status==='nao_iniciado'){area.hidden=false;area.innerHTML='<h3>Pagamento Pix pelo Quem Faz</h3><p role="status">A emissão segura do Pix deste serviço está em preparação. Não faça transferência direta ao profissional do Plano Livre. Aguarde a liberação neste acompanhamento ou procure o suporte.</p>';return;}
   area.hidden=false;
   const st=d.status||'nao_iniciado';
   if(st==='repassado'){area.innerHTML='<h3>Pagamento e repasse confirmados</h3><p>O Pix integral foi confirmado pelo banco e o repasse manual de 87% ao profissional foi registrado pela equipe Quem Faz. A comissão retida é de 13%.</p>';return;}
   if(st==='pago'){area.innerHTML='<h3>Pagamento confirmado</h3><p>O Pix integral foi confirmado pelo banco. O Quem Faz fará o repasse manual de 87% ao profissional e registrará o comprovante.</p>';return;}
   if(st==='pix_pronto'&&d.pix_copia_cola){
    area.replaceChildren();
    const head=g.document.createElement('h3');head.textContent='Pague pelo Quem Faz após o serviço';area.append(head);
    const note=g.document.createElement('p');note.textContent='O cliente paga 100% do serviço ao Quem Faz pelo Pix oficial. A plataforma retém 13% e repassa manualmente os 87% ao profissional após confirmação bancária.';area.append(note);
    const txt=g.document.createElement('textarea');txt.className='input';txt.readOnly=true;txt.value=String(d.pix_copia_cola);txt.style.cssText='min-height:90px;width:100%;box-sizing:border-box';area.append(txt);
    const copy=g.document.createElement('button');copy.type='button';copy.className='btn btn--primary';copy.textContent='Copiar código Pix';copy.onclick=()=>{if(g.navigator.clipboard?.writeText)g.navigator.clipboard.writeText(txt.value).then(()=>copy.textContent='Pix copiado').catch(()=>{txt.select();});else txt.select();};area.append(copy);
    const msg=g.document.createElement('p');msg.setAttribute('role','status');msg.textContent='Aguardando confirmação bancária. Não envie comprovante pelo WhatsApp.';area.append(msg);
    return;
   }
   if(st!=='nao_iniciado'){area.innerHTML='<p role="status">Pagamento em processamento. Verifique mais tarde.</p>';return;}
   if(area.querySelector('[data-qf-livre-gerar]'))return;
   area.innerHTML='<h3>Pagamento após o serviço</h3><p>O serviço está concluído. O cliente paga o valor integral por Pix ao Quem Faz. Após o banco confirmar, a equipe repassa manualmente 87% ao profissional e mantém 13% de comissão.</p><button type="button" class="btn btn--primary" data-qf-livre-gerar>Gerar Pix do serviço</button><p role="status"></p>';
   const btn=area.querySelector('[data-qf-livre-gerar]');
   btn.onclick=async()=>{
    if(busy)return;busy=true;btn.disabled=true;
    area.querySelector('[role=status]').textContent='Preparando Pix seguro...';
    try{const d=await call('checkout');fill({...d,disponivel:true});}
    catch(err){area.querySelector('[role=status]').textContent=err.message;btn.disabled=false;}
    finally{busy=false;}
   };
  };
  const check=async()=>fill(await call('status'));
  try{await check();}catch(_){area.hidden=true;return;}
  let tries=0;
  const timer=g.setInterval(()=>{
   if(!area.isConnected||tries++>120){g.clearInterval(timer);return;}
   if(!g.document.hidden)check().catch(()=>{});
  },15000);
 }
 async function mount(container,id,options={}){
  if(!container||container.dataset.qfOwnerMounted)return;container.dataset.qfOwnerMounted='1';container.classList.add('qf-owner-tracking');
  container.innerHTML='<p role="status">Carregando acompanhamento protegido…</p>';
  const render=async()=>{const data=await api(id);if(!container.isConnected)return;const p=data.pedido;
   const publicado=options.publicado===true;
   const avisoPagamento='<section class="card" data-qf-payment-rules style="border:1px solid #f3b761;border-radius:14px;background:#fff8ed;padding:15px;margin:12px 0"><strong style="color:#8a4600">Como funciona o pagamento do serviço?</strong><p class="text--sm" style="margin:6px 0 0">O pedido é grátis. Se contratar um profissional do <strong>Quem Faz Livre</strong>, o pagamento será por <strong>Pix emitido pelo Quem Faz</strong> — nunca por Pix direto ao profissional. Se escolher um profissional <strong>Avulso</strong>, vocês podem combinar o pagamento diretamente. Você verá a modalidade antes de contratar.</p></section>';
   container.innerHTML='<div class="qf-owner-content">'+(options.embedded?'':(publicado?'<h1 class="h2">Pedido publicado!</h1><p>Estamos buscando profissionais para você.</p>':'<h1 class="h2">Acompanhar meu pedido</h1>'))+(options.embedded?'':'<section class="card stack--sm"><h2 class="h3">'+esc(p.titulo)+'</h2><p>'+esc(p.bairro)+' · '+esc(p.cidade)+'</p><span class="badge">'+esc(({aberto:'Buscando profissionais',em_negociacao:'Em negociação',cancelado:'Cancelado',concluido:'Concluído',finalizado:'Finalizado'})[p.status]||p.status)+'</span></section>')+(options.embedded?'':'<a class="btn btn--primary" href="/?app=1#/cliente/pedidos">Ir para Meus pedidos</a>')+avisoPagamento+iosInstallHtml(publicado)+(!publicado?'<div class="qf-owner-professionals" data-qf-owner-respostas>'+data.profissionais.map(f=>profissionalHtml(f,data.codigo_seguranca)).join('')+(data.profissionais.length?'':'<p>Aguardando profissionais interessados.</p>')+'</div><div class="qf-owner-actions"><button type="button" class="btn btn--outline" data-qf-owner-refresh>Atualizar acompanhamento</button>'+(p.status==='aberto'&&!options.embedded?'<button type="button" class="btn btn--outline" data-qf-owner-cancel>Cancelar pedido</button>':'')+'</div>':'')+'<p role="status" data-qf-owner-status></p></div>';
   bindIosInstall(container);
   container.querySelectorAll('[data-qf-owner-fechamento]').forEach(row=>{
    const dataProf=data.profissionais.find(x=>x.id===row.dataset.qfOwnerFechamento);
    const panel=row.querySelector('[data-qf-livre-split]');
    if(panel&&dataProf)montarSplit(panel,id,dataProf).catch(()=>{});
   });
   const cb=container.querySelector('[data-qf-owner-cancel]');if(cb)cb.onclick=async()=>{if(!g.confirm('Cancelar este pedido? Ele deixará de aparecer para novos profissionais.'))return;cb.disabled=true;try{await cancelar(id);await render();}catch(e){container.querySelector('[data-qf-owner-status]').textContent=e.message;cb.disabled=false;}};
   const refresh=container.querySelector('[data-qf-owner-refresh]');if(refresh)refresh.onclick=()=>render().catch(e=>container.querySelector('[data-qf-owner-status]').textContent=e.message);
   container.querySelectorAll('[data-qf-owner-relato]').forEach(form=>form.onsubmit=async e=>{
    e.preventDefault();
    const row=form.closest('[data-qf-owner-fechamento]'),f=data.profissionais.find(x=>x.id===row.dataset.qfOwnerFechamento);
    const raw=String(form.elements.valor.value||'').trim();
    let normalized=raw;
    if(raw.includes(','))normalized=raw.replace(/\./g,'').replace(',','.');
    else if(/^\d{1,3}(?:\.\d{3})+$/.test(raw))normalized=raw.replace(/\./g,'');
    const valor=/^\d+(?:\.\d{1,2})?$/.test(normalized)?Math.round(Number(normalized)*100):null;
    if(!form.elements.confirma.checked||!Number.isSafeInteger(valor)||valor<100||valor>100000000){
      row.querySelector('[role=status]').textContent='Confirme a contratação e informe um valor entre R$ 1 e R$ 1.000.000.';return;
    }
    form.querySelectorAll('button,input').forEach(el=>el.disabled=true);
    try{
      await informarContratacao(id,f.id,valor);
      await render();
      container.querySelector('[data-qf-owner-status]').textContent='Sua declaração de contratação foi enviada para conferência. Nenhuma comissão foi cobrada.';
    }catch(err){row.querySelector('[role=status]').textContent=err.message;form.querySelectorAll('button,input').forEach(el=>el.disabled=false);}
   });
   container.querySelectorAll('[data-qf-owner-concluir]').forEach(form=>form.onsubmit=async e=>{e.preventDefault();const row=form.closest('[data-qf-owner-fechamento]'),f=data.profissionais.find(x=>x.id===row.dataset.qfOwnerFechamento),codigo=form.elements.codigo_seguranca.value.trim();if(!/^[0-9]{6}$/.test(codigo)||!form.elements.concluido.checked){row.querySelector('[role=status]').textContent='Confira o código e confirme a conclusão do serviço.';return;}form.querySelectorAll('button,input').forEach(x=>x.disabled=true);try{const finalValue=Math.round(Number(form.elements.valor_final.value.replace(',','.'))*100);if(!Number.isSafeInteger(finalValue)||finalValue<100||finalValue>100000000)throw Error('Confira o valor final.');await api(id,{p_acao:'responder',p_fechamento:f.id,p_contratou:true,p_valor_centavos:finalValue,p_codigo:codigo,p_concluido:true});await render();container.querySelector('[data-qf-owner-status]').textContent='Contratação, valor e conclusão confirmados.';}catch(err){row.querySelector('[role=status]').textContent=err.message;form.querySelectorAll('button,input').forEach(x=>x.disabled=false);}});
   container.querySelectorAll('[data-qf-owner-answer]').forEach(b=>b.onclick=async()=>{
    const row=b.closest('[data-qf-owner-fechamento]'),f=data.profissionais.find(x=>x.id===row.dataset.qfOwnerFechamento),acao=b.dataset.qfOwnerAnswer;
    row.querySelectorAll('button').forEach(x=>x.disabled=true);
    try{
     await api(id,{p_acao:['contratar','negociando'].includes(acao)?acao:acao==='corrigir'?'corrigir_valor':'responder',p_fechamento:f.id,p_contratou:acao==='sim',p_valor_centavos:['sim','contratar'].includes(acao)?f.valor_centavos:null});
     await render();
     container.querySelector('[data-qf-owner-status]').textContent=['sim','contratar'].includes(acao)?'Contratação registrada. A comissão só será devida após a conclusão confirmada.':acao==='corrigir'?'Correção solicitada. Nenhuma comissão foi gerada.':'Resposta salva.';
    }catch(e){row.querySelector('[role=status]').textContent=e.message;row.querySelectorAll('button').forEach(x=>x.disabled=false);}
   });
  };
  try{await render();}catch(e){
   container.innerHTML='<h1 class="h2">Acompanhamento protegido</h1><p role="alert">'+esc(e.message)+'</p>';
  }
 }
 g.QFAcompanhamento={draft,remember,api,mount,mountList,cancelar,lastId,informarContratacao};
 if(typeof module!=='undefined')module.exports=g.QFAcompanhamento;
 if(g.document){const start=()=>{const el=g.document.querySelector('[data-qf-acompanhamento-page]');if(el){let id=new URLSearchParams(g.location.hash.slice(1)).get('pedido');if(!/^[a-f0-9-]{36}$/i.test(id||''))id=lastId();if(/^[a-f0-9-]{36}$/i.test(id||'')){try{g.history.replaceState(null,'',g.location.search+'#pedido='+id);}catch(_){}mount(el,id,{publicado:new URLSearchParams(g.location.search).get('publicado')==='1'});}else el.textContent='Pedido não identificado. Abra seu pedido pelo Quem Faz.';}};g.document.readyState==='loading'?g.document.addEventListener('DOMContentLoaded',start,{once:true}):start();}
})(typeof window!=='undefined'?window:globalThis);
