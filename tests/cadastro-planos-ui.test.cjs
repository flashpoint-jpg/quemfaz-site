const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

test('Cadastro exige pagamento: opções Avulso R$13 e plano mensal, sem teste ou cortesia',()=>{
 const dom=new JSDOM(`<main id="app-content"><form id="cadastro-prof-form">
  <div class="qf-step" data-step="5"><div class="qf-step__head"><h2 class="h2">Planos</h2><p class="text--sm"></p></div>
   <div class="qf-cad-planos">
    <label class="qf-cad-plano"><input type="radio" name="planoEscolhido" value="avulso"><span class="qf-cad-plano__lista">Os R$ 13 viram saldo integral da carteira</span></label>
    <label class="qf-cad-plano"><input type="radio" name="planoEscolhido" value="livre" checked><span>R$ 39,90 por 30 dias</span></label>
   </div>
   <p data-plano-nota></p>
   <button type="submit" data-cad-criar></button>
  </div>
 </form></main>`,{url:'https://quemfazservico.com.br/#/auth/profissional/cadastro',runScripts:'outside-only'});
 const w=dom.window;
 try{
  w.Screens={};w.QFCloud={client:{rpc:()=>{throw Error('Renderizar cadastro não pode gerar Pix nem solicitar cobrança');}}};
  Object.defineProperty(w.document,'readyState',{value:'complete'});
  w.eval(fs.readFileSync('qf-livre.js','utf8'));
  const form=w.document.querySelector('#cadastro-prof-form');
  assert.deepEqual([...form.querySelectorAll('[name=planoEscolhido]')].map(e=>e.value),['avulso','livre']);
  assert.equal(form.querySelector('[name=testeLivre]'),null);
  assert.equal(form.querySelector('[name=cortesiaLivre]'),null);
  assert.match(w.document.querySelector('[data-qf-planos-chamada]').textContent,/PAGAMENTO OBRIGATÓRIO/i);
  assert.match(form.textContent,/É necessário pagar o plano escolhido para concluir seu cadastro/i);
  assert.match(form.textContent,/Recarga mínima obrigatória.*R\$ 13,00/);
  assert.match(form.querySelector('[data-cad-criar]').textContent,/Continuar para pagamento/);
  assert.match(form.querySelector('.qf-options-final').textContent,/R\$ 13,00/);
  assert.doesNotMatch(form.querySelector('.qf-options-final').textContent,/teste grátis|48 horas|cortesia/i);
  const avulso=form.querySelector('[value=avulso]');
  avulso.click();
  assert.match(form.querySelector('[data-cad-criar]').textContent,/R\$ 13,00/);
  const livre=form.querySelector('[value=livre]');
  livre.click();
  assert.match(form.querySelector('[data-cad-criar]').textContent,/R\$ 39,90/);
  assert.equal(form.querySelectorAll('[data-qf-condicoes-planos]').length,1);
 }finally{w.close();}
});
