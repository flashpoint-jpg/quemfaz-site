create table if not exists private.qf_admin_extensoes_plano (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  profissional_id uuid not null,
  registro_id uuid not null,
  validade_anterior timestamptz not null,
  validade_nova timestamptz not null,
  dias integer not null check (dias between 1 and 365),
  criado_em timestamptz not null default now()
);
alter table private.qf_admin_extensoes_plano enable row level security;
revoke all on private.qf_admin_extensoes_plano from public, anon, authenticated;

create or replace function public.qf_admin_planos_profissionais()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.qf_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.criado_em desc, x.registro_id) from (
      select pp.profissional_id, pp.plano, pp.chamados_total, pp.chamados_restantes,
             pp.valido_ate, pp.criado_em, pp.recarga_id, null::timestamptz as inicio_em, pp.id as registro_id
      from public.qf_planos_profissional pp
      union all
      select a.profissional_id, 'livre', null::integer, null::integer,
             a.fim_em, a.criado_em, a.recarga_id, a.inicio_em, a.id
      from public.qf_livre_assinaturas a
      join public.qf_recargas r on r.id = a.recarga_id and r.status = 'aprovado'
    ) x
  ), '[]'::jsonb);
end $$;
revoke all on function public.qf_admin_planos_profissionais() from public, anon;
grant execute on function public.qf_admin_planos_profissionais() to authenticated;

create or replace function private.qf_admin_estender_plano_profissional(
  p_profissional uuid, p_registro uuid, p_validade_anterior timestamptz, p_dias integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_agora timestamptz := now();
  v_validade timestamptz;
  v_proximo_inicio timestamptz;
begin
  if not private.qf_is_admin() or auth.uid() is null then
    raise exception 'Sem permissão para estender planos.' using errcode = '42501';
  end if;
  if p_profissional is null or p_registro is null or p_validade_anterior is null
    or p_dias is null or p_dias not between 1 and 365 then
    raise exception 'Informe de 1 a 365 dias adicionais e um plano válido.';
  end if;

  -- Mesmo bloqueio usado pela ativação do Livre, para preservar períodos já pagos.
  perform 1 from public.qf_profissionais where user_id = p_profissional for update;
  if not found then raise exception 'Profissional não encontrado.'; end if;

  v_validade := p_validade_anterior + make_interval(secs => 86400::double precision * p_dias);
  if exists (
    select 1 from public.qf_livre_assinaturas a
    where a.id = p_registro and a.profissional_id = p_profissional
  ) then
    select min(a.inicio_em) into v_proximo_inicio
    from public.qf_livre_assinaturas a
    join public.qf_recargas r on r.id = a.recarga_id and r.status = 'aprovado'
    where a.profissional_id = p_profissional and a.id <> p_registro and a.inicio_em >= p_validade_anterior;

    if v_proximo_inicio < v_validade then
      raise exception 'A extensão alcança outro período do Livre já agendado. Informe menos dias.';
    end if;

    update public.qf_livre_assinaturas a
    set fim_em = v_validade
    where a.id = p_registro and a.profissional_id = p_profissional
      and a.fim_em = p_validade_anterior and a.inicio_em <= v_agora and a.fim_em > v_agora
      and exists (select 1 from public.qf_recargas r where r.id = a.recarga_id and r.status = 'aprovado');
  else
    update public.qf_planos_profissional p
    set valido_ate = v_validade, atualizado_em = v_agora
    where p.id = p_registro and p.profissional_id = p_profissional
      and p.valido_ate = p_validade_anterior and p.valido_ate > v_agora and p.chamados_restantes > 0;
  end if;

  if not found then raise exception 'O plano venceu ou foi alterado. Atualize a ficha e confira a validade atual.'; end if;

  insert into private.qf_admin_extensoes_plano (
    admin_id, profissional_id, registro_id, validade_anterior, validade_nova, dias
  ) values (auth.uid(), p_profissional, p_registro, p_validade_anterior, v_validade, p_dias);
  return jsonb_build_object('valido_ate', v_validade);
end $$;

create or replace function public.qf_admin_estender_plano_profissional(
  p_profissional uuid, p_registro uuid, p_validade_anterior timestamptz, p_dias integer
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.qf_admin_estender_plano_profissional(p_profissional, p_registro, p_validade_anterior, p_dias);
$$;
revoke all on function private.qf_admin_estender_plano_profissional(uuid, uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.qf_admin_estender_plano_profissional(uuid, uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function private.qf_admin_estender_plano_profissional(uuid, uuid, timestamptz, integer) to authenticated;
grant execute on function public.qf_admin_estender_plano_profissional(uuid, uuid, timestamptz, integer) to authenticated;
