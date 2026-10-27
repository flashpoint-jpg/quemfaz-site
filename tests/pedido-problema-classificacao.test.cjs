const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('Descrição do problema mantém categorias reais para encontrar profissionais',()=>{
 const names=['Eletricista','Encanador','Pintor','Limpeza de estofados','Diarista','Montador de móveis','Chaveiro','Ar-condicionado','Pedreiro'];
 const categories=names.map((nome,i)=>({id:'cat_'+i,nome}));
 const window={DB:{categories:()=>categories},setInterval:()=>0};vm.runInNewContext(fs.readFileSync('qf-pedido-home.js','utf8'),{window});
 for(const [problem,expected] of [['Minha torneira está vazando','Encanador'],['O chuveiro queimou','Eletricista'],['Preciso limpar meu sofá','Limpeza de estofados'],['Preciso pintar o quarto','Pintor'],['Montar um guarda-roupa','Montador de móveis'],['Minha casa precisa de faxina','Diarista']]){
  const found=window.QFPedidoHome.classify(problem);assert.equal(found[0].category.nome,expected);assert.ok(categories.some(c=>c.id===found[0].category.id));
 }
 assert.equal(window.QFPedidoHome.classify('Preciso de ajuda com alguma coisa').length,0);
});
