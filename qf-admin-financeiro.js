/* Administração: previsão, recebimento e repasse são evidências diferentes. */
(function(g){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>v==null?'Não informado':(Number(v)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const date=v=>v?new Date(v).toLocaleString('pt-BR'):'—';
 const table=(heads,rows)=>'<div class="qff-scroll"><table><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 const bankIn=p=>!!(p?.end_to_end_id&&p.confirmado_em&&['pago','repassado'].includes(p.status));
 const bankOut=p=>bankIn(p)&&p.status==='repassado'&&!!p.repassado_em;
 function totals(data,neg){
  const paid=new Set(),t={receber:0,recebida:0,repasse:0,entrada:0};
  (data.pagamentos||[]).forEach(p=>{if(bankIn(p))t.entrada+=Number(p.valor_centavos);if(bankOut(p))t.repasse+=Number(p.profissional_centavos);});
  neg.forEach(n=>{if(n.origem!=='comissao13'||n.status!=='confirmado'||!n.fechamento_id||paid.has(n.fechamento_id))return;paid.add(n.fechamento_id);
   if(n.cobranca_status==='paga'&&n.pagamento_conciliado)t.recebida+=Number(n.comissao_centavos||0);
   else if(n.cobranca_status==='pendente')t.receber+=Number(n.comissao_centavos||0);
  });return t;
 }
 function install(){
  if(!g.Screens||g.Screens._qff)return;g.Screens._qff=true;
  const css=g.document.createElement('style');css.textContent='.qff{display:grid;gap:18px;color:#17324d;min-width:0}.qff h2,.qff h3,.qff p{margin:0}.qff-head,.qff-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}.qff-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.qff-card{border:1px solid #d5e2f1;background:#fff;border-radius:16px;padding:16px;text-align:left;color:inherit;cursor:pointer}.qff-card strong{display:block;font-size:22px;margin-top:6px;color:#1458cc}.qff-card[aria-pressed=true]{outline:2px solid #1458cc}.qff section,.qff details{border:1px solid #dbe4ee;border-radius:16px;background:#fff;padding:18px;min-width:0}.qff summary{font-weight:750;cursor:pointer}.qff-scroll{overflow-x:auto;margin-top:14px}.qff table{border-collapse:collapse;width:100%;font-size:13px;min-width:660px}.qff th,.qff td{min-width:120px;text-align:left;vertical-align:top;padding:12px 10px;border-bottom:1px solid #e4ebf3;max-width:320px;overflow-wrap:anywhere}.qff small{display:block;color:#5b6e83;margin-top:4px}.qff .qff-alert{background:#fff7e8;border-color:#e8bb72}.qff label{display:grid;gap:5px;flex:1;min-width:160px}.qff .btn{width:auto;min-height:44px}.qff-controls input,.qff-controls select{width:100%}.qff-error{color:#a22825}@media(max-width:500px){.qff section,.qff details{padding:12px}.qff-cards{grid-template-columns:1fr 1fr}.qff-card{padding:12px}.qff-card strong{font-size:18px}}';css.textContent+=".qff-prof-list{display:grid;gap:8px;margin-top:14px}.qff .qff-prof-item{padding:10px 12px;border:1px solid #e1e8f2;border-radius:12px;background:#f8fbff}.qff .qff-prof-item summary{display:grid;gap:3px;cursor:pointer}.qff .qff-prof-item summary strong{font-size:15px;color:#133c76}.qff .qff-prof-item summary span{font-size:13px;color:#465c73}.qff .qff-prof-item summary small{font-size:12px;color:#526c86}.qff-prof-detail{padding:10px 0 2px;display:grid;gap:6px}.qff-prof-detail p{margin:0;font-size:13px;overflow-wrap:anywhere}";g.document.head.append(css);

  // Menu mais curto: nenhuma ferramenta é removida; ferramentas secundárias ficam recolhidas.
  function simplifyMenu(){
    const menu=g.document.querySelector('.qf-adm-nav');
    if(!menu||menu.querySelector('[data-qff-nav-more]'))return;
    const important=new Set(['/admin/dashboard','/admin/servicos','/admin/negociacoes','/admin/financeiro','/admin/movimentacoes','/admin/profissionais','/admin/clientes','/admin/planos','/admin/suporte','/admin/configuracoes','/admin/marketing-dedicado']);
    const more=g.document.createElement('details');
    more.className='qff-nav-more';more.dataset.qffNavMore='1';
    const heading=g.document.createElement('summary');heading.textContent='Mais ferramentas';
    more.append(heading);
    menu.querySelectorAll('button.qf-adm-nav__item').forEach(button=>{
      if(!important.has(button.dataset.nav)){
        if(button.classList.contains('is-active'))more.open=true;
        more.append(button);
      }
    });
    menu.querySelectorAll('.qf-adm-nav__secao').forEach(heading=>{
      let cursor=heading.nextElementSibling,found=false;
      while(cursor&&!cursor.classList.contains('qf-adm-nav__secao')){
        if(cursor.classList.contains('qf-adm-nav__item'))found=true;
        cursor=cursor.nextElementSibling;
      }
      if(!found)heading.hidden=true;
    });
    menu.append(more);
  }
  css.textContent += '.qff-nav-more{margin:12px 8px 22px;border:1px solid #526981;border-radius:12px;overflow:hidden}.qff-nav-more>summary{padding:12px 14px;color:#edf3fd;font-size:14px;font-weight:750;cursor:pointer;list-style:none}.qff-nav-more .qf-adm-nav__item{width:100%;font-size:13px}.qf-adm-nav__secao[hidden]{display:none!important}';
  const prev=g.Screens.afterRender;
  async function enhance(pattern,content){
   if(!['/admin/dashboard','/admin/financeiro'].includes(pattern)||content.querySelector('[data-qff]'))return;
   const client=g.QFAdminCloud?.client;if(!client)return;
   const root=g.document.createElement('section');root.dataset.qff='';root.className='section qff';(content.querySelector('.view')||content).prepend(root);
   if(pattern==='/admin/dashboard'){
     root.innerHTML='<div role="status" data-qff-alert-manual>Consultando solicitações Pix...</div><a class="btn btn--outline" href="#/admin/financeiro">Abrir financeiro e repasses manuais</a>';
     const alert=root.querySelector('[data-qff-alert-manual]');
     const refresh=async()=>{
       try{
         const r=await client.rpc('qf_repasses_manuais_painel');
         if(!root.isConnected)return;
         if(r.error||!Array.isArray(r.data))throw Error('Consulta de repasses não disponível');
         const pendentes=r.data.filter(x=>['solicitado','em_analise'].includes(x.situacao));
         const confirmados=r.data.filter(x=>x.situacao==='disponivel');
         const total=pendentes.reduce((v,x)=>v+Number(x.profissional_centavos||0),0);
         alert.textContent=pendentes.length+' solicitação(ões) de repasse Pix aguardando ação · '+money(total)+' · '+confirmados.length+' pagamento(s) bancário(s) sem solicitação.';
         alert.style.cssText='background:#fff4e4;border:1px solid #e2ad57;border-radius:12px;padding:12px;font-weight:700;color:#6c430e';
       }catch(e){alert.textContent=e.message||'Não foi possível consultar repasses';}
     };
     await refresh();
     const timer=g.setInterval(()=>{if(!root.isConnected){g.clearInterval(timer);return;}if(g.document.visibilityState!=='hidden')refresh();},30000);
     return;
   }
   const pixHost=g.document.createElement('section');pixHost.dataset.qffPixHost='';pixHost.className='section qff';
   root.before(pixHost);g.QFComissao13?.mountPixAdmin?.(pixHost,client);
   let data={},neg=[],repasses=[],filter='todos',query='',keyFilter='todos',busy=false;
   const orderInFilter=o=>filter==='todos'||filter==='andamento'&&!['concluido','cancelado','expirado'].includes(o.status)||filter==='concluidos'&&o.status==='concluido'||filter==='cancelados'&&['cancelado','expirado'].includes(o.status)||['receber','recebida'].includes(filter)&&neg.some(n=>n.chamado_id===o.id&&(filter==='receber'?n.cobranca_status==='pendente':n.cobranca_status==='paga'&&n.pagamento_conciliado));
   function nomeEspecialidade(codigo){
    const id=String(codigo||'');
    const cadastrada=g.DB?.categoryById?.(id)?.nome;
    if(cadastrada)return cadastrada;
    if(id.startsWith('cat_custom_'))return 'Profissão personalizada';
    return id.replace(/^cat_/,'').replace(/_/g,' ').replace(/(^|\s)\S/g,x=>x.toUpperCase())||'Não informada';
   }
   function situacaoPix(k){
    if(!k.chave_pix)return 'Sem chave Pix';
    return ({validado:'Chave validada',pendente:'Aguardando validação',rejeitado:'Validação recusada'})[k.status]||'Em análise';
   }
   function profissionalCard(k){
    const cats=[...new Set((k.especialidades||[]).map(nomeEspecialidade))].join(', ')||'Não informadas';
    return '<details class="qff-prof-item"><summary><strong>'+esc(k.nome||'Profissional')+'</strong><span>'+esc(k.cidade||'—')+' / '+esc(k.uf||'—')+'</span><small>'+(k.livre_ativo?'Livre ativo':'Livre inativo')+' · '+esc(situacaoPix(k))+'</small></summary>'+
      '<div class="qff-prof-detail"><p><b>Profissões:</b> '+esc(cats)+'</p><p><b>Raio informado:</b> '+esc(k.raio_km||'—')+' km</p><p><b>Horário:</b> '+esc(k.horario_inicio||'—')+' a '+esc(k.horario_fim||'—')+'</p><p><b>Perfil:</b> '+(k.ativo?'Ativo':'Inativo')+'</p><p><b>Chave Pix:</b> '+esc(k.chave_pix||'Não cadastrada')+'</p><p><b>Validação:</b> '+esc(situacaoPix(k))+'</p>'+(k.chave_pix?'<div data-qff-pix-key="'+esc(k.profissional_id)+'"><label>Como a titularidade da chave foi conferida?<textarea class="input" maxlength="1500" data-qff-pix-evidencia placeholder="Registre como conferiu a titularidade no banco"></textarea></label><div class="btn-row"><button type="button" class="btn btn--primary" data-qff-pix-aprovar="true">Validar chave Pix</button><button type="button" class="btn btn--outline" data-qff-pix-aprovar="false">Rejeitar</button></div><p role="status"></p></div>':'')+'</div></details>';
   }
   function render(){
    const orders=data.pedidos||[],keys=data.chaves||[],payments=data.pagamentos||[],t=totals(data,neg);
    const comprovados=new Set(neg.filter(n=>n.origem==='comissao13'&&n.status==='confirmado'&&n.cliente_concluiu_em).map(n=>n.chamado_id));
    const elegiveis=new Set(orders.filter(o=>o.status==='expirado'&&Date.parse(o.criado_em)<Date.now()-7*86400000&&!neg.some(n=>n.chamado_id===o.id)&&!payments.some(p=>p.chamado_id===o.id)).map(o=>o.id));
    const cards=[['todos','Todos os pedidos',orders.length],['andamento','Em andamento',orders.filter(o=>!['concluido','cancelado','expirado'].includes(o.status)).length],['concluidos','Marcados concluídos',orders.filter(o=>o.status==='concluido').length],['cancelados','Cancelados / expirados',orders.filter(o=>['cancelado','expirado'].includes(o.status)).length],['receber','13% a receber',money(t.receber)],['recebida','13% conciliados',money(t.recebida)]];
    const search=r=>JSON.stringify(r).toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'));
    const rows=orders.filter(orderInFilter).filter(o=>search(o)||neg.some(n=>n.chamado_id===o.id&&search(n))).flatMap(o=>{
     const matches=neg.filter(n=>n.chamado_id===o.id);return (matches.length?matches:[{}]).map(n=>{
      const p=payments.find(p=>p.chamado_id===o.id&&p.profissional_id===n.profissional_id);
      return ['<a href="#/admin/servicos/'+esc(o.id)+'">'+esc(o.titulo||o.categoria)+'</a><small>'+esc(o.id)+'</small>',esc(o.status)+'<small>'+esc(date(o.criado_em))+'</small>',esc(o.cliente)+'<small>Profissional: '+esc(n.profissional||'Sem negociação registrada')+'</small>',money(n.valor_aceito_centavos??n.valor_informado_centavos),money(n.valor_confirmado_centavos),n.origem==='comissao13'?money(n.comissao_centavos)+'<small>'+esc(n.cobranca_status==='paga'?(n.pagamento_conciliado?'Recebida e conciliada':'Em análise: sem conciliação'):n.cobranca_status||'Previsão')+'</small>':'Não aplicável',bankOut(p)?money(p.profissional_centavos):'Sem repasse confirmado',esc(bankIn(p)?'Pago':p?.erro||p?.status==='em_analise'?'Em análise':p?'Aguardando':'Não emitido'),esc(bankOut(p)?'Recebido':p?.erro?'Falhou / em análise':p?.status==='pago'?'Aguardando repasse':p?'Aguardando':'Não iniciado')];
     });
    });
    rows.forEach(celulas=>{
      const match=String(celulas[0]||'').match(/<small>([a-f0-9-]{36})<\/small>/i);
      const id=match&&match[1];
      celulas.push(id?'<a href="#/admin/servicos/'+esc(id)+'">Ver / corrigir</a>'+(elegiveis.has(id)?'<button type="button" class="btn btn--outline btn--sm" data-qff-delete="'+esc(id)+'" style="display:block;margin-top:8px">Excluir antigo</button>':''):'—');
    });
    const filteredKeys=keys.filter(k=>keyFilter==='todos'||keyFilter==='pendente'&&k.status==='pendente'||keyFilter==='validados'&&k.status==='validado'||keyFilter==='ausentes'&&!k.chave_pix).filter(search);
    root.innerHTML='<div class="qff-head"><h2>Financeiro e Pix</h2><button class="btn btn--outline" data-qff-refresh>Atualizar</button></div><p role="status" data-qff-status>Dados de '+esc(date(data.gerado_em))+'</p><section class="qff-alert"><strong>Pagamento pós-serviço em homologação</strong><p>'+esc(data.pagamento_pos_servico?.observacao)+'</p><small>Valor combinado, comissão prevista e divisão de 87% não comprovam dinheiro recebido. O Avulso mantém suas regras.</small></section><div class="qff-cards">'+cards.map(([key,label,value])=>'<button class="qff-card" data-qff-filter="'+key+'" aria-pressed="'+(filter===key)+'">'+esc(label)+'<strong>'+esc(value)+'</strong></button>').join('')+'</div><section><h3>Conclusões registradas × serviços confirmados</h3><p><b>'+orders.filter(o=>o.status==='concluido').length+' marcados como concluídos</b> no cadastro. <b>'+comprovados.size+' com conclusão comprovada</b> pelo cliente na negociação do Plano Livre. Status do pedido sozinho não confirma serviço feito nem comissão a receber.</p></section><section><h3>Dinheiro confirmado pelo banco · pós-serviço</h3><p>Entrada: '+money(t.entrada)+' · 87% repassados: '+money(t.repasse)+'</p></section><section><h3>Pendências</h3><p>'+keys.filter(k=>k.status==='pendente').length+' chaves aguardam validação · '+keys.filter(k=>!k.chave_pix).length+' profissionais sem chave · '+payments.filter(p=>p.erro||p.status==='em_analise').length+' pagamentos com falha ou análise.</p><a href="#/admin/negociacoes">Abrir negociações, conversas e comissões</a></section><div class="qff-controls"><label>Buscar nome, cidade, pedido ou profissão<input class="input" type="search" data-qff-search value="'+esc(query)+'"></label><label>Cadastro Pix<select class="input" data-qff-keys>'+[['todos','Todos'],['ausentes','Sem chave'],['pendente','Pendentes de validação'],['validados','Validados']].map(([k,v])=>'<option value="'+k+'"'+(keyFilter===k?' selected':'')+'>'+v+'</option>').join('')+'</select></label></div><section><h3>Histórico financeiro e operacional</h3>'+table(['Pedido','Situação','Participantes','Valor combinado','Valor confirmado','Comissão 13%','87% repassados','Pix cliente','Pix profissional','Ações'],rows)+(rows.length?'':'<p>Nenhum pedido neste filtro.</p>')+'</section><section><h3>Limpeza de pedidos antigos</h3><p>Somente pedidos expirados há mais de 7 dias, sem negociação ou Pix registrado, exibem Excluir antigo. Pedidos com desbloqueios ou histórico financeiro exigem revisão no detalhe; nenhuma exclusão é automática.</p><p><a href="#/admin/servicos">Abrir todos os pedidos para revisar ou corrigir situação</a></p></section><details><summary>Profissionais e chaves Pix ('+filteredKeys.length+')</summary><div class="qff-prof-list">'+(filteredKeys.length?filteredKeys.map(profissionalCard).join(''):'<p>Nenhum profissional neste filtro.</p>')+'</div></details><details><summary>Origem dos últimos 10 pedidos</summary>'+table(['Data','Serviço / cidade','Origem','Campanha'],orders.slice(0,10).map(o=>[esc(date(o.criado_em)),esc(o.categoria)+' / '+esc(o.cidade),esc(o.origem||'Não identificada'),esc(o.campanha||'—')]))+'</details><details><summary>Últimos 10 leads de pedido publicado</summary>'+table(['Data','Pedido','Origem','Campanha'],(data.leads||[]).map(l=>[esc(date(l.created_at)),esc(l.request_id),esc(l.source||'Não identificada'),esc(l.campaign||'—')]))+'</details>';

    // Repasses realizados pelo administrador — somente marcação e trilha de auditoria.
    const pendentes=repasses.filter(x=>x.situacao==='solicitado'||x.situacao==='em_analise');
    const transferidos=repasses.filter(x=>x.situacao==='pago');
    const totalPendente=pendentes.reduce((n,x)=>n+Number(x.profissional_centavos||0),0);
    const totalTransferido=transferidos.reduce((n,x)=>n+Number(x.profissional_centavos||0),0);
    const manualSection=g.document.createElement('section');
    manualSection.dataset.qffManual='';
    manualSection.className='qff-manual';
    manualSection.innerHTML='<h3>Repasses Pix manuais · Plano Livre</h3>'+
      '<p>Você transfere diretamente pelo seu banco. O sistema NÃO faz transferências automáticas. Não marque como pago antes de realizar e conferir a transferência.</p>'+
      '<div class="qff-cards"><div class="qff-card">Solicitações pendentes<strong>'+pendentes.length+'</strong></div><div class="qff-card">Total solicitado<strong>'+money(totalPendente)+'</strong></div><div class="qff-card">Repasses registrados<strong>'+money(totalTransferido)+'</strong></div></div>'+
      (!repasses.length?'<p>Não há pagamentos de serviços confirmados para repasse. As cobranças existentes da assinatura e de comissão são contabilizadas separadamente.</p>':
       repasses.map(x=>{
        const status=x.situacao||'indisponivel',key=x.chave_pix||'Não informada';
        const actionable=x.repasse_id&&status!=='pago';
        return '<article class="qff-prof-item" data-qff-repasse="'+esc(x.repasse_id||'')+'"><strong>'+esc(x.profissional||'Profissional')+' — '+esc(x.pedido||'Serviço')+'</strong>'+
         '<p>Pix cliente: '+money(x.valor_bruto_centavos)+' · Quem Faz 13%: '+money(x.comissao_centavos)+' · Profissional 87%: <strong>'+money(x.profissional_centavos)+'</strong></p>'+
         '<p>Situação: <strong>'+esc(status)+'</strong> · Chave: '+esc(key)+' ('+esc(x.chave_status||'sem validação')+')</p>'+
         (actionable?'<div class="stack--sm" data-qff-repasse-form><label>Referência bancária do Pix enviado<input class="input" name="referencia" maxlength="150" placeholder="Identificador da transferência"></label><label>Identificação do comprovante<input class="input" name="comprovante" maxlength="500" placeholder="Referência ao comprovante guardado com segurança"></label><label>Observação / motivo<input class="input" name="observacao" maxlength="1500" placeholder="Anotações para a conferência"></label><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="confirmado"> Fiz a transferência no banco e conferi os dados</label><div class="btn-row"><button type="button" class="btn btn--outline" data-qff-repasse-acao="analisar">Em análise</button><button type="button" class="btn btn--outline" data-qff-repasse-acao="bloquear">Bloquear</button><button type="button" class="btn btn--primary" data-qff-repasse-acao="confirmar">Confirmar transferência realizada</button></div><p role="status"></p></div>':'')+
         '</article>';
       }).join(''));
    root.querySelector('.qff-head')?.after(manualSection);
    manualSection.querySelectorAll('[data-qff-repasse-acao]').forEach(btn=>btn.onclick=async()=>{
      const row=btn.closest('[data-qff-repasse]'),form=row.querySelector('[data-qff-repasse-form]');
      const id=row.dataset.qffRepasse,action=btn.dataset.qffRepasseAcao;
      const status=form.querySelector('[role=status]');
      const referencia=form.querySelector('[name=referencia]').value.trim();
      const comprovante=form.querySelector('[name=comprovante]').value.trim();
      const observacao=form.querySelector('[name=observacao]').value.trim();
      if(action==='confirmar'&&(!form.querySelector('[name=confirmado]').checked||referencia.length<8||comprovante.length<8)){status.textContent='É obrigatório transferir pelo banco antes, conferir a chave e registrar referência e comprovante.';return;}
      if(action==='bloquear'&&observacao.length<8){status.textContent='Informe o motivo do bloqueio.';return;}
      btn.disabled=true;status.textContent='Registrando alteração…';
      try{
        const r=await client.rpc('qf_repasses_manuais_admin',{p_repasse_id:id,p_acao:action,p_referencia:referencia||null,p_comprovante:comprovante||null,p_observacao:observacao||null});
        if(r.error||!r.data?.ok)throw Error(r.error?.message||r.data?.reason||'Operação não autorizada.');
        await load();
      }catch(e){status.textContent=e.message;btn.disabled=false;}
    });
    root.querySelector('[data-qff-refresh]').onclick=load;
    root.querySelectorAll('[data-qff-delete]').forEach(b=>b.onclick=async()=>{
      const id=b.dataset.qffDelete;if(!elegiveis.has(id))return;
      if(g.prompt('Exclusão permanente do pedido expirado. Para confirmar, digite EXCLUIR:')!=='EXCLUIR')return;
      b.disabled=true;
      try{
        if(!g.QFAdminCloud?.excluirChamados)throw Error('Exclusão administrativa indisponível.');
        await g.QFAdminCloud.excluirChamados([id]);
        await load();
      }catch(e){g.alert('Não foi possível excluir: '+e.message);b.disabled=false;}
    });
    root.querySelectorAll('[data-qff-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.qffFilter;render();});

    root.querySelectorAll('[data-qff-pix-key]').forEach(item=>{
      item.querySelectorAll('[data-qff-pix-aprovar]').forEach(btn=>btn.onclick=async()=>{
        const evidence=item.querySelector('[data-qff-pix-evidencia]').value.trim(),msg=item.querySelector('[role=status]');
        if(evidence.length<20){msg.textContent='Registre pelo menos 20 caracteres com a evidência da conferência no banco.';return;}
        btn.disabled=true;msg.textContent='Registrando validação...';
        try{
          const r=await client.rpc('qf_repasses_validar_chave_admin',{p_profissional_id:item.dataset.qffPixKey,p_aprovar:btn.dataset.qffPixAprovar==='true',p_evidencia:evidence});
          if(r.error||!r.data?.ok)throw Error(r.error?.message||r.data?.reason||'Falha ao validar a chave.');
          await load();
        }catch(e){msg.textContent=e.message;btn.disabled=false;}
      });
    });
    root.querySelector('[data-qff-keys]').onchange=e=>{keyFilter=e.target.value;render();};
    root.querySelector('[data-qff-search]').oninput=e=>{query=e.target.value;const pos=e.target.selectionStart;render();const next=root.querySelector('[data-qff-search]');next.focus();next.setSelectionRange(pos,pos);};
   }
   async function load(){if(busy)return;busy=true;root.setAttribute('aria-busy','true');try{
    const [a,b,c]=await Promise.all([client.rpc('qf_operacao_financeira_admin'),client.rpc('qf_admin_negociacoes'),client.rpc('qf_repasses_manuais_painel')]);
    if(a.error||b.error||c.error)throw Error('Não foi possível consultar os dados protegidos dos pagamentos ou repasses.');
    if(!a.data||!Array.isArray(b.data)||!Array.isArray(c.data))throw Error('Resposta financeira inválida.');
    if(!root.isConnected)return;data=a.data;neg=b.data;repasses=c.data;render();
   }catch(e){let status=root.querySelector('[data-qff-status]');if(!status){root.innerHTML='<p role="status" data-qff-status></p><button class="btn btn--outline" data-qff-refresh>Tentar novamente</button>';status=root.querySelector('[data-qff-status]');root.querySelector('[data-qff-refresh]').onclick=load;}status.className='qff-error';status.textContent=e.message;}finally{busy=false;root.removeAttribute('aria-busy');}}
   await load();
   const clock=g.setInterval(()=>{if(!root.isConnected){g.clearInterval(clock);return;}if(g.document.visibilityState!=='hidden')load().catch(()=>{});},30000);
  }
  g.Screens.afterRender=function(){if(prev)prev.apply(this,arguments);simplifyMenu();enhance.apply(this,arguments);};
  const c=g.document.getElementById('app-content');if(c)enhance((g.location.hash||'').replace(/^#/,''),c);
 }
 if(typeof module!=='undefined')module.exports={totals,bankIn,bankOut};
 if(g.document){if(g.document.readyState==='loading')g.document.addEventListener('DOMContentLoaded',install,{once:true});else install();}
})(typeof window!=='undefined'?window:globalThis);
