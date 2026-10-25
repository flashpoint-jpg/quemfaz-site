-- 72 horas sem confirmacao: desbloqueio ou conversa nao prorrogam oferta.
-- Nao apaga pedidos nem interfere em contratacoes confirmadas, cobrancas ou Garante.
-- A rotina privada.qf_expirar_chamados() e o cron qf-expirar-chamados
-- ja existem; o novo predicado passa a valer para ambos imediatamente.
create or replace function private.qf_pedido_expiravel_72h(c public.qf_chamados)
returns boolean language sql stable security invoker set search_path = ''
as $function$
  select coalesce(
    c.status in ('aberto', 'em_negociacao')
    and c.atendimento_tipo is distinct from 'garante'
    and c.criado_em <= now() - interval '72 hours'
    and c.desfecho is distinct from 'fechado'
    -- Um desbloqueio, mesmo pago, nao equivale a servico contratado.
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

-- O cron ja roda a cada minuto. O UPDATE automatico altera somente
-- status para cancelado, preservando historico e gatilhos existentes.
