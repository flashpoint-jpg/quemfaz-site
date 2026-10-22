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
  await page.waitForSelector('[data-qf-atendimento] #at-answer');
  assert.equal(await page.locator('#cadastro-cliente-form').count(),0);
  assert.equal(await page.locator('#at-answer:visible').count(),1);
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
  const values=['Faxina','Limpeza pesada de sala comercial','51 a 100 m²','Santo André','SP','Jardim do Estádio','urgente','300','profissional','2099-10-22','Manhã','Cliente Teste','11988887776','contratar','sim','garante','sim'];
  for(const value of values){
   assert.equal(await page.locator('#at-answer:visible').count(),1);
   const input=page.locator('#at-answer');if(await input.evaluate(el=>el.tagName==='SELECT'))await input.selectOption(value);else await input.fill(value);
   await page.getByRole('button',{name:'Continuar',exact:true}).click();
  }
  await page.getByRole('heading',{name:'Revise antes de publicar'}).waitFor();
  assert.equal(await page.locator('#at-answer').count(),0);
  assert.match(await page.locator('[data-qf-atendimento]').innerText(),/Não é garantia de contratação/);
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
  assert.equal(submissions[0].atendimento.tipo,'garante');assert.equal(submissions[0].atendimento.qualificacao,'sim');assert.equal(submissions[0].maxOrcamentos,1);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('qf_atendimento_key')),null);
  const stored=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));assert.doesNotMatch(stored,/11988887776|Cliente Teste|Limpeza pesada/,'assistant does not persist PII');
  const professionalPreview=await page.evaluate(()=>{
   const req=DB.state.requests.find(r=>r.atendimentoTipo==='garante');
   const prof={id:'fixture-pro',nome:'Profissional Teste',categorias:[req.categoriaId],online:true,statusAprovacao:'aprovado',bloqueado:false,creditos:100000};
   const doc=document.createElement('div');doc.innerHTML=Screens.profChamadaRender({id:req.id},prof);
   return {fee:doc.querySelector('.qf-unlock-simple .h1')?.textContent,expected:PU.formatCurrency(DB.leadFeeForRequest(req)*4),normalButton:!!doc.querySelector('[data-action="desbloquear-chamada"]'),exclusiveButton:!!doc.querySelector('[data-action="desbloquear-exclusivo"]'),planUpsell:!!doc.querySelector('.qf-plan-save')};
  });
  assert.equal(professionalPreview.fee,professionalPreview.expected);assert.equal(professionalPreview.normalButton,false);assert.equal(professionalPreview.exclusiveButton,true);assert.equal(professionalPreview.planUpsell,false);
  // Logged-in route also uses the same assistant and cannot render the old form.
  await page.evaluate(()=>{
   document.body.innerHTML='<main id="test-mount"></main>';
   const content=document.querySelector('main');content.innerHTML=QFAtendimento.html();
   Screens.afterRender('/cliente/novo-pedido/:catId',content,{catId:'cat_pintor'},{id:'fixture-client'});
  });
  await page.waitForSelector('[data-qf-atendimento] #at-answer');
  assert.equal(await page.locator('#novo-pedido-form').count(),0);
  assert.equal(await page.locator('#at-answer').inputValue(),'Pintor');
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  assert.match(await page.locator('label[for="at-answer"]').innerText(),/superfície/);
  assert.deepEqual(errors,[]);
  console.log('PASS browser: actual built router, one question, adapted profession, complete Garante → real createCall → RPC → isolated Postgres → exclusive debit, review, mobile, privacy and both entry points');
  await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{server.close();if(database)await database.close();});
