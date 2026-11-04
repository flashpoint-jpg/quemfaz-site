const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(require.resolve('../qf-admin-pix-manual.js'),'utf8');
const recover=fs.readFileSync(require.resolve('../qf-pre-cadastro-manual.js'),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,15));
async function setup({role='admin',items=[],status='pendente'}={}){
 const dom=new JSDOM('<button data-admin-pix-manual>Abrir</button>',{url:'https://quemfazservico.com.br/admin.html',runScripts:'outside-only'}),w=dom.window,calls=[];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.confirm=()=>true;w.DB={getSession:()=>({role})};
 w.QFAdminCloud={enabled:true,client:{from:()=>({select:()=>({eq:async()=>({data:[{plano:'avulso',nome:'Avulso',preco_centavos:1499,ativo:true}]})})}),rpc:async()=>({data:{itens:items}}),functions:{invoke:async(name,{body})=>{calls.push(body);return {data:body.acao==='status'?{ok:true,status}:{ok:true,recuperado:body.acao==='recuperar',email:'original@example.com',id:'11111111-1111-4111-8111-111111111111',segredo:'a'.repeat(48),plano:'avulso',nome_plano:'Avulso',valor_centavos:1499,pix_copy_paste:'PIX_TESTE'}};}}}};
 w.eval(source);w.document.querySelector('button').click();await tick();
 return {w,calls,dom};
}
async function submit(f){const form=f.w.document.querySelector('form');Object.entries({nome:'Teste profissional',email:'teste@example.com',telefone:'11954802607',documento:'11144477735'}).forEach(([k,v])=>form.elements[k].value=v);form.dispatchEvent(new f.w.Event('submit',{cancelable:true}));await tick();return form;}
test('somente administrador abre a cobrança assistida',async()=>{const f=await setup({role:'profissional'});assert.equal(f.w.document.querySelector('dialog'),null);f.dom.window.close();});
test('gera Pix pela integração existente e consulta banco sem conceder acesso',async()=>{const f=await setup({status:'aprovado'});const form=await submit(f);assert.equal(f.calls.length,1);assert.equal(f.calls[0].metodo,'pix');assert.equal(f.calls[0].documento,'11144477735');assert.equal(form.elements.documento.value,'');assert.ok(form.hidden);assert.equal(f.w.document.querySelector('[data-manual-pix-code]').value,'PIX_TESTE');assert.match(f.w.document.querySelector('[data-manual-pix-result]').textContent,/Referência/);f.w.document.querySelector('[data-manual-pix-check]').click();await tick();assert.match(f.w.document.querySelector('[role=status]').textContent,/confirmado pelo banco/);assert.equal(f.calls[1].acao,'status');assert.ok(f.calls.every(c=>['criar','status'].includes(c.acao)));f.dom.window.close();});
test('cobrança existente recupera o Pix sem criar outra cobrança',async()=>{const f=await setup({items:[{id:'11111111-1111-4111-8111-111111111111',email:'teste@example.com',status:'pendente'}]});await submit(f);assert.equal(f.calls.length,1);assert.equal(f.calls[0].acao,'recuperar');assert.match(f.w.document.querySelector('[role=status]').textContent,/existente recuperada/);const link=[...f.w.document.querySelectorAll('textarea')].find(x=>x.value.includes('pix-cadastro'));assert.ok(decodeURIComponent(link.value).includes('original@example.com'));f.dom.window.close();});
test('link recupera referência em outro aparelho sem CPF nem confirmação local de pagamento',()=>{const data={id:'11111111-1111-4111-8111-111111111111',segredo:'a'.repeat(48),plano:'avulso',email:'teste@example.com'};const dom=new JSDOM('',{url:'https://quemfazservico.com.br/#/pix-cadastro/'+encodeURIComponent(JSON.stringify(data)),runScripts:'outside-only'});dom.window.eval(recover);const saved=JSON.parse(dom.window.localStorage.getItem('qf_pre_cadastro'));assert.equal(saved.pag.id,data.id);assert.equal(saved.manual,true);assert.equal(saved.dados.cpf,undefined);assert.equal(saved.status,undefined);assert.equal(dom.window.location.hash,'#/auth/profissional/cadastro');dom.window.close();});
test('link inválido não altera o cadastro salvo',()=>{const dom=new JSDOM('',{url:'https://quemfazservico.com.br/#/pix-cadastro/invalido',runScripts:'outside-only'});dom.window.eval(recover);assert.equal(dom.window.localStorage.getItem('qf_pre_cadastro'),null);dom.window.close();});
