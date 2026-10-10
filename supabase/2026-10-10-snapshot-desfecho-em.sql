-- QuemFaz V11.60 — aba Finalizados: o snapshot do painel passa a trazer quando cada profissional
-- informou o resultado do pedido (qf_desbloqueios.desfecho_em). Já aplicado no banco.
do $$
declare v_def text; v_novo text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='qf_admin_snapshot';
  if position('''desfecho_em'', d.desfecho_em' in v_def) > 0 then return; end if;
  v_novo := replace(v_def, '''desfecho'', d.desfecho,', '''desfecho'', d.desfecho,' || E'\n        ''desfecho_em'', d.desfecho_em,');
  if v_novo = v_def then raise exception 'trecho nao encontrado'; end if;
  execute v_novo;
end $$;
