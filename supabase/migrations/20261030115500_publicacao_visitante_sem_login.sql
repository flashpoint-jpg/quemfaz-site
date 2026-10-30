-- Publicação sem login: um pedido de visitante usa identidade NOVA,
-- sem assumir o cadastro que já tem aquele telefone.
ALTER TABLE public.qf_profiles
  ADD COLUMN IF NOT EXISTS visitante_sem_cadastro boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.qf_profiles.visitante_sem_cadastro IS
  'Identidade temporaria isolada para publicar sem Google/senha; nunca usada para login por telefone.';

-- A marca é calculada exclusivamente por metadata gerenciada pelo servidor.
-- Um usuário autenticado não pode se promover a visitante mudando o perfil.
CREATE OR REPLACE FUNCTION public.qf_impor_perfil_visitante()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  NEW.visitante_sem_cadastro := coalesce(
    (select (u.raw_app_meta_data->>'qf_guest') = 'true'
       from auth.users u where u.id=NEW.id), false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qf_impor_perfil_visitante ON public.qf_profiles;
CREATE TRIGGER trg_qf_impor_perfil_visitante
BEFORE INSERT OR UPDATE OF visitante_sem_cadastro ON public.qf_profiles
FOR EACH ROW EXECUTE FUNCTION public.qf_impor_perfil_visitante();

-- Continua proibido duplicar telefone de contas normais. Apenas perfis de
-- visitante, que não podem recuperar contas anteriores, ficam fora do índice.
DROP INDEX IF EXISTS public.qf_profiles_cliente_telefone_unico;
CREATE UNIQUE INDEX qf_profiles_cliente_telefone_unico
  ON public.qf_profiles
    (public.qf_normalizar_whatsapp(coalesce(nullif(whatsapp,''), telefone)))
  WHERE tipo='cliente' AND visitante_sem_cadastro=false
    AND public.qf_normalizar_whatsapp(coalesce(nullif(whatsapp,''),telefone))<>'';

-- Login por telefone/código e cadastro antigo nunca selecionam identidade
-- de visitante, mesmo se o visitante publicar antes da conta normal existir.
CREATE OR REPLACE FUNCTION public.qf_cliente_canonico_por_whatsapp(p_whatsapp text)
RETURNS TABLE(id uuid, nome text, email text, telefone text, whatsapp text, criado_em timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select p.id, p.nome, p.email, p.telefone, p.whatsapp, p.criado_em
    from public.qf_profiles p
   where p.tipo='cliente'
     and p.visitante_sem_cadastro=false
     and public.qf_normalizar_whatsapp(coalesce(nullif(p.whatsapp,''),p.telefone))
         = public.qf_normalizar_whatsapp(p_whatsapp)
     and public.qf_normalizar_whatsapp(p_whatsapp)<>''
   order by p.criado_em asc,p.id asc limit 1;
$$;