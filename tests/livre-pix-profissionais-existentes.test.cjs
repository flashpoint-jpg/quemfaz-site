const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const s=fs.readFileSync(require('node:path').join(__dirname,'../qf-livre.js'),'utf8');
test('profissionais já cadastrados acessam cadastro Pix pela Carteira mesmo sem assinatura ativa',()=>{
 const fn=s.split('async function mostrarContaPix(s){')[1]?.split('function render(s){')[0]||'';
 assert.ok(fn);
 assert.match(fn,/\/profissional\/carteira/);

 assert.doesNotMatch(fn,/!s\?\.ativo/);
 assert.match(fn,/Não precisa abrir conta Efí/);
 assert.match(fn,/qf_livre_pix_chaves/);
 assert.match(fn,/form\.elements\.chavePix\.value=data\.chave_pix/);
});
