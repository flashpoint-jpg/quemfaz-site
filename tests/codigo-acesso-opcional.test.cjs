const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');

test('Cliente não precisa anotar código para acompanhar no mesmo aparelho',()=>{
 const i=html.indexOf('async function fillClienteCodigoAcesso(content)');
 const j=html.indexOf('const prevAfter = Screens.afterRender;',i);
 assert.ok(i>0 && j>i);
 const block=html.slice(i,j);
 assert.match(block,/Seu pedido fica salvo na sua conta neste aparelho/);
 assert.match(block,/<details class="qf-codigo-acesso__recovery">/);
 assert.match(block,/<summary>Precisa entrar em outro celular\?/);
 assert.doesNotMatch(block,/Anote este código/);
 assert.match(html,/\.qf-codigo-acesso__recovery summary/);
});

test('Recuperação em outro dispositivo segue protegida, sem acesso só pelo número',()=>{
 assert.match(html,/Código de recuperação/);
 assert.match(html,/signInClienteWhatsapp\(telefone, codigo\)/);
 assert.match(html,/cod\.length !== 6/);
 assert.match(html,/WhatsApp e o código de recuperação/);
 assert.doesNotMatch(html,/Entrar só com o WhatsApp/);
});

test('Acesso automático pela sessão continua funcionando',()=>{
 assert.match(html,/async function syncForCurrentSession\(/);
 assert.match(html,/if \(role === 'cliente'\) await syncClientCalls\(user\.id\)/);
 assert.match(html,/\{ pattern: '\/cliente\/pedidos', role: 'cliente'/);
});
