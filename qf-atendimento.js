/* Atendimento simplificado em quatro etapas, sem custo de API de IA. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QFAtendimento = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  // Respostas pessoais ficam somente na memória privada deste módulo, nunca em window ou storage.
  let inMemoryDraft=null;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const options = (key, label, choices) => ({key, label, choices});
  function materialsApplicable(service) { return !/advog|aula|consultor|contador|contabil|tradutor|professor/.test(norm(service)); }
  function budgetChoices(service) {
    const large=/pint|pedreir|reforma|impermeab|telhad/.test(norm(service));
    const cleaning=/faxin|limpeza|higien|sofa|estof|colch|tapet|carpet/.test(norm(service));
    const limits=large ? [0,50000,150000,300000,1000000] : cleaning ? [0,15000,30000,60000,150000] : [0,20000,50000,100000,300000];
    const money=n=>'R$ '+(n/100).toLocaleString('pt-BR');
    return limits.slice(1).map((max,i)=>[limits[i]+':'+max,(i?money(limits[i])+' a ':'Até ')+money(max)])
      .concat([['avaliacao','Preciso de uma avaliação']]);
  }
  function budgetLabel(v,service) { return budgetChoices(service).find(c=>c[0]===v)?.[1] || v; }
  function garanteElegivel(a) {
    return a.intencao==='contratar' && budget(a.orcamento)!==null && !Number.isNaN(budget(a.orcamento)) && (!materialsApplicable(a.servico) || (a.materiais && !['combinar','nao_aplica'].includes(a.materiais)));
  }
  function stages(a) {
    const groups=[['Serviço',['servico','detalhes','escopo']],['Local e prazo',['cidade','uf','bairro','urgencia','data','disponibilidade']],['Condições',['materiais','orcamento']],['Confirmar e publicar',['nome','contato','intencao','tipo','qualificacao','autorizacao']]];
    return groups.map(([title,keys])=>({title,questions:keys.flatMap(key=>questions(a).filter(q=>q.key===key && !(key==='servico'&&a.__servicePrefilled)))}));
  }
  function questions(a) {
    const service = norm(a.servico);
    // Cada profissão tem perguntas e quantidades compatíveis com o serviço.
    let detailChoices=[['visita','Avaliar no local'],['instalacao','Instalar'],['conserto','Consertar'],['manutencao','Fazer manutenção'],['outro','Outro serviço']];
    let scopeChoices=[['um','Um item ou local'],['alguns','Alguns itens ou locais'],['varios','Vários itens ou locais'],['avaliar','Preciso de avaliação']];
    let detailLabel='O que você precisa fazer?',scopeLabel='Qual o tamanho do serviço?';
    const categories=[
      [/diarist|faxin|empregad|domestic|limpeza residencial|limpeza comercial|pos.obra|p[oó]s.obra/,[['comum','Faxina comum'],['pesada','Faxina pesada'],['pos_obra','Limpeza pós-obra'],['mudanca','Limpeza de mudança'],['outro','Outro tipo de faxina']],[['ate2','Até 2 cômodos'],['3a4','3 a 4 cômodos'],['5mais','5 ou mais cômodos'],['avaliar','Preciso de avaliação']],'Qual tipo de faxina você precisa?','Quantos cômodos precisam de limpeza?'],
      [/sofa|estof|colch|tapet|carpet|cortina|persiana|higien|lavagem/,[['sofa','Sofá ou poltrona'],['colchao','Colchão'],['tapete','Tapete ou carpete'],['cortina','Cortina ou persiana'],['automotivo','Estofado automotivo'],['outro','Outro item']],[['um','1 item'],['dois','2 itens'],['tresmais','3 ou mais itens'],['avaliar','Preciso de avaliação']],'O que precisa de higienização?','Quantos itens precisam de limpeza?'],
      [/pint/,[['paredes','Pintar paredes'],['casa','Pintar casa ou apartamento'],['portao','Pintar portão ou grades'],['retoque','Fazer retoques'],['outro','Outro serviço']],[['pequena','Área pequena'],['media','Área média'],['grande','Área grande'],['avaliar','Preciso de avaliação']],'O que precisa pintar?','Qual o tamanho da área?'],
      [/eletric|chuveiro|tomada|disjuntor/,[['tomada','Tomadas ou interruptores'],['chuveiro','Chuveiro elétrico'],['disjuntor','Disjuntor ou quadro'],['fiacao','Fiação ou instalação'],['outro','Outro serviço elétrico']],null,'Qual serviço elétrico você precisa?'],
      [/encan|hidraul|vazamento|desentup/,[['vazamento','Consertar vazamento'],['torneira','Torneira ou registro'],['descarga','Descarga ou vaso sanitário'],['tubulacao','Tubulação ou encanamento'],['entupimento','Desentupimento'],['outro','Outro serviço hidráulico']],null,'Qual problema hidráulico precisa resolver?'],
      [/mont|movel|moveis|marcen/,[['montagem','Montar móveis'],['desmontagem','Desmontar móveis'],['reparo','Consertar móveis'],['ajuste','Ajustar portas ou gavetas'],['outro','Outro serviço']],[['um','1 móvel'],['dois','2 móveis'],['tresmais','3 ou mais móveis'],['avaliar','Preciso de avaliação']],'O que precisa fazer com os móveis?','Quantos móveis?'],
      [/informat|computador|notebook|tecnic|celular|impressora/,[['computador','Computador ou notebook'],['impressora','Impressora'],['rede','Internet ou rede Wi-Fi'],['software','Programa ou sistema'],['outro','Outro equipamento']],[['um','1 equipamento'],['dois','2 equipamentos'],['varios','3 ou mais equipamentos'],['avaliar','Preciso de avaliação']],'Qual equipamento ou sistema precisa de atendimento?','Quantos equipamentos?'],
      [/chaveir|fechadura|portao automatic/,[['porta','Abrir porta'],['fechadura','Trocar ou reparar fechadura'],['chave','Fazer ou copiar chave'],['portao','Consertar portão'],['outro','Outro serviço']],null,'Qual serviço de chaveiro você precisa?'],
      [/ar.cond|refrigera|climatiz/,[['instalacao','Instalar ar-condicionado'],['limpeza','Limpar ou higienizar'],['conserto','Consertar defeito'],['carga','Verificar refrigeração'],['outro','Outro serviço']],[['um','1 aparelho'],['dois','2 aparelhos'],['varios','3 ou mais aparelhos'],['avaliar','Preciso de avaliação']],'Qual serviço de ar-condicionado?','Quantos aparelhos?'],
      [/pedreir|reforma|alvenar|azulej|piso|telhad|impermeab/,[['reparo','Pequeno reparo'],['piso','Assentar piso ou revestimento'],['parede','Construir ou reformar parede'],['telhado','Telhado ou infiltração'],['outro','Outro serviço de obra']],[['pequena','Área pequena'],['media','Área média'],['grande','Área grande'],['avaliar','Preciso de avaliação']],'Qual serviço de obra você precisa?','Qual o tamanho da área?'],
      [/jardin|paisag|poda/,[['grama','Cortar grama'],['poda','Podar plantas ou árvores'],['limpeza','Limpar jardim'],['plantio','Plantar ou cuidar de plantas'],['outro','Outro serviço']],[['pequena','Jardim pequeno'],['media','Jardim médio'],['grande','Jardim grande'],['avaliar','Preciso de avaliação']],'O que precisa fazer no jardim?','Qual o tamanho do jardim?'],
      [/dedetiz|praga|cupim/,[['barata','Baratas ou formigas'],['rato','Ratos'],['cupim','Cupins'],['mosquito','Mosquitos'],['outro','Outras pragas']],[['um','Um cômodo'],['alguns','Alguns cômodos'],['varios','Imóvel inteiro'],['avaliar','Preciso de avaliação']],'Qual praga precisa controlar?','Qual área precisa de tratamento?'],
      [/frete|mudanc|carreto|transporte/,[['movel','Transportar móveis'],['eletro','Transportar eletrodomésticos'],['mudanca','Mudança residencial'],['carga','Transportar mercadorias'],['outro','Outro transporte']],[['pequena','Poucos itens'],['media','Uma carga média'],['grande','Mudança completa'],['avaliar','Preciso de avaliação']],'O que precisa transportar?','Qual o volume aproximado?']
    ];
    const match=categories.find(c=>c[0].test(service));
    if(match){detailChoices=match[1];if(match[2])scopeChoices=match[2];detailLabel=match[3];if(match[4])scopeLabel=match[4];}
    const list = [
      {key:'servico',label:'Qual serviço você precisa?',catalog:true},
      options('detalhes',detailLabel,detailChoices),
      options('escopo',scopeLabel,scopeChoices),
      {key:'cidade',label:'Em qual cidade será o serviço?'},
      options('uf','Qual é o estado (UF)?','AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').map(x=>[x,x])),
      {key:'bairro',label:'Em qual bairro? O endereço exato será combinado após o desbloqueio.'},
      options('urgencia','Quando precisa?',[['normal','Quero agendar'],['hoje','Ainda hoje'],['urgente','Preciso com urgência']]),
      {...options('orcamento','Você sabe quanto pretende gastar? Pode pedir uma avaliação.',budgetChoices(a.servico)),budget:true},
      options('materiais','Quem fornece os materiais ou ferramentas?',[['profissional','O profissional leva tudo'],['cliente','Eu forneço'],['combinar','Vamos combinar'],['nao_aplica','Não se aplica']]),
      {key:'data',label:'Em qual data você pretende realizar o serviço?',type:'date'},
      {key:'disponibilidade',label:'Em quais horários você pode receber o profissional?',min:3},
      {key:'nome',label:'Seu nome',autocomplete:'name'},
      {key:'contato',label:'Celular com DDD',type:'tel',autocomplete:'tel'},
      options('intencao','Pretende contratar?',[['contratar','Sim, quero receber propostas para contratar'],['pesquisando','Estou apenas pesquisando preços']]),
      options('autorizacao','Podemos mostrar seu telefone ao profissional que aceitar seu pedido?',[['sim','Sim, autorizo'],['nao','Não autorizo']]),
      options('tipo','Quer conversar com até 4 profissionais ou somente 1?',[['tradicional','Tradicional — até 4 profissionais'],['garante','Quem Faz Garante — 1 profissional']])
    ];
    if (a.tipo === 'garante' && garanteElegivel(a)) list.push(options('qualificacao','Você pode conversar com o profissional e decidir sobre a contratação?',[['sim','Sim, confirmo'],['nao','Não, prefiro o tradicional']]));
    return list.filter(q=>(q.key!=='materiais'||materialsApplicable(a.servico)) && (q.key!=='data'||a.urgencia==='normal') && (q.key!=='tipo'||garanteElegivel(a)));
  }
  function budget(v) {
    if (['a combinar','avaliacao','preciso de uma avaliacao'].includes(norm(v))) return null;
    if (/^\d+:\d+$/.test(String(v))) { const [min,max]=String(v).split(':').map(Number); return min>=0 && max>min && max<=50000000 ? max : NaN; }
    const s=String(v || '').replace(/^R\$\s*/i,'').trim();
    if (!/^\d+(?:\.\d{3})*(?:,\d{1,2})?$/.test(s)) return NaN;
    const n=Math.round(Number(s.replace(/\./g,'').replace(',','.'))*100);
    return n>=100 && n<=50000000 ? n : NaN;
  }
  function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
  function validate(q,v,a) {
    v=String(v || '').trim();
    if (!v || v.length>2000) return 'Responda esta pergunta para continuar (até 2.000 caracteres).';
    if (q.key==='uf' && !'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(v.toUpperCase())) return 'Informe a sigla do estado, por exemplo SP.';
    if (q.choices && !q.choices.some(c=>c[0]===v)) return 'Escolha uma das opções.';
    if (v.length<(q.min||1)) return 'Descreva um pouco melhor para continuar.';
    if (q.key==='contato' && (!/^[1-9]{2}9\d{8}$/.test(v.replace(/\D/g,'')) || (root.QFUI?.validPhone && !root.QFUI.validPhone(v)))) return 'Confira o celular com DDD.';
    if (q.budget && Number.isNaN(budget(v))) return 'Informe um valor válido, como 300 ou 1.500,00, ou “a combinar”.';
    if (q.key==='data' && ['hoje','urgente'].includes(a.urgencia) && v!==today()) return 'Para este prazo, selecione a data de hoje ou altere o prazo.';
    if (q.key==='data' && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))) return 'Escolha hoje ou uma data futura.';
    if (q.key==='autorizacao' && v==='nao') return 'Sem autorização não podemos publicar nem compartilhar o pedido. Você pode voltar ou encerrar.';
    if (q.key==='tipo' && v==='garante' && (a.intencao!=='contratar' || budget(a.orcamento)===null || a.materiais==='combinar')) return 'Para o Garante, confirme intenção de contratar, uma faixa de orçamento definida e quem fornece os materiais. Você pode voltar e ajustar ou escolher Tradicional.';
    if (q.key==='qualificacao' && v!=='sim') return 'Volte e escolha Tradicional para continuar.';
    return '';
  }
  function validAll(a) { for (const q of questions(a)) {const e=validate(q,a[q.key],a);if(e) return e;} return ''; }
  function payload(a,id,categoria) {
    const error=validAll(a); if(error) throw Error(error);
    const labels=questions(a);
    const answerLabel=key=>{const q=labels.find(x=>x.key===key);return String((q?.choices||[]).find(c=>c[0]===a[key])?.[1]||a[key]||'').trim();};
    const detalhes=answerLabel('detalhes');
    const escopo=answerLabel('escopo');
    if(detalhes.length<8||escopo.length<3)throw Error('Escolha o tipo e o tamanho do serviço antes de publicar.');
    return {versao:1,chave:id,categoria,servico:a.servico,detalhes,escopo,cidade:a.cidade,uf:a.uf,bairro:a.bairro,urgencia:a.urgencia==='hoje'?'normal':a.urgencia,prazo:a.urgencia,orcamento_faixa:a.orcamento,orcamento_centavos:/^\d+:\d+$/.test(a.orcamento)?null:budget(a.orcamento),materiais:materialsApplicable(a.servico)?a.materiais:'nao_aplica',data:a.data,disponibilidade:a.disponibilidade,nome:a.nome,contato:a.contato.replace(/\D/g,''),intencao:a.intencao,autorizacao:a.autorizacao,tipo:a.tipo,qualificacao:a.tipo==='garante'?a.qualificacao:null};
  }
  function html() {
    return '<div class="view" data-qf-atendimento-layout><section class="card stack" style="max-width:620px;margin:0 auto;width:100%" data-qf-atendimento><h1 class="h2"><span style="color:#1769d5">Quem </span><span style="color:#f47b20">Faz</span> Serviços</h1><p>É grátis e rapidinho.</p><div data-at-question></div><p class="text--sm text--secondary">Seus dados ficam protegidos. Você decide se contrata.</p></section></div>';
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
    let categoryId=params.catId;
    if(!categoryId){try{categoryId=root.sessionStorage.getItem('qf_pending_category');}catch(_){}}
    const oldDraft=inMemoryDraft;
    const homeService=root.QFHomeDraft&&root.QFHomeDraft.service;
    const reuse=!!(oldDraft&&oldDraft.answers&&(!categoryId||oldDraft.categoryId===categoryId)&&(!homeService||norm(oldDraft.answers.servico)===norm(homeService)));
    const a=reuse?oldDraft.answers:{}, cat=categoryId && root.DB.categoryById(categoryId);
    if(cat) {a.servico=cat.nome;a.__servicePrefilled=true;}
    else if(root.QFHomeDraft && root.QFHomeDraft.service) {a.servico=String(root.QFHomeDraft.service).trim().slice(0,120);a.__servicePrefilled=true;}
    if(user){a.nome=user.nome||'';a.contato=user.telefone||'';}
    let step=reuse?oldDraft.step:0,questionIndex=reuse?oldDraft.questionIndex:0,busy=false,currentUser=user;
    const field=q=>{
      const value=a[q.key]||'', id='at-'+q.key;
      const disabled=q.key==='contato'&&user?.telefone ? ' readonly' : '';
      const input=q.key==='uf' ? '<select class="input" id="'+id+'" required><option value="">Selecione o estado</option>'+('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')).map(uf=>'<option value="'+uf+'"'+(uf===value?' selected':'')+'>'+uf+'</option>').join('')+'</select>' : q.choices ? '<div class="stack--sm" role="radiogroup" aria-label="'+esc(q.label)+'">'+q.choices.map(c=>'<label class="card" style="display:flex;align-items:center;gap:12px;padding:14px;cursor:pointer;border:1px solid var(--border,#d9e2ef);border-radius:12px"><input type="radio" name="'+id+'" value="'+esc(c[0])+'"'+(c[0]===value?' checked':'')+' required style="width:20px;height:20px;accent-color:#1769d5"><span>'+esc(c[1])+'</span></label>').join('')+'</div>' : q.multiline ? '<textarea class="input" id="'+id+'" maxlength="2000" rows="2" required>'+esc(value)+'</textarea>' : '<input class="input" id="'+id+'" type="'+(q.type||'text')+'" maxlength="2000" autocomplete="'+(q.autocomplete||'off')+'" '+(q.catalog?'list="at-services"':'')+' value="'+esc(value)+'"'+disabled+' required>'+(q.catalog?'<datalist id="at-services">'+root.DB.categories().filter(c=>c.id!=='cat_outros').map(c=>'<option value="'+esc(c.nome)+'"></option>').join('')+'</datalist>':'');
      return '<div class="stack--sm" style="min-width:0"><label class="text--strong" for="'+id+'">'+esc(q.label)+'</label>'+input+'<p class="text--sm" role="alert" data-error="'+q.key+'"></p></div>';
    };
    const read=()=>{for(const q of stages(a)[step].questions){const el=q.key==='uf'?area.querySelector('#at-'+q.key):(q.choices?area.querySelector('input[name="at-'+q.key+'"]:checked'):area.querySelector('#at-'+q.key));if(el)a[q.key]=q.key==='uf'?el.value.trim().toUpperCase():el.value.trim();}};
    const draw=()=>{
      if (!garanteElegivel(a)) {a.tipo='tradicional';delete a.qualificacao;}
      // Preserva o atendimento na memória caso banners ou dados públicos remontem a tela.
      inMemoryDraft={answers:a,step,questionIndex,categoryId};
      const stage=stages(a)[step];
      questionIndex=Math.min(questionIndex,stage.questions.length-1);
      const active=stage.questions[questionIndex];
      area.innerHTML='<style>[data-qf-atendimento-layout]{min-height:calc(100dvh - 112px);display:flex;flex-direction:column;justify-content:center;padding-block:clamp(16px,3vh,36px);box-sizing:border-box}[data-qf-atendimento-layout] [data-qf-atendimento]{width:100%;flex-shrink:0}@media(max-height:650px){[data-qf-atendimento-layout]{min-height:auto;justify-content:flex-start}}[data-qf-atendimento]{border-radius:22px!important;box-shadow:0 10px 32px rgba(22,82,154,.09);border:1px solid #e5ecf6!important}[data-qf-atendimento] h1{color:#1769d5;font-weight:800}[data-qf-atendimento] progress{accent-color:#f47b20;height:8px}[data-qf-atendimento] label.card{background:#fff!important;border:1.5px solid #dce6f3!important;border-radius:14px!important;box-shadow:none!important}[data-qf-atendimento] label.card:has(input:checked){border-color:#f47b20!important;background:#fff6ed!important}[data-qf-atendimento] .btn--primary{background:#f47b20!important;border-color:#f47b20!important;color:#fff!important;border-radius:12px!important;min-height:48px}[data-qf-atendimento] .btn--outline{border-radius:12px!important;min-height:48px}</style><p class="text--sm" data-at-progress>Etapa '+(step+1)+' de 4 — '+esc(stage.title)+'</p><progress aria-label="Etapa do pedido" max="4" value="'+(step+1)+'" style="width:100%"></progress><form class="stack" novalidate>'+(step===3?'<h2 class="h3">Revise antes de publicar</h2><details><summary>'+esc(a.servico)+' · '+esc(a.bairro)+', '+esc(a.cidade)+' — Ver resumo</summary><dl>'+questions(a).filter(q=>!['nome','contato','intencao','autorizacao','tipo','qualificacao'].includes(q.key)).map(q=>'<dt class="text--strong">'+esc(q.label)+'</dt><dd style="margin:4px 0 12px;overflow-wrap:anywhere">'+esc((q.choices||[]).find(c=>c[0]===a[q.key])?.[1]||a[q.key])+'</dd>').join('')+'</dl></details>':'')+field(active)+(step===3?'<p>Contato protegido até o desbloqueio. Você decide se contrata.</p>':'')+'<p role="alert" data-at-error></p><div class="row" style="background:var(--surface,#fff);padding:12px 0;gap:8px"><button type="button" class="btn btn--outline" data-at-back'+'>Voltar</button><button type="submit" class="btn btn--primary" '+(step===3&&questionIndex===stage.questions.length-1?'data-at-publish':'')+'>'+(step===3&&questionIndex===stage.questions.length-1?'Publicar grátis':'Continuar')+'</button></div></form>';
      area.querySelector('form').onsubmit=e=>{
        e.preventDefault();if(busy)return;area.querySelectorAll('[role="alert"]').forEach(el=>el.textContent='');read();
        const list=[active];
        for(const q of list){const error=validate(q,a[q.key],a);if(error){const el=area.querySelector('[data-error="'+q.key+'"]')||area.querySelector('[data-at-error]');el.textContent=error;area.querySelector('#at-'+q.key)?.focus();return;}}
        if(questionIndex<stages(a)[step].questions.length-1){questionIndex++;draw();}else if(step<3){step++;questionIndex=0;draw();}else {const err=validAll(a);if(err){area.querySelector('[data-at-error]').textContent=err;return;}publish();}
      };
      area.querySelector('[data-at-back]').onclick=()=>{if(busy)return;read();if(step===0&&questionIndex===0){root.navigate('/',true);return;}if(questionIndex>0)questionIndex--;else if(step>0){step--;questionIndex=stages(a)[step].questions.length-1;}draw();};
      for(const key of ['servico','tipo','urgencia']){
        const inputs=area.querySelectorAll('#at-'+key+', input[name="at-'+key+'"]');inputs.forEach(input=>input.addEventListener('change',()=>{
          if(busy)return;read();if(key==='servico'){delete a.orcamento;for(const q of questions(a)){const label=area.querySelector('label[for="at-'+q.key+'"]');if(label)label.textContent=q.label;}return;}
          if(key==='urgencia'&&['hoje','urgente'].includes(a.urgencia))a.data=today();
          if(key==='tipo'&&a.tipo!=='garante')delete a.qualificacao;
          draw();
        }));
      }
    };
    const publish=async()=>{
        if(busy)return;busy=true;const button=area.querySelector('[data-at-publish]');button.disabled=true;button.textContent='Publicando…';area.querySelectorAll('input,select,textarea,[data-at-back]').forEach(el=>el.disabled=true);
        try{
          const Cloud=root.QFCloud;if(!Cloud||!Cloud.enabled)throw Error('Conecte-se à internet para publicar com segurança.');
          let current=currentUser;
          if(!current){const result=await Cloud.signUp('cliente',{nome:a.nome,telefone:a.contato,quickClient:true});if(!result.ok||!result.user||result.needsConfirmation)throw Error(result.error||'Não foi possível iniciar seu acesso.');current=result.user;currentUser=current;}
          const c=category(a.servico),at=payload(a,id,c.id);
          const req=await Cloud.createCall({clienteId:current.id,categoriaId:c.id,descricao:at.detalhes,endereco:{cidade:a.cidade,uf:a.uf,bairro:a.bairro,cep:''},urgencia:a.urgencia,atendimento:at,prioridade:false,maxOrcamentos:a.tipo==='garante'?1:4});
          try{root.sessionStorage.removeItem('qf_atendimento_key');}catch(_){}
          inMemoryDraft=null;
          root.navigate('/cliente/pedido/'+req.id,true);
        }catch(e){area.querySelector('[data-at-error]').textContent=String(e.message||'Não foi possível publicar. Tente novamente.').replace(/respostas_invalidas_ou_sem_autorizacao|resposta_obrigatoria:.*/,'Revise as respostas do serviço e confirme a autorização antes de publicar.').replace(/localizacao_indisponivel.*/,'Não foi possível localizar sua cidade. Confira cidade e estado e tente novamente.');}
        finally{busy=false;area.querySelectorAll('input,select,textarea,[data-at-back]').forEach(el=>el.disabled=false);button.disabled=false;button.textContent='Publicar grátis';}
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
      root.PU.openSheet('<h2 class="h3">Atendimento automático</h2><dl>'+questions(a).map(q=>'<dt class="text--strong">'+esc(q.label)+'</dt><dd>'+esc((q.key==='orcamento'&&a.orcamento_faixa?budgetLabel(a.orcamento_faixa,a.servico):a[q.key])??(q.key==='orcamento'?(a.orcamento_centavos==null?'A combinar':(a.orcamento_centavos/100).toFixed(2)):''))+'</dd>').join('')+'<dt>Registro no servidor</dt><dd>'+esc(a.registrado_em)+'</dd></dl>');
    }catch(error){root.PU.toast(error.message,'danger');}finally{button.disabled=false;}
  });
  return {questions,stages,materialsApplicable,budgetChoices,budgetLabel,validate,validAll,budget,payload,html,mount,enrich,install};
});
