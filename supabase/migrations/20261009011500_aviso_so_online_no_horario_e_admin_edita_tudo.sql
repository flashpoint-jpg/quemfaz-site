-- QuemFaz 11.41.0
-- 1) Aviso de chamado novo: só para quem está ONLINE e DENTRO do horário de atendimento.
--    Offline não recebe. A ampliação da busca (15/30/60/100 km) nunca passa do raio
--    que o próprio profissional escolheu. Quem atende a cidade do pedido continua recebendo.
-- 2) Painel: o admin edita todas as opções do profissional (raio, horário, alerta,
--    online/offline, cidades de atendimento, descrição, nome fantasia).

create or replace function public.qf_chamado_destinatarios_alcance(p_chamado_id uuid, p_raio_km integer default 0)
returns table(user_id uuid, online boolean, distancia_regiao_km numeric)
language sql
stable security definer
set search_path to ''
as $function$
  with c as (
    select
      ch.id,ch.cliente_id,ch.categoria,ch.cidade,ch.uf,ch.status,
      g.latitude as centro_lat,g.longitude as centro_lng
    from public.qf_chamados ch
    left join lateral private.qf_chamado_centro(ch.id) g on true
    where ch.id=p_chamado_id
      and ch.status in ('aberto','em_negociacao')
      and not exists (
        select 1 from public.qf_orcamentos o
        where o.chamado_id=ch.id and o.status='aceito'
      )
      and (
        select count(*) from public.qf_desbloqueios dx
        where dx.chamado_id=ch.id and coalesce(dx.ativo,true)
      ) < 5
  ),
  candidatos as (
    select
      pr.user_id,
      pr.online,
      private.qf_pro_atende_cidade(pr.user_id,c.cidade,c.uf::text) as cidade_exata,
      -- Raio que o próprio profissional escolheu: é o teto da ampliação.
      greatest(1,coalesce(
        (select max(pc.raio_km) from public.qf_profissional_cidades pc where pc.profissional_id=pr.user_id),
        pr.raio_km,20)) as raio_proprio,
      case
        when c.centro_lat is not null and c.centro_lng is not null
         and pr.latitude is not null and pr.longitude is not null
        then public.qf_distancia_km(pr.latitude,pr.longitude,c.centro_lat,c.centro_lng)
        else (
          select min(public.qf_distancia_km(pc.latitude,pc.longitude,c.centro_lat,c.centro_lng))
          from public.qf_profissional_cidades pc
          where pc.profissional_id=pr.user_id
            and pc.latitude is not null and pc.longitude is not null
            and c.centro_lat is not null and c.centro_lng is not null
        )
      end as distancia_calc,
      exists (
        select 1 from public.qf_profissional_cidades pc
        where pc.profissional_id=pr.user_id
          and pc.latitude is not null and pc.longitude is not null
          and c.centro_lat is not null and c.centro_lng is not null
          and public.qf_distancia_km(pc.latitude,pc.longitude,c.centro_lat,c.centro_lng)
              <= least(greatest(1,coalesce(p_raio_km,0)),greatest(1,coalesce(pc.raio_km,pr.raio_km,20)))
      ) as cidade_proxima
    from c
    join public.qf_profissionais pr on true
    join public.qf_profiles pf on pf.id=pr.user_id
    where coalesce(pf.ativo,true)
      and pr.user_id<>c.cliente_id
      and c.categoria=any(coalesce(pr.especialidades,array[]::text[]))
      and private.qf_pendencia_finalizacao(pr.user_id,'profissional') is null
      -- Regra 11.41: offline não recebe; online só recebe dentro do horário de atendimento.
      and pr.online is true
      and private.qf_dentro_horario(pr.horario_inicio,pr.horario_fim)
      and not exists (
        select 1 from public.qf_desbloqueios d
        where d.chamado_id=c.id and d.profissional_id=pr.user_id
      )
  )
  select
    x.user_id,
    x.online,
    case when x.distancia_calc is null then null else round(x.distancia_calc,1) end
  from candidatos x
  where x.cidade_exata
     or (
       coalesce(p_raio_km,0)>0
       and (x.cidade_proxima
            or x.distancia_calc<=least(greatest(1,coalesce(p_raio_km,0)),x.raio_proprio))
     )
  order by x.cidade_exata desc,x.distancia_calc asc nulls last;
$function$;

revoke all on function public.qf_chamado_destinatarios_alcance(uuid,integer) from public, anon, authenticated;
grant execute on function public.qf_chamado_destinatarios_alcance(uuid,integer) to service_role;

create or replace function public.qf_admin_editar_usuario(p_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_raio integer;
  v_ini time;
  v_fim time;
  v_alerta text;
  v_online boolean;
begin
  if not private.qf_is_admin() then raise exception 'sem_permissao'; end if;
  update public.qf_profiles set
    nome = coalesce(nullif(trim(p_dados->>'nome'),''), nome),
    whatsapp = case when p_dados ? 'whatsapp' then trim(p_dados->>'whatsapp') else whatsapp end,
    telefone = case when p_dados ? 'whatsapp' then trim(p_dados->>'whatsapp') else telefone end,
    cidade = coalesce(nullif(trim(p_dados->>'cidade'),''), cidade),
    uf = coalesce(nullif(upper(trim(p_dados->>'uf')),''), uf),
    nome_fantasia = case when p_dados ? 'nome_fantasia' then nullif(trim(p_dados->>'nome_fantasia'),'') else nome_fantasia end,
    ativo = case when p_dados ? 'ativo' then (p_dados->>'ativo')::boolean else ativo end,
    atualizado_em = now()
  where id = p_id;
  if not found then raise exception 'Usuário não encontrado'; end if;

  if not exists (select 1 from public.qf_profissionais where user_id = p_id) then return; end if;

  if p_dados ? 'especialidades' then
    update public.qf_profissionais
      set especialidades = array(select jsonb_array_elements_text(p_dados->'especialidades'))
    where user_id = p_id;
  end if;

  if p_dados ? 'descricao' then
    update public.qf_profissionais
      set descricao = nullif(left(trim(p_dados->>'descricao'),1000),''), atualizado_em = now()
    where user_id = p_id;
  end if;

  if p_dados ? 'raio_km' then
    if coalesce(p_dados->>'raio_km','') !~ '^\d{1,3}$' then raise exception 'O raio precisa ser um número entre 1 e 300 km.'; end if;
    v_raio := (p_dados->>'raio_km')::integer;
    if v_raio < 1 or v_raio > 300 then raise exception 'O raio precisa ficar entre 1 e 300 km.'; end if;
    update public.qf_profissionais set raio_km = v_raio, atualizado_em = now() where user_id = p_id;
    update public.qf_profissional_cidades set raio_km = v_raio where profissional_id = p_id;
  end if;

  if (p_dados ? 'horario_inicio') or (p_dados ? 'horario_fim') then
    if (p_dados ? 'horario_inicio' and coalesce(p_dados->>'horario_inicio','') !~ '^([01]\d|2[0-3]):[0-5]\d')
       or (p_dados ? 'horario_fim' and coalesce(p_dados->>'horario_fim','') !~ '^([01]\d|2[0-3]):[0-5]\d') then
      raise exception 'Horário inválido. Use o formato 08:00.';
    end if;
    v_ini := left(p_dados->>'horario_inicio',5)::time;
    v_fim := left(p_dados->>'horario_fim',5)::time;
    update public.qf_profissionais
      set horario_inicio = coalesce(v_ini, horario_inicio),
          horario_fim = coalesce(v_fim, horario_fim),
          atualizado_em = now()
    where user_id = p_id;
  end if;

  if p_dados ? 'alerta_modo' then
    v_alerta := p_dados->>'alerta_modo';
    if v_alerta not in ('toque','vibrar') then raise exception 'Modo de alerta inválido.'; end if;
    update public.qf_profissionais set alerta_modo = v_alerta, atualizado_em = now() where user_id = p_id;
  end if;

  if p_dados ? 'cidades' and jsonb_typeof(p_dados->'cidades') = 'array' then
    if not exists (
      select 1 from jsonb_array_elements(p_dados->'cidades') e
      where trim(coalesce(e->>'cidade','')) <> '' and upper(trim(coalesce(e->>'uf',''))) ~ '^[A-Z]{2}$'
    ) then
      raise exception 'Informe pelo menos uma cidade de atendimento, no formato Cidade/UF.';
    end if;
    delete from public.qf_profissional_cidades pc
     where pc.profissional_id = p_id
       and not exists (
         select 1 from jsonb_array_elements(p_dados->'cidades') e
         where private.qf_norm_txt(e->>'cidade') = private.qf_norm_txt(pc.cidade)
           and upper(trim(coalesce(e->>'uf',''))) = upper(trim(pc.uf::text))
       );
    insert into public.qf_profissional_cidades(profissional_id, cidade, uf, raio_km)
    select distinct on (private.qf_norm_txt(e->>'cidade'), upper(trim(e->>'uf')))
           p_id, trim(e->>'cidade'), upper(trim(e->>'uf')),
           coalesce(v_raio, (select pr.raio_km from public.qf_profissionais pr where pr.user_id = p_id), 20)
    from jsonb_array_elements(p_dados->'cidades') e
    where trim(coalesce(e->>'cidade','')) <> ''
      and upper(trim(coalesce(e->>'uf',''))) ~ '^[A-Z]{2}$'
      and not exists (
        select 1 from public.qf_profissional_cidades x
        where x.profissional_id = p_id
          and private.qf_norm_txt(x.cidade) = private.qf_norm_txt(e->>'cidade')
          and upper(trim(x.uf::text)) = upper(trim(e->>'uf'))
      );
  elsif (p_dados ? 'cidade') then
    -- troca a cidade principal de atendimento
    update public.qf_profissional_cidades set cidade = trim(p_dados->>'cidade'), uf = upper(trim(p_dados->>'uf'))
     where ctid = (select ctid from public.qf_profissional_cidades where profissional_id = p_id order by ctid limit 1)
       and not exists (select 1 from public.qf_profissional_cidades x where x.profissional_id = p_id and x.cidade = trim(p_dados->>'cidade') and x.uf = upper(trim(p_dados->>'uf')));
  end if;

  if p_dados ? 'online' then
    v_online := (p_dados->>'online')::boolean;
    begin
      update public.qf_profissionais
        set online = v_online, offline_manual = not v_online, atualizado_em = now()
      where user_id = p_id and online is distinct from v_online;
    exception when others then
      if sqlerrm like '%selfie_required%' then
        raise exception 'Este profissional ainda não tem foto. Sem foto não dá para colocar online.';
      end if;
      raise;
    end;
  end if;
end $function$;

revoke all on function public.qf_admin_editar_usuario(uuid,jsonb) from public, anon;
grant execute on function public.qf_admin_editar_usuario(uuid,jsonb) to authenticated;
