const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

test('Cadastro mostra Livre e Avulso com pagamento opcional imediato e teste não obrigatório',()=>{
 const dom=new JSDOM(`<main id="app-content"><form id="cadastro-prof-form">
  <div class="qf-step" data-step="5"><div class="qf-step__head"><h2 class="h2">Planos</h2><p class="text--sm"></p></div>
   <div class="qf-cad-planos">
    <label class="qf-cad-plano"><input type="radio" name="planoEscolhido" value="avulso"><span class="qf-cad-plano__lista">Os R$ 13 viram saldo integral da carteira</span></label>
    <label class="qf-cad-plano"><input type="radio" name="planoEscolhido" value="livre" checked><span>R$ 39,90 por 30 dias</span></label>
   </div>
   <p data-plano-nota></p>
   <label class="qf-trial-choice"><input type="checkbox" name="testeLivre" value="sim">Dois dias grátis</label>
   <label><input type="checkbox" name="cortesiaLivre">Cortesia</label>
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
  assert.notEqual(form.querySelector('.qf-cad-planos').style.display,'none');
  assert.match(w.document.querySelector('[data-qf-planos-chamada]').textContent,/MENOS DE R\$ 1,50\/DIA/);
  assert.match(form.textContent,/Recarga mínima obrigatória.*R\$ 13,00/);
  assert.match(form.textContent,/Chat e WhatsApp do cliente após o desbloqueio/);
  const free=form.elements.testeLivre;
  assert.equal(free.type,'checkbox');
  assert.equal(free.checked,true);
  assert.match(form.querySelector('[data-cad-criar]').textContent,/teste grátis/);
  // Clicar no Livre (mesmo se o rádio já era escolhido) permite pagar imediatamente.
  const livre=form.querySelector('[value=livre]');
  livre.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  assert.equal(free.checked,false);
  assert.match(form.querySelector('[data-cad-criar]').textContent,/Livre por Pix.*R\$ 39,90/);
  assert.match(form.querySelector('[data-plano-nota]').textContent,/Pix é gerado no próximo passo/);
  const avulso=form.querySelector('[value=avulso]');
  avulso.click();
  assert.equal(free.checked,false);
  assert.match(form.querySelector('[data-cad-criar]').textContent,/Avulso.*R\$ 13,00/);
  assert.match(form.querySelector('[data-plano-nota]').textContent,/Recarga obrigatória/);
  assert.match(form.textContent,/Sem mensalidade, sem comissão/);
  free.click();
  assert.equal(free.checked,true);
  assert.equal(livre.checked,true);
  assert.match(form.querySelector('[data-cad-criar]').textContent,/teste grátis/);
  assert.equal(form.querySelectorAll('[name=planoEscolhido]').length,2);
  assert.equal(form.querySelectorAll('[data-qf-condicoes-planos]').length,1);
  assert.equal(form.querySelector('[name=cortesiaLivre]'),null);
  assert.doesNotMatch(form.textContent,/repasse não é automático|repasse.*não estão disponíveis/i);
 }finally{w.close();}
});
