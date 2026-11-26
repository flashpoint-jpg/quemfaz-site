-- As fotos continuam no pedido. O painel geral não usa esse campo.
do $migration$
declare
  v_definition text := pg_get_functiondef('public.qf_admin_snapshot()'::regprocedure);
  v_projection text;
  v_original constant text := 'to_jsonb(c) || jsonb_build_object(';
begin
  if strpos(v_definition, 'as chamado_sem_fotos) || jsonb_build_object(') > 0 then
    return;
  end if;

  if strpos(v_definition, v_original) = 0 then
    raise exception 'qf_admin_snapshot: projeção dos chamados não encontrada';
  end if;

  select string_agg(format('c.%I', attname), ', ' order by attnum)
    into v_projection
    from pg_attribute
   where attrelid = 'public.qf_chamados'::regclass
     and attnum > 0
     and not attisdropped
     and attname <> 'fotos';

  -- Projeta as colunas antes de converter a linha para JSON, evitando ler as fotos.
  execute replace(
    v_definition,
    v_original,
    format('(select to_jsonb(chamado_sem_fotos) from (select %s) as chamado_sem_fotos) || jsonb_build_object(', v_projection)
  );
end;
$migration$;
