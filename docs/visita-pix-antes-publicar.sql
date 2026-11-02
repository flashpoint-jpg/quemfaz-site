-- Quem Faz: a visita técnica de R$25 só publica o pedido após Pix Efí confirmado.
-- Pedidos gratuitos continuam sendo inseridos com status 'aberto'.
-- Os pagamentos antigos já existentes não são modificados.
DO $qf_visita_pre$
DECLARE definicao text;
BEGIN
  SELECT pg_get_functiondef('public.qf_publicar_atendimento(jsonb,jsonb)'::regprocedure) INTO definicao;
  IF (length(definicao)-length(replace(definicao,'''aberto'',false,a->>''urgencia''','')))/length('''aberto'',false,a->>''urgencia''') <> 1 THEN
    RAISE EXCEPTION 'Publicador mudou; não aplicar bloqueio de visita sem revisão';
  END IF;
  EXECUTE replace(definicao,
    '''aberto'',false,a->>''urgencia''',
    'case when a->>''visita_presencial''=''sim'' then ''aguardando_pagamento'' else ''aberto'' end,false,a->>''urgencia''');

  SELECT pg_get_functiondef('private.qf_admin_push_novo_pedido_trg()'::regprocedure) INTO definicao;
  IF position('begin'||chr(10)||'  perform private.qf_admin_recado(' in definicao)=0 THEN
    RAISE EXCEPTION 'Notificação de novo pedido mudou; revisar antes de ativar visita';
  END IF;
  EXECUTE replace(definicao,'begin'||chr(10)||'  perform private.qf_admin_recado(',
    'begin'||chr(10)||'  if new.status <> ''aberto'' then return new; end if;'||chr(10)||'  perform private.qf_admin_recado(');
END
$qf_visita_pre$;

CREATE OR REPLACE FUNCTION private.qf_visita_publicar_apos_pix()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $qf_body$
BEGIN
  IF new.status='aprovado' AND old.status IS DISTINCT FROM 'aprovado'
    AND new.valor_centavos=2500 AND new.provedor='efi'
    AND nullif(new.provedor_id,'') IS NOT NULL
    AND nullif(new.end_to_end_id,'') IS NOT NULL
    AND new.aprovado_em IS NOT NULL THEN
    UPDATE public.qf_chamados c SET status='aberto'
    WHERE c.id=new.chamado_id AND c.cliente_id=new.cliente_id
      AND c.status='aguardando_pagamento'
      AND EXISTS (SELECT 1 FROM private.qf_atendimentos a
        WHERE a.chamado_id=c.id AND a.cliente_id=c.cliente_id
        AND a.respostas->>'visita_presencial'='sim');
  END IF;
  RETURN new;
END
$qf_body$;
REVOKE ALL ON FUNCTION private.qf_visita_publicar_apos_pix() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS qf_visita_publicar_apos_pix ON public.qf_visita_pagamentos;
CREATE TRIGGER qf_visita_publicar_apos_pix
AFTER UPDATE OF status ON public.qf_visita_pagamentos
FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status AND new.status='aprovado')
EXECUTE FUNCTION private.qf_visita_publicar_apos_pix();
