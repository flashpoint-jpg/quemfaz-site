const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const id='00000000-0000-4000-8000-000000000001';
async function screen(status='aberto',professionals=[],options={}) {
  const dom=new JSDOM('<main></main>',{url:'https://quemfazservico.com.br/',runScripts:'outside-only'});
  const w=dom.window,calls=[];
  let data={ok:true,pedido:{titulo:'Pintor',bairro:'Centro',cidade:'Santo André',status},codigo_seguranca:'123456',profissionais:professionals};
  w.localStorage.setItem('qf_pedido_owner_'+id,'a'.repeat(64));w.confirm=()=>true;
  w.fetch=async(url,opts)=>{const body=JSON.parse(opts.body);calls.push({url,body});
    if(url.endsWith('qf13_cancelar_pedido'))data.pedido.status='cancelado';
    if(body.p_acao==='corrigir_valor')data.profissionais[0].cliente_resposta='divergencia';
    if(body.p_acao==='responder') {if(body.p_contratou)data.profissionais[0].status='confirmado';else data.profissionais[0].cliente_resposta='nao_contratou';}
    return {ok:true,json:async()=>JSON.parse(JSON.stringify(data))};
  };
  w.eval(fs.readFileSync('qf-acompanhamento.js','utf8'));
  const box=w.document.querySelector('main');await w.QFAcompanhamento.mount(box,id,options);
  return {dom,w,box,calls};
}
const proposal=()=>({id:'p1',profissional:'Carlos Pintor',status:'informado',valor_centavos:50000,plano_livre_ativo:true});
test('Acompanhamento: estados preservam suas ações e painel integrado não repete resumo/navegação',async()=>{
  for(const status of ['aberto','em_negociacao','cancelado','concluido','finalizado']) {
    const {dom,box,calls}=await screen(status);
    assert.equal(!!box.querySelector('[data-qf-owner-cancel]'),status==='aberto');
    await box.querySelector('[data-qf-owner-refresh]').onclick();assert.equal(calls.length,2);
    assert.equal(box.querySelector('a').getAttribute('href'),'/?app=1#/cliente/pedidos');dom.window.close();
  }
  const {dom,box}=await screen('em_negociacao',[proposal()],{embedded:true});
  assert.equal(box.querySelector('[data-qf-owner-cancel]'),null);assert.equal(box.querySelector('h1'),null);assert.equal(box.querySelector('a'),null);
  assert.equal(box.querySelectorAll('article').length,1);
  assert.equal(box.querySelectorAll('[data-qf-owner-concluir]').length,1);
  assert.equal(box.querySelector('.qf-owner-check span').textContent,'Confirmo a contratação, a conclusão do serviço e o valor final informado acima.');
  dom.window.close();
});
test('Acompanhamento: confirmar conclusão, corrigir, não contratar e cancelar mantêm os mesmos parâmetros',async()=>{
  for(const action of ['confirmar','corrigir','nao','cancelar']) {
    const {dom,w,box,calls}=await screen('aberto',[proposal()]);
    if(action==='confirmar') {
      const form=box.querySelector('form');form.elements.codigo_seguranca.value='123456';form.elements.concluido.checked=true;
      await form.onsubmit({preventDefault(){}});
      assert.equal(calls[1].body.p_codigo,'123456');assert.equal(calls[1].body.p_concluido,true);
      assert.equal(calls[1].body.p_valor_centavos,50000);assert.ok(box.querySelector('[data-qf-owner-saved]'));
    } else if(action==='cancelar') {
      w.confirm=()=>false;await box.querySelector('[data-qf-owner-cancel]').onclick();assert.equal(calls.length,1);
      w.confirm=()=>true;await box.querySelector('[data-qf-owner-cancel]').onclick();
      assert.ok(calls[1].url.endsWith('qf13_cancelar_pedido'));assert.equal(box.querySelector('[data-qf-owner-cancel]'),null);
    } else {
      await box.querySelector('[data-qf-owner-answer="'+action+'"]').onclick();
      assert.equal(calls[1].body.p_acao,action==='corrigir'?'corrigir_valor':'responder');
      assert.equal(calls[1].body.p_contratou,false);assert.equal(calls[1].body.p_valor_centavos,null);
      assert.equal(box.querySelector('form'),null);
    }
    dom.window.close();
  }
});
test('Acompanhamento: conclusão exige código; relato independente não conclui nem cobra',async()=>{
  const {dom,box,calls}=await screen('em_negociacao',[proposal()]);
  await box.querySelector('[data-qf-owner-concluir]').onsubmit({preventDefault(){}});
  assert.equal(calls.length,1);
  assert.match(box.querySelector('article [role=status]').textContent,/Confira o código/);
  dom.window.close();
  for(const f of [{...proposal(),status:'confirmado'},{...proposal(),cliente_resposta:'divergencia'},{...proposal(),cliente_resposta:'nao_contratou'}]) {
    const s=await screen('em_negociacao',[f]);
    assert.equal(s.box.querySelector('[data-qf-owner-concluir]'),null);
    assert.equal(s.box.querySelector('[data-qf-owner-relato]'),null);
    s.dom.window.close();
  }
  for(const f of [{...proposal(),status:'recusado'},{...proposal(),valor_centavos:null,status:'pendente'}]){
    const s=await screen('em_negociacao',[f]);
    assert.ok(s.box.querySelector('[data-qf-owner-relato]'),'cliente pode relatar sem depender da declaração do profissional');
    assert.equal(s.box.querySelector('[data-qf-owner-concluir]'),null,'relato não é confirmação de conclusão');
    s.dom.window.close();
  }
});
