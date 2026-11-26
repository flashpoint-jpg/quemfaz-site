const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setImmediate(r));
function setup(fail=''){
 const routes=['dashboard','servicos','profissionais','financeiro','suporte','comunicados','configuracoes','desbloqueios','planos'];
 const dom=new JSDOM('<aside><div class="qf-adm-site"></div><nav class="qf-adm-nav">'+routes.map(r=>'<button data-nav="/admin/'+r+'"><span>'+r+'</span></button>').join('')+'</nav></aside><main><div class="view"><p>Relatórios existentes</p></div></main>',{runScripts:'outside-only',url:'https://example.test/admin.html'}),w=dom.window;
 const now=new Date().toISOString();
 w.DB={allRequests:()=>[{id:'order-1',clienteId:'client-1',criadoEm:'2026-11-21T13:29:00Z',categoriaId:'montador',statusDb:'aberto',endereco:{cidade:'São Paulo'},desbloqueios:[{profissionalId:'pro-1',valor:800,ativo:true,criadoEm:now},{profissionalId:'pro-2',valor:800,ativo:false,criadoEm:now}]},{id:'order-2',clienteId:'client-2',criadoEm:'2026-11-20T17:30:00Z',titulo:'Pedreiro',statusDb:'cancelado'}],clienteById:id=>({nome:id==='client-1'?'Matheus Teste':'Karen Teste'}),profissionalById:id=>({nome:id==='pro-1'?'Carlos <Oliveira>':'Ana'}),categoryById:id=>id==='montador'?{nome:'Montador de móveis'}:undefined,state:{}};
 w.DB.state.users={profissionais:[
  {id:'pro-new',nome:'Manoel <Teste>',criadoEm:now,categorias:['montador','Eletricista','Eletricista'],cidadeNome:'São Bernardo do Campo',uf:'SP'},
  {id:'pro-old',nome:'Ana',criadoEm:'2026-01-12T03:15:00Z'},
  {id:'pro-invalid',nome:'Data incompleta',criadoEm:null}
 ]};
 w.Screens={};w.QFAdminCloud={syncSnapshot:async()=>{if(fail==='snapshot')throw Error('offline');return {};},syncSupport:async()=>[{id:'ticket-1',usuario_id:'pro-1',assunto:'Saldo',status:'aberto',criado_em:now}],client:{rpc:async(name)=>{if(fail===name)return {error:{message:'offline'}};return {data:name==='qf_admin_contabilidade'?{ok:true,desbloqueios:{saldo_qtd:1}}:name==='qf_admin_balanco'?{ok:true,entradas_centavos:2000}:{ok:true,movimentos:[{tipo:'recarga',quem:'Ana',centavos:2000,em:now,rota:'/admin/profissionais/pro-2'},{tipo:'desbloqueio',quem:'Carlos',centavos:800,em:now}]}};}}};
 w.eval(fs.readFileSync('qf-admin-dashboard.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));w.Screens.afterRender('/admin/dashboard',w.document.querySelector('main'));return {dom,w};
}
test('cartões usam dados reais e não somam desbloqueio como novo pagamento',async()=>{const {w}=setup();try{await tick();const value=k=>w.document.querySelector('[data-qfd-stat="'+k+'"]').textContent;assert.equal(value('open'),'1');assert.equal(value('unlocks'),'1');assert.equal(value('support'),'1');assert.match(value('paid'),/20,00/);assert.equal(w.document.querySelectorAll('.qfd-event.green').length,1);assert.equal(w.document.querySelectorAll('[data-qfd-unlocks] tr').length,1);assert.match(w.document.querySelector('[data-qfd-unlocks]').textContent,/Carlos <Oliveira>/);assert.equal(w.document.querySelectorAll('olivera').length,0);assert.equal(w.document.querySelectorAll('.qf-adm-nav [data-nav]').length,7);assert.ok(w.document.querySelector('.view').hidden);}finally{w.close();}});
test('busca e filtros mostram o responsável e mantêm acesso aos detalhes',async()=>{const {w}=setup();try{await tick();w.document.querySelector('[data-qfd-filter="payment"]').click();assert.equal(w.document.querySelectorAll('.qfd-event').length,1);assert.match(w.document.querySelector('.qfd-event').textContent,/Ana/);const input=w.document.querySelector('[data-qfd-search]');input.value='não existe';input.dispatchEvent(new w.Event('input'));assert.equal(w.document.querySelectorAll('.qfd-event').length,0);input.value='Carlos';input.dispatchEvent(new w.Event('input'));w.document.querySelector('[data-qfd-filter="unlock"]').click();assert.equal(w.document.querySelector('.qfd-event a').hash,'#/admin/servicos/order-1');w.Screens.afterRender('/admin/configuracoes',w.document.querySelector('main'));assert.ok(w.document.querySelector('[data-qfd-tools] a[href="#/admin/desbloqueios"]'));}finally{w.close();}});
test('falha de consulta não vira zero nem pagamento confirmado',async()=>{const {w}=setup('qf_admin_balanco');try{await tick();assert.equal(w.document.querySelector('[data-qfd-stat="paid"]').textContent,'—');assert.match(w.document.querySelector('[data-qfd-status]').textContent,/indisponíveis/);assert.equal(w.document.querySelector('[data-qfd]').getAttribute('aria-busy'),null);}finally{w.close();}});

test('pedidos recebidos mostram cliente e hora de Brasília, abrem detalhes e respeitam a busca',async()=>{
 const {w}=setup();
 try{
  await tick();
  const rows=[...w.document.querySelectorAll('[data-qfd-orders] a')];
  assert.equal(rows.length,2);
  assert.match(rows[0].textContent,/Matheus Teste.*21\/11\/2026.*10:29/);
  assert.equal(rows[0].hash,'#/admin/servicos/order-1');
  assert.equal(rows[1].hash,'#/admin/servicos/order-2');
  assert.equal(w.document.querySelector('[data-servicos-tab="abertos"]').hash,'#/admin/servicos');
  const fold=w.document.querySelector('.qfd-fold-panel');
  assert.equal(fold.open,false);
  fold.querySelector('summary').click();
  assert.equal(fold.open,true);
  const search=w.document.querySelector('[data-qfd-search]');
  search.value='karen';
  search.dispatchEvent(new w.Event('input'));
  assert.equal(w.document.querySelector('[data-qfd-orders] a').hash,'#/admin/servicos/order-2');
 }finally{w.close();}
});


test('novos profissionais mostram data completa, profissões e acesso ao cadastro',async()=>{
 const {w}=setup();
 try{
  await tick();
  const list=w.document.querySelector('[data-qfd-registrations]');
  const rows=[...list.querySelectorAll('a')];
  assert.equal(rows.length,2);
  assert.match(rows[0].textContent,/Manoel <Teste>.*Montador de móveis.*Eletricista.*São Bernardo do Campo/);
  assert.equal(rows[0].hash,'#/admin/profissionais/pro-new');
  assert.match(rows[0].querySelector('time').textContent,/\d{2}\/\d{2}\/\d{4}.*\d{2}:\d{2}/);
  assert.match(rows[1].textContent,/Profissão não informada.*12\/01\/2026.*00:15/);
  assert.equal(w.document.querySelector('[data-qfd-registration-count]').textContent,'1 cadastro hoje');
  const search=w.document.querySelector('[data-qfd-search]');
  search.value='eletricista';
  search.dispatchEvent(new w.Event('input'));
  assert.deepEqual([...list.querySelectorAll('a')].map(a=>a.hash),['#/admin/profissionais/pro-new']);
 }finally{w.close();}
});

test('aviso de cadastro não mostra zero quando a consulta está indisponível',async()=>{
 const {w}=setup('snapshot');
 try{
  await tick();
  assert.match(w.document.querySelector('[data-qfd-registrations]').textContent,/Não foi possível consultar os cadastros/);
  assert.equal(w.document.querySelector('[data-qfd-registration-count]').textContent,'');
 }finally{w.close();}
});

test('Profissionais tem lista de inscritos no Plantão 24h e permite tentar novamente',async()=>{
 const {w}=setup();
 try{
  const content=w.document.querySelector('main');
  content.innerHTML='<div class="view"></div>';
  w.QFConnection={deadline:request=>request};
  let attempts=0;
  w.QFAdminCloud.client.rpc=async name=>{
   assert.equal(name,'qf_admin_plantao_profissionais');
   if(++attempts===1)return {error:{message:'offline'}};
   return {data:[
    {id:'pro-1',nome:'Ana <Teste>',cidade:'Santo André',uf:'SP',categorias:['montador'],inscrito_gratis:true,ativo:true,disponivel:true},
    {id:'pro-2',nome:'Carlos',categorias:[],plano_ativo:true,ativo:true,disponivel:false}
   ]};
  };
  w.Screens.afterRender('/admin/profissionais',content);
  const section=content.querySelector('[data-qfd-plantao]');
  assert.match(section.querySelector('summary').textContent,/Profissionais do Plantão 24h/);
  assert.equal(attempts,0);
  section.open=true;
  await new Promise(resolve=>section.addEventListener('toggle',resolve,{once:true}));
  await tick();
  const status=section.querySelector('[role="status"]');
  assert.match(status.textContent,/Não foi possível/);
  section.querySelector('button').click();
  await tick();
  assert.match(status.textContent,/2 no plantão · 1 disponível/);
  const rows=section.querySelectorAll('a');
  assert.equal(rows[0].hash,'#/admin/profissionais/pro-1');
  assert.match(rows[0].textContent,/Ana <Teste>.*Santo André\/SP.*Disponível.*Inscrição gratuita/);
  assert.match(rows[1].textContent,/Indisponível.*24 Livre/);
 }finally{w.close();}
});
