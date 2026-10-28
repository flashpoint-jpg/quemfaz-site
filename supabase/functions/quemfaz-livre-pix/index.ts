import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";
import forge from "npm:node-forge@1.3.1";

// Repasses pós-serviço do Quem Faz Livre: NÃO é split Pix entre contas.
// Paga o QR do Quem Faz e só depois envia 87% à chave do próprio banco do profissional.
// Modo de produção desligado na configuração do banco até homologação, limites e webhook.
const url=Deno.env.get("SUPABASE_URL")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const efiClient=Deno.env.get("EFI_CLIENT_ID")||"",efiSecret=Deno.env.get("EFI_CLIENT_SECRET")||"";
const certBase64=Deno.env.get("EFI_CERT_P12_PROD_BASE64")||"",senderKey=Deno.env.get("EFI_PIX_KEY")||"";
const sandbox=(Deno.env.get("EFI_SANDBOX")||"false")==="true";
const base=sandbox?"https://pix-h.api.efipay.com.br":"https://pix.api.efipay.com.br";
const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=["https://quemfazservico.com.br","https://www.quemfazservico.com.br","https://quemfaz-site.vercel.app"];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const segredo=/^[a-f0-9]{64}$/;
function response(req:Request,body:unknown,status=200){
 const origin=req.headers.get("origin")||"";
 return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin",
 ...(origins.includes(origin)?{"Access-Control-Allow-Origin":origin}:{})}});
}
function bankClient(){
 if(!efiClient||!efiSecret||!certBase64||!senderKey)throw Error("efi_nao_configurada");
 const der=forge.util.decode64(certBase64.replace(/\s+/g,""));
 const asn=forge.asn1.fromDer(der);
 let pkcs:any;
 for(const pass of ["",undefined]){try{pkcs=forge.pkcs12.pkcs12FromAsn1(asn,false,pass);break;}catch{}}
 if(!pkcs)throw Error("certificado_indisponivel");
 const co=forge.pki.oids.certBag,so=forge.pki.oids.pkcs8ShroudedKeyBag,ko=forge.pki.oids.keyBag;
 const cs=pkcs.getBags({bagType:co})[co]||[],ks=pkcs.getBags({bagType:so})[so]||[],kp=pkcs.getBags({bagType:ko})[ko]||[];
 const c=cs.find((o:any)=>o.cert)||cs[0],k=ks.find((o:any)=>o.key)||kp.find((o:any)=>o.key);
 if(!c?.cert||!k?.key)throw Error("certificado_incompleto");
 return Deno.createHttpClient({cert:forge.pki.certificateToPem(c.cert),key:forge.pki.privateKeyToPem(k.key)});
}
async function access(c:Deno.HttpClient){
 const r=await fetch(base+"/oauth/token",{method:"POST",client:c,
 headers:{"Authorization":"Basic "+btoa(efiClient+":"+efiSecret),"Content-Type":"application/json"},
 body:JSON.stringify({grant_type:"client_credentials"}),signal:AbortSignal.timeout(15000)});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||!j.access_token)throw Error("efi_autenticacao_indisponivel");
 return j.access_token as string;
}
async function api(c:Deno.HttpClient,t:string,verb:string,path:string,body?:unknown){
 const r=await fetch(base+path,{method:verb,client:c,headers:{"Authorization":"Bearer "+t,"Content-Type":"application/json"},
 ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(18000)});
 const j=await r.json().catch(()=>({}));
 return {ok:r.ok,status:r.status,data:j};
}
async function rpc(name:string,args:Record<string,unknown>){
 const {data,error}=await db.rpc(name,args);
 if(error)throw Error("rpc_indisponivel_"+name);
 return data;
}
const cents=(v:unknown)=>Math.round(Number(v||0)*100);
function gotIncoming(cob:any,b:any){
 if(cob?.txid!==b.txid||cents(cob?.valor?.original)!==Number(b.valor_centavos)||cob.status!=="CONCLUIDA")return null;
 const pays=Array.isArray(cob.pix)?cob.pix:[];
 if(!pays.length||cents(pays.reduce((n:number,p:any)=>n+Number(p.valor||0),0))!==Number(b.valor_centavos)
 ||pays.some((p:any)=>!p.endToEndId||String(p.endToEndId).length<16))return null;
 return pays.map((p:any)=>String(p.endToEndId)).sort().join(",");
}
function sentVerified(sent:any,b:any){
 return sent?.status==="REALIZADO"&&sent.idEnvio===b.id_envio&&
  cents(sent.valor)===Number(b.repasse_centavos)&&sent.favorecido?.chave===b.chave_pix&&
  typeof sent.endToEndId==="string"&&sent.endToEndId.length>=16;
}
async function notify(b:any,credit:boolean){
 try{await rpc("qf_livre_pix_avisar",{p_id:b.id,p_creditado:credit});}catch(e){console.warn("notificacao_pendente",String((e as Error).message||e));}
}
async function syncOne(c:Deno.HttpClient,t:string,pid:string,allowSend:boolean){
 const b=await rpc("qf_livre_pix_instrucao",{p_id:pid});
 if(!b?.ok)return {ok:false,reason:b?.reason||"indisponivel"};
 if(b.status==="repassado")return {ok:true,status:"repassado"};
 // Antes de enviar qualquer Pix, a entrada bancária deve estar efetivamente conciliada.
 if(["pix_pronto","pago","envio_solicitado"].includes(b.status)){
  const incoming=await api(c,t,"GET","/v2/cob/"+encodeURIComponent(b.txid));
  if(!incoming.ok)return {ok:false,reason:"cobranca_nao_consultada"};
  const e2e=gotIncoming(incoming.data,b);
  if(!e2e)return {ok:true,status:"aguardando_pagamento"};
  const result=await rpc("qf_livre_pix_confirmar_entrada",{
   p_id:b.id,p_txid:b.txid,p_e2e:e2e,p_valor:b.valor_centavos
  });
  if(!result?.ok)return {ok:false,reason:"entrada_nao_conciliada"};
  if(result.novo)await notify(b,false);
 }
 // SEJA conservador com a transferência: primeiro consulta idEnvio (idempotência fixa).
 if(!allowSend)return {ok:true,status:"pago"};
 const sent=await api(c,t,"GET","/v2/gn/pix/enviados/id-envio/"+encodeURIComponent(b.id_envio));
 if(sent.ok){
  if(sentVerified(sent.data,b)){
   const done=await rpc("qf_livre_pix_confirmar_saida",{
    p_id:b.id,p_id_envio:b.id_envio,p_e2e:sent.data.endToEndId,p_valor:b.repasse_centavos
   });
   if(!done?.ok)return {ok:false,reason:"saida_nao_conciliada"};
   if(done.novo)await notify(b,true);
   return {ok:true,status:"repassado"};
  }
  if(sent.data?.status==="EM_PROCESSAMENTO")return {ok:true,status:"repasse_processando"};
  return {ok:false,reason:"repasse_requer_analise"};
 }
 if(sent.status!==404)return {ok:false,reason:"consulta_envio_indisponivel"};
 // Só envia com a entrada conciliada; passa CPF/CNPJ do titular para recusar chave de terceiro.
 const fav=String(b.documento).length===14?{chave:b.chave_pix,cnpj:b.documento}:{chave:b.chave_pix,cpf:b.documento};
 const payment=await api(c,t,"PUT","/v3/gn/pix/"+encodeURIComponent(b.id_envio),{
  valor:(Number(b.repasse_centavos)/100).toFixed(2),
  pagador:{chave:senderKey,infoPagador:"Repasse de servico Quem Faz Livre"},
  favorecido:fav
 });
 // Falha 5xx é ambígua: nunca cria outro idEnvio; consulta o MESMO no próximo ciclo.
 if(!payment.ok)return {ok:false,reason:"envio_aguardando_verificacao"};
 if(payment.data?.idEnvio!==b.id_envio||cents(payment.data?.valor)!==Number(b.repasse_centavos))
 return {ok:false,reason:"resposta_envio_divergente"};
 return {ok:true,status:"repasse_processando"};
}
async function checkout(req:Request,data:any){
 if(!uuid.test(String(data.chamado_id||""))||!uuid.test(String(data.fechamento_id||""))||!segredo.test(String(data.segredo||"")))
 return response(req,{ok:false,reason:"dados_invalidos"},400);
 const created=await rpc("qf_livre_pix_preparar",{
  p_chamado_id:data.chamado_id,p_segredo:data.segredo,p_fechamento_id:data.fechamento_id});
 if(!created?.ok)return response(req,created,409);
 const b=await rpc("qf_livre_pix_instrucao",{p_id:created.id});
 if(!b?.ok)return response(req,{ok:false,reason:"pagamento_bloqueado"},409);
 if(b.status==="repassado"||b.status==="pago")return response(req,{ok:true,status:b.status,valor_centavos:b.valor_centavos});
 let c:Deno.HttpClient|null=null;
 try{
  c=bankClient();const t=await access(c);
  let cob=await api(c,t,"GET","/v2/cob/"+encodeURIComponent(b.txid));
  if(!cob.ok){
   if(cob.status!==404)throw Error("consulta_cobranca_indisponivel");
   cob=await api(c,t,"PUT","/v2/cob/"+encodeURIComponent(b.txid),{
    calendario:{expiracao:86400},valor:{original:(Number(b.valor_centavos)/100).toFixed(2)},
    chave:senderKey,solicitacaoPagador:"Pagamento de servico apos conclusao - Quem Faz",
    infoAdicionais:[{nome:"Pedido",valor:String(b.chamado_id)}]});
  }
  if(!cob.ok||cob.data?.txid!==b.txid||cents(cob.data?.valor?.original)!==Number(b.valor_centavos))
   throw Error("cobranca_divergente");
  if(cob.data.status==="CONCLUIDA"){
   const result=await syncOne(c,t,b.id,false);
   return response(req,{ok:result.ok,status:result.status,reason:result.reason});
  }
  if(cob.data.status!=="ATIVA"||!cob.data.loc?.id)throw Error("cobranca_nao_ativa");
  const qr=await api(c,t,"GET","/v2/loc/"+encodeURIComponent(String(cob.data.loc.id))+"/qrcode");
  if(!qr.ok||!qr.data?.qrcode)throw Error("qr_indisponivel");
  const saved=await rpc("qf_livre_pix_marcar_qr",{p_id:b.id,p_txid:b.txid,p_codigo:String(qr.data.qrcode)});
  if(!saved?.ok)throw Error("qr_nao_gravado");
  return response(req,{ok:true,status:"pix_pronto",pix_copia_cola:String(qr.data.qrcode),
   valor_centavos:b.valor_centavos,comissao_centavos:b.comissao_centavos,repasse_centavos:b.repasse_centavos});
 }catch(e){
  console.warn("QF_LIVRE_PIX_CHECKOUT",String((e as Error).message||e));
  return response(req,{ok:false,reason:"pix_temporariamente_indisponivel"},503);
 }finally{c?.close();}
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin")||"";
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{
  "Vary":"Origin",...(origins.includes(origin)?{"Access-Control-Allow-Origin":origin}:{}),
  "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods":"POST,OPTIONS"}});
 if(req.method!=="POST")return response(req,{ok:false,reason:"method_not_allowed"},405);
 let body:any={};try{body=await req.json();}catch{return response(req,{ok:false,reason:"invalid_json"},400);}
 if(body.action==="checkout"){
  try{return await checkout(req,body);}catch(e){console.warn("checkout_indisponivel",String((e as Error).message||e));return response(req,{ok:false,reason:"repasse_em_preparacao"},503);}
 }
 if(body.action==="status"){
  if(!uuid.test(String(body.chamado_id||""))||!uuid.test(String(body.fechamento_id||""))||!segredo.test(String(body.segredo||"")))
  return response(req,{ok:false,reason:"dados_invalidos"},400);
  const result=await rpc("qf_livre_pix_estado",{p_chamado_id:body.chamado_id,p_segredo:body.segredo,p_fechamento_id:body.fechamento_id});
  return response(req,result,result?.ok?200:403);
 }
 if(body.action==="sync"){
  const internal=String(req.headers.get("x-qf-internal")||"");
  let authorized=!!service&&req.headers.get("Authorization")==="Bearer "+service;
  if(!authorized&&internal.length>=32){const {data,error}=await db.rpc("qf_push_internal_ok",{p_segredo:internal});authorized=!error&&data===true;}
  if(!authorized)return response(req,{ok:false,reason:"forbidden"},403);
  let c:Deno.HttpClient|null=null;
  try{
   const pending=await rpc("qf_livre_pix_pendentes",{});
   if(!Array.isArray(pending)||!pending.length)return response(req,{ok:true,consultados:0});
   c=bankClient();const t=await access(c);
   let received=0,sent=0,issues=0;
   // Evita esgotamento de saldo e processamento concorrente: uma saída por ciclo.
   let canSend=true;
   for(const row of pending){
    try{
     const r=await syncOne(c,t,row.id,canSend);
     if(!r.ok)issues++;
     else if(r.status==="repassado")sent++;
     else if(r.status==="pago")received++;
     if(r.status==="repasse_processando"){canSend=false;}
    }catch(e){issues++;console.warn("QF_LIVRE_PIX_SYNC",String((e as Error).message||e));}
   }
   return response(req,{ok:true,consultados:pending.length,pagamentos:received,repasses:sent,pendencias:issues});
  }catch(e){return response(req,{ok:false,reason:"consulta_bancaria_indisponivel"},503);}
  finally{c?.close();}
 }
 return response(req,{ok:false,reason:"acao_invalida"},400);
});
