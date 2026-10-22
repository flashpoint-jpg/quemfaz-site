(function(){
 'use strict';
 const token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
 const $=id=>document.getElementById(id),status=$('status'),select=$('finalidade');
 const mensagens={link_invalido:'Link inválido ou expirado. Solicite um novo link.',codigo_invalido:'Código inválido, expirado ou bloqueado. Confira o SMS.',limite:'Limite de tentativas atingido. Aguarde para tentar novamente.',otp_nao_configurado:'A confirmação por SMS ainda não está disponível.',estado_invalido:'Esta ação não está disponível para a situação atual do serviço.',use_acesso_cliente:'A confirmação deve ser feita no acesso do cliente.',falha_envio:'O provedor não aceitou o envio. Tente novamente mais tarde.'};
 async function api(action,args={}){
  const r=await fetch('https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-comissao13',{method:'POST',headers:{'Content-Type':'application/json',apikey:'sb_publishable_-WiYw_1QTzW0l9o0d4ZU9Q_kSadNA2A'},body:JSON.stringify({action,token,...args})});
  const out=await r.json();if(!out.ok)throw Error(mensagens[out.reason]||'Não foi possível concluir esta ação. Nenhum pagamento foi autorizado.');return out;
 }
 const moeda=n=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 async function carregar(){
  const a=await api('info');
  $('resumo').textContent='Profissional: '+a.profissional+'\nPedido: '+a.pedido+'\nValor combinado: '+moeda(a.valor_centavos)+'\nAtendimento: '+new Date(a.agendado_em).toLocaleString('pt-BR')+'\nSituação: '+a.status;
  $('telefone').textContent=a.telefone_final;select.replaceChildren();
  const opcoes=[];
  if(a.status==='proposto')opcoes.push(['contratar','Confirmar contratação e valor']);
  if(a.status==='contratado'&&new Date(a.agendado_em)<=new Date())opcoes.push(['concluir','Confirmar serviço concluído']);
  if(['proposto','contratado','concluido','pagamento_pendente'].includes(a.status))opcoes.push(['contestar','Serviço não concluído / Contestar']);
  for(const [value,label] of opcoes){const o=document.createElement('option');o.value=value;o.textContent=label;select.appendChild(o);}
  $('acoes').hidden=!opcoes.length;
  if(a.status==='concluido')status.textContent='Conclusão registrada. O pagamento está indisponível enquanto a integração financeira estiver em validação.';
  if(a.status==='contestado')status.textContent='Contestação registrada. Cobrança e repasse bloqueados para revisão.';
 }
 select.onchange=()=>{$('form').hidden=true;$('motivo-label').hidden=select.value!=='contestar';$('motivo').required=select.value==='contestar';$('confirmo').checked=false;$('codigo').value='';};
 $('enviar').onclick=async()=>{
  $('enviar').disabled=true;status.textContent='Solicitando código…';
  try{await api('enviar_codigo',{finalidade:select.value});$('form').hidden=false;$('motivo-label').hidden=select.value!=='contestar';$('motivo').required=select.value==='contestar';status.textContent='Envio aceito pelo provedor. Confira seu SMS. O código vale por 5 minutos.';$('codigo').focus();}
  catch(e){status.textContent=e.message;}finally{$('enviar').disabled=false;}
 };
 $('form').onsubmit=async e=>{e.preventDefault();$('confirmar').disabled=true;try{await api('confirmar',{finalidade:select.value,codigo:$('codigo').value,confirmar:$('confirmo').checked,motivo:$('motivo').value});$('form').hidden=true;status.textContent='Confirmação registrada com segurança.';await carregar();}catch(e){status.textContent=e.message;}finally{$('confirmar').disabled=false;}};
 carregar().catch(e=>{status.textContent=e.message;$('resumo').textContent='Não foi possível abrir este acordo.';});
})();
