-- Pedido urgente (prioridade do cliente): R$ 5 -> R$ 9,90 (valor no painel e reserva da função).
UPDATE public.qf_config
SET valor = jsonb_set(coalesce(valor,'{}'::jsonb), '{valor_centavos}', '990'::jsonb, true)
WHERE chave = 'prioridade_cliente';

DO $do$ DECLARE d text; n text; BEGIN
  d := pg_get_functiondef('public.qf_solicitar_prioridade'::regproc);
  n := replace(replace(replace(d,
    'v_valor integer := 500;', 'v_valor integer := 990;'),
    '::integer, 500)', '::integer, 990)'),
    'v_valor := coalesce(v_valor, 500);', 'v_valor := coalesce(v_valor, 990);');
  IF n <> d THEN EXECUTE n; END IF;
END $do$;
