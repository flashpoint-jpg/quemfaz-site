// V11.43.3: a tela inicial mede toque, digitação e envio sem gravar o texto digitado.
const fs=require('node:fs'),assert=require('node:assert/strict'),{test}=require('node:test');
const js=fs.readFileSync('qf-client-acquisition.js','utf8'),admin=fs.readFileSync('qf-admin-acquisition.js','utf8');
test('eventos da tela inicial existem e não enviam texto',()=>{
 for(const e of ['home_focus','home_type','home_submit','home_cta']){assert.ok(js.includes("track('"+e+"'"),e);assert.ok(admin.includes(e+':'),e+' no painel');}
 const bloco=js.slice(js.indexOf('data-landing-service-form'),js.indexOf("var form = document.getElementById('cadastro-cliente-form')"));
 assert.ok(!/\.value/.test(bloco));
});
test('banco aceita os eventos novos',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261009123000_funil_eventos_tela_inicial.sql','utf8');
 for(const e of ['home_focus','home_type','home_submit','home_cta'])assert.ok(sql.includes("'"+e+"'"));
});
