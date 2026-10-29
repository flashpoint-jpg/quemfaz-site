// Compartilhado com o conciliador Efí existente. Somente consulta cobranças já consentidas.
export async function syncMarketingDedicado(admin:any,client:any,endpoint:string,access:string){
 const result={conferidos:0,conciliados:0,ignorados:0};
 const {data:rows,error}=await admin.rpc('qf_md_pagamentos_pendentes');
 if(error)throw Error('marketing_consulta_indisponivel');
 for(const p of rows||[]){
  try{
   const response=await fetch(endpoint+'/v2/cob/'+encodeURIComponent(p.txid),{method:'GET',client,headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});
   const cob=await response.json();result.conferidos++;
   if(!response.ok||cob.txid!==p.txid||Math.round(Number(cob.valor?.original)*100)!==p.valor_centavos){result.ignorados++;continue;}
   if(cob.status!=='CONCLUIDA')continue;
   const pix=Array.isArray(cob.pix)?cob.pix:[];
   if(!pix.length||pix.some((x:any)=>String(x.endToEndId||'').length<16)||Math.round(pix.reduce((sum:number,x:any)=>sum+Number(x.valor||0),0)*100)!==p.valor_centavos){result.ignorados++;continue;}
   const {data,error}=await admin.rpc('qf_md_pagamento_liquidar',{p_id:p.id,p_txid:p.txid,p_e2e:pix.map((x:any)=>String(x.endToEndId)).sort().join(','),p_valor:p.valor_centavos});
   if(error||!data?.ok){result.ignorados++;continue;}
   if(!data.duplicado)result.conciliados++;
  }catch(_){result.ignorados++;}
 }
 return result;
}
