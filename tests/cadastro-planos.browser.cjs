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
  // Novos cadastros recebem 48h de teste gratuito. Preços pertencem às ofertas posteriores.
  const initial=await read();
  assert.deepEqual(initial.plans,['avulso','livre']);
  assert.match(initial.button,/Concluir cadastro e começar teste grátis/);
  assert.match(initial.note,/2 dias com desbloqueios ilimitados/);
  assert.match(initial.note,/Nenhum Pix para começar/);
  assert.match(initial.text,/R\$ 39,90/);
  assert.doesNotMatch(initial.button,/pagamento|Pagar/i);
  // Selecionar avulso durante o cadastro não deve disparar cobrança nem remover o teste inicial.
  await page.evaluate(()=>document.querySelector('[name=planoEscolhido][value="avulso"]').click());
  const afterChoice=await read();
  assert.match(afterChoice.button,/começar teste grátis/);
  assert.match(afterChoice.note,/Nenhum Pix para começar/);
  assert.doesNotMatch(afterChoice.button,/pagamento|Pagar/i);
  assert.deepEqual(errors,[]);console.log('PASS cadastro construído '+width+'px: escolha de plano preservada e teste gratuito sem cobrança inicial.');
  await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
