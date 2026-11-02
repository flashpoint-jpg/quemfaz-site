import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import forge from "npm:node-forge@1.3.1";
import {syncMarketingDedicado} from "../_shared/marketing-sync.ts";

// QuemFaz — confirmação de pagamentos da Efí por consulta (roda a cada minuto pelo cron).
// Pix: consulta a cobrança (txid). Cartão e boleto: consulta a cobrança (charge_id) na API de Cobranças.
// Não depende de aviso (webhook) da Efí.
// V6: inclui o plano pago ANTES da conta (qf_pre_cadastro_pagamentos), para o pagamento ser
// confirmado mesmo se o profissional fechar o app antes de pagar.

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EFI_CLIENT_ID=Deno.env.get("EFI_CLIENT_ID")||"";
const EFI_CLIENT_SECRET=Deno.env.get("EFI_CLIENT_SECRET")||"";
const EFI_CERT_P12=Deno.env.get("EFI_CERT_P12_PROD_BASE64")||"";
const EFI_SANDBOX=(Deno.env.get("EFI_SANDBOX")||"false").toLowerCase()==="true";
const EFI_PIX_BASE=EFI_SANDBOX?"https://pix-h.api.efipay.com.br":"https://pix.api.efipay.com.br";
const EFI_CHARGE_BASE=EFI_SANDBOX?"https://cobrancas-h.api.efipay.com.br":"https://cobrancas.api.efipay.com.br";
const INTERNAL_TOKEN=Deno.env.get("QF_PIX_SYNC_INTERNAL_TOKEN")||"";
// false = só consulta e relata cartão/boleto, sem gravar nada (a parte do Pix grava como sempre).
const GRAVAR_COBRANCAS=true;
const admin=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});

function out(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
function p12ToPem(base64:string){
  const der=forge.util.decode64(base64.replace(/\s+/g,""));
  const asn1=forge.asn1.fromDer(der);
  let p12:any=null,last:any=null;
  for(const pass of ["",undefined as any]){try{p12=forge.pkcs12.pkcs12FromAsn1(asn1,false,pass);break;}catch(e){last=e;}}
  if(!p12) throw last||new Error("p12_parse_failed");
  const co=forge.pki.oids.certBag, so=forge.pki.oids.pkcs8ShroudedKeyBag, ko=forge.pki.oids.keyBag;
  const cs=p12.getBags({bagType:co})[co]||[], ks=p12.getBags({bagType:so})[so]||[], kp=p12.getBags({bagType:ko})[ko]||[];
  const c=cs.find((b:any)=>b.cert)||cs[0], k=ks.find((b:any)=>b.key)||kp.find((b:any)=>b.key)||ks[0]||kp[0];
  if(!c?.cert||!k?.key) throw new Error("p12_missing_parts");
  return {cert:forge.pki.certificateToPem(c.cert),key:forge.pki.privateKeyToPem(k.key)};
}
function client(){const p=p12ToPem(EFI_CERT_P12);return Deno.createHttpClient({cert:p.cert,key:p.key});}
async function token(c:Deno.HttpClient){
  const r=await fetch(EFI_PIX_BASE+"/oauth/token",{method:"POST",client:c,headers:{"Authorization":"Basic "+btoa(EFI_CLIENT_ID+":"+EFI_CLIENT_SECRET),"Content-Type":"application/json"},body:JSON.stringify({grant_type:"client_credentials"})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.access_token) throw new Error("efi_pix_auth_failed");
  return String(d.access_token);
}
async function chargeToken(){
  const r=await fetch(EFI_CHARGE_BASE+"/v1/authorize",{method:"POST",headers:{"Authorization":"Basic "+btoa(EFI_CLIENT_ID+":"+EFI_CLIENT_SECRET),"Content-Type":"application/json"},body:JSON.stringify({grant_type:"client_credentials"})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.access_token) throw new Error("efi_charge_auth_failed");
  return String(d.access_token);
}
// dias: só olha cobranças criadas nos últimos N dias (evita consultar para sempre cobrança que venceu sem pagar).
async function syncTable(table:string,dias?:number){
  let q=admin.from(table).select("id,valor_centavos,status,provedor_id").eq("status","pendente").eq("provedor","efi").not("provedor_id","is",null);
  if(dias) q=q.gte("criado_em",new Date(Date.now()-dias*86400000).toISOString());
  const {data,error}=await q.limit(100);
  if(error) throw error;
  return data||[];
}

// Situações da cobrança (cartão/boleto) na Efí.
const COB_PAGA=["paid","approved","settled"];      // pagamento confirmado
const COB_CANCELADA=["unpaid","canceled","refunded"]; // não vai mais ser paga
const COB_EXPIRADA=["expired"];

async function syncCobrancas(itens:{spec:{table:string,tipo:string},row:any}[]){
  const res:any={checked:0,approved:0,closed:0,waiting:0,ignored:0};
  if(!GRAVAR_COBRANCAS) res.report=[];
  if(!itens.length) return res;
  const access=await chargeToken();
  for(const it of itens){
    const id=String(it.row.provedor_id);
    res.checked++;
    const r=await fetch(EFI_CHARGE_BASE+"/v1/charge/"+encodeURIComponent(id),{method:"GET",headers:{"Authorization":"Bearer "+access,"Content-Type":"application/json"}});
    const d:any=await r.json().catch(()=>({}));
    const cob=d?.data;
    if(!r.ok||!cob){res.ignored++; if(res.report) res.report.push({id,http:r.status}); continue;}
    const st=String(cob.status||"").toLowerCase();
    const total=Number(cob.total||0);
    const custom=String(cob.custom_id||"");
    const esperado=("qf_"+it.spec.tipo+"_"+it.row.id).replace(/[^a-zA-Z0-9_-]/g,"_");
    const confere=total===Number(it.row.valor_centavos)&&custom===esperado;
    if(res.report) res.report.push({id,st,total,confere,id_ok:custom===esperado,metodo:cob?.payment?.method||null});
    let novo:string|null=null;
    if(COB_PAGA.includes(st)){
      if(!confere){res.ignored++;continue;} // valor ou identificação não batem: não credita
      novo="aprovado";
    }else if(COB_CANCELADA.includes(st)) novo="cancelado";
    else if(COB_EXPIRADA.includes(st)) novo="expirado";
    else {res.waiting++;continue;}
    if(novo==="aprovado") res.approved++; else res.closed++;
    if(!GRAVAR_COBRANCAS) continue;
    const {error}=await admin.from(it.spec.table).update({status:novo}).eq("id",it.row.id).eq("status","pendente");
    if(error) throw error;
  }
  return res;
}


/** Quem Faz Livre: emite cobranças de comissão no backend e concilia exclusivamente com o Pix da Efí. */
async function syncComissoesQf13(c:Deno.HttpClient,access:string){
  const res={criadas:0,conferidas:0,liquidadas:0,ignoradas:0};
  const key=Deno.env.get('EFI_PIX_KEY')||'';
  const {data:rows,error}=await admin.from('qf_comissao13_pix').select('id,fechamento_id,profissional_id,txid,valor_centavos,status').in('status',['criando','pendente']).limit(100);
  if(error)throw error;
  for(const invoice of rows||[]){
    try{
      const {data:f,error:fe}=await admin.from('qf_comissao13_fechamentos').select('status,cobranca_status,comissao_centavos,profissional_id').eq('id',invoice.fechamento_id).maybeSingle();
      if(fe||!f||f.status!=='confirmado'||f.cobranca_status!=='pendente'||f.profissional_id!==invoice.profissional_id||f.comissao_centavos!==invoice.valor_centavos){res.ignoradas++;continue;}
      const txid=String(invoice.txid),expected=Number(invoice.valor_centavos);
      const path='/v2/cob/'+encodeURIComponent(txid),headers={'Authorization':'Bearer '+access,'Content-Type':'application/json'};
      let r=await fetch(EFI_PIX_BASE+path,{method:'GET',client:c,headers});
      let cob:any=await r.json().catch(()=>({}));
      if(!r.ok&&invoice.status==='criando'&&key){
        r=await fetch(EFI_PIX_BASE+path,{method:'PUT',client:c,headers,body:JSON.stringify({calendario:{expiracao:86400},valor:{original:(expected/100).toFixed(2)},chave:key,solicitacaoPagador:'Comissao Quem Faz Livre 13%',infoAdicionais:[{nome:'Fechamento',valor:invoice.fechamento_id}]})});
        cob=await r.json().catch(()=>({}));
        if(!r.ok){r=await fetch(EFI_PIX_BASE+path,{method:'GET',client:c,headers});cob=await r.json().catch(()=>({}));}
      }
      if(!r.ok||cob.txid!==txid||Math.round(Number(cob.valor?.original||0)*100)!==expected){res.ignoradas++;continue;}
      res.conferidas++;
      if(cob.status==='CONCLUIDA'){
        const pays=Array.isArray(cob.pix)?cob.pix:[];
        const total=Math.round(pays.reduce((acc:number,x:any)=>acc+Number(x.valor||0),0)*100);
        const eids=pays.map((x:any)=>String(x.endToEndId||'')).filter((x:string)=>x.length>=16);
        if(total!==expected||eids.length!==pays.length||!eids.length){res.ignoradas++;continue;}
        const result=await admin.rpc('qf_comissao13_pix_liquidar',{p_txid:txid,p_end_to_end_id:eids.sort().join(','),p_valor_centavos:expected});
        if(result.error||result.data?.ok!==true)throw Error('conciliacao_negada');
        if(!result.data?.duplicado)res.liquidadas++;
      }else if(cob.status==='ATIVA'&&invoice.status==='criando'){
        const location=cob.loc?.id;
        if(!location){res.ignoradas++;continue;}
        const qrResp=await fetch(EFI_PIX_BASE+'/v2/loc/'+encodeURIComponent(String(location))+'/qrcode',{method:'GET',client:c,headers});
        const qr=await qrResp.json().catch(()=>({}));
        if(!qrResp.ok||!qr.qrcode){res.ignoradas++;continue;}
        const upd=await admin.from('qf_comissao13_pix').update({status:'pendente',pix_copia_cola:String(qr.qrcode),checkout_url:qr.linkVisualizacao||null,emitido_em:new Date().toISOString(),erro:null}).eq('id',invoice.id).eq('status','criando');
        if(upd.error)throw upd.error;res.criadas++;
      }
    }catch(err){res.ignoradas++;console.warn('QF13_AUTO_PIX_SYNC',String((err as Error).message||err));}
  }
  return res;
}

async function autoResgatar(id:string) {
  const {data,error}=await admin.rpc("qf_auto_resgatar_pre_cadastro",{p_id:id});
  if(error) console.warn("QF_PIX_AUTO_RESGATE_DB",error.code||"rpc_error");
  return !error && data?.estado==="resgatado";
}
Deno.serve(async(req)=>{
  if(req.method!=="POST") return out({ok:false,error:"method_not_allowed"},405);
  let body:any={}; try{body=await req.json();}catch(_){}
  if(!INTERNAL_TOKEN || String(body?.token||"")!==INTERNAL_TOKEN) return out({ok:false,error:"forbidden"},403);

  const c=client();
  try{
    const access=await token(c);
    let marketing:any;try{marketing=await syncMarketingDedicado(admin,c,EFI_PIX_BASE,access);}catch(_){marketing={error:'marketing_indisponivel'};}
    let checked=0,approved=0,ignored=0;
    const cobrancas:{spec:{table:string,tipo:string},row:any}[]=[];
    for(const spec of [
      {table:"qf_prioridade_pagamentos",tipo:"prioridade"},
      {table:"qf_recargas",tipo:"recarga"},
      {table:"qf_anuncio_pagamentos",tipo:"anuncio"},
      {table:"qf_pre_cadastro_pagamentos",tipo:"precadastro",dias:4},
      {table:"qf_visita_pagamentos",tipo:"visita",dias:4}
    ] as {table:string,tipo:string,dias?:number}[]){
      const rows=await syncTable(spec.table,spec.dias);
      for(const row of rows){
        const txid=String(row.provedor_id||"");
        // Só números = cobrança de cartão/boleto (charge_id): conferida depois, na API de Cobranças.
        if(/^[0-9]{1,15}$/.test(txid)){cobrancas.push({spec,row});continue;}
        if(!/^[A-Za-z0-9]{26,35}$/.test(txid)){ignored++;continue;}
        checked++;
        const vr=await fetch(EFI_PIX_BASE+"/v2/cob/"+encodeURIComponent(txid),{method:"GET",client:c,headers:{"Authorization":"Bearer "+access,"Content-Type":"application/json"}});
        if(!vr.ok){ignored++;continue;}
        const cob=await vr.json().catch(()=>({}));
        const status=String(cob?.status||"").toUpperCase();
        if(status!=="CONCLUIDA") continue;
        const expected=Number(row.valor_centavos);
        const original=Math.round(Number(cob?.valor?.original||0)*100);
        const paid=Array.isArray(cob?.pix)?Math.round(cob.pix.reduce((s:number,p:any)=>s+Number(p?.valor||0),0)*100):0;
        if(expected!==original || paid<expected){ignored++;continue;}
        // Para orçamento presencial, banco deve confirmar exatamente R$ 25,00
        // e fornecer o E2E. Nunca marcar visita paga apenas por QR gerado.
        const visita=spec.tipo==="visita";
        const pixItems=Array.isArray(cob?.pix)?cob.pix:[];
        const e2e=visita?pixItems.map((p:any)=>String(p?.endToEndId||"").trim()):[];
        if(visita && (expected!==2500 || paid!==2500 || !pixItems.length ||
           e2e.some((id:string)=>!/^E[A-Za-z0-9]{15,80}$/.test(id)))){ignored++;continue;}
        const update:any={status:"aprovado",provedor:"efi",provedor_id:txid};
        if(visita)update.end_to_end_id=e2e.sort().join(",");
        const {error:updErr}=await admin.from(spec.table).update(update).eq("id",row.id).eq("status","pendente");
        if(updErr) throw updErr;
        // Aprovado somente após checar cobranca Efí; falha no resgate NÃO desfaz aprovacao.
        if(spec.tipo==="precadastro") await autoResgatar(String(row.id));
        approved++;
      }
    }
    // Reconciliar também aprovados que só criaram perfil depois do Pix (idempotente).
    const {data:backlog,error:backlogErr}=await admin.from("qf_pre_cadastro_pagamentos")
      .select("id").eq("status","aprovado").eq("provedor","efi")
      .is("profissional_id",null).gte("criado_em",new Date(Date.now()-4*86400000).toISOString()).limit(100);
    if(backlogErr) console.warn("QF_PIX_AUTO_RESGATE_BACKLOG",backlogErr.code||"query_error");
    for(const item of backlog||[]) await autoResgatar(String(item.id));
    // Cartão e boleto: uma falha aqui nunca derruba a confirmação do Pix acima.
    let charges:any;
    try{charges=await syncCobrancas(cobrancas);}
    catch(e){charges={error:String((e as Error).message||e)};console.warn("QF_EFI_COBRANCAS_SYNC_FAILED",charges.error);}
    let comissoes:any;try{comissoes=await syncComissoesQf13(c,access);}catch(e){comissoes={error:String((e as Error).message||e)};console.warn('QF13_PIX_SYNC_FAILED',comissoes.error);}
    return out({ok:true,checked,approved,ignored,charges,comissoes,marketing});
  }catch(e){return out({ok:false,error:String((e as Error).message||e)},500);}
  finally{c.close();}
});
