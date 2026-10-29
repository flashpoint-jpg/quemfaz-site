import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";
import forge from "npm:node-forge@1.3.1";

// Quem Faz Livre: cliente paga o valor INTEGRAL por Pix ao Quem Faz.
// O banco NÃO faz split; o administrador repassa manualmente 87% após conciliar o recebimento.
const projectUrl=Deno.env.get("SUPABASE_URL")||"";
const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const efiId=Deno.env.get("EFI_CLIENT_ID")||"";
const efiSecret=Deno.env.get("EFI_CLIENT_SECRET")||"";
const certificate=Deno.env.get("EFI_CERT_P12_PROD_BASE64")||"";
const pixKey=Deno.env.get("EFI_PIX_KEY")||"";
const sandbox=(Deno.env.get("EFI_SANDBOX")||"false").toLowerCase()==="true";
const endpoint=sandbox?"https://pix-h.api.efipay.com.br":"https://pix.api.efipay.com.br";
const admin=createClient(projectUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(["https://quemfazservico.com.br","https://www.quemfazservico.com.br","https://quemfaz-site.vercel.app"]);
const uid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ownerSecret=/^[a-f0-9]{64}$/;
const reply=(req:Request,data:unknown,status=200)=>{
 const origin=req.headers.get("Origin")||"";
 return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin",
 ...(origins.has(origin)?{"Access-Control-Allow-Origin":origin}:{})}});
};
async function rpc(name:string,args:Record<string,unknown>={}){
 const {data,error}=await admin.rpc(name,args);
 if(error){console.error("QF_MANUAL_RPC",name,error.code);throw Error("rpc_indisponivel");}
 return data;
}
function client(){
 if(!efiId||!efiSecret||!certificate||!pixKey)throw Error("efi_nao_configurada");
 const binary=forge.util.decode64(certificate.replace(/\s+/g,""));
 const node=forge.asn1.fromDer(binary);
 let pkcs:any=null;
 for(const pass of ["",undefined]){try{pkcs=forge.pkcs12.pkcs12FromAsn1(node,false,pass);break;}catch{}}
 if(!pkcs)throw Error("certificado_invalido");
 const cs=pkcs.getBags({bagType:forge.pki.oids.certBag})[forge.pki.oids.certBag]||[];
 const ks=[...(pkcs.getBags({bagType:forge.pki.oids.pkcs8ShroudedKeyBag})[forge.pki.oids.pkcs8ShroudedKeyBag]||[]),
  ...(pkcs.getBags({bagType:forge.pki.oids.keyBag})[forge.pki.oids.keyBag]||[])];
 const cert=cs.find((a:any)=>a.cert),key=ks.find((a:any)=>a.key);
 if(!cert?.cert||!key?.key)throw Error("certificado_incompleto");
 return Deno.createHttpClient({cert:forge.pki.certificateToPem(cert.cert),key:forge.pki.privateKeyToPem(key.key)});
}
async function token(c:Deno.HttpClient){
 const r=await fetch(endpoint+"/oauth/token",{method:"POST",client:c,headers:{
  Authorization:"Basic "+btoa(efiId+":"+efiSecret),"Content-Type":"application/json"
 },body:JSON.stringify({grant_type:"client_credentials"}),signal:AbortSignal.timeout(16000)});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||!d.access_token)throw Error("efi_autenticacao");
 return String(d.access_token);
}
async function efi(c:Deno.HttpClient,t:string,method:string,path:string,body?:unknown){
 const r=await fetch(endpoint+path,{method,client:c,headers:{Authorization:"Bearer "+t,
 "Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),
 signal:AbortSignal.timeout(17000)});
 const d=await r.json().catch(()=>({}));
 return {ok:r.ok,status:r.status,data:d};
}
const money=(v:number)=>(v/100).toFixed(2);
function paymentValid(bank:any,row:any){
 return bank?.txid===row.txid&&Math.round(Number(bank?.valor?.original||0)*100)===Number(row.valor_centavos);
}
async function syncOne(c:Deno.HttpClient,t:string,paymentId:string){
 const p=await rpc("qf_livre_manual_pix_instrucao",{p_id:paymentId});
 if(!p?.ok)return {ok:false,reason:"pagamento_indisponivel"};
 if(["pago","repassado"].includes(p.status))return {ok:true,status:p.status};
 if(p.status!=="pix_pronto")return {ok:true,status:p.status};
 const r=await efi(c,t,"GET","/v2/cob/"+encodeURIComponent(p.txid));
 if(!r.ok||!paymentValid(r.data,p))return {ok:false,reason:"cobranca_incompativel"};
 if(r.data.status!=="CONCLUIDA")return {ok:true,status:"pix_pronto"};
 const pix=Array.isArray(r.data.pix)?r.data.pix:(r.data.pix?[r.data.pix]:[]);
 if(!pix.length||pix.some((x:any)=>String(x.endToEndId||"").length<16)||
  Math.round(pix.reduce((a:number,x:any)=>a+Number(x.valor||0),0)*100)!==Number(p.valor_centavos))
 return {ok:false,reason:"liquidacao_incompativel"};
 const ref=pix.map((x:any)=>String(x.endToEndId)).sort().join(",");
 const d=await rpc("qf_livre_manual_pix_liquidar",{p_id:p.id,p_txid:p.txid,
  p_e2e:ref,p_valor:Number(p.valor_centavos)});
 return d?.ok?{ok:true,status:d.status}:{ok:false,reason:"confirmacao_rejeitada"};
}
function validOwner(d:any){
 return uid.test(String(d.chamado_id||""))&&uid.test(String(d.fechamento_id||""))&&
  ownerSecret.test(String(d.segredo||""));
}
async function checkout(req:Request,b:any){
 if(!validOwner(b))return reply(req,{ok:false,reason:"dados_invalidos"},400);
 const data=await rpc("qf_livre_manual_pix_preparar",{p_chamado_id:b.chamado_id,
  p_segredo:b.segredo,p_fechamento_id:b.fechamento_id});
 if(!data?.ok)return reply(req,data||{ok:false},409);
 const p=await rpc("qf_livre_manual_pix_instrucao",{p_id:data.id});
 if(!p?.ok||Number(p.valor_centavos)!==Number(data.valor_centavos))
 return reply(req,{ok:false,reason:"cobranca_incompativel"},409);
 if(["pago","repassado"].includes(p.status))return reply(req,{ok:true,status:p.status});
 let c:Deno.HttpClient|null=null;
 try{
  c=client();const t=await token(c);
  let cob=await efi(c,t,"GET","/v2/cob/"+encodeURIComponent(p.txid));
  if(!cob.ok){
   if(cob.status!==404)throw Error("consulta_bancaria_indisponivel");
   cob=await efi(c,t,"PUT","/v2/cob/"+encodeURIComponent(p.txid),{
    calendario:{expiracao:86400},valor:{original:money(Number(p.valor_centavos))},
    chave:pixKey,solicitacaoPagador:"Servico contratado pelo Quem Faz Livre",
    infoAdicionais:[{nome:"Pedido Quem Faz",valor:String(b.chamado_id)}]
   });
  }
  if(!cob.ok||!paymentValid(cob.data,p))throw Error("cobranca_incompativel");
  if(cob.data.status==="CONCLUIDA"){
   const result=await syncOne(c,t,p.id);
   return reply(req,{ok:result.ok,status:result.status,reason:result.reason});
  }
  if(cob.data.status!=="ATIVA"||!cob.data.loc?.id)throw Error("cobranca_nao_ativa");
  const qr=await efi(c,t,"GET","/v2/loc/"+encodeURIComponent(String(cob.data.loc.id))+"/qrcode");
  if(!qr.ok||!qr.data?.qrcode)throw Error("pix_indisponivel");
  const saved=await rpc("qf_livre_manual_pix_marcar_qr",{p_id:p.id,p_txid:p.txid,
   p_pix:String(qr.data.qrcode),p_url:qr.data.linkVisualizacao||null});
  if(!saved?.ok)throw Error("pix_nao_registrado");
  return reply(req,{ok:true,status:"pix_pronto",valor_centavos:p.valor_centavos,
   pix_copia_cola:String(qr.data.qrcode),qr_image:qr.data.imagemQrcode||null});
 }catch(e){
  console.warn("QF_LIVRE_MANUAL_CHECKOUT",String((e as Error).message||e));
  return reply(req,{ok:false,reason:"pagamento_temporariamente_indisponivel"},503);
 }finally{c?.close();}
}
async function status(req:Request,b:any){
 if(!validOwner(b))return reply(req,{ok:false,reason:"dados_invalidos"},400);
 let d=await rpc("qf_livre_manual_pix_estado",{p_chamado_id:b.chamado_id,
 p_segredo:b.segredo,p_fechamento_id:b.fechamento_id});
 if(!d?.ok)return reply(req,d||{ok:false},403);
 if(d.status==="pix_pronto"){
  let c:Deno.HttpClient|null=null;
  try{
   c=client();const t=await token(c);
   const row=await rpc("qf_livre_manual_pix_preparar",{p_chamado_id:b.chamado_id,
    p_segredo:b.segredo,p_fechamento_id:b.fechamento_id});
   if(row?.ok)await syncOne(c,t,row.id);
   d=await rpc("qf_livre_manual_pix_estado",{p_chamado_id:b.chamado_id,
    p_segredo:b.segredo,p_fechamento_id:b.fechamento_id});
  }catch(e){console.warn("QF_LIVRE_MANUAL_STATUS",String((e as Error).message||e));}
  finally{c?.close();}
 }
 return reply(req,d);
}
async function syncAdmin(req:Request){
 const bearer=String(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
 if(!bearer)return reply(req,{ok:false,reason:"autenticacao_obrigatoria"},401);
 const u=await admin.auth.getUser(bearer);
 if(u.error||!u.data.user)return reply(req,{ok:false,reason:"autenticacao_invalida"},401);
 const {data:authorized,error}=await admin.from("qf_admins").select("user_id").eq("user_id",u.data.user.id).maybeSingle();
 if(error||!authorized)return reply(req,{ok:false,reason:"admin_obrigatorio"},403);
 const all=await rpc("qf_livre_manual_pix_pendentes");
 if(!Array.isArray(all)||!all.length)return reply(req,{ok:true,consultados:0,confirmados:0});
 let c:Deno.HttpClient|null=null;
 try{
  c=client();const t=await token(c);
  let paid=0,errors=0;
  for(const p of all.slice(0,30)){
   try{const d=await syncOne(c,t,p.id);if(d.ok&&d.status==="pago")paid++;else if(!d.ok)errors++;}
   catch(e){errors++;console.warn("QF_LIVRE_MANUAL_ITEM",String((e as Error).message||e));}
  }
  return reply(req,{ok:true,consultados:Math.min(all.length,30),confirmados:paid,erros:errors});
 }catch(e){return reply(req,{ok:false,reason:"sincronizacao_indisponivel"},503);}
 finally{c?.close();}
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{
  ...Object.fromEntries(reply(req,{}).headers.entries()),"Access-Control-Allow-Methods":"POST,OPTIONS",
  "Access-Control-Allow-Headers":"apikey,authorization,content-type,x-client-info"}});
 if(req.method!=="POST")return reply(req,{ok:false,reason:"metodo_invalido"},405);
 const origin=req.headers.get("Origin");
 if(origin&&!origins.has(origin))return reply(req,{ok:false,reason:"origem_invalida"},403);
 const b=await req.json().catch(()=>null);
 if(!b||typeof b!=="object")return reply(req,{ok:false,reason:"json_invalido"},400);
 try{
  if(b.action==="checkout")return checkout(req,b);
  if(b.action==="status")return status(req,b);
  if(b.action==="sync_admin")return syncAdmin(req);
  return reply(req,{ok:false,reason:"acao_invalida"},400);
 }catch(e){
  console.error("QF_LIVRE_MANUAL_UNHANDLED",String((e as Error).message||e));
  return reply(req,{ok:false,reason:"indisponivel"},503);
 }
});
