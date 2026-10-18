-- Issue #92 — orçamento aproximado + desbloqueio normal/exclusivo (4x). Falha de assert interrompe a execução.
-- Ordem: fixtures/valor-definido-schema.sql -> 2026-10-14-desbloqueio-exclusivo.sql -> 2026-10-18-pedidos-valor-definido-qr.sql
--        -> 2026-10-18-orcamento-aproximado-exclusivo-4x.sql -> este arquivo.
create or replace function public.t_uid(n integer) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function public.t_as(n integer) returns void language sql as $$ select set_config('request.jwt.claim.sub', public.t_uid(n)::text, false) $$;
create or replace function public.t_admin(b boolean) returns void language sql as $$ select set_config('test.admin', case when b then 'true' else 'false' end, false) $$;

insert into public.qf_profiles (id, tipo, nome, foto_url) values
  (public.t_uid(1), 'cliente', 'Cliente A', null), (public.t_uid(2), 'cliente', 'Cliente B', null),
  (public.t_uid(11), 'profissional', 'P1', 'https://x/1.jpg'), (public.t_uid(12), 'profissional', 'P2', 'https://x/2.jpg'),
  (public.t_uid(13), 'profissional', 'P3', 'https://x/3.jpg'), (public.t_uid(14), 'profissional', 'P4', 'https://x/4.jpg'),
  (public.t_uid(15), 'profissional', 'P5', 'https://x/5.jpg'), (public.t_uid(16), 'profissional', 'Sem saldo', 'https://x/6.jpg');
insert into public.qf_profissionais (user_id, especialidades, raio_km, latitude, longitude)
  select public.t_uid(n), array['pintor'], 20, -23.55, -46.63 from generate_series(11, 16) n;
insert into public.qf_carteiras (profissional_id, saldo_centavos, bonus_inicial_usado)
  select public.t_uid(n), 100000, true from generate_series(11, 15) n;
insert into public.qf_carteiras (profissional_id, saldo_centavos, bonus_inicial_usado) values (public.t_uid(16), 1000, true);
insert into public.qf_precos_desbloqueio (categoria, preco_centavos) values ('padrao', 790), ('pintor', 1000);

-- 1) Configuração: exclusivo = exatamente 4x; não existe mais percentual de taxa.
do $$ begin
  assert (public.qf_exclusivo_info()->>'multiplicador')::numeric = 4, 'multiplicador do exclusivo = 4';
  assert not (private.qf_valor_cfg() ? 'percentual_bps'), 'config sem percentual';
  assert not (public.qf_pedidos_valor_config() ? 'percentual_bps'), 'config pública sem percentual';
  assert to_regprocedure('public.qf_taxa_indicacao_centavos(text,integer)') is null, 'função de taxa percentual removida';
  assert to_regprocedure('public.qf_valor_info_chamados(uuid[])') is null, 'info com taxa removida';
end $$;

-- 2) Cliente publica com orçamento aproximado (pedido gratuito); sem orçamento continua válido (pedido antigo).
do $$ declare a uuid; b uuid; begin
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, orcamento_aproximado_centavos, max_orcamentos, latitude, longitude)
  values ('00000000-0000-4000-8000-0000000000a1', public.t_uid(1), 'pintor', 'pintar sala', 150000, 4, -23.55, -46.63);
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, max_orcamentos, latitude, longitude)
  values ('00000000-0000-4000-8000-0000000000a2', public.t_uid(1), 'pintor', 'pedido antigo sem orçamento', 4, -23.55, -46.63);
  assert (select orcamento_aproximado_centavos from public.qf_chamados where id = '00000000-0000-4000-8000-0000000000a1') = 150000, 'orçamento salvo';
  begin
    insert into public.qf_chamados (cliente_id, categoria, descricao, orcamento_aproximado_centavos) values (public.t_uid(1), 'pintor', 'x', 5);
    raise exception 'deveria recusar';
  exception when check_violation then null; end;
  begin
    insert into public.qf_chamados (cliente_id, categoria, descricao, orcamento_aproximado_centavos) values (public.t_uid(1), 'pintor', 'x', 999999999);
    raise exception 'deveria recusar';
  exception when check_violation then null; end;
end $$;

-- 3) Profissional vê o orçamento ANTES de pagar; quem não é profissional nem dono não vê.
do $$ begin
  perform public.t_as(11);
  assert (select count(*) from public.qf_orcamento_info_chamados(array['00000000-0000-4000-8000-0000000000a1'::uuid])) = 1, 'pro vê o orçamento';
  assert (select orcamento_aproximado_centavos from public.qf_orcamento_info_chamados(array['00000000-0000-4000-8000-0000000000a1'::uuid])) = 150000, 'valor correto';
  assert (select count(*) from public.qf_orcamento_info_chamados(array['00000000-0000-4000-8000-0000000000a2'::uuid])) = 0, 'sem orçamento: nada';
  perform public.t_as(1);
  assert (select count(*) from public.qf_orcamento_info_chamados(array['00000000-0000-4000-8000-0000000000a1'::uuid])) = 1, 'dono vê';
  perform public.t_as(2);
  assert (select count(*) from public.qf_orcamento_info_chamados(array['00000000-0000-4000-8000-0000000000a1'::uuid])) = 0, 'outro cliente não vê';
end $$;

-- 4) "Valor definido" (6%, 1 profissional) não pode mais ser criado nem cobrado.
do $$ declare r jsonb; begin
  begin
    insert into public.qf_chamados (cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, valor_confirmado_em)
    values (public.t_uid(1), 'pintor', 'x', 'valor_definido', 150000, true, now());
    raise exception 'deveria recusar';
  exception when others then assert sqlerrm = 'modalidade_descontinuada', 'valor_definido recusado: ' || sqlerrm; end;
  perform public.t_as(11);
  r := public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000a1');
  assert r->>'reason' = 'modalidade_descontinuada' and (r->>'ok')::boolean = false, 'RPC antiga não cobra';
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(11)) = 100000, 'nada debitado';
end $$;

-- 5) Desbloqueio normal: preço vigente da categoria (R$ 10,00), até 4 profissionais.
do $$ declare r jsonb; i integer; begin
  for i in 11..14 loop
    perform public.t_as(i);
    r := public.qf_desbloquear_chamado('00000000-0000-4000-8000-0000000000a1');
    assert (r->>'ok')::boolean and (r->>'preco_centavos')::int = 1000 and not (r->>'exclusivo')::boolean, 'normal ' || i || ': ' || r::text;
    assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(i)) = 99000, 'débito exato do normal';
  end loop;
  perform public.t_as(15);
  r := public.qf_desbloquear_chamado('00000000-0000-4000-8000-0000000000a1');
  assert r->>'reason' = 'reservado', 'quinto profissional não entra: ' || r::text;
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(15)) = 100000, 'quinto não paga';
  -- repetir não cobra de novo
  perform public.t_as(11);
  r := public.qf_desbloquear_chamado('00000000-0000-4000-8000-0000000000a1');
  assert (r->>'already_unlocked')::boolean, 'repetição devolve já desbloqueado';
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(11)) = 99000, 'sem cobrança duplicada';
  assert (select count(*) from public.qf_movimentacoes_carteira where profissional_id = public.t_uid(11) and tipo = 'debito') = 1, 'um único débito';
end $$;

-- 6) Exclusivo: exatamente 4x (R$ 40,00), libera o contato, fecha o pedido para os demais.
do $$ declare r jsonb; begin
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, orcamento_aproximado_centavos, max_orcamentos, latitude, longitude)
  values ('00000000-0000-4000-8000-0000000000b1', public.t_uid(1), 'pintor', 'exclusivo', 80000, 4, -23.55, -46.63);
  perform public.t_as(11);
  r := public.qf_desbloquear_chamado('00000000-0000-4000-8000-0000000000b1', true);
  assert (r->>'ok')::boolean and (r->>'exclusivo')::boolean and (r->>'preco_centavos')::int = 4000, 'exclusivo = 4x: ' || r::text;
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(11)) = 99000 - 4000, 'débito exato 4x';
  assert (select exclusivo from public.qf_desbloqueios where chamado_id = '00000000-0000-4000-8000-0000000000b1') , 'marcado exclusivo';
  perform public.t_as(12);
  r := public.qf_desbloquear_chamado('00000000-0000-4000-8000-0000000000b1');
  assert r->>'reason' = 'reservado', 'normal bloqueado após exclusivo: ' || r::text;
  r := public.qf_desbloquear_chamado('00000000-0000-4000-8000-0000000000b1', true);
  assert (r->>'ok')::boolean = false, 'segundo exclusivo bloqueado: ' || r::text;
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(12)) = 99000, 'concorrente não paga';
  assert (select count(*) from public.qf_desbloqueios where chamado_id = '00000000-0000-4000-8000-0000000000b1' and coalesce(ativo, true)) = 1, 'só 1 desbloqueio';
end $$;

-- 7) Exclusivo some depois do primeiro desbloqueio normal.
do $$ declare r jsonb; begin
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, max_orcamentos, latitude, longitude)
  values ('00000000-0000-4000-8000-0000000000c1', public.t_uid(1), 'pintor', 'dividido', 4, -23.55, -46.63);
  perform public.t_as(13);
  assert (public.qf_desbloquear_chamado('00000000-0000-4000-8000-0000000000c1')->>'ok')::boolean, 'normal ok';
  perform public.t_as(14);
  r := public.qf_desbloquear_chamado('00000000-0000-4000-8000-0000000000c1', true);
  assert r->>'reason' = 'exclusivo_indisponivel' and (r->>'ok')::boolean = false, 'exclusivo indisponível: ' || r::text;
end $$;

-- 8) Saldo insuficiente impede (normal e exclusivo) sem debitar nem desbloquear.
do $$ declare r jsonb; begin
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, max_orcamentos, latitude, longitude)
  values ('00000000-0000-4000-8000-0000000000d1', public.t_uid(1), 'pintor', 'sem saldo', 4, -23.55, -46.63);
  perform public.t_as(16);
  r := public.qf_desbloquear_chamado('00000000-0000-4000-8000-0000000000d1', true);
  assert r->>'reason' = 'saldo_insuficiente' and (r->>'preco_centavos')::int = 4000, 'exclusivo sem saldo: ' || r::text;
  r := public.qf_desbloquear_chamado('00000000-0000-4000-8000-0000000000d1');
  assert (r->>'ok')::boolean, 'normal R$10 com saldo R$10 passa (saldo 1000)';
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(16)) = 0, 'saldo zerado';
  assert (select count(*) from public.qf_desbloqueios where chamado_id = '00000000-0000-4000-8000-0000000000d1') = 1, 'só o normal';
end $$;

-- 9) Preço vigente muda: exclusivo acompanha (4x do novo preço).
do $$ declare r jsonb; begin
  update public.qf_precos_desbloqueio set preco_centavos = 1250 where categoria = 'pintor';
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, max_orcamentos, latitude, longitude)
  values ('00000000-0000-4000-8000-0000000000e1', public.t_uid(1), 'pintor', 'novo preço', 4, -23.55, -46.63);
  perform public.t_as(15);
  r := public.qf_desbloquear_chamado('00000000-0000-4000-8000-0000000000e1', true);
  assert (r->>'preco_centavos')::int = 5000, 'exclusivo = 4x do preço vigente: ' || r::text;
end $$;

select 'ORCAMENTO + EXCLUSIVO: TODOS OS TESTES PASSARAM' as resultado;
