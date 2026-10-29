import {createClient} from "npm:@supabase/supabase-js@2.58.0";
import forge from "npm:node-forge@1.3.1";

// Marketing Dedicado: cobrança conciliada no banco e prioridade no próprio Quem Faz.
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
// Reutiliza as credenciais Efí existentes. Nunca gera cobrança em abertura de tela.
async function professional(req:Request){
 const bearer=String(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
 if(!bearer)return null;const r=await admin.auth.getUser(bearer);return r.error?null:r.data.user?.id;
}
async function payment(req:Request,b:any,pro:string){
 if(!uid.test(String(b.campanha_id||''))||(b.action==='checkout'&&![55000,58990].includes(b.confirmar_preco)))
 return reply(req,{ok:false,reason:'confirme_o_preco'},400);
 const p=await rpc(b.action==='status'?'qf_md_pagamento_consultar':'qf_md_pagamento_preparar',b.action==='status'?{p_prof:pro,p_campanha:b.campanha_id}:{p_prof:pro,p_campanha:b.campanha_id,p_valor:b.confirmar_preco});
 if(!p?.ok)return reply(req,p||{ok:false},409);
 if(['conciliado','em_analise'].includes(p.status))return reply(req,p);
 let connection:Deno.HttpClient|null=null;
 try{
  connection=client();const t=await token(connection);
  let cob=await efi(connection,t,'GET','/v2/cob/'+encodeURIComponent(p.txid));
  if(!cob.ok&&cob.status===404&&b.action==='checkout')cob=await efi(connection,t,'PUT','/v2/cob/'+encodeURIComponent(p.txid),{
   calendario:{expiracao:86400},valor:{original:money(p.valor_centavos)},chave:pixKey,
   solicitacaoPagador:p.valor_centavos===58990?'Quem Faz Livre + Marketing Dedicado':'Marketing Dedicado Quem Faz'
  });
  if(!cob.ok||cob.data.txid!==p.txid||Math.round(Number(cob.data.valor?.original)*100)!==p.valor_centavos)
   throw Error('cobranca_incompativel');
  if(cob.data.status==='CONCLUIDA'){
   const pix=Array.isArray(cob.data.pix)?cob.data.pix:[];
   if(!pix.length||pix.some((x:any)=>String(x.endToEndId||'').length<16)||Math.round(pix.reduce((sum:number,x:any)=>sum+Number(x.valor||0),0)*100)!==p.valor_centavos)
    throw Error('liquidacao_incompativel');
   const r=await rpc('qf_md_pagamento_liquidar',{p_id:p.id,p_txid:p.txid,p_e2e:pix.map((x:any)=>String(x.endToEndId)).sort().join(','),p_valor:p.valor_centavos});
   return reply(req,r,r?.ok?200:409);
  }
  if(b.action==='status')return reply(req,{ok:true,status:p.status,valor_centavos:p.valor_centavos});
  if(cob.data.status!=='ATIVA'||!cob.data.loc?.id)throw Error('cobranca_nao_ativa');
  const qr=await efi(connection,t,'GET','/v2/loc/'+encodeURIComponent(cob.data.loc.id)+'/qrcode');
  if(!qr.ok||!qr.data?.qrcode)throw Error('qr_indisponivel');
  const r=await rpc('qf_md_pagamento_registrar',{p_id:p.id,p_txid:p.txid,p_pix:String(qr.data.qrcode)});
  if(!r?.ok)throw Error('registro_indisponivel');
  return reply(req,{ok:true,status:'pix_pronto',valor_centavos:p.valor_centavos,pix_copy_paste:qr.data.qrcode,qr_image:qr.data.imagemQrcode||null});
 }catch(_){return reply(req,{ok:false,reason:'banco_nao_confirmou'},503);}
 finally{connection?.close();}
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...Object.fromEntries(reply(req,{}).headers),
 'Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type'}});
 if(req.method!=='POST')return reply(req,{ok:false},405);
 try{
  const pro=await professional(req);if(!pro)return reply(req,{ok:false,reason:'autenticacao_obrigatoria'},401);
  const b=await req.json().catch(()=>({}));
  if(b.action==='diagnostico'){
   const r=await admin.from('qf_admins').select('user_id').eq('user_id',pro).maybeSingle();
   if(r.error||!r.data)return reply(req,{ok:false,reason:'admin_obrigatorio'},403);
   return reply(req,{ok:true,efi_ambiente:sandbox?'sandbox':'production',
    gestao_anuncios:'manual',venda_liberada:true,
    bloqueio:'Prioridade por pagamento confirmado nos pedidos compatíveis. Campanhas criadas manualmente pelo Quem Faz; sem integração Meta.'});
  }
  if(!['checkout','status'].includes(b.action))return reply(req,{ok:false,reason:'acao_invalida'},400);
  return await payment(req,b,pro);
 }catch(_){return reply(req,{ok:false,reason:'operacao_indisponivel'},503);}
});
