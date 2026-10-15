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

test('origem do anúncio grava só o primeiro toque',()=>{
 assert.match(html,/qf_marketing_attribution'\)\.upsert\(row, \{ onConflict: 'user_id', ignoreDuplicates: true \}\)/);
});
