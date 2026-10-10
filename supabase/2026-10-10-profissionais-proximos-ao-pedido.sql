-- V11.64: painel > "Próximos ao pedido" — para cada pedido recente, os profissionais do serviço pedido,
-- do mais perto para o mais longe, com a distância em km. Só leitura.
-- A localização do profissional é a do aparelho; se não tiver, a do endereço do cadastro.
create or replace function private.qf_proximos_ao_pedido_dados(p_pedidos integer default 12, p_por_pedido integer default 15)
returns jsonb
language sql
stable security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(x.j order by x.criado_em desc), '[]'::jsonb)
  from (
    select c.criado_em, jsonb_build_object(
      'id', c.id, 'titulo', c.titulo, 'categoria', c.categoria, 'bairro', c.bairro, 'cidade', c.cidade, 'uf', c.uf,
      'status', c.status, 'criado_em', c.criado_em,
      'cliente', (select pf.nome from public.qf_profiles pf where pf.id = c.cliente_id),
      'total', (select count(*) from public.qf_profissionais pr join public.qf_profiles pf on pf.id = pr.user_id
                where coalesce(pf.ativo, true) and pr.user_id <> c.cliente_id
                  and (cardinality(pr.especialidades) = 0 or c.categoria = any(pr.especialidades))),
      'profissionais', coalesce((
        select jsonb_agg(to_jsonb(t) order by t.km nulls last, t.nome)
        from (
          select pr.user_id as id, pf.nome, coalesce(nullif(pf.whatsapp, ''), pf.telefone) as telefone,
                 pf.cidade, pf.uf, pr.online, pr.verificado, pr.raio_km,
                 round(public.qf_distancia_km(c.latitude, c.longitude, g.lat, g.lon), 1) as km,
                 (pr.latitude is null and g.lat is not null) as pelo_endereco,
                 exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = pr.user_id and coalesce(d.ativo, true)) as desbloqueou,
                 exists (select 1 from public.qf_push_entregas e where e.chamado_id = c.id and e.user_id = pr.user_id) as avisado
          from public.qf_profissionais pr
          join public.qf_profiles pf on pf.id = pr.user_id
          left join lateral (
            select coalesce(pr.latitude, en.latitude) as lat, coalesce(pr.longitude, en.longitude) as lon
            from (select 1) um
            left join lateral (
              select e.latitude, e.longitude from public.qf_enderecos e
              where e.user_id = pr.user_id and e.latitude is not null and e.longitude is not null
              order by e.atualizado_em desc nulls last limit 1
            ) en on true
          ) g on true
          where coalesce(pf.ativo, true) and pr.user_id <> c.cliente_id
            and (cardinality(pr.especialidades) = 0 or c.categoria = any(pr.especialidades))
          order by public.qf_distancia_km(c.latitude, c.longitude, g.lat, g.lon) nulls last, pf.nome
          limit least(50, greatest(1, coalesce(p_por_pedido, 15)))
        ) t), '[]'::jsonb)
    ) as j
    from public.qf_chamados c
    order by c.criado_em desc
    limit least(40, greatest(1, coalesce(p_pedidos, 12)))
  ) x;
$$;
revoke all on function private.qf_proximos_ao_pedido_dados(integer, integer) from public, anon, authenticated;

create or replace function public.qf_admin_proximos_ao_pedido(p_pedidos integer default 12, p_por_pedido integer default 15)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  return jsonb_build_object('ok', true, 'pedidos', private.qf_proximos_ao_pedido_dados(p_pedidos, p_por_pedido));
end;
$$;
revoke all on function public.qf_admin_proximos_ao_pedido(integer, integer) from public, anon;
grant execute on function public.qf_admin_proximos_ao_pedido(integer, integer) to authenticated;
