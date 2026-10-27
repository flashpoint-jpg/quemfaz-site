// Isolated visual QA server. It never connects to production or sends real notifications.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {ready}=require('./helpers/negociacoes-admin.cjs'),{rpc}=require('./helpers/comissao13-owner.cjs'),{as,uid}=require('./helpers/atendimento-db.cjs');
(async()=>{
 const {d,call}=await ready();await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'propor',35000]);await d.exec("reset role;select set_config('test.admin','true',false)");await as(d,1);
 const css=fs.readFileSync('admin.html','utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/rpc'){
   try{let raw='';for await(const c of req)raw+=c;const {name,args}=JSON.parse(raw);if(!['qf_admin_negociacoes','qf_admin_negociacao_detalhe'].includes(name))throw Error('Read-only QA');const data=await rpc(d,name,name.endsWith('_detalhe')?[args.p_desbloqueio]:[]);res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data}));}catch(e){res.statusCode=500;return res.end(JSON.stringify({error:{message:e.message}}));}
  }
  if(req.url==='/qf-admin-negociacoes.js'){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync('qf-admin-negociacoes.js'));}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Teste isolado — Negociações Quem Faz</title><style>'+css+'</style>'+(req.url==='/mobile'?'<iframe title="Painel em celular" style="width:390px;height:950px;border:1px solid #ccc" src="/admin"></iframe>':'<body class="qf-adm-body"><p style="background:#fff1d5;padding:10px">TESTE ISOLADO · dados de teste · nenhum envio ou cobrança real</p><main id="app-content" style="padding:20px;max-width:1250px;margin:auto"></main><script>window.Screens={};window.QFAdminCloud={client:{rpc:async(name,args)=>fetch("/rpc",{method:"POST",body:JSON.stringify({name,args})}).then(r=>r.json())}};location.hash="/admin/negociacoes";</script><script src="/qf-admin-negociacoes.js"></script>')+'</body></html>');
 });server.listen(8765,'0.0.0.0',()=>console.log('QA isolado em http://127.0.0.1:8765/admin'));
 process.on('SIGTERM',()=>{server.close();d.close();});
})().catch(e=>{console.error(e);process.exitCode=1;});
