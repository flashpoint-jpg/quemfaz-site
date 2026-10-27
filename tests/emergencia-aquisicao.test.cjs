const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const code=fs.readFileSync('qf-pedido-home.js','utf8');
function home(search='',hash='#/'){
 const dom=new JSDOM('<div id="app-shell"><form data-landing-service-form><input data-landing-service-search></form><button data-desk-service="Eletricista">Eletricista</button><button data-home-services>Pedir grátis</button></div>',{url:'https://quemfazservico.com.br/'+search+hash,runScripts:'outside-only'}),g=dom.window;
 const categories=[{id:'cat_eletricista',nome:'Eletricista'},{id:'cat_geladeira',nome:'Técnico de geladeira'},{id:'cat_fogao_microondas',nome:'Técnico de fogão e micro-ondas'},{id:'cat_maquina_lavar',nome:'Técnico de máquina de lavar'}];
 g.Element.prototype.scrollIntoView=function(){};
 g.DB={categories:()=>categories,categoryById:id=>categories.find(c=>c.id===id)};
 g.PROAKI_APP={};g.QFClienteAcesso={};g.Screens={landing:()=>'',afterRenderAnon(){},afterRender(){}};g.navigate=()=>{};
 const mounts=[],events=[];g.QFAtendimento={html:()=>'<form data-mount></form>',mount:(el,args)=>mounts.push(args)};
 g.QFClientAcquisition={track:(...a)=>events.push(a),serviceFromLink:q=>new URLSearchParams(q).get('servico')};
 g.eval(code);return{dom,g,mounts,events};
}
test('atalhos usam o formulário atual, preservam profissão e não enviam descrição na medição',()=>{
 const {dom,g,mounts,events}=home();
 g.document.querySelector('[data-desk-service]').click();assert.equal(mounts.at(-1).service,'Eletricista');
 g.document.querySelector('[data-home-services]').click();const input=g.document.querySelector('#home-problem');assert.ok(input);
 input.value='Minha tomada está em curto';input.dispatchEvent(new g.Event('input'));
 g.document.querySelector('[data-home-problem]').dispatchEvent(new g.Event('submit',{cancelable:true}));
 assert.equal(mounts.at(-1).service,'Eletricista');assert.ok(events.some(e=>e[0]==='home_submit'));
 assert.ok(!JSON.stringify(events).includes('Minha tomada'));assert.equal(g.location.hash,'#/');dom.window.close();
});
test('link SEO abre diretamente a profissão em vez de descartar o parâmetro',()=>{
 const {dom,mounts}=home('?servico=cat_geladeira','#/auth/cliente/cadastro');assert.equal(mounts.at(-1).service,'Técnico de geladeira');dom.window.close();
});
test('fogão e micro-ondas não são classificados como geladeira ou lavadora',()=>{
 const {dom,g}=home();
 for(const text of ['Meu fogão não acende','Preciso consertar o micro-ondas','Meu forno não esquenta'])assert.equal(g.QFPedidoHome.classify(text)[0]?.category.id,'cat_fogao_microondas');
 for(const text of ['Geladeira não está gelando','Freezer parou de funcionar'])assert.equal(g.QFPedidoHome.classify(text)[0]?.category.id,'cat_geladeira');
 assert.equal(g.QFPedidoHome.classify('Minha máquina de lavar parou')[0]?.category.id,'cat_maquina_lavar');
 dom.window.close();
});
test('origem sem evidência de anúncio não é classificada automaticamente como paga',()=>{
 const html=fs.readFileSync('index.html','utf8'),block=html.match(/<script>\s*\/\* QF_MARKETING_ATTRIBUTION_V2[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g,'');
 for(const [search,medium,source] of [['?fbclid=organic123','', 'meta'],['?utm_source=chatgpt.com','', 'chatgpt.com'],['?utm_source=instagram&utm_medium=organic','organic','instagram'],['?gclid=ad123','cpc','google'],['?fbclid=ad123&utm_medium=paid_social','paid_social','meta']]){
  const dom=new JSDOM('',{url:'https://quemfazservico.com.br/'+search,runScripts:'outside-only'});dom.window.eval(block);assert.equal(dom.window.QFMarketingTouch.medium,medium);assert.equal(dom.window.QFMarketingTouch.source,source);dom.window.close();
 }
});
test('formulário atual mede etapas, falhas de acesso e de publicação sem respostas pessoais',()=>{
 const dom=new JSDOM('<main></main>',{url:'https://quemfazservico.com.br/',runScripts:'outside-only'}),g=dom.window,events=[];
 g.DB={categories:()=>[{id:'cat_eletricista',nome:'Eletricista'}],categoryById:()=>null};
 g.QFClientAcquisition={track:(...e)=>events.push(e)};
 g.eval(fs.readFileSync('qf-atendimento.js','utf8'));
 const target=g.document.querySelector('main');target.innerHTML=g.QFAtendimento.html();g.QFAtendimento.mount(target,{service:'Eletricista'},null);
 const form=()=>target.querySelector('form');
 form().dispatchEvent(new g.Event('submit',{cancelable:true}));assert.ok(events.some(e=>e[0]==='validation_error'));
 function answer(key,value){const el=target.querySelector('#at-'+key)||target.querySelector('[name="at-'+key+'"][value="'+value+'"]');assert.ok(el,key);if(el.type==='checkbox'||el.type==='radio')el.checked=true;else el.value=value;form().dispatchEvent(new g.Event('submit',{cancelable:true}));}
 for(const [k,v] of [['aceite_app','sim'],['detalhes','tomada'],['escopo','um']])answer(k,v);
 assert.ok(events.some(e=>e[0]==='step_service_completed'));assert.ok(events.some(e=>e[0]==='step_location_view'));assert.ok(!JSON.stringify(events).includes('tomada'));dom.window.close();
});
test('formulário atual publica no PostgreSQL local e apresenta o pedido salvo na própria página',async()=>{
 const {db,as,uid}=require('./helpers/atendimento-db.cjs');const d=await db();
 await d.exec('reset role');await d.exec('create function private.qf13_iniciar_pedido(uuid,text) returns void language sql as $$select null::void$$;');await d.exec(fs.readFileSync('tests/fixtures/publicacao-production-20261027.sql','utf8'));
 const dom=new JSDOM('<main></main>',{url:'https://quemfazservico.com.br/',runScripts:'outside-only'}),g=dom.window,events=[];let published;
 try{
  g.DB={categories:()=>[{id:'cat_eletricista',nome:'Eletricista'}],categoryById:()=>null};g.QFClientAcquisition={track:(...e)=>events.push(e)};
  g.QFClienteAcesso={authenticate:async()=>({id:uid(1)})};g.QFAcompanhamento={draft:()=> 'cliente-teste-segredo-local-123456789',remember(){}};
  g.QFCloud={enabled:true,createCall:async args=>{await as(d,1);return(await d.query('select public.qf_publicar_atendimento($1::jsonb,$2::jsonb) r',[JSON.stringify(args.atendimento),JSON.stringify({latitude:-23.66,longitude:-46.53})])).rows[0].r;}};
  g.QFPedidoHome={published:async req=>{published=req;g.document.querySelector('main').textContent='Pedido publicado';}};
  g.eval(fs.readFileSync('qf-atendimento.js','utf8'));const target=g.document.querySelector('main');target.innerHTML=g.QFAtendimento.html();g.QFAtendimento.mount(target,{service:'Eletricista'},null);
  for(const [key,value] of [['aceite_app','sim'],['detalhes','tomada'],['escopo','um'],['cidade','Santo André'],['uf','SP'],['bairro','Centro'],['urgencia','normal'],['materiais','profissional'],['nome','Cliente Teste'],['contato','11988887777'],['intencao','contratar'],['autorizacao','sim']]){
   const el=target.querySelector('#at-'+key)||target.querySelector('[name="at-'+key+'"][value="'+value+'"]');assert.ok(el,key);if(el.type==='checkbox'||el.type==='radio')el.checked=true;else el.value=value;target.querySelector('form').dispatchEvent(new g.Event('submit',{cancelable:true}));
  }
  for(let i=0;i<100&&!published;i++)await new Promise(r=>setTimeout(r,10));
  assert.ok(published?.id,target.textContent);assert.equal(target.textContent,'Pedido publicado');assert.equal(g.location.href,'https://quemfazservico.com.br/');
  await d.exec('reset role');const rows=await d.query('select categoria,status,max_orcamentos from qf_chamados where id=$1',[published.id]);assert.equal(rows.rows[0].categoria,'cat_eletricista');assert.equal(rows.rows[0].max_orcamentos,4);
  assert.ok(events.some(e=>e[0]==='submit'));assert.ok(!events.some(e=>e[0]==='publish_error'));
 }finally{dom.window.close();await d.close();}
});
