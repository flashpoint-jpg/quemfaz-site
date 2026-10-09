// V11.43.2: a etapa 1 do pedido registra as falhas no painel, com os mesmos códigos da etapa 2.
const fs=require('node:fs'),assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync('index.html','utf8');
const continuar=html.slice(html.indexOf('function continuar() {'),html.indexOf("opcoes.addEventListener('click'"));
test('etapa 1 registra serviço em branco e descrição curta antes do aviso na tela',()=>{
 const servico=continuar.indexOf("track('validation_error', { error_code: 'service' })");
 const descricao=continuar.indexOf("track('validation_error', { error_code: 'description' })");
 assert.ok(servico>0&&descricao>servico);
 assert.ok(servico<continuar.indexOf('Informe qual serviço'));
 assert.ok(descricao<continuar.indexOf('Descreva brevemente'));
 assert.ok(continuar.indexOf('ir(2);')>descricao,'pedido válido segue para a etapa 2 sem registrar falha');
});
test('painel conhece os dois códigos',()=>{
 const admin=fs.readFileSync('qf-admin-acquisition.js','utf8');
 assert.match(admin,/description: 'Descrição'/);assert.match(admin,/service: 'Serviço'/);
});
