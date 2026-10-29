CREATE OR REPLACE FUNCTION public.qf_chat_contratacao(p_chamado_id uuid, p_profissional_id uuid, p_acao text DEFAULT 'ver'::text, p_valor_centavos bigint DEFAULT NULL::bigint, p_codigo text DEFAULT NULL::text, p_concluido boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_cliente uuid;
  v_prof uuid;
  v_f public.qf_comissao13_fechamentos;
  v_valor bigint;
  v_msg text;
  v_count integer;
begin
  if v_uid is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;

  select c.cliente_id into v_cliente from public.qf_chamados c
  where c.id=p_chamado_id;
  if v_cliente is null then return jsonb_build_object('ok',false,'reason','pedido_indisponivel'); end if;

  v_prof:=coalesce(p_profissional_id,case when v_uid<>v_cliente then v_uid else null end);
  if v_prof is null or (v_uid<>v_cliente and v_uid<>v_prof) then
    return jsonb_build_object('ok',false,'reason','sem_permissao');
  end if;

  perform 1 from public.qf_chamados where id=p_chamado_id for update;
  select f.* into v_f
  from public.qf_comissao13_fechamentos f
  join public.qf_desbloqueios d on d.id=f.desbloqueio_id
  where f.chamado_id=p_chamado_id and f.profissional_id=v_prof
    and d.profissional_id=v_prof and d.chamado_id=p_chamado_id
    and d.origem='comissao13' and coalesce(d.ativo,true)
  for update of f;

  if not found then
    return jsonb_build_object('ok',false,'reason','nao_plano_livre');
  end if;
  if p_acao='ver' then
    return jsonb_build_object('ok',true,'etapas_separadas',true,'modalidade','livre',
      'profissional_nome',(select nome from public.qf_profiles where id=v_prof),'codigo_seguranca',case when v_uid=v_cliente then private.qf13_codigo_do_cliente(p_chamado_id) else null end,'contratado_em',v_f.contratado_em,'valor_aceito_centavos',v_f.valor_aceito_centavos,'cliente_concluiu_em',v_f.cliente_concluiu_em,'estado',v_f.status,'cliente_resposta',v_f.cliente_resposta,
      'valor_centavos',v_f.valor_informado_centavos,
      'valor_confirmado_centavos',v_f.valor_confirmado_centavos,
      'proposta_em',v_f.proposta_chat_em,
      'cliente_respondeu_em',v_f.cliente_respondeu_em,
      'aguarda_aprovacao_admin',false,'comissao_vence_em',v_f.comissao_vence_em,'comissao_centavos',v_f.comissao_centavos,
      'pagamento_plataforma',exists(select 1 from private.qf_livre_manual_config cfg where cfg.id and cfg.habilitado and cfg.ativado_em is not null and v_f.confirmado_em>=cfg.ativado_em) and not exists(select 1 from public.qf_comissao13_pix pix where pix.fechamento_id=v_f.id),
      'papel',case when v_uid=v_cliente then 'cliente' else 'profissional' end);
  end if;

  if p_acao in ('contratar','negociando') then
    if v_uid<>v_cliente then return jsonb_build_object('ok',false,'reason','sem_permissao');end if;
    return private.qf13_responder_etapa(v_f.id,p_acao,p_valor_centavos);
  end if;
  if p_acao not in ('propor','aceitar','nao_fechou','nao_contratei','contestar','corrigir_valor') then
    return jsonb_build_object('ok',false,'reason','acao_invalida');
  end if;
  if exists(select 1 from public.qf_chamados c where c.id=p_chamado_id
    and c.status in ('cancelado','expirado')) then
    return jsonb_build_object('ok',false,'reason','pedido_encerrado');
  end if;

  if p_acao='propor' then
    if v_uid<>v_prof or (v_f.status not in ('pendente','negociando') and not (v_f.status='informado' and v_f.cliente_resposta='divergencia'))
       or (v_f.cliente_resposta is not null and v_f.cliente_resposta not in ('divergencia','negociando')) or v_f.cobranca_status<>'nao_gerada'
       or p_valor_centavos is null or p_valor_centavos not between 100 and 100000000 then
      return jsonb_build_object('ok',false,'reason','proposta_indisponivel');
    end if;
    update public.qf_comissao13_fechamentos set
      status='negociando', valor_informado_centavos=p_valor_centavos,
      cliente_resposta=null,cliente_respondeu_em=null,valor_confirmado_centavos=null,
      proposta_chat_em=now(), informado_em=now(),
      prazo_contas=now()+interval '48 hours'
    where id=v_f.id;
    v_msg:='Proposta enviada: R$ '||replace(to_char(p_valor_centavos/100.0,'FM999999990.00'),'.',',')||
      '. Cliente: toque em Aceitar e contratar para confirmar.';
  elsif p_acao='aceitar' then
    if v_uid<>v_cliente then return jsonb_build_object('ok',false,'reason','sem_permissao');end if;
    declare r jsonb; begin
     r:=private.qf13_concluir_com_codigo(v_f.id,p_valor_centavos,p_codigo,p_concluido);
     if not (r->>'ok')::boolean then return r;end if;
     if v_f.status='confirmado' then return r;end if;
    end;
    if exists(select 1 from private.qf_livre_manual_config cfg where cfg.id and cfg.habilitado and cfg.ativado_em is not null and now()>=cfg.ativado_em)
     and not exists(select 1 from public.qf_comissao13_pix pix where pix.fechamento_id=v_f.id) then
      v_msg:='Cliente confirmou a conclusão com código. Plano Livre: o valor integral será pago pelo Pix oficial do Quem Faz. O repasse de 87% será feito manualmente após confirmação bancária.';
    else
      v_msg:='Cliente confirmou a contratação, o valor e a conclusão com o código do pedido. Comissão de 13% gerada automaticamente, com prazo de 48 horas para pagamento.';
    end if;
  elsif p_acao='corrigir_valor' then
    if v_uid<>v_cliente or v_f.status not in ('negociando','informado') or v_f.valor_informado_centavos is null then
     return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
    update public.qf_comissao13_fechamentos set contratado_em=null,valor_aceito_centavos=null,cliente_resposta='divergencia',cliente_respondeu_em=now() where id=v_f.id;
    v_msg:='O cliente solicitou correção do valor. Profissional: confira o combinado e envie novamente. Nenhuma comissão foi gerada.';
  elsif p_acao='nao_fechou' then
    if v_uid<>v_prof or v_f.status not in ('pendente','negociando')
       or v_f.cliente_resposta='confirmado' then
      return jsonb_build_object('ok',false,'reason','prestacao_indisponivel');
    end if;
    update public.qf_comissao13_fechamentos set status='recusado',
      prestado_em=now(),informado_em=now(),proposta_chat_em=null
      where id=v_f.id;
    v_msg:='O profissional informou que não fechou este serviço. Cliente: confirme se contratou ou não.';
  elsif p_acao='nao_contratei' then
    if v_uid<>v_cliente or v_f.status='confirmado' then
      return jsonb_build_object('ok',false,'reason','resposta_indisponivel');
    end if;
    update public.qf_comissao13_fechamentos set
      contratado_em=null,valor_aceito_centavos=null,cliente_resposta='nao_contratou',cliente_respondeu_em=now(),
      status=case when status in ('pendente','negociando') then 'recusado' else status end,
      proposta_chat_em=case when status in ('pendente','negociando') then null else proposta_chat_em end
      where id=v_f.id;
    v_msg:='O cliente informou que NÃO contratou este profissional. Registro mantido para conferência.';
  elsif p_acao='contestar' then
    if v_uid<>v_cliente or v_f.status not in ('recusado','contestado') then
      return jsonb_build_object('ok',false,'reason','contestacao_indisponivel');
    end if;
    update public.qf_comissao13_fechamentos set
      cliente_resposta='divergencia',cliente_respondeu_em=now()
      where id=v_f.id;
    v_msg:='O cliente informou que contratou, mas o profissional declarou que não fechou. Divergência para revisão administrativa.';
  end if;

  insert into public.qf_chat_mensagens(chamado_id,profissional_id,remetente_id,mensagem,tipo)
  values(p_chamado_id,v_prof,v_uid,v_msg,'sistema');
  -- Push já direcionado ao participante oposto; a Edge Function usa esta última mensagem.
  perform private.qf_push_interno('chat_message',p_chamado_id);

  return jsonb_build_object('ok',true,'acao',p_acao,'registrado',true,
    'comissao_devida',p_acao='aceitar','requer_aprovacao_admin',false);
end;
$function$
