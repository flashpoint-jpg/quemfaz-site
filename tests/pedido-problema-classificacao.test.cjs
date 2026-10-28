const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('Descrição do problema mantém categorias reais para encontrar profissionais',()=>{
 const names=['Eletricista','Encanador','Pintor','Limpeza de estofados','Diarista','Montador de móveis','Chaveiro','Ar-condicionado','Pedreiro'];
 const categories=names.map((nome,i)=>({id:'cat_'+i,nome}));
 const window={DB:{categories:()=>categories},setInterval:()=>0};vm.runInNewContext(fs.readFileSync('qf-pedido-home.js','utf8'),{window});
 for(const [problem,expected] of [['Minha torneira está vazando','Encanador'],['O chuveiro queimou','Eletricista'],['Preciso limpar meu sofá','Limpeza de estofados'],['Preciso pintar o quarto','Pintor'],['Montar um guarda-roupa','Montador de móveis'],['Minha casa precisa de faxina','Diarista']]){
  const found=window.QFPedidoHome.classify(problem);assert.equal(found[0].category.nome,expected);assert.ok(categories.some(c=>c.id===found[0].category.id));
 }
 assert.equal(window.QFPedidoHome.classify('Preciso de ajuda com alguma coisa').length,0);
});

// Usa o catálogo da home: a categoria enviada precisa ser a mesma dos profissionais.
const catalog=vm.runInNewContext(fs.readFileSync('index.html','utf8').match(/const categories = (\[[\s\S]*?\n    \]);/)[1]);
test('Problemas de aparelhos usam a categoria oficial, sem confundir sintomas genéricos',()=>{
 const window={DB:{categories:()=>catalog},setInterval:()=>0};
 vm.runInNewContext(fs.readFileSync('qf-pedido-home.js','utf8'),{window});
 for(const [problem,id] of [
  ['Computador não liga','cat_informatica'],['Meu notebook não liga mesmo na tomada','cat_informatica'],
  ['PC sem energia','cat_informatica'],['Preciso formatar meu computador','cat_informatica'],
  ['A impressora parou de imprimir','cat_informatica'],['Meu celular não liga','cat_celular'],
  ['Minha internet está caindo','cat_internet_redes'],['O Wi-Fi não conecta','cat_internet_redes'],
  ['Minha televisão não liga','cat_tv_som'],['Geladeira não liga','cat_geladeira'],
  ['A máquina de lavar não liga','cat_maquina_lavar'],['O chuveiro queimou','cat_eletricista']
 ]){
  const [best,second]=window.QFPedidoHome.classify(problem);
  assert.equal(best?.category.id,id,problem);
  assert.ok(best.score>=10&&(!second||best.score-second.score>=3),problem+' deve avançar automaticamente');
 }
 assert.equal(window.QFPedidoHome.classify('Não liga').length,0,'sintoma sem aparelho precisa de detalhes');
});

function home(categories=catalog){
 const {JSDOM}=require('jsdom');
 const dom=new JSDOM('<form data-landing-service-form></form>',{url:'https://example.test/',runScripts:'outside-only'});
 const w=dom.window,mounted=[];
 w.setInterval=()=>0;w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.DB={categories:()=>categories};
 w.QFAtendimento={html:()=>'<div data-qf-atendimento></div>',mount:(target,options)=>mounted.push(options)};
 w.eval(fs.readFileSync('qf-pedido-home.js','utf8'));
 const submit=(id,problem='')=>{
  w.QFPedidoHome.start();const input=w.document.querySelector('#home-problem');
  const category=categories.find(c=>c.id===id);
  if(category&&id!=='cat_outros'){
   const search=w.document.querySelector('#home-service-search');search.value=category.nome;search.dispatchEvent(new w.Event('input'));
   w.document.querySelector('[data-service-id="'+id+'"]')?.click();
  }
  input.value=problem;input.dispatchEvent(new w.Event('input'));
  input.form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 };
 return {dom,w,mounted,submit};
}

test('Todas as profissões do catálogo avançam com o nome oficial e descrição obrigatória',()=>{
 const {dom,w,mounted,submit}=home();
 try{
  const official=catalog.filter(c=>c.id!=='cat_outros');
  assert.ok(official.length>60,'audita o catálogo completo, não só as profissões comuns');
  w.QFPedidoHome.start();
  const options=[...w.document.querySelector('#home-service').options].filter(o=>o.value);
  assert.deepEqual(options.map(o=>o.value).sort(),Array.from(official,c=>c.id).sort());
  assert.ok(options.every(o=>!/^outros/i.test(o.textContent)));
  for(const category of official){
   const before=mounted.length;
   submit(category.id);assert.equal(mounted.length,before,category.nome+' exige descrição');
   submit(category.id,'Preciso consertar um equipamento com defeito');
   assert.equal(mounted.length,before+1,category.nome);
   assert.equal(mounted.at(-1).service,category.nome);
   assert.equal(mounted.at(-1).problem,'Preciso consertar um equipamento com defeito');
  }
 }finally{dom.window.close();}
});

test('Descrição nunca troca a profissão escolhida nem avança sem uma escolha válida',()=>{
 const {dom,w,mounted,submit}=home();
 try{
  for(const description of ['Computador não liga','Preciso de ajuda com alguma coisa','Meu computador e meu celular não ligam']){
   submit('',description);assert.equal(mounted.length,0);
   assert.equal(w.document.querySelector('#home-problem').value,description);
   assert.match(w.document.querySelector('[role=alert]').textContent,/Digite o serviço/);
   assert.equal(w.document.activeElement.id,'home-service-search');
  }
  submit('cat_informatica','Computador não liga');
  assert.equal(mounted.at(-1).service,'Técnico em informática');
  assert.equal(mounted.at(-1).problem,'Computador não liga');
  submit('cat_costureira','Preciso de ajuda com alguma coisa');
  assert.equal(mounted.at(-1).service,'Costureira');
  submit('cat_eletricista','Meu computador não liga');
  assert.equal(mounted.at(-1).service,'Eletricista','a descrição não sobrescreve a escolha');
  const before=mounted.length;
  for(const id of ['cat_outros','cat_inexistente']){submit(id,'Computador não liga');assert.equal(mounted.length,before);}
  for(const text of ['', '   ', 'oi', '1234567', 'x'.repeat(1501)]){
   submit('cat_informatica',text);assert.equal(mounted.length,before);
   assert.equal(w.document.activeElement.id,'home-problem');
   assert.equal(w.document.querySelector('#home-problem').required,true);
  }
  submit('cat_informatica','PC lento');assert.equal(mounted.length,before+1);
 }finally{dom.window.close();}
});

test('Profissão adicionada ao catálogo aparece na escolha e mantém seu nome com caracteres especiais',()=>{
 const category={id:'cat_personalizada',nome:'Reparos & acessórios "especializados"'};
 const {dom,w,mounted,submit}=home([...catalog,category,{id:'cat_custom_outros',nome:'Outros serviços'}]);
 try{
  submit(category.id,'Preciso ajustar um acessório');
  assert.equal(mounted[0].service,category.nome);
  w.QFPedidoHome.start();assert.equal(w.document.querySelector('option[value="cat_custom_outros"]'),null);
 }finally{dom.window.close();}
});

test('Busca mostra até cinco opções, reconhece apelidos e invalida a seleção ao editar',()=>{
 const {dom,w,mounted}=home();
 try{
  w.QFPedidoHome.start();const search=w.document.querySelector('#home-service-search'),select=w.document.querySelector('#home-service'),results=w.document.querySelector('#home-service-results');
  assert.equal(select.hidden,true);assert.equal(results.hidden,true);
  const type=text=>{search.value=text;search.dispatchEvent(new w.Event('input'));};
  type('computador');assert.ok(results.querySelector('[data-service-id="cat_informatica"]'));
  results.querySelector('[data-service-id="cat_informatica"]').click();assert.equal(select.value,'cat_informatica');assert.equal(search.value,'Técnico em informática');assert.equal(results.hidden,true);
  type('pint');assert.equal(select.value,'');assert.ok(results.querySelectorAll('button').length<=5);
  search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.ok(select.value);
  type('zzzz sem categoria');assert.equal(select.value,'');assert.equal(results.hidden,true);assert.match(w.document.querySelector('#home-service-hint').textContent,/Nenhum serviço/);
  w.document.querySelector('#home-problem').value='Meu computador não liga';search.form.dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(mounted.length,0);
  type('tecnico');assert.ok(results.querySelectorAll('button').length<=5);
  search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(results.hidden,true);
 }finally{dom.window.close();}
});
