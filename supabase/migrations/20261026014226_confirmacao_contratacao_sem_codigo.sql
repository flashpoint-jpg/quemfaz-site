begin;
-- Apenas confirma o valor exibido ao cliente; não aceita código ou silêncio como consentimento.
create or replace function private.qf13_confirmar_valor(p_id uuid,p_valor bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.qf_comissao13_fechamentos; v_chamado uuid;
begin
 select chamado_id into v_chamado from public.qf_comissao13_fechamentos where id=p_id;
 perform 1 from public.qf_chamados where id=v_chamado for update;
 select * into f from public.qf_comissao13_fechamentos where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
 if exists(select 1 from public.qf_chamados where id=f.chamado_id and status in ('cancelado','expirado')) then
  return jsonb_build_object('ok',false,'reason','pedido_encerrado');end if;
 if p_valor is null or p_valor not between 100 and 100000000 or p_valor is distinct from f.valor_informado_centavos then
  return jsonb_build_object('ok',false,'reason','valor_alterado');end if;
 if f.status='confirmado' and f.cliente_resposta='confirmado' and f.valor_confirmado_centavos=p_valor then
  return jsonb_build_object('ok',true,'resposta','confirmado','comissao_devida',true,'status','confirmado');end if;
 if f.status not in ('informado','negociando') or (f.status='negociando' and f.proposta_chat_em is null)
    or f.cliente_resposta is not null or f.cobranca_status<>'nao_gerada' then
  return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
 if exists(select 1 from public.qf_comissao13_fechamentos where chamado_id=f.chamado_id and id<>f.id
    and (status='confirmado' or cliente_resposta='confirmado')) then
  return jsonb_build_object('ok',false,'reason','outro_profissional_contratado');end if;
 update public.qf_comissao13_fechamentos set status='confirmado',
  valor_confirmado_centavos=p_valor,comissao_centavos=round(p_valor*0.13)::bigint,
  cliente_resposta='confirmado',cliente_respondeu_em=now(),confirmado_em=now(),
  prestado_em=coalesce(prestado_em,now()),cobranca_status='pendente',
  comissao_vence_em=now()+interval '48 hours',
  observacao_admin='Confirmação automática: cliente confirmou a contratação e o valor com um toque'
 where id=f.id;
 return jsonb_build_object('ok',true,'resposta','confirmado','comissao_devida',true,'status','confirmado');
end $$;
revoke all on function private.qf13_confirmar_valor(uuid,bigint) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.qf_comissao13_prestar_contas(p_id uuid, p_situacao text, p_valor_centavos bigint DEFAULT NULL::bigint, p_codigo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f public.qf_comissao13_fechamentos;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 perform 1 from public.qf_chamados where id=(select chamado_id from public.qf_comissao13_fechamentos where id=p_id and profissional_id=auth.uid()) for update;
 select * into f from public.qf_comissao13_fechamentos where id=p_id and profissional_id=auth.uid() for update;
 if not found then return jsonb_build_object('ok',false,'reason','sem_permissao');end if;
 if f.status not in ('pendente','negociando') and not (f.status='informado' and f.cliente_resposta='divergencia' and f.cobranca_status='nao_gerada') then return jsonb_build_object('ok',false,'reason','ja_prestado');end if;
 if p_situacao is null or p_situacao not in ('informado','negociando','recusado') then return jsonb_build_object('ok',false,'reason','situacao_invalida');end if;
 if p_situacao='negociando' and f.prorrogacoes_negociacao>=1 then return jsonb_build_object('ok',false,'reason','limite_prorrogacao');end if;
 if p_situacao='informado' then
  if p_valor_centavos is null or p_valor_centavos not between 100 and 100000000 then return jsonb_build_object('ok',false,'reason','valor_invalido');end if;

 end if;
 update public.qf_comissao13_fechamentos set status=p_situacao,
 valor_informado_centavos=case when p_situacao='informado' then p_valor_centavos else null end,prestado_em=now(),informado_em=now(),
 prazo_contas=case when p_situacao='negociando' then now()+interval '48 hours' else prazo_contas end,
 prorrogacoes_negociacao=case when p_situacao='negociando' then prorrogacoes_negociacao+1 else prorrogacoes_negociacao end,
 codigo_validado_em=null,cliente_resposta=null,cliente_respondeu_em=null,valor_confirmado_centavos=null,proposta_chat_em=case when p_situacao='informado' then now() else null end where id=p_id;
 return jsonb_build_object('ok',true,'status',p_situacao,'comissao_devida',false);
end $function$
;
drop function public.qf13_acompanhar(uuid,text,text,uuid,boolean);
CREATE OR REPLACE FUNCTION public.qf13_acompanhar(p_chamado_id uuid, p_segredo text, p_acao text DEFAULT 'ver'::text, p_fechamento uuid DEFAULT NULL::uuid, p_contratou boolean DEFAULT NULL::boolean, p_valor_centavos bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k private.qf13_codigos_pedido; f public.qf_comissao13_fechamentos; c public.qf_chamados; v_resposta text;
begin
 if p_segredo is null or p_segredo!~'^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 select * into k from private.qf13_codigos_pedido where chamado_id=p_chamado_id and proprietario_hash=encode(extensions.digest(p_segredo,'sha256'),'hex');
 if not found then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 if p_acao in ('responder','corrigir_valor') then
  if p_acao='responder' and p_contratou is null then return jsonb_build_object('ok',false,'reason','resposta_obrigatoria');end if;
  perform 1 from public.qf_chamados where id=p_chamado_id for update;
  select * into f from public.qf_comissao13_fechamentos where id=p_fechamento and chamado_id=p_chamado_id for update;
  if not found or f.status not in ('pendente','negociando','informado','recusado','confirmado','contestado') then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
  if p_acao='responder' and p_contratou then return private.qf13_confirmar_valor(f.id,p_valor_centavos);end if;
  if f.status='confirmado' then return jsonb_build_object('ok',false,'reason','resposta_indisponivel');end if;
  if p_acao='corrigir_valor' then
   if f.status not in ('informado','negociando') or f.valor_informado_centavos is null then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
   update public.qf_comissao13_fechamentos set cliente_resposta='divergencia',cliente_respondeu_em=now() where id=f.id;
   return jsonb_build_object('ok',true,'resposta','divergencia','comissao_devida',false);
  end if;
  v_resposta:=case when p_contratou then case when f.status in ('recusado','contestado') then 'divergencia' else 'confirmado' end else 'nao_contratou' end;
  if f.cliente_resposta is distinct from v_resposta then
   update public.qf_comissao13_fechamentos set cliente_resposta=v_resposta,cliente_respondeu_em=now() where id=f.id;
  end if;
  return jsonb_build_object('ok',true,'resposta',v_resposta,'requer_analise_admin',true,'comissao_devida',false);
 elsif p_acao<>'ver' then return jsonb_build_object('ok',false,'reason','acao_invalida');end if;
 select * into c from public.qf_chamados where id=p_chamado_id;
 return jsonb_build_object('ok',true,'confirmacao_em_um_toque',true,'pedido',jsonb_build_object('id',c.id,'titulo',c.titulo,'cidade',c.cidade,'bairro',c.bairro,'status',c.status,
    'canal_contato',coalesce((select a.respostas->>'canal_contato'
      from private.qf_atendimentos a where a.chamado_id=c.id),'whatsapp'),
    'criado_em',c.criado_em),
 'profissionais',coalesce((select jsonb_agg(jsonb_build_object('id',f0.id,'profissional',p.nome,'plano_livre_ativo',private.qf_livre_identificacao(f0.profissional_id),'status',f0.status,'valor_centavos',coalesce(f0.valor_confirmado_centavos,f0.valor_informado_centavos),'cliente_resposta',f0.cliente_resposta,'cliente_respondeu_em',f0.cliente_respondeu_em) order by f0.informado_em desc) from public.qf_comissao13_fechamentos f0 join public.qf_profiles p on p.id=f0.profissional_id where f0.chamado_id=c.id),'[]'::jsonb));
end $function$
;
CREATE OR REPLACE FUNCTION public.qf_chat_contratacao(p_chamado_id uuid, p_profissional_id uuid, p_acao text DEFAULT 'ver'::text, p_valor_centavos bigint DEFAULT NULL::bigint)
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
    return jsonb_build_object('ok',true,'modalidade','livre',
      'estado',v_f.status,'cliente_resposta',v_f.cliente_resposta,
      'valor_centavos',v_f.valor_informado_centavos,
      'valor_confirmado_centavos',v_f.valor_confirmado_centavos,
      'proposta_em',v_f.proposta_chat_em,
      'cliente_respondeu_em',v_f.cliente_respondeu_em,
      'aguarda_aprovacao_admin',false,'comissao_vence_em',v_f.comissao_vence_em,'comissao_centavos',v_f.comissao_centavos,
      'papel',case when v_uid=v_cliente then 'cliente' else 'profissional' end);
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
       or (v_f.cliente_resposta is not null and v_f.cliente_resposta<>'divergencia') or v_f.cobranca_status<>'nao_gerada'
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
     r:=private.qf13_confirmar_valor(v_f.id,p_valor_centavos);
     if not (r->>'ok')::boolean then return r;end if;
     if v_f.status='confirmado' then return r;end if;
    end;
    v_msg:='Cliente confirmou a contratação e o valor. Comissão de 13% gerada automaticamente, com prazo de 48 horas para pagamento.';
  elsif p_acao='corrigir_valor' then
    if v_uid<>v_cliente or v_f.status not in ('negociando','informado') or v_f.valor_informado_centavos is null then
     return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
    update public.qf_comissao13_fechamentos set cliente_resposta='divergencia',cliente_respondeu_em=now() where id=v_f.id;
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
      cliente_resposta='nao_contratou',cliente_respondeu_em=now(),
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
;
CREATE OR REPLACE FUNCTION private.qf_comissao13_automatico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v bigint;
BEGIN
 IF new.status='confirmado' AND new.cobranca_status='pendente'
    AND new.comissao_centavos>0 THEN
    INSERT INTO public.qf_comissao13_pix (fechamento_id,profissional_id,valor_centavos)
    VALUES (new.id,new.profissional_id,new.comissao_centavos)
    ON CONFLICT(fechamento_id) DO NOTHING;
 END IF;
 RETURN NULL;
END $function$
;

revoke all on function public.qf_comissao13_prestar_contas(uuid,text,bigint,text) from public,anon;
grant execute on function public.qf_comissao13_prestar_contas(uuid,text,bigint,text) to authenticated;
revoke all on function public.qf13_acompanhar(uuid,text,text,uuid,boolean,bigint) from public;
grant execute on function public.qf13_acompanhar(uuid,text,text,uuid,boolean,bigint) to anon,authenticated;
revoke all on function public.qf_chat_contratacao(uuid,uuid,text,bigint) from public,anon;
grant execute on function public.qf_chat_contratacao(uuid,uuid,text,bigint) to authenticated;
revoke all on function private.qf_comissao13_automatico() from public,anon,authenticated;
create or replace function public.qf13_codigo_cliente(p_chamado_id uuid) returns jsonb
language sql set search_path='' as $$select jsonb_build_object('ok',false,'reason','confirmacao_sem_codigo')$$;

create or replace function private.qf13_bloqueio(p_prof uuid) returns text
language sql stable security definer set search_path='' as $$
 select case
 when exists(select 1 from public.qf_comissao13_fechamentos where profissional_id=p_prof and status='confirmado' and cobranca_status='pendente' and comissao_vence_em<=now()) then 'comissao_pendente'
 when exists(select 1 from public.qf_comissao13_fechamentos where profissional_id=p_prof and status in ('pendente','negociando') and proposta_chat_em is null and prazo_contas<now()) then 'prestacao_contas_vencida'
 else null end
$$;
revoke all on function private.qf13_bloqueio(uuid) from public,anon,authenticated;
commit;
