create function public.qf_admin_plantao_profissionais()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resultado jsonb;
begin
  if not coalesce(private.qf_is_admin(), false) then
    raise exception 'Acesso restrito a administradores' using errcode = '42501';
  end if;

  with membros as materialized (
    select
      p.id, p.nome, p.cidade, p.uf, coalesce(p.ativo, false) as ativo,
      coalesce(d.inscrito_gratis, false) as inscrito_gratis,
      private.qf_plantao_plano_ativo(p.id) as plano_ativo,
      array(
        select unnest(pr.especialidades)
        intersect
        select unnest(private.qf_plantao_categorias())
        order by 1
      ) as categorias,
      coalesce(d.disponivel, false) as marcou_disponivel
    from public.qf_profissionais pr
    join public.qf_profiles p on p.id = pr.user_id and p.tipo = 'profissional'
    left join private.qf_plantao_profissionais d on d.profissional_id = p.id
    where coalesce(d.inscrito_gratis, false)
       or exists (
         select 1 from public.qf_planos_profissional a
         where a.profissional_id = p.id and a.plano = 'livre_24h' and a.valido_ate > now()
       )
  ), inscritos as (
    select id, nome, cidade, uf, ativo, inscrito_gratis, plano_ativo, categorias,
      ativo and marcou_disponivel and cardinality(categorias) > 0 as disponivel
    from membros
    where inscrito_gratis or plano_ativo
  )
  select coalesce(jsonb_agg(to_jsonb(inscritos) order by disponivel desc, nome, id), '[]'::jsonb)
    into resultado
    from inscritos;

  return resultado;
end;
$$;

revoke all on function public.qf_admin_plantao_profissionais() from public, anon, authenticated;
grant execute on function public.qf_admin_plantao_profissionais() to authenticated;
