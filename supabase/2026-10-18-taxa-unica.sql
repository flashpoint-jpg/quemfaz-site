-- Taxa de indicação: além de % com teto, permite TAXA ÚNICA (valor fixo) por profissão. Idempotente.
alter table public.qf_taxas_indicacao add column if not exists modo text not null default 'percentual';
alter table public.qf_taxas_indicacao add column if not exists taxa_fixa_centavos integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'qf_taxas_indicacao_modo_chk') then
    alter table public.qf_taxas_indicacao add constraint qf_taxas_indicacao_modo_chk
      check (modo in ('percentual','fixa') and (modo = 'percentual' or (taxa_fixa_centavos is not null and taxa_fixa_centavos >= 0)));
  end if;
end $$;

create or replace function public.qf_taxa_indicacao_centavos(p_categoria text, p_valor_centavos integer)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare v_bps integer; v_teto integer; v_taxa bigint; v_modo text; v_fixa integer;
begin
  if p_valor_centavos is null or p_valor_centavos <= 0 then return 0; end if;
  select t.percentual_bps, t.teto_centavos, t.modo, t.taxa_fixa_centavos into v_bps, v_teto, v_modo, v_fixa
    from public.qf_taxas_indicacao t where t.categoria = p_categoria and t.ativo;
  if not found then
    select t.percentual_bps, t.teto_centavos, t.modo, t.taxa_fixa_centavos into v_bps, v_teto, v_modo, v_fixa
      from public.qf_taxas_indicacao t where t.categoria = 'padrao' and t.ativo;
  end if;
  if v_modo = 'fixa' then                                   -- taxa única: nunca maior que o próprio valor do serviço
    return least(greatest(coalesce(v_fixa, 0), 0), p_valor_centavos);
  end if;
  if v_bps is null then v_bps := (private.qf_valor_cfg()->>'percentual_bps')::integer; end if;
  v_taxa := (p_valor_centavos::bigint * v_bps + 5000) / 10000;
  if v_teto is not null then v_taxa := least(v_taxa, v_teto); end if;
  return greatest(v_taxa, 0)::integer;
end $$;
revoke all on function public.qf_taxa_indicacao_centavos(text, integer) from public, anon;
grant execute on function public.qf_taxa_indicacao_centavos(text, integer) to authenticated;

create or replace function public.qf_admin_taxas_indicacao()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'admin authentication required'; end if;
  return jsonb_build_object(
    'config', private.qf_valor_cfg(),
    'taxas', coalesce((select jsonb_agg(jsonb_build_object('categoria', t.categoria, 'percentual_bps', t.percentual_bps,
                'teto_centavos', t.teto_centavos, 'ativo', t.ativo, 'modo', t.modo, 'taxa_fixa_centavos', t.taxa_fixa_centavos)
                order by (t.categoria = 'padrao') desc, t.categoria) from public.qf_taxas_indicacao t), '[]'::jsonb));
end $$;
revoke all on function public.qf_admin_taxas_indicacao() from public, anon;
grant execute on function public.qf_admin_taxas_indicacao() to authenticated;

drop function if exists public.qf_admin_salvar_taxa_indicacao(text, integer, integer, boolean);
create or replace function public.qf_admin_salvar_taxa_indicacao(p_categoria text, p_percentual_bps integer, p_teto_centavos integer default null, p_ativo boolean default true, p_modo text default 'percentual', p_taxa_fixa_centavos integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'admin authentication required'; end if;
  if nullif(trim(coalesce(p_categoria, '')), '') is null then return jsonb_build_object('ok', false, 'reason', 'categoria_obrigatoria'); end if;
  if coalesce(p_modo, 'percentual') not in ('percentual','fixa') then return jsonb_build_object('ok', false, 'reason', 'modo_invalido'); end if;
  if p_percentual_bps is null or p_percentual_bps < 0 or p_percentual_bps > 5000 then return jsonb_build_object('ok', false, 'reason', 'percentual_invalido'); end if;
  if p_teto_centavos is not null and p_teto_centavos < 0 then return jsonb_build_object('ok', false, 'reason', 'teto_invalido'); end if;
  if p_modo = 'fixa' and (p_taxa_fixa_centavos is null or p_taxa_fixa_centavos < 0) then return jsonb_build_object('ok', false, 'reason', 'taxa_fixa_invalida'); end if;
  insert into public.qf_taxas_indicacao (categoria, percentual_bps, teto_centavos, ativo, modo, taxa_fixa_centavos, atualizado_em, atualizado_por)
  values (trim(p_categoria), p_percentual_bps, p_teto_centavos, coalesce(p_ativo, true), coalesce(p_modo, 'percentual'),
          case when p_modo = 'fixa' then p_taxa_fixa_centavos end, now(), auth.uid())
  on conflict (categoria) do update set percentual_bps = excluded.percentual_bps, teto_centavos = excluded.teto_centavos,
    ativo = excluded.ativo, modo = excluded.modo, taxa_fixa_centavos = excluded.taxa_fixa_centavos, atualizado_em = now(), atualizado_por = auth.uid();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.qf_admin_salvar_taxa_indicacao(text, integer, integer, boolean, text, integer) from public, anon;
grant execute on function public.qf_admin_salvar_taxa_indicacao(text, integer, integer, boolean, text, integer) to authenticated;
