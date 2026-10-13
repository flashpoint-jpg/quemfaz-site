-- Preços de desbloqueio arredondados e bônus de recarga.
--
-- Preços: R$ 4,90 -> R$ 5, R$ 7,90 -> R$ 8, R$ 12,90 -> R$ 13.
-- Bônus (só recarga avulsa; plano não ganha):
--   a partir de R$ 50  -> +10%
--   a partir de R$ 100 -> +15%
--   a partir de R$ 200 -> +20%  (teto de R$ 100 de bônus por recarga)
-- O valor pago continua sem vencer; o bônus vence em 30 dias usando o
-- controle que já existe (qf_bonus_validade, gasto primeiro nos desbloqueios).

UPDATE public.qf_precos_desbloqueio
SET preco_centavos = CASE preco_centavos WHEN 490 THEN 500 WHEN 790 THEN 800 WHEN 1290 THEN 1300 END,
    atualizado_em = now()
WHERE preco_centavos IN (490, 790, 1290);

CREATE OR REPLACE FUNCTION public.qf_bonus_recarga_centavos(p_valor_centavos integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select least(10000, (coalesce(p_valor_centavos, 0) * case
    when p_valor_centavos >= 20000 then 20
    when p_valor_centavos >= 10000 then 15
    when p_valor_centavos >= 5000 then 10
    else 0 end) / 100)::integer;
$function$;
GRANT EXECUTE ON FUNCTION public.qf_bonus_recarga_centavos(integer) TO anon, authenticated;

-- Recarga aprovada: credita o valor pago e, em seguida, o bônus da faixa.
CREATE OR REPLACE FUNCTION public.qf_recarga_pagamento_aplicado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.qf_planos_catalogo; v_sobra integer; v_chamados integer; v_dias integer; v_bonus integer;
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    if new.plano is not null then
      select * into c from public.qf_planos_catalogo where plano = new.plano;
      if c.plano is not null then
        if new.valor_centavos = c.preco_centavos then
          v_chamados := c.chamados; v_dias := c.dias;
        else
          select h.chamados, h.dias into v_chamados, v_dias
            from public.qf_planos_catalogo_hist h
           where h.plano = new.plano and h.preco_centavos = new.valor_centavos and h.substituido_em >= new.criado_em
           order by h.substituido_em
           limit 1;
        end if;
      end if;
      if v_chamados is not null then
        if not exists (select 1 from public.qf_planos_profissional where recarga_id = new.id) then
          select coalesce(sum(chamados_restantes),0) into v_sobra from public.qf_planos_profissional
           where profissional_id = new.profissional_id and valido_ate > now() and chamados_restantes > 0;
          update public.qf_planos_profissional set chamados_restantes = 0, atualizado_em = now()
           where profissional_id = new.profissional_id and valido_ate > now() and chamados_restantes > 0;
          insert into public.qf_planos_profissional(profissional_id, plano, chamados_total, chamados_restantes, valido_ate, recarga_id)
          values (new.profissional_id, c.plano, v_chamados, v_chamados + v_sobra, now() + make_interval(days => v_dias), new.id);
        end if;
        return null;
      end if;
    end if;
    if not exists (
      select 1 from public.qf_movimentacoes_carteira m
      where m.referencia_tipo = 'recarga' and m.referencia_id = new.id and m.tipo = 'credito'
    ) then
      insert into public.qf_carteiras(profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
      values (new.profissional_id, 0, 0, false)
      on conflict (profissional_id) do nothing;
      update public.qf_carteiras set saldo_centavos = saldo_centavos + new.valor_centavos, atualizado_em = now()
       where profissional_id = new.profissional_id;
      insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
      values (new.profissional_id, 'credito', new.valor_centavos, 'recarga', new.id,
        'Recarga aprovada via ' || case new.metodo when 'pix' then 'Pix' when 'cartao' then 'Cartão' when 'boleto' then 'Boleto' else new.metodo end);
    end if;
    v_bonus := public.qf_bonus_recarga_centavos(new.valor_centavos);
    if v_bonus > 0 and not exists (
      select 1 from public.qf_movimentacoes_carteira m
      where m.referencia_tipo = 'bonus_recarga' and m.referencia_id = new.id
    ) then
      update public.qf_carteiras set saldo_centavos = saldo_centavos + v_bonus, atualizado_em = now()
       where profissional_id = new.profissional_id;
      -- O gatilho qf_bonus_prazo_nova_concessao registra a validade de 30 dias.
      insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
      values (new.profissional_id, 'bonus', v_bonus, 'bonus_recarga', new.id,
        'Bônus da recarga (vale por 30 dias)');
    end if;
  end if;
  return null;
end $function$;

-- Validade do bônus: promoções seguem com 10 dias; bônus de recarga, 30 dias.
-- Com bônus ainda válido, vale o prazo mais longo.
CREATE OR REPLACE FUNCTION private.qf_bonus_prazo_nova_concessao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.tipo='bonus' AND NEW.referencia_tipo IN ('bonus_lancamento','bonus_massa','bonus_recarga') THEN
    PERFORM private.qf_expirar_bonus_profissional(NEW.profissional_id);
    INSERT INTO public.qf_bonus_validade(
      profissional_id,saldo_bonus_centavos,expira_em
    ) VALUES (
      NEW.profissional_id,NEW.valor_centavos,
      now()+CASE WHEN NEW.referencia_tipo='bonus_recarga' THEN interval '30 days' ELSE interval '10 days' END
    )
    ON CONFLICT(profissional_id) DO UPDATE SET
      saldo_bonus_centavos=public.qf_bonus_validade.saldo_bonus_centavos+excluded.saldo_bonus_centavos,
      expira_em=CASE WHEN public.qf_bonus_validade.saldo_bonus_centavos>0
                     THEN greatest(public.qf_bonus_validade.expira_em,excluded.expira_em)
                     ELSE excluded.expira_em END,
      atualizado_em=now();
  END IF;
  RETURN NEW;
END;
$function$;

-- O texto do extrato dizia "10 dias" fixo; agora vale para os dois prazos.
CREATE OR REPLACE FUNCTION private.qf_expirar_bonus_profissional(p_profissional uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_saldo bigint; v_bonus bigint; v_data timestamptz; v_expira bigint;
BEGIN
  SELECT c.saldo_centavos INTO v_saldo
    FROM public.qf_carteiras c
   WHERE c.profissional_id=p_profissional FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT b.saldo_bonus_centavos,b.expira_em INTO v_bonus,v_data
    FROM public.qf_bonus_validade b
   WHERE b.profissional_id=p_profissional FOR UPDATE;
  IF NOT FOUND OR v_bonus<=0 OR v_data>now() THEN RETURN 0; END IF;
  v_expira:=least(greatest(v_saldo,0),v_bonus);
  UPDATE public.qf_bonus_validade
     SET saldo_bonus_centavos=0,atualizado_em=now()
   WHERE profissional_id=p_profissional;
  IF v_expira>0 THEN
    UPDATE public.qf_carteiras
       SET saldo_centavos=saldo_centavos-v_expira,atualizado_em=now()
     WHERE profissional_id=p_profissional;
    INSERT INTO public.qf_movimentacoes_carteira(
      profissional_id,tipo,valor_centavos,referencia_tipo,descricao
    ) VALUES (
      p_profissional,'debito',v_expira,'bonus_expirado',
      'Bônus expirado após o prazo de validade'
    );
  END IF;
  RETURN v_expira;
END;
$function$;
