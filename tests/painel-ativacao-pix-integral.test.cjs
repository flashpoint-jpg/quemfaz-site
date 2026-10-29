const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const adminSrc=fs.readFileSync(require('node:path').join(__dirname,'../qf-comissao13.js'),'utf8');
const edgeSrc=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/quemfaz-livre-pix-manual/index.ts'),'utf8');
new vm.Script(adminSrc,{filename:'qf-comissao13.js'});

test('Painel financeiro oferece ativação, pausa e estado bancário',()=>{
 const d=new JSDOM('<html><body><main><div class="view"></div></main></body></html>');
 const a=adminSrc.indexOf('function painelPixAtivacao(');
 const b=adminSrc.indexOf('const anterior=g.Screens.afterRender;',a);
 assert.ok(a>=0&&b>a);
 const sandbox={document:d.window.document,esc:v=>String(v),g:{},console};
 vm.runInNewContext(adminSrc.slice(a,b),sandbox);
 const actions=[];
 const client={functions:{invoke:async(name,request)=>{
  actions.push(request.body.action);
  return {data:{ok:true,habilitado:actions.includes('admin_enable'),efi_verificado_em:null}};
 }}};
 sandbox.painelPixAtivacao(d.window.document.querySelector('.view'),client);
 return new Promise(resolve=>setTimeout(resolve,10)).then(()=>{
  const html=d.window.document.body.innerHTML;
  assert.match(html,/Ativar cobrança Pix integral/);
  assert.match(html,/100% pelo Pix do Quem Faz/);
  assert.match(html,/13%/);
  assert.match(html,/87%/);
  assert.deepEqual(actions,['admin_status']);
  d.window.close();
 });
});

test('Ativação bancária do Pix exige autenticação de administrador e Efí de produção',()=>{
 assert.match(edgeSrc,/authorizedAdmin\(req\)/);
 assert.match(edgeSrc,/efi_producao_nao_validada/);
 assert.match(edgeSrc,/if\(sandbox\)return reply/);
 assert.match(edgeSrc,/const tokenValue=await token\(c\)/);
 assert.match(edgeSrc,/p_ativar:true/);
 assert.match(edgeSrc,/p_ativar:false/);
 assert.match(edgeSrc,/admin_status/);
 assert.match(edgeSrc,/admin_enable/);
 assert.match(edgeSrc,/admin_disable/);
 assert.doesNotMatch(edgeSrc,/PIX_AUTO_SPLIT_ENABLED/);
});
