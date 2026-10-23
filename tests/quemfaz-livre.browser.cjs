const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
(async()=>{
 const server=http.createServer((req,res)=>{const f=path.join(process.cwd(),'dist',decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!f.startsWith(path.join(process.cwd(),'dist'))){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(f));}catch(_){res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try{
  const p=await browser.newPage({viewport:{width:390,height:844}});
  await p.goto('http://127.0.0.1:'+server.address().port+'/#/auth/profissional/cadastro');
  await p.getByRole('button',{name:'Assinar por R$ 39,90',exact:true}).waitFor();
  assert.equal(await p.locator('[data-qf-livre]').count(),1);assert.ok(await p.locator('[data-qf-livre]').evaluate(el=>el.getBoundingClientRect().width<=390));
  await p.getByRole('button',{name:'Assinar por R$ 39,90',exact:true}).click();await p.getByText('Conclua seu cadastro para contratar o plano com segurança.').waitFor();
  await p.screenshot({path:'/tmp/qf-livre-cadastro-mobile.png',fullPage:false});
  for(const route of ['/profissional/home','/profissional/carteira','/profissional/pedido/:id']){
   await p.goto('about:blank');await p.setContent('<div id="app-content"><div class="view"><button data-action="desbloquear-chamada">Desbloquear por créditos</button></div></div>');
   await p.evaluate(()=>{window.Screens={};window.fixtureActive=false;window.fixtureCalls=[];window.fixtureNav='';window.QFCloud={client:{rpc:async(n,a)=>{fixtureCalls.push({n,a});if(n==='qf_livre_status')return {data:{ok:true,ativo:fixtureActive,valido_ate:fixtureActive?'2026-12-01':null}};if(n==='qf_livre_solicitar_pix')return {data:{ok:true,recarga_id:'fixture'}};return {data:{ok:true}};},functions:{invoke:async()=>({data:{ok:true,pix_copy_paste:'fixture-copy-pix',qr_image:'data:image/png;base64,AAAA'}})}},syncForCurrentSession:async()=>{}};window.DB={requestById:()=>({atendimentoTipo:'tradicional',modalidade:'padrao'})};window.navigate=r=>fixtureNav=r;});
   await p.addScriptTag({path:'dist/qf-livre.js'});await p.evaluate(route=>QFLivre.enhance(route,document.getElementById('app-content'),{id:'call-fixture'}),route);
   await p.getByRole('button',{name:'Assinar por R$ 39,90',exact:true}).click();await p.locator('textarea').waitFor();assert.equal(await p.locator('textarea').inputValue(),'fixture-copy-pix');
   await p.evaluate(()=>fixtureActive=true);await p.getByRole('button',{name:'Verificar ativação'}).click();await p.getByRole('heading',{name:'Plano ativo — desbloqueios ilimitados'}).waitFor();
   if(route.includes('pedido')){await p.locator('[data-qf-livre-termos]').check();await p.locator('[data-qf-livre-desbloquear]').click();assert.equal(await p.evaluate(()=>fixtureNav),'/profissional/chat/call-fixture');assert.equal(await p.locator('[data-action="desbloquear-chamada"]').count(),1);}
   assert.ok(await p.locator('[data-qf-livre]').evaluate(el=>el.getBoundingClientRect().right<=390));
  }
  console.log('PASS mobile 390px: cadastro real, home/carteira/pedido, Pix, confirmação pelo status, plano ativo, desbloqueio, créditos preservados.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
