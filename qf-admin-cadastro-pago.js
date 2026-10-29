/* Quem Faz: acompanhamento de quem iniciou cadastro profissional e seu pagamento.
 * Fonte: Supabase, apenas admin; nunca tratar pré-cadastro pendente como profissional ativo.
 */
(function(global){
  'use strict';
  const PANEL='qf-admin-cadastro-pago';
  const state={busca:'',situacao:'todos',offset:0,limite:30};
  let busy=false, lastAt=0, installed=false;
  const WALLET_PANEL='qf-admin-saldo-carteiras';
  let walletBusy=false, walletUpdatedAt=0;
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const asNum=v=>Math.max(0,Math.floor(Number(v)||0));
  const money=v=>(asNum(v)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const date=v=>{try{return v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'—';}catch(_){return '—';}};
  const admin=()=>!!(global.DB&&global.DB.getSession&&global.DB.getSession()?.role==='admin');
  const api=()=>global.QFAdminCloud?.enabled?global.QFAdminCloud.client:null;
  const path=()=>String(global.location.hash||'');
  function host(){
    if(!/^#\/admin\/planos(?:$|[/?])/.test(path()))return null;
    if(!document.body.classList.contains('qf-adm-body')||!admin())return null;
    return document.getElementById('app-content');
  }
  function insertMenu(){
    if(!admin())return;
    const nav=document.querySelector('.qf-adm-nav');
    if(!nav||nav.querySelector('[data-qf-pre-nav]'))return;
    const before=nav.querySelector('[data-nav="/admin/planos"]');
    if(!before)return;
    const b=document.createElement('button');
    b.type='button';b.className='qf-adm-nav__item';b.dataset.nav='/admin/planos';
    b.dataset.qfPreNav='1';
    b.innerHTML='<span aria-hidden="true" class="qf-pre-nav-mark">◉</span><span>Pré-cadastros e pagamentos</span>';
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();global.navigate('/admin/planos',true);setTimeout(()=>document.getElementById(PANEL)?.scrollIntoView({block:'start'}),250);});
    before.before(b);
  }
  function stat(k,v){return '<div class="qf-pre-stat"><strong>'+esc(v)+'</strong><span>'+esc(k)+'</span></div>';}
  function situation(r){
    if(r.perfil_ativo===true)return 'Cadastro ativo — pagamento confirmado';
    if(r.status==='aprovado')return 'Pagamento aprovado — aguardando ativação';
    if(r.status==='pendente')return 'Aguardando pagamento — não cadastrado';
    if(r.status==='cancelado')return 'Pagamento cancelado — não cadastrado';
    if(r.status==='expirado')return 'Pagamento expirado — não cadastrado';
    return 'Não ativado · '+String(r.status||'desconhecido');
  }
  function waNumber(p){let d=String(p||'').replace(/\D/g,'');if(d.length===10||d.length===11)d='55'+d;return d.length>=12&&d.length<=13&&d.startsWith('55')?d:'';}
  let records=[];
  const names={pendente:'Aguardando pagamento',teste:'Em teste',vencido:'Teste vencido',cortesia:'Cortesia',pago:'Plano pago',convite:'Convite preparado — prazo inicia após identificação'};
  function record(r,i){
    const until=r.situacao==='pago'?r.pago_ate:r.fim_em;
    const days=until?Math.max(0,Math.ceil((Date.parse(until)-Date.parse(r.servidor_agora||new Date().toISOString())))/86400000):0;
    return '<details class="qf-pre-record"><summary><span class="qf-pre-record-head"><b>'+esc(r.nome||'Profissional')+'</b><small>'+esc(r.email)+'</small></span><span class="qf-pre-status">'+esc(names[r.situacao]||r.situacao)+'</span></summary><div class="qf-pre-detail"><p><strong>Cadastro:</strong> '+(r.profissional_id?'Profissional cadastrado':'Pré-cadastro — identificação pendente')+'</p><p><strong>Plano:</strong> '+esc(names[r.situacao])+' · '+Math.ceil(days)+' dia(s) restante(s)</p><p><strong>Início:</strong> '+date(r.inicio_em)+' · <strong>Vencimento:</strong> '+date(until)+'</p><p><strong>WhatsApp:</strong> '+esc(r.telefone||'Não informado')+' · Último contato: '+date(r.ultimo_whatsapp)+'</p><p><strong>E-mail:</strong> '+esc(r.email)+' · Último contato: '+date(r.ultimo_email)+'</p><div class="qf-pre-actions">'+
    (r.situacao!=='pago'?'<button class="btn btn--primary" data-benefit="ativar" data-record="'+i+'">ATIVAR PLANO MANUAL</button>':'<span>Assinatura paga preservada</span>')+
    (r.tipo==='cortesia'&&!r.encerrado_em?'<button class="btn btn--outline" data-benefit="prorrogar" data-record="'+i+'">Prorrogar</button><button class="btn btn--outline" data-benefit="encerrar" data-record="'+i+'">Encerrar cortesia</button>':'')+
    (!r.contato_recusado?((waNumber(r.telefone)?'<button class="btn btn--outline" data-contact="whatsapp" data-record="'+i+'">WhatsApp</button>':'')+(r.email?'<button class="btn btn--outline" data-contact="email" data-record="'+i+'">Enviar e-mail</button>':'')+'<button class="btn btn--outline" data-contact="recusa" data-record="'+i+'">Não receber convites</button>'):'<strong>Contato recusado — não enviar convites</strong>')+
    '</div><details><summary>Histórico de ativações e alterações</summary>'+(r.historico?.length?r.historico.map(h=>'<p>'+date(h.criado_em)+' · '+esc(h.acao)+' · '+esc(h.motivo)+' · Responsável: '+esc(h.responsavel_nome||h.responsavel||'Sistema')+'</p>').join(''):'<p>Nenhuma liberação registrada.</p>')+'</details></div></details>';
  }
  function modal(title,body){const d=document.createElement('dialog');d.className='qf-benefit-modal';d.innerHTML='<h2>'+esc(title)+'</h2>'+body+'<p role="alert"></p><button type="button" class="btn btn--outline" data-close>Fechar</button>';document.body.append(d);d.querySelector('[data-close]').onclick=()=>{d.close();d.remove();};d.addEventListener('close',()=>d.remove());d.showModal();return d;}
  function benefit(r,action,panel){
    const d=modal(action==='encerrar'?'Encerrar cortesia':'Quem Faz Livre — ativação manual','<p><strong>'+esc(r.nome)+'</strong><br>'+esc(r.email)+'</p><p>Situação: '+esc(names[r.situacao])+'</p><p>Início: '+(r.profissional_id?'Após confirmação':'Após conclusão da identificação')+' · Vencimento calculado pelo servidor.</p><form class="stack"><label>Plano<input value="Quem Faz Livre — cortesia administrativa" readonly></label>'+(action!=='encerrar'?'<label>Dias de liberação<div class="qf-benefit-days">'+[1,2,3,4,7,15,30].map(n=>'<button type="button" data-days="'+n+'">'+n+'</button>').join('')+'</div><input name="dias" type="number" min="1" max="365" value="2" required aria-label="Outra quantidade de dias"></label><p data-expiry></p>':'')+'<label>Motivo<textarea name="motivo" minlength="5" maxlength="500" required></textarea></label><button class="btn btn--primary" type="submit">'+(action==='encerrar'?'CONFIRMAR ENCERRAMENTO':'CONFIRMAR ATIVAÇÃO MANUAL')+'</button></form>');
    const f=d.querySelector('form');const update=()=>{if(f.elements.dias)d.querySelector('[data-expiry]').textContent=r.profissional_id?'Previsão de vencimento: '+date(new Date(Math.max(Date.now(),action==='prorrogar'?Date.parse(r.fim_em)||0:0)+Number(f.elements.dias.value)*86400000).toISOString()):'O prazo começa somente após identificação e ativação válidas.';};
    d.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{f.elements.dias.value=b.dataset.days;update();});if(f.elements.dias)f.elements.dias.oninput=update;update();
    f.onsubmit=async e=>{e.preventDefault();if(!f.reportValidity())return;const b=f.querySelector('[type=submit]');b.disabled=true;try{const out=await api().rpc('qf_admin_livre_beneficio',{p_email:r.email,p_acao:action,p_dias:Number(f.elements.dias?.value||1),p_motivo:f.elements.motivo.value.trim()});if(out.error||!out.data?.ok)throw Error(out.error?.message||'Não foi possível ativar');d.close();d.remove();lastAt=0;await refreshPanel(panel);}catch(e){d.querySelector('[role=alert]').textContent=e.message;}finally{b.disabled=false;}};
  }
  function contactText(r,channel){
    const first=String(r.nome||'Profissional').trim().split(/\s+/)[0];
    if(['cortesia','teste'].includes(r.situacao))return {subject:'Seu Quem Faz Livre está ativo',body:'Olá, '+first+'! Seu Quem Faz Livre está liberado '+(r.situacao==='cortesia'?'como cortesia administrativa':'em teste grátis')+' até '+date(r.fim_em)+'. Acesse sua carteira para acompanhar a validade. Comissão de 13% e prestação de contas mantidas. Não haverá cobrança automática.\n\nhttps://quemfazservico.com.br\n\nEquipe Quem Faz'};
    if(r.teste_utilizado||r.situacao==='pago')return {subject:first+', continue com o Quem Faz Livre',body:'Olá, '+first+'! Tudo bem?\n\nAqui é da equipe Quem Faz.\n\nPara continuar conhecendo as oportunidades da sua região e desbloqueando novos pedidos, ative o Quem Faz Livre por R$ 39,90 por 30 dias — menos de R$ 1,50 por dia.\n\nNão haverá cobrança automática. Comissão de 13% e prestação de contas mantidas.\n\nAcesse: https://quemfazservico.com.br\n\nSe precisar, podemos ajudar com seu cadastro.\n\nQuem Faz — Precisou? Encontre quem faz!'};
    if(channel==='email')return {subject:String(r.nome||first)+', você ganhou 2 dias para conhecer o Quem Faz Livre!',body:'Olá, '+String(r.nome||first)+'!\n\nVocê iniciou seu cadastro no Quem Faz e queremos te ajudar a conhecer nossa plataforma.\n\nAgora é possível experimentar o Quem Faz Livre gratuitamente por 2 dias.\n\nDurante o teste, você poderá conhecer oportunidades profissionais na sua região e utilizar os recursos do plano.\n\nApós o período gratuito, para continuar desbloqueando novas oportunidades, basta contratar o Quem Faz Livre por R$ 39,90 por 30 dias.\n\nNão existe cobrança automática depois do teste. Comissão de 13% e prestação de contas mantidas.\n\nAcesse: https://quemfazservico.com.br\n\nEquipe Quem Faz'};
    return {subject:first+', você ganhou 2 dias para conhecer o Quem Faz Livre!',body:'Olá, '+first+'! Tudo bem?\n\nAqui é da equipe Quem Faz.\n\nPercebemos que você começou seu cadastro para trabalhar pela plataforma, mas ainda não concluiu sua ativação.\n\nQueremos te oferecer uma oportunidade especial:\n\nTESTE O QUEM FAZ LIVRE GRÁTIS POR 2 DIAS!\n\nDurante esse período, você poderá conhecer as oportunidades da sua região e experimentar os recursos do plano.\n\nDepois dos 2 dias, para continuar desbloqueando novas oportunidades, o Quem Faz Livre custa R$ 39,90 por 30 dias — menos de R$ 1,50 por dia.\n\nVocê não precisa pagar para começar o teste e não haverá cobrança automática ao final. Comissão de 13% e prestação de contas mantidas.\n\nAcesse: https://quemfazservico.com.br\n\nSe precisar, podemos te ajudar a concluir seu cadastro.\n\nQuem Faz — Precisou? Encontre quem faz!'};
  }
  function contact(r,channel,panel){
    const m=contactText(r,channel);const last=channel==='whatsapp'?r.ultimo_whatsapp:r.ultimo_email;
    const d=modal(channel==='recusa'?'Registrar recusa de contato':'Mensagem pronta — '+r.nome,channel==='recusa'?'<p>Confirme que este interessado pediu para não receber convites.</p><button type="button" class="btn btn--primary" data-sent>CONFIRMAR RECUSA</button>':'<p>Destinatário: '+esc(channel==='whatsapp'?r.telefone:r.email)+'</p>'+(last?'<p>Último contato: '+date(last)+'. Evite repetir convites.</p>':'')+'<p><strong>'+esc(m.subject)+'</strong></p><textarea readonly rows="12">'+esc(m.body)+'</textarea><a class="btn btn--primary" target="_blank" rel="noopener noreferrer" href="'+(channel==='whatsapp'?'https://wa.me/'+waNumber(r.telefone)+'?text='+encodeURIComponent(m.body):'mailto:'+encodeURIComponent(r.email)+'?subject='+encodeURIComponent(m.subject)+'&body='+encodeURIComponent(m.body))+'">Abrir '+(channel==='whatsapp'?'WhatsApp':'e-mail')+' com mensagem</a><p>Depois de enviar no aplicativo, confirme abaixo. Abrir a conversa não registra envio.</p><button type="button" class="btn btn--outline" data-sent>CONFIRMAR QUE ENVIEI</button>');
    d.querySelector('[data-sent]').onclick=async()=>{try{const out=await api().rpc('qf_admin_livre_contato',{p_email:r.email,p_canal:channel});if(out.error)throw out.error;d.close();lastAt=0;refreshPanel(panel);}catch(e){d.querySelector('[role=alert]').textContent=e.message;}};
  }
  function render(panel,s,d){
    if(!panel.isConnected)return;
    const entries=Array.isArray(d.itens)?d.itens:[];records=entries.map(r=>({...r,servidor_agora:d.servidor_agora}));
    const total=asNum(d.total);
    panel.innerHTML='<div class="qf-pre-top"><div><h2>Pré-cadastros dos profissionais</h2><p>Quem escolheu Avulso ou Livre, mesmo sem pagar</p></div>'
      +'<button type="button" class="btn btn--outline" data-qf-pre-refresh>Atualizar dados</button></div>'
      +'<div class="qf-pre-stats">'
      +stat('Aguardando pagamento',asNum(s.pre_cadastros_pendentes))
      +stat('Pagos, sem ativar',asNum(s.pagos_ainda_nao_resgatados))
      +stat('Testes ativos',asNum(d.kpis?.testes_ativos))+stat('Vencem hoje',asNum(d.kpis?.vencem_hoje))+stat('Testes vencidos',asNum(d.kpis?.testes_vencidos))+stat('Cortesias',asNum(d.kpis?.cortesias))+stat('Planos pagos ativos',asNum(d.kpis?.planos_pagos))+stat('Contrataram após teste',asNum(d.kpis?.convertidos))+stat('Conversão teste → pago',d.kpis?.total_testes?((asNum(d.kpis.convertidos)/d.kpis.total_testes)*100).toFixed(1)+'%':'0%')+'</div>'
      +'<p class="qf-pre-explain">Cadastro ativo exige pagamento bancário, teste válido ou cortesia autorizada. Testes e cortesias não geram receita nem saldo financeiro.</p>'
      +'<form class="qf-pre-filters" data-qf-pre-form><label>Buscar nome, e-mail ou telefone<input type="search" name="busca" maxlength="120" placeholder="Ex.: Nilson" value="'+esc(state.busca)+'"></label>'
      +'<label>Situação<select name="situacao">'+[['todos','Todos'],['pendente','Aguardando pagamento'],['teste','Em teste'],['vencido','Teste vencido'],['cortesia','Cortesia'],['pago','Plano pago'],['convite','Convites preparados']]
        .map(v=>'<option value="'+v[0]+'"'+(v[0]===state.situacao?' selected':'')+'>'+v[1]+'</option>').join('')+'</select></label>'
      +'<button type="submit" class="btn btn--primary">Filtrar</button></form>'
      +'<div class="qf-pre-list-meta">'+total+' resultado(s) · Mostrando '+entries.length+' a partir de '+(state.offset+1)+'</div>'
      +'<div class="qf-pre-list">'+(entries.length?records.map(record).join(''):'<p class="qf-pre-empty">Nenhum pré-cadastro encontrado para este filtro.</p>')+'</div>'
      +'<div class="qf-pre-pager">'+(state.offset>0?'<button type="button" class="btn btn--outline" data-qf-pre-previous>Anterior</button>':'')
      +(state.offset+entries.length<total?'<button type="button" class="btn btn--outline" data-qf-pre-next>Próximos</button>':'')+'</div>';
    panel.querySelectorAll('[data-benefit]').forEach(b=>b.onclick=()=>benefit(records[Number(b.dataset.record)],b.dataset.benefit,panel));
    panel.querySelectorAll('[data-contact]').forEach(b=>b.onclick=()=>contact(records[Number(b.dataset.record)],b.dataset.contact,panel));
    const form=panel.querySelector('[data-qf-pre-form]');
    form.addEventListener('submit',e=>{
      e.preventDefault();state.busca=form.elements.busca.value.trim();state.situacao=form.elements.situacao.value;state.offset=0;load(panel);
    });
    panel.querySelector('[data-qf-pre-refresh]').addEventListener('click',()=>{lastAt=0;refreshPanel(panel);});
    const prev=panel.querySelector('[data-qf-pre-previous]'),next=panel.querySelector('[data-qf-pre-next]');
    if(prev)prev.addEventListener('click',()=>{state.offset=Math.max(0,state.offset-state.limite);load(panel);});
    if(next)next.addEventListener('click',()=>{state.offset+=state.limite;load(panel);});
  }
  async function load(panel){
    const client=api();
    if(!client||!admin()){
      panel.innerHTML='<p>Conecte-se como administrador para consultar cadastros.</p>';
      return;
    }
    if(busy)return;
    busy=true;lastAt=Date.now();
    panel.setAttribute('aria-busy','true');
    try{
      const [a,b]=await Promise.all([
        client.rpc('qf_admin_cadastro_pagamentos'),
        client.rpc('qf_admin_livre_painel',{p_offset:state.offset,p_busca:state.busca,p_situacao:state.situacao})
      ]);
      if(a.error||b.error||!a.data||!b.data)throw Error('Não foi possível ler os cadastros. Confira a sessão administrativa e a atualização do banco.');
      render(panel,a.data,b.data);
    }catch(err){
      if(panel.isConnected)panel.innerHTML='<p class="qf-pre-error">'+esc(err.message||'Falha ao carregar cadastros')+'</p><button type="button" class="btn btn--outline" data-qf-pre-retry>Tentar novamente</button>';
      const retry=panel.querySelector('[data-qf-pre-retry]');
      if(retry)retry.addEventListener('click',()=>load(panel));
    }finally{busy=false;panel.removeAttribute('aria-busy');}
  }
  // Os créditos de carteiras pertencem somente a Movimentações, não à ficha de
  // cliente, profissional, nem à relação de pré-cadastros/planos.
  function movementHost(){
    if(!/^#\/admin\/movimentacoes(?:$|[/?])/.test(path()))return null;
    if(!document.body.classList.contains('qf-adm-body')||!admin())return null;
    return document.getElementById('app-content');
  }
  function renderWallet(panel, data){
    const saldo=money(data.saldo_carteiras_total_centavos);
    panel.innerHTML='<div class="qf-wallet-top"><div><h2>Créditos nas carteiras dos profissionais</h2>'
      +'<p>Saldo total ainda disponível para desbloqueios</p></div>'
      +'<button type="button" class="btn btn--outline" data-qf-wallet-refresh>Atualizar saldo</button></div>'
      +'<strong class="qf-wallet-amount">'+esc(saldo)+'</strong>'
      +'<p class="qf-wallet-note">Esse valor pertence às carteiras dos profissionais, incluindo recargas, ajustes e bônus remanescentes. '
      +'Não é o faturamento do Quem Faz nem dinheiro disponível para saque da plataforma.</p>';
    const refresh=panel.querySelector('[data-qf-wallet-refresh]');
    if(refresh)refresh.addEventListener('click',()=>{walletUpdatedAt=0;loadWallet(panel);});
  }
  async function loadWallet(panel){
    const client=api();
    if(!client||!admin()){
      panel.innerHTML='<p>Entre como administrador para consultar movimentações.</p>';return;
    }
    if(walletBusy)return;
    walletBusy=true;walletUpdatedAt=Date.now();
    panel.setAttribute('aria-busy','true');
    try{
      const {data,error}=await client.rpc('qf_admin_cadastro_pagamentos');
      if(error||!data)throw Error('Não foi possível consultar as carteiras.');
      if(panel.isConnected&&admin())renderWallet(panel,data);
    }catch(err){
      if(panel.isConnected)panel.innerHTML='<p class="qf-pre-error">'+esc(err.message||'Erro ao consultar saldos')+'</p>'
        +'<button type="button" class="btn btn--outline" data-qf-wallet-retry>Tentar novamente</button>';
      const b=panel.querySelector('[data-qf-wallet-retry]');
      if(b)b.addEventListener('click',()=>loadWallet(panel));
    }finally{walletBusy=false;panel.removeAttribute('aria-busy');}
  }
  function placeWallet(){
    const h=movementHost();if(!h)return;
    let panel=h.querySelector('#'+WALLET_PANEL);
    if(!panel){
      panel=document.createElement('section');panel.id=WALLET_PANEL;
      panel.className='card qf-wallet-panel';
      panel.setAttribute('aria-label','Saldo das carteiras dos profissionais em movimentações');
      panel.innerHTML='<p>Carregando saldo das carteiras...</p>';
      h.prepend(panel);walletUpdatedAt=0;
    }
    if(!walletBusy&&(!walletUpdatedAt||Date.now()-walletUpdatedAt>120000))loadWallet(panel);
  }
  function refreshPanel(panel){return panel.dataset.profissionalEmail?loadDetail(panel):load(panel);}
  async function loadDetail(panel){
    if(!api()||!admin())return;
    try{const r=await api().rpc('qf_admin_livre_painel',{p_busca:panel.dataset.profissionalEmail,p_situacao:'todos',p_offset:0});if(r.error)throw r.error;
      const row=r.data?.itens?.find(x=>String(x.email).toLowerCase()===panel.dataset.profissionalEmail.toLowerCase());if(!row)throw Error('Não foi possível localizar o plano deste cadastro.');
      row.servidor_agora=r.data.servidor_agora;if(!panel.isConnected)return;
      panel.innerHTML='<h2>Quem Faz Livre — controle de acesso</h2>'+record(row,0);
      panel.querySelector('details').open=true;
      panel.querySelectorAll('[data-benefit]').forEach(b=>b.onclick=()=>benefit(row,b.dataset.benefit,panel));
      panel.querySelectorAll('[data-contact]').forEach(b=>b.onclick=()=>contact(row,b.dataset.contact,panel));
    }catch(e){if(panel.isConnected){panel.innerHTML='<p role="alert">'+esc(e.message)+'</p><button class="btn btn--outline" data-detail-retry>Tentar novamente</button>';panel.querySelector('[data-detail-retry]').onclick=()=>loadDetail(panel);}}
  }
  function placeDetail(){
    const m=path().match(/^#\/admin\/profissionais\/([a-f0-9-]{36})(?:$|[/?])/i);if(!m||!admin())return;
    const h=document.getElementById('app-content');if(!h||h.querySelector('[data-profissional-email]'))return;
    const p=global.DB?.profissionalById?.(m[1]);if(!p?.email)return;
    const panel=document.createElement('section');panel.className='qf-pre-panel card';panel.dataset.profissionalEmail=p.email;panel.innerHTML='<p>Consultando plano e cortesias…</p>';h.prepend(panel);loadDetail(panel);
  }
  function place(){
    insertMenu();
    placeDetail();
    placeWallet();
    const h=host();if(!h)return;
    let panel=h.querySelector('#'+PANEL);
    if(!panel){
      panel=document.createElement('section');panel.className='qf-pre-panel card';panel.id=PANEL;
      panel.setAttribute('aria-label','Pré-cadastros e pagamentos de profissionais');
      panel.innerHTML='<p>Carregando pré-cadastros...</p>';
      h.prepend(panel);lastAt=0;
    }
    if(!busy&&(lastAt===0||Date.now()-lastAt>120000))load(panel);
  }
  function install(){
    if(installed)return;installed=true;
    const css=document.createElement('style');
    css.textContent='.qf-pre-panel{padding:18px!important;margin:0 0 20px!important;border:1px solid #dce5f0!important;border-radius:18px!important;background:#fff!important;color:#183047}'
      +'.qf-pre-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.qf-pre-top h2{font-size:19px;font-weight:800;margin:0;color:#133f7d}.qf-pre-top p{color:#566a7d;font-size:13px;margin:4px 0 0}'
      +'.qf-pre-panel button{width:auto;min-height:38px}.qf-pre-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:16px 0}.qf-pre-stat{background:#f2f6fb;padding:12px;border-radius:12px;display:grid;gap:4px}.qf-pre-stat strong{font-size:23px;color:#1055ab}.qf-pre-stat span{font-size:12px;color:#536477}'
      +'.qf-pre-explain{font-size:13px;background:#fff8ee;border:1px solid #f0d9ae;border-radius:10px;padding:10px;margin:12px 0}'
      +'.qf-pre-filters{display:flex;align-items:end;gap:10px;flex-wrap:wrap}.qf-pre-filters label{display:grid;gap:5px;flex:1;min-width:160px;font-size:13px;font-weight:650}.qf-pre-filters input,.qf-pre-filters select{min-height:40px;width:100%;padding:8px;border:1px solid #c8d6e7;border-radius:9px;background:#fff;color:#17324d}'
      +'.qf-pre-list-meta{font-size:12px;color:#5f7182;margin:14px 0 7px}.qf-pre-list{display:grid;gap:8px}.qf-pre-record{border:1px solid #d9e3ed;border-radius:12px;background:#fff}.qf-pre-record summary{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px;cursor:pointer;flex-wrap:wrap}.qf-pre-record-head{display:grid;gap:3px;min-width:0;overflow-wrap:anywhere}.qf-pre-record-head b{color:#18385c;font-size:14px}.qf-pre-record-head small{font-size:12px;color:#68798a}.qf-pre-status{font-size:12px;color:#246347;font-weight:700}.qf-pre-status.is-pending{color:#955207}'
      +'.qf-pre-detail{border-top:1px solid #e6ecf3;padding:12px;display:grid;gap:7px}.qf-pre-detail p{margin:0;font-size:13px;overflow-wrap:anywhere}.qf-pre-detail a{color:#1352a5;text-decoration:underline}.qf-pre-note{color:#86521b}.qf-pre-finance{font-size:13px;margin:12px 0 0}.qf-pre-finance summary{font-weight:700;cursor:pointer}.qf-pre-finance p{margin:6px 0}.qf-pre-pager{display:flex;gap:8px;margin:12px 0}.qf-pre-error{color:#ac2525}.qf-pre-empty{padding:12px;background:#f5f7fa;color:#68798a;border-radius:8px}'
      +'.qf-wallet-panel{padding:18px!important;margin:0 0 18px!important;border:1px solid #dce5f0!important;border-radius:18px!important;background:#fff!important}'
      +'.qf-wallet-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}.qf-wallet-top h2{margin:0;font-size:17px;color:#133f7d}.qf-wallet-top p{font-size:12px;color:#536477;margin:4px 0}'
      +'.qf-wallet-amount{display:block;font-size:27px;letter-spacing:-.02em;color:#1458a8;margin:14px 0 8px}.qf-wallet-note{font-size:13px;line-height:1.5;color:#5b6d7e;margin:0}'
      +'.qf-pre-nav-mark{font-size:20px;color:#fa8b22}@media(max-width:700px){.qf-pre-panel,.qf-wallet-panel{padding:12px!important}.qf-pre-stats{grid-template-columns:1fr 1fr}.qf-pre-stat strong{font-size:20px}.qf-pre-record summary{align-items:flex-start}}';
    css.textContent+='.qf-pre-actions{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.qf-benefit-modal{border:1px solid #c9d7e8;border-radius:20px;padding:22px;width:min(560px,calc(100% - 24px));max-height:90dvh;overflow:auto;background:#fff;color:#183047}.qf-benefit-modal::backdrop{background:#071c38aa}.qf-benefit-modal h2{font-size:21px;color:#134f98}.qf-benefit-modal input,.qf-benefit-modal textarea{width:100%;padding:10px;border:1px solid #cbd6e5;border-radius:9px;box-sizing:border-box}.qf-benefit-modal form{display:grid;gap:16px}.qf-benefit-modal label{display:grid;gap:8px}.qf-benefit-modal .btn{margin:12px 0;min-height:44px;padding:12px 16px}.qf-benefit-days{display:flex;flex-wrap:wrap;gap:8px}.qf-benefit-days button{min-height:40px;padding:8px 12px;border:1px solid #bcd4ef;border-radius:8px;background:#f1f6fd;color:#134f98}.qf-benefit-modal [role=alert]{color:#a12c23;margin:14px 0}';
    document.head.appendChild(css);
    let queued=false;
    new MutationObserver(()=>{if(queued)return;queued=true;setTimeout(()=>{queued=false;place();},90);}).observe(document.body,{childList:true,subtree:true});
    global.addEventListener('hashchange',place);
    place();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);
  else install();
})(window);
