-- Recargas, planos e contabilidade — roda DEPOIS de aplicar a migration 20261018190000 (falha de assert interrompe).
-- Profissionais: 1 = recarga Pix; 2 = plano; 3 = plano fora do catálogo; 4 = falha de entrega; 5 = renovação; 6 = ajustes manuais.
create or replace function public.t_as(n integer) returns void language sql as $$ select set_config('request.jwt.claim.sub', public.t_uid(n)::text, false) $$;
create or replace function public.t_saldo(n integer) returns bigint language sql as $$ select coalesce((select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(n)), 0) $$;
create or replace function public.t_evento(ref uuid, ev text) returns bigint language sql as $$ select count(*) from public.qf_pagamento_eventos where referencia_id = ref and evento = ev $$;
insert into public.qf_planos_catalogo values ('mensal', 'Mensal', 4990, 7, 30, true), ('pro', 'Pro', 9990, 15, 30, true) on conflict do nothing;

-- 1) Recarga Pix: aprova, credita uma vez, lança bônus uma vez.
do $$ declare r uuid := '00000000-0000-4000-8000-0000000000b1'; begin
  insert into public.qf_recargas(id, profissional_id, valor_centavos, metodo, status, provedor, provedor_id)
    values (r, public.t_uid(11), 5000, 'pix', 'pendente', 'efi', 'TXID0000000000000000000000000001');
exception when foreign_key_violation then
  insert into public.qf_profissionais values (public.t_uid(11));
  insert into public.qf_recargas(id, profissional_id, valor_centavos, metodo, status, provedor, provedor_id)
    values (r, public.t_uid(11), 5000, 'pix', 'pendente', 'efi', 'TXID0000000000000000000000000001');
end $$;
do $$ declare r uuid := '00000000-0000-4000-8000-0000000000b1'; begin
  assert public.t_saldo(11) = 0, 'pendente não credita';
  update public.qf_recargas set status = 'aprovado' where id = r;
  assert public.t_saldo(11) = 5250, 'Pix aprovado credita o valor + bônus de 5%: ' || public.t_saldo(11);
  assert (select count(*) from public.qf_movimentacoes_carteira where referencia_id = r and tipo = 'credito') = 1, 'um crédito';
  assert (select count(*) from public.qf_movimentacoes_carteira where referencia_id = r and tipo = 'bonus') = 1, 'um bônus';
  assert (select aprovado_em from public.qf_recargas where id = r) is not null, 'data de aprovação gravada';
  assert public.t_evento(r, 'credito_lancado') = 1, 'processamento registrado';
  -- 2) Webhook/consulta duplicada: reaprovar, reenviar o mesmo status e chamar a entrega de novo não duplicam nada.
  update public.qf_recargas set status = 'aprovado' where id = r;
  update public.qf_recargas set status = 'pendente' where id = r;
  update public.qf_recargas set status = 'aprovado' where id = r;
  assert private.qf_aplicar_beneficio_recarga(r) = 'credito_ja_lancado', 'entrega repetida é ignorada';
  assert public.t_saldo(11) = 5250, 'saldo não duplica: ' || public.t_saldo(11);
  assert (select count(*) from public.qf_movimentacoes_carteira where referencia_id = r) = 2, 'continuam 2 lançamentos (crédito + bônus)';
  -- pendente/cancelado/expirado nunca entregam benefício
  assert private.qf_aplicar_beneficio_recarga(gen_random_uuid()) = 'nao_encontrada', 'recarga inexistente';
end $$;

-- 3) Plano Mensal: ativa 7 chamados por 30 dias e NÃO vira saldo.
do $$ declare r uuid := '00000000-0000-4000-8000-0000000000c1'; p public.qf_planos_profissional; begin
  insert into public.qf_profissionais values (public.t_uid(12)) on conflict do nothing;
  insert into public.qf_recargas(id, profissional_id, valor_centavos, metodo, status, plano, provedor, provedor_id)
    values (r, public.t_uid(12), 4990, 'pix', 'pendente', 'mensal', 'efi', 'TXID0000000000000000000000000002');
  update public.qf_recargas set status = 'aprovado' where id = r;
  select * into p from public.qf_planos_profissional where recarga_id = r;
  assert p.id is not null and p.plano = 'mensal' and p.chamados_total = 7 and p.chamados_restantes = 7, 'plano ativado com 7 chamados';
  assert p.valido_ate > now() + interval '29 days' and p.valido_ate < now() + interval '31 days', 'validade de 30 dias';
  assert public.t_saldo(12) = 0, 'plano não vira saldo';
  assert (select count(*) from public.qf_movimentacoes_carteira where profissional_id = public.t_uid(12)) = 0, 'plano não gera movimentação de carteira';
  update public.qf_recargas set status = 'pendente' where id = r;
  update public.qf_recargas set status = 'aprovado' where id = r;
  assert (select count(*) from public.qf_planos_profissional where recarga_id = r) = 1, 'duplicidade não ativa o plano duas vezes';
  assert public.t_evento(r, 'plano_ativado') = 1, 'ativação registrada';
  assert public.t_saldo(12) = 0, 'continua sem saldo';
end $$;

-- 4) Plano fora do catálogo: NUNCA vira saldo; fica registrado e aparece como pendência.
do $$ declare r uuid := '00000000-0000-4000-8000-0000000000c2'; begin
  insert into public.qf_profissionais values (public.t_uid(13)) on conflict do nothing;
  insert into public.qf_recargas(id, profissional_id, valor_centavos, metodo, status, plano)
    values (r, public.t_uid(13), 19990, 'pix', 'pendente', 'premium');
  update public.qf_recargas set status = 'aprovado' where id = r;
  assert public.t_saldo(13) = 0, 'plano não resolvido não pode virar saldo: ' || public.t_saldo(13);
  assert (select count(*) from public.qf_planos_profissional where recarga_id = r) = 0, 'nenhum plano inventado';
  assert public.t_evento(r, 'plano_nao_resolvido') = 1, 'falha registrada';
  assert exists (select 1 from private.qf_recargas_aprovadas_sem_beneficio where id = r), 'aparece como aprovado sem benefício';
  -- a reconciliação não credita saldo no lugar do plano
  perform private.qf_reconciliar_recargas_job();
  assert public.t_saldo(13) = 0, 'reconciliação também não vira saldo';
  -- ao corrigir o catálogo, a reconciliação ativa o plano certo, uma vez
  insert into public.qf_planos_catalogo values ('premium', 'Premium', 19990, 35, 30, true);
  assert (private.qf_reconciliar_recargas_job()->>'aplicados')::int = 1, 'reconciliação ativou o plano';
  assert (select chamados_total from public.qf_planos_profissional where recarga_id = r) = 35, 'plano premium com 35 chamados';
  assert (private.qf_reconciliar_recargas_job()->>'sem_beneficio')::int = 0, 'nada mais pendente';
  assert public.t_saldo(13) = 0, 'sem saldo';
end $$;

-- 5) Falha na entrega: pagamento fica aprovado, erro registrado, sem crédito parcial; reconciliação entrega uma vez.
create function public.t_quebra() returns trigger language plpgsql as $$ begin raise exception 'falha simulada'; end $$;
do $$ declare r uuid := '00000000-0000-4000-8000-0000000000d1'; begin
  insert into public.qf_profissionais values (public.t_uid(14)) on conflict do nothing;
  insert into public.qf_recargas(id, profissional_id, valor_centavos, metodo, status) values (r, public.t_uid(14), 2000, 'pix', 'pendente');
  create trigger t_quebra before insert on public.qf_movimentacoes_carteira for each row when (new.profissional_id = public.t_uid(14)) execute function public.t_quebra();
  update public.qf_recargas set status = 'aprovado' where id = r;
  assert (select status from public.qf_recargas where id = r) = 'aprovado', 'pagamento continua aprovado';
  assert public.t_saldo(14) = 0, 'sem crédito parcial (subtransação desfeita): ' || public.t_saldo(14);
  assert public.t_evento(r, 'erro_beneficio') = 1, 'erro registrado';
  assert (private.qf_reconciliar_recargas_job()->>'erros')::int = 1, 'reconciliação ainda falha enquanto o problema existe';
  assert public.t_evento(r, 'erro_reconciliacao') = 1, 'erro da reconciliação registrado';
  drop trigger t_quebra on public.qf_movimentacoes_carteira;
  assert (private.qf_reconciliar_recargas_job()->>'aplicados')::int = 1, 'reconciliação entrega depois que o problema some';
  assert public.t_saldo(14) = 2000, 'crédito entregue uma única vez';
  perform private.qf_reconciliar_recargas_job(); perform private.qf_reconciliar_recargas_job();
  assert public.t_saldo(14) = 2000, 'reconciliar de novo não duplica';
end $$;

-- 6) Renovação: chamados que sobraram passam para o plano novo; o antigo fica zerado.
do $$ declare r1 uuid := '00000000-0000-4000-8000-0000000000e1'; r2 uuid := '00000000-0000-4000-8000-0000000000e2'; begin
  insert into public.qf_profissionais values (public.t_uid(15)) on conflict do nothing;
  insert into public.qf_recargas(id, profissional_id, valor_centavos, metodo, status, plano) values (r1, public.t_uid(15), 4990, 'pix', 'pendente', 'mensal');
  update public.qf_recargas set status = 'aprovado' where id = r1;
  update public.qf_planos_profissional set chamados_restantes = 5 where recarga_id = r1;
  insert into public.qf_recargas(id, profissional_id, valor_centavos, metodo, status, plano) values (r2, public.t_uid(15), 9990, 'pix', 'pendente', 'pro');
  update public.qf_recargas set status = 'aprovado' where id = r2;
  assert (select chamados_restantes from public.qf_planos_profissional where recarga_id = r2) = 20, 'pro (15) + 5 que sobraram';
  assert (select chamados_restantes from public.qf_planos_profissional where recarga_id = r1) = 0, 'plano antigo zerado';
end $$;

-- 7) Contabilidade: dinheiro recebido x créditos consumidos x uso de plano; pendentes e cancelados fora do recebido.
do $$ declare c jsonb; begin
  insert into public.qf_recargas(profissional_id, valor_centavos, metodo, status) values (public.t_uid(11), 1000, 'pix', 'pendente'), (public.t_uid(11), 3000, 'pix', 'cancelado'), (public.t_uid(11), 700, 'boleto', 'expirado');
  insert into public.qf_recargas(profissional_id, valor_centavos, metodo, status, plano) values (public.t_uid(12), 4990, 'pix', 'pendente', 'mensal'), (public.t_uid(12), 4990, 'pix', 'estornado', 'mensal');
  insert into public.qf_desbloqueios(chamado_id, profissional_id, valor_centavos, origem) values
    (gen_random_uuid(), public.t_uid(11), 800, 'saldo'), (gen_random_uuid(), public.t_uid(11), 1300, 'saldo'),
    (gen_random_uuid(), public.t_uid(11), 0, 'saldo'), (gen_random_uuid(), public.t_uid(12), 0, 'plano');
  perform public.t_as(11);
  begin perform public.qf_admin_contabilidade(30); assert false, 'não admin deveria ser barrado'; exception when others then assert sqlerrm = 'forbidden', 'não admin: ' || sqlerrm; end;
  perform public.t_as(900);
  c := public.qf_admin_contabilidade(30);
  -- recebido: 5000 + 2000 (créditos aprovados: p11 + p14) e planos 4990 (p12) + 19990 (p13) + 4990 + 9990 (p15)
  assert (c#>>'{recebido,total,creditos_centavos}')::int = 7000, 'créditos recebidos: ' || (c#>>'{recebido,total,creditos_centavos}');
  assert (c#>>'{recebido,total,planos_centavos}')::int = 4990 + 19990 + 4990 + 9990, 'planos recebidos: ' || (c#>>'{recebido,total,planos_centavos}');
  assert (c#>>'{recebido,periodo,creditos_qtd}')::int = 2 and (c#>>'{recebido,periodo,planos_qtd}')::int = 4, 'quantidades no período';
  -- desbloqueios com saldo/plano não entram como dinheiro novo
  assert (c#>>'{desbloqueios,saldo_qtd}')::int = 2 and (c#>>'{desbloqueios,saldo_centavos}')::int = 2100, 'desbloqueios com saldo';
  assert (c#>>'{desbloqueios,sem_cobranca_qtd}')::int = 1 and (c#>>'{desbloqueios,plano_qtd}')::int = 1, 'sem cobrança e por plano';
  assert (c#>>'{recebido,total,creditos_centavos}')::int = 7000, 'desbloqueios não mudam o dinheiro recebido';
  -- situação por status, separando crédito e plano
  assert exists (select 1 from jsonb_array_elements(c->'situacao') s where s->>'tipo' = 'credito' and s->>'status' = 'pendente' and (s->>'qtd')::int = 1 and (s->>'valor_centavos')::int = 1000), 'crédito pendente';
  assert exists (select 1 from jsonb_array_elements(c->'situacao') s where s->>'tipo' = 'credito' and s->>'status' = 'cancelado'), 'crédito cancelado';
  assert exists (select 1 from jsonb_array_elements(c->'situacao') s where s->>'tipo' = 'plano' and s->>'status' = 'estornado'), 'plano estornado';
  assert exists (select 1 from jsonb_array_elements(c->'situacao') s where s->>'tipo' = 'plano' and s->>'status' = 'pendente'), 'plano pendente';
  assert (c#>>'{planos,vendidos}')::int = 4 and (c#>>'{planos,ativados}')::int = 4, 'planos vendidos = ativados';
  assert (c#>>'{planos,ativos_agora}')::int = 3, 'planos ativos agora (o renovado deixou o antigo zerado): ' || (c#>>'{planos,ativos_agora}');
  assert (c#>>'{alertas,aprovados_sem_beneficio}')::int = 0 and (c#>>'{alertas,plano_creditado_como_saldo}')::int = 0, 'sem alertas de benefício';
  assert (c#>>'{alertas,erros_recentes}')::int >= 2, 'erros recentes contados';
  assert (select count(*) from jsonb_array_elements(c#>'{recebido,por_dia}')) >= 1, 'recebido por dia';
  -- plano expirado não conta como ativo
  update public.qf_planos_profissional set valido_ate = now() - interval '1 day' where recarga_id in (select id from public.qf_recargas where profissional_id = public.t_uid(12));
  assert (public.qf_admin_contabilidade(30)#>>'{planos,ativos_agora}')::int = 2, 'plano expirado não conta como ativo';
end $$;

-- 8) Alerta: plano antigo creditado como saldo (falha antiga) é apontado, sem mexer no saldo.
do $$ declare r uuid := '00000000-0000-4000-8000-0000000000f1'; begin
  insert into public.qf_profissionais values (public.t_uid(16)) on conflict do nothing;
  insert into public.qf_recargas(id, profissional_id, valor_centavos, metodo, status, plano) values (r, public.t_uid(16), 4990, 'pix', 'aprovado', 'mensal');
  insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id) values (public.t_uid(16), 'credito', 4990, 'recarga', r);
  perform public.t_as(900);
  assert (public.qf_admin_contabilidade(30)#>>'{alertas,plano_creditado_como_saldo}')::int = 1, 'plano creditado como saldo apontado';
  assert jsonb_array_length(public.qf_admin_reconciliar_recargas(false)->'plano_creditado_como_saldo') = 1, 'reconciliação lista o caso';
  assert public.t_saldo(16) = 0, 'saldo não é alterado sozinho';
  -- a reconciliação NÃO ativa o plano por cima do saldo já creditado (seria saldo e plano ao mesmo tempo)
  assert (private.qf_reconciliar_recargas_job()->>'sem_beneficio')::int = 0, 'não é tratado como sem benefício';
  assert (select count(*) from public.qf_planos_profissional where recarga_id = r) = 0, 'plano não ativado automaticamente';
end $$;

-- 9) Ajuste manual: crédito, desconto, saldo nunca negativo, trilha de quem fez.
do $$ declare r jsonb; begin
  insert into public.qf_profissionais values (public.t_uid(17)) on conflict do nothing;
  perform public.t_as(17);
  begin perform public.qf_admin_adicionar_creditos(public.t_uid(17), 100, 'x'); assert false, 'não admin barrado'; exception when others then assert sqlerrm = 'forbidden', sqlerrm; end;
  perform public.t_as(900);
  assert (public.qf_admin_adicionar_creditos(public.t_uid(17), 1000, 'Cortesia comprovada #1')->>'ok')::boolean, 'crédito manual';
  assert public.t_saldo(17) = 1000, 'saldo 1000';
  assert (public.qf_admin_adicionar_creditos(public.t_uid(17), -400, 'Estorno comprovado #2')->>'ok')::boolean, 'desconto manual agora funciona';
  assert public.t_saldo(17) = 600, 'saldo 600: ' || public.t_saldo(17);
  r := public.qf_admin_adicionar_creditos(public.t_uid(17), -5000, 'além do saldo');
  assert not (r->>'ok')::boolean and r->>'reason' = 'saldo_insuficiente', 'não deixa saldo negativo';
  assert public.t_saldo(17) = 600, 'saldo intacto';
  assert (select count(*) from public.qf_movimentacoes_carteira where profissional_id = public.t_uid(17) and referencia_tipo = 'admin') = 2, 'dois lançamentos administrativos';
  assert (select count(*) from public.qf_pagamento_eventos where profissional_id = public.t_uid(17) and evento = 'ajuste_manual'
            and detalhe->>'admin_id' = public.t_uid(900)::text) = 2, 'trilha com o administrador';
  assert (select detalhe->>'saldo_antes_centavos' from public.qf_pagamento_eventos where profissional_id = public.t_uid(17) and detalhe->>'valor_centavos' = '-400') = '1000', 'saldo antes registrado';
  assert (public.qf_admin_adicionar_creditos(public.t_uid(17), 0)->>'reason') = 'valor_invalido', 'valor zero recusado';
  -- ajuste manual não é dinheiro recebido
  assert (public.qf_admin_contabilidade(30)#>>'{recebido,total,creditos_centavos}')::int = 7000 + 4990 * 0, 'ajuste manual não entra como recebimento';
end $$;

-- 10) Estrutura: log fechado ao público, eventos só pelo administrador, índice único do bônus.
do $$ declare e jsonb; begin
  assert not has_table_privilege('authenticated', 'public.qf_pagamento_eventos', 'select'), 'log fechado para usuários';
  assert not has_function_privilege('anon', 'public.qf_admin_contabilidade(integer)', 'execute'), 'anon sem acesso';
  perform public.t_as(900);
  e := public.qf_admin_pagamento_eventos(5);
  assert jsonb_array_length(e) = 5, 'lista de eventos limitada';
  perform public.t_as(11);
  begin perform public.qf_admin_pagamento_eventos(5); assert false, 'não admin barrado'; exception when others then assert sqlerrm = 'forbidden', sqlerrm; end;
  begin
    insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id)
      values (public.t_uid(11), 'bonus', 1, 'bonus_recarga', '00000000-0000-4000-8000-0000000000b1');
    assert false, 'bônus de recarga duplicado deveria ser barrado pelo banco';
  exception when unique_violation then null; end;
end $$;
