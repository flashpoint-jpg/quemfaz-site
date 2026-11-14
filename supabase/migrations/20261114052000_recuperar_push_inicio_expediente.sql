-- Aceita chegada do agendador e breve indisponibilidade no início do turno.
-- Mantém seleção por categoria/raio, inscrições ativas, deduplicação por
-- chamado/profissional e limite de 500 tentativas por execução.
do $patch$
declare v_atual text;
begin
  v_atual := pg_get_functiondef('private.qf_avisar_inicio_expediente(boolean)'::regprocedure);
  if strpos(v_atual, ') < 180') = 0 then
    raise exception 'A função do início do expediente mudou; revisão necessária';
  end if;
  -- A janela anterior de 3 minutos passava para 15 minutos.
  execute replace(v_atual, ') < 180', ') < 900');
end;
$patch$;
