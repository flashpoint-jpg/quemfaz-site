/* Motor de planejamento dos novos planos, INATIVO em produção.
 * A decisão aqui é apenas prévia de interface. Desbloqueios e confirmações Pix
 * DEVEM ser autorizados atomicamente pelo Postgres, jamais por este JavaScript.
 * Preços/cotas propostos aguardam confirmação do administrador.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.QFPlanosV2=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const PROPOSTA=Object.freeze([
  Object.freeze({codigo:'avulso',nome:'Avulso',preco_centavos:1300,cota:null,descricao:'Pix inicial obrigatório de R$ 13 (ou mais). Saldo liberado só após confirmação; sem pagamento, sem desbloqueios'}),
  Object.freeze({codigo:'basico',nome:'Básico',preco_centavos:3990,cota:10,descricao:'10 desbloqueios a cada 30 dias'}),
  Object.freeze({codigo:'pro',nome:'Pro',preco_centavos:7990,cota:25,descricao:'25 desbloqueios a cada 30 dias'}),
  Object.freeze({codigo:'completo',nome:'Mensal completo',preco_centavos:14990,cota:100,descricao:'Até 100 desbloqueios por período de 30 dias'})
 ]);
 function inteiroNaoNegativo(n,nome){
  if(!Number.isSafeInteger(n)||n<0)throw Error('Dado inválido: '+nome);
  return n;
 }
 function validade(s,agora){
  return s&&s.pagamento_confirmado===true&&Number.isFinite(Date.parse(s.inicio_em))&&
   Number.isFinite(Date.parse(s.fim_em))&&Date.parse(s.inicio_em)<=agora&&Date.parse(s.fim_em)>agora;
 }
 function decidir({agora=new Date().toISOString(),assinatura=null,legado=null,carteira_centavos=0,preco_desbloqueio_centavos,consumidos=0,propostaAprovada=false,creditoAvulsoComprovado=false}={}){
  const instante=Date.parse(agora);
  if(!Number.isFinite(instante))throw Error('Data inválida');
  const saldo=inteiroNaoNegativo(carteira_centavos,'saldo');
  const preco=inteiroNaoNegativo(preco_desbloqueio_centavos,'preço do desbloqueio');
  if(preco===0)throw Error('Preço de desbloqueio precisa ser positivo');
  // Contratos antigos pagos conservam o direito integral até a expiração.
  if(validade(legado,instante)&&legado.codigo==='livre_legado'){
   return {origem:'plano_legado',custo_centavos:0,restantes:null,liberado:true};
  }
  // A proposta ainda não permite venda. Só contratos novos aprovados e pagos podem usar cotas.
  if(propostaAprovada&&validade(assinatura,instante)){
   const p=PROPOSTA.find(x=>x.codigo===assinatura.codigo);
   if(p&&p.cota!=null&&p.cota===assinatura.cota_contratada){
    const consumidosValidos=inteiroNaoNegativo(consumidos,'consumos');
    const restantes=Math.max(0,p.cota-consumidosValidos);
    if(restantes>0)return {origem:'cota',custo_centavos:0,restantes:restantes-1,liberado:true};
   }
  }
  // Pré-cadastro sem pagamento não é cadastro profissional ativo e NÃO oferece desbloqueio.
  // Somente saldo cuja origem paga foi confirmada pelo servidor pode ser usado.
  // O novo Avulso exige uma recarga Pix inicial de pelo menos R$ 13,00.
  if(creditoAvulsoComprovado===true&&saldo>=preco)
   return {origem:'credito_avulso',custo_centavos:preco,restantes:0,liberado:true};
  return {origem:'recarga_necessaria',custo_centavos:preco,restantes:0,liberado:false};
 }
 function validarRecargaAvulsa({valor_centavos,status,confirmadaPeloBanco=false}={}){
  // Previa de regra de negocio: a confirmacao efetiva deve vir da conciliacao Efí no servidor.
  const valor=inteiroNaoNegativo(valor_centavos,'valor da recarga');
  if(valor<1300) return Object.freeze({liberarCredito:false,valorCreditado:0,motivo:'recarga_minima_13'});
  if(status!=='aprovado'||confirmadaPeloBanco!==true)
   return Object.freeze({liberarCredito:false,valorCreditado:0,motivo:'aguardando_pix'});
  return Object.freeze({liberarCredito:true,valorCreditado:valor,motivo:'pix_confirmado'});
 }
 // Modelo somente de validação: o backend deve confirmar o Pix e ativar o cadastro
 // na mesma operação transacional que cria o direito ao plano escolhido.
 function validarAtivacaoCadastro({plano,valor_centavos,pagamentoStatus,confirmadaPeloBanco=false,txid='',endToEndId=''}={}){
  const escolhido=PROPOSTA.find(p=>p.codigo===plano);
  if(!escolhido) return Object.freeze({ativarCadastro:false,credito_centavos:0,motivo:'plano_invalido'});
  const pago=Number.isSafeInteger(valor_centavos)&&valor_centavos>0;
  if(!pago || pagamentoStatus!=='aprovado'||confirmadaPeloBanco!==true||
     typeof txid!=='string'||!txid.trim()||
     typeof endToEndId!=='string'||endToEndId.trim().length<16)
   return Object.freeze({ativarCadastro:false,credito_centavos:0,motivo:'aguardando_pagamento_confirmado'});
  const valorValido=plano==='avulso' ? valor_centavos>=1300 : valor_centavos===escolhido.preco_centavos;
  if(!valorValido) return Object.freeze({ativarCadastro:false,credito_centavos:0,motivo:'valor_do_plano_incorreto'});
  return Object.freeze({
   ativarCadastro:true,
   plano,
   credito_centavos:plano==='avulso'?valor_centavos:0,
   cota:escolhido.cota,
   motivo:'plano_pago'
  });
 }
 const MENSAGEM_PAGAMENTO='É necessário pagar o plano escolhido para concluir seu cadastro.';
 function podeFinalizarCadastro({plano,valor_centavos,pagamentoStatus,confirmadaPeloBanco=false,txid='',endToEndId=''}={}){
  const decisao=validarAtivacaoCadastro({plano,valor_centavos,pagamentoStatus,confirmadaPeloBanco,txid,endToEndId});
  return Object.freeze({
   podeFinalizar:decisao.ativarCadastro,
   mensagem:decisao.ativarCadastro?'':MENSAGEM_PAGAMENTO,
   plano:decisao.ativarCadastro?decisao.plano:null,
   credito_centavos:decisao.ativarCadastro?decisao.credito_centavos:0
  });
 }
 function saldoInicialNovoCadastro(){return 0;}
 return Object.freeze({PROPOSTA,decidir,validarRecargaAvulsa,validarAtivacaoCadastro,podeFinalizarCadastro,MENSAGEM_PAGAMENTO,saldoInicialNovoCadastro});
});
