import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import forge from "npm:node-forge@1.3.1";

// QuemFaz 11.50 — plano pago ANTES de criar a conta do profissional.
// "criar": gera a cobrança na Efí (Pix ou link de cartão) para quem ainda não tem conta.
// "status": consulta a Efí e diz se o pagamento foi confirmado.
// A conta só é criada pelo app depois do "aprovado"; o plano entra por qf_resgatar_pre_cadastro.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EFI_CLIENT_ID = Deno.env.get("EFI_CLIENT_ID") || "";
const EFI_CLIENT_SECRET = Deno.env.get("EFI_CLIENT_SECRET") || "";
const EFI_CERT_P12 = Deno.env.get("EFI_CERT_P12_PROD_BASE64") || "";
const EFI_PIX_KEY = Deno.env.get("EFI_PIX_KEY") || "";
const EFI_SANDBOX = (Deno.env.get("EFI_SANDBOX") || "false").toLowerCase() === "true";
const EFI_PIX_BASE = EFI_SANDBOX ? "https://pix-h.api.efipay.com.br" : "https://pix.api.efipay.com.br";
const EFI_CHARGE_BASE = EFI_SANDBOX ? "https://cobrancas-h.api.efipay.com.br" : "https://cobrancas.api.efipay.com.br";
const TABLE = "qf_pre_cadastro_pagamentos";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: cors }); }

function p12ToPem(base64: string) {
  const der = forge.util.decode64(base64.replace(/\s+/g, ""));
  const asn1 = forge.asn1.fromDer(der);
  let p12: any = null, last: any = null;
  for (const password of ["", undefined as any]) {
    try { p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password); break; } catch (e) { last = e; }
  }
  if (!p12) throw last || new Error("p12_parse_failed");
  const co = forge.pki.oids.certBag, so = forge.pki.oids.pkcs8ShroudedKeyBag, ko = forge.pki.oids.keyBag;
  const cs = p12.getBags({ bagType: co })[co] || [], ks = p12.getBags({ bagType: so })[so] || [], kp = p12.getBags({ bagType: ko })[ko] || [];
  const c = cs.find((b: any) => b.cert) || cs[0];
  const k = ks.find((b: any) => b.key) || kp.find((b: any) => b.key) || ks[0] || kp[0];
  if (!c?.cert || !k?.key) throw new Error("p12_key_or_cert_missing");
  return { cert: forge.pki.certificateToPem(c.cert), key: forge.pki.privateKeyToPem(k.key) };
}
function pixClient() {
  if (!EFI_CERT_P12) throw new Error("efi_certificate_not_configured");
  const pem = p12ToPem(EFI_CERT_P12);
  return Deno.createHttpClient({ cert: pem.cert, key: pem.key });
}
async function pixToken(client: Deno.HttpClient) {
  if (!EFI_CLIENT_ID || !EFI_CLIENT_SECRET || !EFI_PIX_KEY) throw new Error("efi_pix_not_configured");
  const r = await fetch(EFI_PIX_BASE + "/oauth/token", {
    method: "POST", client,
    headers: { "Authorization": "Basic " + btoa(EFI_CLIENT_ID + ":" + EFI_CLIENT_SECRET), "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("efi_pix_auth_failed");
  return String(d.access_token);
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:cors});
  if (req.method !== "POST") return json({ok:false,error:"method_not_allowed"},405);
  // Recuperação reservada ao administrador autenticado; nunca aceitar papel do navegador.
  const bearer=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if (!bearer) return json({ok:false,error:"admin_obrigatorio"},401);
  const user=await admin.auth.getUser(bearer);
  if(user.error||!user.data?.user) return json({ok:false,error:"admin_obrigatorio"},401);
  const permission=await admin.from("qf_admins").select("user_id").eq("user_id",user.data.user.id).maybeSingle();
  if(permission.error||!permission.data) return json({ok:false,error:"admin_obrigatorio"},403);
  const body=await req.json().catch(()=>({}));
  if(!/^[a-f0-9-]{36}$/i.test(String(body.id||""))) return json({ok:false,error:"dados_invalidos"},400);
  const found=await admin.from(TABLE).select("id,segredo,email,plano,status,valor_centavos,metodo,provedor,provedor_id,profissional_id").eq("id",body.id).maybeSingle();
  const row=found.data;
  if(found.error||!row) return json({ok:false,error:"nao_encontrado"},404);
  if(row.profissional_id) return json({ok:false,error:"cadastro_ja_ativado"},409);
  if(!["pendente","aprovado"].includes(row.status)||row.metodo!=="pix"||row.provedor!=="efi"||!row.provedor_id)
    return json({ok:false,error:"cobranca_nao_recuperavel"},409);
  const result=(status:string,pix="")=>json({ok:true,id:row.id,segredo:row.segredo,email:row.email,
    plano:row.plano,nome_plano:row.plano,valor_centavos:row.valor_centavos,status,pix_copy_paste:pix,recuperado:true});
  if(row.status==="aprovado") return result("aprovado");
  let client:Deno.HttpClient|null=null;
  try {
    client=pixClient();const token=await pixToken(client);
    const headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"};
    const path=EFI_PIX_BASE+"/v2/cob/"+encodeURIComponent(row.provedor_id);
    const response=await fetch(path,{method:"GET",client,headers,signal:AbortSignal.timeout(17000)});
    const cob=await response.json().catch(()=>({}));
    if(!response.ok||cob.txid!==row.provedor_id||Math.round(Number(cob.valor?.original||0)*100)!==Number(row.valor_centavos))
      return json({ok:false,error:"cobranca_incompativel"},409);
    if(cob.status==="CONCLUIDA"){
      const total=Array.isArray(cob.pix)?Math.round(cob.pix.reduce((sum:number,p:any)=>sum+Number(p.valor||0),0)*100):0;
      if(total!==Number(row.valor_centavos)||!cob.pix.every((p:any)=>String(p.endToEndId||"").length>=16))
        return json({ok:false,error:"cobranca_incompativel"},409);
      const saved=await admin.from(TABLE).update({status:"aprovado",aprovado_em:new Date().toISOString()}).eq("id",row.id).eq("status","pendente");
      if(saved.error) throw Error("consulta_indisponivel");
      return result("aprovado");
    }
    if(cob.status!=="ATIVA"||!cob.loc?.id) return json({ok:false,error:"cobranca_nao_recuperavel"},409);
    const created=Date.parse(cob.calendario?.criacao||"");
    const lifetime=Number(cob.calendario?.expiracao);
    if(!Number.isFinite(created)||!Number.isFinite(lifetime)||lifetime<=0) throw Error("calendario_invalido");
    // Renova o prazo DA MESMA cobrança vencida. Não cria outro txid nem outro pagamento.
    if(created+lifetime*1000<=Date.now()){
      const expiration=Math.ceil((Date.now()-created)/1000)+86400;
      const renewal=await fetch(path,{method:"PATCH",client,headers,
        body:JSON.stringify({calendario:{expiracao:expiration}}),signal:AbortSignal.timeout(17000)});
      const revised=await renewal.json().catch(()=>({}));
      if(!renewal.ok||revised.txid!==row.provedor_id||revised.status!=="ATIVA"||
        Math.round(Number(revised.valor?.original||0)*100)!==Number(row.valor_centavos)||
        Date.parse(revised.calendario?.criacao||"")+Number(revised.calendario?.expiracao||0)*1000<=Date.now())
        return json({ok:false,error:"renovacao_indisponivel"},409);
    }
    const qr=await fetch(EFI_PIX_BASE+"/v2/loc/"+encodeURIComponent(String(cob.loc.id))+"/qrcode",
      {method:"GET",client,headers,signal:AbortSignal.timeout(17000)});
    const data=await qr.json().catch(()=>({}));
    if(!qr.ok||!data.qrcode) throw Error("pix_indisponivel");
    return result("pendente",String(data.qrcode));
  }catch(_){return json({ok:false,error:"consulta_indisponivel"},503);}
  finally{client?.close();}
});

