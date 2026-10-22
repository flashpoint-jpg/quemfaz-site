import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import forge from "npm:node-forge@1.3.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EFI_CLIENT_ID = Deno.env.get("EFI_CLIENT_ID") || "";
const EFI_CLIENT_SECRET = Deno.env.get("EFI_CLIENT_SECRET") || "";
const EFI_CERT_P12 = Deno.env.get("EFI_CERT_P12_PROD_BASE64") || "";
const EFI_PIX_KEY = Deno.env.get("EFI_PIX_KEY") || "";
const EFI_SANDBOX = (Deno.env.get("EFI_SANDBOX") || "false").toLowerCase() === "true";
const EFI_PIX_BASE = EFI_SANDBOX ? "https://pix-h.api.efipay.com.br" : "https://pix.api.efipay.com.br";
const EFI_CHARGE_BASE = EFI_SANDBOX ? "https://cobrancas-h.api.efipay.com.br" : "https://cobrancas.api.efipay.com.br";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession:false, autoRefreshToken:false } });

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json"
};

function json(data:unknown,status=200){ return new Response(JSON.stringify(data),{status,headers:cors}); }

function p12ToPem(base64:string){
  const der = forge.util.decode64(base64.replace(/\s+/g,""));
  const asn1 = forge.asn1.fromDer(der);
  let p12:any = null;
  let last:any = null;
  for(const password of ["", undefined as any]){
    try { p12 = forge.pkcs12.pkcs12FromAsn1(asn1,false,password); break; }
    catch(e){ last=e; }
  }
  if(!p12) throw last || new Error("p12_parse_failed");
  const certOid = forge.pki.oids.certBag;
  const shroudedOid = forge.pki.oids.pkcs8ShroudedKeyBag;
  const keyOid = forge.pki.oids.keyBag;
  const certs = p12.getBags({bagType:certOid})[certOid] || [];
  const shrouded = p12.getBags({bagType:shroudedOid})[shroudedOid] || [];
  const plain = p12.getBags({bagType:keyOid})[keyOid] || [];
  const certBag = certs.find((b:any)=>b.cert) || certs[0];
  const keyBag = shrouded.find((b:any)=>b.key) || plain.find((b:any)=>b.key) || shrouded[0] || plain[0];
  if(!certBag?.cert || !keyBag?.key) throw new Error("p12_key_or_cert_missing");
  return {cert:forge.pki.certificateToPem(certBag.cert),key:forge.pki.privateKeyToPem(keyBag.key)};
}

function pixClient(){
  if(!EFI_CERT_P12) throw new Error("efi_certificate_not_configured");
  const pem = p12ToPem(EFI_CERT_P12);
  return Deno.createHttpClient({cert:pem.cert,key:pem.key});
}

async function pixToken(client:Deno.HttpClient){
  if(!EFI_CLIENT_ID || !EFI_CLIENT_SECRET || !EFI_PIX_KEY) throw new Error("efi_pix_not_configured");
  const r = await fetch(EFI_PIX_BASE + "/oauth/token", {
    method:"POST", client,
    headers:{
      "Authorization":"Basic " + btoa(EFI_CLIENT_ID + ":" + EFI_CLIENT_SECRET),
      "Content-Type":"application/json"
    },
    body:JSON.stringify({grant_type:"client_credentials"})
  });
  const d = await r.json().catch(()=>({}));
  if(!r.ok || !d.access_token) throw new Error("efi_pix_auth_failed");
  return String(d.access_token);
}

async function getUser(req:Request){
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i,"");
  if(!token) return null;
  const {data,error} = await admin.auth.getUser(token);
  if(error || !data.user) return null;
  return data.user;
}

async function legacyChargeToken(){
  const r = await fetch(EFI_CHARGE_BASE + "/v1/authorize",{
    method:"POST",
    headers:{"Authorization":"Basic " + btoa(EFI_CLIENT_ID + ":" + EFI_CLIENT_SECRET),"Content-Type":"application/json"},
    body:JSON.stringify({grant_type:"client_credentials"})
  });
  const d = await r.json().catch(()=>({}));
  if(!r.ok || !d.access_token) throw new Error("efi_charge_auth_failed");
  return String(d.access_token);
}

async function makePix(pay:any,tipo:string,pagamentoId:string){
  const client = pixClient();
  try{
    const token = await pixToken(client);
    const txid = pagamentoId.replace(/-/g,"").slice(0,35);
    const value = (Number(pay.valor_centavos)/100).toFixed(2);
    const payload:any = {
      calendario:{expiracao:86400},
      valor:{original:value},
      chave:EFI_PIX_KEY,
      solicitacaoPagador:tipo === "prioridade" ? "Prioridade de chamado no QuemFaz" : (tipo === "anuncio" ? "Anúncio no QuemFaz" : "Recarga de carteira no QuemFaz"),
      infoAdicionais:[{nome:"QuemFaz",valor:"qf:" + tipo + ":" + pagamentoId}]
    };

    let r = await fetch(EFI_PIX_BASE + "/v2/cob/" + encodeURIComponent(txid),{
      method:"PUT",client,
      headers:{"Authorization":"Bearer " + token,"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    let cob = await r.json().catch(()=>({}));

    if(!r.ok){
      // Cobrança já existe (cliente voltou para pagar): busca a mesma cobrança e devolve o mesmo QR.
      const getR = await fetch(EFI_PIX_BASE + "/v2/cob/" + encodeURIComponent(txid),{
        method:"GET",client,
        headers:{"Authorization":"Bearer " + token,"Content-Type":"application/json"}
      });
      if(!getR.ok) throw new Error("efi_pix_charge_failed");
      cob = await getR.json().catch(()=>({}));
    }

    if(String(cob?.status || "").toUpperCase()==="CONCLUIDA"){
      return {txid,status:"aprovado",checkoutUrl:null,pixCopyPaste:cob?.pixCopiaECola || null,qrImage:null};
    }

    const locId = cob?.loc?.id;
    if(!locId) throw new Error("efi_pix_location_missing");
    const qrR = await fetch(EFI_PIX_BASE + "/v2/loc/" + encodeURIComponent(String(locId)) + "/qrcode",{
      method:"GET",client,
      headers:{"Authorization":"Bearer " + token,"Content-Type":"application/json"}
    });
    const qr = await qrR.json().catch(()=>({}));
    if(!qrR.ok || !(qr?.qrcode || qr?.linkVisualizacao)) throw new Error("efi_pix_qrcode_failed");

    return {
      txid,status:"pendente",
      checkoutUrl:qr?.linkVisualizacao ? String(qr.linkVisualizacao) : null,
      pixCopyPaste:qr?.qrcode ? String(qr.qrcode) : (cob?.pixCopiaECola ? String(cob.pixCopiaECola) : null),
      qrImage:qr?.imagemQrcode ? String(qr.imagemQrcode) : null
    };
  } finally { client.close(); }
}

Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({ok:false,error:"method_not_allowed"},405);

  const user = await getUser(req);
  if(!user) return json({ok:false,error:"unauthorized"},401);

  const body = await req.json().catch(()=>({}));
  const tipo = String(body.tipo || "");
  const pagamentoId = String(body.pagamento_id || "");
  if(!["prioridade","recarga","anuncio"].includes(tipo) || !pagamentoId) return json({ok:false,error:"invalid_request"},400);

  let table = "";
  let pay:any = null;

  if(tipo === "anuncio"){
    table = "qf_anuncio_pagamentos";
    const q = await admin.from(table)
      .select("id,anuncio_id,valor_centavos,metodo,status,provedor,provedor_id,checkout_url")
      .eq("id",pagamentoId).maybeSingle();
    if(q.error || !q.data) return json({ok:false,error:"payment_not_found"},404);
    pay = q.data;

    const owner = await admin.from("qf_anuncios")
      .select("anunciante_id")
      .eq("id",pay.anuncio_id).maybeSingle();
    if(owner.error || !owner.data) return json({ok:false,error:"ad_not_found"},404);
    if(String(owner.data.anunciante_id)!==user.id) return json({ok:false,error:"forbidden"},403);
  } else {
    table = tipo==="prioridade" ? "qf_prioridade_pagamentos" : "qf_recargas";
    const ownerField = tipo==="prioridade" ? "cliente_id" : "profissional_id";
    const q = await admin.from(table)
      .select("id,valor_centavos,metodo,status,provedor,provedor_id,checkout_url,"+ownerField)
      .eq("id",pagamentoId).maybeSingle();
    if(q.error || !q.data) return json({ok:false,error:"payment_not_found"},404);
    pay = q.data;
    if(String(pay[ownerField])!==user.id) return json({ok:false,error:"forbidden"},403);
  }

  if(pay.status==="aprovado") return json({ok:true,status:"aprovado",checkout_url:pay.checkout_url,charge_id:pay.provedor_id});

  const method = String(pay.metodo || "pix").toLowerCase();

  if(method==="pix"){
    try{
      // V11.80: sempre devolve o QR Code e o copia e cola (mesma cobrança), para o Pix aparecer dentro do QuemFaz.
      const pix = await makePix(pay,tipo,pagamentoId);
      const update:any={provedor:"efi",provedor_id:pix.txid};
      if(pix.checkoutUrl) update.checkout_url=pix.checkoutUrl;
      if(pix.status==="aprovado") update.status="aprovado";
      const {error:updErr}=await admin.from(table).update(update).eq("id",pagamentoId);
      if(updErr) return json({ok:false,error:"db_update_failed"},500);
      return json({
        ok:true,provider:"efi",method:"pix",status:pix.status,
        checkout_url:pix.checkoutUrl,charge_id:pix.txid,
        pix_copy_paste:pix.pixCopyPaste,qr_image:pix.qrImage
      });
    }catch(e){
      if(pay.checkout_url && pay.provedor==="efi" && pay.provedor_id){
        return json({ok:true,provider:"efi",status:pay.status,checkout_url:pay.checkout_url,charge_id:pay.provedor_id});
      }
      return json({ok:false,error:String((e as Error).message || e)},503);
    }
  }

  if(method==="cartao" && body.payment_token){
    try{
      const token=await legacyChargeToken();
      const customer=body.customer||{};
      const clean=(v:any)=>String(v||"").replace(/[^0-9]/g,"");
      const payload:any={
        items:[{name:tipo==="prioridade"?"Prioridade QuemFaz":(tipo==="anuncio"?"Anúncio QuemFaz":"Recarga Carteira QuemFaz"),value:Number(pay.valor_centavos),amount:1}],
        metadata:{custom_id:("qf_"+tipo+"_"+pagamentoId).replace(/[^a-zA-Z0-9_-]/g,"_")},
        payment:{credit_card:{
          customer:{
            name:String(customer.name||"").trim(),
            cpf:clean(customer.cpf),
            email:String(customer.email||"").trim(),
            phone_number:clean(customer.phone_number)
          },
          installments:Math.max(1,Math.min(12,Number(body.installments||1))),
          payment_token:String(body.payment_token),
          message:tipo==="prioridade"?"Prioridade de chamado no QuemFaz":(tipo==="anuncio"?"Anúncio no QuemFaz":"Recarga de carteira no QuemFaz")
        }}
      };
      const resp=await fetch(EFI_CHARGE_BASE+"/v1/charge/one-step",{
        method:"POST",
        headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
        body:JSON.stringify(payload)
      });
      const data=await resp.json().catch(()=>({}));
      if(!resp.ok || !data?.data?.charge_id){
        console.warn("QF_EFI_CARD_TRANSPARENT_FAILED",JSON.stringify({status:resp.status,code:data?.code||data?.error||null,message:data?.message||data?.error_description||null}));
        return json({ok:false,error:"efi_card_charge_failed"},400);
      }
      const providerStatus=String(data.data.status||"").toLowerCase();
      const localStatus=providerStatus==="approved"?"aprovado":(providerStatus==="unpaid"?"cancelado":"pendente");
      const {error:updErr}=await admin.from(table).update({
        status:localStatus,provedor:"efi",provedor_id:String(data.data.charge_id),checkout_url:null
      }).eq("id",pagamentoId);
      if(updErr) return json({ok:false,error:"db_update_failed"},500);
      return json({ok:true,provider:"efi",method:"cartao",status:localStatus,provider_status:providerStatus,charge_id:String(data.data.charge_id),refusal:data?.data?.refusal?.reason||null});
    }catch(e){
      console.warn("QF_EFI_CARD_TRANSPARENT_EXCEPTION",String((e as Error).message||e));
      return json({ok:false,error:"efi_card_charge_failed"},503);
    }
  }

  // Mantém o fluxo por link como fallback para cartão/boleto.
  try{
    const token=await legacyChargeToken();
    const paymentMethod=method==="cartao" ? "credit_card" : "banking_billet";
    const customId=("qf_"+tipo+"_"+pagamentoId).replace(/[^a-zA-Z0-9_-]/g,"_");
    const notificationUrl=SUPABASE_URL+"/functions/v1/quemfaz-efi-notification";
    const payload:any={
      items:[{name:tipo==="prioridade"?"Prioridade QuemFaz":(tipo==="anuncio"?"Anúncio QuemFaz":"Recarga Carteira QuemFaz"),value:Number(pay.valor_centavos),amount:1}],
      metadata:{custom_id:customId,notification_url:notificationUrl},
      settings:{payment_method:paymentMethod,expire_at:new Date(Date.now()+259200000).toISOString().slice(0,10),request_delivery_address:false,message:tipo==="prioridade"?"Prioridade de chamado no QuemFaz":(tipo==="anuncio"?"Anúncio no QuemFaz":"Recarga de carteira no QuemFaz")}
    };
    if(user.email) payload.customer={email:user.email};

    const resp=await fetch(EFI_CHARGE_BASE+"/v1/charge/one-step/link",{
      method:"POST",
      headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    const data=await resp.json().catch(()=>({}));
    if(!resp.ok || !data?.data?.payment_url || !data?.data?.charge_id) {
      console.warn("QF_EFI_CHARGE_FAILED", JSON.stringify({
        status: resp.status,
        code: data?.code || data?.error || null,
        message: data?.message || data?.error_description || data?.data?.message || null,
        errors: data?.errors || data?.data?.errors || null,
        method: paymentMethod
      }));
      return json({ok:false,error:"efi_charge_failed"},400);
    }
    const chargeId=String(data.data.charge_id), checkoutUrl=String(data.data.payment_url);
    const {error:updErr}=await admin.from(table).update({provedor:"efi",provedor_id:chargeId,checkout_url:checkoutUrl}).eq("id",pagamentoId);
    if(updErr) return json({ok:false,error:"db_update_failed"},500);
    return json({ok:true,provider:"efi",status:"pendente",checkout_url:checkoutUrl,charge_id:chargeId});
  }catch(e){
    return json({ok:false,error:String((e as Error).message || e)},503);
  }
});
