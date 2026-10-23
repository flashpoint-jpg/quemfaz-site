(function(){
 'use strict';
 const params=new URLSearchParams(location.hash.slice(1));
 const token=params.get('token')||'',carteirinha=params.get('carteirinha')||'';
 const prestacao=params.get('fluxo')==='prestacao';
 // O segredo fica somente na memória desta aba e não permanece no histórico de navegação.
 if(token)history.replaceState(null,'',location.pathname);
 const $=id=>document.getElementById(id),status=$('status'),select=$('finalidade');
 const mensagens={link_invalido:'Link inválido ou expirado. Solicite um novo link.',codigo_invalido:'Código inválido, expirado ou bloqueado. Confira o SMS.',limite:'Limite de tentativas atingido. Aguarde para tentar novamente.',otp_nao_configurado:'A confirmação por SMS ainda não está disponível.',estado_invalido:'Esta ação não está disponível para a situação atual do serviço.',use_acesso_cliente:'A confirmação deve ser feita no acesso do cliente.',falha_envio:'O provedor não aceitou o envio. Tente novamente mais tarde.'};
 async function api(action,args={}){
  const r=await fetch('https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-comissao13',{method:'POST',headers:{'Content-Type':'application/json',apikey:'sb_publishable_-WiYw_1QTzW0l9o0d4ZU9Q_kSadNA2A'},body:JSON.stringify({action,token,carteirinha,fluxo:prestacao?'prestacao':undefined,...args})});
  const out=await r.json();if(!out.ok)throw Error(mensagens[out.reason]||'Não foi possível concluir esta ação. Nenhum pagamento foi autorizado.');return out;
 }
 const moeda=n=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 async function carregar(){
  const a=await api('info');
  if(prestacao){
   $('resumo').textContent='Profissional: '+a.profissional+'\nPedido: '+a.pedido+(a.valor_centavos?'\nValor informado: '+moeda(a.valor_centavos):'')+'\nVocê contratou este profissional?';
   $('telefone').textContent=a.telefone_final;select.replaceChildren();
   for(const [value,label] of [['contratou','Sim, contratei'],['nao_contratou','Não, não contratei']]){const o=document.createElement('option');o.value=value;o.textContent=label;select.appendChild(o);}
   $('acoes').hidden=false;$('pagamento').hidden=true;
   if(a.otp_configurado===false){$('enviar').disabled=true;status.textContent='A verificação por SMS está temporariamente indisponível. A equipe Quem Faz precisa conferir sua resposta. Nenhuma comissão foi autorizada.';}
   return;
  }
  $('resumo').textContent='Profissional: '+a.profissional+'\nPedido: '+a.pedido+'\nValor combinado: '+moeda(a.valor_centavos)+'\nAtendimento: '+new Date(a.agendado_em).toLocaleString('pt-BR')+'\nSituação: '+a.status;
  $('telefone').textContent=a.telefone_final;select.replaceChildren();
  const opcoes=[];
  if(a.status==='proposto')opcoes.push(['contratar','Confirmar contratação e valor']);
  if(a.status==='contratado'&&new Date(a.agendado_em)<=new Date())opcoes.push(['concluir','Confirmar serviço concluído']);
  if(['proposto','contratado','concluido','pagamento_pendente','pago','repasse_pendente','repassado'].includes(a.status))opcoes.push(['contestar','Serviço não concluído / Contestar']);
  for(const [value,label] of opcoes){const o=document.createElement('option');o.value=value;o.textContent=label;select.appendChild(o);}
  $('acoes').hidden=!opcoes.length;
  $('pagamento').hidden=!(a.financeiro_disponivel&&['concluido','pagamento_pendente'].includes(a.status));
  if(a.status==='concluido'&&!a.financeiro_disponivel)status.textContent='Conclusão registrada. O pagamento está indisponível enquanto a integração financeira estiver em validação.';
  if(a.status==='contestado')status.textContent='Contestação registrada. Cobrança e repasse bloqueados para revisão.';
 }
 select.onchange=()=>{$('form').hidden=true;$('motivo-label').hidden=select.value!=='contestar';$('motivo').required=select.value==='contestar';$('confirmo').checked=false;$('codigo').value='';};
 $('enviar').onclick=async()=>{
  $('enviar').disabled=true;status.textContent='Solicitando código…';
  try{await api('enviar_codigo',{finalidade:select.value});$('form').hidden=false;$('motivo-label').hidden=select.value!=='contestar';$('motivo').required=select.value==='contestar';status.textContent='Envio aceito pelo provedor. Confira seu SMS. O código vale por 5 minutos.';$('codigo').focus();}
  catch(e){status.textContent=e.message;}finally{$('enviar').disabled=false;}
 };
 $('form').onsubmit=async e=>{e.preventDefault();$('confirmar').disabled=true;try{const out=await api('confirmar',{finalidade:select.value,codigo:$('codigo').value,confirmar:$('confirmo').checked,motivo:$('motivo').value});$('form').hidden=true;status.textContent='Confirmação registrada com segurança. A decisão sobre comissão depende da administração.';if(prestacao){$('acoes').hidden=true;if(out.codigo_servico){$('resumo').textContent='Código de contratação: '+out.codigo_servico+'\nForneça este código ao profissional contratado para ele registrar o valor combinado. Este código é diferente do SMS de verificação.';}return;}await carregar();}catch(e){status.textContent=e.message;}finally{$('confirmar').disabled=false;}};
 document.querySelectorAll('[data-pagar]').forEach(b=>{b.onclick=async()=>{
  b.disabled=true;status.textContent='Consultando cobrança…';
  try{
   const r=await fetch('https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-comissao13-financeiro',{method:'POST',headers:{'Content-Type':'application/json',apikey:'sb_publishable_-WiYw_1QTzW0l9o0d4ZU9Q_kSadNA2A'},body:JSON.stringify({token,metodo:b.dataset.pagar})});
   const out=await r.json();if(!out.ok)throw Error(out.reason==='cobranca_em_verificacao'?'A cobrança está em verificação. Não faça um segundo pagamento.':'O pagamento ainda não está disponível. Nenhuma confirmação financeira foi registrada.');
   if(out.checkout_url){const u=new URL(out.checkout_url);if(u.protocol!=='https:'||!['pagamento.gerencianet.com.br','pagamento.efipay.com.br'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw Error('Endereço de pagamento inválido.');location.assign(u.href);}
   else if(out.pix_copia_cola){$('cobranca').textContent='Pix copia e cola: '+out.pix_copia_cola;status.textContent='Cobrança emitida. Aguardando confirmação do provedor.';}
  }catch(e){status.textContent=e.message;}finally{b.disabled=false;}
 };});
 carregar().catch(e=>{status.textContent=e.message;$('resumo').textContent='Não foi possível abrir este acordo.';});
})();
