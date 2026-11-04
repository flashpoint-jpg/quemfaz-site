const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');
const root=path.resolve('dist');
class LocalAssets extends ResourceLoader{fetch(url){const u=new URL(url);if(u.hostname!=='quemfaz.test')return null;const f=path.join(root,u.pathname);return fs.existsSync(f)?Promise.resolve(fs.readFileSync(f)):null;}}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'seo-205-manifest.json')));
test('76 regiões normalizadas; só categorias cadastradas; canonical, formulário e sitemap coerentes',()=>{
 assert.equal(manifest.regions.length,76);
 const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
 for(const p of manifest.pages){const h=fs.readFileSync(path.join(root,p.url,'index.html'),'utf8');assert.ok(h.includes('href="https://quemfazservico.com.br'+p.url+'"'));assert.ok(!h.includes('data-qf-direct-organic'));if(p.service)assert.ok(h.includes('id="seo-order"'));if(p.city)assert.ok(h.includes('noindex,follow'));assert.equal(sitemap.includes('<loc>https://quemfazservico.com.br'+p.url+'</loc>'),p.index);}
 const redirects=JSON.parse(fs.readFileSync('vercel.json')).redirects;assert.ok(!redirects.some(r=>r.source.startsWith('/servicos/')));
});
test('HTML completo inicia o atendimento existente, sem chamada de escrita ou pedido fictício',async()=>{
 const errors=[],writes=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(fs.readFileSync(path.join(root,'servicos/eletricista/santo-andre/index.html'),'utf8'),{url:'https://quemfaz.test/servicos/eletricista/santo-andre/',runScripts:'dangerously',resources:new LocalAssets(),pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
 w.fetch=async(url,opts={})=>{if(opts.method&&opts.method!=='GET')writes.push(String(url));return new Response(JSON.stringify([]),{status:200,headers:{'content-type':'application/json'}});};
 w.Response=Response;w.Request=Request;w.Headers=Headers;w.AbortController=AbortController;w.matchMedia=()=>({matches:false,addListener(){},addEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.crypto.randomUUID=require('node:crypto').randomUUID;
 }});
 try{await new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(dom.window.document.querySelector('#seo-description')){clearInterval(t);resolve();}else if(++n>150){clearInterval(t);reject(Error('Form não iniciou: '+errors.join('\n')+'\n'+dom.window.document.getElementById('seo-order').textContent));}},20);});
 dom.window.document.querySelector('#seo-problem').value='Minha tomada está com defeito e precisa de reparo';dom.window.document.querySelector('#seo-description').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 assert.ok(dom.window.QFCloud?.createCall);assert.ok(dom.window.QFClienteAcesso?.authenticate);assert.equal(dom.window.document.querySelector('[data-qf-atendimento]').dataset.mounted,'1');assert.match(dom.window.document.querySelector('#seo-order').textContent,/Li e concordo/);assert.equal(writes.filter(x=>/qf_chamados|publicar|cliente-conta/.test(x)).length,0);
 assert.deepEqual(errors.filter(x=>!x.includes('navigation')&&!x.includes('Not implemented')),[]);
 }finally{dom.window.close();}
});
