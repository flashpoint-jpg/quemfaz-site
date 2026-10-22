// Preparado para homologação. NÃO implantar/ativar sem testes reais aprovados.
import {createClient} from 'npm:@supabase/supabase-js@2.58.0';
import {p12ToPem} from './certificado.ts';
import {emitirPix,linkCartao,verificarPix,verificarCartao,segredoConfere} from './efi.mjs';
const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const homologacao=Deno.env.get('EFI_SANDBOX')==='true';
const clientId=Deno.env.get('EFI_CLIENT_ID')||'',clientSecret=Deno.env.get('EFI_CLIENT_SECRET')||'';
const chavePix=Deno.env.get('QF13_EFI_PIX_KEY')||'',cert=Deno.env.get('EFI_CERT_P12_PROD_BASE64')||'';
const segredoWebhook=Deno.env.get('QF13_EFI_WEBHOOK_SECRET')||'';
const pixBase=homologacao?'https://pix-h.api.efipay.com.br':'https://pix.api.efipay.com.br';
const cardBase=homologacao?'https://cobrancas-h.api.efipay.com.br':'https://cobrancas.api.efipay.com.br';
const ativo=Deno.env.get('QF13_FINANCEIRO_LIBERADO')==='true'&&segredoWebhook.length>=32;
const cors={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'https://quemfazservico.com.br','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:cors});
async function rpc(n:string,a:Record<string,unknown>){const r=await admin.rpc(n,a);if(r.error)throw Error('database_unavailable');return r.data;}
async function apiBanco(tipo:'pix'|'cartao'){
 if(!clientId||!clientSecret)throw Error('credenciais_ausentes');
 let client:Deno.HttpClient|undefined;
 if(tipo==='pix'){if(!cert||!chavePix)throw Error('pix_nao_configurado');const pem=p12ToPem(cert);client=Deno.createHttpClient({cert:pem.cert,key:pem.key});}
 const base=tipo==='pix'?pixBase:cardBase;
 const r=await fetch(base+(tipo==='pix'?'/oauth/token':'/v1/authorize'),{method:'POST',client,headers:{Authorization:'Basic '+btoa(clientId+':'+clientSecret),'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credentials'}),signal:AbortSignal.timeout(15000)});
 const d=await r.json();if(!r.ok||!d.access_token){client?.close();throw Error('autenticacao_banco_falhou');}
 return {close:()=>client?.close(),request:async(method:string,path:string,body?:unknown)=>{
  const res=await fetch(base+path,{method,client,headers:{Authorization:'Bearer '+d.access_token,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  if(!res.ok)throw Error('banco_respondeu_'+res.status);return res.status===204?{}:await res.json();
 }};
}
function seguroCheckout(v:string){const u=new URL(v);if(u.protocol!=='https:'||!['pagamento.gerencianet.com.br','pagamento.efipay.com.br'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))throw Error('checkout_invalido');return u.href;}
async function reconciliar(f:any,d:any){
 const v=f.metodo==='pix'?verificarPix(f,d):verificarCartao(f,d);if(!v.confirmado)return;
 const args={p_provedor_id:f.provedor_id,p_evento_id:v.event_id,p_tipo:v.tipo,p_valor_centavos:f.valor_centavos,p_taxa_real_centavos:v.taxa_centavos,p_estornado_centavos:v.estornado_centavos??null};
 const r=await rpc('qf_comissao13_financeiro_evento',args);if(!r.ok)throw Error('reconciliacao_negada');
 if(v.tipo==='pago'&&v.repasse_confirmado&&v.taxa_centavos!==null){const r=await rpc('qf_comissao13_financeiro_evento',{...args,p_evento_id:v.event_id+':repasse',p_tipo:'repassado'});if(!r.ok)throw Error('repasse_requer_revisao');}
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return reply({ok:false,reason:'metodo_invalido'},405);
 const route=new URL(req.url);
 if(!ativo)return reply({ok:false,reason:'financeiro_em_homologacao'},503);
 try{
  if(route.pathname.endsWith('/webhook')){
   if(!await segredoConfere(route.searchParams.get('key')||'',segredoWebhook))return reply({ok:false},401);
   const raw=await req.text();if(raw.length>64000)return reply({ok:false},413);
   if(req.headers.get('content-type')?.includes('application/x-www-form-urlencoded')){
    const notification=new URLSearchParams(raw).get('notification')||'';if(!/^[a-f0-9-]{36}$/i.test(notification))return reply({ok:false},400);
    const bank=await apiBanco('cartao');
    try{
     const notices=await bank.request('GET','/v1/notification/'+encodeURIComponent(notification));
     const ids=[...new Set((notices.data||[]).map((n:any)=>String(n.identifiers?.charge_id||'')).filter(Boolean))];
     for(const id of ids){const {data:f,error}=await admin.from('qf_comissao13_financeiro').select('*').eq('provedor_id',id).eq('metodo','cartao').maybeSingle();if(error)throw error;if(!f)continue;await reconciliar({...f,financeiro_id:f.id},await bank.request('GET','/v1/charge/'+encodeURIComponent(String(id))));}
    }finally{bank.close();}
   }else{
    const body=JSON.parse(raw);const txids=[...new Set((body.pix||[]).map((p:any)=>String(p.txid||'')).filter((x:string)=>/^[a-zA-Z0-9]{26,35}$/.test(x)))];
    const bank=await apiBanco('pix');
    try{for(const txid of txids){const {data:f,error}=await admin.from('qf_comissao13_financeiro').select('*').eq('txid',txid).eq('metodo','pix').maybeSingle();if(error)throw error;if(!f)continue;await reconciliar({...f,financeiro_id:f.id},await bank.request('GET','/v2/gn/split/cob/'+encodeURIComponent(String(txid))));}}finally{bank.close();}
   }
   return reply({ok:true});
  }
  if(req.headers.get('origin')&&req.headers.get('origin')!=='https://quemfazservico.com.br')return reply({ok:false,reason:'origem_invalida'},403);
  const bearer=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');if(bearer){const {data}=await admin.auth.getUser(bearer);if(data.user)return reply({ok:false,reason:'use_acesso_cliente'},403);}
  const raw=await req.text();if(raw.length>4096)return reply({ok:false},413);const b=JSON.parse(raw);
  if(!/^[a-f0-9-]{36}$/i.test(b.token||'')||!['pix','cartao'].includes(b.metodo))return reply({ok:false,reason:'dados_invalidos'},400);
  const f=await rpc('qf_comissao13_pagamento_preparar',{p_token:b.token,p_metodo:b.metodo});if(!f.ok)return reply(f,409);
  if(!f.novo){if(f.status==='pendente')return reply({ok:true,checkout_url:f.checkout_url,pix_copia_cola:f.pix_copia_cola});return reply({ok:false,reason:'cobranca_em_verificacao'},409);}
  const bank=await apiBanco(b.metodo);
  try{
   let provedorId:string,checkout:string|null=null,pix:string|null=null;
   if(b.metodo==='pix'){const r=await emitirPix(f,chavePix,bank.request);provedorId=r.provedor_id;pix=r.pix_copia_cola;}
   else{const callback=url+'/functions/v1/quemfaz-comissao13-financeiro/webhook?key='+encodeURIComponent(segredoWebhook);const r=await bank.request('POST','/v1/charge/one-step/link',linkCartao(f,callback));if(!r.data?.charge_id||!r.data?.payment_url)throw Error('cobranca_nao_retornada');provedorId=String(r.data.charge_id);checkout=seguroCheckout(r.data.payment_url);}
   const saved=await rpc('qf_comissao13_pagamento_emitido',{p_id:f.financeiro_id,p_provedor_id:provedorId,p_checkout_url:checkout,p_pix_copia_cola:pix});if(!saved.ok)throw Error('persistencia_negada');
   return reply({ok:true,checkout_url:checkout,pix_copia_cola:pix});
  }catch{
   // POST de cartão com resposta perdida nunca é repetido automaticamente.
   await admin.from('qf_comissao13_financeiro').update({status:'incerto'}).eq('id',f.financeiro_id).eq('status','criando');
   return reply({ok:false,reason:'cobranca_em_verificacao'},503);
  }finally{bank.close();}
 }catch{return reply({ok:false,reason:'financeiro_indisponivel'},503);}
});
