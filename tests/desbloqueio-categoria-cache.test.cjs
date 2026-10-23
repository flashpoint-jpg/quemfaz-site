const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('scripts/qf-other-jobs-extension.js','utf8');
function setup(){
 const dom=new JSDOM('<html><head></head><body></body></html>');
 const eligible={id:'perto',categoriaId:'cat_eletricista',cidadeId:'abc',distanciaKm:10,descricao:'Instalação elétrica',limiteParticipantes:4,participantes:0};
 const user={id:'prof',online:false};
 const ctx={document:dom.window.document,window:{},PU:{escapeHtml:String},icon:()=>'',DB:{categoryById:()=>({nome:'Eletricista'}),cityById:()=>({nome:'Santo André',uf:'SP'}),chamadasPendentes:()=>[eligible]},Screens:{profHomeRender:()=>'<div class="view"><div class="qf-abertos">Vitrine geral</div><div class="qf-movimento">Movimento geral</div><div id="chamados-disponiveis"></div></div>',profServicosDisponiveisRender:()=>'<div class="view">Lista elegível<div class="qf-abertos">Vitrine geral</div></div>',afterRender:()=>{}}};
 vm.createContext(ctx);vm.runInContext(source,ctx);return {ctx,user};
}
test('Início exibe lista elegível e retira vitrine e atalhos para outras profissões',()=>{
 const {ctx,user}=setup();const html=ctx.Screens.profHomeRender({},user);
 assert.match(html,/Eletricista/);assert.match(html,/10 km/);
 assert.doesNotMatch(html,/Outros pedidos|outros-pedidos|Vitrine geral|Movimento geral|outras oportunidades/);
 assert.doesNotMatch(source,/\.rpc\(/,'não consulta a vitrine antiga');
});
test('link antigo de Outros pedidos abre lista elegível sem a vitrine',()=>{
 const {ctx,user}=setup();
 assert.equal(ctx.Screens.profOutrosPedidosRender({},user),ctx.Screens.profServicosDisponiveisRender({},user));
 assert.doesNotMatch(ctx.Screens.profOutrosPedidosRender({},user),/Vitrine geral/);
});
test('aviso mantém pedidos visíveis fora do horário sem prometer notificações',()=>{
 const {ctx}=setup();
 assert.equal(ctx.qfOutrosHorario({online:false}),null);
 assert.match(ctx.qfOutrosHorario({online:true,horarioInicio:'00:00',horarioFim:'00:00'}),/profissão e região/);
});
