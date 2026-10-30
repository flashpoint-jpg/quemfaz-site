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
  const read=()=>page.evaluate(()=>{const f=document.querySelector('#cadastro-prof-form');const g=f.querySelector('.qf-cad-planos');return {plans:[...f.querySelectorAll('[name=planoEscolhido]')].map(e=>e.value),visible:!!g&&getComputedStyle(g).display!=='none',trial:f.elements.testeLivre?.checked,button:f.querySelector('[data-cad-criar]').textContent,note:f.querySelector('[data-plano-nota]').textContent,text:f.textContent};});
  const initial=await read();
  assert.deepEqual(initial.plans,['avulso','livre']);
  assert.equal(initial.visible,true);
  assert.equal(initial.trial,true);
  assert.match(initial.button,/teste grátis/);
  assert.match(initial.text,/menos de R\$ 1,50\/dia/i);
  assert.match(initial.text,/Recarga mínima obrigatória.*R\$ 13,00/i);
  await page.evaluate(()=>document.querySelector('[name=planoEscolhido][value="avulso"]').click());
  const avulso=await read();
  assert.equal(avulso.trial,false);
  assert.match(avulso.button,/Ativar Avulso.*R\$ 13,00/);
  assert.match(avulso.note,/Pix ou cartão/);
  await page.evaluate(()=>document.querySelector('[name=planoEscolhido][value="livre"]').click());
  const livre=await read();
  assert.equal(livre.trial,false);
  assert.match(livre.button,/Livre por Pix.*R\$ 39,90/);
  assert.match(livre.note,/Pix é gerado no próximo passo/);
  await page.evaluate(()=>document.querySelector('[name=testeLivre]').click());
  assert.match((await read()).button,/teste grátis/);
  assert.deepEqual(errors,[]);console.log('PASS cadastro '+width+'px: Livre, Avulso e teste opcional com CTA correspondente e sem cobrança automática.');
  await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
