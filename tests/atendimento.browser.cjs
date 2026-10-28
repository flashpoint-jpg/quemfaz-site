// Os fluxos atuais substituem campos de orçamento/data e o redirecionamento legado.
const {execFileSync}=require('node:child_process');
for(const file of ['pedido-home.browser.cjs','cadastro-planos.browser.cjs'])
 execFileSync(process.execPath,[require('node:path').join(__dirname,file)],{stdio:'inherit'});
