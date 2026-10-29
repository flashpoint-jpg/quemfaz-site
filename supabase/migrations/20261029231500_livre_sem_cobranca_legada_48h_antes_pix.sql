-- Somente o Plano Livre novo: sem comissão vencida por espera do Pix e sem fechamento se Pix estiver desabilitado.
CREATE OR REPLACE FUNCTION private.qf13_concluir_com_codigo(p_id uuid, p_valor bigint, p_codigo text, p_concluido boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f public.qf_comissao13_fechamentos;v_hash text;r jsonb;
begin
 perform 1 from public.qf_chamados where id=(select chamado_id from public.qf_comissao13_fechamentos where id=p_id) for update;
 select * into f from public.qf_comissao13_fechamentos where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
 -- Novas propostas Livre só podem concluir se o Pix integral estiver liberado.
 if f.descricao_proposta is not null and not exists(
  select 1 from private.qf_livre_manual_config cfg where cfg.id and cfg.habilitado and cfg.ativado_em is not null
 ) then return jsonb_build_object('ok',false,'reason','pagamento_em_preparacao');end if;
 if f.agendado_em is not null and f.agendado_em > now()
 then return jsonb_build_object('ok',false,'reason','servico_ainda_agendado','agendado_em',f.agendado_em);
 end if;
 if p_concluido is distinct from true then return jsonb_build_object('ok',false,'reason','conclusao_obrigatoria');end if;
 if p_codigo is null or p_codigo!~'^[0-9]{6}$' then return jsonb_build_object('ok',false,'reason','codigo_obrigatorio');end if;
 if f.codigo_tentativas>=5 and f.codigo_tentativa_em>now()-interval '1 hour' then return jsonb_build_object('ok',false,'reason','limite_codigo');end if;
 select codigo_hash into v_hash from private.qf13_codigos_pedido where chamado_id=f.chamado_id;
 if v_hash is null or v_hash<>encode(extensions.digest(f.chamado_id::text||':'||p_codigo,'sha256'),'hex') then
  update public.qf_comissao13_fechamentos set codigo_tentativas=case when codigo_tentativa_em is null or codigo_tentativa_em<now()-interval '1 hour' then 1 else codigo_tentativas+1 end,codigo_tentativa_em=now() where id=p_id;
  return jsonb_build_object('ok',false,'reason','codigo_invalido');
 end if;
 -- A função existente bloqueia o pedido, confere o valor e impede dois contratados e cobrança repetida.
 r:=private.qf13_confirmar_valor(p_id,p_valor);
 if coalesce((r->>'ok')::boolean,false) then
  update public.qf_comissao13_fechamentos set codigo_validado_em=coalesce(codigo_validado_em,now()),cliente_concluiu_em=coalesce(cliente_concluiu_em,now()),
  observacao_admin=case when confirmado_por is null then 'Cliente confirmou contratação, valor e conclusão com código do pedido; comissão automática de 13%' else observacao_admin end
  where id=p_id;
 end if;
 return r;
end $function$
;
CREATE OR REPLACE FUNCTION private.qf13_confirmar_valor(p_id uuid, p_valor bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f public.qf_comissao13_fechamentos; v_chamado uuid;
begin
 select chamado_id into v_chamado from public.qf_comissao13_fechamentos where id=p_id;
 perform 1 from public.qf_chamados where id=v_chamado for update;
 select * into f from public.qf_comissao13_fechamentos where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
 if exists(select 1 from public.qf_chamados where id=f.chamado_id and status in ('cancelado','expirado')) then
  return jsonb_build_object('ok',false,'reason','pedido_encerrado');end if;
 if p_valor is null or p_valor not between 100 and 100000000 or (f.contratado_em is null and p_valor is distinct from f.valor_informado_centavos) then
  return jsonb_build_object('ok',false,'reason','valor_alterado');end if;
 if f.status='confirmado' and f.cliente_resposta='confirmado' and f.valor_confirmado_centavos=p_valor then
  return jsonb_build_object('ok',true,'resposta','confirmado','comissao_devida',true,'status','confirmado');end if;
 if f.status not in ('informado','negociando') or (f.status='negociando' and f.proposta_chat_em is null)
    or (f.cliente_resposta is not null and f.cliente_resposta<>'confirmado') or f.cobranca_status<>'nao_gerada' then
  return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
 if exists(select 1 from public.qf_comissao13_fechamentos where chamado_id=f.chamado_id and id<>f.id
    and (status='confirmado' or cliente_resposta='confirmado')) then
  return jsonb_build_object('ok',false,'reason','outro_profissional_contratado');end if;
 update public.qf_comissao13_fechamentos set status='confirmado',
  valor_confirmado_centavos=p_valor,comissao_centavos=round(p_valor*0.13)::bigint,
  cliente_resposta='confirmado',cliente_respondeu_em=now(),confirmado_em=now(),
  prestado_em=coalesce(prestado_em,now()),cobranca_status='pendente',
  comissao_vence_em=case when f.descricao_proposta is not null and exists(
   select 1 from private.qf_livre_manual_config cfg where cfg.id and cfg.habilitado and cfg.ativado_em is not null
  ) then null else now()+interval '48 hours' end,
  observacao_admin='Confirmação automática: cliente confirmou a contratação e o valor com um toque'
 where id=f.id;
 return jsonb_build_object('ok',true,'resposta','confirmado','comissao_devida',true,'status','confirmado');
end $function$
;
