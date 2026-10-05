-- QuemFaz V11.27.2 — o painel passa a receber as recargas e planos pagos (status aprovado),
-- para somar "dinheiro que entrou" direto da tabela de pagamentos.
-- Só acrescenta uma chave ao retorno de qf_admin_snapshot(); o resto da função fica igual.
do $$
declare def text;
begin
  select pg_get_functiondef('public.qf_admin_snapshot()'::regprocedure) into def;
  if position('recargas_aprovadas' in def) = 0 then
    if position($a$'gerado_em', now(),$a$ in def) = 0 then
      raise exception 'qf_admin_snapshot mudou: ponto de inserção não encontrado';
    end if;
    def := replace(def, $a$'gerado_em', now(),$a$, $a$'gerado_em', now(),
    'recargas_aprovadas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'profissional_id', r.profissional_id,
        'valor_centavos', r.valor_centavos,
        'metodo', r.metodo,
        'plano', r.plano,
        'aprovado_em', coalesce(r.aprovado_em, r.atualizado_em, r.criado_em)
      ) order by coalesce(r.aprovado_em, r.atualizado_em, r.criado_em) desc)
      from public.qf_recargas r
      where r.status = 'aprovado'
    ), '[]'::jsonb),$a$);
    execute def;
  end if;
end $$;
