const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','qf-comissao13.js'),'utf8');

test('script do plano é sintaticamente válido',()=>{
  assert.doesNotThrow(()=>new vm.Script(source,{filename:'qf-comissao13.js'}));
});
test('plano anuncia preço, vigência e comissão sem oferecer compra antes do checkout',()=>{
  assert.match(source,/R\$ 39,90 por 30 dias/);
  assert.match(source,/Comissão de 13%/);
  assert.match(source,/não está disponível para contratação/);
  assert.doesNotMatch(source,/data-qf-livre-pagar/);
});
test('prévia não depende da modalidade gratuita estar ativa',()=>{
  assert.match(source,/if\(lista\)\{box\.classList\.add\('qf13-feature'\);box\.innerHTML=anuncio\(\)/);
  assert.match(source,/if\(status&&status\.ok&&status\.desbloqueio_gratuito_ativo\)decorateCards/);
});
test('desbloqueio antigo e prestação de contas permanecem preservados',()=>{
  assert.match(source,/qf_comissao13_desbloquear/);
  assert.match(source,/qf_comissao13_fechamentos_painel/);
});
