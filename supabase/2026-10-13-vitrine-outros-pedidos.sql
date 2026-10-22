-- Quem Faz: vitrine de outras profissoes, so leitura e sem push.
-- Nenhum contato, endereco completo, coordenada exata ou dados financeiros.
create or replace function public.qf_outros_pedidos_vitrine()
returns table (
  id uuid,
  categoria text,
  titulo text,
  cidade text,
  uf character(2),
  bairro text,
  criado_em timestamptz,
  data_preferida timestamptz,
  prioridade boolean,
  participantes integer,
  limite integer,
  vagas integer
)
language sql
stable
security definer
set search_path = ''
as $func$
  select
    c.id,
    c.categoria,
    c.titulo,
    c.cidade,
    c.uf,
    c.bairro,
    c.criado_em,
    c.data_preferida,
    coalesce(c.prioridade,false),
    d.ocupadas,
    public.qf_limite_orcamentos(c.id),
    greatest(0,public.qf_limite_orcamentos(c.id)-d.ocupadas)
  from public.qf_profissionais pr
  join public.qf_profiles pf on pf.id=pr.user_id and coalesce(pf.ativo,true)
  join public.qf_chamados c on true
  cross join lateral (
    select count(*)::integer as ocupadas
    from public.qf_desbloqueios dx
    where dx.chamado_id=c.id and coalesce(dx.ativo,true)
  ) d
  where pr.user_id = auth.uid()
    and c.cliente_id is distinct from pr.user_id
    and c.status in ('aberto','em_negociacao')
    and not (c.categoria = any(coalesce(pr.especialidades,array[]::text[])))
    and d.ocupadas < public.qf_limite_orcamentos(c.id)
    and not exists (
      select 1 from public.qf_orcamentos o
      where o.chamado_id=c.id and o.status='aceito'
    )
    and not exists (
      select 1 from public.qf_desbloqueios dx
      where dx.chamado_id=c.id and dx.profissional_id=pr.user_id
    )
    and private.qf_pendencia_finalizacao(pr.user_id,'profissional') is null
  order by c.criado_em desc
  limit 80
$func$;

revoke all on function public.qf_outros_pedidos_vitrine() from public,anon;
grant execute on function public.qf_outros_pedidos_vitrine() to authenticated,service_role;
comment on function public.qf_outros_pedidos_vitrine() is
'Vitrine read-only de pedidos ativos de outras categorias; sem push ou autorizacao para desbloquear.';