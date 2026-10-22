// Tela inicial com mais conteúdo: seções presentes, leves no HTML inicial e busca de sofá na categoria certa.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'index.html'),'utf8');
const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
for(const id of ['qf-sec-como','qf-sec-servicos','qf-sec-beneficios','qf-sec-recrut','qf-sec-app','qf-sec-quem'])assert.ok(src.includes('id="'+id+'"'),id);
for(const t of ['Como funciona','Serviços mais pedidos','O que o QuemFaz oferece','Recrutamento para empresas','Quem somos'])assert.ok(src.includes(t),t);
// O que fica abaixo da primeira tela não pesa no HTML inicial.
assert.ok(html.includes('data-home-lazy="wide"')&&html.includes('data-home-lazy="mob"'));
assert.ok(!html.includes('id="qf-sec-quem"'));
assert.ok(html.includes('id="qf-sec-como"'));
// O bloco do celular e o do computador nunca aparecem juntos.
assert.ok(/\.qf-desk-extra,\s*\.qf-desk-wide,\s*\.qf-desk-menu\s*\{\s*display:\s*none/.test(src));
assert.ok(/@media \(min-width: 900px\) \{ \.qf-mob-extra \{ display: none; \} \}/.test(src));
// "limpeza de sofá" tem que cair em Limpeza de estofados, não em Diarista.
assert.ok(/cat_limpeza_estofados:'[^']*limpeza de sofa/.test(src));
assert.ok(src.includes("['Limpeza de sofá','broom','Limpeza de estofados e tapetes']"));
// Sem link da Google Play enquanto a página do app não abre para o público.
assert.ok(!/qf-desk-play" href/.test(src));
console.log('home-conteudo: seções, carregamento leve, celular/computador separados e busca de sofá: ok');
