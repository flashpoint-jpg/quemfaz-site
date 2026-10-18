-- Antes da migration: comprova as duas falhas que ela corrige (rodar depois de fixtures/pagamentos-schema.sql).
create function public.t_uid(n integer) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
insert into public.qf_profissionais select public.t_uid(n) from generate_series(1, 9) n;
insert into public.qf_admins values (public.t_uid(900));
insert into public.qf_planos_catalogo values ('mensal', 'Mensal', 4990, 7, 30, true), ('pro', 'Pro', 9990, 15, 30, true);  -- sem 'premium' de propósito

do $$ declare r uuid; v bigint; begin
  -- FALHA 1: pagamento de plano que não está no catálogo entra como SALDO.
  insert into public.qf_recargas(id, profissional_id, valor_centavos, metodo, status, plano)
    values ('00000000-0000-4000-8000-0000000000a1', public.t_uid(1), 19990, 'pix', 'pendente', 'premium');
  update public.qf_recargas set status = 'aprovado' where id = '00000000-0000-4000-8000-0000000000a1';
  select saldo_centavos into v from public.qf_carteiras where profissional_id = public.t_uid(1);
  assert v = 19990, 'ANTES: plano fora do catálogo virava saldo (falha reproduzida)';

  -- FALHA 2: ajuste negativo do administrador sempre falhava.
  perform set_config('request.jwt.claim.sub', public.t_uid(900)::text, false);
  begin
    perform public.qf_admin_adicionar_creditos(public.t_uid(1), -500, 'teste');
    assert false, 'ajuste negativo deveria falhar na versão antiga';
  exception when check_violation then null; end;
end $$;

-- Limpa o caso de demonstração para os testes seguintes partirem de um banco sem pagamentos.
delete from public.qf_movimentacoes_carteira where referencia_id = '00000000-0000-4000-8000-0000000000a1';
delete from public.qf_recargas where id = '00000000-0000-4000-8000-0000000000a1';
update public.qf_carteiras set saldo_centavos = 0;
