// V11.43: ao finalizar, cliente e profissional dão nota para o QuemFaz.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),shots=process.env.QF_SHOTS||'/tmp';
const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://local').pathname);fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(data);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.QF_CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
try{const context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce',deviceScaleFactor:2});
for(const papel of ['cliente','profissional']){const page=await context.newPage();await page.setViewportSize({width:390,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
await page.goto('http://127.0.0.1:'+server.address().port+'/index.html?demo=1');await page.waitForFunction(()=>window.navigate&&window.DB&&window.QFPush);
const enviado=await page.evaluate((papel)=>{QFPush.needsPermission=()=>false;QFPush.isActive=()=>true;QFPush.refreshStatus=async()=>true;QFPush.permission=()=>'granted';DB.resetDemoData();
  window.__nota=null;QFCloud.enabled=false;
  const req=DB.allRequests().find(r=>r.profissionalId==='pro_carlos'&&r.status!=='cancelado');req.status=DB.STATUS.SERVICO_CONCLUIDO;req.avaliacaoCliente=null;req.avaliacaoProfissional=null;DB.persist();
  DB.setSession(papel==='cliente'?{role:'cliente',userId:req.clienteId}:{role:'profissional',userId:'pro_carlos'});navigate('/'+papel+'/pedido/'+req.id,true);PU.closeSheet();return req.id;},papel);
const pk=papel==='cliente'?'#cliente-star-picker':'#prof-star-picker';
await page.locator(pk+' [data-star="5"]').click();await page.locator('[data-action="'+(papel==='cliente'?'enviar-avaliacao':'enviar-avaliacao-cliente')+'"]').click();
await page.locator('#qf-nota-app').waitFor({state:'visible'});await page.waitForTimeout(500);assert.equal(await page.locator('#sheet-overlay').evaluate(e=>!e.classList.contains('is-hidden')),true,'a nota continua aberta depois de trocar de tela');
assert.match(await page.locator('#qf-nota-app').innerText(),/Que nota você dá para o QuemFaz\?/);
await page.locator('#qf-nota-app-enviar').click();assert.equal(await page.evaluate(()=>window.__nota),null,'sem estrela não envia');
await page.locator('#qf-nota-app-stars [data-star="4"]').click();await page.locator('#qf-nota-app-comentario').fill('Gostei do app');
await page.evaluate(()=>document.querySelectorAll('.toast').forEach(e=>e.remove()));await page.screenshot({path:shots+'/nota-'+papel+'.png'});
await page.evaluate(()=>{QFCloud.enabled=true;QFCloud.client={rpc:async(n,a)=>{window.__nota={n,a};QFCloud.enabled=false;return{data:{ok:true},error:null};}};});await page.locator('#qf-nota-app-enviar').click();await page.waitForFunction(()=>window.__nota);
assert.deepEqual(await page.evaluate(()=>window.__nota),{n:'qf_enviar_nota_app',a:{p_nota:4,p_comentario:'Gostei do app',p_chamado_id:enviado}});
await page.getByText('Você recomendaria o Quem Faz').waitFor();assert.deepEqual(errors,[]);console.log('PASS '+papel+': nota para o QuemFaz ao finalizar, envia e convida a recomendar');await page.close();}
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
