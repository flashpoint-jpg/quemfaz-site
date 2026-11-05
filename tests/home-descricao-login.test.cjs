const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(require.resolve('../qf-pedido-home.js'),'utf8');
function page(search=''){
 const dom=new JSDOM('<!doctype html><html><body><div data-landing-service-form><input data-landing-service-search></div></body></html>',{url:'https://quemfazservico.com.br/?demo=1'+search});
 const w=dom.window;
 const categories=[
  {id:'cat_pedreiro',nome:'Pedreiro'},
  {id:'cat_pintor',nome:'Pintor'},
  {id:'cat_eletricista',nome:'Eletricista'},
  {id:'cat_desentupidor',nome:'Desentupidor'},
  {id:'cat_geladeira',nome:'Técnico de geladeira'},
  {id:'cat_outros',nome:'Outros'}
 ];
 let last=null;
 w.setInterval=()=>0;
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.DB={categories:()=>categories,categoryById:id=>categories.find(c=>c.id===id)};
 w.QFAtendimento={html:()=>'<div data-next-step>Próxima etapa</div>',mount:(node,args)=>{last=args;}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../qf-client-acquisition.js'),'utf8'),{
  window:w,document:w.document,location:w.location,sessionStorage:w.sessionStorage,
  URLSearchParams,URL,Node:w.Node,MutationObserver:w.MutationObserver,Event:w.Event,console
 });
 vm.runInNewContext(source,{window:w,console},{filename:'qf-pedido-home.js'});
 return {w,getNext:()=>last,close:()=>dom.window.close()};
}
test('entrada paga seleciona o serviço anunciado no card novo e avança sem repetir a escolha',()=>{
 const p=page('&utm_source=google&utm_medium=cpc&utm_campaign=qf_reformas_nov26&utm_content=200449555374&utm_term=pedreiro%20perto%20de%20mim');
 p.w.QFPedidoHome.start();
 assert.equal(p.w.document.querySelector('[data-landing-service-search]'),null);
 assert.equal(p.w.document.querySelector('#home-service-search').value,'Pedreiro');
 assert.equal(p.w.document.querySelector('#home-service').value,'cat_pedreiro');
 submit(p.w,'Preciso reparar o reboco de uma parede');
 assert.equal(p.getNext().service,'Pedreiro');
 p.close();
});
test('cliente pode trocar o serviço do anúncio antes de continuar',()=>{
 const p=page('&servico=pedreiro');p.w.QFPedidoHome.start();
 const search=p.w.document.querySelector('#home-service-search');
 search.value='Pintor';search.dispatchEvent(new p.w.Event('input',{bubbles:true}));
 submit(p.w,'Preciso pintar a parede da sala');
 assert.equal(p.getNext().service,'Pintor');p.close();
});
test('campanha de profissionais não escolhe serviço no pedido do cliente',()=>{
 const p=page('&utm_source=google&utm_medium=cpc&utm_campaign=profissionais&utm_term=pedreiro');
 p.w.QFPedidoHome.start();
 assert.equal(p.w.document.querySelector('#home-service-search').value,'');p.close();
});
test('interação com o campo de serviço entra na medição sem enviar texto digitado',()=>{
 const p=page();const events=[];
 p.w.QFClientAcquisition.track=(name,detail)=>events.push({name,detail});
 p.w.QFPedidoHome.start();const search=p.w.document.querySelector('#home-service-search');
 search.dispatchEvent(new p.w.Event('focus'));search.value='pedreiro';
 search.dispatchEvent(new p.w.Event('input',{bubbles:true}));
 assert.deepEqual(events.map(e=>e.name),['home_focus','home_type']);
 assert.ok(!JSON.stringify(events).includes('pedreiro'));p.close();
});
function submit(w,description,category){
 if(category)w.document.querySelector("#home-service").value=category;
 const textarea=w.document.querySelector('#home-problem');
 textarea.value=description;
 textarea.dispatchEvent(new w.Event('input',{bubbles:true}));
 w.document.querySelector('[data-home-problem]').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
}
test('profissão escolhida preserva a descrição e não pede o serviço novamente',()=>{
 const p=page();p.w.QFPedidoHome.start();
 submit(p.w,'rebocar parede','cat_pedreiro');
 assert.equal(p.getNext().service,'Pedreiro');
 assert.equal(p.getNext().problem,'rebocar parede');
 assert.equal(p.w.document.querySelector('[data-home-type]'),null);
 p.close();
});
test('descrição sem profissão pede escolha explícita sem criar Outros serviços',()=>{
 const p=page();p.w.QFPedidoHome.start();
 submit(p.w,'Preciso de ajuda em casa urgente');
 assert.equal(p.getNext(),null);
 assert.equal(p.w.document.querySelector('#home-problem').value,'Preciso de ajuda em casa urgente');
 assert.match(p.w.document.querySelector('[role=alert]').textContent,/Digite o serviço/);
 assert.equal(p.w.document.querySelector('[data-home-type]'),null);
 p.close();
});
test('serralheiro selecionado mantém a descrição sobre soldar portão de ferro',()=>{
 const p=page();p.w.DB.categories().push({id:'cat_serralheiro',nome:'Serralheiro'});
 p.w.QFPedidoHome.start();
 submit(p.w,'conserto de portão soldar ferro','cat_serralheiro');
 assert.equal(p.getNext().service,'Serralheiro');
 assert.equal(p.getNext().problem,'conserto de portão soldar ferro');
 p.close();
});
test('catálogo sem serralheiro preserva o problema sem inventar serviço genérico',()=>{
 const p=page();p.w.QFPedidoHome.start();
 submit(p.w,'soldar portão de ferro');
 assert.equal(p.getNext(),null);
 assert.equal(p.w.document.querySelector('#home-problem').value,'soldar portão de ferro');
 assert.ok(p.w.document.querySelector('[role=alert]').textContent);
 p.close();
});
test('entrada por Google ou telefone é anunciada na tela inicial',()=>{
 const p=page();p.w.QFPedidoHome.start();
 const button=p.w.document.querySelector('[data-home-login-start]');
 assert.match(button.textContent,/telefone/);assert.equal(p.w.document.querySelector('[data-home-google]'),null);
 button.click();
 assert.match(p.w.document.querySelector('[data-home-work]').textContent,/telefone e senha/);
 assert.ok(p.w.document.querySelector('[data-home-login] input[type="tel"]'));
 p.close();
});

test('descrição informada evita perguntas repetidas sobre tipo e tamanho',()=>{
 const atendimento=require('../qf-atendimento.js');
 const a={servico:'Pedreiro',__servicePrefilled:true,__problem:'rebocar parede',detalhes:'parede',escopo:'avaliar'};
 const questions=atendimento.stages(a).flatMap(s=>s.questions.map(q=>q.key));
 assert.equal(questions.includes('servico'),false);
 assert.equal(questions.includes('detalhes'),false);
 assert.equal(questions.includes('escopo'),false);
 assert.equal(questions.includes('cidade'),true);
 assert.equal(questions.includes('contato'),true);
});
