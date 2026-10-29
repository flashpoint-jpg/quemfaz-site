-- Resolve perfil pelo e-mail confirmado sem alterar o pagamento pendente.
BEGIN;
CREATE OR REPLACE FUNCTION private.qf_admin_livre_painel(p_busca text DEFAULT '',p_situacao text DEFAULT 'todos',p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE itens jsonb; total integer; kpis jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT private.qf_is_admin() THEN RAISE EXCEPTION 'Acesso administrativo obrigatório' USING ERRCODE='42501'; END IF;
 WITH base AS (
 SELECT DISTINCT ON(lower(trim(p.email))) p.id,p.email,p.nome,p.telefone,
 coalesce(p.profissional_id,pr.user_id) profissional_id,p.status,p.criado_em
 FROM public.qf_pre_cadastro_pagamentos p
 LEFT JOIN public.qf_profiles pf ON lower(trim(pf.email))=lower(trim(p.email)) AND pf.tipo='profissional'
 LEFT JOIN public.qf_profissionais pr ON pr.user_id=pf.id
 ORDER BY lower(trim(p.email)),p.criado_em DESC
 ), todos AS (
 SELECT id,email,nome,telefone,profissional_id,status,criado_em FROM base
 UNION ALL SELECT pf.id,lower(trim(pf.email)),pf.nome,pf.telefone,pf.id,'cadastrado',pf.criado_em FROM public.qf_profiles pf JOIN public.qf_profissionais pr ON pr.user_id=pf.id
 WHERE NOT EXISTS(SELECT 1 FROM base WHERE lower(trim(base.email))=lower(trim(pf.email)))
 ), rows AS (
 SELECT t.*,b.tipo,b.inicio_em,b.fim_em,b.dias,b.criado_por,b.encerrado_em,
 CASE WHEN a.fim_em>clock_timestamp() THEN 'pago'
 WHEN b.encerrado_em IS NULL AND b.fim_em>clock_timestamp() THEN b.tipo
 WHEN b.encerrado_em IS NULL AND b.inicio_em IS NULL AND b.id IS NOT NULL THEN 'convite'
 WHEN b.tipo='teste' THEN 'vencido' ELSE 'pendente' END situacao,
 EXISTS(SELECT 1 FROM private.qf_livre_beneficios h WHERE h.email=lower(trim(t.email)) AND h.tipo='teste') teste_utilizado,
 EXISTS(SELECT 1 FROM private.qf_livre_contatos c WHERE c.email=lower(trim(t.email)) AND c.canal='recusa') contato_recusado,
 (SELECT max(c.criado_em) FROM private.qf_livre_contatos c WHERE c.email=lower(trim(t.email)) AND c.canal='whatsapp') ultimo_whatsapp,
 (SELECT max(c.criado_em) FROM private.qf_livre_contatos c WHERE c.email=lower(trim(t.email)) AND c.canal='email') ultimo_email,
 (SELECT coalesce(jsonb_agg(to_jsonb(h)||jsonb_build_object('responsavel_nome',(SELECT nome FROM public.qf_profiles WHERE id=h.responsavel)) ORDER BY h.criado_em DESC),'[]') FROM private.qf_livre_beneficio_historico h JOIN private.qf_livre_beneficios hb ON hb.id=h.beneficio_id WHERE hb.email=lower(trim(t.email))) historico,
 a.fim_em pago_ate
 FROM todos t
 LEFT JOIN LATERAL(SELECT * FROM private.qf_livre_beneficios WHERE email=lower(trim(t.email)) ORDER BY (encerrado_em IS NULL AND (inicio_em IS NULL OR fim_em>clock_timestamp())) DESC,criado_em DESC LIMIT 1) b ON true
 LEFT JOIN LATERAL(SELECT s.fim_em FROM public.qf_livre_assinaturas s JOIN public.qf_recargas r ON r.id=s.recarga_id AND r.status='aprovado' WHERE s.profissional_id=t.profissional_id ORDER BY s.fim_em DESC LIMIT 1) a ON true
 ), filtrados AS (
 SELECT * FROM rows WHERE (p_situacao='todos' OR situacao=p_situacao) AND (trim(p_busca)='' OR concat_ws(' ',nome,email,telefone) ILIKE '%'||left(trim(p_busca),120)||'%')
 ) SELECT count(*),(SELECT coalesce(jsonb_agg(to_jsonb(f)),'[]') FROM (SELECT * FROM filtrados ORDER BY criado_em DESC LIMIT 30 OFFSET greatest(0,least(p_offset,100000))) f) INTO total,itens FROM filtrados;
 SELECT jsonb_build_object(
 'testes_ativos',count(*) FILTER(WHERE tipo='teste' AND encerrado_em IS NULL AND fim_em>clock_timestamp()),
 'vencem_hoje',count(*) FILTER(WHERE tipo='teste' AND encerrado_em IS NULL AND fim_em>clock_timestamp() AND (fim_em AT TIME ZONE 'America/Sao_Paulo')::date=(now() AT TIME ZONE 'America/Sao_Paulo')::date),
 'testes_vencidos',count(*) FILTER(WHERE tipo='teste' AND fim_em<=clock_timestamp()),
 'cortesias',count(*) FILTER(WHERE tipo='cortesia' AND encerrado_em IS NULL AND (inicio_em IS NULL OR fim_em>clock_timestamp())),
 'total_testes',count(*) FILTER(WHERE tipo='teste'),
 'convertidos',count(*) FILTER(WHERE tipo='teste' AND EXISTS(SELECT 1 FROM public.qf_livre_assinaturas a JOIN public.qf_recargas r ON r.id=a.recarga_id AND r.status='aprovado' WHERE a.profissional_id=b.user_id AND a.inicio_em>=b.inicio_em)),
 'planos_pagos',(SELECT count(DISTINCT a.profissional_id) FROM public.qf_livre_assinaturas a JOIN public.qf_recargas r ON r.id=a.recarga_id AND r.status='aprovado' WHERE a.inicio_em<=now() AND a.fim_em>clock_timestamp())
 ) INTO kpis FROM private.qf_livre_beneficios b;
 RETURN jsonb_build_object('ok',true,'itens',itens,'total',total,'kpis',kpis,'servidor_agora',clock_timestamp());
END $$;
COMMIT;
