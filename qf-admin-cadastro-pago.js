/* Quem Faz: acompanhamento de quem iniciou cadastro profissional e seu pagamento.
 * Fonte: Supabase, apenas admin; nunca tratar pré-cadastro pendente como profissional ativo.
 */
(function(global){
  'use strict';
  const PANEL='qf-admin-cadastro-pago';
  const state={busca:'',situacao:'todos',offset:0,limite:30};
  let busy=false, lastAt=0, installed=false;
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const asNum=v=>Math.max(0,Math.floor(Number(v)||0));
  const money=v=>(asNum(v)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const date=v=>{try{return v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'—';}catch(_){return '—';}};
  const admin=()=>!!(global.DB&&global.DB.getSession&&global.DB.getSession()?.role==='admin');
  const api=()=>global.QFAdminCloud?.enabled?global.QFAdminCloud.client:null;
  const path=()=>String(global.location.hash||'');
  function host(){
    if(!/^#\/admin\/(?:dashboard|planos|profissionais|financeiro)(?:$|[/?])/.test(path()))return null;
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
  function record(r){
    const pay=String(r.plano||'')==='livre'?'Quem Faz Livre':'Avulso';
    const detail=(r.status==='aprovado'&&r.perfil_ativo!==true)
      ? 'Aprovado pela Efí; conta ainda não aparece como profissional ativo.'
      : (r.status==='pendente'?'Não confirmado pela Efí. Sem perfil ativo e sem saldo liberado.':'');
    const tel=waNumber(r.telefone);
    const contacts='<p><strong>E-mail:</strong> '+esc(r.email||'Não informado')
      +(r.email? ' <a href="mailto:'+encodeURIComponent(r.email)+'">Enviar e-mail</a>':'')+'</p>'
      +'<p><strong>Telefone:</strong> '+esc(r.telefone||'Não informado')
      +(tel?' <a href="https://wa.me/'+tel+'" target="_blank" rel="noopener noreferrer">WhatsApp</a>':'')+'</p>';
    return '<details class="qf-pre-record"><summary><span class="qf-pre-record-head"><b>'+esc(r.nome||'Profissional sem nome')+'</b><small>'+esc(pay)+' · '+money(r.valor_centavos)+' · '+esc(String(r.metodo||'').toUpperCase())+'</small></span>'
      +'<span class="qf-pre-status'+(r.status==='pendente'?' is-pending':'')+'">'+esc(situation(r))+'</span></summary>'
      +'<div class="qf-pre-detail">'+contacts
      +'<p><strong>Iniciado:</strong> '+esc(date(r.criado_em))+' · <strong>Pago:</strong> '+esc(date(r.aprovado_em))+'</p>'
      +'<p><strong>Resgate do cadastro:</strong> '+esc(date(r.resgatado_em))+'</p>'
      +'<p><strong>Referência Efí:</strong> '+esc(r.provedor_id||'Ainda não gerada')+'</p>'
      +(detail?'<p class="qf-pre-note">'+esc(detail)+'</p>':'')+'</div></details>';
  }
  function render(panel,s,d){
    if(!panel.isConnected)return;
    const entries=Array.isArray(d.itens)?d.itens:[];
    const total=asNum(d.total);
    panel.innerHTML='<div class="qf-pre-top"><div><h2>Pré-cadastros dos profissionais</h2><p>Quem escolheu Avulso ou Livre, mesmo sem pagar</p></div>'
      +'<button type="button" class="btn btn--outline" data-qf-pre-refresh>Atualizar dados</button></div>'
      +'<div class="qf-pre-stats">'
      +stat('Aguardando pagamento',asNum(s.pre_cadastros_pendentes))
      +stat('Pagos, sem ativar',asNum(s.pagos_ainda_nao_resgatados))
      +stat('Avulso inicial pago',asNum(s.avulsos_iniciais_pagos))
      +stat('Livre inicial pago',asNum(s.livres_iniciais_pagos))+'</div>'
      +'<p class="qf-pre-explain">O interessado que não pagou <strong>não está ativo</strong> nem recebeu os R$ 13 na carteira. Pagamento pendente não é receita.</p>'
      +'<form class="qf-pre-filters" data-qf-pre-form><label>Buscar nome, e-mail ou telefone<input type="search" name="busca" maxlength="120" placeholder="Ex.: Nilson" value="'+esc(state.busca)+'"></label>'
      +'<label>Situação<select name="situacao">'+[['todos','Todos'],['pendente','Aguardando pagamento'],['aprovado','Pagos sem ativar'],['ativado','Ativados'],['cancelado','Cancelados ou expirados']]
        .map(v=>'<option value="'+v[0]+'"'+(v[0]===state.situacao?' selected':'')+'>'+v[1]+'</option>').join('')+'</select></label>'
      +'<button type="submit" class="btn btn--primary">Filtrar</button></form>'
      +'<div class="qf-pre-list-meta">'+total+' resultado(s) · Mostrando '+entries.length+' a partir de '+(state.offset+1)+'</div>'
      +'<div class="qf-pre-list">'+(entries.length?entries.map(record).join(''):'<p class="qf-pre-empty">Nenhum pré-cadastro encontrado para este filtro.</p>')+'</div>'
      +'<div class="qf-pre-pager">'+(state.offset>0?'<button type="button" class="btn btn--outline" data-qf-pre-previous>Anterior</button>':'')
      +(state.offset+entries.length<total?'<button type="button" class="btn btn--outline" data-qf-pre-next>Próximos</button>':'')+'</div>'
      +'<details class="qf-pre-finance"><summary>Conciliação e valores</summary><p>Recebido em crédito pré-pago Avulso: <strong>'+money(s.recebido_avulso_inicial_centavos)+'</strong> · Livre inicial recebido: <strong>'+money(s.recebido_livre_inicial_centavos)+'</strong></p>'
      +'<p>Carteiras (inclui outros créditos): <strong>'+money(s.saldo_carteiras_total_centavos)+'</strong>. Carteira é saldo do profissional, não faturamento.</p>'
      +'<p>Assinaturas Livre vigentes: '+asNum(s.livres_vigentes)+' · Vencidas: '+asNum(s.livres_vencidos)+'</p>'
      +'<p>O status é o último registrado pela plataforma. A recarga só é liberada após conciliação bancária; atualizar a lista não confirma pagamentos na Efí.</p></details>';
    const form=panel.querySelector('[data-qf-pre-form]');
    form.addEventListener('submit',e=>{
      e.preventDefault();state.busca=form.elements.busca.value.trim();state.situacao=form.elements.situacao.value;state.offset=0;load(panel);
    });
    panel.querySelector('[data-qf-pre-refresh]').addEventListener('click',()=>{lastAt=0;load(panel);});
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
        client.rpc('qf_admin_pre_cadastros',{p_limite:state.limite,p_offset:state.offset,p_busca:state.busca,p_situacao:state.situacao})
      ]);
      if(a.error||b.error||!a.data||!b.data)throw Error('Não foi possível ler os cadastros. Confira a sessão administrativa e a atualização do banco.');
      render(panel,a.data,b.data);
    }catch(err){
      if(panel.isConnected)panel.innerHTML='<p class="qf-pre-error">'+esc(err.message||'Falha ao carregar cadastros')+'</p><button type="button" class="btn btn--outline" data-qf-pre-retry>Tentar novamente</button>';
      const retry=panel.querySelector('[data-qf-pre-retry]');
      if(retry)retry.addEventListener('click',()=>load(panel));
    }finally{busy=false;panel.removeAttribute('aria-busy');}
  }
  function place(){
    insertMenu();
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
      +'.qf-pre-nav-mark{font-size:20px;color:#fa8b22}@media(max-width:700px){.qf-pre-panel{padding:12px!important}.qf-pre-stats{grid-template-columns:1fr 1fr}.qf-pre-stat strong{font-size:20px}.qf-pre-record summary{align-items:flex-start}}';
    document.head.appendChild(css);
    let queued=false;
    new MutationObserver(()=>{if(queued)return;queued=true;setTimeout(()=>{queued=false;place();},90);}).observe(document.body,{childList:true,subtree:true});
    global.addEventListener('hashchange',place);
    place();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);
  else install();
})(window);
