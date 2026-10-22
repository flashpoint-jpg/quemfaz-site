/* Piloto isolado: a disponibilidade vem exclusivamente do servidor. */
(function(g){
 'use strict';
 function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 function brl(n){return (Number(n||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
 function oferta(s){return '<h2 class="h3">Desbloqueio gratuito · comissão de 13%</h2><p>Sem pagamento antecipado para liberar o contato. Se contratar, o cliente paga pelo Quem Faz após confirmar a conclusão. Você recebe 87% do serviço, antes das taxas financeiras apresentadas previamente.</p><p>Carteirinha digital ativa e aceite dos termos obrigatórios. Até 4 profissionais no total, somando as modalidades. Não há garantia de contratação.</p>'+(!s.desbloqueio_gratuito_ativo?'<p role="status"><strong>Em preparação.</strong> Esta modalidade ainda não está disponível para desbloqueio.</p>':'<label><input type="checkbox" data-qf13-termos> Aceito que o cliente pague pelo Quem Faz, com comissão de 13%, e as regras de confirmação e contestação.</label><button class="btn btn--primary" data-qf13-desbloquear>Desbloquear sem pagar agora</button>');}
 function painel(rows){return rows.map(a=>'<article class="card"><strong>'+esc(a.profissional||a.profissional_id)+'</strong><p>Pedido '+esc(a.chamado_id)+' · Gratuito com comissão de 13%</p><p>Valor: '+esc(brl(a.valor_centavos))+' · Situação: '+esc(a.status)+'</p><p>Agendamento: '+esc(a.agendado_em?new Date(a.agendado_em).toLocaleString('pt-BR'):'—')+'</p><p>Cliente: '+(a.contratado_em?'contratação confirmada':'aguardando confirmação')+' · Conclusão: '+(a.concluido_em?'confirmada':'pendente')+'</p><p>Pagamento: '+esc(a.pagamento)+' · Repasse: '+esc(a.repasse)+'</p><p>Quem Faz (13%): '+esc(brl(a.comissao_centavos))+' · Profissional (87%): '+esc(brl(a.profissional_centavos))+' antes das taxas</p><p>Taxas: '+esc(a.taxas_centavos!=null?brl(a.taxas_centavos):a.taxas)+'</p>'+(a.contestacao?'<p>Contestação: '+esc(a.contestacao)+'</p>':'')+'</article>').join('')||'<p>Nenhuma operação nesta modalidade.</p>';}
 g.QFComissao13={oferta,painel,esc};
 if(typeof module!=='undefined')module.exports=g.QFComissao13;
 if(!g.document||!g.Screens)return;
 const anterior=g.Screens.afterRender;
 g.Screens.afterRender=function(pattern,content,params,user){
  if(anterior)anterior(pattern,content,params,user);
  const admin=pattern==='/admin/dashboard';
  if(!admin&&pattern!=='/profissional/pedido/:id'&&pattern!=='/profissional/perfil')return;
  const c=admin?g.QFAdminCloud&&g.QFAdminCloud.client:g.QFCloud&&g.QFCloud.client;
  if(!c)return;
  const rpc=async(n,a)=>{const r=await c.rpc(n,a||{});if(r.error)throw r.error;return r.data;};
  const box=document.createElement('section');box.className='section card stack--sm';box.dataset.qf13='';
  if(admin){
   content.appendChild(box);box.innerHTML='<h2 class="h3">Desbloqueio gratuito · comissão de 13%</h2><p>Carregando operações…</p>';
   Promise.all([rpc('qf_comissao13_painel'),rpc('qf_comissao13_notificacoes_status')]).then(([rows,notificacoes])=>{if(box.isConnected)box.innerHTML='<h2 class="h3">Desbloqueio gratuito · comissão de 13%</h2><p>A ativação depende da validação do OTP, cobrança e repasse. Sem ativação automática.</p>'+painel(rows)+'<h3 class="h3">Notificações do piloto</h3><p>'+esc(Object.entries(notificacoes.resumo||{}).map(([k,v])=>k+': '+v).join(' · ')||'Nenhum envio nesta modalidade.')+'</p><p>Aceito pelo provedor não significa entrega confirmada no celular.</p>'+(notificacoes.ativo?'<button class="btn btn--outline" data-qf13-anunciar>Anunciar a modalidade aos elegíveis</button>':'<p>Anúncio bloqueado enquanto o piloto não estiver validado.</p>');const anunciar=box.querySelector('[data-qf13-anunciar]');if(anunciar)anunciar.onclick=async()=>{anunciar.disabled=true;try{const r=await rpc('qf_comissao13_anunciar');g.PU.toast(r.ok?String(r.enfileirados)+' avisos enfileirados, sem duplicar.':'Anúncio bloqueado.','info');}catch(e){g.PU.toast('Não foi possível enfileirar os avisos.','danger');}finally{anunciar.disabled=false;}};}).catch(()=>{box.textContent='Não foi possível carregar as operações da modalidade gratuita.';});return;
  }
  if(pattern==='/profissional/perfil'){
   content.appendChild(box);
   rpc('qf_comissao13_recebedor_status').then(r=>{
    if(!box.isConnected)return;
    box.innerHTML='<h2 class="h3">Recebimento da modalidade gratuita</h2><p>Modalidade em preparação. Para receber por split, a Efí exige uma conta Efí em seu nome. O desbloqueio tradicional continua disponível.</p><p>Situação do recebimento: '+esc(r.status)+'</p><form data-qf13-recebedor><label>Código de recebedor Efí (payee_code)<input name="payee" required maxlength="100" autocomplete="off"></label><label>Número da conta Efí<input name="conta" required inputmode="numeric" maxlength="20" autocomplete="off"></label><button class="btn btn--outline" type="submit">Enviar para validação</button><p role="status" data-qf13-status></p></form>';
    const form=box.querySelector('form');form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button'),msg=form.querySelector('[data-qf13-status]');b.disabled=true;try{const out=await rpc('qf_comissao13_recebedor_informar',{p_payee_code:form.elements.payee.value.trim(),p_conta_efi:form.elements.conta.value.trim()});msg.textContent=out.ok?'Dados enviados. O recebimento permanece pendente de validação.':(out.reason==='acordo_em_andamento'?'Existe um acordo em andamento. Os dados de recebimento não podem ser alterados agora.':'Confira os dados da conta e seu documento cadastrado.');}catch{msg.textContent='Não foi possível enviar. Tente novamente mais tarde.';}finally{b.disabled=false;}};
   }).catch(()=>{box.textContent='Não foi possível consultar o cadastro de recebimento.';});return;
  }
  const pedido=g.DB&&g.DB.requestById(params.id);
  if(!pedido||pedido.atendimentoTipo==='garante')return;
  function acoesAcordo(alvo,acordoId){
   const btn=document.createElement('button');btn.type='button';btn.className='btn btn--primary';btn.textContent='Abrir carteirinha deste serviço / enviar link';alvo.appendChild(btn);
   btn.onclick=async()=>{
    btn.disabled=true;
    try{
     const r=await rpc('qf_comissao13_gerar_link',{p_acordo_id:acordoId});if(!r.ok)throw Error(r.reason);
     const link=g.location.origin+'/comissao13.html#token='+encodeURIComponent(r.token)+'&carteirinha='+encodeURIComponent(r.carteirinha_token);
     const cart='/carteirinha.html?token='+encodeURIComponent(r.carteirinha_token)+'#servico='+encodeURIComponent(r.token);
     const a=document.createElement('a');a.className='btn btn--primary';a.href=cart;a.textContent='Mostrar carteirinha com QR deste serviço';
     const w=document.createElement('a');w.className='btn btn--outline';w.href='https://wa.me/?text='+encodeURIComponent('Confira nosso acordo no Quem Faz e confirme pelo seu telefone: '+link);w.target='_blank';w.rel='noopener noreferrer';w.textContent='Enviar link pelo WhatsApp';
     const bloco=document.createElement('div');bloco.className='stack--sm';bloco.append(a,w);btn.replaceWith(bloco);
    }catch(e){btn.disabled=false;g.PU.toast('Não foi possível gerar o link. Confira a situação do acordo e tente novamente.','danger');}
   };
  }
  rpc('qf_comissao13_meu_desbloqueio',{p_chamado_id:params.id}).then(d=>{
   if(!d.ok||!content.isConnected)return;
   // O fluxo antigo de baixa/fechamento não confirma serviços da modalidade 13%.
   content.querySelectorAll('[data-action="fechei-servico"],[data-qf-baixa-btn]').forEach(b=>{b.hidden=true;});
   const agreement=document.createElement('section');agreement.className='section card stack--sm';
   if(d.acordo){agreement.innerHTML='<h2 class="h3">Acordo com pagamento pelo Quem Faz</h2><p>Valor: '+esc(brl(d.acordo.valor_centavos))+' · Situação: '+esc(d.acordo.status)+'</p><p>A contratação e a conclusão dependem da confirmação do cliente com código recebido no telefone dele.</p>';content.appendChild(agreement);acoesAcordo(agreement,d.acordo.id);return;}
   agreement.innerHTML='<h2 class="h3">Fechei o serviço</h2><p>Informe o combinado. O cliente precisa confirmar pelo próprio telefone.</p><form data-qf13-acordo><label>Valor combinado (R$)<input name="valor" type="text" inputmode="decimal" required placeholder="500,00"></label><label>Data e horário<input name="data" type="datetime-local" required></label><button class="btn btn--primary" type="submit">Gerar link para o cliente</button><p role="status" data-qf13-erro></p></form>';
   content.appendChild(agreement);
   agreement.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const f=e.currentTarget,b=f.querySelector('button'),erro=f.querySelector('[data-qf13-erro]');b.disabled=true;
    const reais=Number(f.elements.valor.value.replace(/\./g,'').replace(',','.')),dia=new Date(f.elements.data.value);
    if(!Number.isFinite(reais)||reais<=0||!Number.isFinite(dia.getTime())){erro.textContent='Informe valor e data válidos.';b.disabled=false;return;}
    try{
     const r=await rpc('qf_comissao13_propor',{p_desbloqueio_id:d.id,p_valor_centavos:Math.round(reais*100),p_agendado_em:dia.toISOString()});
     if(!r.ok)throw Error(r.reason);
     const link=g.location.origin+'/comissao13.html#token='+encodeURIComponent(r.token);
     agreement.innerHTML='<h2 class="h3">Aguardando o cliente confirmar</h2><p>Envie este link ao cliente. O link sozinho não confirma o serviço.</p><a class="btn btn--primary" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text='+encodeURIComponent('Confirme nosso acordo no Quem Faz: '+link)+'">Enviar link pelo WhatsApp</a><p>Na conclusão, mostre sua carteirinha digital. Não é necessário imprimir.</p>';
     acoesAcordo(agreement,r.acordo_id);
    }catch(e){erro.textContent='Não foi possível criar o acordo. Atualize a página para conferir a situação antes de tentar novamente.';b.disabled=false;}
   };
  }).catch(()=>{});

  if(!content.querySelector('[data-action="desbloquear-chamada"]'))return;
  rpc('qf_comissao13_status').then(s=>{
   if(!s.ok||!content.isConnected)return;
   box.innerHTML=oferta(s);content.appendChild(box);
   const button=box.querySelector('[data-qf13-desbloquear]');if(!button)return;
   button.onclick=async()=>{
    if(!box.querySelector('[data-qf13-termos]').checked){g.PU.toast('É necessário aceitar os termos.','danger');return;}
    if(!s.recebedor_validado){g.PU.toast('Cadastre e valide sua conta de recebimento Efí no perfil antes de usar esta modalidade.','danger');return;}
    if(!s.carteirinha_ativa){g.PU.toast('Abra seu perfil e ative a carteirinha digital. Não é necessário imprimir.','danger');return;}
    button.disabled=true;
    try{
     let r=await rpc('qf_comissao13_aderir',{p_aceitar:true});if(!r.ok)throw Error(r.reason);
     r=await rpc('qf_comissao13_desbloquear',{p_chamado_id:params.id,p_aceitar:true});if(!r.ok)throw Error(r.reason);
     g.location.reload();
    }catch(e){g.PU.toast('Desbloqueio não autorizado. Atualize a lista. Nenhum saldo foi descontado.','danger');button.disabled=false;}
   };
  }).catch(()=>{});
 };
})(typeof window!=='undefined'?window:globalThis);
