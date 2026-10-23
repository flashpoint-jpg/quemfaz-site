import {createClient} from 'npm:@supabase/supabase-js@2.58.0';
import {gerarCodigo,hashCodigo,telefoneBR} from './seguranca.mjs';
const url=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origem='https://quemfazservico.com.br';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':origem,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
async function rpc(nome:string,args:Record<string,unknown>){const r=await admin.rpc(nome,args);if(r.error)throw Error('backend_indisponivel');return r.data;}
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({ok:false,reason:'metodo_invalido'},405);
 if(req.headers.get('origin') && req.headers.get('origin')!==origem)return reply({ok:false,reason:'origem_invalida'},403);
 try{
  const raw=await req.text();if(raw.length>4096)return reply({ok:false,reason:'dados_invalidos'},400);
  const b=JSON.parse(raw);
  const sid=Deno.env.get('QF13_TWILIO_ACCOUNT_SID')||'', secret=Deno.env.get('QF13_TWILIO_AUTH_TOKEN')||'', from=Deno.env.get('QF13_SMS_FROM')||'', pepper=Deno.env.get('QF13_OTP_SECRET')||'';
  const configurado=/^AC[0-9a-f]{32}$/i.test(sid)&&!!secret&&/^\+[1-9]\d{7,14}$/.test(from)&&pepper.length>=32;
  if(b.action==='status')return reply({ok:true,otp_configurado:configurado,financeiro_servicos_integrado:false,efi_pix_credenciais_presentes:!!(Deno.env.get('EFI_CLIENT_ID')&&Deno.env.get('EFI_CLIENT_SECRET')&&Deno.env.get('EFI_CERT_P12_PROD_BASE64')&&Deno.env.get('EFI_PIX_KEY')),efi_cartao_credenciais_presentes:!!(Deno.env.get('EFI_CLIENT_ID')&&Deno.env.get('EFI_CLIENT_SECRET')),ativo:false});
  // Nunca reutilizar a sessão de profissional para confirmar pelo cliente.
  const bearer=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(bearer){const {data}=await admin.auth.getUser(bearer);if(data.user)return reply({ok:false,reason:'use_acesso_cliente'},403);}
  if(b.fluxo==='prestacao'){
   if(!/^[a-f0-9]{64}$/.test(String(b.token||'')))return reply({ok:false,reason:'link_invalido'},400);
   const args={p_token:b.token,p_acao:'info'};
   if(b.action==='info')return reply({...await rpc('qf13_cliente_guest',args),otp_configurado:configurado});
   if(!configurado)return reply({ok:false,reason:'otp_nao_configurado'},503);
   if(!['contratou','nao_contratou'].includes(b.finalidade))return reply({ok:false,reason:'dados_invalidos'},400);
   if(b.action==='enviar_codigo'){
    const code=gerarCodigo(),hash=await hashCodigo(b.token,b.finalidade,code,pepper);
    const r=await rpc('qf13_cliente_guest',{...args,p_acao:'criar',p_finalidade:b.finalidade,p_hash:hash});
    if(!r.ok)return reply(r);
    const payload=new URLSearchParams({To:telefoneBR(r.telefone),From:from,Body:`Quem Faz: código ${code} para confirmar sua resposta sobre a contratação. Válido por 5 minutos. Não compartilhe este código.`});
    const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+btoa(sid+':'+secret),'Content-Type':'application/x-www-form-urlencoded'},body:payload,signal:AbortSignal.timeout(15000)});
    const sent=await response.json();
    if(!response.ok||!/^SM[0-9a-f]{32}$/i.test(sent.sid||'')||['failed','undelivered','canceled'].includes(sent.status))return reply({ok:false,reason:'falha_envio'},502);
    await rpc('qf_comissao13_codigo_enviado',{p_id:r.codigo_id,p_provedor_id:sent.sid});
    return reply({ok:true,status:'aceito_pelo_provedor',entrega_confirmada:false});
   }
   if(b.action==='confirmar'){
    if(b.confirmar!==true||!/^\d{6}$/.test(String(b.codigo||'')))return reply({ok:false,reason:'codigo_invalido'},400);
    return reply(await rpc('qf13_cliente_guest',{...args,p_acao:'confirmar',p_finalidade:b.finalidade,p_hash:await hashCodigo(b.token,b.finalidade,b.codigo,pepper)}));
   }
   return reply({ok:false,reason:'acao_invalida'},400);
  }
  if(!/^[0-9a-f-]{36}$/i.test(String(b.token||'')))return reply({ok:false,reason:'link_invalido'},400);
  if(b.carteirinha){
   if(!/^[0-9a-f-]{36}$/i.test(String(b.carteirinha)))return reply({ok:false,reason:'carteirinha_incompativel'},400);
   const cart=await rpc('qf_comissao13_carteirinha_info',{p_carteirinha:b.carteirinha,p_token:b.token});
   if(!cart.ok)return reply(cart,403);
  }
  if(b.action==='info')return reply({...await rpc('qf_comissao13_cliente_info',{p_token:b.token}),financeiro_disponivel:Deno.env.get('QF13_FINANCEIRO_LIBERADO')==='true'});
  if(!configurado)return reply({ok:false,reason:'otp_nao_configurado'},503);
  if(!['contratar','concluir','contestar'].includes(b.finalidade))return reply({ok:false,reason:'dados_invalidos'},400);
  if(b.action==='enviar_codigo'){
   const code=gerarCodigo();
   const hash=await hashCodigo(b.token,b.finalidade,code,pepper);
   const r=await rpc('qf_comissao13_codigo_criar',{p_token:b.token,p_finalidade:b.finalidade,p_hash:hash});
   if(!r.ok)return reply(r);
   // Destinatário exclusivamente do banco; nunca aceitar telefone no corpo da requisição.
   const payload=new URLSearchParams({To:telefoneBR(r.telefone),From:from,Body:`Quem Faz: código ${code} para ${b.finalidade} o serviço. Válido por 5 minutos. Não compartilhe com o profissional.`});
   const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+btoa(sid+':'+secret),'Content-Type':'application/x-www-form-urlencoded'},body:payload,signal:AbortSignal.timeout(15000)});
   const sent=await response.json();
   if(!response.ok||!/^SM[0-9a-f]{32}$/i.test(sent.sid||'')||['failed','undelivered','canceled'].includes(sent.status))return reply({ok:false,reason:'falha_envio'},502);
   // Aceito/enfileirado pelo provedor não significa entregue ao celular.
   await rpc('qf_comissao13_codigo_enviado',{p_id:r.codigo_id,p_provedor_id:sent.sid});
   return reply({ok:true,status:'aceito_pelo_provedor',entrega_confirmada:false});
  }
  if(b.action==='confirmar'){
   if(!/^\d{6}$/.test(String(b.codigo||'')))return reply({ok:false,reason:'codigo_invalido'},400);
   const hash=await hashCodigo(b.token,b.finalidade,b.codigo,pepper);
   return reply(await rpc('qf_comissao13_cliente_confirmar',{p_token:b.token,p_finalidade:b.finalidade,p_hash:hash,p_confirmar:b.confirmar===true,p_motivo:typeof b.motivo==='string'?b.motivo.slice(0,2000):null}));
  }
  return reply({ok:false,reason:'acao_invalida'},400);
 }catch{return reply({ok:false,reason:'servico_indisponivel'},503);}
});
