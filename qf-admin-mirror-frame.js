/* Recebe somente o pedido autorizado pelo painel; não recebe tokens nem sessão. */
(function(g){'use strict';if(g.parent===g)return;
 const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};g.document.addEventListener('click',stop,true);g.document.addEventListener('submit',stop,true);
 g.addEventListener('message',e=>{if(e.source!==g.parent||e.origin!==g.location.origin||e.data?.type!=='qf-admin-espelho')return;
  const d=e.data.data,p=d.pedido,DB=g.DB,S=g.Screens;if(!DB||!S||!g.QFRequestFromCloud)return;
  const req=g.QFRequestFromCloud(p,p.profissional_id||null);req.atendimentoTipo=p.atendimento_tipo;req.participantes=d.desbloqueios.filter(x=>x.ativo!==false).length;
  const pros=(d.conversas||[]).map(x=>({id:x.profissional_id,nome:x.profissional_nome,telefone:x.profissional_whatsapp||x.profissional_telefone,fotoUrl:x.profissional_foto_url,verificado:x.profissional_verificado,cidadeNome:x.profissional_cidade,uf:x.profissional_uf,avaliacaoMedia:Number(x.profissional_avaliacao||0),totalAvaliacoes:x.profissional_total_avaliacoes||0}));
  req.orcamentos=(d.orcamentos||[]).map(g.QFQuoteFromCloud);const accepted=req.orcamentos.find(x=>x.status==='aprovado'),latest=accepted||req.orcamentos.find(x=>x.status==='pendente');if(latest){req.orcamento=latest;req.taxaVisita=latest.taxaVisita||0;if(accepted)req.profissionalId=accepted.profissionalId;else if(req.status===DB.STATUS.AGUARDANDO_ORCAMENTO)req.status=DB.STATUS.ORCAMENTO_ENVIADO;}
  const review=(d.avaliacoes||[]).find(x=>x.autor_tipo!=='profissional');if(review){req.avaliacaoCliente={nota:review.nota,comentario:review.comentario};if(req.status===DB.STATUS.SERVICO_CONCLUIDO)req.status=DB.STATUS.FINALIZADO;}
  DB.state.requests=[req];DB.state.users.profissionais=pros;DB.state.users.clientes=[{id:p.cliente_id,nome:p.cliente.nome}];
  const shell=document.getElementById('app-shell');shell.innerHTML='<main style="padding:16px;overflow-wrap:anywhere" data-espelho-leitura>'+S.clientePedidoDetalheRender({id:p.id},{id:p.cliente_id})+'</main>';
  const slot=shell.querySelector('[data-qf-client-conversations]');if(slot&&g.QFConversationCards)slot.innerHTML=g.QFConversationCards(d.conversas||[],req);
  shell.querySelectorAll('button,input,select,textarea').forEach(x=>x.disabled=true);shell.querySelectorAll('a').forEach(x=>x.removeAttribute('href'));
  const reach=shell.querySelector('[data-call-reach-copy]');if(reach&&req.participantes)reach.textContent=req.participantes+' profissionais desbloquearam seu pedido';
  shell.querySelectorAll('.view').forEach(x=>{x.style.opacity='1';x.style.transform='none';});
 });
})(window);
