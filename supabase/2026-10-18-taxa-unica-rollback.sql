-- Volta ao cálculo só percentual (a migração 2026-10-18-pedidos-valor-definido-qr.sql redefine as funções originais).
update public.qf_taxas_indicacao set modo = 'percentual' where modo <> 'percentual';
drop function if exists public.qf_admin_salvar_taxa_indicacao(text, integer, integer, boolean, text, integer);
create or replace function public.qf_taxa_indicacao_centavos(p_categoria text, p_valor_centavos integer)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare v_bps integer; v_teto integer; v_taxa bigint;
begin
  if p_valor_centavos is null or p_valor_centavos <= 0 then return 0; end if;
  select t.percentual_bps, t.teto_centavos into v_bps, v_teto from public.qf_taxas_indicacao t where t.categoria = p_categoria and t.ativo;
  if not found then select t.percentual_bps, t.teto_centavos into v_bps, v_teto from public.qf_taxas_indicacao t where t.categoria = 'padrao' and t.ativo; end if;
  if v_bps is null then v_bps := (private.qf_valor_cfg()->>'percentual_bps')::integer; end if;
  v_taxa := (p_valor_centavos::bigint * v_bps + 5000) / 10000;
  if v_teto is not null then v_taxa := least(v_taxa, v_teto); end if;
  return greatest(v_taxa, 0)::integer;
end $$;
create or replace function public.qf_admin_salvar_taxa_indicacao(p_categoria text, p_percentual_bps integer, p_teto_centavos integer default null, p_ativo boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'admin authentication required'; end if;
  insert into public.qf_taxas_indicacao (categoria, percentual_bps, teto_centavos, ativo, atualizado_em, atualizado_por)
  values (trim(p_categoria), p_percentual_bps, p_teto_centavos, coalesce(p_ativo, true), now(), auth.uid())
  on conflict (categoria) do update set percentual_bps = excluded.percentual_bps, teto_centavos = excluded.teto_centavos, ativo = excluded.ativo, atualizado_em = now(), atualizado_por = auth.uid();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.qf_admin_salvar_taxa_indicacao(text, integer, integer, boolean) from public, anon;
grant execute on function public.qf_admin_salvar_taxa_indicacao(text, integer, integer, boolean) to authenticated;
