// Contador de profissionais: só totais do banco, nunca número fixo, e regra de 3 ou mais para mostrar a quantidade.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261008214500_home_stats_profissionais.sql'),'utf8');
assert.ok(!src.includes('STATS_PREVIA'),'número fixo não pode ir ao ar');
assert.ok(src.includes("c.rpc('qf_home_stats')"));
assert.ok(/case when n >= 3 then n end/.test(sql)&&/grant execute on function public\.qf_home_stats\(\) to anon/.test(sql));
assert.ok(!/nome|telefone|whatsapp|email|documento/i.test(sql.replace(/--.*$/gm,'')),'a função não pode expor dado pessoal');
const a=src.indexOf('  function statsCity('),b=src.indexOf('  let statsData = null');
const ctx={icon:()=>'' };vm.createContext(ctx);vm.runInContext(src.slice(a,b)+';this.statsHtml=statsHtml;this.statsCity=statsCity;',ctx);
assert.equal(ctx.statsCity('SÃO BERNARDO DO CAMPO'),'São Bernardo do Campo');
assert.equal(ctx.statsHtml(null),'');assert.equal(ctx.statsHtml({total:0,lista:[]}),'');
const html=ctx.statsHtml({total:12,lista:[{cidade:'São Paulo',uf:'SP',n:9},{cidade:'itu',uf:'SP',n:null},{cidade:'<i>x</i>',uf:'SP',n:2}]});
assert.ok(html.includes('<strong>12 profissionais</strong> cadastrados em 3 cidades'));
assert.equal((html.match(/<b>/g)||[]).length,1);assert.ok(html.includes('<b>9</b>')&&html.includes('Itu')&&!html.includes('<i>x</i>'));
assert.ok(ctx.statsHtml({total:5,lista:[{cidade:'A',uf:'SP',n:5}]},true).includes('<details class="qf-stats" open>'));
console.log('home-contador: totais do banco, regra de 3 ou mais, sem dado pessoal e sem número fixo: ok');
