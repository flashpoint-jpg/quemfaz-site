create function public.qf_admin_origem_fechamentos()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.qf_admins a where a.user_id = auth.uid()
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_object_agg(c.id, jsonb_build_object(
      'origem', evento.origem, 'nome', p.nome, 'em', evento.em
    ))
    from public.qf_chamados c
    cross join lateral (
      select candidato.origem, candidato.pessoa, candidato.em
      from (
        select 'cliente'::text as origem, co.respondida_por as pessoa, co.respondida_em as em
        from public.qf_conclusoes co
        where co.chamado_id = c.id and co.status = 'concluido'
          and co.respondida_por = c.cliente_id and co.respondida_em is not null

        union all
        select 'codigo_cliente', c.cliente_id, f.codigo_validado_em
        from public.qf_comissao13_fechamentos f
        where f.chamado_id = c.id and f.cliente_concluiu_em is not null and f.codigo_validado_em is not null

        union all
        select 'profissional', d.profissional_id, d.desfecho_em
        from public.qf_desbloqueios d
        where d.chamado_id = c.id and d.desfecho = 'fechado'
          and d.ativo is not false and d.desfecho_em = c.desfecho_em
          and not exists (
            select 1 from public.qf_conclusoes co
            where co.desbloqueio_id = d.id and co.status = 'concluido'
              and co.respondida_por = c.cliente_id and co.respondida_em = d.desfecho_em
          )
      ) candidato
      -- Um segundo aceite posterior não muda quem registrou a baixa original.
      order by candidato.em, case candidato.origem when 'cliente' then 0 when 'codigo_cliente' then 1 else 2 end,
        candidato.pessoa
      limit 1
    ) evento
    left join public.qf_profiles p on p.id = evento.pessoa
    where c.status <> 'cancelado'
      and (c.status in ('concluido','finalizado') or c.desfecho = 'fechado')
  ), '{}'::jsonb);
end;
$$;

revoke all on function public.qf_admin_origem_fechamentos() from public, anon;
grant execute on function public.qf_admin_origem_fechamentos() to authenticated;
