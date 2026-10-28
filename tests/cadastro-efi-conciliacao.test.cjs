// Simulação de conciliação da função Efí REAL do projeto, sem chamadas externas ou cobranças.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {transformSync}=require('esbuild');
const src=fs.readFileSync('supabase/functions/quemfaz-pre-cadastro/index.ts','utf8');
const start=src.indexOf('async function consultar(row: any): Promise<string>');
const end=src.indexOf('function segredoNovo()',start);
assert.ok(start>=0 && end>start,'Extrair a lógica atual de consulta bancária');
const js=transformSync(src.slice(start,end),{loader:'ts',format:'cjs',target:'es2022'}).code;
const pixRow={id:'88888888-8888-8888-8888-888888888888',provedor_id:'tx-fixture-avulso',metodo:'pix',valor_centavos:1300};
const cardRow={id:'99999999-9999-9999-9999-999999999999',provedor_id:'charge-fixture-avulso',metodo:'cartao',valor_centavos:1300};
function consultarFake(data,row,opts={}){
 let fechados=0,chamadas=0;
 const ctx={
  EFI_PIX_BASE:'https://efibank-ficticio.invalid',EFI_CHARGE_BASE:'https://efibank-ficticio.invalid',
  pixClient:()=>({close(){fechados++;}}),
  pixToken:async()=> 'token-ficticio',chargeToken:async()=> 'token-ficticio',
  customId:id=>'qf-fixture-'+id,
  fetch:async()=>{chamadas++;if(opts.throw)throw Error('banco indisponivel');return {ok:opts.httpOk!==false,json:async()=>data};}
 };
 const fn=vm.runInNewContext(js+';consultar',ctx);
 return {response:()=>fn(row),checks:()=>({fechados,chamadas})};
}
test('Pix concluído exato libera; Pix só gerado ou pendente não libera',async()=>{
 for(const [status,expected] of [['ATIVA','pendente'],['CONCLUIDA','aprovado'],['REMOVIDA_PELO_USUARIO_RECEBEDOR','cancelado']]){
  const f=consultarFake({status,valor:{original:'13.00'},pix:[{valor:'13.00'}]},pixRow);
  assert.equal(await f.response(),expected);
  assert.deepEqual(f.checks(),{fechados:1,chamadas:1});
 }
});
test('Valor divergente, recebimento insuficiente ou API indisponível nunca ativam',async()=>{
 const payloads=[
  {status:'CONCLUIDA',valor:{original:'12.00'},pix:[{valor:'13.00'}]},
  {status:'CONCLUIDA',valor:{original:'13.00'},pix:[{valor:'12.99'}]},
  {status:'CONCLUIDA',valor:{original:'13.00'},pix:[]}
 ];
 for(const p of payloads)assert.equal(await consultarFake(p,pixRow).response(),'pendente');
 assert.equal(await consultarFake(payloads[0],pixRow,{httpOk:false}).response(),'pendente');
 const f=consultarFake(null,pixRow,{throw:true});
 await assert.rejects(f.response(),/banco indisponivel/);
 assert.equal(f.checks().fechados,1,'Conexão fechada em falha do banco');
});
test('Cartão só libera quando status, valor e referência exclusiva coincidem',async()=>{
 const good={data:{status:'paid',total:1300,custom_id:'qf-fixture-'+cardRow.id}};
 assert.equal(await consultarFake(good,cardRow).response(),'aprovado');
 for(const d of [
  {data:{status:'unpaid',total:1300,custom_id:good.data.custom_id}},
  {data:{status:'paid',total:1299,custom_id:good.data.custom_id}},
  {data:{status:'paid',total:1300,custom_id:'outro-pedido'}},
  {data:{status:'pending',total:1300,custom_id:good.data.custom_id}}
 ]) assert.notEqual(await consultarFake(d,cardRow).response(),'aprovado');
});
