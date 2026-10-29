const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const chat=fs.readFileSync(path.join(__dirname,'..','qf-chat-contratacao.js'),'utf8');
const qf13=fs.readFileSync(path.join(__dirname,'..','qf-comissao13.js'),'utf8');
test('Mensagens do Plano Livre mantêm sintaxe JS e texto oficial não editável no app',()=>{
 new Function(chat);new Function(qf13);
 assert.ok(chat.includes('data-qfc-terms role="note"'));
 assert.ok(chat.includes('Aviso oficial · Quem Faz Livre (não editável)'));
 assert.ok(chat.includes('WhatsApp não substituem o registro no Quem Faz'));
 assert.ok(chat.includes('agendar não significa concluir nem autoriza cobrança antecipada'));
 assert.ok(chat.includes('13% e controla o saque manual de 87%'));
});
test('WhatsApp predefinido contém aviso sobre confirmação, Pix e sanções com revisão',()=>{
 assert.ok(qf13.includes('AVISO QUEM FAZ LIVRE: O orçamento, aceite, agendamento, confirmação de conclusão e pagamento'));
 assert.ok(qf13.includes('informações falsas ou fraude podem gerar suspensão ou bloqueio após análise'));
 assert.ok(qf13.includes('WhatsApp permite edição antes do envio'));
 assert.ok(qf13.includes("'https://wa.me/'+number+'?text='+encodeURIComponent(msg)"));
 assert.ok(qf13.includes("WhatsApp do cliente · mensagem pronta"));
});
test('Pix de serviços é descrito sem split, com repasse manual e sem afetar o Avulso',()=>{
 assert.match(chat,/A Efí credita 100% na conta Quem Faz/);
 assert.match(qf13,/O repasse de 87% será manual após confirmação bancária/);
 assert.match(chat,/if\(String\(err.message\).includes\('nao_plano_livre'\)\)/);
 assert.ok(chat.includes('qf_chat_contratacao'));
});
