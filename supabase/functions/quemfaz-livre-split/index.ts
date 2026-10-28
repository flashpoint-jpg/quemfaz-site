import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import forge from "npm:node-forge@1.3.1";

/** Pix pós-serviço: split 87/13 entre contas Efí, sempre fail-closed. */
const url=Deno.env.get("SUPABASE_URL")||"";
const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const id=Deno.env.get("EFI_CLIENT_ID")||"";
const secret=Deno.env.get("EFI_CLIENT_SECRET")||"";
const certificate=Deno.env.get("EFI_CERT_P12_PROD_BASE64")||"";
const pixKey=Deno.env.get("EFI_PIX_KEY")||"";
const sandbox=(Deno.env.get("EFI_SANDBOX")||"false").toLowerCase()==="true";
const endpoint=sandbox?"https://pix-h.api.efipay.com.br":"https://pix.api.efipay.com.br";
const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(["https://quemfazservico.com.br","https://www.quemfazservico.com.br","https://quemfaz-site.vercel.app"]);
function cors(request:Request){
 const origin=request.headers.get("origin")||"";
 return {"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin",...(origins.has(origin)?{"Access-Control-Allow-Origin":origin}:{})};
}
function reply(req:Request,body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:cors(req)});}
function p12ToPem(data:string){
 const der=forge.util.decode64(data.replace(/\s+/g,""));
 const asn1=forge.asn1.fromDer(der);
 let pkcs:any=null;
 for(const pass of ["",undefined]){try{pkcs=forge.pkcs12.pkcs12FromAsn1(asn1,false,pass);break;}catch{}}
 if(!pkcs)throw Error("certificado_efi_invalido");
 const co=forge.pki.oids.certBag,so=forge.pki.oids.pkcs8ShroudedKeyBag,ko=forge.pki.oids.keyBag;
 const cs=pkcs.getBags({bagType:co})[co]||[];
 const ks=pkcs.getBags({bagType:so})[so]||[],kp=pkcs.getBags({bagType:ko})[ko]||[];
 const c=cs.find((b:any)=>b.cert)||cs[0],k=ks.find((b:any)=>b.key)||kp.find((b:any)=>b.key);
 if(!c?.cert||!k?.key)throw Error("certificado_efi_incompleto");
 return {cert:forge.pki.certificateToPem(c.cert),key:forge.pki.privateKeyToPem(k.key)};
}
function client(){
 if(!id||!secret||!certificate||!pixKey)throw Error("efi_nao_configurada");
 const p=p12ToPem(certificate);
 return Deno.createHttpClient({cert:p.cert,key:p.key});
}
async function auth(c:Deno.HttpClient){
 const r=await fetch(endpoint+"/oauth/token",{method:"POST",client:c,headers:{"Authorization":"Basic "+btoa(id+":"+secret),"Content-Type":"application/json"},body:JSON.stringify({grant_type:"client_credentials"}),signal:AbortSignal.timeout(15000)});
 const data=await r.json().catch(()=>({}));
 if(!r.ok||!data.access_token)throw Error("efi_autenticacao_indisponivel");
 return String(data.access_token);
}
async function api(c:Deno.HttpClient,token:string,method:string,path:string,body?:unknown){
 const r=await fetch(endpoint+path,{method,client:c,headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
 ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(16000)});
 const data=await r.json().catch(()=>({}));
 return {ok:r.ok,code:r.status,data};
}
async function rpc(name:string,args:Record<string,unknown>){
 const {data,error}=await db.rpc(name,args);
 if(error)throw Error("rpc_"+name);
 return data;
}
const money=(n:number)=>(n/100).toFixed(2);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const secretRegex=/^[a-f0-9]{64}$/;
function validSplit(bank:any,entry:any){
 const attached=bank?.config?.id===entry.split_id&&bank?.txid===entry.txid;
 const sum=Math.round(Number(bank?.valor?.original||0)*100);
 return attached&&sum===Number(entry.valor_centavos);
}
function recipientCredit(bank:any,entry:any){
 const parts=Array.isArray(bank?.split?.repasses)?bank.split.repasses:(bank?.split?.repasses?[bank.split.repasses]:[]);
 return parts.some((x:any)=>String(x?.conta||"")===String(entry.conta_efi)&&
  Number(x?.valor)===Number(entry.profissional_centavos)&&!!x?.dataEfetivacao);
}
function platformCredit(bank:any,entry:any){
 const part=bank?.split?.minhaParte;
 return Number(part?.valor)===Number(entry.plataforma_centavos)&&!!part?.dataEfetivacao;
}
async function syncOne(c:Deno.HttpClient,token:string,paymentId:string){
 const entry=await rpc("qf_livre_split_instrucao",{p_id:paymentId});
 if(!entry?.ok)return {ok:false,reason:entry?.reason||"pagamento_indisponivel"};
 const status=String(entry.status);
 if(status==="repassado")return {ok:true,status};
 if(!["pix_pronto","pago"].includes(status))return {ok:true,status};
 const bank=await api(c,token,"GET","/v2/gn/split/cob/"+encodeURIComponent(entry.txid));
 if(!bank.ok||!validSplit(bank.data,entry))return {ok:false,reason:"split_nao_verificado"};
 if(bank.data.status!=="CONCLUIDA")return {ok:true,status:"aguardando_pagamento"};
 const pays=Array.isArray(bank.data.pix)?bank.data.pix:(bank.data.pix?[bank.data.pix]:[]);
 if(!pays.length||Math.round(pays.reduce((s:number,x:any)=>s+Number(x.valor||0),0)*100)!==Number(entry.valor_centavos)
 ||pays.some((x:any)=>!x.endToEndId||String(x.endToEndId).length<16))
 return {ok:false,reason:"pix_nao_conciliado"};
 const e2e=pays.map((x:any)=>String(x.endToEndId)).sort().join(",");
 const credited=recipientCredit(bank.data,entry)&&platformCredit(bank.data,entry);
 const result=await rpc("qf_livre_split_confirmar_banco",{
  p_id:entry.id,p_txid:entry.txid,p_end_to_end_id:e2e,
  p_valor:entry.valor_centavos,p_split_id:entry.split_id,p_conta_efi:entry.conta_efi,p_repasse_creditado:credited
 });
 if(!result?.ok)return {ok:false,reason:"conciliacao_rejeitada"};
 if(result.notificar){
  // Aviso confiável por evento interno: a falha do push não altera a liquidação.
  try{
   await rpc("qf_livre_split_enfileirar_aviso",{p_id:entry.id,p_creditado:credited});
  }catch(e){console.error("avisar_profissional_falhou",String((e as Error).message||e));}
 }
 return {ok:true,status:result.status};
}
async function checkout(req:Request,body:any){
 if(!UUID.test(String(body.chamado_id||""))||!UUID.test(String(body.fechamento_id||""))||!secretRegex.test(String(body.segredo||"")))
 return reply(req,{ok:false,reason:"dados_invalidos"},400);
 const prepared=await rpc("qf_livre_split_preparar",{
  p_chamado_id:body.chamado_id,p_segredo:body.segredo,p_fechamento_id:body.fechamento_id
 });
 if(!prepared?.ok)return reply(req,prepared,409);
 const entry=await rpc("qf_livre_split_instrucao",{p_id:prepared.id});
 if(!entry?.ok)return reply(req,{ok:false,reason:"pagamento_bloqueado"},409);
 let c:Deno.HttpClient|null=null;
 try{
  c=client();const token=await auth(c);
  if(["pago","repassado"].includes(entry.status)){
   return reply(req,{ok:true,status:entry.status,valor_centavos:entry.valor_centavos});
  }
  let cob=await api(c,token,"GET","/v2/gn/split/cob/"+encodeURIComponent(entry.txid));
  if(cob.ok){
   if(!validSplit(cob.data,entry))throw Error("split_divergente");
  }else{
   // Recebedor é obrigatório ter conta Efí VALIDADA; chave Pix isolada não basta.
   const doc=String(entry.documento);
   const fav=doc.length===14?{cnpj:doc,conta:entry.conta_efi}:{cpf:doc,conta:entry.conta_efi};
   const config={
    descricao:"Quem Faz Livre - pagamento apos servico",
    lancamento:{imediato:true},
    split:{divisaoTarifa:"assumir_total",minhaParte:{tipo:"porcentagem",valor:"13.00"},
     repasses:[{tipo:"porcentagem",valor:"87.00",favorecido:fav}]}
   };
   const cfg=await api(c,token,"PUT","/v2/gn/split/config/"+encodeURIComponent(entry.split_id),config);
   if(!cfg.ok||cfg.data?.id!==entry.split_id)throw Error("split_config_recusada");
   let basic=await api(c,token,"GET","/v2/cob/"+encodeURIComponent(entry.txid));
   if(!basic.ok){
    basic=await api(c,token,"PUT","/v2/cob/"+encodeURIComponent(entry.txid),{
     calendario:{expiracao:86400},valor:{original:money(Number(entry.valor_centavos))},chave:pixKey,
     solicitacaoPagador:"Servico Quem Faz Livre - pagamento apos execucao",
     infoAdicionais:[{nome:"Servico",valor:entry.chamado_id}]});
   }
   if(!basic.ok||basic.data?.status!=="ATIVA"||basic.data?.txid!==entry.txid||
    Math.round(Number(basic.data?.valor?.original||0)*100)!==Number(entry.valor_centavos))throw Error("cobranca_pix_invalida");
   const link=await api(c,token,"PUT","/v2/gn/split/cob/"+encodeURIComponent(entry.txid)+"/vinculo/"+encodeURIComponent(entry.split_id));
   if(!link.ok)throw Error("vinculo_split_falhou");
   cob=await api(c,token,"GET","/v2/gn/split/cob/"+encodeURIComponent(entry.txid));
   if(!cob.ok||!validSplit(cob.data,entry))throw Error("vinculo_nao_verificado");
  }
  if(cob.data.status==="CONCLUIDA"){
   const done=await syncOne(c,token,entry.id);
   return reply(req,{ok:done.ok,status:done.status||"em_conciliacao",reason:done.reason});
  }
  if(cob.data.status!=="ATIVA"||!cob.data?.loc?.id)throw Error("cobranca_nao_ativa");
  const qr=await api(c,token,"GET","/v2/loc/"+encodeURIComponent(String(cob.data.loc.id))+"/qrcode");
  if(!qr.ok||!qr.data?.qrcode)throw Error("pix_indisponivel");
  const saved=await rpc("qf_livre_split_marcar_qr",{p_id:entry.id,p_txid:entry.txid,p_codigo:String(qr.data.qrcode),p_url:qr.data.linkVisualizacao||null});
  if(!saved?.ok)throw Error("qr_nao_registrado");
  return reply(req,{ok:true,status:"pix_pronto",valor_centavos:entry.valor_centavos,
   profissional_centavos:entry.profissional_centavos,plataforma_centavos:entry.plataforma_centavos,
   pix_copia_cola:String(qr.data.qrcode),qr_image:qr.data.imagemQrcode||null});
 }catch(e){
  console.warn("QF_LIVRE_SPLIT_CHECKOUT",String((e as Error).message||e));
  return reply(req,{ok:false,reason:"pagamento_temporariamente_indisponivel"},503);
 }finally{c?.close();}
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{
  ...cors(req),"Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods":"POST,OPTIONS"}});
 if(req.method!=="POST")return reply(req,{ok:false,reason:"metodo_invalido"},405);
 let data:any={};try{data=await req.json();}catch{return reply(req,{ok:false,reason:"json_invalido"},400);}
 if(data.action==="checkout")return checkout(req,data);
 if(data.action==="sync"){
  const secretHeader=String(req.headers.get("x-qf-internal")||"");
  let authorized=!!service&&req.headers.get("Authorization")==="Bearer "+service;
  if(!authorized&&secretHeader.length>=32){
   const {data:verified,error}=await db.rpc("qf_push_internal_ok",{p_segredo:secretHeader});
   authorized=!error&&verified===true;
  }
  if(!authorized)return reply(req,{ok:false,reason:"nao_autorizado"},403);
  const list=await rpc("qf_livre_split_pendentes",{});
  if(!Array.isArray(list)||!list.length)return reply(req,{ok:true,consultados:0});
  let c:Deno.HttpClient|null=null;
  try{
   c=client();const t=await auth(c);let paid=0,repassed=0,errors=0;
   for(const payment of list){
    try{const result=await syncOne(c,t,payment.id);if(!result.ok)errors++;else if(result.status==="repassado")repassed++;else if(result.status==="pago")paid++;}
    catch(e){errors++;console.warn("QF_LIVRE_SPLIT_SYNC_ITEM",String((e as Error).message||e));}
   }
   return reply(req,{ok:true,consultados:list.length,pagos:paid,repassados:repassed,pendentes_revisao:errors});
  }catch(e){return reply(req,{ok:false,reason:"sincronizacao_indisponivel"},503);}
  finally{c?.close();}
 }
 if(data.action==="status"){
  if(!UUID.test(String(data.chamado_id||""))||!UUID.test(String(data.fechamento_id||""))||!secretRegex.test(String(data.segredo||"")))
   return reply(req,{ok:false,reason:"dados_invalidos"},400);
  const state=await rpc("qf_livre_split_estado",{p_chamado_id:data.chamado_id,p_segredo:data.segredo,p_fechamento_id:data.fechamento_id});
  return reply(req,state,state?.ok?200:403);
 }
 return reply(req,{ok:false,reason:"acao_invalida"},400);
});
