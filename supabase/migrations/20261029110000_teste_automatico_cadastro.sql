CREATE OR REPLACE FUNCTION private.qf_livre_preparar_acesso(p_teste boolean DEFAULT false,p_documento text DEFAULT '',p_telefone text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u auth.users; doc text:=regexp_replace(coalesce(p_documento,''),'\D','','g'); tel text:=regexp_replace(coalesce(p_telefone,''),'\D','','g'); b private.qf_livre_beneficios; chave text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória' USING ERRCODE='42501'; END IF;
 SELECT * INTO u FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Confirme seu e-mail antes de ativar o acesso'; END IF;
 IF EXISTS(SELECT 1 FROM public.qf_profiles WHERE id=u.id AND tipo<>'profissional') THEN RAISE EXCEPTION 'Conta de outro tipo'; END IF;
 -- Convite administrativo é resgatado pelo titular do e-mail confirmado, nunca pelo ID do convite.
 UPDATE private.qf_livre_beneficios SET user_id=u.id WHERE email=lower(trim(u.email)) AND user_id IS NULL AND encerrado_em IS NULL;
 SELECT * INTO b FROM private.qf_livre_beneficios WHERE user_id=u.id AND encerrado_em IS NULL AND (inicio_em IS NULL OR fim_em>clock_timestamp()) ORDER BY criado_em DESC LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'tipo',b.tipo); END IF;
 -- Teste automático para novo cadastro validado; parâmetro mantido para compatibilidade.
 IF EXISTS(SELECT 1 FROM private.qf_livre_beneficios WHERE user_id=u.id AND tipo='teste') OR EXISTS(SELECT 1 FROM public.qf_livre_assinaturas WHERE profissional_id=u.id) THEN RAISE EXCEPTION 'Teste automático já utilizado ou não elegível. Ative o plano por R$ 39,90.'; END IF;
 IF NOT private.qf_livre_documento_valido(doc) OR length(tel) NOT IN (10,11,12,13) OR doc~'^(.)\1+$' OR tel~'^(.)\1+$' THEN RAISE EXCEPTION 'Conclua documento e telefone válidos para iniciar o teste'; END IF;
 IF tel~'^55' AND length(tel)>11 THEN tel:=substr(tel,3); END IF;
 IF EXISTS(SELECT 1 FROM public.qf_profissionais WHERE user_id<>u.id AND regexp_replace(coalesce(documento,''),'\D','','g')=doc)
 OR EXISTS(SELECT 1 FROM public.qf_profiles WHERE id<>u.id AND regexp_replace(coalesce(telefone,''),'\D','','g') IN (tel,'55'||tel)) THEN RAISE EXCEPTION 'Identificação já cadastrada. Entre com sua conta existente.'; END IF;
 -- Chaves com hash evitam armazenar cópias em claro do documento na tabela de elegibilidade.
 FOREACH chave IN ARRAY ARRAY['email:'||md5(lower(trim(u.email))),'doc:'||md5(doc),'tel:'||md5(tel)] LOOP
 INSERT INTO private.qf_livre_teste_identidades(chave,user_id) VALUES(chave,u.id);
 END LOOP;
 INSERT INTO private.qf_livre_beneficios(user_id,email,tipo,dias,motivo,criado_por)
 VALUES(u.id,lower(trim(u.email)),'teste',2,'Teste automático único de 48 horas',u.id) RETURNING * INTO b;
 -- Perfil existente identificado pode iniciar imediatamente; os demais aguardam o trigger.
 IF EXISTS(SELECT 1 FROM public.qf_profissionais WHERE user_id=u.id AND nullif(documento,'') IS NOT NULL) THEN
 UPDATE private.qf_livre_beneficios SET inicio_em=statement_timestamp(),fim_em=statement_timestamp()+interval '48 hours' WHERE id=b.id;
 END IF;
 RETURN jsonb_build_object('ok',true,'tipo','teste');
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Teste já utilizado para esta identificação. Entre com a conta existente.';
END $$;
