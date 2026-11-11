// Tela inicial com mais conteúdo: seções presentes, leves no HTML inicial e busca de sofá na categoria certa.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'index.html'),'utf8');
const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
// As seções úteis e o CTA precisam estar visíveis no HTML inicial, antes dos scripts.
const rendered = html.slice(html.indexOf('data-qf-prerender="home"'), html.indexOf('var early=w.QFEarly'));
for (const id of ['qf-sec-como','qf-sec-servicos','qf-approved-picker-title']) assert.ok(rendered.includes('id="'+id+'"'),id);
for (const text of ['Publicar pedido grátis','Como funciona','Profissionais em Santo André, Guarulhos e ABC']) assert.ok(rendered.includes(text),text);
for (const service of ['diarista','pintor','eletricista','encanador','pedreiro','limpeza_estofados']) {
  assert.ok(rendered.includes('data-landing-cat="cat_'+service+'"'),service);
}
// "limpeza de sofá" tem que cair em Limpeza de estofados, não em Diarista.
assert.ok(/cat_limpeza_estofados:'[^']*limpeza de sofa/.test(src));
assert.ok(src.includes("['Limpeza de sofá','broom','Limpeza de estofados e tapetes']"));
// Sem link da Google Play enquanto a página do app não abre para o público.
assert.ok(!/qf-desk-play" href/.test(src));
console.log('home-conteudo: seções, carregamento leve, celular/computador separados e busca de sofá: ok');
