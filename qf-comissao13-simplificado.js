/* Funções puras do piloto simplificado. Não habilita desbloqueios nem constitui dívida. */
(function(root){
 'use strict';
 const percentual=13;
 function centavos(valor){
  if(!Number.isSafeInteger(valor)||valor<0)throw new TypeError('valor_centavos_invalido');
  return valor;
 }
 function comissaoPotencial(valorCentavos){
  return Math.round(centavos(valorCentavos)*percentual/100);
 }
 function situacaoCarteira(registro,agora=Date.now()){
  if(!registro||!registro.desbloqueado_em)return 'sem_registro';
  if(registro.comissao_confirmada&&registro.comissao_vencida&&!registro.comissao_paga)return 'bloqueado_comissao';
  if(!registro.prestacao_informada){
   const inicio=Date.parse(registro.desbloqueado_em);
   if(!Number.isFinite(inicio))return 'data_invalida';
   return agora-inicio>=48*60*60*1000?'bloqueado_prestacao':'aguardando_prestacao';
  }
  return registro.comissao_confirmada?'comissao_confirmada':'aguardando_verificacao';
 }
 function mensagemCliente({profissional,servico}){
  const nome=String(profissional||'').trim(),categoria=String(servico||'').trim();
  if(!nome||!categoria)throw new TypeError('dados_incompletos');
  return 'Olá! Aqui é da equipe Quem Faz Serviços. O profissional '+nome+
   ' recebeu seu pedido de '+categoria+'. Gostaríamos de confirmar: vocês chegaram a negociar? '+
   'O serviço foi contratado, não contratado ou ainda está em negociação? '+
   'Se houve contratação, qual foi o valor combinado? Obrigado!';
 }
 function whatsappCliente({telefone,profissional,servico}){
  const numero=String(telefone||'').replace(/\D/g,'');
  if(!/^55[1-9][0-9]{9,10}$/.test(numero))throw new TypeError('telefone_invalido');
  return 'https://wa.me/'+numero+'?text='+encodeURIComponent(mensagemCliente({profissional,servico}));
 }
 const api={percentual,comissaoPotencial,situacaoCarteira,mensagemCliente,whatsappCliente};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.QFComissao13Simplificado=api;
})(typeof window!=='undefined'?window:globalThis);
