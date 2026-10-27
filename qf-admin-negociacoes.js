/* Real negotiations, with forecasts separate from bank-confirmed receipts. */
(function(g){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>(Number(v||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const date=v=>v?new Date(v).toLocaleString('pt-BR'):'Não registrado';
 const elapsed=v=>{const n=Date.parse(v);if(!Number.isFinite(n))return 'Sem data';const h=Math.max(0,Math.floor((Date.now()-n)/3600000));return h<1?'menos de 1 h':h<24?h+' h':Math.floor(h/24)+' d '+h%24+' h';};
 const active=r=>!['cancelado','expirado'].includes(r.pedido_status)&&r.ativo!==false&&!['recusado','contestado'].includes(r.status)&&!['nao_contratou','divergencia'].includes(r.cliente_resposta);
 function state(r){
  if(r.cobranca_status==='paga')return r.pagamento_conciliado?'Comissão paga e conciliada':'Marcada paga · conciliação não comprovada';
  if(r.status==='confirmado')return r.cliente_concluiu_em?'Concluído':'Comissão confirmada · conferir evidência';
  if(['cancelado','expirado'].includes(r.pedido_status))return 'Pedido '+r.pedido_status+' · conferir negociação';
  if(r.cliente_resposta==='nao_contratou')return 'Recusado pelo cliente';
  if(r.cliente_resposta==='divergencia'||r.status==='contestado')return 'Divergência';
  if(r.contratado_em||r.cliente_resposta==='confirmado')return 'Contratado · aguardando conclusão';
  if(r.status==='recusado')return 'Profissional informou não fechado';
  if(r.cliente_resposta==='negociando')return 'Cliente ainda negociando';
  return r.valor_informado_centavos!=null?'Orçamento · aguardando cliente':'Desbloqueado · sem orçamento registrado';
 }
 function totals(rows,now=Date.now()){
  const t={abertas:0,orcamentos:0,aguardando:0,aceitos:0,contratados:0,concluidos:0,previsao_orcamento:0,previsao_contratacao:0,receber:0,vencida:0,paga:0};
  rows.forEach(r=>{
   const live=active(r),accepted=!!(r.contratado_em||r.cliente_resposta==='confirmado');
   if(live&&r.status!=='confirmado')t.abertas++;
   if(r.valor_informado_centavos!=null)t.orcamentos++;
   if(live&&r.valor_informado_centavos!=null&&!r.cliente_resposta)t.aguardando++;
   if(accepted){t.aceitos++;t.contratados++;}
   if(r.cliente_concluiu_em)t.concluidos++;
   if(r.origem==='comissao13'&&live&&r.status!=='confirmado'){
    const value=accepted?r.valor_aceito_centavos??r.valor_informado_centavos:r.valor_informado_centavos;
    if(value!=null)t[accepted?'previsao_contratacao':'previsao_orcamento']+=Math.round(Number(value)*.13);
   }
   if(r.status==='confirmado'&&r.comissao_centavos!=null){
    if(r.cobranca_status==='paga'&&r.pagamento_conciliado)t.paga+=Number(r.comissao_centavos);
    if(r.cobranca_status==='pendente'){
     t.receber+=Number(r.comissao_centavos);
     if(r.comissao_vence_em&&Date.parse(r.comissao_vence_em)<=now)t.vencida+=Number(r.comissao_centavos);
    }
   }
  });return t;
 }
 function kpis(rows){const t=totals(rows);return '<div class="qfn-kpis">'+[['abertas','Negociações abertas'],['orcamentos','Orçamentos apresentados'],['aguardando','Aguardando resposta'],['aceitos','Orçamentos aceitos'],['contratados','Serviços contratados'],['concluidos','Conclusões confirmadas'],['previsao_orcamento','Prevista · orçamento'],['previsao_contratacao','Prevista · contratação'],['receber','Confirmadas a receber'],['vencida','Vencidas (incluídas a receber)'],['paga','Pagas e conciliadas']].map(([key,label])=>'<div><small>'+label+'</small><strong>'+esc(key.startsWith('previsao')||['receber','vencida','paga'].includes(key)?money(t[key]):t[key])+'</strong></div>').join('')+'</div><p class="text--sm">Previsões não são receitas. Pedidos cancelados e recusas ficam no histórico, fora das previsões ativas. Contatos externos não comprovam conversa ou contratação.</p>';}
 function row(r){const value=r.valor_confirmado_centavos??r.valor_aceito_centavos??r.valor_informado_centavos;return '<tr><td><strong>'+esc(r.profissional||r.profissional_id)+'</strong><small>'+esc(String(r.profissional_id||'').slice(0,8))+'</small></td><td>'+esc(r.cliente)+'<small>#'+esc(String(r.chamado_id||'').slice(0,8))+'</small></td><td>'+esc((r.categoria||'').replace(/^cat_/,'').replace(/_/g,' '))+'<details><summary>Descrição completa</summary>'+esc(r.descricao)+'</details></td><td>'+esc(r.cidade)+'<small>'+esc(r.bairro)+'</small></td><td>'+esc(value==null?'Não informado':money(value))+'<small>'+esc(r.origem==='comissao13'&&value!=null?'13% previstos: '+money(Math.round(Number(value)*.13)):'Avulso · sem comissão do Livre')+'</small></td><td>'+esc(state(r))+'</td><td>'+esc(r.ultima_mensagem?.remetente||'Sem mensagem interna')+'<small>'+esc(date(r.ultima_mensagem?.criado_em))+'</small></td><td>'+esc(r.cliente_respondeu_em?'Resposta registrada':Number(r.mensagens_cliente)>0?'Mensagem do cliente; sem decisão':'Aguardando')+'</td><td><button class="btn btn--outline btn--sm" data-qfn-open="'+esc(r.desbloqueio_id)+'">Abrir detalhes</button></td></tr>';}
 function graph(rows){const counts={};rows.forEach(r=>{const k=state(r);counts[k]=(counts[k]||0)+1;});const max=Math.max(1,...Object.values(counts));return '<details><summary>Desempenho das negociações</summary>'+Object.entries(counts).map(([label,n])=>'<div class="qfn-chart"><span>'+esc(label)+' · '+n+'</span><progress max="'+max+'" value="'+n+'">'+n+'</progress></div>').join('')+'</details>';}
 const billingLabel=v=>({nao_gerada:'Sem cobrança',pendente:'A receber',paga:'Paga',cancelada:'Cancelada'})[v]||'Não aplicável';
 const pedidoLabel=v=>({aberto:'Aberto',em_negociacao:'Em negociação',confirmado:'Confirmado',em_andamento:'Em andamento',concluido:'Concluído',finalizado:'Finalizado',cancelado:'Cancelado',expirado:'Expirado'})[v]||'Situação não informada';
 function financial(r){
  const value=r.valor_confirmado_centavos??r.valor_aceito_centavos??r.valor_informado_centavos;
  const commission=r.origem==='comissao13'&&value!=null?Math.round(Number(value)*.13):null;
  return '<section class="qfn-financial"><h3>Valores do serviço</h3><dl class="qfn-money-grid"><div><dt>Valor do serviço</dt><dd>'+esc(value==null?'Não informado':money(value))+'</dd></div><div><dt>Profissional · 87%</dt><dd>'+esc(commission==null?'—':money(Number(value)-commission))+'</dd></div><div class="qfn-money-commission"><dt>Quem Faz · 13%</dt><dd>'+esc(commission==null?'Não aplicável':money(commission))+'</dd></div></dl>'+(commission!=null?'<div class="qfn-split" aria-label="87% profissional e 13% Quem Faz"><span>87% profissional</span><span>13% Quem Faz</span></div>':'')+'<div class="qfn-billing"><strong>'+esc(billingLabel(r.cobranca_status))+'</strong><p>'+(r.status==='confirmado'?'Comissão confirmada.':commission!=null?'Valor potencial. Só vira cobrança após a conclusão confirmada.':'Desbloqueio avulso, sem comissão do Plano Livre.')+'</p></div><details class="qfn-fold"><summary>Prazos e confirmações</summary><dl class="qfn-facts">'+[['Contratação',date(r.contratado_em)],['Conclusão',date(r.cliente_concluiu_em)],['Comissão confirmada',date(r.confirmado_em)],['Prestação de contas',date(r.prazo_contas)],['Vencimento',date(r.comissao_vence_em)],['Pagamento',date(r.comissao_paga_em)]].map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl></details>'+(r.restricao_profissional?'<p class="qfn-note">Restrição do profissional: '+esc(({comissao_pendente:'Comissão confirmada vencida',prestacao_contas_vencida:'Prestação de contas vencida'})[r.restricao_profissional]||'Verificar pendência')+'. O cliente continua com acesso ao pedido.</p>':'')+'</section>';
 }
 function detailHtml(r,d){
  const messages=d.mensagens||[],deliveries=d.recebimentos||[],history=d.historico_pedido||[],payments=d.pagamentos||[],audits=d.auditoria||[];
  const deliveryLabel=v=>({enviado:'Envio aceito',sem_inscricao:'Sem notificações ativadas',falhou:'Falha no envio',subscription_expired:'Inscrição expirada',fora_horario:'Fora do horário',legado:'Sem confirmação de envio',processando:'Processando'})[v]||'Sem confirmação';
  const service=r.titulo||(r.categoria||'Serviço').replace(/^cat_/,'').replace(/_/g,' ');
  return '<dialog class="qfn-dialog" aria-label="Detalhes da negociação"><article class="qfn-detail"><header class="qfn-detail-head"><div><span class="qfn-eyebrow">DETALHES DA NEGOCIAÇÃO</span><h2>'+esc(service)+'</h2><p>'+esc(r.cidade)+' · '+esc(r.bairro)+'</p></div><button type="button" class="btn btn--outline" data-qfn-close aria-label="Fechar detalhes">Fechar</button></header><div class="qfn-detail-body"><div class="qfn-status">'+esc(state(r))+'</div><div class="qfn-people"><div><small>Profissional</small><strong>'+esc(r.profissional)+'</strong></div><div><small>Cliente</small><strong>'+esc(r.cliente)+'</strong></div></div><div class="qfn-detail-grid"><aside>'+financial(r)+'</aside><section class="qfn-chat"><div class="qfn-chat-head"><h3>Conversa interna</h3><span>'+messages.length+' mensagens</span></div><p class="qfn-chat-meta">Última atividade há '+esc(elapsed(r.ultima_atividade))+'</p><div class="qfn-messages">'+messages.map(m=>'<div class="qfn-message '+(m.tipo==='sistema'?'is-system':m.remetente_id===r.cliente_id?'is-client':'is-professional')+'"><strong>'+esc(m.tipo==='sistema'?'Atualização do pedido':m.remetente||'Participante')+'</strong><p>'+esc(m.mensagem)+'</p><small>'+esc(date(m.criado_em))+' · '+(m.lida_em?'Leitura registrada':'Sem leitura registrada')+'</small></div>').join('')+(!messages.length?'<p class="qfn-empty">Ainda não há mensagens internas.</p>':'')+'</div><div class="qfn-contact"><div><strong>'+esc(r.cliente_respondeu_em?'Cliente respondeu':'Aguardando resposta do cliente')+'</strong><p>'+esc(r.ultima_mensagem?.remetente?'Última mensagem de '+r.ultima_mensagem.remetente:'Sem conversa registrada')+'</p></div><div data-qfn-reminder></div></div></section></div><section class="qfn-more"><h3>Mais informações</h3><details class="qfn-fold"><summary>Descrição completa do serviço</summary><p class="qfn-description">'+esc(r.descricao)+'</p></details><details class="qfn-fold"><summary>Notificações e distribuição <span>'+deliveries.length+' registros</span></summary><p class="qfn-note">Envio aceito não comprova exibição nem leitura no aparelho.</p>'+deliveries.map(x=>'<div class="qfn-log-row"><strong>'+esc(x.profissional||'Profissional')+'</strong><span>'+esc(deliveryLabel(x.envio_status))+'</span><small>'+esc(date(x.enviado_em||x.criado_em))+'</small></div>').join('')+(!deliveries.length?'<p>Nenhum registro disponível.</p>':'')+'</details><details class="qfn-fold"><summary>Histórico do pedido <span>'+history.length+' alterações</span></summary>'+history.map(x=>'<div class="qfn-log-row"><strong>'+esc(pedidoLabel(x.de))+' → '+esc(pedidoLabel(x.para))+'</strong><small>'+esc(date(x.criado_em))+'</small></div>').join('')+'</details><details class="qfn-fold"><summary>Pagamentos e comprovantes <span>'+payments.length+' registros</span></summary>'+(payments.length?payments.map(p=>'<div class="qfn-log-row"><strong>'+money(p.valor_centavos)+' · '+esc(p.pago_em?'Pagamento identificado':'Aguardando pagamento')+'</strong><small>'+esc(date(p.pago_em||p.emitido_em))+'</small><p>Referência: '+esc(p.end_to_end_id||p.txid||'Ainda não emitida')+'</p></div>').join(''):'<p>Nenhuma cobrança ou pagamento registrado.</p>')+'</details><details class="qfn-fold"><summary>Histórico de auditoria <span>'+audits.length+' registros</span></summary>'+audits.map(a=>'<div class="qfn-log-row"><strong>'+esc(a.antes?'Registro atualizado':'Registro criado')+'</strong><span>'+esc(a.depois?.cliente_resposta==='confirmado'?'Cliente confirmou contratação':pedidoLabel(a.depois?.status))+'</span><small>'+esc(date(a.criado_em))+'</small></div>').join('')+'</details><details class="qfn-fold"><summary>Identificação do registro</summary><dl class="qfn-facts"><div><dt>Pedido</dt><dd>'+esc(r.chamado_id)+'</dd></div><div><dt>Profissional</dt><dd>'+esc(r.profissional_id)+'</dd></div></dl></details></section></div><footer class="qfn-detail-footer"><a class="btn btn--primary" href="#/admin/servicos/'+esc(r.chamado_id)+'">Abrir pedido</a>'+(r.fechamento_id?'<a class="btn btn--outline" href="#/admin/comissao13">Ver comissão</a>':'')+'</footer></article></dialog>';
 }
 function install(){if(!g.Screens||g.Screens._qfn)return;g.Screens._qfn=true;
  const style=g.document.createElement('style');style.textContent='.qfn{display:grid;gap:16px;min-width:0;overflow-wrap:anywhere}.qfn-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px}.qfn-kpis>div{background:white;border:1px solid #dbe4ee;border-radius:16px;padding:16px}.qfn-kpis strong{display:block;font-size:23px;color:#1356a3}.qfn small{display:block;color:#596a7e}.qfn-table{overflow-x:auto}.qfn table{width:100%;border-collapse:collapse;font-size:13px}.qfn td,.qfn th{padding:12px;text-align:left;vertical-align:top;border-bottom:1px solid #e2e8f0;min-width:130px}.qfn td small{max-width:210px;overflow-wrap:anywhere}.qfn-alert{padding:14px;border:1px solid #f5b25e;border-radius:14px;background:#fff8ef;margin-bottom:10px}.qfn-detail{border:1px solid #bfd3ed;border-radius:16px;background:#fff;padding:18px}.qfn-message{white-space:pre-wrap;border-bottom:1px solid #e0e8f0;padding:12px 0}.qfn-split{display:flex;border-radius:10px;overflow:hidden;color:#fff;font-size:12px;font-weight:700}.qfn-split span:first-child{width:87%;background:#1458cc;padding:12px}.qfn-split span:last-child{width:13%;min-width:80px;background:#db7700;padding:12px}.qfn-chart{display:grid;gap:6px;margin:10px 0}.qfn progress{width:100%;accent-color:#1458cc}.qfn .btn{width:auto;white-space:normal;height:auto;min-height:42px}.qf-adm-side{background:#0b2744!important;color:white}.qf-adm-side .qf-adm-nav__item{color:#e5edf7}.qf-adm-side .qf-adm-nav__item:hover{background:#193e62}.qf-adm-side .qf-adm-nav__secao{color:#a8c2df}@media(max-width:500px){.qfn-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.qfn-kpis>div{padding:12px}.qfn-kpis strong{font-size:19px}.qfn-detail{padding:12px}}';style.textContent+=`.qfn{font-family:inherit;color:#17324d;line-height:1.5}
.qfn h2,.qfn h3,.qfn p{margin:0}
.qfn h2{font-size:22px;line-height:1.3}
.qfn h3{font-size:16px;line-height:1.4}
.qfn label{display:grid;gap:8px}
.qfn-alert{display:grid;gap:8px;padding:18px}
.qfn-dialog{border:0;border-radius:22px;padding:0;width:min(1000px,calc(100vw - 40px));max-width:none;max-height:90vh;max-height:90dvh;overflow:hidden;box-shadow:0 24px 80px #071b3652;color:#17324d}
.qfn-dialog::backdrop{background:rgba(8,27,50,.54)}
.qfn-dialog .qfn-detail{padding:0;border:0;border-radius:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;max-height:90vh;max-height:90dvh;min-width:0;line-height:1.5}
.qfn-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:22px 26px;border-bottom:1px solid #e4ebf3;background:white}
.qfn-detail-head h2{font-size:23px;margin:4px 0;text-transform:capitalize}
.qfn-detail-head p{font-size:13px;color:#61758b}
.qfn-eyebrow{font-size:10px;font-weight:800;letter-spacing:.1em;color:#61758b}
.qfn-detail-body{padding:22px 26px;overflow-y:auto;overscroll-behavior:contain;display:grid;gap:20px}
.qfn-status{justify-self:start;padding:7px 12px;border-radius:9px;background:#fff2df;color:#8b4b00;font-size:13px;font-weight:700}
.qfn-people{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.qfn-people>div{padding:14px 16px;background:#f4f7fb;border-radius:12px;display:grid;gap:3px}
.qfn-people small{font-size:12px}
.qfn-people strong{font-size:15px}
.qfn-detail-grid{display:grid;grid-template-columns:300px minmax(0,1fr);gap:20px;align-items:start}
.qfn-financial{padding:18px;border:1px solid #e1e9f2;border-radius:16px;display:grid;gap:16px}
.qfn-money-grid{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:14px}
.qfn-money-grid>div:first-child{grid-column:1/-1;border-bottom:1px solid #e4ebf3;padding-bottom:14px}
.qfn-money-grid dt{font-size:11px;color:#61758b}
.qfn-money-grid dd{margin:3px 0 0;font-size:19px;font-weight:800;color:#1458cc}
.qfn-money-grid>div:first-child dd{font-size:28px;color:#17324d}
.qfn-money-commission dd{color:#bd5900}
.qfn-dialog .qfn-split{font-size:10px}
.qfn-dialog .qfn-split span{padding:9px 6px;text-align:center;white-space:nowrap}
.qfn-billing{display:grid;gap:4px;padding:12px;background:#f3f7fc;border-radius:10px;font-size:13px}
.qfn-billing p{color:#61758b;font-size:12px}
.qfn-chat{min-width:0;border:1px solid #e1e9f2;border-radius:16px;overflow:hidden}
.qfn-chat-head{padding:16px 18px 0;display:flex;align-items:center;justify-content:space-between;gap:8px}
.qfn-chat-head span{font-size:12px;color:#61758b}
.qfn-chat-meta{padding:4px 18px 14px;font-size:12px;color:#61758b}
.qfn-messages{padding:16px;max-height:300px;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:12px;background:#f4f7fb}
.qfn-dialog .qfn-message{border:1px solid #dce5f0;padding:12px 14px;border-radius:12px;background:white;max-width:94%;font-size:13px;white-space:normal;display:grid;gap:6px}
.qfn-message p{white-space:pre-wrap;overflow-wrap:anywhere}
.qfn-message strong{font-size:12px;color:#1458cc}
.qfn-message small{font-size:10px}
.qfn-dialog .qfn-message.is-client{align-self:flex-end;background:#eaf2ff;border-color:#cedff6}
.qfn-dialog .qfn-message.is-system{max-width:none;background:#edf1f6;border:0;font-size:12px}
.qfn-message.is-system strong{color:#61758b}
.qfn-contact{padding:16px 18px;display:grid;gap:12px;border-top:1px solid #e1e9f2;font-size:13px}
.qfn-contact p{font-size:12px;color:#61758b}
.qfn-contact [data-qfn-reminder]{display:grid;gap:6px;justify-items:start}
.qfn-more{border-top:1px solid #e4ebf3;padding-top:16px;display:grid;gap:0}
.qfn-more>h3{margin:0 0 10px}
.qfn-fold{border-bottom:1px solid #e4ebf3;padding:0;font-size:13px;min-width:0}
.qfn-fold summary{cursor:pointer;padding:14px 2px;font-weight:650;color:#35506b}
.qfn-fold summary span{font-size:11px;font-weight:400;color:#728398;margin-left:8px}
.qfn-fold[open]>:not(summary){margin-bottom:12px}
.qfn-description{white-space:pre-wrap;padding:0 2px 8px}
.qfn-note,.qfn-empty{color:#61758b;font-size:12px;line-height:1.5}
.qfn-facts{margin:0;display:grid;gap:10px}
.qfn-facts>div{display:grid;gap:2px}
.qfn-facts dt{font-size:11px;color:#61758b}
.qfn-facts dd{margin:0;font-size:12px;overflow-wrap:anywhere}
.qfn-log-row{padding:10px 12px;background:#f4f7fb;border-radius:9px;display:grid;gap:4px;font-size:12px}
.qfn-log-row small{font-size:11px}
.qfn-detail-footer{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;padding:16px 26px;border-top:1px solid #e4ebf3;background:white}
@media(max-width:700px){.qfn-dialog{width:calc(100vw - 20px);border-radius:16px;max-height:94vh;max-height:94dvh}.qfn-dialog .qfn-detail{max-height:94vh;max-height:94dvh}.qfn-detail-head{padding:16px;gap:10px}.qfn-detail-head h2{font-size:20px}.qfn-detail-body{padding:16px;gap:16px}.qfn-detail-grid{grid-template-columns:minmax(0,1fr)}.qfn-people{gap:8px}.qfn-people>div{padding:12px}.qfn-people strong{font-size:13px}.qfn-detail-footer{padding:12px 16px}.qfn-messages{max-height:260px}.qfn-money-grid{grid-template-columns:1fr 1fr}.qfn-money-grid>div:first-child{grid-column:1/-1;border-bottom:1px solid #e4ebf3;padding-bottom:12px}.qfn-money-grid>div:first-child dd{font-size:28px}.qfn-money-grid dd{font-size:19px;white-space:nowrap}}
`;g.document.head.appendChild(style);
  const prev=g.Screens.afterRender;
  async function enhance(pattern,content){
   if(!['/admin/dashboard','/admin/negociacoes'].includes(pattern)||content.querySelector('[data-qfn]'))return;
   const client=g.QFAdminCloud?.client;if(!client)return;
   const root=g.document.createElement('section');root.className='section qfn';root.dataset.qfn='';(content.querySelector('.view')||content).prepend(root);
   let rows=[],page=0,query='',busy=false,detailId=null;
   async function rpc(name,args={}){const r=await client.rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;}
   const error=e=>{let box=root.querySelector('[data-qfn-status]');if(!box){box=g.document.createElement('p');box.dataset.qfnStatus='';box.setAttribute('role','status');root.prepend(box);}box.textContent='Não foi possível atualizar: '+e.message;};
   async function open(id){
    const r=rows.find(x=>x.desbloqueio_id===id);if(!r)return;
    const panel=root.querySelector('[data-qfn-detail]');panel.innerHTML='<p role="status">Carregando detalhe protegido…</p>';detailId=id;
    try{const d=await rpc('qf_admin_negociacao_detalhe',{p_desbloqueio:id});if(!d?.ok)throw Error('Detalhe indisponível');if(detailId!==id||!root.isConnected)return;
     const returnFocus=g.document.activeElement;
     panel.innerHTML=detailHtml(r,d);
     const dialog=panel.querySelector('dialog');
     const clean=()=>{panel.innerHTML='';detailId=null;returnFocus?.focus?.();};
     const close=()=>{if(typeof dialog.close==='function')dialog.close();else clean();};
     dialog.addEventListener('close',clean,{once:true});
     dialog.addEventListener('click',e=>{if(e.target===dialog)close();});
     panel.querySelector('[data-qfn-close]').onclick=close;
     if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
     panel.querySelector('[data-qfn-close]').focus();
     const target=panel.querySelector('[data-qfn-reminder]');let phone=String(d.telefone_suporte||'').replace(/\D/g,'');if(phone.length===10||phone.length===11)phone='55'+phone;
     if(d.contato_autorizado&&/^55\d{10,11}$/.test(phone)){
      const message='Olá! Aqui é do Quem Faz Serviços. Vimos que um profissional apresentou um orçamento para seu pedido. Você chegou a contratar o serviço ou ainda está avaliando? Acesse seu pedido no Quem Faz para atualizar a negociação. https://quemfazservico.com.br/?app=1';
      const a=g.document.createElement('a');a.className='btn btn--primary';a.textContent='Lembrar cliente';a.href='https://wa.me/'+phone+'?text='+encodeURIComponent(message);a.target='_blank';a.rel='noopener noreferrer';target.appendChild(a);
      target.insertAdjacentHTML('beforeend','<p class="text--sm">Abre o WhatsApp administrativo. Abrir não comprova envio, entrega ou resposta.</p>');
     }else target.textContent='Lembrete indisponível: falta telefone válido ou autorização de contato registrada.';

    }catch(e){panel.textContent='Não foi possível abrir: '+e.message;}
   }
   function render(){
    const dashboard=pattern==='/admin/dashboard';const attention=rows.filter(r=>r.valor_informado_centavos!=null&&r.status!=='confirmado'&&(!r.cliente_respondeu_em||r.ultima_mensagem?.remetente_id!==r.cliente_id||r.contratado_em&&Date.now()-Date.parse(r.ultima_atividade)>86400000));
    const filtered=rows.filter(r=>[r.profissional,r.cliente,r.chamado_id,r.categoria,state(r)].join(' ').toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));page=Math.min(page,Math.max(0,Math.ceil(filtered.length/12)-1));
    root.innerHTML='<h2>Negociações aguardando confirmação</h2>'+attention.slice(0,dashboard?5:8).map(r=>'<div class="qfn-alert"><strong>'+esc(r.profissional)+' · '+esc(r.categoria?.replace(/^cat_/,''))+'</strong><p>Cliente: '+esc(r.cliente)+' · Orçamento '+money(r.valor_informado_centavos)+' · Comissão potencial '+money(Math.round(Number(r.valor_informado_centavos)*.13))+' · Última atividade há '+esc(elapsed(r.ultima_atividade||r.proposta_chat_em||r.desbloqueado_em))+'</p><p>'+esc(state(r))+'</p><button class="btn btn--outline" data-qfn-open="'+esc(r.desbloqueio_id)+'">Abrir negociação</button></div>').join('')+(!attention.length?'<p>Nenhum orçamento aguardando primeira resposta.</p>':'')+'<h2>Orçamentos e negociações</h2>'+kpis(rows)+'<button class="btn btn--outline" data-qfn-refresh>Atualizar dados</button><p role="status" data-qfn-status>Atualização automática a cada 15 segundos enquanto esta tela está aberta.</p><div data-qfn-detail></div>'+(dashboard?'<a class="btn btn--primary" href="#/admin/negociacoes">Ver todas as negociações</a>':graph(rows)+'<label>Buscar profissional, cliente, pedido ou situação<input class="input" data-qfn-search value="'+esc(query)+'"></label><div class="qfn-table"><table><thead><tr>'+['Profissional','Cliente e pedido','Serviço','Localização','Valores','Situação','Última mensagem','Resposta do cliente','Ação'].map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+filtered.slice(page*12,page*12+12).map(row).join('')+'</tbody></table></div><p>'+filtered.length+' negociações · página '+(page+1)+'</p><div class="btn-row"><button class="btn btn--outline" data-qfn-page="-1" '+(!page?'disabled':'')+'>Anterior</button><button class="btn btn--outline" data-qfn-page="1" '+((page+1)*12>=filtered.length?'disabled':'')+'>Próxima</button></div>');
    root.querySelectorAll('[data-qfn-open]').forEach(b=>b.onclick=()=>open(b.dataset.qfnOpen));
    root.querySelector('[data-qfn-refresh]').onclick=()=>load(true);
    root.querySelectorAll('[data-qfn-page]').forEach(b=>b.onclick=()=>{page+=Number(b.dataset.qfnPage);render();});
    const search=root.querySelector('[data-qfn-search]');if(search)search.onchange=()=>{query=search.value;page=0;render();};
   }
   async function load(force=false){if(busy||!root.isConnected||(!force&&(detailId||root.contains(g.document.activeElement))))return;busy=true;try{rows=await rpc('qf_admin_negociacoes');if(!Array.isArray(rows))throw Error('Resposta inválida');if(root.isConnected){detailId=null;render();}}catch(e){error(e);}finally{busy=false;}}
   await load(true);const timer=g.setInterval(()=>{if(!root.isConnected){g.clearInterval(timer);return;}if(!g.document.hidden)load();},15000);
  }
  g.Screens.afterRender=function(){if(prev)prev.apply(this,arguments);enhance.apply(this,arguments);};
  const content=g.document.getElementById('app-content');if(content)enhance((g.location.hash||'').replace(/^#/,''),content);
 }
 g.QFAdminNegociacoes={totals,state,kpis,row,detailHtml};
 if(typeof module!=='undefined')module.exports=g.QFAdminNegociacoes;
 if(g.document){if(g.document.readyState==='loading')g.document.addEventListener('DOMContentLoaded',install,{once:true});else install();}
})(typeof window!=='undefined'?window:globalThis);
