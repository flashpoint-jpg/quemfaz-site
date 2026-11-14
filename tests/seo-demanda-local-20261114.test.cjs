const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','dist','servicos');

test('páginas com cobertura mantêm canonical, formulário e links locais',()=>{
  for(const slug of ['eletricista/diadema','montador-de-moveis/santo-andre','encanador/sao-bernardo-do-campo','pintor/maua']){
    const html=fs.readFileSync(path.join(root,slug,'index.html'),'utf8');
    assert.match(html,/data-qf-demanda-20261114/);
    assert.match(html,/<meta name="robots" content="index,follow">/);
    assert.ok(html.includes('rel="canonical" href="https://quemfazservico.com.br/servicos/'+slug+'/"'));
    assert.ok(html.includes('id="seo-order"'));
    assert.match(html,/<a href="\/servicos\//);
  }
});

test('serviços sem cobertura confirmada permanecem noindex e sem conteúdo novo',()=>{
  for(const slug of ['limpeza-de-sofa/santo-andre','limpeza-de-sofa/sao-bernardo-do-campo']){
    const html=fs.readFileSync(path.join(root,slug,'index.html'),'utf8');
    assert.match(html,/<meta name="robots" content="noindex,follow">/);
    assert.ok(!html.includes('data-qf-demanda-20261114'));
  }
});
