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

async function rpc(name: string, args: Record<string, unknown>) {
  const result = await admin.rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function cepInfo(cep: string) {
  const providers = [
    ["https://viacep.com.br/ws/" + cep + "/json/", "localidade", "uf", "bairro"],
    ["https://brasilapi.com.br/api/cep/v1/" + cep, "city", "state", "neighborhood"],
  ];
  for (const [url, cityKey, stateKey, districtKey] of providers) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
      if (!response.ok) continue;
      const data = await response.json();
      if (data[cityKey] && data[stateKey]) {
        return { city: String(data[cityKey]), state: String(data[stateKey]).toUpperCase(),
          district: String(data[districtKey] || "") };
      }
    } catch (_) { /* Tenta a outra fonte. */ }
  }
  throw new Error("Não foi possível confirmar o CEP. Verifique os números e tente novamente.");
}

async function checkout(userId: string, id: string, create: boolean) {
  if (EFI_SANDBOX) throw new Error("Pix de produção indisponível");
  const reservation = await rpc("qf_plantao_pix_reservar", {
    p_cliente:userId, p_id:id, p_criar:create,
  });
  if (!["pix","reembolso_pendente"].includes(reservation.estado)) return { estado:reservation.estado };
  const txid=id.replaceAll("-","");
  const expiry=Date.parse(reservation.prazo_pix);
  const http=pixClient();
  try {
    const token=await pixToken(http);
    const headers={Authorization:"Bearer "+token,"Content-Type":"application/json"};
    if(reservation.estado==="reembolso_pendente"){
      const e2e=String(reservation.e2e);
      const refund=EFI_PIX_BASE+"/v2/pix/"+encodeURIComponent(e2e)+"/devolucao/"+txid;
      let result=await fetch(refund,{method:"GET",client:http,headers,signal:AbortSignal.timeout(12000)});
      if(result.status===404)result=await fetch(refund,{
        method:"PUT",client:http,headers,signal:AbortSignal.timeout(12000),body:JSON.stringify({valor:"20.00"}),
      });
      if(!result.ok)throw new Error("Devolução Pix em conferência.");
      const receipt=await result.json();
      if(receipt.status==="DEVOLVIDO"&&Math.round(Number(receipt.valor)*100)===2000){
        await rpc("qf_plantao_reembolso_confirmar",{p_id:id,p_e2e:e2e});
        return {estado:"reembolsado"};
      }
      return {estado:"reembolso_pendente"};
    }
    const url=EFI_PIX_BASE+"/v2/cob/"+txid;
    const send=(method: string, body?: unknown) => fetch(url, {
      method, client:http, headers, signal:AbortSignal.timeout(12000),
      body:body===undefined ? undefined : JSON.stringify(body),
    });
    let response=await send("GET");
    const remaining=Math.floor((expiry-Date.now())/1000);
    if(response.status===404 && create && remaining>15){
      response=await send("PUT", {
        calendario:{expiracao:remaining},
        valor:{original:"20.00",modalidadeAlteracao:0},chave:EFI_PIX_KEY,
        solicitacaoPagador:"Taxa de urgência 24h - Quem Faz Serviços",
      });
      if(!response.ok)response=await send("GET");
    }
    if(response.status===404 && remaining<=0){
      await rpc("qf_plantao_pix_expirar",{p_cliente:userId,p_id:id});
      return {estado:"sem_atendimento"};
    }
    if(!response.ok)throw new Error("Não conseguimos consultar o Pix agora. Tente novamente.");
    const charge=await response.json();
    if(charge.txid!==txid || Math.round(Number(charge?.valor?.original)*100)!==2000){
      throw new Error("O Pix não corresponde a este chamado.");
    }
    if(charge.status==="CONCLUIDA"){
      const payments=Array.isArray(charge.pix)?charge.pix:[];
      const payment=payments.find((x: {valor?: string})=>Math.round(Number(x.valor)*100)===2000);
      if(!payment)throw new Error("Aguardando confirmação do valor do Pix.");
      const estado=await rpc("qf_plantao_pix_confirmar",{
        p_cliente:userId,p_id:id,p_txid:txid,p_e2e:payment.endToEndId,p_centavos:2000,
        p_recebido_em:payment.horario,
      });
      return {estado};
    }
    if(String(charge.status).startsWith("REMOVIDA") && remaining<=0){
      await rpc("qf_plantao_pix_expirar",{p_cliente:userId,p_id:id});
      return {estado:"sem_atendimento"};
    }
    if(remaining<=0 && charge.status==="ATIVA"){
      // Remover a cobrança impede novo pagamento depois que a reserva expira.
      const remove=await send("PATCH",{status:"REMOVIDA_PELO_USUARIO_RECEBEDOR"});
      if(!remove.ok)throw new Error("Estamos conferindo o Pix. Atualize em instantes.");
      await rpc("qf_plantao_pix_expirar",{p_cliente:userId,p_id:id});
      return {estado:"sem_atendimento"};
    }
    return {estado:"pix",prazo:reservation.prazo_pix,pix:charge.pixCopiaECola};
  }finally{http.close();}
}

Deno.serve(async (req: Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Método não permitido."},405);
  try{
    const body=await req.json();
    if(body.action==="reconciliar"){
      const secret=req.headers.get("x-qf-internal")||"";
      if(secret.length<32||await rpc("qf_push_internal_ok",{p_segredo:secret})!==true)return json({error:"Acesso restrito."},401);
      const items=await rpc("qf_plantao_reconciliar_lista",{});
      for(let index=0;index<items.length;index+=5){
        const results=await Promise.allSettled(items.slice(index,index+5).map((item:{cliente_id:string,id:string})=>checkout(item.cliente_id,item.id,false)));
        for(const r of results)if(r.status==="rejected")console.error("plantao_reconciliar",String(r.reason));
      }
      return json({ok:true});
    }
    const user=await getUser(req);
    if(!user)return json({error:"Entre na sua conta para continuar."},401);
    if(body.action==="criar"){
      const cep=String(body.cep??"").replace(/\D/g,"");
      const description=String(body.descricao??"").trim();
      const address=String(body.endereco??"").trim();
      if(!/^\d{8}$/.test(cep)||description.length<8||description.length>500||address.length<5||address.length>300){
        return json({error:"Confira o CEP, o endereço e a descrição do serviço."},400);
      }
      const geo=await cepInfo(cep);
      const district=geo.district||String(body.bairro??"").trim();
      if(!district||district.length>100)return json({error:"Informe o bairro do atendimento."},400);
      const id=await rpc("qf_plantao_criar",{
        p_cliente:user.id,p_categoria:String(body.categoria??""),p_descricao:description,
        p_cep:cep,p_cidade:geo.city,p_uf:geo.state,p_bairro:district,p_endereco:address,
      });
      return json({id});
    }
    const id=String(body.id??"");
    if(["pix","consultar"].includes(body.action)&&/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)){
      return json(await checkout(user.id,id,body.action==="pix"));
    }
    return json({error:"Operação inválida."},400);
  }catch(error){
    const message=(error as Error).message;
    if(/^(Remova|Você já|Conta de cliente|Não foi possível confirmar o CEP|Prazo da oferta)/.test(message)){
      return json({error:message},409);
    }
    console.error("plantao_request_failed",message);
    return json({error:"Não foi possível concluir agora. Tente novamente em instantes."},503);
  }
});
