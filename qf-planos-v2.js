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
  // O cadastro Avulso é grátis, mas NÃO oferece desbloqueio grátis.
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
 function saldoInicialNovoCadastro(){return 0;}
 return Object.freeze({PROPOSTA,decidir,validarRecargaAvulsa,saldoInicialNovoCadastro});
});
