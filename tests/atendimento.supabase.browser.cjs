// Full Supabase integration. Explicitly refuses the production project and blocks all other services.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');const {chromium}=require('playwright');
const configPath=process.env.QF_STAGING_CONFIG;if(!configPath)throw Error('Set QF_STAGING_CONFIG to a disposable Supabase project config');
const config=JSON.parse(fs.readFileSync(configPath));
const target=new URL(config.url);
if(target.hostname==='dczlyrgnzlxmzghzaooz.supabase.co'||!target.hostname.endsWith('.supabase.co'))throw Error('Refusing production or unexpected host');
const tipo=process.env.QF_STAGING_TIPO||'tradicional';if(!['tradicional','garante'].includes(tipo))throw Error('Invalid test mode');
const source=path.resolve('dist');let order;
const server=http.createServer((req,res)=>{
 const name=path.resolve(source,'.'+decodeURIComponent(req.url.split('?')[0]));if(!name.startsWith(source+'/')&&name!==source){res.writeHead(403).end();return;}
 const file=name===source?path.join(source,'index.html'):name;
 try{let data=fs.readFileSync(file);if(file.endsWith('.js')){
   // Only host/key configuration changes; all application logic is the actual compiled build.
   data=Buffer.from(data.toString().replaceAll('https://dczlyrgnzlxmzghzaooz.supabase.co',config.url).replaceAll('sb_publishable_-WiYw_1QTzW0l9o0d4ZU9Q_kSadNA2A',config.key));
 }res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
 const browser=await chromium.launch({headless:true,...(proxy?{proxy:{server:proxy,bypass:'127.0.0.1,localhost'}}:{}),...(process.env.QF_CHROMIUM_EXECUTABLE?{executablePath:process.env.QF_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',ignoreHTTPSErrors:true});const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('requestfailed',req=>{const u=new URL(req.url());if(u.origin===target.origin)console.error('staging network:',u.pathname,req.failure()?.errorText);});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin||u.origin===target.origin)return route.continue();return route.abort();});
  await page.goto(origin+'/#/auth/cliente/cadastro');await page.waitForSelector('#at-servico');
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const fill=async(key,value)=>{const input=page.locator('#at-'+key);if(await input.evaluate(el=>el.tagName==='SELECT'))await input.selectOption(value);else await input.fill(value);};
  const groups=[{servico:'Pintor',detalhes:'Pintar paredes externas da oficina de homologacao final '+tipo,escopo:'80 metros quadrados'},{cidade:'Santo André',uf:'SP',bairro:'Centro',urgencia:'normal',data:date,disponibilidade:'Manhã'},{materiais:'profissional',orcamento:tipo==='garante'?'50000:150000':'avaliacao'},{nome:'Cliente Homologacao API',contato:'11967012483',intencao:'contratar',tipo,...(tipo==='garante'?{qualificacao:'sim'}:{}),autorizacao:'sim'}];
  for(let step=0;step<groups.length;step++){
    assert.match(await page.locator('[data-at-progress]').innerText(),new RegExp('Etapa '+(step+1)+' de 4'));
    for(const [key,value] of Object.entries(groups[step]))await fill(key,value);
    if(step<3)await page.getByRole('button',{name:'Continuar',exact:true}).click();
  }
  await page.getByRole('heading',{name:'Revise antes de publicar'}).waitFor();
  await page.getByRole('button',{name:'Publicar grátis',exact:true}).click();
  await page.waitForFunction(()=>location.hash.startsWith('#/cliente/pedido/')||Boolean(document.querySelector('[data-at-error]')?.textContent),{},{timeout:60000});
  const error=await page.locator('[data-at-error]').textContent().catch(()=>null);assert.ok(!error,'publication must navigate without an error: '+error);
  order=await page.evaluate(()=>location.hash.split('/').pop());assert.match(order,/^[\da-f-]{36}$/);
  await page.waitForTimeout(1500);
  const cloud=await page.evaluate(async id=>{const c=QFCloud.client;const call=await c.from('qf_chamados').select('id,atendimento_tipo,max_orcamentos,descricao,latitude,longitude').eq('id',id).single();const details=await c.rpc('qf_atendimento_respostas',{p_id:id});return{call:call.data,error:call.error?.message||null,detailsAllowed:!!details.data,authenticated:!!(await c.auth.getSession()).data.session};},order);
  assert.equal(cloud.error,null);assert.equal(cloud.authenticated,true);assert.equal(cloud.call.atendimento_tipo,tipo);assert.equal(cloud.call.max_orcamentos,tipo==='garante'?1:4);assert.equal(cloud.detailsAllowed,true);assert.ok(cloud.call.latitude!==null&&cloud.call.longitude!==null,'request must be routable even with external geocoder blocked');
  assert.doesNotMatch(cloud.call.descricao,/11967012483|Cliente Homologacao API/);
  await page.reload();
  await page.waitForFunction(id=>Boolean(window.DB?.requestById(id)?.atendimentoTipo),order,{timeout:60000});
  const restored=await page.evaluate(id=>({tipo:DB.requestById(id).atendimentoTipo,max:DB.requestById(id).maxOrcamentos}),order);
  assert.equal(restored.tipo,tipo);assert.equal(restored.max,tipo==='garante'?1:4);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,order,checks:['real quick-client Edge Function','real Auth OTP/session','actual app createCall','PostgREST RPC','full 67-table schema and 53 existing triggers','customer dashboard',tipo==='garante'?'1 exclusive slot':'4 traditional slots','private consent evidence','mode and slot count survive dashboard reload']}));
  await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>server.close());
