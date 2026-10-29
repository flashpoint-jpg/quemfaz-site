-- Autorizações não financeiras. Nunca gera recarga, receita ou assinatura paga.
BEGIN;
CREATE TABLE private.qf_livre_beneficios (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id),
 email text NOT NULL CHECK(email=lower(trim(email))), pre_cadastro_id uuid REFERENCES public.qf_pre_cadastro_pagamentos(id),
 tipo text NOT NULL CHECK(tipo IN ('teste','cortesia')), dias integer NOT NULL CHECK(dias BETWEEN 1 AND 365),
 inicio_em timestamptz, fim_em timestamptz, encerrado_em timestamptz,
 motivo text NOT NULL, criado_por uuid REFERENCES auth.users(id), criado_em timestamptz NOT NULL DEFAULT now(),
 CHECK((inicio_em IS NULL AND fim_em IS NULL) OR (inicio_em IS NOT NULL AND fim_em>inicio_em)),
 CHECK(tipo<>'teste' OR dias=2)
);
CREATE UNIQUE INDEX qf_livre_teste_unico ON private.qf_livre_beneficios(user_id) WHERE tipo='teste';
CREATE INDEX qf_livre_beneficio_email ON private.qf_livre_beneficios(email);
CREATE INDEX qf_livre_beneficio_user ON private.qf_livre_beneficios(user_id,fim_em);
CREATE TABLE private.qf_livre_teste_identidades (
 chave text PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.qf_livre_beneficio_historico (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),beneficio_id uuid REFERENCES private.qf_livre_beneficios(id),
 acao text NOT NULL,antes jsonb,depois jsonb,motivo text NOT NULL,responsavel uuid REFERENCES auth.users(id),criado_em timestamptz DEFAULT now()
);
CREATE TABLE private.qf_livre_contatos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text NOT NULL,canal text NOT NULL CHECK(canal IN ('whatsapp','email','recusa')),
 responsavel uuid NOT NULL REFERENCES auth.users(id),criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.qf_livre_beneficios ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.qf_livre_teste_identidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.qf_livre_beneficio_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.qf_livre_contatos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.qf_livre_beneficios,private.qf_livre_teste_identidades,private.qf_livre_beneficio_historico,private.qf_livre_contatos FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.qf_livre_beneficio_ok(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.qf_livre_beneficios b WHERE b.user_id=p_uid AND b.encerrado_em IS NULL AND b.inicio_em<=now() AND b.fim_em>clock_timestamp())
$$;
-- Preserve integralmente a autorização de assinaturas bancárias existentes.
ALTER FUNCTION private.qf_livre_acesso_ok(uuid) RENAME TO qf_livre_acesso_pago_ok;
CREATE FUNCTION private.qf_livre_acesso_ok(p_prof uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT private.qf_livre_acesso_pago_ok(p_prof) OR private.qf_livre_beneficio_ok(p_prof)
$$;
ALTER FUNCTION private.qf_cadastro_profissional_pago(uuid) RENAME TO qf_cadastro_pagamento_original_ok;
CREATE FUNCTION private.qf_cadastro_profissional_pago(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT private.qf_cadastro_pagamento_original_ok(p_uid) OR EXISTS(SELECT 1 FROM private.qf_livre_beneficios b WHERE b.user_id=p_uid AND b.encerrado_em IS NULL AND (b.inicio_em IS NULL OR b.fim_em>clock_timestamp()))
$$;
-- Funções antigas podem estar vinculadas por OID. Substitui a referência no corpo preservando as demais regras.
DO $$DECLARE r record; BEGIN
 FOR r IN SELECT p.oid,pg_get_functiondef(p.oid) src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname IN ('qf_exigir_pagamento_perfil_profissional','qf_exigir_pagamento_profissional','qf_livre_desbloquear')
 LOOP EXECUTE r.src; END LOOP;
END $$;

CREATE FUNCTION private.qf_livre_beneficio_auditar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO private.qf_livre_beneficio_historico(beneficio_id,acao,antes,depois,motivo,responsavel)
 VALUES(new.id,TG_OP,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(old) END,to_jsonb(new),new.motivo,auth.uid());
 IF new.user_id IS NOT NULL AND new.inicio_em IS NOT NULL AND to_regclass('public.qf_profissional_avisos') IS NOT NULL THEN
  INSERT INTO public.qf_profissional_avisos(user_id,tipo,titulo,corpo,rota)
  VALUES(new.user_id,'livre_beneficio',
   CASE WHEN new.encerrado_em IS NOT NULL THEN 'Sua cortesia foi encerrada' WHEN new.tipo='teste' THEN 'Seu Quem Faz Livre está liberado por 2 dias!' ELSE 'Quem Faz Livre — cortesia ativa' END,
   CASE WHEN new.encerrado_em IS NOT NULL THEN 'Ative seu plano para continuar desbloqueando novas oportunidades.' ELSE 'Liberado até '||to_char(new.fim_em AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||'. Comissão de 13% e prestação de contas mantidas. Sem cobrança automática.' END,
   '/profissional/carteira');
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER qf_livre_beneficio_auditoria AFTER INSERT OR UPDATE ON private.qf_livre_beneficios FOR EACH ROW EXECUTE FUNCTION private.qf_livre_beneficio_auditar();

CREATE FUNCTION private.qf_livre_beneficio_iniciar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- A contagem só começa após a conclusão real do perfil e da identificação.
 IF nullif(regexp_replace(coalesce(new.documento,''),'\D','','g'),'') IS NOT NULL THEN
 UPDATE private.qf_livre_beneficios SET inicio_em=statement_timestamp(),fim_em=statement_timestamp()+make_interval(days=>dias)
 WHERE user_id=new.user_id AND inicio_em IS NULL AND encerrado_em IS NULL;
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER qf_livre_beneficio_inicio AFTER INSERT OR UPDATE OF documento ON public.qf_profissionais FOR EACH ROW EXECUTE FUNCTION private.qf_livre_beneficio_iniciar();

CREATE FUNCTION private.qf_livre_documento_valido(doc text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE n integer:=length(doc); soma integer; resto integer; peso integer; i integer; j integer;
BEGIN
 IF n NOT IN (11,14) OR doc!~'^[0-9]+$' OR doc~'^(.)\1+$' THEN RETURN false; END IF;
 FOR j IN (n-1)..n LOOP
  soma:=0;
  IF n=11 THEN
   FOR i IN 1..j-1 LOOP soma:=soma+substr(doc,i,1)::integer*(j+1-i); END LOOP;
  ELSE
   peso:=2;
   FOR i IN REVERSE (j-1)..1 LOOP soma:=soma+substr(doc,i,1)::integer*peso;peso:=CASE WHEN peso=9 THEN 2 ELSE peso+1 END; END LOOP;
  END IF;
  resto:=soma%11;resto:=CASE WHEN resto<2 THEN 0 ELSE 11-resto END;
  IF substr(doc,j,1)::integer<>resto THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.qf_livre_documento_valido(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.qf_livre_preparar_acesso(p_teste boolean DEFAULT false,p_documento text DEFAULT '',p_telefone text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 IF NOT p_teste THEN RETURN jsonb_build_object('ok',false); END IF;
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
CREATE FUNCTION public.qf_livre_preparar_acesso(p_teste boolean DEFAULT false,p_documento text DEFAULT '',p_telefone text DEFAULT '') RETURNS jsonb LANGUAGE sql SET search_path='' AS $$SELECT private.qf_livre_preparar_acesso(p_teste,p_documento,p_telefone)$$;

ALTER FUNCTION public.qf_livre_status() RENAME TO qf_livre_status_pago;
CREATE FUNCTION private.qf_livre_status_beneficio() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; b private.qf_livre_beneficios;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false); END IF;
 s:=public.qf_livre_status_pago();
 SELECT * INTO b FROM private.qf_livre_beneficios WHERE user_id=auth.uid() AND encerrado_em IS NULL
 ORDER BY (inicio_em<=now() AND fim_em>clock_timestamp()) DESC NULLS LAST,fim_em DESC NULLS LAST LIMIT 1;
 IF coalesce((s->>'ativo')::boolean,false) THEN RETURN s||jsonb_build_object('tipo_acesso','pago'); END IF;
 RETURN s||jsonb_build_object('ativo',coalesce(b.inicio_em<=now() AND b.fim_em>clock_timestamp(),false),
 'tipo_acesso',b.tipo,'valido_ate',b.fim_em,'aguarda_identificacao',b.id IS NOT NULL AND b.inicio_em IS NULL,
 'teste_utilizado',EXISTS(SELECT 1 FROM private.qf_livre_beneficios WHERE user_id=auth.uid() AND tipo='teste'),
 'teste_vencido',b.tipo='teste' AND b.fim_em<=clock_timestamp(),'servidor_agora',clock_timestamp());
END $$;
CREATE FUNCTION public.qf_livre_status() RETURNS jsonb LANGUAGE sql SET search_path='' AS $$SELECT private.qf_livre_status_beneficio()$$;

CREATE FUNCTION private.qf_admin_livre_beneficio(p_email text,p_acao text,p_dias integer DEFAULT 2,p_motivo text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE em text:=lower(trim(p_email)); uid uuid; b private.qf_livre_beneficios; inicio timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT private.qf_is_admin() THEN RAISE EXCEPTION 'Acesso administrativo obrigatório' USING ERRCODE='42501'; END IF;
 IF length(trim(p_motivo))<5 THEN RAISE EXCEPTION 'Informe o motivo com pelo menos 5 caracteres'; END IF;
 IF p_acao NOT IN ('ativar','prorrogar','encerrar') OR p_dias IS NULL OR p_dias NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'Ação ou prazo inválido (1 a 365 dias)'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(em,0));
 SELECT u.id INTO uid FROM auth.users u WHERE lower(trim(u.email))=em AND u.email_confirmed_at IS NOT NULL;
 IF uid IS NOT NULL AND EXISTS(SELECT 1 FROM public.qf_profiles WHERE id=uid AND tipo<>'profissional') THEN RAISE EXCEPTION 'Este e-mail pertence a uma conta de outro tipo'; END IF;
 IF uid IS NOT NULL AND p_acao<>'encerrar' AND private.qf_livre_acesso_pago_ok(uid) THEN RAISE EXCEPTION 'Assinatura paga ativa. Nenhuma alteração realizada.'; END IF;
 SELECT * INTO b FROM private.qf_livre_beneficios WHERE email=em AND tipo='cortesia' AND encerrado_em IS NULL ORDER BY criado_em DESC LIMIT 1 FOR UPDATE;
 IF p_acao='encerrar' THEN
  IF b.id IS NULL THEN RAISE EXCEPTION 'Nenhuma cortesia aberta'; END IF;
  UPDATE private.qf_livre_beneficios SET encerrado_em=clock_timestamp(),motivo=p_motivo WHERE id=b.id RETURNING * INTO b;
 ELSIF p_acao='prorrogar' THEN
  IF b.id IS NULL THEN RAISE EXCEPTION 'Nenhuma cortesia para prorrogar'; END IF;
  IF b.inicio_em IS NULL THEN
   IF b.dias+p_dias>365 THEN RAISE EXCEPTION 'Limite de 365 dias'; END IF;
   UPDATE private.qf_livre_beneficios SET dias=dias+p_dias,motivo=p_motivo WHERE id=b.id RETURNING * INTO b;
  ELSE
   IF greatest(b.fim_em,clock_timestamp())+make_interval(days=>p_dias)>clock_timestamp()+interval '365 days' THEN RAISE EXCEPTION 'Limite de 365 dias'; END IF;
   UPDATE private.qf_livre_beneficios SET fim_em=greatest(fim_em,clock_timestamp())+make_interval(days=>p_dias),motivo=p_motivo WHERE id=b.id RETURNING * INTO b;
  END IF;
 ELSE
  IF b.id IS NOT NULL AND (b.inicio_em IS NULL OR b.fim_em>clock_timestamp()) THEN RAISE EXCEPTION 'Cortesia existente. Utilize Prorrogar.'; END IF;
  IF uid IS NOT NULL AND EXISTS(SELECT 1 FROM private.qf_livre_beneficios WHERE user_id=uid AND encerrado_em IS NULL AND fim_em>clock_timestamp()) THEN RAISE EXCEPTION 'Teste ou cortesia ativa. Aguarde o vencimento antes de ativar outra liberação.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.qf_pre_cadastro_pagamentos WHERE lower(trim(email))=em) AND NOT EXISTS(SELECT 1 FROM public.qf_profissionais WHERE user_id=uid) THEN RAISE EXCEPTION 'Cadastro não encontrado'; END IF;
  IF EXISTS(SELECT 1 FROM public.qf_profissionais WHERE user_id=uid AND nullif(documento,'') IS NOT NULL) THEN inicio:=clock_timestamp(); END IF;
  INSERT INTO private.qf_livre_beneficios(user_id,email,pre_cadastro_id,tipo,dias,inicio_em,fim_em,motivo,criado_por)
  VALUES(uid,em,(SELECT id FROM public.qf_pre_cadastro_pagamentos WHERE lower(trim(email))=em ORDER BY criado_em DESC LIMIT 1),'cortesia',p_dias,inicio,inicio+make_interval(days=>p_dias),p_motivo,auth.uid()) RETURNING * INTO b;
 END IF;
 RETURN jsonb_build_object('ok',true,'beneficio',to_jsonb(b),'aguarda_identificacao',b.inicio_em IS NULL);
END $$;
CREATE FUNCTION public.qf_admin_livre_beneficio(p_email text,p_acao text,p_dias integer DEFAULT 2,p_motivo text DEFAULT '') RETURNS jsonb LANGUAGE sql SET search_path='' AS $$SELECT private.qf_admin_livre_beneficio(p_email,p_acao,p_dias,p_motivo)$$;

CREATE FUNCTION private.qf_admin_livre_contato(p_email text,p_canal text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE em text:=lower(trim(p_email));
BEGIN
 IF auth.uid() IS NULL OR NOT private.qf_is_admin() THEN RAISE EXCEPTION 'Acesso administrativo obrigatório' USING ERRCODE='42501'; END IF;
 IF p_canal NOT IN ('email','whatsapp','recusa') THEN RAISE EXCEPTION 'Canal inválido'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.qf_pre_cadastro_pagamentos WHERE lower(trim(email))=em) AND NOT EXISTS(SELECT 1 FROM public.qf_profiles WHERE lower(trim(email))=em) THEN RAISE EXCEPTION 'Cadastro não encontrado'; END IF;
 IF p_canal<>'recusa' AND EXISTS(SELECT 1 FROM private.qf_livre_contatos WHERE email=em AND canal='recusa') THEN RAISE EXCEPTION 'Contato recusado pelo interessado'; END IF;
 INSERT INTO private.qf_livre_contatos(email,canal,responsavel) VALUES(em,p_canal,auth.uid());
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION public.qf_admin_livre_contato(p_email text,p_canal text) RETURNS jsonb LANGUAGE sql SET search_path='' AS $$SELECT private.qf_admin_livre_contato(p_email,p_canal)$$;

CREATE FUNCTION private.qf_admin_livre_painel(p_busca text DEFAULT '',p_situacao text DEFAULT 'todos',p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE itens jsonb; total integer; kpis jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT private.qf_is_admin() THEN RAISE EXCEPTION 'Acesso administrativo obrigatório' USING ERRCODE='42501'; END IF;
 WITH base AS (
 SELECT DISTINCT ON(lower(trim(email))) id,email,nome,telefone,profissional_id,status,criado_em FROM public.qf_pre_cadastro_pagamentos ORDER BY lower(trim(email)),criado_em DESC
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
CREATE FUNCTION public.qf_admin_livre_painel(p_busca text DEFAULT '',p_situacao text DEFAULT 'todos',p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE sql SET search_path='' AS $$SELECT private.qf_admin_livre_painel(p_busca,p_situacao,p_offset)$$;

-- Public wrappers are invokers; privileged work stays private with explicit authorization.
REVOKE ALL ON FUNCTION public.qf_livre_status(),public.qf_livre_preparar_acesso(boolean,text,text),public.qf_admin_livre_beneficio(text,text,integer,text),public.qf_admin_livre_contato(text,text),public.qf_admin_livre_painel(text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.qf_livre_status(),public.qf_livre_preparar_acesso(boolean,text,text),public.qf_admin_livre_beneficio(text,text,integer,text),public.qf_admin_livre_contato(text,text),public.qf_admin_livre_painel(text,text,integer) TO authenticated;
REVOKE ALL ON FUNCTION private.qf_livre_preparar_acesso(boolean,text,text),private.qf_livre_status_beneficio(),private.qf_admin_livre_beneficio(text,text,integer,text),private.qf_admin_livre_contato(text,text),private.qf_admin_livre_painel(text,text,integer),private.qf_livre_beneficio_ok(uuid),private.qf_livre_acesso_ok(uuid),private.qf_cadastro_profissional_pago(uuid),private.qf_livre_beneficio_auditar(),private.qf_livre_beneficio_iniciar() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.qf_livre_preparar_acesso(boolean,text,text),private.qf_livre_status_beneficio(),private.qf_admin_livre_beneficio(text,text,integer,text),private.qf_admin_livre_contato(text,text),private.qf_admin_livre_painel(text,text,integer) TO authenticated;
-- Identificação e conversas reconhecem o mesmo direito não financeiro.
CREATE OR REPLACE FUNCTION private.qf_livre_identificacao(p_profissional uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT private.qf_livre_acesso_ok(p_profissional)
$$;
REVOKE ALL ON FUNCTION private.qf_livre_identificacao(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.qf_livre_no_periodo(p_prof uuid,p_em timestamptz) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.qf_livre_assinaturas s JOIN public.qf_recargas r ON r.id=s.recarga_id AND r.status='aprovado' WHERE s.profissional_id=p_prof AND p_em>=s.inicio_em AND p_em<s.fim_em)
 OR EXISTS(SELECT 1 FROM private.qf_livre_beneficios b WHERE b.user_id=p_prof AND p_em>=b.inicio_em AND p_em<b.fim_em AND (b.encerrado_em IS NULL OR p_em<b.encerrado_em))
$$;
REVOKE ALL ON FUNCTION private.qf_livre_no_periodo(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
-- Reconhece contratação durante teste/cortesia, inclusive após vencimento. Mantém todas as verificações de pagamento, estorno, titularidade, comissão e chave Pix.
DO $patch$ DECLARE src text; original text; BEGIN
 IF to_regprocedure('public.qf_repasses_manuais_solicitar(uuid)') IS NOT NULL THEN
 SELECT pg_get_functiondef('public.qf_repasses_manuais_solicitar(uuid)'::regprocedure) INTO original;
 src:=replace(original,'not exists(select 1 from public.qf_livre_assinaturas s'||chr(10)||'  where s.profissional_id=v_uid and v_a.contratado_em between s.inicio_em and s.fim_em)',
 'not private.qf_livre_no_periodo(v_uid,v_a.contratado_em)');
 IF src=original THEN RAISE EXCEPTION 'Regra de saque mudou: revisar antes de aplicar'; END IF;
 EXECUTE src;
 END IF;
END $patch$;
COMMIT;
