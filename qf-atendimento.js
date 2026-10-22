/* Atendimento determinístico: uma pergunta por vez, sem custo de API de IA. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QFAtendimento = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const options = (key, label, choices) => ({key, label, choices});
  function questions(a) {
    const service = norm(a.servico);
    let detail = 'O que precisa ser feito? Descreva o problema e o resultado esperado, sem nome, telefone ou endereço.';
    let scope = 'Qual é a quantidade, o tamanho e o estado atual do que será atendido?';
    if (/faxin|limpeza|higien|sofa|estof|colch|tapet|carpet/.test(service)) {
      detail = 'O que precisa de limpeza e qual é o tipo de sujeira ou dificuldade? Não informe dados pessoais.';
      scope = 'Qual é a área em m² ou a quantidade e o tamanho dos itens?';
    } else if (/pint|pedreir|reforma|impermeab/.test(service)) {
      detail = 'Qual reparo ou acabamento você precisa e como está a superfície? Não informe dados pessoais.';
      scope = 'Qual é a área aproximada em m² e há altura ou acesso difícil?';
    } else if (/eletric|encan|chaveir|ar.cond|tecnic/.test(service)) {
      detail = 'Qual é o defeito e em qual equipamento ou instalação? Não informe dados pessoais.';
      scope = 'Quantos pontos ou equipamentos são e qual é o modelo ou condição de acesso?';
    } else if (/mont|movel|moveis/.test(service)) {
      detail = 'Quais móveis precisam de montagem ou reparo? Não informe dados pessoais.';
      scope = 'Quantas peças são, quais os modelos e estão desmontadas?';
    }
    const list = [
      {key:'servico',label:'Qual serviço você precisa?',catalog:true},
      {key:'detalhes',label:detail,multiline:true,min:8},
      {key:'escopo',label:scope,multiline:true,min:3},
      {key:'cidade',label:'Em qual cidade será o serviço?'},
      options('uf','Qual é o estado (UF)?','AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').map(x=>[x,x])),
      {key:'bairro',label:'Em qual bairro? O endereço exato será combinado após o desbloqueio.'},
      options('urgencia','Qual é a urgência?',[['normal','Pode ser agendado'],['urgente','Preciso com urgência']]),
      {key:'orcamento',label:'Qual é seu orçamento máximo em reais? Digite o valor ou “a combinar”.',budget:true},
      options('materiais','Quem fornece os materiais ou ferramentas?',[['profissional','O profissional leva tudo'],['cliente','Eu forneço'],['combinar','Vamos combinar'],['nao_aplica','Não se aplica']]),
      {key:'data',label:'Em qual data você pretende realizar o serviço?',type:'date'},
      {key:'disponibilidade',label:'Em quais horários você pode receber o profissional?',min:3},
      {key:'nome',label:'Qual é seu nome?',autocomplete:'name'},
      {key:'contato',label:'Qual é seu celular com DDD para contato?',type:'tel',autocomplete:'tel'},
      options('intencao','Você pretende contratar um profissional?',[['contratar','Sim, quero receber propostas para contratar'],['pesquisando','Estou apenas pesquisando preços']]),
      options('autorizacao','Autoriza compartilhar seu nome, contato e detalhes do pedido com quem desbloquear?',[['sim','Sim, autorizo'],['nao','Não autorizo']]),
      options('tipo','Como deseja receber o atendimento?',[['tradicional','Tradicional: até 4 profissionais'],['garante','Quem Faz Garante: contato exclusivo com 1 profissional']])
    ];
    if (a.tipo === 'garante') list.push(options('qualificacao','Você confirma que definiu o escopo, pode decidir a contratação e estará disponível para responder ao profissional?',[['sim','Sim, confirmo'],['nao','Não, prefiro o tradicional']]));
    return list;
  }
  function budget(v) {
    if (norm(v) === 'a combinar') return null;
    const s=String(v || '').replace(/^R\$\s*/i,'').trim();
    if (!/^\d+(?:\.\d{3})*(?:,\d{1,2})?$/.test(s)) return NaN;
    const n=Math.round(Number(s.replace(/\./g,'').replace(',','.'))*100);
    return n>=100 && n<=50000000 ? n : NaN;
  }
  function validate(q,v,a) {
    v=String(v || '').trim();
    if (!v || v.length>2000) return 'Responda esta pergunta para continuar (até 2.000 caracteres).';
    if (q.choices && !q.choices.some(c=>c[0]===v)) return 'Escolha uma das opções.';
    if (v.length<(q.min||2)) return 'Descreva um pouco melhor para continuar.';
    if (q.key==='contato' && !/^[1-9]{2}9?\d{8}$/.test(v.replace(/\D/g,''))) return 'Confira o celular com DDD.';
    if (q.budget && Number.isNaN(budget(v))) return 'Informe um valor válido, como 300 ou 1.500,00, ou “a combinar”.';
    if (q.key==='data' && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))) return 'Escolha hoje ou uma data futura.';
    if (q.key==='autorizacao' && v==='nao') return 'Sem autorização não podemos publicar nem compartilhar o pedido. Você pode voltar ou encerrar.';
    if (q.key==='tipo' && v==='garante' && (a.intencao!=='contratar' || budget(a.orcamento)===null || a.materiais==='combinar')) return 'Para o Garante, confirme intenção de contratar, orçamento numérico e quem fornece os materiais. Você pode voltar e ajustar ou escolher Tradicional.';
    if (q.key==='qualificacao' && v!=='sim') return 'Volte e escolha Tradicional para continuar.';
    return '';
  }
  function validAll(a) { for (const q of questions(a)) {const e=validate(q,a[q.key],a);if(e) return e;} return ''; }
  function payload(a,id,categoria) {
    const error=validAll(a); if(error) throw Error(error);
    return {versao:1,chave:id,categoria,servico:a.servico,detalhes:a.detalhes,escopo:a.escopo,cidade:a.cidade,uf:a.uf,bairro:a.bairro,urgencia:a.urgencia,orcamento_centavos:budget(a.orcamento),materiais:a.materiais,data:a.data,disponibilidade:a.disponibilidade,nome:a.nome,contato:a.contato.replace(/\D/g,''),intencao:a.intencao,autorizacao:a.autorizacao,tipo:a.tipo,qualificacao:a.tipo==='garante'?a.qualificacao:null};
  }
  function html() {
    return '<div class="view"><section class="card stack" style="max-width:620px;margin:0 auto" data-qf-atendimento><h1 class="h2">Vamos entender seu pedido</h1><p>Publicação gratuita. Uma pergunta por vez.</p><div data-at-question></div><p class="text--sm text--secondary">Quem Faz Garante oferece exclusividade de contato. Não é garantia de contratação ou execução. Você decide se contrata.</p></section></div>';
  }
  function category(service) {
    const DB=root.DB, found=DB.categories().find(c=>c.id!=='cat_outros' && norm(c.nome)===norm(service));
    if (found) return found;
    let hash=2166136261; const key=norm(service);
    for(let i=0;i<key.length;i++){hash^=key.charCodeAt(i);hash=Math.imul(hash,16777619);}
    const cat={id:'cat_custom_'+key.replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,38)+'_'+(hash>>>0).toString(36),nome:service,icon:'briefcase',custom:true,leadTier:'padrao'};
    DB.state.categories.push(cat); DB.persist(); return cat;
  }
  function mount(content,params,user) {
    const box=content.querySelector('[data-qf-atendimento]'); if(!box || box.dataset.mounted) return;
    box.dataset.mounted='1';
    const area=box.querySelector('[data-at-question]');
    // PII stays in memory. Persist only the random idempotency key, never answers.
    let id; try{id=root.sessionStorage.getItem('qf_atendimento_key');}catch(_){}
    if(!id) {id=root.crypto.randomUUID();try{root.sessionStorage.setItem('qf_atendimento_key',id);}catch(_){}}
    const a={}, cat=params.catId && root.DB.categoryById(params.catId);
    if(cat) a.servico=cat.nome;
    let step=0,busy=false;
    const draw=()=>{
      const list=questions(a),q=list[step];
      if(!q){review();return;}
      const value=a[q.key]||'';
      let field=q.choices ? '<select class="input" id="at-answer" required><option value="">Selecione</option>'+q.choices.map(c=>'<option value="'+esc(c[0])+'"'+(c[0]===value?' selected':'')+'>'+esc(c[1])+'</option>').join('')+'</select>' : q.multiline ? '<textarea class="input" id="at-answer" maxlength="2000" rows="4" required>'+esc(value)+'</textarea>' : '<input class="input" id="at-answer" type="'+(q.type||'text')+'" maxlength="2000" autocomplete="'+(q.autocomplete||'off')+'" '+(q.catalog?'list="at-services"':'')+' value="'+esc(value)+'" required>'+(q.catalog?'<datalist id="at-services">'+root.DB.categories().filter(c=>c.id!=='cat_outros').map(c=>'<option value="'+esc(c.nome)+'"></option>').join('')+'</datalist>':'');
      area.innerHTML='<p class="text--sm">Pergunta '+(step+1)+' de '+list.length+'</p><form novalidate><label class="text--strong" for="at-answer">'+esc(q.label)+'</label>'+field+'<p role="alert" data-at-error></p><div class="row"><button type="button" class="btn btn--outline" data-at-back'+(step===0?' disabled':'')+'>Voltar</button><button type="submit" class="btn btn--primary">Continuar</button></div></form>';
      area.querySelector('form').onsubmit=e=>{e.preventDefault();const v=area.querySelector('#at-answer').value.trim();const err=validate(q,v,a);if(err){area.querySelector('[data-at-error]').textContent=err;return;}a[q.key]=v;step++;draw();};
      area.querySelector('[data-at-back]').onclick=()=>{step--;draw();};
      area.querySelector('#at-answer').focus();
    };
    const review=()=>{
      area.innerHTML='<h2 class="h3">Revise antes de publicar</h2><dl>'+questions(a).map(q=>'<dt class="text--strong">'+esc(q.label)+'</dt><dd style="margin:4px 0 16px;overflow-wrap:anywhere">'+esc((q.choices||[]).find(c=>c[0]===a[q.key])?.[1]||a[q.key])+'</dd>').join('')+'</dl><p>Seus dados pessoais ficam protegidos até o desbloqueio. '+(a.tipo==='garante'?'Um profissional verificado poderá desbloquear este pedido pelo valor de 4 desbloqueios normais.':'Até 4 profissionais poderão desbloquear este pedido.')+'</p><p role="alert" data-at-error></p><div class="row"><button type="button" class="btn btn--outline" data-at-back>Editar respostas</button><button type="button" class="btn btn--primary" data-at-publish>Publicar grátis</button></div>';
      area.querySelector('[data-at-back]').onclick=()=>{step=0;draw();};
      area.querySelector('[data-at-publish]').onclick=async()=>{
        if(busy)return;busy=true;const button=area.querySelector('[data-at-publish]');button.disabled=true;button.textContent='Publicando…';
        try{
          const Cloud=root.QFCloud;if(!Cloud||!Cloud.enabled)throw Error('Conecte-se à internet para publicar com segurança.');
          let current=user;
          if(!current){const result=await Cloud.signUp('cliente',{nome:a.nome,telefone:a.contato,quickClient:true});if(!result.ok||!result.user||result.needsConfirmation)throw Error(result.error||'Não foi possível iniciar seu acesso.');current=result.user;}
          const c=category(a.servico),at=payload(a,id,c.id);
          const req=await Cloud.createCall({clienteId:current.id,categoriaId:c.id,descricao:a.detalhes,endereco:{cidade:a.cidade,uf:a.uf,bairro:a.bairro,cep:''},urgencia:a.urgencia,atendimento:at,prioridade:false,maxOrcamentos:a.tipo==='garante'?1:4});
          try{root.sessionStorage.removeItem('qf_atendimento_key');}catch(_){}
          root.navigate('/cliente/pedido/'+req.id,true);
        }catch(e){area.querySelector('[data-at-error]').textContent=e.message||'Não foi possível publicar. Tente novamente; seu pedido não será duplicado.';}
        finally{busy=false;button.disabled=false;button.textContent='Publicar grátis';}
      };
    };
    draw();
  }
  async function enrich(reqs) {
    if(!reqs.length || !root.QFCloud?.client)return reqs;
    // Fail closed: no stale normal-price action while the metadata could not load.
    const res=await root.QFCloud.client.rpc('qf_atendimento_info',{p_ids:reqs.map(r=>r.id).slice(0,500)});
    if(res.error)throw Error('Não foi possível conferir a modalidade dos pedidos. Atualize a lista.');
    for(const row of res.data||[]){const r=reqs.find(x=>x.id===row.chamado_id);if(r){r.atendimentoTipo=row.tipo;r.maxOrcamentos=row.tipo==='garante'?1:4;r.limiteParticipantes=r.maxOrcamentos;}}
    return reqs;
  }
  function install(Screens) {
    const oldCadastro=Screens.authCadastro,oldAnon=Screens.afterRenderAnon,oldAfter=Screens.afterRender;
    Screens.authCadastro=p=>p.role==='cliente'?html():oldCadastro(p);
    Screens.clienteNovoPedidoRender=()=>html();
    Screens.afterRenderAnon=function(p,c,params){if(p==='/auth/:role/cadastro'&&params.role==='cliente'){mount(c,params,null);return;}return oldAnon?.apply(this,arguments);};
    Screens.afterRender=function(p,c,params,user){if(p==='/cliente/novo-pedido/:catId'){mount(c,params,user);return;}return oldAfter?.apply(this,arguments);};
  }
  if (root.document) root.document.addEventListener('click',async function(e){
    const button=e.target.closest('[data-at-admin]');if(!button)return;
    const Cloud=root.QFAdminCloud;if(!Cloud?.client)return;
    button.disabled=true;
    try{
      const res=await Cloud.client.rpc('qf_atendimento_respostas',{p_id:button.getAttribute('data-at-admin')});
      if(res.error || !res.data)throw Error('Não foi possível consultar o atendimento.');
      const a=res.data;
      root.PU.openSheet('<h2 class="h3">Atendimento automático</h2><dl>'+questions(a).map(q=>'<dt class="text--strong">'+esc(q.label)+'</dt><dd>'+esc(a[q.key]??(q.key==='orcamento'?(a.orcamento_centavos==null?'A combinar':(a.orcamento_centavos/100).toFixed(2)):''))+'</dd>').join('')+'<dt>Registro no servidor</dt><dd>'+esc(a.registrado_em)+'</dd></dl>');
    }catch(error){root.PU.toast(error.message,'danger');}finally{button.disabled=false;}
  });
  return {questions,validate,validAll,budget,payload,html,mount,enrich,install};
});
