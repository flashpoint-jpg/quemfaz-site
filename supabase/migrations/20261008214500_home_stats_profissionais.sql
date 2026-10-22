-- Contador público da tela inicial: total de profissionais e cidades onde há cadastro.
-- Só totais. Não devolve nome, contato nem qualquer dado de profissional.
-- Cidades com menos de 3 profissionais saem sem número (n = null): a página mostra só o nome.
create or replace function public.qf_home_stats()
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with c as (
    select lower(btrim(cidade)) as chave, upper(btrim(uf)) as uf,
           max(btrim(cidade)) as cidade, count(distinct profissional_id) as n
    from public.qf_profissional_cidades
    where btrim(coalesce(cidade, '')) <> ''
    group by 1, 2
  )
  select json_build_object(
    'total', (select count(*) from public.qf_profissionais),
    'cidades', (select count(*) from c),
    'lista', coalesce((select json_agg(json_build_object('cidade', cidade, 'uf', uf, 'n', case when n >= 3 then n end) order by n desc, cidade) from c), '[]'::json)
  );
$$;
revoke all on function public.qf_home_stats() from public;
grant execute on function public.qf_home_stats() to anon, authenticated;
