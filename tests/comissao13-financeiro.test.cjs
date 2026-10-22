const {test}=require('node:test');const assert=require('node:assert/strict');
const f={financeiro_id:'abc',acordo_id:'acordo',valor_centavos:50000,comissao_centavos:6500,profissional_centavos:43500,txid:'txid-test',split_id:'split-test',provedor_id:'12345',recebedor:{documento:'12345678909',conta_efi:'1234567',payee_code:'payee-test'}};
test('Efí: split exato de 13%/87%, sem cartão no servidor e sem QR antes do vínculo',async()=>{
 const {splitPix,linkCartao,emitirPix}=await import('../supabase/functions/quemfaz-comissao13-financeiro/efi.mjs');
 const pix=splitPix(f);assert.equal(pix.split.minhaParte.valor,'65.00');assert.equal(pix.split.repasses[0].valor,'435.00');assert.equal(pix.split.divisaoTarifa,'assumir_total');
 const card=linkCartao(f,'https://example.test/webhook');assert.equal(card.items[0].marketplace.mode,1);assert.equal(card.items[0].marketplace.repasses[0].fixed,43500);assert.equal(card.settings.payment_method,'credit_card');assert.ok(!JSON.stringify(card).includes('payment_token'));
 const calls=[];const result=await emitirPix(f,'pix-chave',async(m,p,b)=>{calls.push(p);return p.includes('/cob/')&&!p.includes('/vinculo/')?{pixCopiaECola:'QR-TESTE'}:{};});assert.equal(result.pix_copia_cola,'QR-TESTE');assert.equal(calls.length,3);
 await assert.rejects(emitirPix(f,'pix-chave',async(m,p)=>{if(p.includes('/vinculo/'))throw Error('falhou');return{pixCopiaECola:'QR-NAO-EXIBIR'};}),/falhou/);
});
test('Efí: webhook exige segredo e dados reconciliados do banco; approved não liquida',async()=>{
 const {segredoConfere,verificarPix,verificarCartao}=await import('../supabase/functions/quemfaz-comissao13-financeiro/efi.mjs');
 assert.equal(await segredoConfere('x','segredo'.repeat(8)),false);assert.equal(await segredoConfere('segredo'.repeat(8),'segredo'.repeat(8)),true);
 const pix={txid:f.txid,config:{id:f.split_id},valor:{original:'500.00'},status:'CONCLUIDA',pix:{txid:f.txid,endToEndId:'E_TESTE',valor:'500.00'},split:{minhaParte:{valorTarifa:500},repasses:{conta:'1234567',valor:43500,dataEfetivacao:'2026-10-22T17:00:00Z'}}};
 assert.equal(verificarPix(f,pix).repasse_confirmado,true);
 assert.throws(()=>verificarPix(f,{...pix,txid:'outro'}),/incompativel/);
 assert.throws(()=>verificarPix(f,{...pix,valor:{original:'1.00'}}),/incompativel/);
 assert.equal(verificarPix(f,{...pix,status:'ATIVA'}).confirmado,false);
 assert.equal(verificarPix(f,{...pix,split:{}}).repasse_confirmado,false);
 const cartao={charge_id:'12345',custom_id:'qf13_abc',total:50000,status:'approved'};
 assert.equal(verificarCartao(f,cartao).confirmado,false);assert.equal(verificarCartao(f,{...cartao,status:'paid'}).tipo,'pago');
 assert.equal(verificarCartao(f,{...cartao,status:'chargeback'}).tipo,'chargeback');
});
