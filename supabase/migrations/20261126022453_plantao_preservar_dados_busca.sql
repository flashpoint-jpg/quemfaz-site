-- Só o titular recebe os campos necessários para repetir a busca.
do $migration$
declare
  definicao text := pg_get_functiondef('public.qf_plantao_listar()'::regprocedure);
  ancora constant text := '''prazo_pix'',c.prazo_pix,';
begin
  if strpos(definicao, '''dados_busca''') > 0 then return; end if;
  if strpos(definicao, ancora) = 0 then
    raise exception 'qf_plantao_listar: ponto de inserção não encontrado';
  end if;
  execute replace(definicao, ancora, ancora || $campo$
    'dados_busca',case when c.cliente_id=auth.uid() and c.estado<>'confirmado'
      then jsonb_build_object('cep',c.cep,'endereco',c.endereco)
    end,$campo$);
end;
$migration$;
