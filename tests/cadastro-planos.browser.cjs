/* Teste visual/funcional da etapa 5 com três opções. Sem rede externa e sem cobranças. */
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
  await page.waitForFunction(()=>window.QFLivre?.installed&&document.querySelector('#cadastro-prof-form .qf-options-final'));
  // Exibir a etapa 5 na simulação, sem criar conta ou pular a validação real do aplicativo.
  await page.evaluate(()=>{const f=document.querySelector('#cadastro-prof-form');f.querySelectorAll('[data-step]').forEach(s=>{s.hidden=s.dataset.step!=='5';});});
  const read=()=>page.evaluate(()=>{
   const f=document.querySelector('#cadastro-prof-form'),cards=f.querySelector('.qf-options-final'),old=f.querySelector('.qf-cad-planos');
   return {
    plans:[...f.querySelectorAll('[name=planoEscolhido]')].map(e=>e.value),
    oldHidden:!!old&&getComputedStyle(old).display==='none',
    trial:f.elements.testeLivre?.checked,
    buttons:[...cards.querySelectorAll('[data-qf-opcao]')].map(e=>({option:e.dataset.qfOpcao,text:e.textContent})),
    text:cards.textContent,
    mobileFits:cards.scrollWidth<=document.documentElement.clientWidth+2
   };
  });
  const initial=await read();
  assert.deepEqual(initial.plans,['avulso','livre']);
  assert.equal(initial.oldHidden,true);
  assert.equal(initial.trial,true);
  assert.deepEqual(initial.buttons.map(x=>x.option),['trial','livre','avulso']);
  assert.match(initial.text,/Teste grátis.*48 horas/i);
  assert.match(initial.text,/R\$ 39,90/);
  assert.match(initial.text,/R\$ 13,00/);
  assert.match(initial.text,/R\$ 1,33 por dia/);
  assert.match(initial.text,/recarga mínima obrigatória/i);
  assert.equal(initial.mobileFits,true);
  await page.evaluate(()=>{
    const form=document.querySelector('#cadastro-prof-form');
    form.requestSubmit=()=>{window.__opcaoEscolhida={plano:new FormData(form).get('planoEscolhido'),teste:new FormData(form).get('testeLivre')==='sim'};};
  });
  await page.locator('[data-qf-opcao=trial]').click();
  assert.deepEqual(await page.evaluate(()=>window.__opcaoEscolhida),{plano:'livre',teste:true});
  await page.locator('[data-qf-opcao=livre]').click();
  assert.deepEqual(await page.evaluate(()=>window.__opcaoEscolhida),{plano:'livre',teste:false});
  await page.locator('[data-qf-opcao=avulso]').click();
  assert.deepEqual(await page.evaluate(()=>window.__opcaoEscolhida),{plano:'avulso',teste:false});
  assert.deepEqual(errors,[]);
  console.log('PASS cadastro '+width+'px: três cartões, opções corretas, sem overflow e sem cobranças.');
  await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
