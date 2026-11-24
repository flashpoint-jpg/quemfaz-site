-- A inscrição no plantão não gera recarga, créditos ou cota de pedidos comuns.
alter table private.qf_plantao_profissionais
  add column inscrito_gratis boolean not null default false;

create function private.qf_plantao_categorias()
returns text[] language sql immutable set search_path = '' as $$
  select array['cat_eletricista','cat_encanador','cat_guincho','cat_chaveiro']::text[];
$$;

create function private.qf_plantao_inscrever_no_cadastro()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- O metadado indica a escolha do titular durante o cadastro, sem conceder direitos financeiros.
  if cardinality(new.especialidades)>0
     and new.especialidades <@ private.qf_plantao_categorias()
     and exists (
       select 1 from auth.users where id=new.user_id
         and raw_user_meta_data->>'qf_plantao_gratis'='true'
     ) then
    insert into private.qf_plantao_profissionais(profissional_id,disponivel,inscrito_gratis)
    values(new.user_id,false,true)
    on conflict (profissional_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger qf_plantao_inscrever_no_cadastro after insert on public.qf_profissionais
for each row execute function private.qf_plantao_inscrever_no_cadastro();

create or replace function private.qf_plantao_elegivel(p_profissional uuid,p_categoria text,p_cidade text,p_uf text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_categoria=any(private.qf_plantao_categorias())
    and exists (
      select 1 from private.qf_plantao_profissionais d
      join public.qf_profissionais pr on pr.user_id=d.profissional_id
      join public.qf_profiles p on p.id=pr.user_id
      where d.profissional_id=p_profissional and d.disponivel
        and (d.inscrito_gratis or private.qf_plantao_plano_ativo(d.profissional_id))
        and p.ativo and p.tipo='profissional'
        and p_categoria=any(pr.especialidades)
        and (
          (upper(p.uf)=p_uf and lower(btrim(p.cidade))=lower(btrim(p_cidade)))
          or exists (
            select 1 from public.qf_profissional_cidades a
             where a.profissional_id=pr.user_id and upper(a.uf)=p_uf and lower(btrim(a.cidade))=lower(btrim(p_cidade))
          )
        )
    );
$$;

create or replace function public.qf_plantao_disponibilidade(p_disponivel boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid:=auth.uid();
  plano boolean;
  status private.qf_plantao_profissionais;
  categorias text[];
begin
  select array(select unnest(pr.especialidades) intersect select unnest(private.qf_plantao_categorias()))
    into categorias
    from public.qf_profissionais pr join public.qf_profiles p on p.id=pr.user_id
    where pr.user_id=u and p.ativo and p.tipo='profissional';
  if not found then raise exception 'Conta profissional ativa necessária'; end if;

  plano:=private.qf_plantao_plano_ativo(u);
  select * into status from private.qf_plantao_profissionais where profissional_id=u;
  if p_disponivel is not null then
    if p_disponivel and cardinality(categorias)=0 then
      raise exception 'Seu perfil precisa ter uma profissão atendida pelo plantão';
    end if;
    if p_disponivel and not (plano or coalesce(status.inscrito_gratis,false)) then
      raise exception 'Inscreva-se no Plantão 24h para ficar disponível';
    end if;
    insert into private.qf_plantao_profissionais(profissional_id,disponivel,atualizado_em)
    values(u,p_disponivel,now())
    on conflict (profissional_id) do update
      set disponivel=excluded.disponivel,atualizado_em=excluded.atualizado_em
    returning * into status;
  end if;

  return jsonb_build_object(
    'plano_ativo',plano,'inscrito_gratis',coalesce(status.inscrito_gratis,false),
    'categorias_elegiveis',categorias,
    'disponivel',coalesce(status.disponivel,false) and cardinality(categorias)>0
      and (plano or coalesce(status.inscrito_gratis,false)),
    'desbloqueios_restantes',(
      select coalesce(sum(chamados_restantes),0) from public.qf_planos_profissional a
      where a.profissional_id=u and a.plano='livre_24h' and a.valido_ate>now()
    )
  );
end;
$$;

create function public.qf_plantao_inscrever()
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid();
begin
  if not exists (
    select 1 from public.qf_profissionais pr join public.qf_profiles p on p.id=pr.user_id
    where pr.user_id=u and p.ativo and p.tipo='profissional'
      and pr.especialidades && private.qf_plantao_categorias()
  ) then
    raise exception 'Seu perfil precisa ter uma profissão atendida pelo plantão';
  end if;
  insert into private.qf_plantao_profissionais(profissional_id,disponivel,inscrito_gratis)
  values(u,false,true)
  on conflict (profissional_id) do update set inscrito_gratis=true;
end;
$$;

revoke all on function private.qf_plantao_categorias(), private.qf_plantao_inscrever_no_cadastro()
  from public, anon, authenticated;
revoke all on function public.qf_plantao_inscrever() from public, anon, authenticated;
grant execute on function public.qf_plantao_inscrever() to authenticated;
