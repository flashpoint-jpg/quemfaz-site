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
   window.QFCloud.client.rpc=async(name,args)=>{if(name!=='qf_publicar_atendimento')throw Error('Unexpected fixture RPC: '+name);return fetch('/__rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)}).then(r=>r.json());};
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
  await page.waitForFunction(()=>window.__nav.length===1 || document.querySelector('[data-at-error]')?.textContent);
  assert.equal(await page.locator('[data-at-error]').textContent(),'');
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
  await page.waitForSelector('[data-qf-atendimento] #at-servico');
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
  await page.waitForFunction(()=>window.__nav.length===2);
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
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{server.close();if(database)await database.close();});
