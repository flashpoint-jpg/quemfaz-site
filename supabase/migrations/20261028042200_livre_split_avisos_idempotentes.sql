-- Fila de avisos idempotentes por pagamento, separando Pix recebido e repasse creditado.
create table if not exists private.qf_livre_split_avisos(
 pagamento_id uuid not null references private.qf_livre_split_pagamentos(id),
 tipo text not null check(tipo in('pagamento_confirmado','repasse_confirmado')),
 criado_em timestamptz not null default now(),
 primary key(pagamento_id,tipo)
);
alter table private.qf_livre_split_avisos enable row level security;
revoke all on private.qf_livre_split_avisos from public,anon,authenticated;

create or replace function public.qf_livre_split_enfileirar_aviso(p_id uuid,p_creditado boolean)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare b private.qf_livre_split_pagamentos; v_tipo text; foi boolean;
begin
 select * into b from private.qf_livre_split_pagamentos where id=p_id;
 if not found or b.confirmado_em is null or b.end_to_end_id is null
   or b.status not in ('pago','repassado')
 then return jsonb_build_object('ok',false,'reason','pagamento_nao_confirmado');end if;
 if p_creditado and (b.status<>'repassado' or b.repassado_em is null)
 then return jsonb_build_object('ok',false,'reason','repasse_sem_comprovacao');end if;
 v_tipo:=case when p_creditado then 'repasse_confirmado' else 'pagamento_confirmado' end;
 insert into private.qf_livre_split_avisos(pagamento_id,tipo) values(b.id,v_tipo)
 on conflict do nothing returning true into foi;
 if foi is true then
  insert into public.qf_chat_mensagens(chamado_id,profissional_id,remetente_id,mensagem,tipo)
   select b.chamado_id,b.profissional_id,c.cliente_id,
   case when p_creditado
    then 'Quem Faz Livre: repasse bancário confirmado. Sua parte de 87% foi creditada na conta Efí vinculada. Consulte sua carteira.'
    else 'Quem Faz Livre: pagamento Pix do cliente confirmado. Aguardando confirmação bancária do repasse de 87%.'
   end,'sistema' from public.qf_chamados c where c.id=b.chamado_id;
  perform private.qf_push_interno('chat_message',b.chamado_id);
 end if;
 return jsonb_build_object('ok',true,'notificacao_criada',coalesce(foi,false));
end $$;
revoke all on function public.qf_livre_split_enfileirar_aviso(uuid,boolean) from public,anon,authenticated;
grant execute on function public.qf_livre_split_enfileirar_aviso(uuid,boolean) to service_role;
