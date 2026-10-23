-- Retira a vitrine geral também para aplicativos antigos, sem alterar histórico,
-- carteira ou a elegibilidade por profissão + raio da lista principal.
begin;
do $retirar_vitrine$
declare f regprocedure; definition text;
begin
  foreach f in array array['public.qf_outros_pedidos_vitrine()'::regprocedure,
                            'public.qf_outros_pedidos_vitrine_v2()'::regprocedure]
  loop
    definition := pg_get_functiondef(f);
    if strpos(definition, 'where false and pr.user_id = auth.uid()') = 0 then
      if strpos(definition, 'where pr.user_id = auth.uid()') = 0 then
        raise exception 'Definição da vitrine mudou: %', f;
      end if;
      execute replace(definition, 'where pr.user_id = auth.uid()', 'where false and pr.user_id = auth.uid()');
    end if;
  end loop;
end;
$retirar_vitrine$;
-- Não enviar novos avisos que convidam a consultar outras profissões.
create or replace function private.qf_outros_alertar(p_chamado_id uuid)
returns integer language sql security definer set search_path to '' as $$ select 0; $$;
revoke all on function private.qf_outros_alertar(uuid) from public, anon, authenticated;
commit;
