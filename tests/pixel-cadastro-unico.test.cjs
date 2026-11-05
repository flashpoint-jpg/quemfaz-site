const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');

function setup(){
 const ini=html.indexOf('const QF_CR_MAX_IDADE_MS');
 const fim=html.indexOf('global.QFTrackCompleteRegistrationOnce');
 assert.ok(ini>0&&fim>ini,'função do pixel encontrada');
 const cache=new Map(),eventos=[];
 const global={fbq:(...a)=>eventos.push(a)};
 const ctx={global,localStorage:{getItem:k=>cache.has(k)?cache.get(k):null,setItem:(k,v)=>cache.set(k,v)},Date,Number};
 vm.runInNewContext(html.slice(ini,fim)+'\nthis.fn=trackCompleteRegistrationOnce;',ctx);
 return {fn:ctx.fn,eventos};
}
const agora=()=>new Date().toISOString();

test('cadastro novo dispara CompleteRegistration uma vez, com eventID do usuário',()=>{
 const x=setup(),u={id:'u1',created_at:agora()};
 assert.equal(x.fn(u,'profissional'),true);
 assert.equal(x.fn(u,'profissional'),false);
 assert.equal(x.eventos.length,1);
 assert.equal(x.eventos[0][1],'CompleteRegistration');
 assert.equal(x.eventos[0][3].eventID,'cr-u1');
});

test('login de conta antiga que veio por anúncio não conta como cadastro',()=>{
 const x=setup(),u={id:'u2',created_at:new Date(Date.now()-3*24*3600*1000).toISOString()};
 assert.equal(x.fn(u,'profissional'),false);
 assert.equal(x.eventos.length,0);
});

test('sem data de criação ou sem usuário não dispara',()=>{
 const x=setup();
 assert.equal(x.fn({id:'u3'},'profissional'),false);
 assert.equal(x.fn(null,'profissional'),false);
 assert.equal(x.eventos.length,0);
});

test('cliente e data de criação futura não contam como cadastro profissional',()=>{
 const x=setup();
 assert.equal(x.fn({id:'cliente',created_at:agora()},'cliente'),false);
 assert.equal(x.fn({id:'futuro',created_at:new Date(Date.now()+3600000).toISOString()},'profissional'),false);
 assert.equal(x.eventos.length,0);
});

test('falha ao enfileirar o pixel permite tentar novamente',()=>{
 const ini=html.indexOf('const QF_CR_MAX_IDADE_MS'),fim=html.indexOf('global.QFTrackCompleteRegistrationOnce');
 const cache=new Map();let tentativas=0;
 const ctx={global:{fbq:()=>{if(++tentativas===1)throw Error('pixel indisponível');}},localStorage:{getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v)}};
 vm.runInNewContext(html.slice(ini,fim)+'\nthis.fn=trackCompleteRegistrationOnce;',ctx);
 const user={id:'retry',created_at:agora()};
 assert.equal(ctx.fn(user,'profissional'),false);
 assert.equal(ctx.fn(user,'profissional'),true);
 assert.equal(ctx.fn(user,'profissional'),false);
 assert.equal(tentativas,2);
});

test('cadastro confirmado envia evento sem UTM e mesmo se a atribuição falhar',async()=>{
 const ini=html.indexOf('async function applyPendingIdentity('),fim=html.indexOf('// V11.86: CompleteRegistration',ini);
 for(const marketing of [null,JSON.stringify({source:'meta',campaign:'123'})]){
  const eventos=[],user={id:'novo',created_at:agora()};
  const ctx={console:{warn(){}},localStorage:{getItem:k=>k==='qf_marketing_attribution'?marketing:null},
   pendingCpfKey:e=>'cpf',pendingCnpjKey:e=>'cnpj',pendingProfessionalProfileKey:e=>'profile',pendingAddressKey:e=>'address',pendingSelfieKey:e=>'selfie',
   client:{auth:{getUser:async()=>({data:{user}})},from:()=>({upsert:async()=>({error:Error('atribuição indisponível')})})},
   trackCompleteRegistrationOnce:(...args)=>eventos.push(args)};
  vm.runInNewContext(html.slice(ini,fim)+'\nthis.apply=applyPendingIdentity;',ctx);
  await ctx.apply('teste@example.test','profissional',user);
  assert.equal(eventos.length,1);
  assert.equal(eventos[0][0],user);
 }
});

test('UTM após a rota de cadastro é preservada e não quebra o destino',()=>{
 const {JSDOM}=require('jsdom');
 const block=html.match(/<script>\s*\/\* QF_MARKETING_ATTRIBUTION_V2[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g,'');
 for(const separator of ['?','&']){
  const dom=new JSDOM('',{url:'https://quemfazservico.com.br/#/auth/profissional/cadastro'+separator+'utm_source=meta&utm_medium=paid_social&utm_campaign=123&utm_content=456&fbclid=click',runScripts:'outside-only'});
  dom.window.eval(block);
  assert.equal(dom.window.location.hash,'#/auth/profissional/cadastro');
  assert.equal(dom.window.QFMarketingTouch.campaign,'123');
  assert.equal(dom.window.QFMarketingTouch.content,'456');
  assert.equal(dom.window.QFMarketingTouch.click_id,'click');
  dom.window.close();
 }
});

test('origem do anúncio grava só o primeiro toque',()=>{
 assert.match(html,/qf_marketing_attribution'\)\.upsert\(row, \{ onConflict: 'user_id', ignoreDuplicates: true \}\)/);
});
