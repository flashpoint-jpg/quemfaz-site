/* Piloto isolado: a disponibilidade vem exclusivamente do servidor. */
(function(g){
 'use strict';
 function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 function brl(n){return (Number(n||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
 function oferta(s){return '<h2 class="h3">Desbloqueio gratuito · comissão de 13%</h2><p>Sem pagamento antecipado para liberar o contato. Se contratar, o cliente paga pelo Quem Faz após confirmar a conclusão. Você recebe 87% do serviço, antes das taxas financeiras apresentadas previamente.</p><p>Carteirinha digital ativa e aceite dos termos obrigatórios. Até 4 profissionais no total, somando as modalidades. Não há garantia de contratação.</p>'+(!s.desbloqueio_gratuito_ativo?'<p role="status"><strong>Em preparação.</strong> Esta modalidade ainda não está disponível para desbloqueio.</p>':'<label><input type="checkbox" data-qf13-termos> Aceito que o cliente pague pelo Quem Faz, com comissão de 13%, e as regras de confirmação e contestação.</label><button class="btn btn--primary" data-qf13-desbloquear>Desbloquear sem pagar agora</button>');}
 function painel(rows){return rows.map(a=>'<article class="card"><strong>'+esc(a.profissional||a.profissional_id)+'</strong><p>Pedido '+esc(a.chamado_id)+' · Gratuito com comissão de 13%</p><p>Valor: '+esc(brl(a.valor_centavos))+' · Situação: '+esc(a.status)+'</p><p>Agendamento: '+esc(a.agendado_em?new Date(a.agendado_em).toLocaleString('pt-BR'):'—')+'</p><p>Cliente: '+(a.contratado_em?'contratação confirmada':'aguardando confirmação')+' · Conclusão: '+(a.concluido_em?'confirmada':'pendente')+'</p><p>Pagamento: '+esc(a.pagamento)+' · Repasse: '+esc(a.repasse)+'</p><p>Quem Faz (13%): '+esc(brl(a.comissao_centavos))+' · Profissional (87%): '+esc(brl(a.profissional_centavos))+' antes das taxas</p><p>Taxas: '+esc(a.taxas)+'</p>'+(a.contestacao?'<p>Contestação: '+esc(a.contestacao)+'</p>':'')+'</article>').join('')||'<p>Nenhuma operação nesta modalidade.</p>';}
 g.QFComissao13={oferta,painel,esc};
 if(typeof module!=='undefined')module.exports=g.QFComissao13;
 if(!g.document||!g.Screens)return;
 const anterior=g.Screens.afterRender;
 g.Screens.afterRender=function(pattern,content,params,user){
  if(anterior)anterior(pattern,content,params,user);
  const admin=pattern==='/admin/dashboard';
  if(!admin&&pattern!=='/profissional/pedido/:id')return;
  const c=admin?g.QFAdminCloud&&g.QFAdminCloud.client:g.QFCloud&&g.QFCloud.client;
  if(!c)return;
  const rpc=async(n,a)=>{const r=await c.rpc(n,a||{});if(r.error)throw r.error;return r.data;};
  const box=document.createElement('section');box.className='section card stack--sm';box.dataset.qf13='';
  if(admin){
   content.appendChild(box);box.innerHTML='<h2 class="h3">Desbloqueio gratuito · comissão de 13%</h2><p>Carregando operações…</p>';
   rpc('qf_comissao13_painel').then(rows=>{if(box.isConnected)box.innerHTML='<h2 class="h3">Desbloqueio gratuito · comissão de 13%</h2><p>A ativação depende da validação do OTP, cobrança e repasse. Sem ativação automática.</p>'+painel(rows);}).catch(()=>{box.textContent='Não foi possível carregar as operações da modalidade gratuita.';});return;
  }
  const pedido=g.DB&&g.DB.requestById(params.id);
  if(!pedido||pedido.atendimentoTipo==='garante')return;
  rpc('qf_comissao13_meu_desbloqueio',{p_chamado_id:params.id}).then(d=>{
   if(!d.ok||!content.isConnected)return;
   // O fluxo antigo de baixa/fechamento não confirma serviços da modalidade 13%.
   content.querySelectorAll('[data-action="fechei-servico"],[data-qf-baixa-btn]').forEach(b=>{b.hidden=true;});
   const agreement=document.createElement('section');agreement.className='section card stack--sm';
   if(d.acordo){agreement.innerHTML='<h2 class="h3">Acordo com pagamento pelo Quem Faz</h2><p>Valor: '+esc(brl(d.acordo.valor_centavos))+' · Situação: '+esc(d.acordo.status)+'</p><p>A contratação e a conclusão dependem da confirmação do cliente com código recebido no telefone dele.</p>';content.appendChild(agreement);return;}
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
