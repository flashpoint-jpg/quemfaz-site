const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto').webcrypto;
function setup(){
 const rows=[],timers=[],listeners={},handlers={home:{},form:{}},cache=new Map();
 const element=type=>({dataset:{},attrs:{},getAttribute(n){return this.attrs[n];},addEventListener:(name,fn)=>handlers[type][name]=fn});
 const home=element('home'),form=element('form');
 const storage={getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v)};
 const win={crypto,fbq(){},setTimeout:fn=>timers.push(fn),addEventListener:(n,f)=>listeners[n]=f,QFCloud:{enabled:true,client:{from:()=>({insert:r=>{rows.push(r);return Promise.resolve({});}})}}};
 const document={querySelector:()=>home,getElementById:id=>id==='cadastro-cliente-form'?form:{},addEventListener(){}};
 vm.runInNewContext(fs.readFileSync('qf-client-acquisition.js','utf8'),{window:win,document,sessionStorage:storage,localStorage:storage,location:{search:'',hash:'#/'},URLSearchParams,Date,Promise,console,MutationObserver:class{observe(){}}});
 return {win,rows,timers,listeners,handlers,form};
}
test('nova versão registra formulário já renderizado e só digitação humana',()=>{
 const x=setup();x.listeners.DOMContentLoaded();
 assert.ok(x.rows.some(r=>r.event==='form_view'));
 x.handlers.home.input({isTrusted:false});assert.ok(!x.rows.some(r=>r.event==='home_type'));
 x.handlers.home.input({isTrusted:true});x.handlers.home.input({isTrusted:true});
 assert.equal(x.rows.filter(r=>r.event==='home_type').length,1);
 x.handlers.form.click({isTrusted:true,target:{closest:()=>true}});
 assert.equal(x.rows.filter(r=>r.event==='form_start').length,1);
 assert.ok(x.rows.every(r=>r.measurement_version===2));
});
test('SDK atrasado e resposta perdida repetem o mesmo evento, sem duplicá-lo',async()=>{
 const x=setup(),client=x.win.QFCloud.client;x.win.QFCloud.client=null;
 x.win.QFClientAcquisition.track('form_view',{},true);
 assert.equal(x.rows.length,0);assert.equal(x.timers.length,1);
 x.win.QFCloud.client={from:()=>({insert:r=>{x.rows.push(r);return Promise.reject(Error('rede'));}})};
 x.timers.shift()();await new Promise(setImmediate);
 x.win.QFCloud.client=client;x.timers.shift()();await new Promise(setImmediate);
 assert.equal(x.rows.length,2);assert.equal(x.rows[0].id,x.rows[1].id);
 x.win.QFClientAcquisition.track('form_view',{},true);assert.equal(x.rows.length,2);
});

test('Enter intermediário não conta como tentativa de publicar',()=>{
 const x=setup();x.listeners.DOMContentLoaded();
 for (const [step,sub] of [['1',null],['2','a'],['2','b']]) {
  x.form.attrs={'data-qf-etapa':step,'data-qf-sub':sub};x.handlers.form.submit();
 }
 assert.equal(x.rows.filter(r=>r.event==='submit').length,0);
 x.form.attrs={'data-qf-etapa':'2','data-qf-sub':'c'};x.handlers.form.submit();
 assert.equal(x.rows.filter(r=>r.event==='submit').length,1);
});
