begin;
alter table public.qf_comissao13_fechamentos add column if not exists cliente_concluiu_em timestamptz;
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
    or (f.cliente_resposta is not null and f.cliente_resposta<>'confirmado') or f.cobranca_status<>'nao_gerada' then
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

-- O código do pedido só é retornado depois que o chamador comprova ser o cliente.
create or replace function private.qf13_codigo_do_cliente(p_chamado uuid) returns text
language plpgsql security definer set search_path='' as $$
declare v_codigo text;
begin
 select codigo_cliente into v_codigo from private.qf13_codigos_pedido where chamado_id=p_chamado for update;
 if v_codigo is null then
  v_codigo:=private.qf13_codigo_novo();
  insert into private.qf13_codigos_pedido(chamado_id,codigo_hash,codigo_cliente)
  values(p_chamado,encode(extensions.digest(p_chamado::text||':'||v_codigo,'sha256'),'hex'),v_codigo)
  on conflict(chamado_id) do update set codigo_hash=excluded.codigo_hash,codigo_cliente=excluded.codigo_cliente;
 end if;
 return v_codigo;
end $$;
revoke all on function private.qf13_codigo_do_cliente(uuid) from public,anon,authenticated;

create or replace function private.qf13_concluir_com_codigo(p_id uuid,p_valor bigint,p_codigo text,p_concluido boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.qf_comissao13_fechamentos;v_hash text;r jsonb;
begin
 perform 1 from public.qf_chamados where id=(select chamado_id from public.qf_comissao13_fechamentos where id=p_id) for update;
 select * into f from public.qf_comissao13_fechamentos where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
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
end $$;
revoke all on function private.qf13_concluir_com_codigo(uuid,bigint,text,boolean) from public,anon,authenticated;
drop function public.qf13_acompanhar(uuid,text,text,uuid,boolean,bigint);
CREATE OR REPLACE FUNCTION public.qf13_acompanhar(p_chamado_id uuid, p_segredo text, p_acao text DEFAULT 'ver'::text, p_fechamento uuid DEFAULT NULL::uuid, p_contratou boolean DEFAULT NULL::boolean, p_valor_centavos bigint DEFAULT NULL::bigint, p_codigo text DEFAULT NULL::text, p_concluido boolean DEFAULT false)
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
  if p_acao='responder' and p_contratou then return private.qf13_concluir_com_codigo(f.id,p_valor_centavos,p_codigo,p_concluido);end if;
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
 'codigo_seguranca',private.qf13_codigo_do_cliente(p_chamado_id),'profissionais',coalesce((select jsonb_agg(jsonb_build_object('id',f0.id,'profissional',p.nome,'plano_livre_ativo',private.qf_livre_identificacao(f0.profissional_id),'status',f0.status,'valor_centavos',coalesce(f0.valor_confirmado_centavos,f0.valor_informado_centavos),'cliente_resposta',f0.cliente_resposta,'cliente_respondeu_em',f0.cliente_respondeu_em) order by f0.informado_em desc) from public.qf_comissao13_fechamentos f0 join public.qf_profiles p on p.id=f0.profissional_id where f0.chamado_id=c.id),'[]'::jsonb));
end $function$
;
drop function public.qf_chat_contratacao(uuid,uuid,text,bigint);
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
    return jsonb_build_object('ok',true,'modalidade','livre',
      'profissional_nome',(select nome from public.qf_profiles where id=v_prof),'codigo_seguranca',case when v_uid=v_cliente then private.qf13_codigo_do_cliente(p_chamado_id) else null end,'estado',v_f.status,'cliente_resposta',v_f.cliente_resposta,
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
     r:=private.qf13_concluir_com_codigo(v_f.id,p_valor_centavos,p_codigo,p_concluido);
     if not (r->>'ok')::boolean then return r;end if;
     if v_f.status='confirmado' then return r;end if;
    end;
    v_msg:='Cliente confirmou a contratação, o valor e a conclusão com o código do pedido. Comissão de 13% gerada automaticamente, com prazo de 48 horas para pagamento.';
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
CREATE OR REPLACE FUNCTION public.qf_comissao13_admin(p_id uuid, p_acao text, p_valor_centavos bigint DEFAULT NULL::bigint, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f public.qf_comissao13_fechamentos;
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin authentication required';end if;
 perform 1 from public.qf_chamados c where c.id=(select chamado_id from public.qf_comissao13_fechamentos where id=p_id) for update;
 select * into f from public.qf_comissao13_fechamentos where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','nao_encontrado');end if;
 if p_acao='confirmar' and f.status<>'contestado' and f.cliente_resposta is distinct from 'divergencia' then return jsonb_build_object('ok',false,'reason','admin_apenas_divergencias');end if;
 if p_acao='confirmar' and exists(select 1 from public.qf_comissao13_pix where fechamento_id=f.id) then return jsonb_build_object('ok',false,'reason','cobranca_existente_requer_conciliacao');end if;
 if p_acao='confirmar' then
  if f.cobranca_status='paga' then return jsonb_build_object('ok',false,'reason','comissao_ja_paga');end if;
  if f.status='confirmado' then return jsonb_build_object('ok',true,'ja_confirmado',true,'comissao_centavos',f.comissao_centavos);end if;
  if p_valor_centavos is null or p_valor_centavos not between 100 and 100000000 or length(trim(coalesce(p_observacao,'')))<5 then return jsonb_build_object('ok',false,'reason','valor_e_evidencia_obrigatorios');end if;
  if exists(select 1 from public.qf_comissao13_fechamentos where chamado_id=f.chamado_id and id<>f.id and status='confirmado') then return jsonb_build_object('ok',false,'reason','outro_confirmado');end if;
  perform 1 from public.qf_chamados where id=f.chamado_id for update;
  update public.qf_comissao13_fechamentos set status='confirmado',valor_confirmado_centavos=p_valor_centavos,comissao_centavos=round(p_valor_centavos*0.13)::bigint,cobranca_status='pendente',confirmado_por=auth.uid(),confirmado_em=now(),comissao_vence_em=now()+interval '48 hours',observacao_admin=left(p_observacao,2000) where id=p_id;
 elsif p_acao in ('nao_contratado','contestar') then
  if length(trim(coalesce(p_observacao,'')))<5 then return jsonb_build_object('ok',false,'reason','observacao_obrigatoria');end if;
  if f.cobranca_status='paga' then return jsonb_build_object('ok',false,'reason','comissao_ja_paga');end if;
  update public.qf_comissao13_fechamentos set status=case when p_acao='contestar' then 'contestado' else 'recusado' end,cobranca_status='cancelada',comissao_centavos=null,comissao_vence_em=null,observacao_admin=left(p_observacao,2000),prestado_em=now() where id=p_id;
 elsif p_acao='pago' then return jsonb_build_object('ok',false,'reason','pagamento_pelo_pix_automatico');
  if f.status<>'confirmado' then return jsonb_build_object('ok',false,'reason','comissao_nao_confirmada');end if;
  if f.cobranca_status='paga' then return jsonb_build_object('ok',true,'ja_pago',true);end if;
  if length(trim(coalesce(p_observacao,'')))<5 then return jsonb_build_object('ok',false,'reason','comprovante_obrigatorio');end if;
  update public.qf_comissao13_fechamentos set cobranca_status='paga',comissao_paga_em=now(),observacao_admin=left(p_observacao,2000) where id=p_id;
 else return jsonb_build_object('ok',false,'reason','acao_invalida');end if;
 return jsonb_build_object('ok',true);
end $function$
;
revoke all on function public.qf13_acompanhar(uuid,text,text,uuid,boolean,bigint,text,boolean) from public;
grant execute on function public.qf13_acompanhar(uuid,text,text,uuid,boolean,bigint,text,boolean) to anon,authenticated;
revoke all on function public.qf_chat_contratacao(uuid,uuid,text,bigint,text,boolean) from public,anon;
grant execute on function public.qf_chat_contratacao(uuid,uuid,text,bigint,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
