const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(require.resolve('../qf-pedido-home.js'),'utf8');
function page(){
 const dom=new JSDOM('<!doctype html><html><body><div data-landing-service-form><input data-landing-service-search></div></body></html>',{url:'https://quemfazservico.com.br/'});
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
 vm.runInNewContext(source,{window:w,console},{filename:'qf-pedido-home.js'});
 return {w,getNext:()=>last,close:()=>dom.window.close()};
}
function submit(w,description){
 const textarea=w.document.querySelector('#home-problem');
 textarea.value=description;
 textarea.dispatchEvent(new w.Event('input',{bubbles:true}));
 w.document.querySelector('[data-home-problem]').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
}
test('rebocar parede identifica pedreiro sem exigir selecionar profissão',()=>{
 const p=page();p.w.QFPedidoHome.start();
 submit(p.w,'rebocar parede');
 assert.equal(p.getNext().service,'Pedreiro');
 assert.equal(p.getNext().problem,'rebocar parede');
 assert.equal(p.w.document.querySelector('[data-home-type]'),null);
 p.close();
});
test('descrição não identificada solicita detalhes, não mostra catálogo de profissões',()=>{
 const p=page();p.w.QFPedidoHome.start();
 submit(p.w,'Preciso de ajuda em casa urgente');
 assert.equal(p.getNext(),null);
 assert.match(p.w.document.querySelector('[role=alert]').textContent,/Conte mais detalhes/);
 assert.equal(p.w.document.querySelector('[data-home-type]'),null);
 p.close();
});
test('entrada por Google ou telefone é anunciada na tela inicial',()=>{
 const p=page();p.w.QFPedidoHome.start();
 const button=p.w.document.querySelector('[data-home-login-start]');
 assert.match(button.textContent,/Google/);
 button.click();
 assert.match(p.w.document.querySelector('[data-home-work]').textContent,/Continuar com Google/);
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
