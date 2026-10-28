-- Teste PostgreSQL ISOLADO: não usa credenciais/dados de produção e não gera cobranças.
\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
CREATE TABLE public.qf_profiles(
 id uuid PRIMARY KEY REFERENCES auth.users(id),tipo text NOT NULL,ativo boolean DEFAULT true
);
CREATE TABLE public.qf_profissionais(user_id uuid PRIMARY KEY REFERENCES public.qf_profiles(id));
CREATE TABLE public.qf_planos_catalogo(
 plano text PRIMARY KEY,nome text,preco_centavos integer NOT NULL,
 chamados integer NOT NULL,dias integer NOT NULL,ativo boolean NOT NULL DEFAULT true
);
ALTER TABLE public.qf_planos_catalogo ADD CONSTRAINT qf_planos_catalogo_plano_check
 CHECK (plano IN ('mensal','pro','premium'));
INSERT INTO public.qf_planos_catalogo VALUES
 ('mensal','Mensal',4990,7,30,true),('pro','Pro',9990,15,30,true),('premium','Premium',19990,35,30,true);
CREATE TABLE public.qf_pre_cadastro_pagamentos(
 id uuid PRIMARY KEY,segredo text,email text,nome text,telefone text,
 plano text REFERENCES public.qf_planos_catalogo(plano),valor_centavos integer,
 metodo text,status text,provedor text,provedor_id text,checkout_url text,
 profissional_id uuid REFERENCES public.qf_profissionais(user_id),recarga_id uuid,
 criado_em timestamptz DEFAULT now(),aprovado_em timestamptz,resgatado_em timestamptz
);
CREATE TABLE public.qf_recargas(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),profissional_id uuid REFERENCES public.qf_profissionais(user_id),
 valor_centavos integer,metodo text,status text,provedor text,provedor_id text,plano text
);
CREATE TABLE public.qf_carteiras(profissional_id uuid PRIMARY KEY,saldo_centavos integer DEFAULT 0);
CREATE TABLE public.qf_movimentacoes_carteira(
 profissional_id uuid,tipo text,valor_centavos integer,referencia_tipo text,referencia_id uuid
);
CREATE TABLE public.qf_livre_assinaturas(
 profissional_id uuid,recarga_id uuid UNIQUE,valor_centavos integer,
 inicio_em timestamptz,fim_em timestamptz
);
-- Simula SOMENTE a baixa financeira já existente em produção: esta fixture não a homologa.
CREATE FUNCTION private.qf_fixture_creditar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF new.status='aprovado' AND old.status IS DISTINCT FROM 'aprovado' THEN
   IF new.plano='livre' THEN
     INSERT INTO public.qf_livre_assinaturas
     VALUES(new.profissional_id,new.id,3990,now(),now()+interval '30 days');
   ELSIF new.plano IS NULL THEN
     INSERT INTO public.qf_carteiras VALUES(new.profissional_id,new.valor_centavos)
     ON CONFLICT(profissional_id) DO UPDATE
       SET saldo_centavos=qf_carteiras.saldo_centavos+EXCLUDED.saldo_centavos;
     INSERT INTO public.qf_movimentacoes_carteira
     VALUES(new.profissional_id,'credito',new.valor_centavos,'recarga',new.id);
   END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER qf_recarga_pagamento_aplicado AFTER UPDATE OF status ON public.qf_recargas
 FOR EACH ROW EXECUTE FUNCTION private.qf_fixture_creditar();

-- Fotografia do legado: estes usuários foram criados ANTES da migração.
INSERT INTO auth.users VALUES
('00000000-0000-0000-0000-000000000001','antigo@exemplo.com',now()),
('00000000-0000-0000-0000-000000000002','avulso@exemplo.com',now()),
('00000000-0000-0000-0000-000000000003','livre@exemplo.com',now()),
('00000000-0000-0000-0000-000000000004','intruso@exemplo.com',now()),
('00000000-0000-0000-0000-000000000005','naopago@exemplo.com',now()),
('00000000-0000-0000-0000-000000000006','antigo_incompleto@exemplo.com',now());
INSERT INTO public.qf_profiles(id,tipo) VALUES
('00000000-0000-0000-0000-000000000001','profissional'),
('00000000-0000-0000-0000-000000000006','profissional');
INSERT INTO public.qf_profissionais VALUES('00000000-0000-0000-0000-000000000001');
\i supabase/2026-10-28-cadastro-pago-obrigatorio.sql

-- 1. Novos profissionais sem confirmação: INSERT não passa no backend.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000005';
DO $$ DECLARE bloqueou boolean:=false; BEGIN
 BEGIN
   INSERT INTO public.qf_profiles(id,tipo) VALUES ('00000000-0000-0000-0000-000000000005','profissional');
 EXCEPTION WHEN others THEN bloqueou=true; END;
 IF NOT bloqueou THEN RAISE EXCEPTION 'Falha: novo profissional sem pagamento criado'; END IF;
END $$;

-- 2. Perfil antigo incompleto consegue recuperar registro sem pagar de novo.
INSERT INTO public.qf_profissionais(user_id) VALUES('00000000-0000-0000-0000-000000000006');

-- 3. Pré-cadastros pendentes, aprovados, valores distintos.
INSERT INTO public.qf_pre_cadastro_pagamentos
(id,segredo,email,plano,valor_centavos,metodo,status,provedor,provedor_id) VALUES
('10000000-0000-0000-0000-000000000002','segredo-avulso-fake-123456789','avulso@exemplo.com','avulso',1300,'pix','pendente','efi','tx_avulso_fixture'),
('10000000-0000-0000-0000-000000000003','segredo-livre-fake-1234567890','livre@exemplo.com','livre',3990,'pix','aprovado','efi','tx_livre_fixture'),
('10000000-0000-0000-0000-000000000004','segredo-intruso-fake-123456789','intruso@exemplo.com','avulso',1300,'pix','pendente','efi','tx_intruso_fixture');
DO $$ BEGIN
 IF (SELECT (public.qf_vincular_pre_cadastro('10000000-0000-0000-0000-000000000002',
  'segredo-avulso-fake-123456789')->>'ok')::boolean) IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'Falha: cobrança pendente permitiu vínculo'; END IF;
END $$;

-- 4. Depois de "aprovação" simulada, titular vincula uma vez. Não houve Efí real.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
UPDATE public.qf_pre_cadastro_pagamentos SET status='aprovado'
 WHERE id='10000000-0000-0000-0000-000000000002';
DO $$ BEGIN
 IF (SELECT (public.qf_vincular_pre_cadastro('10000000-0000-0000-0000-000000000002',
   'segredo-avulso-fake-123456789')->>'ok')::boolean) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Falha: titular pago não vinculou'; END IF;
END $$;
INSERT INTO public.qf_profiles(id,tipo) VALUES('00000000-0000-0000-0000-000000000002','profissional');
INSERT INTO public.qf_profissionais(user_id) VALUES('00000000-0000-0000-0000-000000000002');

-- 5. O valor sai como recarga sem plano: 1300 integral, sem duplicação ao resgatar 2 vezes.
SELECT public.qf_resgatar_pre_cadastro('10000000-0000-0000-0000-000000000002','segredo-avulso-fake-123456789');
SELECT public.qf_resgatar_pre_cadastro('10000000-0000-0000-0000-000000000002','segredo-avulso-fake-123456789');
DO $$ BEGIN
 IF (SELECT saldo_centavos FROM public.qf_carteiras WHERE profissional_id=
  '00000000-0000-0000-0000-000000000002')<>1300
 OR (SELECT count(*) FROM public.qf_recargas WHERE profissional_id=
  '00000000-0000-0000-0000-000000000002')<>1
 OR (SELECT count(*) FROM public.qf_movimentacoes_carteira WHERE profissional_id=
  '00000000-0000-0000-0000-000000000002' AND tipo='credito')<>1
 THEN RAISE EXCEPTION 'Falha: crédito ou resgate duplicado'; END IF;
END $$;

-- 6. Outro usuário não consegue roubar pagamento aprovado de email distinto.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
DO $$ BEGIN
 IF (SELECT (public.qf_vincular_pre_cadastro('10000000-0000-0000-0000-000000000003',
  'segredo-livre-fake-1234567890')->>'ok')::boolean) IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'Falha: e-mail divergente foi aceito'; END IF;
END $$;

-- 7. Livre: 3990 em assinatura 30 dias e nenhum saldo Avulso obrigatório.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
DO $$ BEGIN
 IF (SELECT (public.qf_vincular_pre_cadastro('10000000-0000-0000-0000-000000000003',
  'segredo-livre-fake-1234567890')->>'ok')::boolean) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Falha: titular Livre aprovado nao vinculou'; END IF;
END $$;
INSERT INTO public.qf_profiles(id,tipo) VALUES('00000000-0000-0000-0000-000000000003','profissional');
INSERT INTO public.qf_profissionais(user_id) VALUES('00000000-0000-0000-0000-000000000003');
SELECT public.qf_resgatar_pre_cadastro('10000000-0000-0000-0000-000000000003','segredo-livre-fake-1234567890');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.qf_livre_assinaturas WHERE profissional_id=
    '00000000-0000-0000-0000-000000000003' AND valor_centavos=3990
    AND fim_em >= inicio_em + interval '30 days')<>1
 OR EXISTS(SELECT 1 FROM public.qf_carteiras WHERE profissional_id=
    '00000000-0000-0000-0000-000000000003' AND saldo_centavos>=1300)
 THEN RAISE EXCEPTION 'Falha: Livre não ativo ou cobrança dupla'; END IF;
END $$;
SELECT 'CADEIA DE PAGAMENTO SIMULADA OK' AS fixture_result;

-- 8. Indicadores administrativos somente para admin, sem transformar saldo em receita.
CREATE FUNCTION private.qf_is_admin() RETURNS boolean LANGUAGE sql AS
$$ SELECT current_setting('test.admin',true)='true' $$;
\i supabase/2026-10-28-cadastro-pagante-kpis.sql
SET test.admin='false';
DO $$ DECLARE blocked boolean:=false; BEGIN
 BEGIN PERFORM public.qf_admin_cadastro_pagamentos();
 EXCEPTION WHEN insufficient_privilege THEN blocked=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Falha: indicadores financeiros expostos sem admin'; END IF;
END $$;
SET test.admin='true';
DO $$ DECLARE j jsonb; BEGIN
 SELECT public.qf_admin_cadastro_pagamentos() INTO j;
 IF (j->>'avulsos_iniciais_pagos')::integer<>1 OR
    (j->>'livres_iniciais_pagos')::integer<>1 OR
    (j->>'recebido_avulso_inicial_centavos')::integer<>1300 OR
    (j->>'recebido_livre_inicial_centavos')::integer<>3990 OR
    (j->>'saldo_carteiras_total_centavos')::integer<>1300 THEN
    RAISE EXCEPTION 'Falha: admin apresentou dados financeiros divergentes %', j;
 END IF;
END $$;
SELECT 'ADMIN PAGAMENTOS SIMULADOS OK' AS admin_fixture;

-- 9. Pré-cadastros visíveis no admin ANTES de pagar e invisíveis a não administradores.
\i supabase/migrations/20261028191000_admin_pre_cadastros.sql
SET test.admin='false';
DO $$ DECLARE bloqueou boolean:=false; BEGIN
 BEGIN PERFORM public.qf_admin_pre_cadastros();
 EXCEPTION WHEN insufficient_privilege THEN bloqueou=true; END;
 IF NOT bloqueou THEN RAISE EXCEPTION 'Pré-cadastros expostos a usuário não administrador'; END IF;
END $$;
SET test.admin='true';
DO $$ DECLARE d jsonb; it jsonb; BEGIN
 SELECT public.qf_admin_pre_cadastros(50,0,'','todos') INTO d;
 IF (d->>'total')::integer<>3 THEN RAISE EXCEPTION 'Esperados três pré-cadastros: %',d; END IF;
 SELECT public.qf_admin_pre_cadastros(50,0,'intruso','pendente') INTO d;
 IF (d->>'total')::integer<>1 THEN RAISE EXCEPTION 'Não encontrou interessado não pago: %',d; END IF;
 it:=d->'itens'->0;
 IF it->>'status'<>'pendente' OR it->>'etapa'<>'aguardando_pagamento'
    OR it->>'profissional_id' IS NOT NULL
    OR it ? 'segredo' OR it ? 'checkout_url' THEN
   RAISE EXCEPTION 'Dados incorretos ou segredos expostos: %',it;
 END IF;
 SELECT public.qf_admin_pre_cadastros(50,0,'avulso@exemplo.com','ativado') INTO d;
 IF (d->>'total')::integer<>1 OR (d->'itens'->0->>'perfil_ativo')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Ativação paga não apareceu no painel: %',d;
 END IF;
END $$;
SELECT 'PRE-CADASTROS VISIVEIS E PROTEGIDOS OK' AS cadastros_admin;
