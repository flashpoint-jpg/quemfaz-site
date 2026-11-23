create or replace function public.qf_pre_orcamento_regional(
  p_categoria text, p_cidade text, p_uf text
)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with fechados as (
    select distinct on (c.id) c.cliente_id, f.profissional_id, f.valor_aceito_centavos as valor
    from public.qf_chamados c
    join public.qf_comissao13_fechamentos f on f.chamado_id = c.id
    where c.categoria = p_categoria
      and lower(c.cidade) = lower(btrim(p_cidade))
      and c.uf = upper(btrim(p_uf))
      and c.status in ('concluido', 'finalizado')
      and f.cliente_concluiu_em >= now() - interval '180 days'
      and f.valor_aceito_centavos > 0
    order by c.id, f.cliente_concluiu_em desc, f.id
  ), faixa as (
    select
      percentile_cont(0.25) within group (order by valor) as minimo,
      percentile_cont(0.75) within group (order by valor) as maximo
    from fechados
    having count(distinct cliente_id) >= 8 and count(distinct profissional_id) >= 3
  )
  select jsonb_build_object(
    'minimo_centavos', greatest(1000, floor(minimo / 1000) * 1000),
    'maximo_centavos', greatest(2000, ceil(maximo / 1000) * 1000, (floor(minimo / 1000) + 1) * 1000)
  ) from faixa;
$$;

revoke all on function public.qf_pre_orcamento_regional(text, text, text) from public;
grant execute on function public.qf_pre_orcamento_regional(text, text, text) to anon, authenticated;
