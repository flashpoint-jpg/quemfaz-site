/* Browser tests use only local fixtures. All external traffic is blocked. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {db,as,unlock,scalar}=require('./helpers/atendimento-db.cjs');
let database;
const root=path.resolve(__dirname,'../dist');
const server=http.createServer(async(req,res)=>{
 if(req.url==='/__rpc'&&req.method==='POST'){
  let body='';for await(const part of req)body+=part;
  try{const args=JSON.parse(body);await as(database,1);const result=await database.query('select public.qf_publicar_atendimento($1::jsonb,$2::jsonb) r',[JSON.stringify(args.p_respostas),JSON.stringify(args.p_geo)]);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:result.rows[0].r,error:null}));}
  catch(e){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:null,error:{message:e.message}}));}return;
 }
 const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
 if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403).end();return;}
 const target=file===root?path.join(root,'index.html'):file;
 try{const types={'.js':'text/javascript','.html':'text/html','.css':'text/css','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target));}catch{res.writeHead(404).end();}
});
(async()=>{
 database=await db();
 await database.exec('reset role');
 await database.exec('alter table public.qf_chamados add column if not exists valor_oferecido_centavos integer');
 for(const migration of ['20261022142812_garante_por_orcamento.sql','20261022144845_garante_apenas_novos_com_intencao.sql'])await database.exec(fs.readFileSync('supabase/migrations/'+migration,'utf8'));
 await as(database,1);
 await database.exec("update public.qf_profiles set telefone='11988887776',whatsapp='11988887776' where tipo='cliente'");
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.QF_CHROMIUM_EXECUTABLE?{executablePath:process.env.QF_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();return route.continue();});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Actual built router: anonymous client registration is now the mandatory assistant.
  await page.goto(origin+'/#/auth/cliente/cadastro');
  await page.waitForSelector('[data-qf-atendimento] #at-servico');
  assert.equal(await page.locator('#cadastro-cliente-form').count(),0);
  assert.equal(await page.locator('[data-at-progress]').innerText(),'Etapa 1 de 4 — Serviço');
  // Replace connector in the page only, before any contact is collected. No signups/requests reach production.
  await page.evaluate(()=>{
   window.__submissions=[];window.__nav=[];window.QFCloud.enabled=true;
   window.QFCloud.signUp=async()=>({ok:true,user:{id:'00000000-0000-4000-8000-000000000001'}});
   const original=window.QFCloud.createCall;
   window.QFCloud.createCall=async args=>{window.__submissions.push(args);return original(args);};
   window.QFCloud.client.rpc=async(name,args)=>{if(name==='qf13_codigo_cliente')return {data:{ok:true,codigo:'123456'},error:null};if(name!=='qf_publicar_atendimento')throw Error('Unexpected fixture RPC: '+name);return fetch('/__rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)}).then(r=>r.json());};
   window.QFCloud.client.from=table=>{if(table==='qf_chamados')throw Error('Direct insert bypass');return {insert:()=>Promise.resolve({}),update:()=>({eq:()=>Promise.resolve({})})};};
   window.QFGeo.geocodeCity=async()=>({latitude:-23.66,longitude:-46.53});
   window.QFGeo.geocodeBairro=async()=>({latitude:-23.66,longitude:-46.53});
   window.QFPush={notify:async()=>{}};
   window.navigate=url=>window.__nav.push(url);
  });
  fs.mkdirSync('/tmp/qf-mockup',{recursive:true});
  const fill=async(key,value)=>{
   const radio=page.locator('input[name="at-'+key+'"][value="'+value+'"]');
   if(await radio.count())await radio.check();
   else {const input=page.locator('#at-'+key);if(await input.evaluate(el=>el.tagName==='SELECT'))await input.selectOption(value);else await input.fill(value);}
  };
  const answer=async(key,value)=>{await fill(key,value);await page.getByRole('button',{name:'Continuar',exact:true}).click();};
  await answer('servico','Faxina');await answer('detalhes','pesada');await answer('escopo','3a4');
  assert.match(await page.locator('[data-at-progress]').innerText(),/Etapa 2 de 4/);
  for(const [k,v] of Object.entries({cidade:'Santo André',uf:'SP',bairro:'Jardim do Estádio',urgencia:'normal',data:'2099-10-22',disponibilidade:'Manhã'}))await answer(k,v);
  assert.match(await page.locator('[data-at-progress]').innerText(),/Etapa 3 de 4/);
  await answer('materiais','profissional');
  assert.equal(await page.getByText('Preciso de uma avaliação',{exact:true}).count(),1);
  await answer('orcamento','15000:30000');
  assert.match(await page.locator('[data-at-progress]').innerText(),/Etapa 4 de 4/);
  for(const [k,v] of Object.entries({nome:'Cliente Teste',contato:'11988887776',intencao:'contratar'}))await answer(k,v);
  await fill('autorizacao','sim');
  await page.getByRole('heading',{name:'Revise antes de publicar'}).waitFor();
  assert.equal(await page.locator('#at-orcamento').count(),0);
  assert.match(await page.locator('[data-qf-atendimento]').innerText(),/Você decide se contrata/);
  assert.equal(await page.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)>innerWidth),false,'mobile has no horizontal overflow');
  await page.screenshot({path:'/tmp/qf-atendimento-review.png',fullPage:true});
  await page.getByRole('button',{name:'Publicar grátis',exact:true}).click();
  await page.waitForURL(/acompanhar-pedido\.html#pedido=[a-f0-9-]{36}/);
  const id=(await scalar(database,"select id from public.qf_chamados where atendimento_tipo='garante'"));
  assert.ok(id,'real frontend RPC created the database row');
  await database.exec('reset role');
  await database.query("update public.qf_profissionais set especialidades=array[(select categoria from public.qf_chamados where id=$1)]",[id]);
  await as(database,11);const unlocked=await unlock(database,id,true);assert.equal(unlocked.ok,true);assert.equal(unlocked.preco_centavos,3160);
  await as(database,12);assert.equal((await unlock(database,id,true)).ok,false);
  const submissions=await page.evaluate(()=>window.__submissions);assert.equal(submissions.length,1);
  assert.equal(submissions[0].atendimento.tipo,'garante');assert.equal(submissions[0].atendimento.detalhes,'Faxina pesada');assert.equal(submissions[0].maxOrcamentos,1);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('qf_atendimento_key')),null);
  const stored=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));assert.doesNotMatch(stored,/11988887776|Cliente Teste|Limpeza pesada/,'assistant does not persist PII');
  const professionalPreview=await page.evaluate(()=>{
   const req=DB.state.requests.find(r=>r.atendimentoTipo==='garante');
   const prof={id:'fixture-pro',nome:'Profissional Teste',categorias:[req.categoriaId],online:true,statusAprovacao:'aprovado',bloqueado:false,creditos:100000};
   const doc=document.createElement('div');doc.innerHTML=Screens.profChamadaRender({id:req.id},prof);
   window.__professionalHTML=doc.innerHTML;
   return {text:doc.textContent,fact:doc.querySelector('.qf-call-facts .qf-call-fact:last-child strong')?.textContent,fee:doc.querySelector('.qf-unlock-simple .h1')?.textContent,expected:PU.formatCurrency(DB.leadFeeForRequest(req)*4),normalButton:!!doc.querySelector('[data-action="desbloquear-chamada"]'),exclusiveButton:!!doc.querySelector('[data-action="desbloquear-exclusivo"]'),planUpsell:!!doc.querySelector('.qf-plan-save')};
  });
  assert.match(professionalPreview.text,/Orçamento estimado: R\$ 150,00 a R\$ 300,00/);
  assert.match(professionalPreview.text,/Prazo: Agendado — 22\/10\/2099/);
  assert.doesNotMatch(professionalPreview.text,/11988887776|Cliente Teste/);
  await page.evaluate(()=>document.querySelector('#app') ? document.querySelector('#app').innerHTML=window.__professionalHTML : document.body.innerHTML=window.__professionalHTML);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.view')).opacity==='1');
  await page.screenshot({path:'/tmp/qf-mockup/profissional.png',fullPage:true});
  assert.equal(professionalPreview.fact,professionalPreview.expected);
  assert.equal(professionalPreview.fee,professionalPreview.expected);assert.equal(professionalPreview.normalButton,false);assert.equal(professionalPreview.exclusiveButton,true);assert.equal(professionalPreview.planUpsell,false);
  // Logged-in route also uses the same assistant and cannot render the old form.
  await page.evaluate(()=>{
   document.body.innerHTML='<main id="test-mount"></main>';
   const content=document.querySelector('main');content.innerHTML=QFAtendimento.html();
   Screens.afterRender('/cliente/novo-pedido/:catId',content,{catId:'cat_pintor'},{id:'fixture-client'});
  });
  await page.waitForSelector('[data-qf-atendimento] input[name="at-detalhes"]');
  assert.equal(await page.locator('#novo-pedido-form').count(),0);
  assert.match(await page.locator('label[for="at-detalhes"]').innerText(),/pintar/);
  // Traditional assessment, denied consent, timeout after commit, and double click retry.
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  assert.match(await page.locator('[data-error="detalhes"]').innerText(),/Responda/);
  await answer('detalhes','paredes');await answer('escopo','media');
  for(const [k,v] of Object.entries({cidade:'Santo André',uf:'SP',bairro:'Centro',urgencia:'normal',data:'2099-10-22',disponibilidade:'Tarde'}))await answer(k,v);
  await answer('materiais','combinar');await answer('orcamento','avaliacao');
  for(const [k,v] of Object.entries({nome:'Cliente Teste',contato:'11988887776',intencao:'contratar'}))await answer(k,v);
  await fill('autorizacao','nao');
  await page.getByRole('button',{name:'Publicar grátis',exact:true}).click();
  assert.match(await page.locator('[data-error="autorizacao"]').innerText(),/Sem autorização/);
  assert.equal(await page.evaluate(()=>window.__submissions.length),1);
  await fill('autorizacao','sim');
  await page.evaluate(()=>{const real=QFCloud.createCall;let first=true;QFCloud.createCall=async args=>{const result=await real(args);if(first){first=false;throw Error('Timeout simulado após gravar');}return result;};});
  await page.getByRole('button',{name:'Publicar grátis',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-at-error]')?.textContent==='Timeout simulado após gravar');
  await page.evaluate(()=>{const b=document.querySelector('[data-at-publish]');b.click();b.click();});
  await page.waitForURL(/acompanhar-pedido\.html#pedido=[a-f0-9-]{36}/);
  const retry=await page.evaluate(()=>window.__submissions.slice(1));assert.equal(retry.length,2);
  assert.equal(retry[0].atendimento.chave,retry[1].atendimento.chave);
  assert.equal(retry[1].atendimento.orcamento_centavos,null);assert.equal(retry[1].atendimento.orcamento_faixa,'avaliacao');
  await database.exec('reset role');
  assert.equal(Number(await scalar(database,"select count(*) from private.test_dispatch where evento='new_call'")),2);
  const traditional=(await database.query("select * from public.qf_chamados where atendimento_tipo='tradicional'")).rows[0];
  assert.equal(traditional.max_orcamentos,4);assert.match(traditional.descricao,/Preciso de uma avaliação/);
  assert.deepEqual(errors,[]);
  console.log('PASS browser: actual built router, four stages with individual radio questions, adapted profession, complete Garante → real createCall → RPC → isolated Postgres → exclusive debit, review, mobile, privacy and both entry points');
  await context.close();
  // UI fixtures only: real server-side OTP/security rules are tested separately against Postgres.
  for(const viewport of [{width:390,height:844},{width:1440,height:900}]){
   const clientContext=await browser.newContext({viewport,serviceWorkers:'block'});
   let state='contratado';const actions=[];
   await clientContext.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.hostname==='dczlyrgnzlxmzghzaooz.supabase.co'){
     const body=route.request().postDataJSON();actions.push(body);
     let response;
     if(body.action==='info')response={ok:true,profissional:'Profissional Fixture',pedido:'Pedido Fixture',valor_centavos:50000,agendado_em:'2020-01-01T12:00:00Z',status:state,telefone_final:'0000',financeiro_disponivel:false};
     else if(body.action==='enviar_codigo')response={ok:true};
     else if(body.action==='confirmar'){assert.equal(body.confirmar,true);assert.equal(body.codigo,'123456');state=body.finalidade==='contestar'?'contestado':'concluido';response={ok:true};}
     else throw Error('Unexpected client action '+body.action);
     return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
    }
    return u.origin===origin?route.continue():route.abort();
   });
   const clientPage=await clientContext.newPage();
   await clientPage.goto(origin+'/comissao13.html#token=00000000-0000-4000-8000-000000000123&carteirinha=00000000-0000-4000-8000-000000000124');
   await clientPage.locator('#acoes').waitFor({state:'visible'});
   assert.equal(actions.length,1,'QR only reads the agreement');
   assert.match(await clientPage.locator('#resumo').innerText(),/Profissional Fixture[\s\S]*500,00/);
   assert.equal(await clientPage.locator('#form').isVisible(),false);
   assert.equal(await clientPage.locator('#pagamento').isVisible(),false);
   await clientPage.locator('#enviar').click();await clientPage.locator('#form').waitFor({state:'visible'});
   await clientPage.locator('#codigo').fill('123456');await clientPage.locator('#confirmar').click();
   assert.equal(actions.filter(a=>a.action==='confirmar').length,0,'explicit checkbox required');
   await clientPage.locator('#confirmo').check();await clientPage.locator('#confirmar').click();
   await clientPage.waitForFunction(()=>document.querySelector('#status').textContent.includes('Conclusão registrada'));
   assert.equal(state,'concluido');assert.equal(actions.filter(a=>a.action==='confirmar').length,1);
   await clientPage.locator('#finalidade').selectOption('contestar');await clientPage.locator('#enviar').click();
   await clientPage.locator('#form').waitFor({state:'visible'});await clientPage.locator('#codigo').fill('123456');
   await clientPage.locator('#motivo').fill('Serviço ainda não concluído');await clientPage.locator('#confirmo').check();await clientPage.locator('#confirmar').click();
   await clientPage.waitForFunction(()=>document.querySelector('#status').textContent.includes('Contestação registrada'));
   assert.equal(state,'contestado');assert.equal(await clientPage.locator('#pagamento').isVisible(),false);
   assert.equal(await clientPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.ok(actions.every(a=>a.carteirinha==='00000000-0000-4000-8000-000000000124'));
   await clientContext.close();
  }
  // O profissional vê a novidade no início, nos cartões e junto da opção paga.
  for(const width of [390,1440]){
   const ctx=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
   const proPage=await ctx.newPage();proPage.on('pageerror',e=>console.error('Profissional UI:',e.message));await proPage.goto(origin);
   await proPage.evaluate(()=>{
    const prof={id:'prof-ui',nome:'Profissional Teste',online:true,statusAprovacao:'aprovado',bloqueado:false,categorias:['cat_eletricista'],creditos:10000,raioKm:20,fotoUrl:'/assets/qf-logo-20261013.webp',areasAtendimento:[]};
    window.__profPayload={id:'00000000-0000-4000-8000-000000000990',cliente_id:'cliente-fixture',categoria:'cat_eletricista',titulo:'Tomada sem energia',descricao:'Descrição original que chega aos profissionais',cidade:'Santo André',uf:'SP',bairro:'Centro',endereco_completo:'Rua privada, 10',status:'aberto',criado_em:new Date().toISOString(),max_orcamentos:4,limite:4,participantes:0,preco_centavos:790,fotos:[]};
    DB.state.users.profissionais=[prof];DB.getSession=()=>({role:'profissional',userId:prof.id});DB.state.requests=[QFRequestFromCloud(window.__profPayload,null)];QFPush={supported:()=>true,isActive:()=>true,permission:()=>"granted",refreshStatus:async()=>{},restore:async()=>{},notify:async()=>{}};QFCloud.enabled=false;QFCloud.client={rpc:async(n,a)=>{window.__profRpc=(window.__profRpc||[]).concat(n);return {error:null,data:n==='qf_comissao13_status'?{ok:true,desbloqueio_gratuito_ativo:true}:n==='qf_comissao13_fechamentos_painel'?[{id:'conta-ui',chamado_id:window.__profPayload.id,titulo:'Tomada sem energia',cliente:'Cliente',status:'pendente',prazo_contas:new Date(Date.now()+86400000).toISOString()}]:{ok:true}};}};QFCloud.syncForCurrentSession=async()=>{};window.__profNavigate=navigate;navigate('/profissional/home');
   });
   await proPage.getByRole('heading',{name:'Desbloqueie pedidos grátis',exact:true}).waitFor();
   await proPage.locator('[data-qf13-card]').waitFor();
   assert.ok(await proPage.locator('[data-qf13]').evaluate(el=>el===el.parentElement.firstElementChild),'novidade no topo do início');
   await proPage.locator('[data-qf-home-job] [data-nav]').click();await proPage.locator('[data-qf13-desbloquear]').waitFor();
   const paid=proPage.locator('[data-action="desbloquear-chamada"]'),free=proPage.locator('[data-qf13-desbloquear]');assert.equal(await paid.isVisible(),true);assert.equal(await free.isVisible(),true);
   assert.ok(await free.evaluate(el=>el.closest('.qf-opts')!==null),'opções no mesmo grupo');if(width===1440){const a=await free.evaluate(el=>el.closest('.qf-opt').getBoundingClientRect().top),b=await paid.evaluate(el=>el.closest('.qf-opt').getBoundingClientRect().top);assert.ok(Math.abs(a-b)<2,'grátis e pago lado a lado no computador');}
   await proPage.screenshot({path:'/tmp/qf-prof13-opcoes-'+width+'.png',fullPage:true});
   await proPage.evaluate(()=>{window.__profNavigated=[];window.navigate=url=>window.__profNavigated.push(url);});await proPage.locator('[data-qf13-termos]').check();await free.click();await proPage.waitForFunction(()=>window.__profNavigated.length>0);assert.match((await proPage.evaluate(()=>window.__profNavigated))[0],/profissional\/chat/);
   await proPage.evaluate(()=>window.__profNavigate('/profissional/carteira'));await proPage.locator('[data-qf13-row]').waitFor();assert.ok(await proPage.locator('[data-qf13]').evaluate(el=>el===el.parentElement.firstElementChild),'prestação de contas no topo da carteira');
   await proPage.screenshot({path:'/tmp/qf-prof13-carteira-'+width+'.png',fullPage:true});await ctx.close();
   const ac=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});await ac.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const adm=await ac.newPage();await adm.goto(origin+'/admin.html');
   await adm.evaluate(()=>{
    const pedido={id:'00000000-0000-4000-8000-000000000990',cliente_id:'cliente-fixture',categoria:'cat_eletricista',titulo:'Tomada sem energia',descricao:'Descrição original que chega aos profissionais',cidade:'Santo André',uf:'SP',bairro:'Centro',endereco_completo:'Rua privada, 10',status:'aberto',criado_em:new Date().toISOString(),max_orcamentos:4,limite:4,participantes:0,preco_centavos:790,fotos:[]};
    DB.getSession=()=>({role:'admin',userId:'admin-fixture'});DB.adminById=()=>({id:'admin-fixture',nome:'Administrador'});QFAdminCloud.enabled=false;QFAdminCloud.client={rpc:async(n,a)=>({error:null,data:n==='qf_admin_espelho_profissionais'?{total:1,itens:[pedido],profissionais:[],profissional:null,estado:{ok:true,desbloqueio_gratuito_ativo:true},gerado_em:new Date().toISOString()}:n==='qf_comissao13_fechamentos_painel'?[]:{ok:true}})};navigate('/admin/espelho-profissionais');
   });
   const frame=adm.frameLocator('iframe[title="Espelho da tela do profissional"]');await frame.locator('[data-qf-home-job] [data-nav]').waitFor();assert.match(await frame.locator('[data-espelho-prof-leitura]').innerText(),/Descrição original que chega aos profissionais/);await frame.locator('[data-qf13-card]').waitFor();await frame.locator('[data-qf-home-job] [data-nav]').click();await frame.locator('[data-qf13-desbloquear]').waitFor();assert.equal(await frame.locator('[data-qf13-desbloquear]').isEnabled(),false,'espelho não desbloqueia pelo profissional');assert.equal(await frame.locator('[data-action="desbloquear-chamada"]').isEnabled(),false);await adm.screenshot({path:'/tmp/qf-espelho-prof-'+width+'.png',fullPage:true});await adm.evaluate(()=>navigate('/admin/comissao13'));await adm.getByText('Nenhum desbloqueio gratuito registrado.',{exact:true}).waitFor();await ac.close();
  }
  console.log('PASS profissional e espelho 390px/1440px: destaque no início, selo nos cartões, opções juntas, desbloqueio grátis e contas no topo; espelho bloqueia ações');
  console.log('PASS client UI at 390px and 1440px: QR read only, agreement and amount, explicit OTP consent, dispute and financial gate (isolated fixtures)');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{server.close();if(database)await database.close();});
