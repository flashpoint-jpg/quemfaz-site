-- V11.82: na central de pedidos do admin, urgente que espera o Pix fica separado ("aguardando_pix")
-- e não entra em ativos/aguardando/negociação.
do $mig$
declare d text := pg_get_functiondef('private.qf_admin_central_pedidos'::regproc);
begin
  d := replace(d, $q$not in ('concluido','cancelado','expirado')$q$, $q$not in ('concluido','cancelado','expirado','aguardando_pagamento')$q$);
  d := replace(d, $q$or (p_filtro='encerrados'$q$, $q$or (p_filtro='aguardando_pix' and b.status='aguardando_pagamento')
        or (p_filtro='encerrados'$q$);
  d := replace(d, $q$'encerrados',count(*) filter$q$, $q$'aguardando_pix',count(*) filter(where status='aguardando_pagamento'),
      'encerrados',count(*) filter$q$);
  execute d;
end $mig$;
