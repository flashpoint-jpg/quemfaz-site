const test=require('node:test');
const assert=require('node:assert/strict');
const {PROPOSTA,decidir,validarRecargaAvulsa,validarAtivacaoCadastro,podeFinalizarCadastro,MENSAGEM_PAGAMENTO,saldoInicialNovoCadastro}=require('../qf-planos-v2.js');
const agora='2026-10-30T18:00:00.000Z';
const ok=(codigo,cota)=>({codigo,cota_contratada:cota,pagamento_confirmado:true,inicio_em:'2026-10-30T12:00:00.000Z',fim_em:'2026-11-29T12:00:00.000Z'});
const request=(extra={})=>({agora,preco_desbloqueio_centavos:1300,carteira_centavos:0,...extra});
test('catálogo proposto: 4 opções, valores e cotas, sem modelo por comissão',()=>{
 assert.deepEqual(PROPOSTA.map(x=>[x.codigo,x.preco_centavos,x.cota]),[
  ['avulso',1300,null],['basico',3990,10],['pro',7990,25],['completo',14990,100]]);
 assert.equal(PROPOSTA.some(p=>Object.keys(p).some(k=>/comissao/i.test(k))),false);
});
test('cadastro novo é avulso sem crédito grátis',()=>{
 assert.equal(saldoInicialNovoCadastro(),0);
 assert.equal(decidir(request()).origem,'recarga_necessaria');
});
test('plano só tem cota com Pix confirmado e preços aprovados',()=>{
 assert.equal(decidir(request({assinatura:ok('basico',10)})).origem,'recarga_necessaria');
 assert.equal(decidir(request({propostaAprovada:true,assinatura:{...ok('basico',10),pagamento_confirmado:false}})).origem,'recarga_necessaria');
 assert.equal(decidir(request({propostaAprovada:true,assinatura:ok('basico',10)})).origem,'cota');
});
test('a cota é usada antes do saldo da carteira',()=>{
 const r=decidir(request({assinatura:ok('pro',25),propostaAprovada:true,consumidos:24,carteira_centavos:5000}));
 assert.deepEqual(r,{origem:'cota',custo_centavos:0,restantes:0,liberado:true});
});
test('acabou a cota, usa saldo avulso sem custo de comissão',()=>{
 const r=decidir(request({assinatura:ok('basico',10),propostaAprovada:true,consumidos:10,carteira_centavos:5000,creditoAvulsoComprovado:true}));
 assert.equal(r.origem,'credito_avulso');assert.equal(r.custo_centavos,1300);
});
test('Avulso precisa pagar R$ 13,00 primeiro: saldo exibido sozinho não autoriza desbloqueio',()=>{
 assert.equal(decidir(request({carteira_centavos:1300})).origem,'recarga_necessaria');
 assert.equal(decidir(request({carteira_centavos:1300,creditoAvulsoComprovado:false})).liberado,false);
 assert.equal(decidir(request({carteira_centavos:1300,creditoAvulsoComprovado:true})).origem,'credito_avulso');
});
test('Pix pendente, recusado ou inferior a R$13 nunca disponibiliza crédito',()=>{
 assert.equal(validarRecargaAvulsa({valor_centavos:1299,status:'aprovado',confirmadaPeloBanco:true}).valorCreditado,0);
 assert.equal(validarRecargaAvulsa({valor_centavos:1300,status:'pendente',confirmadaPeloBanco:true}).valorCreditado,0);
 assert.equal(validarRecargaAvulsa({valor_centavos:1300,status:'aprovado',confirmadaPeloBanco:false}).liberarCredito,false);
 const ok=validarRecargaAvulsa({valor_centavos:1300,status:'aprovado',confirmadaPeloBanco:true});
 assert.deepEqual(ok,{liberarCredito:true,valorCreditado:1300,motivo:'pix_confirmado'});
});
test('todos os demais planos precisam de Pix confirmado para usar sua cota',()=>{
 for(const [codigo,cota] of [['basico',10],['pro',25],['completo',100]]){
  assert.equal(decidir(request({assinatura:{...ok(codigo,cota),pagamento_confirmado:false},propostaAprovada:true})).origem,'recarga_necessaria');
 }
});
test('cadastro profissional só ativa após pagamento comprovado do plano escolhido',()=>{
 const comprovante={pagamentoStatus:'aprovado',confirmadaPeloBanco:true,txid:'QF_PLANOS_PIX_20261030',endToEndId:'E12345678901234567890'};
 for (const [plano,valor] of [['avulso',1300],['basico',3990],['pro',7990],['completo',14990]]){
  const ativo=validarAtivacaoCadastro({...comprovante,plano,valor_centavos:valor});
  assert.equal(ativo.ativarCadastro,true,plano);
  assert.equal(ativo.credito_centavos,plano==='avulso'?valor:0);
  assert.equal(validarAtivacaoCadastro({...comprovante,plano,valor_centavos:valor,pagamentoStatus:'pendente'}).ativarCadastro,false);
  assert.equal(validarAtivacaoCadastro({...comprovante,plano,valor_centavos:valor,confirmadaPeloBanco:false}).ativarCadastro,false);
  assert.equal(validarAtivacaoCadastro({...comprovante,plano,valor_centavos:valor-100}).ativarCadastro,false);
 }
 assert.equal(validarAtivacaoCadastro({...comprovante,plano:'avulso',valor_centavos:300}).ativarCadastro,false);
 assert.equal(validarAtivacaoCadastro({...comprovante,plano:'basico',valor_centavos:5290}).ativarCadastro,false,'Não cobrar taxa extra de R$13');
});
test('sem Pix não finaliza cadastro: mostra mensagem de pagamento obrigatório',()=>{
 const dados={plano:'avulso',valor_centavos:1300,pagamentoStatus:'pendente',confirmadaPeloBanco:false};
 const bloqueado=podeFinalizarCadastro(dados);
 assert.equal(bloqueado.podeFinalizar,false);
 assert.equal(bloqueado.mensagem,'É necessário pagar o plano escolhido para concluir seu cadastro.');
 assert.equal(MENSAGEM_PAGAMENTO,bloqueado.mensagem);
 assert.equal(bloqueado.credito_centavos,0);
 for(const plano of ['basico','pro','completo']){
  const r=podeFinalizarCadastro({...dados,plano});
  assert.equal(r.podeFinalizar,false);
  assert.equal(r.mensagem,bloqueado.mensagem);
 }
 const ok=podeFinalizarCadastro({plano:'avulso',valor_centavos:1300,pagamentoStatus:'aprovado',confirmadaPeloBanco:true,txid:'QF_REG_12345',endToEndId:'E12345678901234567890'});
 assert.equal(ok.podeFinalizar,true);
 assert.equal(ok.credito_centavos,1300);
 assert.equal(ok.mensagem,'');
});
test('Mensal completo não passa de 100 desbloqueios por cota',()=>{
 assert.equal(decidir(request({assinatura:ok('completo',100),propostaAprovada:true,consumidos:99})).origem,'cota');
 assert.equal(decidir(request({assinatura:ok('completo',100),propostaAprovada:true,consumidos:100})).origem,'recarga_necessaria');
});
test('assinatura expirada não gera cota; requer recarga',()=>{
 const assinatura={...ok('pro',25),fim_em:'2026-10-29T12:00:00.000Z'};
 assert.equal(decidir(request({assinatura,propostaAprovada:true})).origem,'recarga_necessaria');
});
test('plano Livre antigo pago continua ilimitado até o vencimento',()=>{
 const legado={...ok('livre_legado',null)};
 assert.equal(decidir(request({legado})).origem,'plano_legado');
 assert.equal(decidir(request({legado:{...legado,pagamento_confirmado:false}})).origem,'recarga_necessaria');
 assert.equal(decidir(request({legado:{...legado,fim_em:'2026-10-29T12:00:00.000Z'}})).origem,'recarga_necessaria');
});
test('entrada adulterada não concede desbloqueios',()=>{
 assert.throws(()=>decidir(request({carteira_centavos:-100})),/saldo/);
 assert.throws(()=>decidir(request({preco_desbloqueio_centavos:NaN})),/preço/);
 assert.throws(()=>decidir(request({assinatura:ok('basico',10),propostaAprovada:true,consumidos:-1})),/consumos/);
});
