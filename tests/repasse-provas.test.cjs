const {test}=require('node:test'),assert=require('node:assert/strict');
test('prova de entrada rejeita devolução, IDs duplicados, valor divergente e confirmação ausente',async()=>{
 const {gotIncoming}=await import('../supabase/functions/quemfaz-livre-pix/provas.mjs');
 const b={txid:'tx1',valor_centavos:10000};const pix={endToEndId:'E000000000000000001',valor:'100.00'};
 const cob={txid:'tx1',status:'CONCLUIDA',valor:{original:'100.00'},pix:[pix]};
 assert.equal(gotIncoming(cob,b),pix.endToEndId);
 assert.equal(gotIncoming({...cob,status:'ATIVA'},b),null);
 assert.equal(gotIncoming({...cob,pix:[{...pix,devolucoes:[{status:'EM_PROCESSAMENTO'}]}]},b),null);
 assert.equal(gotIncoming({...cob,pix:[{...pix,valor:'99.99'}]},b),null);
 assert.equal(gotIncoming({...cob,pix:[{...pix,valor:'50.00'},{...pix,valor:'50.00'}]},b),null);
});
test('repasse exige idEnvio, chave, valor, liquidação e ausência de devolução',async()=>{
 const {sentVerified}=await import('../supabase/functions/quemfaz-livre-pix/provas.mjs');
 const b={id_envio:'fixed-id',repasse_centavos:8700,chave_pix:'pro@example.com'};
 const p={status:'REALIZADO',idEnvio:b.id_envio,valor:'87.00',favorecido:{chave:b.chave_pix},endToEndId:'E000000000000000002'};
 assert.equal(sentVerified(p,b),true);
 for(const change of [{idEnvio:'other'},{valor:'86.99'},{status:'EM_PROCESSAMENTO'},{favorecido:{chave:'other@example.com'}},{devolucoes:[{valor:'87.00'}]}])assert.equal(sentVerified({...p,...change},b),false);
});
