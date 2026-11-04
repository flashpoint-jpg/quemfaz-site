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
 // Publicação real em PostgreSQL isolado, usando o mesmo RPC e Cloud.createCall.
 const {db,as,uid}=require('./helpers/atendimento-db.cjs');const d=await db();
 try{
 await d.exec('reset role');await d.exec("create function private.qf13_iniciar_pedido(uuid,text) returns void language sql as $$select null::void$$;");await d.exec(fs.readFileSync('tests/fixtures/publicacao-production-20261027.sql','utf8'));await d.exec("update qf_profiles set telefone='11986427539',whatsapp='11986427539' where tipo='cliente'");await as(d,1);
 const w=dom.window,id=uid(1),profile={id,tipo:'cliente',nome:'Cliente Teste',telefone:'11986427539',whatsapp:'11986427539'};let signed=false,published=0;
 w.QFCloud.client.auth.getUser=async()=>({data:{user:signed?{id}:null},error:null});
 w.QFCloud.client.auth.verifyOtp=async()=>{signed=true;return {data:{user:{id}},error:null};};
 w.QFCloud.client.from=()=>({insert:async()=>({error:null}),upsert:async()=>({error:null}),update:()=>({eq:async()=>({error:null})}),select:()=>({eq:()=>({maybeSingle:async()=>({data:signed?profile:null,error:null})})})});
 Object.defineProperty(w.QFCloud.client,'functions',{configurable:true,value:{invoke:async(name)=>{assert.equal(name,'quemfaz-cliente-rapido');return {data:{ok:true,guest:true,token_hash:'local-fixture',user_id:id},error:null};}}});
 w.QFCloud.syncForCurrentSession=async()=>{w.DB.setSession({role:'cliente',userId:id});return {role:'cliente',userId:id};};
 w.QFCloud.client.rpc=async(name,args)=>{if(name==='qf_publicar_atendimento'){published++;try{return {data:(await d.query('select public.qf_publicar_atendimento($1::jsonb,$2::jsonb) r',[JSON.stringify(args.p_respostas),JSON.stringify(args.p_geo)])).rows[0].r,error:null};}catch(e){return {data:null,error:{message:e.message}};}}return {data:[],error:null};};
 w.QFGeo.geocodeCity=async()=>({latitude:-23.66,longitude:-46.53});w.QFGeo.geocodeBairro=w.QFGeo.geocodeCity;
 w.QFConnection.fetch=async()=>new Response(JSON.stringify({localidade:'Santo André',uf:'SP',bairro:'Centro'}),{headers:{'content-type':'application/json'}});
 w.fetch=async()=>new Response(JSON.stringify({localidade:'Santo André',uf:'SP',bairro:'Centro'}),{headers:{'content-type':'application/json'}});
 const values={aceite_app:'sim',cep:'09171000',bairro:'Centro',urgencia:'normal',materiais:'profissional',nome:'Cliente Teste',contato:'11986427539',intencao:'contratar',max_orcamentos:'4',autorizacao:'sim'};
 for(let n=0;n<16&&!w.document.querySelector('#seo-order h2')?.textContent.includes('Pedido publicado');n++){
 const form=w.document.querySelector('[data-at-question] form');assert.ok(form,'form continua montado');
 const input=form.querySelector('input[id^="at-"],textarea[id^="at-"],select[id^="at-"]');
 if(input){const k=input.id.slice(3);if(input.type==='checkbox')input.checked=true;else input.value=values[k]||input.value;}
 else {const radio=[...form.querySelectorAll('input[type=radio]')].find(x=>x.value===values[x.name.slice(3)]);assert.ok(radio,'alternativa disponível');radio.checked=true;}
 await form.onsubmit({preventDefault(){}});
 const alerts=[...form.querySelectorAll('[data-error],[data-at-error]')].map(e=>e.textContent).filter(Boolean);assert.deepEqual(alerts,[]);
 }
 await new Promise(resolve=>{let n=0;const t=setInterval(()=>{if(w.document.querySelector('#seo-order h2')?.textContent.includes('Pedido publicado')||++n>150){clearInterval(t);resolve();}},20);});
 assert.equal(published,1,w.document.querySelector('#seo-order').textContent);assert.match(w.document.querySelector('#seo-order').textContent,/Pedido publicado/);
 const rows=(await d.query("select id,descricao,cidade from public.qf_chamados where descricao like '%Minha tomada%'")).rows;assert.equal(rows.length,1);assert.equal(rows[0].cidade,'Santo André');assert.equal(w.DB.state.requests[0].id,rows[0].id,'pedido acessível ao painel pelo registro oficial');
 }finally{await d.close();}
 assert.deepEqual(errors.filter(x=>!x.includes('navigation')&&!x.includes('Not implemented')),[]);
 }finally{dom.window.close();}
});
