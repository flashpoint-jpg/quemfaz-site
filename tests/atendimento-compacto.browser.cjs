// Formulários reais com respostas isoladas: nenhum cadastro de produção é alterado.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist');
const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://local').pathname.replace(/^\/$/,'/index.html'));fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);});});
(async()=>{
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{for(const width of [320,390,768]){
 const browser=await chromium.launch({executablePath:process.env.QF_CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process']});
 try{
 const page=await browser.newPage({viewport:{width,height:844},serviceWorkers:'block'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port+'/index.html?demo=1');await page.waitForFunction(()=>window.QFProfAtendimento&&window.QFPedidosGrupos);
 await page.evaluate(()=>{
  QFCloud.enabled=false;QFPush.needsPermission=()=>false;QFPush.isActive=()=>true;QFPush.refreshStatus=async()=>true;QFPush.permission=()=> 'granted';
  DB.resetDemoData();DB.setSession({role:'profissional',userId:'pro_carlos'});const u=DB.profissionalById('pro_carlos');
  Object.assign(u,{fotoUrl:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"></svg>',online:true,statusAprovacao:'aprovado',bloqueado:false,horarioInicio:'06:00',horarioFim:'22:00',tipoPessoa:'cpf',raioKm:54,areasAtendimento:[{cidade:'Muzambinho',uf:'MG',raioKm:54}],enderecoCadastro:null});
  QFCloud.client.rpc=async()=>({data:{ok:true,ativo:false},error:null});navigate('/profissional/home',true);PU.closeSheet();window.__writes=[];
 });
 const compact=page.locator('.qf-atd-compact:not(.qf-atd-activation)');await compact.waitFor();
 assert.equal(await compact.getAttribute('open'),null);assert.match(await compact.locator('summary').innerText(),/54 km[\s\S]*06h às 22h[\s\S]*1 pendência/);
 assert.ok((await compact.boundingBox()).height<90,'resumo compacto');
 await compact.locator('summary').click();await compact.locator('[data-prof-settings="area"]').click();
 await page.locator('#qf-atd-rapido').waitFor();assert.match(await page.locator('#qf-atd-rapido').innerText(),/Raio de atendimento/);
 await page.locator('[data-area-radius]').fill('70');await page.locator('#qf-atd-salvar').click();
 await compact.waitFor();assert.match(await compact.locator('summary').innerText(),/70 km/);assert.match(page.url(),/#\/profissional\/home$/);
 await compact.locator('summary').click();await compact.locator('[data-qf-horario-rapido]').click();
 await page.locator('#qf-hr-ini').fill('08:30');await page.locator('#qf-hr-fim').fill('18:00');
 await page.evaluate(()=>{QFCloud.client.rpc=async(name,args)=>{if(name==='qf_salvar_preferencias_chamado')window.__writes.push({name,args});return {data:{ok:true},error:null};};});
 await page.locator('#qf-hr-salvar').click();await compact.waitFor();assert.match(await compact.locator('summary').innerText(),/08h30 às 18h/);
 assert.equal(await page.evaluate(()=>__writes[0].name),'qf_salvar_preferencias_chamado');
 await compact.locator('summary').click();await compact.locator('[data-prof-settings="profissao"]').click();
 await page.locator('#qf-atd-cats').waitFor();await page.locator('#qf-atd-salvar').click();await compact.waitFor();assert.match(page.url(),/#\/profissional\/home$/);
 await compact.locator('summary').click();await compact.locator('[data-qf-cadastro-rapido]').click();
 await page.locator('#qf-cadastro-rapido').waitFor();assert.equal(await page.locator('#qf-cadastro-rapido [data-doc]').count(),0,'sem envio simulado');
 assert.equal(await page.locator('#prof-cadastro-update-form').isVisible(),true);
 await page.locator('[name=documento]').fill('11111111111');await page.locator('#prof-cadastro-update-form button[type=submit]').click();assert.equal(await page.evaluate(()=>__writes.length),1,'documento inválido não é salvo');
 await page.evaluate(()=>{
  const u=DB.profissionalById('pro_carlos');QFCloud.enabled=true;
  QFCloud.saveCpf=async()=>__writes.push({name:'saveCpf'});
  QFCloud.saveClientAddress=async address=>{__writes.push({name:'saveClientAddress'});u.enderecoCadastro=address;};
  QFCloud.syncForCurrentSession=async()=>{};
  QFCloud.client.auth.getUser=async()=>({data:{user:{id:u.id}},error:null});
  QFCloud.client.from=table=>({update:values=>({eq:async(key,id)=>{__writes.push({name:'updateProfile',table,key,id});Object.assign(u,{tipoPessoa:values.tipo_pessoa});return {error:null};}})});
 });
 const form=page.locator('#prof-cadastro-update-form');await form.locator('[name=documento]').fill('52998224725');
 for(const [name,value] of Object.entries({cep:'37890000',rua:'Rua de Teste',numero:'10',bairro:'Centro',cidade:'Muzambinho'}))await form.locator('[name='+name+']').fill(value);
 await form.locator('[name=uf]').selectOption('MG');await form.locator('button[type=submit]').click();
 await page.waitForFunction(()=>document.querySelector('#sheet-overlay').classList.contains('is-hidden'));
 assert.match(page.url(),/#\/profissional\/home$/);assert.doesNotMatch(await compact.locator('summary').innerText(),/pendência/);
 assert.deepEqual(await page.evaluate(()=>__writes.slice(1).map(x=>x.name)),['saveCpf','updateProfile','saveClientAddress']);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'sem overflow '+width);
 await page.evaluate(()=>{document.querySelector('.toast-stack')?.replaceChildren();window.scrollTo(0,0);});await page.screenshot({path:'/workspace/scratch/0385192a573b/atendimento-compacto-'+width+'.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS '+width+'px: resumo <90px, raio, horário, profissões, validação e salvamento cadastral na mesma página');
 }finally{await browser.close();}
}}finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
