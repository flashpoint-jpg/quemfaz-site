const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
function setup(status={ok:true,status:'aprovado',plano:'avulso',resgatado:false}){
 const cache=new Map(),session=new Map(),nav=[],toasts=[];
 const storage=m=>({getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)});
 const ctx={global:{QFCloud:{preCadastroStatus:async()=>status},navigate:(...v)=>nav.push(v)},
  localStorage:storage(cache),sessionStorage:storage(session),DB:{getSession:()=>null},PU:{toast:(...x)=>toasts.push(x)},Date,console};
 const start=html.indexOf('  const QFPreCadastro = (function () {'),end=html.indexOf('  global.QFPreCadastro = QFPreCadastro;',start);
 vm.runInNewContext(html.slice(start,end)+'\nthis.api=QFPreCadastro;',ctx);
 return {ctx,api:ctx.api,cache,session,nav};
}
const draft=()=>({em:Date.now()-96*3600000,plano:'avulso',dados:{email:'titular@example.com'},pag:{id:'pagamento',segredo:'prova-local'}});
test('pagamento de mais de 72h continua recuperável sem guardar senha no localStorage',()=>{
 const s=setup();s.api.salvar(draft(),'senha-teste');assert.equal(s.api.ler().pag.id,'pagamento');
 assert.equal(s.api.senha(),'senha-teste');assert.ok(!s.cache.get('qf_pre_cadastro').includes('senha-teste'));
});
test('login de cadastro pago incompleto retoma a criação com a prova original',async()=>{
 const s=setup();s.api.salvar(draft());assert.equal(await s.api.retomarLogin(' TITULAR@example.com ','nova-senha'),true);
 assert.equal(s.nav[0][0],'/auth/profissional/cadastro');assert.equal(s.api.ler().pag.id,'pagamento');
});
for(const [name,status,email] of [
 ['pagamento pendente',{ok:true,status:'pendente'},'titular@example.com'],
 ['pagamento já vinculado',{ok:true,status:'aprovado',resgatado:true},'titular@example.com'],
 ['outro e-mail',{ok:true,status:'aprovado'},'outro@example.com'],
 ['comprovante inválido',{ok:false,error:'nao_encontrado'},'titular@example.com']])test(name+' não cria conta nem redireciona',async()=>{
 const s=setup(status);s.api.salvar(draft());assert.equal(await s.api.retomarLogin(email,'senha-teste'),false);assert.equal(s.nav.length,0);
});
test('falta de espaço preserva e-mail e pagamento para recuperação',()=>{
 const s=setup();let calls=0;const original=s.ctx.localStorage.setItem;
 s.ctx.localStorage.setItem=(k,v)=>{if(++calls===1)throw Error('quota');original(k,v);};
 s.api.salvar(draft(),'senha-teste');assert.equal(s.api.ler().dados.email,'titular@example.com');assert.equal(s.api.ler().incompleto,true);
});
test('refazer cadastro com outra opção usa o Pix já aprovado e não gera cobrança',async()=>{
 const s=setup();s.api.salvar(draft());
 Object.assign(s.ctx,{QFPreCadastro:s.api,QF_CAD_PLANOS:[{id:'avulso'},{id:'pro_v2'}],formPreenchido:false,
  preGuardar:()=>{},renderAguardando:()=>{},consultarPagamento:()=>{},renderEscolha:()=>{throw Error('novo checkout');},goStep:()=>{}});
 const a=html.indexOf('      async function abrirPagamento('),b=html.indexOf('      async function gerarCobranca(',a);
 vm.runInNewContext(html.slice(a,b)+'\nthis.abrir=abrirPagamento;',s.ctx);
 await s.ctx.abrir({email:'titular@example.com',senha:'segura',cpf:'123'}, {id:'pro_v2'},'');
 assert.equal(s.ctx.pre.plano,'avulso');assert.equal(s.ctx.pre.pag.id,'pagamento');
});
test('voltar do banco consulta o pagamento; tela removida libera os listeners',()=>{
 const calls=[],removed=[];const ctx={naTela:()=>true,document:{visibilityState:'visible',removeEventListener:(...x)=>removed.push(x)},
  global:{removeEventListener:(...x)=>removed.push(x)},pre:{pag:{}},stepAtual:6,preOcupado:false,
  pagArea:{querySelector:()=>null},consultarPagamento:x=>calls.push(x)};
 const a=html.indexOf('      function voltouDoBanco()'),b=html.indexOf("      document.addEventListener('visibilitychange', voltouDoBanco);",a);
 vm.runInNewContext(html.slice(a,b)+'\nthis.voltar=voltouDoBanco;',ctx);
 ctx.voltar();assert.deepEqual(calls,[false]);ctx.naTela=()=>false;ctx.voltar();assert.equal(removed.length,2);
});
test('tela de login oferece retomada e encaminha cadastro pago após tentativa de entrar',async()=>{
 const s=setup();s.api.salvar(draft());
 const dom=new JSDOM('<body><main><form id="login-form"><input name="email" value="titular@example.com"><input name="senha" value="senha-teste"><button type="submit">Entrar</button></form></main></body>',{url:'https://quemfazservico.com.br/'});
 Object.assign(s.ctx,{content:dom.window.document.querySelector('main'),document:dom.window.document,
  pattern:'/auth/:role/login',params:{role:'profissional'},QFPreCadastro:s.api,FormData:dom.window.FormData});
 s.ctx.global.QFCloud.enabled=true;s.ctx.global.QFCloud.signIn=async()=>({ok:false,error:'credenciais inválidas'});
 const a=html.indexOf("    if (pattern === '/auth/:role/login') {"),b=html.indexOf("    if (pattern === '/auth/:role/cadastro'",a);
 vm.runInNewContext(html.slice(a,b),s.ctx);
 assert.ok(s.ctx.content.querySelector('[data-retomar-cadastro]'));
 s.ctx.content.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 await new Promise(r=>setImmediate(r));
 assert.equal(s.nav[0][0],'/auth/profissional/cadastro');dom.window.close();
});
