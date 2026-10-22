-- QuemFaz V11.21.0 — desbloqueio sem devolução.
-- Regra do dono: desbloqueou, o crédito foi usado; não volta em nenhum caso.
-- 1) Chave em qf_config: devolucao_lead = {"ativo": false}. Para religar, trocar para true
--    e reativar o agendamento (select cron.alter_job(<jobid>, active := true)).
-- 2) qf_private.devolver_lead não devolve nada enquanto a chave estiver desligada
--    (vale para 48h, cancelamento/expiração do pedido e pedido manual).
-- 3) O agendamento qf-cancelar-sem-resposta-48h fica desativado: como a conversa agora
--    acontece no WhatsApp, o sistema não enxerga a resposta do cliente e cancelaria
--    pedidos em negociação. Pedidos parados continuam expirando em 3 dias.
insert into public.qf_config (chave, valor)
values ('devolucao_lead', '{"ativo": false}'::jsonb)
on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();

select cron.alter_job(jobid, active := false) from cron.job where jobname = 'qf-cancelar-sem-resposta-48h';

do $do$
declare v text;
begin
  v := pg_get_functiondef('qf_private.devolver_lead(uuid,text)'::regprocedure);
  if position('devolucao_lead' in v) = 0 then
    v := replace(v, E'v_preco integer;\nbegin\n',
      E'v_preco integer;\nbegin\n  -- V11.21: devolução desligada pela chave devolucao_lead em qf_config.\n  if not coalesce((select (c.valor->>''ativo'')::boolean from public.qf_config c where c.chave = ''devolucao_lead''), true) then return 0; end if;\n');
    if position('devolucao_lead' in v) = 0 then raise exception 'guarda nao aplicada em devolver_lead'; end if;
    execute v;
  end if;
end $do$;
