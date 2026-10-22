-- Atendimento estrito: profissão e distância até o pedido dentro do raio do profissional.
-- Cidades cadastradas e escalonamento não ampliam o raio; sem coordenadas não há elegibilidade.
CREATE OR REPLACE FUNCTION private.qf_pro_atende_regiao(p_pro uuid, p_cidade text, p_uf text, p_lat numeric, p_lng numeric)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
select exists (
 select 1 from public.qf_profissionais pr
 left join lateral (
  select e.latitude,e.longitude from public.qf_enderecos e
  where e.user_id=pr.user_id and e.latitude is not null and e.longitude is not null
  order by e.atualizado_em desc nulls last limit 1
 ) en on true
 where pr.user_id=p_pro
 and p_lat is not null and p_lng is not null
 and public.qf_distancia_km(
  case when pr.latitude is not null and pr.longitude is not null then pr.latitude else en.latitude end,
  case when pr.latitude is not null and pr.longitude is not null then pr.longitude else en.longitude end,
  p_lat,p_lng) <= coalesce(pr.raio_km,20)
);
$function$;

CREATE OR REPLACE FUNCTION private.qf_pro_recebe_chamado(p_pro uuid,p_chamado_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
select exists (
 select 1 from public.qf_chamados c
 join public.qf_profissionais pr on pr.user_id=p_pro
 where c.id=p_chamado_id
 and c.categoria=any(coalesce(pr.especialidades,array[]::text[]))
 and private.qf_pro_atende_regiao(p_pro,c.cidade,c.uf::text,c.latitude,c.longitude)
);
$function$;

CREATE OR REPLACE FUNCTION public.qf_listar_chamados_disponiveis()
 RETURNS TABLE(id uuid, categoria text, titulo text, descricao text, cidade text, uf character, bairro text, endereco_completo text, latitude numeric, longitude numeric, data_preferida timestamp with time zone, prioridade boolean, criado_em timestamp with time zone, status text, distancia_km numeric, raio_atual_km integer, preco_centavos integer, tempo_min integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with profissional as (
 select pr.user_id,pr.especialidades,pr.online,pr.latitude pro_latitude,pr.longitude pro_longitude,
 coalesce(pr.raio_km,20)::integer raio_configurado_km
 from public.qf_profissionais pr
 where pr.user_id=auth.uid()
 and exists(select 1 from public.qf_profiles pf where pf.id=pr.user_id and coalesce(pf.ativo,true))
 and private.qf_pendencia_finalizacao(pr.user_id,'profissional') is null
)
select c.id,c.categoria,c.titulo,public.qf_ocultar_contato(c.descricao),c.cidade,c.uf,c.bairro,null::text,
round(g.latitude,2),round(g.longitude,2),c.data_preferida,c.prioridade,c.criado_em,'aberto'::text,
case when public.qf_distancia_km(p.pro_latitude,p.pro_longitude,g.latitude,g.longitude) is null then null else round(public.qf_distancia_km(p.pro_latitude,p.pro_longitude,g.latitude,g.longitude),1) end,
p.raio_configurado_km,coalesce(pd.preco_centavos,padrao.preco_centavos,790)::integer,
public.qf_tempo_estimado_min(public.qf_distancia_km(p.pro_latitude,p.pro_longitude,g.latitude,g.longitude))
from public.qf_chamados c cross join profissional p
left join lateral private.qf_chamado_centro(c.id) g on true
left join public.qf_precos_desbloqueio pd on pd.categoria=c.categoria and pd.ativo
left join public.qf_precos_desbloqueio padrao on padrao.categoria='padrao'
where c.status in ('aberto','em_negociacao')
and c.categoria = any(coalesce(p.especialidades,array[]::text[]))
and not exists(select 1 from public.qf_orcamentos o where o.chamado_id=c.id and o.status='aceito')
and (select count(*) from public.qf_desbloqueios dx where dx.chamado_id=c.id and coalesce(dx.ativo,true)) < public.qf_limite_orcamentos(c.id)
and (c.cliente_id is distinct from p.user_id and private.qf_pro_recebe_chamado(p.user_id,c.id))
and not exists(select 1 from public.qf_desbloqueios d where d.chamado_id=c.id and d.profissional_id=p.user_id)
order by c.prioridade desc,public.qf_distancia_km(p.pro_latitude,p.pro_longitude,g.latitude,g.longitude) asc nulls last,c.criado_em desc
$function$;

CREATE OR REPLACE FUNCTION public.qf_admin_chamados_sem_resposta()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  return jsonb_build_object('ok', true, 'itens', coalesce((
    select jsonb_agg(x order by x.criado_em desc) from (
      select c.id, c.titulo, c.categoria, c.cidade, c.uf, c.bairro, c.criado_em, k.etapa3_em,
             round(extract(epoch from (now() - c.criado_em)) / 60.0)::int as minutos,
             coalesce((
               select jsonb_agg(jsonb_build_object(
                        'user_id', pr.user_id,
                        'nome', pf.nome,
                        'whatsapp', coalesce(nullif(trim(pf.whatsapp), ''), nullif(trim(pf.telefone), '')),
                        'online', pr.online,
                        'avisado', exists (select 1 from public.qf_push_entregas e where e.chamado_id = c.id and e.user_id = pr.user_id and e.evento = 'new_call'),
                        'tem_push', exists (select 1 from public.qf_push_subscriptions s where s.user_id = pr.user_id and s.ativo)
                      ) order by pr.online desc, pf.nome)
               from public.qf_profissionais pr
               join public.qf_profiles pf on pf.id = pr.user_id
               where coalesce(pf.ativo, true)
                 and pr.user_id <> c.cliente_id
                 and c.categoria = any(coalesce(pr.especialidades,array[]::text[]))
                 and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = pr.user_id)
                 and private.qf_pro_atende_regiao(pr.user_id, c.cidade, c.uf::text, c.latitude, c.longitude)
             ), '[]'::jsonb) as profissionais
      from public.qf_chamado_cascata k
      join public.qf_chamados c on c.id = k.chamado_id
      where k.etapa = 3 and k.aceito_em is null
        and not k.oculto_admin
        and c.status = 'aberto'
        and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id)
        and c.criado_em >= now() - interval '3 days'
    ) x), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION private.qf_paineis_dados()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(x.j order by x.criado_em asc), '[]'::jsonb)
  from (
    select c.criado_em, jsonb_build_object(
      'id', c.id, 'titulo', c.titulo, 'categoria', c.categoria, 'descricao', c.descricao,
      'bairro', c.bairro, 'cidade', c.cidade, 'uf', c.uf, 'cep', c.cep,
      'latitude', c.latitude, 'longitude', c.longitude,
      'geo_precisao', coalesce(c.geo_precisao, case when c.latitude is null then 'sem' else 'cidade' end),
      'prazo', c.prazo, 'prazo_dia', c.prazo_dia, 'periodo', c.periodo,
      'status', c.status, 'criado_em', c.criado_em,
      'motivo', v.motivo,
      'limite', v.limite, 'ocupadas', v.ocupadas,
      'preco_centavos', coalesce(
        (select pd.preco_centavos from public.qf_precos_desbloqueio pd where pd.categoria = c.categoria and pd.ativo),
        (select pd.preco_centavos from public.qf_precos_desbloqueio pd where pd.categoria = 'padrao'), 790),
      'cliente', (select pf.nome from public.qf_profiles pf where pf.id = c.cliente_id),
      'cliente_telefone', (select coalesce(nullif(pf.whatsapp, ''), pf.telefone) from public.qf_profiles pf where pf.id = c.cliente_id),
      'cascata_etapa', (select k.etapa from public.qf_chamado_cascata k where k.chamado_id = c.id),
      'avisados', (select count(distinct e.user_id) from public.qf_push_entregas e where e.chamado_id = c.id),
      'avisados_com_push', (select count(distinct e.user_id) from public.qf_push_entregas e where e.chamado_id = c.id and e.com_push),
      'lembretes', (select count(*) from public.qf_lembretes_pedido l where l.chamado_id = c.id),
      'lembrete_em', (select max(l.enviado_em) from public.qf_lembretes_pedido l where l.chamado_id = c.id),
      'lembrete_alvo', (select l.alvo from public.qf_lembretes_pedido l where l.chamado_id = c.id order by l.enviado_em desc limit 1),
      'ultimo_desbloqueio_em', (select max(d.criado_em) from public.qf_desbloqueios d where d.chamado_id = c.id and coalesce(d.ativo, true)),
      'desbloqueios', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', d.profissional_id, 'nome', pf.nome,
                 'telefone', coalesce(nullif(pf.whatsapp, ''), pf.telefone),
                 'valor_centavos', d.valor_centavos, 'origem', d.origem, 'criado_em', d.criado_em, 'desfecho', d.desfecho,
                 'km', round(public.qf_distancia_km(c.latitude, c.longitude, pr.latitude, pr.longitude), 1)
               ) order by d.criado_em)
        from public.qf_desbloqueios d
        left join public.qf_profiles pf on pf.id = d.profissional_id
        left join public.qf_profissionais pr on pr.user_id = d.profissional_id
        where d.chamado_id = c.id and coalesce(d.ativo, true)), '[]'::jsonb),
      -- Quem está vendo este pedido na lista "Serviços disponíveis" agora.
      'no_painel', t.total, 'no_painel_online', t.online, 'com_local', t.com_local,
      'com_gps', t.com_gps, 'dentro_raio', t.dentro_raio, 'mais_perto_km', t.mais_perto_km, 'mais_perto_nome', t.mais_perto_nome
    ) as j
    from public.qf_chamados c
    cross join lateral (
      select private.qf_chamado_aberto_todos(c.id) as motivo,
             public.qf_limite_orcamentos(c.id) as limite,
             (select count(*) from public.qf_desbloqueios d where d.chamado_id = c.id and coalesce(d.ativo, true))::integer as ocupadas
      -- "offset 0" faz o banco calcular a situação do pedido UMA vez. Sem isso ele repetia
      -- qf_chamado_aberto_todos (que já passa por todos os profissionais) para cada profissional
      -- da lista abaixo, e a tela "Painéis" passava de 8 s e caía por tempo esgotado.
      offset 0
    ) v
    left join lateral (
      select count(*)::integer as total,
             (count(*) filter (where z.online))::integer as online,
             (count(*) filter (where z.km is not null))::integer as com_local,
             (count(*) filter (where z.km is not null and z.km <= z.raio_km))::integer as dentro_raio,
             -- "mais perto" só conta quem tem a localização do aparelho (a do endereço pode ser o centro da cidade).
             round(min(z.km) filter (where z.gps), 1) as mais_perto_km,
             (array_agg(z.nome order by z.km) filter (where z.gps and z.km is not null))[1] as mais_perto_nome,
             (count(*) filter (where z.gps))::integer as com_gps
      from (
        select pr.user_id, pf.nome, coalesce(pr.online, false) as online, coalesce(pr.raio_km, 20) as raio_km,
               (pr.latitude is not null and pr.longitude is not null) as gps,
               public.qf_distancia_km(c.latitude, c.longitude,
                 coalesce(pr.latitude, en.latitude), coalesce(pr.longitude, en.longitude)) as km
        from public.qf_profissionais pr
        join public.qf_profiles pf on pf.id = pr.user_id
        left join lateral (
          select e.latitude, e.longitude from public.qf_enderecos e
          where e.user_id = pr.user_id and e.latitude is not null and e.longitude is not null
          order by e.atualizado_em desc nulls last limit 1
        ) en on true
        where coalesce(pf.ativo, true)
          and pr.user_id is distinct from c.cliente_id
          and c.categoria = any(coalesce(pr.especialidades, array[]::text[]))
          and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = pr.user_id)
          and private.qf_pro_recebe_chamado(pr.user_id, c.id)
      ) z
    ) t on true
    where c.status in ('aberto', 'em_negociacao')
      and v.ocupadas < v.limite
      and not exists (select 1 from public.qf_orcamentos o where o.chamado_id = c.id and o.status = 'aceito')
  ) x;
$function$;

CREATE OR REPLACE FUNCTION public.qf_push_aberto_todos_destinatarios(p_chamado_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(array_agg(pr.user_id), array[]::uuid[])
    from public.qf_chamados c
    join public.qf_profissionais pr on c.categoria = any(coalesce(pr.especialidades, array[]::text[]))
    join public.qf_profiles pf on pf.id = pr.user_id and coalesce(pf.ativo, true)
   where c.id = p_chamado_id
     and private.qf_chamado_aberto_todos(c.id) is not null
     and private.qf_pro_recebe_chamado(pr.user_id,c.id)
     and pr.user_id is distinct from c.cliente_id
     and private.qf_pendencia_finalizacao(pr.user_id, 'profissional') is null
     and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = pr.user_id)
     and not exists (select 1 from public.qf_push_entregas e where e.chamado_id = c.id and e.user_id = pr.user_id
                       and e.evento in ('new_call', 'aberto_todos'));
$function$;

CREATE OR REPLACE FUNCTION private.qf_lembrete_destinatarios(p_chamado_id uuid)
 RETURNS TABLE(user_id uuid, com_aparelho boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select pr.user_id,
         exists (select 1 from public.qf_push_subscriptions s where s.user_id = pr.user_id and s.ativo) as com_aparelho
  from public.qf_chamados c
  join public.qf_profissionais pr
    on c.categoria = any(pr.especialidades)
  join public.qf_profiles pf on pf.id = pr.user_id
  left join lateral (
    select e.latitude, e.longitude from public.qf_enderecos e
    where e.user_id = pr.user_id and e.latitude is not null and e.longitude is not null
    order by e.atualizado_em desc nulls last limit 1
  ) en on true
  where c.id = p_chamado_id
    and c.status in ('aberto', 'em_negociacao')
    and not exists (select 1 from public.qf_chamado_cascata k where k.chamado_id = c.id and k.oculto_admin)
    and not exists (select 1 from public.qf_orcamentos o where o.chamado_id = c.id and o.status = 'aceito')
    and (select count(*) from public.qf_desbloqueios dx where dx.chamado_id = c.id and coalesce(dx.ativo, true))
        < public.qf_limite_orcamentos(c.id)
    and coalesce(pf.ativo, true)
    and pr.user_id <> c.cliente_id
    -- Regra 11.41: offline não recebe; online só dentro do horário de atendimento.
    and pr.online is true
    and private.qf_dentro_horario(pr.horario_inicio, pr.horario_fim)
    and private.qf_pendencia_finalizacao(pr.user_id, 'profissional') is null
    and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = pr.user_id)
    and private.qf_pro_recebe_chamado(pr.user_id,c.id);
$function$;
