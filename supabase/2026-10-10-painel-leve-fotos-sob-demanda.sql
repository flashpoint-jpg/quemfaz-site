-- V11.70: painel leve. O carregamento geral (qf_admin_snapshot) tinha 7,7 MB, dos quais 7,2 MB eram as selfies
-- em texto. Em conexão fraca estourava o tempo: "Não foi possível carregar o painel".
-- 1) As selfies passam a ser buscadas só quando aparecem na tela (public.qf_admin_fotos, só admin, até 30 por vez).
create or replace function public.qf_admin_fotos(p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  return jsonb_build_object('ok', true, 'fotos', coalesce((
    select jsonb_object_agg(p.id::text, p.foto_url)
    from public.qf_profiles p
    where p.id = any(p_ids[1:30]) and coalesce(p.foto_url, '') <> ''), '{}'::jsonb));
end;
$$;
revoke all on function public.qf_admin_fotos(uuid[]) from public, anon;
grant execute on function public.qf_admin_fotos(uuid[]) to authenticated;

-- 2) O carregamento geral deixa de levar a foto (continua levando "tem_foto").
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qf_admin_snapshot';
  if position('to_jsonb(p) - ''foto_url''' in d) = 0 then
    d := replace(d, 'to_jsonb(p) || jsonb_build_object(''tem_foto''', '(to_jsonb(p) - ''foto_url'') || jsonb_build_object(''tem_foto''');
    execute d;
  end if;
end $$;
