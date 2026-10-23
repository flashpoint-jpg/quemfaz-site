CREATE OR REPLACE FUNCTION private.qf_aplicar_beneficio_recarga(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.qf_recargas;
  c public.qf_planos_catalogo;
  v_sobra integer;
  v_chamados integer;
  v_dias integer;
  v_bonus integer;
begin
  select * into r from public.qf_recargas where id = p_id for update;
  if r.id is null then return 'nao_encontrada'; end if;
  if r.status is distinct from 'aprovado' then return 'nao_aprovado'; end if;

  if r.plano = 'livre' then
    return private.qf_livre_ativar_recarga(r.id);
  end if;

  if r.plano is not null then
    select * into c from public.qf_planos_catalogo where plano = r.plano;
    if c.plano is not null and r.valor_centavos = c.preco_centavos then
      v_chamados := c.chamados; v_dias := c.dias;
    else
      select h.chamados, h.dias into v_chamados, v_dias
        from public.qf_planos_catalogo_hist h
       where h.plano = r.plano and h.preco_centavos = r.valor_centavos and h.substituido_em >= r.criado_em
       order by h.substituido_em
       limit 1;
    end if;
    if v_chamados is null or v_dias is null then
      perform private.qf_log_pagamento(r.id, r.profissional_id, 'plano_nao_resolvido',
        jsonb_build_object('plano', r.plano, 'valor_centavos', r.valor_centavos));
      return 'plano_nao_resolvido';
    end if;
    if exists (select 1 from public.qf_planos_profissional where recarga_id = r.id) then
      perform private.qf_log_pagamento(r.id, r.profissional_id, 'plano_ja_ativado', jsonb_build_object('plano', r.plano));
      return 'plano_ja_ativado';
    end if;
    select coalesce(sum(chamados_restantes), 0) into v_sobra from public.qf_planos_profissional
     where profissional_id = r.profissional_id and valido_ate > now() and chamados_restantes > 0;
    update public.qf_planos_profissional set chamados_restantes = 0, atualizado_em = now()
     where profissional_id = r.profissional_id and valido_ate > now() and chamados_restantes > 0;
    insert into public.qf_planos_profissional(profissional_id, plano, chamados_total, chamados_restantes, valido_ate, recarga_id)
    values (r.profissional_id, r.plano, v_chamados, v_chamados + v_sobra, now() + make_interval(days => v_dias), r.id);
    perform private.qf_log_pagamento(r.id, r.profissional_id, 'plano_ativado',
      jsonb_build_object('plano', r.plano, 'chamados', v_chamados, 'dias', v_dias, 'chamados_herdados', v_sobra));
    return 'plano_ativado';
  end if;

  if exists (
    select 1 from public.qf_movimentacoes_carteira m
     where m.referencia_tipo = 'recarga' and m.referencia_id = r.id and m.tipo = 'credito'
  ) then
    perform private.qf_log_pagamento(r.id, r.profissional_id, 'credito_ja_lancado', '{}'::jsonb);
    return 'credito_ja_lancado';
  end if;
  insert into public.qf_carteiras(profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
  values (r.profissional_id, 0, 0, false)
  on conflict (profissional_id) do nothing;
  update public.qf_carteiras set saldo_centavos = saldo_centavos + r.valor_centavos, atualizado_em = now()
   where profissional_id = r.profissional_id;
  insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
  values (r.profissional_id, 'credito', r.valor_centavos, 'recarga', r.id,
    'Recarga aprovada via ' || case r.metodo when 'pix' then 'Pix' when 'cartao' then 'Cartão' when 'boleto' then 'Boleto' else r.metodo end);

  v_bonus := public.qf_bonus_recarga_centavos(r.valor_centavos);
  if v_bonus > 0 and not exists (
    select 1 from public.qf_movimentacoes_carteira m
     where m.referencia_tipo = 'bonus_recarga' and m.referencia_id = r.id
  ) then
    update public.qf_carteiras set saldo_centavos = saldo_centavos + v_bonus, atualizado_em = now()
     where profissional_id = r.profissional_id;
    insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
    values (r.profissional_id, 'bonus', v_bonus, 'bonus_recarga', r.id, 'Bônus da recarga (vale por 30 dias)');
  end if;
  perform private.qf_log_pagamento(r.id, r.profissional_id, 'credito_lancado',
    jsonb_build_object('valor_centavos', r.valor_centavos, 'bonus_centavos', coalesce(v_bonus, 0)));
  return 'credito_lancado';
end;
$function$;
