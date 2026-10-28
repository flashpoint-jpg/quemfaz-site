-- Indicadores reais de pré-cadastro pago, protegidos pela autenticação administrativa.
-- Aplicar DEPOIS de 2026-10-28-cadastro-pago-obrigatorio.sql.
-- Nunca conta saldos pré-pagos como receita reconhecida.
CREATE OR REPLACE FUNCTION public.qf_admin_cadastro_pagamentos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT private.qf_is_admin() THEN
   RAISE EXCEPTION 'admin authentication required' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object(
  'gerado_em',now(),
  'pre_cadastros_pendentes',(
    SELECT count(*) FROM public.qf_pre_cadastro_pagamentos WHERE plano IN ('avulso','livre') AND status='pendente'),
  'pre_cadastros_abandonados',(
    SELECT count(*) FROM public.qf_pre_cadastro_pagamentos WHERE plano IN ('avulso','livre')
    AND status='pendente' AND criado_em<now()-interval '72 hours'),
  'pagos_ainda_nao_resgatados',(
    SELECT count(*) FROM public.qf_pre_cadastro_pagamentos WHERE plano IN ('avulso','livre')
    AND status='aprovado' AND recarga_id IS NULL),
  'profissionais_ativos',(
    SELECT count(*) FROM public.qf_profiles pf JOIN public.qf_profissionais pr ON pr.user_id=pf.id
    WHERE pf.tipo='profissional' AND pf.ativo IS TRUE),
  'avulsos_iniciais_pagos',(
    SELECT count(*) FROM public.qf_pre_cadastro_pagamentos p
    JOIN public.qf_recargas r ON r.id=p.recarga_id AND r.status='aprovado'
    WHERE p.plano='avulso' AND p.status='aprovado' AND p.valor_centavos=1300),
  'livres_iniciais_pagos',(
    SELECT count(*) FROM public.qf_pre_cadastro_pagamentos p
    JOIN public.qf_recargas r ON r.id=p.recarga_id AND r.status='aprovado'
    WHERE p.plano='livre' AND p.status='aprovado' AND p.valor_centavos=3990),
  'livres_vigentes',(
    SELECT count(*) FROM public.qf_livre_assinaturas a
    JOIN public.qf_recargas r ON r.id=a.recarga_id AND r.status='aprovado'
    WHERE a.inicio_em<=now() AND a.fim_em>now()),
  'livres_vencidos',(
    SELECT count(*) FROM public.qf_livre_assinaturas a
    JOIN public.qf_recargas r ON r.id=a.recarga_id AND r.status='aprovado'
    WHERE a.fim_em<=now()),
  'recebido_avulso_inicial_centavos',coalesce((
    SELECT sum(p.valor_centavos) FROM public.qf_pre_cadastro_pagamentos p
    JOIN public.qf_recargas r ON r.id=p.recarga_id AND r.status='aprovado'
    WHERE p.plano='avulso' AND p.status='aprovado'),0),
  'recebido_livre_inicial_centavos',coalesce((
    SELECT sum(p.valor_centavos) FROM public.qf_pre_cadastro_pagamentos p
    JOIN public.qf_recargas r ON r.id=p.recarga_id AND r.status='aprovado'
    WHERE p.plano='livre' AND p.status='aprovado'),0),
  'saldo_carteiras_total_centavos',coalesce((
    SELECT sum(greatest(0,c.saldo_centavos)) FROM public.qf_carteiras c),0),
  'observacao','Recebido Avulso é saldo antecipado, não receita. Não misturar bônus ou saldo com faturamento da plataforma.'
 );
END $$;
REVOKE ALL ON FUNCTION public.qf_admin_cadastro_pagamentos() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.qf_admin_cadastro_pagamentos() TO authenticated;
