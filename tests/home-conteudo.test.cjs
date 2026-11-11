// Tela inicial com mais conteúdo: seções presentes, leves no HTML inicial e busca de sofá na categoria certa.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'index.html'),'utf8');
const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
// As mesmas seções são renderizadas no HTML inicial para celular, desktop e busca.
for(const text of ['Qual serviço você precisa?', 'Serviços mais procurados', 'Como funciona', 'Profissionais em Santo André, Guarulhos e ABC']) {
  assert.ok(html.includes(text),text);
}
assert.match(html,/<h1>Precisa de um profissional <em>perto de você\?<\/em><\/h1>/);
assert.match(html,/href="\/servicos\/eletricista\/santo-andre\/"/);
// "limpeza de sofá" tem que cair em Limpeza de estofados, não em Diarista.
assert.ok(/cat_limpeza_estofados:'[^']*limpeza de sofa/.test(src));
assert.ok(src.includes("['Limpeza de sofá','broom','Limpeza de estofados e tapetes']"));
// Sem link da Google Play enquanto a página do app não abre para o público.
assert.ok(!/qf-desk-play" href/.test(src));
console.log('home-conteudo: seções responsivas, links locais e busca de sofá: ok');
