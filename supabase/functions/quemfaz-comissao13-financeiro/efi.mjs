// Efí: valores fixos em centavos preservam exatamente a divisão 13%/87%.
export function centavos(v){
 if(typeof v!=='string'||!/^\d+\.\d{2}$/.test(v))throw Error('valor_invalido');
 const [a,b]=v.split('.');const n=Number(a)*100+Number(b);if(!Number.isSafeInteger(n))throw Error('valor_invalido');return n;
}
export function reais(n){if(!Number.isSafeInteger(Number(n))||Number(n)<0)throw Error('valor_invalido');return (Number(n)/100).toFixed(2);}
export function splitPix(f){
 const r=f.recebedor,doc=String(r.documento||'');if(!/^\d{11}(\d{3})?$/.test(doc)||!/^\d+$/.test(r.conta_efi))throw Error('recebedor_invalido');
 return {descricao:'Quem Faz '+f.acordo_id,lancamento:{imediato:true},split:{divisaoTarifa:'assumir_total',minhaParte:{tipo:'fixo',valor:reais(f.comissao_centavos)},repasses:[{tipo:'fixo',valor:reais(f.profissional_centavos),favorecido:{[doc.length===11?'cpf':'cnpj']:doc,conta:r.conta_efi}}]}};
}
export function linkCartao(f,callback){
 if(!String(callback).startsWith('https://'))throw Error('callback_invalido');
 return {items:[{name:'Serviço Quem Faz '+f.acordo_id,value:Number(f.valor_centavos),amount:1,marketplace:{mode:1,repasses:[{payee_code:f.recebedor.payee_code,fixed:Number(f.profissional_centavos)}]}}],metadata:{custom_id:'qf13_'+f.financeiro_id,notification_url:callback},settings:{payment_method:'credit_card',request_delivery_address:false,message:'Pagamento do serviço confirmado pelo cliente no Quem Faz'}};
}
export async function emitirPix(f,chave,request){
 await request('PUT','/v2/gn/split/config/'+encodeURIComponent(f.split_id),splitPix(f));
 const cob=await request('PUT','/v2/cob/'+encodeURIComponent(f.txid),{calendario:{expiracao:86400},valor:{original:reais(f.valor_centavos)},chave,solicitacaoPagador:'Serviço Quem Faz '+f.acordo_id});
 // Se a vinculação falhar, o QR não sai do servidor.
 await request('PUT','/v2/gn/split/cob/'+encodeURIComponent(f.txid)+'/vinculo/'+encodeURIComponent(f.split_id));
 if(!cob.pixCopiaECola)throw Error('qr_nao_retornado');return {provedor_id:f.txid,pix_copia_cola:cob.pixCopiaECola};
}
export function verificarPix(f,d){
 if(d.txid!==f.txid||d.config?.id!==f.split_id||centavos(d.valor?.original)!==Number(f.valor_centavos))throw Error('cobranca_incompativel');
 if(d.status!=='CONCLUIDA')return {confirmado:false};
 const pix=Array.isArray(d.pix)?d.pix:[d.pix].filter(Boolean);
 if(!pix.length||pix.some(p=>p.txid!==f.txid||!p.endToEndId)||pix.reduce((n,p)=>n+centavos(p.valor),0)!==Number(f.valor_centavos))throw Error('pagamento_incompativel');
 const devolvido=pix.flatMap(p=>Array.isArray(p.devolucoes)?p.devolucoes:[p.devolucoes].filter(Boolean)).filter(x=>x.status==='DEVOLVIDO').reduce((n,p)=>n+centavos(p.valor),0);
 const reps=Array.isArray(d.split?.repasses)?d.split.repasses:[d.split?.repasses].filter(Boolean);
 const rep=reps.find(x=>String(x.conta)===String(f.recebedor.conta_efi));
 const taxa=Number(d.split?.minhaParte?.valorTarifa);
 return {confirmado:true,event_id:'pix:'+pix.map(p=>p.endToEndId).sort().join(':')+':'+devolvido,tipo:devolvido>=Number(f.valor_centavos)?'estornado':(devolvido>0?'disputa':'pago'),estornado_centavos:devolvido,taxa_centavos:Number.isSafeInteger(taxa)&&taxa>=0?taxa:null,repasse_confirmado:!devolvido&&!!rep&&Number(rep.valor)===Number(f.profissional_centavos)&&Number.isFinite(Date.parse(rep.dataEfetivacao))};
}
export function verificarCartao(f,d){
 const c=d.data||d;
 if(String(c.charge_id)!==String(f.provedor_id)||c.custom_id!=='qf13_'+f.financeiro_id||Number(c.total)!==Number(f.valor_centavos))throw Error('cobranca_incompativel');
 const mapa={paid:'pago',refunded:'disputa',chargeback:'chargeback',contested:'disputa'};
 // "approved" é autorização; não é liquidação nem confirmação de repasse.
 return {confirmado:!!mapa[c.status],tipo:mapa[c.status]||null,event_id:'card:'+c.charge_id+':'+c.status,repasse_confirmado:false,taxa_centavos:null};
}
export async function segredoConfere(a,b,cryptoApi=globalThis.crypto){
 const enc=new TextEncoder();if(typeof a!=='string'||typeof b!=='string'||b.length<32)return false;
 const x=new Uint8Array(await cryptoApi.subtle.digest('SHA-256',enc.encode(a))),y=new Uint8Array(await cryptoApi.subtle.digest('SHA-256',enc.encode(b)));
 let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
