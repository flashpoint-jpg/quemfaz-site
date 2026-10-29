do $migration$
declare source text;
begin
 select pg_get_functiondef(oid) into source from pg_proc
 where pronamespace='private'::regnamespace and proname='qf_livre_status_beneficio';
 if position('duracao_dias' in source)=0 then
  source:=replace(source,'''tipo_acesso'',b.tipo','''tipo_acesso'',b.tipo,''duracao_dias'',b.dias,''inicio_em'',b.inicio_em');
  execute source;
 end if;
end $migration$;
