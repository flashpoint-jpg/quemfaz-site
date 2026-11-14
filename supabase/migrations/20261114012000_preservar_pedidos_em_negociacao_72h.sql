-- Evita classificar automaticamente como cancelados pedidos com investimento
-- de profissionais ou negociação em andamento. Não altera valores nem Pix.
-- Um desbloqueio indica contato, não prova contratação: o desfecho continua
-- pendente até ser informado por uma das partes.
create or replace function private.qf_pedido_expiravel_72h(c public.qf_chamados)
returns boolean language sql stable security invoker set search_path = ''
as $function$
  select coalesce(
    c.status = 'aberto'
    and c.atendimento_tipo is distinct from 'garante'
    and c.criado_em <= now() - interval '72 hours'
    and c.desfecho is null
    and (c.data_preferida is null or
         (c.data_preferida at time zone 'America/Sao_Paulo')::date <
         (now() at time zone 'America/Sao_Paulo')::date)
    and not exists (
      select 1 from public.qf_desbloqueios d where d.chamado_id = c.id
    )
    and not exists (
      select 1 from public.qf_orcamentos o
      where o.chamado_id = c.id and o.status = 'aceito'
    )
    and not exists (
      select 1 from public.qf_comissao13_fechamentos f
      where f.chamado_id = c.id
        and (f.confirmado_em is not null or f.codigo_validado_em is not null)
    )
    and not exists (
      select 1 from public.qf_comissao13_acordos a
      where a.chamado_id = c.id and a.contratado_em is not null
    ), false);
$function$;

revoke all on function private.qf_pedido_expiravel_72h(public.qf_chamados)
  from public, anon, authenticated;
grant execute on function private.qf_pedido_expiravel_72h(public.qf_chamados)
  to service_role;
