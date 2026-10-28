/* Artefato publicado; todas as conexões externas são bloqueadas, sem cobrar. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve('dist');
const server=http.createServer((req,res)=>{
 const name=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
 if(name!==root&&!name.startsWith(root+path.sep))return res.writeHead(403).end();
 const file=name===root?path.join(root,'index.html'):name;
 try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.QF_CHROMIUM_EXECUTABLE});
 try{for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'});
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?app=1#/auth/profissional/cadastro');
  await page.waitForFunction(()=>window.QFLivre?.installed&&document.querySelector('[data-qf-livre-cadastro]'));
  const read=()=>page.evaluate(()=>{const f=document.querySelector('#cadastro-prof-form');return {plans:[...f.querySelectorAll('[name=planoEscolhido]')].map(e=>e.value),button:f.querySelector('[data-cad-criar]').textContent,note:f.querySelector('[data-plano-nota]').textContent,text:f.textContent};});
  assert.deepEqual((await read()).plans,['avulso','livre']);
  for(const [plan,price] of [['livre','39,90'],['avulso','13,00']]){
   await page.evaluate(plan=>{const e=document.querySelector('[name=planoEscolhido][value="'+plan+'"]');e.click();},plan);
   const state=await read();assert.ok(state.button.includes(price));assert.match(state.button,/pagamento/);
   assert.match(state.note,plan==='avulso'?/creditado integralmente/:/sem recarga de R\$ 13/);
   assert.doesNotMatch(state.text,/Criar conta grátis/);assert.match(state.text,/Os R\$ 13 viram saldo integral/);
  }
  assert.deepEqual(errors,[]);console.log('PASS cadastro construído '+width+'px: Avulso e Livre preservados, escolha e preços corretos, nenhuma ativação/cobrança.');
  await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
