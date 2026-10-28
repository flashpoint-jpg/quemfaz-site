const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

test('Extensão Livre preserva os dois planos pagos e a escolha do profissional',()=>{
 const dom=new JSDOM(`<main id="app-content"><form id="cadastro-prof-form"><div class="qf-cad-planos">
 <label><input type="radio" name="planoEscolhido" value="avulso"><div class="qf-cad-plano__lista"><span>Os R$ 13 viram saldo integral da carteira</span></div></label>
 <label><input type="radio" name="planoEscolhido" value="livre" checked><div class="qf-cad-plano__lista">R$ 39,90 por 30 dias</div></label>
 </div><p data-plano-nota></p><button data-cad-criar></button></form></main>`,{url:'https://quemfazservico.com.br/#/auth/profissional/cadastro',runScripts:'outside-only'});
 const w=dom.window;
 try{
  w.Screens={};w.QFCloud={client:{rpc:()=>{throw Error('Cadastro não deve consultar ou criar pagamentos ao renderizar');}}};
  Object.defineProperty(w.document,'readyState',{value:'complete'});
  w.eval(fs.readFileSync('qf-livre.js','utf8'));
  const form=w.document.querySelector('form');
  assert.deepEqual([...form.querySelectorAll('[name=planoEscolhido]')].map(e=>e.value),['avulso','livre']);
  assert.equal(form.querySelector('[name=planoEscolhido]:checked').value,'livre');
  assert.match(form.querySelector('[data-cad-criar]').textContent,/pagamento.*39,90/);
  assert.match(form.querySelector('[data-plano-nota]').textContent,/sem recarga de R\$ 13/);
  assert.match(form.textContent,/Os R\$ 13 viram saldo integral/);
  assert.doesNotMatch(form.textContent,/Criar conta grátis/);
  const avulso=form.querySelector('[value=avulso]');avulso.checked=true;avulso.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.match(form.querySelector('[data-cad-criar]').textContent,/pagamento.*13,00/);
  assert.match(form.querySelector('[data-plano-nota]').textContent,/creditado integralmente/);
  w.Screens.afterRenderAnon('/auth/:role/cadastro',w.document.querySelector('main'),{role:'profissional'});
  assert.equal(form.querySelectorAll('[name=planoEscolhido]').length,2);
  assert.equal(form.querySelectorAll('details').length,1);
 }finally{w.close();}
});
