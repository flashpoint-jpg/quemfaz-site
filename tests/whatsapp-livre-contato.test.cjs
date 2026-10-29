const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'../qf-comissao13.js'),'utf8');
const a=src.indexOf(' function suporteProfHtml('),b=src.indexOf(' function contatoAdminHtml(',a);
assert.ok(a>=0&&b>a);
new vm.Script(src);
function render(req,client,enabled=true){
 const g={DB:{requestById:id=>req,clienteById:id=>client}};
 const esc=x=>String(x).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
 const fn=new Function('g','esc','encodeURIComponent',src.slice(a,b)+'return suporteProfHtml;')(g,esc,encodeURIComponent);
 return fn('pedido-teste',enabled);
}
test('Plano Livre mostra Chat e WhatsApp lado a lado após desbloquear e não confunde com suporte',()=>{
 const html=render({profissionalId:'prof-1',clienteId:'cli-1'},{nome:'Ana',telefone:'11987654321'});
 assert.match(html,/Chat no app/);
 assert.match(html,/WhatsApp do cliente/);
 assert.match(html,/https:\/\/wa\.me\/5511987654321/);
 assert.match(html,/data-contact="whatsapp"/);
 assert.match(html,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(html,/Pix oficial do Quem Faz/);
 assert.match(html,/87%/);
 assert.ok(html.indexOf('Falar com o cliente')<html.indexOf('Precisou de ajuda?'));
});
test('Telefone não aparece antes do desbloqueio ou quando não está disponível',()=>{
 const pre=render(null,{nome:'Ana',telefone:'11987654321'});
 assert.doesNotMatch(pre,/data-contact="whatsapp"/);
 assert.match(pre,/WhatsApp indisponível/);
 const closed=render({profissionalId:'prof-1',clienteId:'cli-1'},{nome:'Ana',telefone:'11987654321'},false);
 assert.doesNotMatch(closed,/data-contact="whatsapp"/);
 assert.match(closed,/Falar com suporte/);
});
