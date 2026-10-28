-- Painel de conversão: interessados que escolheram plano e iniciaram checkout.
-- Registros pendentes NÃO representam profissionais ativos ou dinheiro recebido.
-- Somente admin autenticado pode consultar dados pessoais; segredo e checkout_url nunca retornam.
CREATE OR REPLACE FUNCTION public.qf_admin_pre_cadastros(
  p_limite integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_busca text DEFAULT '',
  p_situacao text DEFAULT 'todos'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_limite integer := least(greatest(coalesce(p_limite,50),1),100);
  v_offset integer := least(greatest(coalesce(p_offset,0),0),100000);
  v_busca text := left(trim(coalesce(p_busca,'')),120);
  v_situacao text := coalesce(p_situacao,'todos');
  v_total integer := 0;
  v_itens jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT private.qf_is_admin() THEN
    RAISE EXCEPTION 'admin authentication required' USING ERRCODE='42501';
  END IF;
  IF v_situacao NOT IN ('todos','pendente','aprovado','ativado','cancelado') THEN
    RAISE EXCEPTION 'invalid filter' USING ERRCODE='22023';
  END IF;

  SELECT count(*)::integer INTO v_total
    FROM public.qf_pre_cadastro_pagamentos p
    WHERE p.plano IN ('avulso','livre')
      AND (v_busca = '' OR p.nome ILIKE '%'||v_busca||'%'
           OR p.email ILIKE '%'||v_busca||'%'
           OR coalesce(p.telefone,'') ILIKE '%'||v_busca||'%')
      AND (v_situacao = 'todos'
           OR (v_situacao='pendente' AND p.status='pendente')
           OR (v_situacao='aprovado' AND p.status='aprovado' AND p.profissional_id IS NULL)
           OR (v_situacao='ativado' AND p.status='aprovado' AND p.profissional_id IS NOT NULL)
           OR (v_situacao='cancelado' AND p.status IN ('cancelado','expirado','reprovado')));

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.criado_em DESC,r.id DESC),'[]'::jsonb)
    INTO v_itens
    FROM (
      SELECT p.id,p.nome,p.email,p.telefone,p.plano,p.metodo,p.valor_centavos,
             p.status,p.provedor,p.provedor_id,p.criado_em,p.aprovado_em,
             p.resgatado_em,p.profissional_id,
             (pf.tipo='profissional' AND pf.ativo IS TRUE AND prof.user_id IS NOT NULL) AS perfil_ativo,
             CASE WHEN p.status='pendente' THEN 'aguardando_pagamento'
                  WHEN p.status='aprovado' AND p.profissional_id IS NULL THEN 'pago_aguardando_ativacao'
                  WHEN p.status='aprovado' AND p.profissional_id IS NOT NULL THEN 'cadastro_resgatado'
                  ELSE p.status END AS etapa
        FROM public.qf_pre_cadastro_pagamentos p
        LEFT JOIN public.qf_profiles pf ON pf.id=p.profissional_id
        LEFT JOIN public.qf_profissionais prof ON prof.user_id=p.profissional_id
       WHERE p.plano IN ('avulso','livre')
         AND (v_busca = '' OR p.nome ILIKE '%'||v_busca||'%'
              OR p.email ILIKE '%'||v_busca||'%'
              OR coalesce(p.telefone,'') ILIKE '%'||v_busca||'%')
         AND (v_situacao='todos'
              OR (v_situacao='pendente' AND p.status='pendente')
              OR (v_situacao='aprovado' AND p.status='aprovado' AND p.profissional_id IS NULL)
              OR (v_situacao='ativado' AND p.status='aprovado' AND p.profissional_id IS NOT NULL)
              OR (v_situacao='cancelado' AND p.status IN ('cancelado','expirado','reprovado')))
       ORDER BY p.criado_em DESC,p.id DESC
       LIMIT v_limite OFFSET v_offset
    ) r;
  RETURN jsonb_build_object('itens',v_itens,'total',v_total,'offset',v_offset,
     'limite',v_limite,'gerado_em',now(),
     'observacao','Pagamento pendente não significa perfil ativo. Status é o último registrado na plataforma; só confirmação bancária habilita a conta.');
END $$;

REVOKE ALL ON FUNCTION public.qf_admin_pre_cadastros(integer,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.qf_admin_pre_cadastros(integer,integer,text,text) TO authenticated;
