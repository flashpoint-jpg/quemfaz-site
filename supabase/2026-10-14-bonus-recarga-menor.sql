-- V11.89: bônus de recarga menor — 5% a partir de R$ 50, 8% de R$ 100, 10% de R$ 200 (teto R$ 100).
CREATE OR REPLACE FUNCTION public.qf_bonus_recarga_centavos(p_valor_centavos integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select least(10000, (coalesce(p_valor_centavos, 0) * case
    when p_valor_centavos >= 20000 then 10
    when p_valor_centavos >= 10000 then 8
    when p_valor_centavos >= 5000 then 5
    else 0 end) / 100)::integer;
$function$;
GRANT EXECUTE ON FUNCTION public.qf_bonus_recarga_centavos(integer) TO anon, authenticated;
