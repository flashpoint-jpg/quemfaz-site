/* Plano Livre: Pix integral no Quem Faz com repasse manual; cobrança anterior de comissão preservada para atendimentos legados. */
(function(g){
 'use strict';
 const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const brl=n=>(Number(n||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const motivo=r=>({perfil_inativo:'Confira a situação do seu perfil e do plano para desbloquear pedidos.',prestacao_contas_vencida:'Você tem um pedido pendente. Informe o andamento para desbloquear novamente.',comissao_vencida:'Há comissão confirmada e vencida. Consulte a carteira.',comissao_pendente:'Você tem uma comissão de 13% pendente. Se recebeu diretamente do cliente, a liberação de novos pedidos depende da quitação do Pix. Confira a carteira.',codigo_invalido:'Código do cliente incorreto.',limite_codigo:'Limite de tentativas. Aguarde uma hora.',codigo_nao_emitido_contate_suporte:'Este pedido não tem código emitido. Procure a equipe Quem Faz para verificação manual.',nao_elegivel:'Pedido fora das suas regras de profissão, raio ou disponibilidade.',reservado:'O pedido já atingiu o limite de participantes.',modalidade_desativada:'Modalidade temporariamente indisponível.',selfie_obrigatoria:'Conclua seu perfil com uma foto.',valor_e_evidencia_obrigatorios:'Informe o valor confirmado e a evidência do contato com o cliente.',observacao_obrigatoria:'Descreva a verificação realizada.',comprovante_obrigatorio:'Informe o comprovante do pagamento da comissão.',limite_prorrogacao:'O prazo de negociação já foi prorrogado uma vez. Informe se fechou ou não.'}[r]||'Não foi possível autorizar a ação. Atualize a página e confira a situação.');
 // Compatibilidade com telas antigas: encaminha para a única assinatura disponível.
 function oferta(){return g.QFLivre?g.QFLivre.oferta({}):'<h2 class="h3">Quem Faz Livre</h2><p>R$ 39,90 por 30 dias. Desbloqueios ilimitados de pedidos compatíveis e comissão de 13% sobre serviços fechados, após confirmação do cliente.</p><a class="btn btn--primary" href="#/profissional/planos">Conhecer o plano</a>';}
 function anuncio(){return oferta();}
 function decorateCards(){}

 const dataCurta=v=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Não informado';
 function valorCentavos(v){
  let raw=String(v??'').trim();
  if(raw.includes(',')){if(!/^\d+(?:\.\d{3})*(?:,\d{1,2})?$/.test(raw))return null;raw=raw.replace(/\./g,'').replace(',','.');}
  else if(/^\d{1,3}(?:\.\d{3})+$/.test(raw))raw=raw.replace(/\./g,'');
  else if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return null;
  const n=Math.round(Number(raw)*100);return Number.isSafeInteger(n)&&n>=100&&n<=100000000?n:null;
 }
 function resumoValor(n){
  if(n==null)return '<p style="margin:0">Informe o valor para ver a comissão e quanto fica com você.</p>';
  const taxa=Math.round(n*13/100);
  return '<dl style="display:grid;gap:6px;margin:0"><div>Serviço: <strong>'+brl(n)+'</strong></div><div>Comissão de 13%: <strong>'+brl(taxa)+'</strong></div><div style="color:#1458cc">Você fica com: <strong>'+brl(n-taxa)+'</strong></div></dl><p class="text--sm" style="margin:8px 0 0">A comissão só é gerada após o cliente confirmar contratação, conclusão e valor com o código do pedido. Prazo de pagamento: 48 horas.</p>';
 }
 function bindResumo(form){
  const input=form?.querySelector('[name=valor],[data-qfc-valor]');if(!input||form.querySelector('[data-qf13-resumo]'))return;
  const el=form.ownerDocument.createElement('div');el.dataset.qf13Resumo='';el.setAttribute('aria-live','polite');el.style.cssText='padding:12px;border:1px solid #cfe0f5;border-radius:12px;background:#f1f6ff;line-height:1.5';
  form.querySelector('button[type=submit],button')?.before(el);
  const update=()=>{el.innerHTML=resumoValor(valorCentavos(input.value));};input.addEventListener('input',update);update();
 }
 function tempoDecorrido(value,now=Date.now()){
  const t=value?new Date(value).getTime():NaN;if(!Number.isFinite(t)||t>now)return '';
  const m=Math.floor((now-t)/60000),h=Math.floor(m/60),d=Math.floor(h/24);
  return d?d+' dia'+(d===1?'':'s')+(h%24?' e '+h%24+'h':''):h?h+'h'+(m%60?' '+m%60+'min':''):m?m+' min':'menos de 1 min';
 }
 function pendenciaHtml(a){
  const e=etapa(a),since=e==='vencida'?a.comissao_vence_em:e==='corrigir'?a.cliente_respondeu_em:e==='cliente'?a.proposta_chat_em||a.prestado_em||a.informado_em:a.informado_em;
  const label={concluir:'Aguardando conclusão do cliente',vencida:'Vencida',corrigir:'Correção solicitada',cliente:'Aguardando cliente',aguardar:'Aguardando resultado',validar:'Aguardando conferência',revisar:'Em análise',aprovar:'Aguardando análise'}[e];
  const time=tempoDecorrido(since);return label&&time?'<p data-qf13-age="'+esc(since)+'" data-qf13-age-label="'+esc(label)+'" style="margin:0;color:#b55b00;font-weight:700">'+esc(label)+' há '+esc(time)+' · Desde '+esc(dataCurta(since))+'</p>':'';
 }
 function etapa(a){if(a.pagamento_plataforma&&a.status==='confirmado')return a.cobranca_status==='paga'?'historico':'cliente';if(a.cliente_resposta==='divergencia'&&['informado','negociando'].includes(a.status)&&a.cobranca_status==='nao_gerada')return 'corrigir';if(a.cliente_resposta==='divergencia'||a.status==='contestado'||(a.cliente_resposta==='nao_contratou'&&['informado','confirmado'].includes(a.status))||(a.cliente_resposta==='confirmado'&&a.status==='recusado'))return 'revisar';if(a.status==='confirmado'&&a.cobranca_status==='pendente'&&a.comissao_vence_em&&new Date(a.comissao_vence_em).getTime()<=Date.now())return 'vencida';if(a.status==='confirmado')return a.cobranca_status==='paga'?'historico':'cobrar';if(a.cliente_resposta==='confirmado')return 'concluir';if(a.status==='recusado'&&a.cliente_resposta!=='nao_contratou')return 'validar';if(['recusado','nao_contratado','cancelado'].includes(a.status))return 'historico';return (a.status==='informado'||(a.status==='negociando'&&a.proposta_chat_em))?'cliente':'aguardar';}
 function suporteProfHtml(pedidoId,chatAtivo=true){
  const mensagem='Olá, suporte Quem Faz! Sou profissional do Plano Livre. Desbloqueei o pedido #'+String(pedidoId)+' e preciso de ajuda.';
  const suporte='https://wa.me/5535998845703?text='+encodeURIComponent(mensagem);
  // Somente dados do cliente já recebidos pelo perfil autenticado após desbloquear.
  const pedido=g.DB?.requestById?.(pedidoId);
  const cliente=pedido?.profissionalId&&pedido?.clienteId?g.DB?.clienteById?.(pedido.clienteId):null;
  const digits=String(cliente?.telefone||'').replace(/\D/g,'');
  const number=/^55\d{10,11}$/.test(digits)?digits:/^\d{10,11}$/.test(digits)?'55'+digits:'';
  // Abertura oficial: o modelo é definido pelo Quem Faz, nunca por texto digitado pelo profissional.
   // WhatsApp permite edição antes do envio: o aviso vinculante é mostrado no chat do aplicativo.
   const msg='Olá, '+String(cliente?.nome||'cliente').split(' ')[0]+'! Sou profissional do Quem Faz e recebi seu pedido #'+String(pedidoId)+'.\n\n'+
     'AVISO QUEM FAZ LIVRE: O orçamento, aceite, agendamento, confirmação de conclusão e pagamento devem ser registrados pelo aplicativo Quem Faz. O cliente também confirma se contratou ou não.\n\n'+
     'O Pix do serviço só pode ser o Pix oficial gerado no aplicativo depois da conclusão. Não pague por chaves Pix enviadas por WhatsApp. Omissão, informações falsas ou fraude podem gerar suspensão ou bloqueio após análise e possibilidade de contestação.\n\n'+
     'Podemos conversar por aqui, mas o fechamento será formalizado pelo aplicativo.';
  const waUrl=number?'https://wa.me/'+number+'?text='+encodeURIComponent(msg):'';
  const links='<div class="qf13-contact-actions" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px">'+
   '<a class="btn btn--primary" style="min-width:0;white-space:normal;line-height:1.3;text-align:center;padding:12px 5px" data-nav="/profissional/chat/'+esc(pedidoId)+'" href="#/profissional/chat/'+esc(pedidoId)+'">Chat no app</a>'+
   (waUrl?'<a class="btn" data-contact="whatsapp" style="min-width:0;white-space:normal;line-height:1.3;text-align:center;padding:12px 5px;background:#119458;color:#fff" href="'+esc(waUrl)+'" target="_blank" rel="noopener noreferrer">WhatsApp do cliente · mensagem pronta</a>':
   '<span class="btn btn--outline" aria-disabled="true" style="display:flex;align-items:center;justify-content:center;min-width:0;white-space:normal;text-align:center;opacity:.75">WhatsApp indisponível</span>')+'</div>';
  const chat=chatAtivo?'<div class="qf13-client-chat" style="display:grid;gap:10px;padding:15px;border:2px solid #1769d5;border-radius:14px;background:#eef6ff;margin-top:10px">'+
   '<strong style="color:#103d7c;font-size:1.05rem">Falar com o cliente</strong><p class="text--sm" style="margin:0;color:#36516f">Após desbloquear, use o chat para registrar a proposta, o aceite e eventual agendamento. Informe o andamento em até 48 horas; um agendamento válido não é serviço concluído. O WhatsApp é apenas apoio à conversa.</p>'+links+
   '<p class="text--sm" style="margin:0;color:#36516f"><strong>Regra obrigatória — Plano Livre:</strong> apresente o orçamento e registre o aceite, a data e o resultado no aplicativo. Não cobre o cliente por fora. Após a conclusão confirmada, o cliente paga 100% por Pix oficial do Quem Faz. Os 13% pertencem à plataforma e o repasse manual de 87% depende de pagamento bancário confirmado. Informações falsas ou omissão de fechamento podem causar suspensão após análise.</p></div>':'';
  return chat+'<details class="qf13-support" style="padding:12px;border:1px solid #cad9ec;border-radius:12px;background:#f8fbff;margin-top:10px"><summary style="font-weight:700;cursor:pointer">Precisou de ajuda? Falar com suporte</summary><p class="text--sm" style="margin:8px 0">O suporte é da equipe Quem Faz, não é o contato do cliente.</p><a class="btn btn--outline btn--sm" href="'+esc(suporte)+'" target="_blank" rel="noopener noreferrer">Abrir suporte no WhatsApp</a></details>';
 }
  function contatoAdminHtml(a) {
  // O RPC devolve telefone/WhatsApp SOMENTE a contas administrativas autenticadas.
  // Nunca incluir este bloco nas telas do profissional.
  const numero=String(a.whatsapp||a.telefone||'').replace(/\D/g,'');
  const destino=/^55\d{10,11}$/.test(numero)?numero:/^\d{10,11}$/.test(numero)?'55'+numero:'';
  const exibicao=String(a.whatsapp||a.telefone||'').trim();
  if(!destino)return '<div class="qf13-contact"><strong>Contato para conferência (somente administrador)</strong><p class="text--sm">WhatsApp do cliente indisponível. Confira o pedido.</p></div>';
  const mensagem='Olá! Sou da equipe Quem Faz. Estou conferindo o atendimento do pedido de '+String(a.titulo||'serviço')+'. Você chegou a contratar '+String(a.profissional||'o profissional')+'? Se sim, qual valor foi combinado? Obrigado.';
  const url='https://wa.me/'+destino+'?text='+encodeURIComponent(mensagem);
  return '<div class="qf13-contact"><strong>WhatsApp do cliente · somente administrador</strong><div class="qf13-contact__row"><span>'+esc(exibicao)+'</span><a class="btn btn--primary btn--sm" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Conferir pelo WhatsApp</a></div><p class="text--sm">Esse número não é liberado ao profissional do Plano Livre. Depois da conversa, registre o resultado abaixo.</p></div>';
 }
 function adminPainel(rows){return rows.map(a=>{
  const e=etapa(a),labels={concluir:'Aguardando conclusão do cliente',corrigir:'Correção de valor',vencida:'Comissão vencida',aguardar:'Aguardando respostas',cliente:'Aguardando cliente',aprovar:'Conferir contratação antiga',revisar:'Divergência para analisar',validar:'Não fechei · cliente não confirmou',cobrar:'Comissão aprovada',historico:a.status==='confirmado'?'Comissão paga':'Não contratado'};
  const plano=g.QFAdminValor?g.QFAdminValor.planoHtml(a.profissional_id):'<span class="badge badge--muted">Plano não consultado</span>';
  const confirmado=a.status==='confirmado',pago=confirmado&&a.cobranca_status==='paga';
  return '<article class="card qf13-admin-row" data-qf13-row="'+esc(a.id)+'"><div class="qf13-card-top"><strong>'+esc(a.profissional)+'</strong><span class="badge badge--'+(['revisar','validar','corrigir','vencida'].includes(e)?'orange':'navy')+'">'+labels[e]+'</span></div>'+pendenciaHtml(a)+'<div class="qf-adm-plan-tag">'+plano+'</div><p class="text--sm">'+esc(a.titulo||'Pedido de serviço')+' · #'+esc(String(a.chamado_id).slice(0,8))+'</p><dl class="qf13-facts"><div><dt>Cliente</dt><dd>'+esc(a.cliente)+'</dd></div><div><dt>Valor do serviço</dt><dd>'+esc(a.valor_confirmado_centavos!=null?brl(a.valor_confirmado_centavos):a.valor_informado_centavos!=null?brl(a.valor_informado_centavos):'Ainda não informado')+'</dd></div><div><dt>Comissão de 13%</dt><dd>'+esc(confirmado?brl(a.comissao_centavos)+(pago?' · paga':' · a receber'):'Sem cobrança aprovada')+'</dd></div><div><dt>Recebimento direto</dt><dd>'+esc(a.recebimento_direto_declarado_em?'Declarado · bloqueado até pagar 13% se ainda pendente':'Não declarado')+'</dd></div><div><dt>Declaração do profissional</dt><dd>'+esc(a.status==='recusado'?'Informou que NÃO fechou em '+dataCurta(a.prestado_em):a.status==='pendente'?'Resultado ainda não informado':a.status==='informado'?'Informou contratação em '+dataCurta(a.prestado_em):'Status: '+a.status)+'</dd></div><div><dt>Cliente respondeu</dt><dd>'+esc(({confirmado:'Sim, contratei',nao_contratou:'Não contratei',divergencia:e==='corrigir'?'Solicitou correção de valor':'Divergência em análise'})[a.cliente_resposta]||'Aguardando resposta')+'</dd></div></dl>'+contatoAdminHtml(a)+'<p class="qf13-next">'+esc(({concluir:'O cliente deve confirmar a conclusão, o valor e o código do pedido. A comissão será gerada automaticamente; não é necessária aprovação do ADM.',corrigir:'O cliente pediu correção do valor. Aguarde o profissional reenviar o combinado; nenhuma comissão foi gerada.',vencida:'O prazo de 48 horas venceu. Novos desbloqueios ficam bloqueados até a confirmação bancária do pagamento.',aguardar:'Profissional ainda não enviou o valor combinado. Prazo para informar o andamento: '+dataCurta(a.prazo_contas)+'.',cliente:'O profissional informou o fechamento. Aguarde a resposta do cliente ou faça a conferência manual.',aprovar:'Próximo passo: confira a contratação e o valor antes de aprovar os 13%.',revisar:'Próximo passo: confira a divergência com o cliente antes de decidir.',validar:'Atenção: o profissional declarou que NÃO FECHOU, mas o cliente ainda não confirmou. Verifique no acompanhamento do pedido antes de encerrar este registro. Não há cobrança aprovada.',cobrar:'Pix emitido pelo sistema. O banco confirma o pagamento e a liberação é automática.',historico:'Registro encerrado. Consulte os detalhes se precisar.'})[e])+'</p><details class="qf13-details"><summary>Analisar pedido e comissão</summary><div class="stack"><dl class="qf13-facts"><div><dt>Resposta do cliente</dt><dd>'+esc(({aguardando:'Aguardando resposta',divergencia:'Cliente contestou',confirmado:'Cliente confirmou',nao_contratado:'Cliente não contratou'})[a.cliente_resposta]||a.cliente_resposta||'Aguardando resposta')+'</dd></div><div><dt>Prazo para informar resultado</dt><dd>'+esc(dataCurta(a.prazo_contas))+'</dd></div></dl><form data-qf13-admin class="stack"><label>Valor confirmado com o cliente (R$)<input class="input" name="valor" inputmode="decimal" placeholder="Ex.: 500,00" value="'+esc(a.valor_confirmado_centavos!=null?(a.valor_confirmado_centavos/100).toFixed(2).replace('.',','):a.valor_informado_centavos!=null?(a.valor_informado_centavos/100).toFixed(2).replace('.',','):'')+'"></label><label>Registro da verificação ou comprovante<textarea class="input" name="nota" maxlength="2000" placeholder="Descreva o que foi confirmado com o cliente"></textarea></label>' +(!pago?(['revisar','corrigir'].includes(e)?'<button type="button" class="btn btn--primary" data-qf13-admin-acao="confirmar">Resolver divergência e confirmar comissão</button><button type="button" class="btn btn--outline" data-qf13-admin-acao="nao_contratado">Registrar que não houve contratação</button>':'')+'<button type="button" class="btn btn--outline" data-qf13-admin-acao="contestar">Registrar contestação ou suspeita de fraude</button>':'')+''+(confirmado&&!pago&&a.cliente_concluiu_em&&!a.recebimento_direto_declarado_em?'<button type="button" class="btn btn--outline" data-qf13-direto-admin>Cliente informou pagamento direto · bloquear até quitar 13%</button>':'')+'</form><button type="button" class="btn btn--outline" data-qf13-historico>Consultar histórico</button><div data-qf13-auditoria></div></div></details><p role="status" data-qf13-msg></p></article>';
 }).join('')||'<p class="text--secondary">Nenhum registro neste filtro.</p>';}
 function painel(rows,admin){if(admin)return adminPainel(rows);return rows.map(a=>'<article class="card stack--sm" data-qf13-row="'+esc(a.id)+'"><strong>'+esc(admin?a.profissional:a.titulo||'Pedido '+a.chamado_id)+'</strong><p>Pedido '+esc(a.chamado_id)+' · Cliente: '+esc(a.cliente)+'</p><p>Valor informado: '+(a.valor_informado_centavos==null?'não informado':esc(brl(a.valor_informado_centavos)))+' · Situação: '+esc(a.status)+(admin&&a.cliente_resposta==='divergencia'?' · DIVERGÊNCIA entre cliente e profissional; verificar antes de cobrar ou suspender':'')+'</p><p>Resposta do cliente: '+esc(({confirmado:'Contratação confirmada pelo cliente',nao_contratou:'Cliente informou que não contratou',divergencia:'Divergência em análise'})[a.cliente_resposta]||'Aguardando confirmação')+(a.cliente_respondeu_em?' · '+esc(new Date(a.cliente_respondeu_em).toLocaleString('pt-BR')):'')+'</p><p>Prestação de contas: '+esc(new Date(a.prazo_contas).toLocaleString('pt-BR'))+'</p><p>Comissão: '+(a.pagamento_plataforma?'13% retidos no Pix integral da plataforma':a.status==='confirmado'?esc(brl(a.comissao_centavos))+' · '+esc(a.cobranca_status)+(a.comissao_vence_em?' · Vencimento: '+esc(new Date(a.comissao_vence_em).toLocaleString('pt-BR')):''):'ainda não devida: aguardando confirmação')+'</p>'+(!admin&&(['pendente','negociando'].includes(a.status)||(a.status==='informado'&&a.cliente_resposta==='divergencia'))?'<form data-qf13-contas><label>Situação<select class="input" name="situacao"><option value="informado">Fechei o serviço</option><option value="negociando">Em negociação</option><option value="recusado">Não fechei</option></select></label><div data-qf13-valor><label>Valor combinado (R$)<input class="input" name="valor" inputmode="decimal" placeholder="500,00" required></label><p class="text--sm">O cliente confirma com um toque no acompanhamento. Confira o valor antes de confirmar.</p></div><button class="btn btn--primary">Registrar prestação de contas</button></form>':'')+(admin?'<form data-qf13-admin><label>Valor confirmado com o cliente (R$)<input class="input" name="valor" inputmode="decimal" value="'+esc(a.valor_confirmado_centavos!=null?(a.valor_confirmado_centavos/100).toFixed(2).replace('.',','):a.valor_informado_centavos!=null?(a.valor_informado_centavos/100).toFixed(2).replace('.',','):'')+'"></label><label>Registro do contato, contestação ou comprovante<textarea class="input" name="nota" maxlength="2000"></textarea></label><button type="button" class="btn btn--primary" data-qf13-admin-acao="confirmar">Confirmar contratação e valor</button><button type="button" class="btn btn--outline" data-qf13-admin-acao="nao_contratado">Marcar não contratado</button><button type="button" class="btn btn--outline" data-qf13-admin-acao="contestar">Registrar contestação</button></form>':'')+(admin?'<button type="button" class="btn btn--outline" data-qf13-historico>Histórico e notificações</button><div data-qf13-auditoria></div>':'')+'<p role="status" data-qf13-msg></p></article>').join('')||'<p>Nenhum desbloqueio com comissão registrado.</p>';}
 g.QFComissao13={oferta,painel,esc,anuncio,decorateCards,etapa,valorCentavos,resumoValor,bindResumo,tempoDecorrido};if(typeof module!=='undefined')module.exports=g.QFComissao13;
 if(!g.document)return;
 function install(){
 if(!g.Screens||g.QFComissao13.installed)return;g.QFComissao13.installed=true;
 const style=document.createElement('style');style.textContent='.qf13-feature{border:2px solid #1769d5!important;background:linear-gradient(120deg,#eef6ff,#fff8ed);padding:20px!important;margin:0 0 18px!important;border-radius:18px}.qf13-feature h2{font-size:1.35rem;margin:10px 0 6px}.qf13-card-hint{color:#176035;font-weight:750;background:#eaf8ef;padding:10px 12px;border-radius:10px;margin-top:8px}.qf13-terms{display:flex;gap:10px;align-items:flex-start;font-size:.9rem}.qf13-terms input{width:20px;height:20px;flex:0 0 20px;margin-top:2px}.qf13-option-head{display:grid;gap:8px}.qf13-wallet{scroll-margin-top:85px}.qf13-option{border:2px solid #1769d5!important;background:#eef6ff;margin:0!important;padding:18px!important;min-width:0;display:flex;flex-direction:column;gap:12px}.qf13-option p{margin:0}.qf13-option details p{padding-top:8px}.qf-opts:has(.qf13-option){display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch}.qf-opts:has(.qf13-option)>.qf-opt--excl,.qf-opts:has(.qf13-option)>.qf-opts__nota,.qf-opts:has(.qf13-option)>.btn{grid-column:1/-1}@media(max-width:639px){.qf-opts:has(.qf13-option){grid-template-columns:1fr}.qf13-feature .btn-row{display:grid}.qf13-feature{padding:16px!important}}';document.head.appendChild(style);
 const adminStyle=document.createElement('style');adminStyle.textContent=`.qf13-wallet,.qf-adm-pedido{min-width:0;line-height:1.5}.qf13-wallet{display:grid;gap:16px}.qf13-admin-row{display:grid;gap:12px;margin:0!important;overflow-wrap:anywhere}.qf13-card-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}.qf13-card-top strong{font-size:17px}.qf13-facts{margin:0;display:grid;gap:10px}.qf13-facts div{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,1.4fr);gap:12px}.qf13-facts dt{color:#5b6577;font-size:13px}.qf13-facts dd{margin:0;font-size:14px;font-weight:650}.qf13-next{background:#eef4ff;border-radius:10px;padding:12px;font-size:14px;line-height:1.5}.qf13-details{border-top:1px solid #e2e6ee;padding-top:12px}.qf13-details summary{color:#1458cc;font-weight:700;cursor:pointer;padding:8px 0}.qf13-details>div{padding-top:16px}.qf13-details label{display:grid;gap:8px;font-size:14px}.qf13-details .btn{height:auto;min-height:46px;padding:12px;white-space:normal;line-height:1.4}.qf13-counts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.qf13-counts>div{padding:12px;border-radius:12px;background:#eef4ff;font-size:13px}@media(min-width:640px){.qf13-counts[aria-label]{grid-template-columns:repeat(3,minmax(0,1fr))}}.qf13-counts b{display:block;font-size:22px;color:#1458cc}.qf-adm-desbloqueio{margin-top:12px;padding:12px;background:#f4f7fc;border-radius:12px;display:grid;gap:7px}.qf-adm-plan-tag{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.qf-adm-plan-tag .badge,.qf-adm-pedido>.row-between .badge{white-space:normal;line-height:1.35}.qf-adm-pedido>.row-between{align-items:flex-start;flex-wrap:wrap}.qf-adm-pedido [data-qf-historico]{width:auto;padding:0;margin-top:8px}.qf13-filters{display:grid;gap:10px}.qf13-summary-link{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}.qf13-admin-alert{background:#fff1dc;border:1px solid #e4bc75;color:#694408;border-radius:12px;padding:12px;font-size:14px;line-height:1.5}.qf13-admin-alert a{color:#1458cc;font-weight:700;text-decoration:underline}.qf13-admin-meta{font-size:13px;color:#5b6577}.qf13-contact{border:1px solid #cfe0f5;background:#f3f8ff;border-radius:12px;padding:12px;display:grid;gap:7px;margin:12px 0}.qf13-contact__row{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.qf13-contact__row span{font-weight:700;color:#0a355b}.qf13-contact__row .btn{width:auto!important;text-decoration:none}.qf13-contact p{margin:0;color:#42536c}`;document.head.appendChild(adminStyle);
 function painelAgendamentos(view,c){
  if(view.querySelector('[data-qf-livre-agendamentos]'))return;
  const card=document.createElement('section');
  card.className='section card stack--sm';card.dataset.qfLivreAgendamentos='';
  card.style.cssText='padding:15px;margin-bottom:14px;border:1px solid #b4cff1;border-radius:16px;background:#f4f8ff';
  card.innerHTML='<h2 class="h3">Serviços agendados · Plano Livre</h2><p role="status">Carregando agendamentos...</p>';
  view.prepend(card);
  const refresh=async()=>{
   const {data,error}=await c.rpc('qf_livre_agendamentos_admin');
   if(!card.isConnected)return;
   if(error||!data?.ok){card.querySelector('[role=status]').textContent='Não foi possível carregar os agendamentos. Atualize a página.';return;}
   const rows=Array.isArray(data.items)?data.items:[];
   const future=rows.filter(x=>x.data&&new Date(x.data)>new Date()&&!x.concluido).length;
   const accepted=rows.filter(x=>x.aceito&&!x.concluido).length;
   card.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><div><h2 class="h3" style="margin:0">Serviços agendados · Plano Livre</h2><p class="text--sm" style="margin:5px 0">'+future+' futuros · '+accepted+' aceitos e não concluídos · '+rows.length+' registros</p></div><button type="button" class="btn btn--outline" data-qf-agenda-refresh>Atualizar</button></div>'+
    '<p class="text--sm">Agendar não gera comissão nem Pix. A conclusão e o pagamento só ocorrem depois da confirmação do cliente.</p>'+
    (!rows.length?'<p>Nenhum agendamento registrado.</p>':rows.map(x=>'<article class="card" style="padding:12px;margin:8px 0;border:1px solid #d7e4f3;border-radius:12px">'+
     '<strong>'+esc(x.servico||'Serviço')+'</strong> · '+esc(x.cidade||'')+
     '<p style="margin:4px 0">Profissional: '+esc(x.profissional||'Não informado')+' · Pedido #'+esc(String(x.chamado_id||'').slice(0,8))+'</p>'+
     '<p style="margin:4px 0">Data: <strong>'+dataCurta(x.data)+'</strong> · Orçamento: '+brl(x.valor_centavos||0)+'</p>'+
     '<p style="margin:4px 0">'+esc(x.descricao||'Sem descrição')+'</p>'+
     '<span class="badge">'+(x.concluido?'Concluído':x.aceito?'Aceito · aguardando execução':'Aguardando aceite do cliente')+'</span></article>').join(''));
   card.querySelector('[data-qf-agenda-refresh]')?.addEventListener('click',refresh);
  };
  refresh().catch(()=>{if(card.isConnected)card.querySelector('[role=status]').textContent='Agendamentos indisponíveis.';});
 }
 function painelPixManual(view,c,admin){
  if(view.querySelector('[data-qf-pix-manual]'))return;
  const box=document.createElement('section');box.className='card stack--sm';box.dataset.qfPixManual='';
  box.style.cssText='border:2px solid #1458cc;border-radius:16px;padding:16px;margin:0 0 16px;background:#f3f8ff';
  view.prepend(box);
  const rpc=async(n,a={})=>{const r=await c.rpc(n,a);if(r.error)throw Error(r.error.message);return r.data;};
  const render=async()=>{
   try{
    const rows=await rpc('qf_livre_manual_pix_painel');
    if(!box.isConnected)return;
    if(!Array.isArray(rows))throw Error('Dados indisponíveis');
    if(!admin&&!rows.length){box.remove();return;}
    const names={criando:'Preparando cobrança',pix_pronto:'Aguardando Pix do cliente',pago:'Pix confirmado; saque disponível após solicitação',repassado:'Repasse concluído',bloqueado:'Pagamento em análise'};
    const total=rows.filter(x=>x.status==='pago').reduce((n,x)=>n+Number(x.profissional_centavos||0),0);
    box.innerHTML='<h2 class="h3">Pix dos serviços</h2>'+(admin?'<p>O cliente paga o valor integral à plataforma. O Quem Faz retém 13% e transfere 87% ao profissional manualmente, após confirmação bancária.</p>':'')+
     (admin?'<p style="font-size:18px;color:#1458cc;font-weight:800">A repassar: '+brl(total)+'</p><button class="btn btn--outline" type="button" data-qf-pix-sync>Conferir pagamentos na Efí</button>':'')+
     (!rows.length?'<p role="status">Nenhum Pix de serviço registrado.</p>':rows.map(x=>
      '<article class="card stack--sm" style="padding:12px;border:1px solid #cfdbec;margin:10px 0" data-qf-pix-item="'+esc(x.id)+'">'+
      '<strong>'+esc(x.profissional)+' · pedido '+esc(String(x.chamado_id).slice(0,8))+'</strong>'+
      '<p>Valor integral: '+brl(x.valor_centavos)+' · Quem Faz 13%: '+brl(x.comissao_centavos)+' · Profissional 87%: <strong>'+brl(x.profissional_centavos)+'</strong></p>'+
      '<p><strong>'+esc(names[x.status]||x.status)+'</strong></p>'+
       (!admin&&x.status==='pago'&&!x.saque_solicitado_em?'<button class="btn btn--primary" type="button" data-qf-solicitar-saque>Solicitar saque · '+brl(x.profissional_centavos)+'</button>':'')+
       (!admin&&x.status==='pago'&&x.saque_solicitado_em?'<p class="text--sm">Saque solicitado. Aguardando repasse manual pelo administrador.</p>':'')+
       (admin&&x.status==='pago'&&!x.saque_solicitado_em?'<p class="text--sm">Pix confirmado, aguardando solicitação de saque pelo profissional.</p>':'')+
      (admin&&x.status==='pago'&&x.saque_solicitado_em?'<p>Chave Pix cadastrada: <strong>'+esc(x.pix_chave||'Ainda não cadastrada')+'</strong></p>'+
       '<p class="text--sm">Transfira os 87% pelo banco. Só depois registre a referência e o comprovante.</p>'+
       '<form data-qf-pix-repassar class="stack--sm"><label>Referência da transferência<input class="input" name="referencia" minlength="16" maxlength="150" required></label>'+
       '<label>Comprovante da transferência<input class="input" name="comprovante" minlength="8" maxlength="500" required></label>'+
       '<label><input type="checkbox" name="transferido" required> Confirmo que já transferi o valor ao profissional</label>'+
       '<button type="submit" class="btn btn--primary">Registrar repasse manual</button></form>':'')+
       '<p role="status" data-qf-pix-msg></p></article>').join(''));
    box.querySelector('[data-qf-pix-sync]')?.addEventListener('click',async e=>{
     const b=e.currentTarget;b.disabled=true;b.textContent='Consultando Efí...';
     try{const r=await c.functions.invoke('quemfaz-livre-pix-manual',{body:{action:'sync_admin'}});
      if(r.error||!r.data?.ok)throw Error('Conciliação indisponível');await render();
     }catch(err){b.textContent=err.message||'Não foi possível conferir';b.disabled=false;}
    });
    box.querySelectorAll('[data-qf-solicitar-saque]').forEach(button=>button.addEventListener('click',async e=>{
      const item=e.currentTarget.closest('[data-qf-pix-item]'),msg=item.querySelector('[data-qf-pix-msg]');
      button.disabled=true;msg.textContent='Solicitando saque...';
      try{const d=await rpc('qf_livre_manual_pix_solicitar',{p_id:item.dataset.qfPixItem});
       if(!d?.ok)throw Error(({chave_pix_ausente:'Cadastre uma chave Pix válida na Carteira.',pagamento_nao_confirmado:'O pagamento ainda não foi confirmado pela Efí.',ja_repassado:'Este serviço já foi repassado.'})[d?.reason]||'Não foi possível solicitar saque.');
       await render();
      }catch(err){msg.textContent=err.message||'Falha ao solicitar saque.';button.disabled=false;}
     }));
     box.querySelectorAll('[data-qf-pix-repassar]').forEach(form=>form.onsubmit=async e=>{
     e.preventDefault();if(!form.reportValidity())return;const item=form.closest('[data-qf-pix-item]'),msg=item.querySelector('[data-qf-pix-msg]');
     const b=form.querySelector('button');b.disabled=true;msg.textContent='Registrando comprovante...';
     try{const r=await rpc('qf_livre_manual_pix_repassar',{p_id:item.dataset.qfPixItem,
       p_referencia:form.elements.referencia.value,p_comprovante:form.elements.comprovante.value});
      if(!r?.ok)throw Error(({chave_pix_ausente:'Profissional sem chave Pix; confira a carteira.',comprovacao_obrigatoria:'Informe referência e comprovante.',pix_nao_conciliado_ou_repassado:'Pix não confirmado ou saque não solicitado.'})[r?.reason]||'Repasse não autorizado');
      await render();
     }catch(err){msg.textContent=err.message||'Falha';b.disabled=false;}
    });
   }catch(err){if(box.isConnected)box.innerHTML='<h2 class="h3">Pix dos serviços</h2><p role="status">'+esc(err.message||'Não foi possível carregar')+'</p>';}
  };render();
 }
 // Controle de ativação do recebimento integral por Pix, exclusivo do administrador.
 function painelPixAtivacao(view,c){
  if(view.querySelector('[data-qf-manual-config]'))return;
  const box=document.createElement('section');box.dataset.qfManualConfig='';box.className='section card stack--sm';
  box.style.cssText='border:2px solid #1769d5;border-radius:16px;background:#f3f8ff;padding:16px;margin:0 0 18px;max-width:100%;overflow-wrap:anywhere';
  box.innerHTML='<h2 class="h3">Pix integral dos serviços</h2><p role="status">Consultando configuração...</p>';
  view.prepend(box);
  const errText={admin_obrigatorio:'Acesso exclusivo do administrador. Entre novamente.',
   efi_producao_nao_validada:'A Efí de produção não confirmou as credenciais e o certificado. A cobrança permanece desativada.',
   efi_sandbox_inadequado:'A Efí está configurada em homologação, não em produção.',
   operacao_em_analise:'Operação em análise: falta confirmação específica da Efí e revisão fiscal/KYC para serviços de terceiros e repasse manual.',
   rpc_indisponivel:'Não foi possível conferir a configuração.'};
  const invoke=async action=>{
   const r=await c.functions.invoke('quemfaz-livre-pix-manual',{body:{action}});
   if(r.error||!r.data?.ok)throw Error(errText[r.data?.reason]||'Ação não confirmada. A configuração não foi alterada.');
   return r.data;
  };
  async function render(note){
   if(!box.isConnected)return;
   try{
    const cfg=await invoke('admin_status'),on=cfg.habilitado===true;
    if(!box.isConnected)return;
    box.innerHTML='<h2 class="h3">Pagamento dos serviços · Quem Faz Livre</h2>'+
    '<p class="text--sm">O cliente paga <strong>100% pelo Pix do Quem Faz</strong>. A plataforma fica com 13% e você repassa <strong>manualmente os 87%</strong> depois da confirmação bancária. Sem split automático.</p>'+
    '<p style="font-weight:800;color:'+(on?'#087544':'#ad5600')+'">'+(on?'Recebimento ativo':'Recebimento desativado')+'</p>'+
    (cfg.efi_verificado_em?'<p class="text--sm">Efí validada em '+esc(new Date(cfg.efi_verificado_em).toLocaleString('pt-BR'))+'</p>':'')+
    (cfg.bloqueio?'<p role="status" style="padding:12px;background:#fff1d6;border-radius:10px"><strong>Operação em análise.</strong> '+esc(cfg.bloqueio)+'</p>':'')+
    (cfg.efi_ultima_tentativa?'<p class="text--sm">Última conferência: '+esc(new Date(cfg.efi_ultima_tentativa).toLocaleString('pt-BR'))+' · '+esc(cfg.efi_ultimo_resultado)+'</p>':'<p class="text--sm">Autenticação de produção ainda não conferida neste controle.</p>')+
    '<p class="text--sm">Esta configuração não afeta a assinatura de R$ 39,90. Ao pausar, cobranças já emitidas continuam no histórico.</p>'+
    '<div class="btn-row"><button class="btn '+(on?'btn--outline':'btn--primary')+'" style="white-space:normal;min-height:44px" type="button" data-qf-manual-toggle="'+(on?'admin_disable':'admin_enable')+'">'+(on?'Pausar novas cobranças':'Ativar cobrança Pix integral')+'</button>'+
    '<button class="btn btn--outline" type="button" data-qf-manual-validate>Validar conexão Efí sem cobrança</button><button class="btn btn--outline" type="button" data-qf-manual-refresh>Atualizar</button></div>'+
    '<p role="status" data-qf-manual-feedback>'+(note?esc(note):'')+'</p>';
    box.querySelector('[data-qf-manual-refresh]').onclick=()=>render();
    box.querySelector('[data-qf-manual-validate]').onclick=async e=>{e.currentTarget.disabled=true;const msg=box.querySelector('[data-qf-manual-feedback]');msg.textContent='Validando autenticação bancária. Nenhuma cobrança será criada.';try{await invoke('admin_validate');await render('Autenticação de produção confirmada. Nenhuma cobrança criada.');}catch(ex){await render(ex.message);}};
    box.querySelector('[data-qf-manual-toggle]').onclick=async e=>{
     const btn=e.currentTarget,action=btn.dataset.qfManualToggle,feedback=box.querySelector('[data-qf-manual-feedback]');
     btn.disabled=true;feedback.textContent=action==='admin_enable'?'Autenticando com a Efí de produção antes de ativar...':'Pausando novas cobranças...';
     try{await invoke(action);await render(action==='admin_enable'?'Cobrança Pix integral ativada.':'Novas cobranças pausadas.');}
     catch(ex){feedback.textContent=ex.message||'Erro ao alterar';btn.disabled=false;}
    };
   }catch(ex){box.innerHTML='<h2 class="h3">Pix integral dos serviços</h2><p role="status">'+esc(ex.message||'Não foi possível consultar')+'</p><button class="btn btn--outline" data-qf-retry>Verificar novamente</button>';box.querySelector('[data-qf-retry]').onclick=()=>render();}
  }
  render();
 }
 const anterior=g.Screens.afterRender;
 function enhance(pattern,content,params,user){
  if(['/admin/dashboard','/admin/financeiro','/admin/comissao13'].includes(pattern)){
   const adm=g.QFAdminCloud?.client||g.QFCloud?.client;
   if(adm)painelPixAtivacao(content.querySelector('.view')||content,adm);
    if(adm&&pattern!=='/admin/financeiro')painelAgendamentos(content.querySelector('.view')||content,adm);
   if(pattern!=='/admin/comissao13')return;
  }
  if(content.querySelector('[data-qf13]'))return;
  const admin=pattern==='/admin/comissao13',carteira=pattern==='/profissional/carteira';
  const pedido=['/profissional/pedido/:id','/profissional/chamada/:id'].includes(pattern);
  const lista=['/profissional/home','/profissional/servicos/disponiveis','/profissional/servicos'].includes(pattern);
  if(pattern.startsWith('/cliente/')){
   if(pattern==='/cliente/pedido/:id'&&g.QFAcompanhamento&&!content.closest('#qf-pedido-facil')){const panel=document.createElement('section');panel.className='section qf-owner-panel';panel.dataset.qf13='';const view=content.querySelector('.view')||content,heading=view.querySelector(':scope > .row-between');if(heading)heading.after(panel);else view.prepend(panel);g.QFAcompanhamento.mount(panel,params.id,{embedded:true});}return;
  }
  if(!admin&&!carteira&&!pedido&&!lista&&pattern!=='/profissional/chat/:id')return;
  const c=admin?g.QFAdminCloud&&g.QFAdminCloud.client:g.QFCloud&&g.QFCloud.client;if(!c)return;
  const rpc=async(n,a={})=>{const r=await c.rpc(n,a);if(r.error)throw Error(r.error.message);return r.data;};
  const box=document.createElement('section');box.className='section card stack--sm';box.dataset.qf13='';
  const cents=valorCentavos;
  const view=content.querySelector('.view')||content;
  if(lista){return;}
  if(admin||carteira){
   if(admin){
    // Modelo aprovado: repasse manual, sem necessidade de conta Efí do profissional.
    const aviso=document.createElement('section');
    aviso.className='section card stack--sm';
    aviso.style.cssText='padding:14px;margin-bottom:14px';
    aviso.dataset.qfManualInfo='';
    aviso.innerHTML='<h2 class="h3">Repasse Pix manual · Plano Livre</h2><p>O profissional informa a chave Pix de sua conta. Após confirmação bancária do pagamento do serviço e solicitação, o administrador transfere pelo banco e registra o comprovante no painel Financeiro. Não há envio automático de dinheiro.</p><p class="text--sm">Ative ou pause novas cobranças usando o controle Pix acima. As comissões antigas continuam separadas para não gerar pagamentos duplicados.</p><a class="btn btn--outline" href="#/admin/financeiro">Abrir controle financeiro</a>';
    view.prepend(aviso);
   }
   painelPixManual(view,c,admin);
   box.classList.add('qf13-wallet');view.prepend(box);box.innerHTML=admin?'<h2 class="h3">Prestação de contas e comissões</h2><p>Carregando…</p>':'';
   let filtro='todos',pagina=0,cache=null;
   if(admin){const clock=g.setInterval(()=>{if(!box.isConnected){g.clearInterval(clock);return;}box.querySelectorAll('[data-qf13-age]').forEach(el=>{const t=tempoDecorrido(el.dataset.qf13Age);if(t)el.textContent=el.dataset.qf13AgeLabel+' há '+t+' · Desde '+dataCurta(el.dataset.qf13Age);});},60000);}
   const render=async()=>{const rows=cache||await rpc('qf_comissao13_fechamentos_painel');cache=rows;if(!box.isConnected)return;const atuais=rows.filter(a=>etapa(a)!=='historico'),historico=rows.filter(a=>etapa(a)==='historico');rows.sort((a,b)=>({vencida:0,corrigir:1,revisar:2,validar:3,aprovar:4,concluir:5,cliente:6,aguardar:7,cobrar:8,historico:9}[etapa(a)]??7)-({vencida:0,corrigir:1,revisar:2,validar:3,aprovar:4,concluir:5,cliente:6,aguardar:7,cobrar:8,historico:9}[etapa(b)]??7));
    const counts={concluir:0,corrigir:0,vencida:0,aguardar:0,cliente:0,aprovar:0,revisar:0,validar:0,cobrar:0,historico:0};rows.forEach(a=>counts[etapa(a)]++);
    if(admin&&pattern==='/admin/dashboard'){const avisos=rows.filter(a=>etapa(a)==='validar').sort((a,b)=>new Date(b.prestado_em||b.informado_em||0)-new Date(a.prestado_em||a.informado_em||0)).slice(0,5);const itens=avisos.map(a=>'<p><strong>'+esc(a.profissional)+'</strong> · '+esc(a.titulo||'Serviço')+' #'+esc(String(a.chamado_id).slice(0,8))+'<br>Cliente: '+esc(a.cliente)+' · Declarado em '+dataCurta(a.prestado_em||a.informado_em)+'</p>'+contatoAdminHtml(a)).join('');box.innerHTML='<div class="qf13-summary-link"><div><h2 class="h3">Comissões de 13%</h2><p class="text--sm">'+rows.length+' desbloqueios · '+counts.validar+' não fechados sem confirmação · '+counts.concluir+' aguardando conclusão · '+(counts.cobrar+counts.vencida)+' a receber · '+counts.cliente+' aguardando cliente · '+counts.corrigir+' correções · '+counts.vencida+' vencidas</p></div><a class="btn btn--outline btn--sm" style="width:auto" href="#/admin/comissao13">Ver todos os desbloqueios</a></div>'+(counts.validar?'<div class="qf13-admin-alert" role="status"><strong>'+counts.validar+' declaração(ões) de “não fechei” precisam ser verificadas com o cliente.</strong><p>Sem confirmação dos clientes:</p>'+itens+'<a href="#/admin/comissao13">Ver todos e verificar</a></div>':'');return;}
    const filtered=rows.filter(a=>filtro==='todos'||(filtro==='atuais'?etapa(a)!=='historico':etapa(a)===filtro));pagina=Math.min(pagina,Math.max(0,Math.ceil(filtered.length/8)-1));
    box.innerHTML=admin?'<h2 class="h3">Comissões de 13%</h2><p class="text--sm">No Plano Livre, se o cliente pagar via Pix da plataforma, o repasse é manual e os 13% já estão retidos. Se o cliente pagar diretamente ao profissional, os 13% ficam pendentes de Pix, e o profissional é bloqueado para novos desbloqueios após a declaração ou confirmação administrativa até a conciliação bancária. Divergências exigem análise.</p><details><summary>Como calcular os 13%</summary><p>Exemplo: serviço de R$ 500,00 gera comissão de R$ 65,00. Sem contratação confirmada, não há comissão aprovada. O Plano Livre permite desbloqueios ilimitados durante a validade; a comissão depende do fechamento.</p></details><p class="text--sm text--secondary">'+rows.length+' desbloqueios · '+counts.aguardar+' aguardando resultado · '+counts.validar+' para conferir · '+counts.revisar+' divergências · '+counts.concluir+' aguardando conclusão · '+counts.cobrar+' comissões dentro do prazo</p>'+'<div class="qf13-counts" aria-label="Pendências de contratação">'+[['cliente','Aguardando cliente'],['corrigir','Correção de valor'],['vencida','Comissão vencida']].map(x=>'<button type="button" class="btn btn--outline" data-qf13-quick="'+x[0]+'" style="height:auto;min-height:64px;white-space:normal;display:grid;gap:4px"><strong>'+counts[x[0]]+'</strong>'+x[1]+'</button>').join('')+'</div>'+(counts.validar?'<p class="qf13-admin-alert" role="status"><strong>Atenção: '+counts.validar+' pedido(s) declarados “não fechei” ainda aguardam confirmação do cliente.</strong> Esses desbloqueios continuam no histórico e precisam de conferência antes do encerramento.</p>':'')+'<label class="qf13-filters">Mostrar<select class="input" data-qf13-filtro>'+[['todos','Todos os desbloqueios'],['validar','Não fechou · confirmar cliente'],['atuais','Todas as pendências'],['concluir','Aguardando conclusão do cliente'],['corrigir','Correção de valor'],['vencida','Comissão vencida'],['aguardar','Aguardando respostas'],['cliente','Aguardando cliente'],['revisar','Divergências'],['cobrar','Comissões a receber'],['historico','Histórico encerrado']].map(x=>'<option value="'+x[0]+'"'+(filtro===x[0]?' selected':'')+'>'+x[1]+'</option>').join('')+'</select></label><p class="text--sm text--secondary">'+filtered.length+' de '+rows.length+' desbloqueios · página '+(pagina+1)+'</p><button type="button" class="btn btn--outline btn--sm" data-qf13-refresh style="width:auto">Atualizar informações</button>'+painel(filtered.slice(pagina*8,pagina*8+8),true)+'<div class="btn-row"><button class="btn btn--outline btn--sm" data-qf13-page="-1" '+(!pagina?'disabled':'')+'>Anterior</button><button class="btn btn--outline btn--sm" data-qf13-page="1" '+((pagina+1)*8>=filtered.length?'disabled':'')+'>Próxima</button></div>':(!rows.length?'':'<h2 class="h3">Pedidos anteriores</h2>'+painel(atuais,false)+(historico.length?'<details><summary>Histórico de prestações de contas ('+historico.length+')</summary>'+painel(historico,false)+'</details>':''));

    // A carteira apresenta apenas recebimentos bancários conciliados; o botão
    // solicita baixa MANUAL, jamais executa Pix ou credita saldo no navegador.
    if(!admin){
      const manual=document.createElement('section');
      manual.className='card stack--sm';
      manual.style.cssText='border:1px solid #bdd1ea;border-radius:16px;padding:16px;margin-bottom:12px;background:#f5f9ff';
      manual.dataset.qfManualRepasse='';
      manual.innerHTML='<h2 class="h3">Meus repasses Pix</h2><p role="status">Consultando pagamentos confirmados...</p>';
      box.prepend(manual);
      try{
        const items=await rpc('qf_repasses_manuais_painel');
        if(manual.isConnected){
          const totalReceber=(items||[]).filter(x=>x.situacao!=='pago').reduce((sum,x)=>sum+Number(x.profissional_centavos||0),0);
          if(!items?.length){manual.remove();return;}
          manual.innerHTML='<h2 class="h3">Meus repasses Pix</h2><p style="font-weight:800;color:#1458cc;font-size:20px">Total a receber: '+brl(totalReceber)+'</p><p class="text--sm">Quando o pagamento do serviço for confirmado pelo banco e a conclusão estiver validada, você poderá solicitar o repasse de 87% à chave Pix cadastrada. A transferência será feita manualmente pelo Quem Faz.</p>'+
           (!items?.length?'<p>Você ainda não tem pagamentos de serviços confirmados para solicitar repasse.</p>':
           items.map(x=>'<article class="card stack--sm" data-qf-manual-id="'+esc(x.financeiro_id)+'"><strong>'+esc(x.pedido||'Serviço')+'</strong><p>Cliente pagou: '+brl(x.valor_bruto_centavos)+' · Comissão Quem Faz: '+brl(x.comissao_centavos)+' · Seu repasse: <strong>'+brl(x.profissional_centavos)+'</strong></p><p>Situação: <strong>'+esc(x.situacao)+'</strong></p>'+
            (x.can_request?'<button class="btn btn--primary" type="button" data-qf-solicitar-manual>Solicitar pagamento (saque Pix)</button>':'')+
            '<p role="status" data-qf-manual-msg></p></article>').join(''));
          manual.querySelectorAll('[data-qf-solicitar-manual]').forEach(btn=>btn.onclick=async()=>{
            const row=btn.closest('[data-qf-manual-id]'),msg=row.querySelector('[data-qf-manual-msg]');btn.disabled=true;
            try{
              const r=await rpc('qf_repasses_manuais_solicitar',{p_financeiro_id:row.dataset.qfManualId});
              if(!r?.ok)throw Error(({chave_pix_ausente:'Cadastre sua chave Pix na carteira.',plano_livre_nao_comprovado:'Não foi possível comprovar o Plano Livre ativo na contratação.',pagamento_nao_liberado:'Pagamento ainda não foi liberado pelo banco.'})[r?.reason]||'Não foi possível solicitar o pagamento.');
              msg.textContent='Solicitação registrada. O administrador fará a transferência manual.';
              btn.remove();
            }catch(e){msg.textContent=e.message;btn.disabled=false;}
          });
        }
      }catch(e){if(manual.isConnected)manual.querySelector('[role=status]').textContent='Controle de repasses indisponível: '+(e.message||'atualize a carteira');}
    }

    // Pagamento direto fora da plataforma exige declaração explícita e bloqueia
    // novos desbloqueios até o Pix da comissão ser conciliado pelo banco.
    if(!admin){
      const diretos=rows.filter(a=>!a.pagamento_plataforma&&a.status==='confirmado'&&a.cliente_resposta==='confirmado'&&a.cliente_concluiu_em&&a.cobranca_status==='pendente'&&!a.recebimento_direto_declarado_em);
      const declarados=rows.filter(a=>!a.pagamento_plataforma&&a.recebimento_direto_declarado_em&&a.cobranca_status==='pendente');
      if(diretos.length||declarados.length){
        const section=document.createElement('section');
        section.className='card stack--sm';
        section.style.cssText='border:2px solid #dfb15f;background:#fff8eb;border-radius:16px;padding:16px;margin-bottom:12px';
        section.dataset.qf13Direto='';
        section.innerHTML='<h2 class="h3">Recebimento direto antigo · acerto de comissão</h2>'+
         '<p>Somente para atendimentos antigos pagos diretamente: declare o recebimento para quitar a comissão de 13% por Pix. Até o banco confirmar essa comissão, novos desbloqueios ficarão bloqueados. Se o cliente pagou pelo Pix da plataforma, NÃO confirme recebimento direto.</p>'+
         declarados.map(a=>'<p role="status"><strong>Pedido '+esc(String(a.chamado_id).slice(0,8))+'</strong>: pagamento direto declarado. Novos pedidos bloqueados até quitar a comissão de '+brl(a.comissao_centavos)+' por Pix na carteira.</p>').join('')+
         diretos.map(a=>'<div class="stack--sm" data-qf13-direto="'+esc(a.id)+'"><strong>Pedido '+esc(String(a.chamado_id).slice(0,8))+' · comissão '+brl(a.comissao_centavos)+'</strong>'+
          '<label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" data-qf13-direto-aceite> Confirmo que recebi o valor deste serviço diretamente do cliente e tenho uma comissão de 13% a pagar ao Quem Faz.</label>'+
          '<button type="button" class="btn btn--outline" data-qf13-direto-confirmar>Registrar recebimento direto</button><p role="status" data-qf13-direto-msg></p></div>').join('');
        box.prepend(section);
        section.querySelectorAll('[data-qf13-direto]').forEach(item=>{
          const button=item.querySelector('[data-qf13-direto-confirmar]'),msg=item.querySelector('[data-qf13-direto-msg]');
          button.onclick=async()=>{
            if(!item.querySelector('[data-qf13-direto-aceite]').checked){msg.textContent='Marque a confirmação do recebimento antes de continuar.';return;}
            button.disabled=true;msg.textContent='Registrando recebimento e obrigação de comissão...';
            try{
              const r=await rpc('qf_comissao13_declarar_recebimento_direto',{p_fechamento_id:item.dataset.qf13Direto});
              if(!r?.ok)throw Error(({pagamento_plataforma_ja_confirmado:'O Pix do serviço já foi confirmado na plataforma. Nenhuma comissão adicional deve ser cobrada.',conclusao_ou_cobranca_nao_confirmada:'A conclusão e a comissão precisam estar confirmadas pelo cliente.'})[r?.reason]||'Recebimento direto não autorizado.');
              cache=null;await render();
            }catch(e){msg.textContent=e.message;button.disabled=false;}
          };
        });
      }
    }
    // Pix da comissão pertence ao profissional e é emitido pelo backend Efí.
    // Nenhum valor ou txid é fornecido pelo navegador.
    if(!admin){
      const pendencias=rows.filter(a=>!a.pagamento_plataforma&&a.status==='confirmado'&&a.cobranca_status==='pendente');
      if(pendencias.length){
        const area=document.createElement('section');area.className='card stack--sm';area.style.cssText='border:2px solid #edaa50;background:#fff9f0;padding:16px;border-radius:16px;margin-bottom:12px;';
        area.innerHTML='<h2 class="h3" style="margin:0">Comissão pendente — pagamento Pix</h2><p>A comissão vence em 48 horas após a confirmação. Após o vencimento sem pagamento, novos desbloqueios ficam suspensos. O banco confirma o Pix e a liberação é automática.</p>'+
          pendencias.map(a=>{
            const deadline=a.comissao_vence_em?new Date(a.comissao_vence_em):null;
            const valid=deadline&&!Number.isNaN(deadline.getTime());
            const overdue=valid&&Date.now()>deadline.getTime();
            const label=valid?(overdue?'Pagamento vencido desde ':'Pague até ')+deadline.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'Prazo de pagamento: 48 horas após confirmar o serviço';
            return '<div class="stack--sm" data-qf13-pix="'+esc(a.id)+'"><strong>Pedido '+esc(String(a.chamado_id).slice(0,8))+' · '+brl(a.comissao_centavos)+'</strong><p role="status" style="margin:2px 0;font-weight:700;color:'+(overdue?'#ad321d':'#7a4500')+'">'+esc(label)+'</p><button class="btn btn--primary" type="button" data-qf13-gerar-pix>Mostrar Pix para pagar</button><div data-qf13-pix-info role="status"></div></div>';
          }).join('');
        box.prepend(area);
        for(const item of area.querySelectorAll('[data-qf13-pix]')){
          const b=item.querySelector('[data-qf13-gerar-pix]'),target=item.querySelector('[data-qf13-pix-info]');
          b.onclick=async()=>{
            b.disabled=true;target.textContent='Preparando cobrança segura…';
            try{
              const {data:d,error:e}=await c.functions.invoke('quemfaz-comissao13-pix',{body:{fechamento_id:item.dataset.qf13Pix}});
              if(e||!d?.ok)throw Error('Cobrança indisponível. Tente novamente sem efetuar pagamentos fora do aplicativo.');
              if(d.status==='pago'){target.textContent='Pagamento confirmado. Atualize a carteira para continuar.';return;}
              if(d.status==='aguardando_conciliacao'){target.textContent='Pix recebido pela Efí. Conferindo a liquidação para liberar novos pedidos.';return;}
              if(!d.pix_copia_cola)throw Error('QR Pix indisponível. Tente novamente.');
              target.replaceChildren();
              if(d.qr_image){
                let imgsrc=String(d.qr_image);
                if(/^[A-Za-z0-9+/=]+$/.test(imgsrc))imgsrc='data:image/png;base64,'+imgsrc;
                if(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(imgsrc)){
                  const img=document.createElement('img');img.src=imgsrc;img.alt='QR Code Pix da comissão';img.style.cssText='width:200px;max-width:100%;height:auto;display:block;margin:10px auto';target.appendChild(img);
                }
              }
              const label=document.createElement('p');label.textContent='Pix Copia e Cola — '+brl(d.valor_centavos||0);target.appendChild(label);
              const textarea=document.createElement('textarea');textarea.className='input';textarea.readOnly=true;textarea.value=String(d.pix_copia_cola);textarea.style.cssText='width:100%;min-height:94px';target.appendChild(textarea);
              const copy=document.createElement('button');copy.type='button';copy.className='btn btn--outline';copy.textContent='Copiar código Pix';copy.onclick=async()=>{try{await navigator.clipboard.writeText(textarea.value);copy.textContent='Código copiado';}catch{textarea.select();copy.textContent='Selecione e copie o código';}};target.appendChild(copy);
              const info=document.createElement('p');info.className='text--sm';info.textContent='Aguardando pagamento. Nunca envie comprovante ao administrador: a confirmação é automática pelo banco.';target.appendChild(info);
            }catch(e){target.textContent=e.message||'Não foi possível carregar o Pix.';}finally{b.disabled=false;}
          };
          b.click();
        }
        let checks=0;const t=g.setInterval(async()=>{
          if(!box.isConnected||++checks>60){g.clearInterval(t);return;}
          if(g.document.hidden)return;
          try{const atuais=await rpc('qf_comissao13_fechamentos_painel');
            if(!atuais.some(a=>a.status==='confirmado'&&a.cobranca_status==='pendente')){g.clearInterval(t);cache=null;await render();}
          }catch(_){}
        },10000);
      }
    }
    if(admin){box.querySelectorAll('[data-qf13-quick]').forEach(b=>b.onclick=()=>{filtro=b.dataset.qf13Quick;pagina=0;render();});box.querySelector('[data-qf13-refresh]').onclick=()=>{cache=null;render().catch(()=>{});};box.querySelector('[data-qf13-filtro]').onchange=e=>{filtro=e.target.value;pagina=0;render();};box.querySelectorAll('[data-qf13-page]').forEach(b=>b.onclick=()=>{pagina+=Number(b.dataset.qf13Page);render();box.scrollIntoView({block:'start'});});}

    box.querySelectorAll('[data-qf13-row]').forEach(row=>{
     const id=row.dataset.qf13Row,a=rows.find(x=>x.id===id),msg=row.querySelector('[data-qf13-msg]');
     if(admin){
      const direct=row.querySelector('[data-qf13-direto-admin]');
      if(direct)direct.onclick=async()=>{
        const evidence=row.querySelector('form[data-qf13-admin] [name=nota]')?.value?.trim()||'';
        if(evidence.length<20){msg.textContent='Registre pelo menos 20 caracteres de evidência do pagamento informado pelo cliente.';return;}
        direct.disabled=true;msg.textContent='Registrando confirmação e bloqueio...';
        try{
          const out=await rpc('qf_comissao13_admin_declarar_direto',{p_fechamento_id:id,p_evidencia:evidence});
          if(!out?.ok)throw Error(out?.reason||'Não foi possível confirmar a modalidade de pagamento.');
          cache=null;await render();
        }catch(e){msg.textContent=e.message;direct.disabled=false;}
      };
      row.querySelector('[data-qf13-historico]').onclick=async()=>{try{const h=await rpc('qf13_admin_historico',{p_id:id});row.querySelector('[data-qf13-auditoria]').innerHTML='<h3 class="h3">Notificações ao cliente</h3>'+h.notificacoes.map(n=>'<p>'+esc(n.status)+' · '+esc(n.erro||'')+'</p>').join('')+'<h3 class="h3">Histórico administrativo</h3>'+h.eventos.map(e=>'<p>'+esc(new Date(e.em).toLocaleString('pt-BR'))+' · '+esc(e.ator||'sistema/cliente verificado')+' · '+esc(e.depois.status)+' · '+esc(e.depois.observacao_admin||e.depois.cliente_resposta||'')+'</p>').join('');}catch(e){msg.textContent=e.message;}};
      row.querySelectorAll('[data-qf13-admin-acao]').forEach(btn=>{btn.onclick=async()=>{btn.disabled=true;try{const form=row.querySelector('form'),r=await rpc('qf_comissao13_admin',{p_id:id,p_acao:btn.dataset.qf13AdminAcao,p_valor_centavos:cents(form.elements.valor.value),p_observacao:form.elements.nota.value.trim()});if(!r.ok)throw Error(motivo(r.reason));cache=null;await render();}catch(e){msg.textContent=e.message;}finally{btn.disabled=false;}};});
     }else{const form=row.querySelector('form');if(!form)return;bindResumo(form);if(a.prorrogacoes_negociacao>=1)form.querySelector('option[value=negociando]').disabled=true;form.elements.situacao.onchange=()=>{const fechado=form.elements.situacao.value==='informado';form.querySelector('[data-qf13-valor]').hidden=!fechado;form.elements.valor.required=fechado;};form.onsubmit=async e=>{e.preventDefault();const btn=form.querySelector('button');btn.disabled=true;try{const r=await rpc('qf_comissao13_prestar_contas',{p_id:id,p_situacao:form.elements.situacao.value,p_valor_centavos:cents(form.elements.valor.value),p_codigo:null});if(!r.ok)throw Error(motivo(r.reason));cache=null;await render();}catch(err){msg.textContent=err.message;}finally{btn.disabled=false;}};}
    });
   };render().catch(()=>box.textContent='Não foi possível carregar a prestação de contas. Atualize a página.');if(!admin&&carteira){const timer=g.setInterval(()=>{if(!box.isConnected){g.clearInterval(timer);return;}if(g.document.hidden||box.querySelector('input:focus,textarea:focus,select:focus'))return;cache=null;render().catch(()=>{});},30000);}if(admin&&pattern==='/admin/dashboard'){const timer=setInterval(()=>{if(!box.isConnected){clearInterval(timer);return;}if(document.visibilityState==='hidden')return;cache=null;render().catch(()=>{});},60000);}return;
  }
  // Prestação de contas diretamente no pedido ou na conversa, sem abrir a carteira.
  if(pattern==='/profissional/chat/:id')return;
  if(pattern==='/profissional/pedido/:id'||pattern==='/profissional/chamada/:id'){
   const pedidoId=params.id;if(!pedidoId)return;
   rpc('qf_comissao13_fechamentos_painel').then(rows=>{
    if(!content.isConnected||!Array.isArray(rows))return;
    const a=rows.find(x=>String(x.chamado_id)===String(pedidoId));if(!a)return;
    content.querySelectorAll('[data-qf-fechamento],[data-action="fechei-servico"],[data-qf-baixa-btn]').forEach(b=>b.hidden=true);
    if(content.querySelector('[data-qf13-fechar-inline]'))return;
    const panel=document.createElement('section');panel.className='section card stack--sm qf13-inline';panel.dataset.qf13FecharInline='';
    if(!(['pendente','negociando'].includes(a.status)||(a.status==='informado'&&a.cliente_resposta==='divergencia'))){panel.innerHTML='<h2 class="h3">Acompanhamento da contratação</h2>'+painel([a],false);if(pattern!=='/profissional/chat/:id')panel.insertAdjacentHTML('afterbegin',suporteProfHtml(pedidoId,!['recusado','cancelado','nao_contratado'].includes(a.status)));(content.querySelector('.view')||content).prepend(panel);return;}
    panel.innerHTML='<h2 class="h3">Situação do serviço</h2><p>Informe o resultado. Se fechou, digite o valor combinado. A conclusão e o código serão confirmados pelo cliente.</p><div class="qf13-outcome-actions" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px"><button type="button" class="btn btn--primary" style="min-width:0;min-height:76px;padding:10px 4px;white-space:normal;word-break:normal;overflow-wrap:normal;font-size:13px;line-height:1.3;background:#09874b;color:#fff;border:1px solid #09874b;border-radius:12px" data-qf13-abrir>Fechei</button><button type="button" class="btn btn--outline" style="min-width:0;min-height:76px;padding:10px 4px;white-space:normal;word-break:normal;overflow-wrap:normal;font-size:13px;line-height:1.3;background:#fff4e2;color:#995000;border:1px solid #f3c27e;border-radius:12px" data-qf13-negociando>Negociando</button><button type="button" class="btn btn--outline" style="min-width:0;min-height:76px;padding:10px 4px;white-space:normal;word-break:normal;overflow-wrap:normal;font-size:13px;line-height:1.3;background:#fff1ef;color:#a32020;border:1px solid #edb1aa;border-radius:12px" data-qf13-recusado>Não fechei</button></div><form data-qf13-inline-form hidden class="stack--sm"><label>Valor combinado (R$)<input class="input" name="valor" inputmode="decimal" placeholder="500,00" required></label><p class="text--sm">O cliente precisa confirmar a conclusão e o valor final com o código de seis dígitos. A comissão só é devida após a confirmação.</p><button class="btn btn--primary" type="submit">Confirmar serviço fechado</button></form><p role="status" data-qf13-inline-msg></p>';
    const confirmation=document.createElement('p');confirmation.dataset.qf13ClienteConfirmou='';confirmation.style.cssText='padding:12px;border-radius:12px;background:#edf5ff;color:#1769d5;font-weight:700';
    const showConfirmation=row=>{confirmation.hidden=row.cliente_resposta!=='confirmado';confirmation.textContent='Contratação confirmada pelo cliente';};showConfirmation(a);panel.prepend(confirmation);
    // Atualiza a resposta do cliente sem apagar o valor que o profissional está digitando.
    if(pattern!=='/profissional/chat/:id'){const timer=g.setInterval(async()=>{if(!panel.isConnected){g.clearInterval(timer);return;}if(g.document.hidden)return;try{const rows=await rpc('qf_comissao13_fechamentos_painel');const row=rows.find(x=>String(x.id)===String(a.id));if(row)showConfirmation(row);}catch(_){}},10000);}
    if(pattern!=='/profissional/chat/:id')panel.insertAdjacentHTML('afterbegin',suporteProfHtml(pedidoId,!['recusado','cancelado','nao_contratado'].includes(a.status)));
    (content.querySelector('.view')||content).prepend(panel);
    const msg=panel.querySelector('[data-qf13-inline-msg]'),form=panel.querySelector('form');bindResumo(form);
    panel.querySelector('[data-qf13-abrir]').onclick=()=>{form.hidden=false;panel.querySelector('[name=valor]').focus();};
    const submit=async(situacao,valor=null,codigo=null,btn=null)=>{if(btn)btn.disabled=true;try{const r=await rpc('qf_comissao13_prestar_contas',{p_id:a.id,p_situacao:situacao,p_valor_centavos:valor,p_codigo:codigo});if(!r.ok)throw Error(motivo(r.reason));panel.innerHTML='<h2 class="h3">'+(situacao==='informado'?'Confirmação enviada ao cliente':'Situação registrada')+'</h2><p>'+(situacao==='informado'?'Fechamento informado. '+'O cliente pode confirmar no acompanhamento. Comissão de 13% calculada automaticamente após confirmação do cliente.':'Informação enviada ao Quem Faz.')+'</p>'+(pattern==='/profissional/chat/:id'?'':suporteProfHtml(pedidoId,situacao!=='recusado'));}catch(e){msg.textContent=e.message||'Não foi possível registrar. Tente novamente.';if(btn)btn.disabled=false;}};
    const negociar=panel.querySelector('[data-qf13-negociando]');negociar.disabled=a.prorrogacoes_negociacao>=1;negociar.textContent=negociar.disabled?'Prazo utilizado':'Negociando';negociar.title='Prorrogar prestação de contas por 48 horas';
    panel.querySelector('[data-qf13-negociando]').onclick=e=>submit('negociando',null,null,e.currentTarget);
    panel.querySelector('[data-qf13-recusado]').onclick=e=>submit('recusado',null,null,e.currentTarget);
    form.onsubmit=e=>{e.preventDefault();const valor=cents(form.elements.valor.value);if(valor==null||valor<100||valor>100000000){msg.textContent='Informe um valor entre R$ 1 e R$ 1.000.000.';return;}submit('informado',valor,null,form.querySelector('button'));};
   }).catch(()=>{});
   if(pattern==='/profissional/chat/:id')return;
  }
  const req=g.DB&&g.DB.requestById(params.id);if(!req||req.atendimentoTipo==='garante'||req.modalidade==='valor_definido')return;
  // O botão pago conserva seu evento e a cobrança existente.
  const pago=content.querySelector('[data-action="desbloquear-chamada"]');
  if(!pago){rpc('qf_comissao13_meu_desbloqueio',{p_chamado_id:params.id}).then(d=>{if(!d.ok||!content.isConnected||content.querySelector('[data-qf13-fechar-inline]'))return;content.querySelectorAll('[data-action="fechei-servico"],[data-qf-baixa-btn]').forEach(b=>b.hidden=true);box.innerHTML='<h2 class="h3">Quem Faz Livre — comissão de 13%</h2><p>Registre o andamento em até 48 horas na carteira.</p><a class="btn btn--primary" href="#/profissional/carteira">Prestar contas</a>'+suporteProfHtml(params.id);view.prepend(box);}).catch(()=>{});return;}
  // Novos contatos: plano pago ou créditos. Prestação de contas anterior permanece acima.
  return;
 }
 // O financeiro real monta estes controles antes das tabelas extensas.
 g.QFComissao13.mountPixAdmin=function(view,c){
  const existing=view.parentElement?.querySelector('[data-qf-manual-config]');
  if(existing&&!view.contains(existing))view.prepend(existing);
  painelPixAtivacao(view,c);if(g.QFPixFinanceiro)g.QFPixFinanceiro.mount(view,c);else painelPixManual(view,c,true);
  const cfg=view.querySelector('[data-qf-manual-config]');if(cfg)view.prepend(cfg);
 };
 g.QFComissao13.enhance=enhance;
 g.Screens.afterRender=function(){if(anterior)anterior.apply(this,arguments);enhance.apply(this,arguments);};
 const path=(g.location.hash||'').replace(/^#/,'');let pattern=path,params={};const match=path.match(/^\/profissional\/(pedido|chamada|chat)\/([^/]+)$/);if(match){pattern='/profissional/'+match[1]+'/:id';params.id=match[2];}
 const content=document.getElementById('app-content'),sess=g.DB&&g.DB.getSession&&g.DB.getSession();
 // O banco local do painel não contém o cadastro profissional do aplicativo.
 let user=null;if(!path.startsWith('/admin/')&&sess&&g.DB?.profissionalById){try{user=g.DB.profissionalById(sess.userId);}catch(_){}}
 if(content)enhance(pattern,content,params,user);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(typeof window!=='undefined'?window:globalThis);
