begin;
-- Additive: do not backfill acceptance, completion, balances or overdue restrictions.
alter table public.qf_comissao13_fechamentos
 add column if not exists contratado_em timestamptz,
 add column if not exists valor_aceito_centavos bigint check(valor_aceito_centavos between 100 and 100000000),
 add column if not exists cliente_negociando_em timestamptz;

create or replace function private.qf13_responder_etapa(p_id uuid,p_acao text,p_valor bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.qf_comissao13_fechamentos; v_cliente uuid; v_msg text;
begin
 perform 1 from public.qf_chamados where id=(select chamado_id from public.qf_comissao13_fechamentos where id=p_id) for update;
 select * into f from public.qf_comissao13_fechamentos where id=p_id for update;
 if not found or f.status not in ('negociando','informado') or f.cobranca_status<>'nao_gerada' or f.valor_informado_centavos is null then
  return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
 select cliente_id into v_cliente from public.qf_chamados where id=f.chamado_id and status not in ('cancelado','expirado');
 if v_cliente is null then return jsonb_build_object('ok',false,'reason','pedido_encerrado');end if;
 if p_acao='contratar' then
  if p_valor is null or p_valor is distinct from f.valor_informado_centavos then return jsonb_build_object('ok',false,'reason','valor_alterado');end if;
  if f.cliente_resposta is not null and f.cliente_resposta not in ('confirmado','negociando') then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
  if exists(select 1 from public.qf_comissao13_fechamentos where chamado_id=f.chamado_id and id<>f.id and (status='confirmado' or cliente_resposta='confirmado')) then
   return jsonb_build_object('ok',false,'reason','outro_profissional_contratado');end if;
  if f.contratado_em is not null then return jsonb_build_object('ok',true,'comissao_devida',false,'resposta','confirmado');end if;
  update public.qf_comissao13_fechamentos set contratado_em=now(),valor_aceito_centavos=p_valor,cliente_resposta='confirmado',cliente_respondeu_em=now(),prestado_em=coalesce(prestado_em,now()) where id=p_id;
  v_msg:='Cliente aceitou o orçamento e confirmou a contratação. Comissão apenas prevista; aguardando conclusão e valor final com código do pedido.';
 elsif p_acao='negociando' then
  if f.contratado_em is not null or f.cliente_resposta='confirmado' then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
  update public.qf_comissao13_fechamentos set cliente_resposta='negociando',cliente_respondeu_em=now(),cliente_negociando_em=now() where id=p_id;
  v_msg:='Cliente informou que ainda está negociando. Nenhuma comissão devida.';
 else return jsonb_build_object('ok',false,'reason','acao_invalida');end if;
 insert into public.qf_chat_mensagens(chamado_id,profissional_id,remetente_id,mensagem,tipo) values(f.chamado_id,f.profissional_id,v_cliente,v_msg,'sistema');
 perform private.qf_push_interno('chat_message',f.chamado_id);
 return jsonb_build_object('ok',true,'comissao_devida',false,'resposta',case when p_acao='contratar' then 'confirmado' else 'negociando' end);
end $$;
revoke all on function private.qf13_responder_etapa(uuid,text,bigint) from public,anon,authenticated;

-- Centralized, admin-only projection. No customer phone or conversation is exposed through the professional RPC.
-- Keep the deployed privacy protection in migration history as well (older fixtures lacked it).
create or replace function public.qf_comissao13_fechamentos_painel()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'authentication required';end if;
 return coalesce((select jsonb_agg(x order by x.informado_em desc) from (
 select f.*,p.nome as profissional,cl.nome as cliente,
 case when private.qf_is_admin() then cl.telefone else null end as telefone,
 case when private.qf_is_admin() then cl.whatsapp else null end as whatsapp,c.titulo
 from public.qf_comissao13_fechamentos f join public.qf_chamados c on c.id=f.chamado_id
 join public.qf_profiles p on p.id=f.profissional_id join public.qf_profiles cl on cl.id=c.cliente_id
 where f.profissional_id=auth.uid() or private.qf_is_admin()) x),'[]'::jsonb);
end $$;
revoke all on function public.qf_comissao13_fechamentos_painel() from public,anon;
grant execute on function public.qf_comissao13_fechamentos_painel() to authenticated;

create or replace function private.qf_admin_negociacoes_dados()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.ultima_atividade desc),'[]'::jsonb) from (
 select d.id as desbloqueio_id,d.chamado_id,d.profissional_id,d.origem,d.ativo,d.criado_em as desbloqueado_em,
 p.nome as profissional,cl.nome as cliente,c.cliente_id,c.titulo,c.categoria,c.descricao,c.cidade,c.bairro,c.status as pedido_status,
 f.id as fechamento_id,f.status,f.valor_informado_centavos,f.valor_aceito_centavos,f.valor_confirmado_centavos,
 f.contratado_em,f.cliente_resposta,f.cliente_respondeu_em,f.cliente_concluiu_em,f.confirmado_em,f.confirmado_por,
 f.cobranca_status,f.comissao_centavos,f.comissao_vence_em,f.comissao_paga_em,f.prazo_contas,f.proposta_chat_em,
 f.codigo_validado_em,exists(select 1 from public.qf_comissao13_pix px where px.fechamento_id=f.id and px.pago_em is not null and px.end_to_end_id is not null) as pagamento_conciliado,private.qf13_bloqueio(d.profissional_id) as restricao_profissional,
 (select jsonb_build_object('id',m.id,'mensagem',m.mensagem,'remetente_id',m.remetente_id,'remetente',s.nome,'criado_em',m.criado_em,'lida_em',m.lida_em)
  from public.qf_chat_mensagens m left join public.qf_profiles s on s.id=m.remetente_id
  where m.chamado_id=d.chamado_id and m.profissional_id=d.profissional_id order by m.criado_em desc,m.id desc limit 1) as ultima_mensagem,
 (select count(*) from public.qf_chat_mensagens m where m.chamado_id=d.chamado_id and m.profissional_id=d.profissional_id and m.remetente_id=c.cliente_id) as mensagens_cliente,
 coalesce((select max(m.criado_em) from public.qf_chat_mensagens m where m.chamado_id=d.chamado_id and m.profissional_id=d.profissional_id),f.informado_em,d.criado_em) as ultima_atividade
 from public.qf_desbloqueios d join public.qf_chamados c on c.id=d.chamado_id
 left join public.qf_profiles p on p.id=d.profissional_id left join public.qf_profiles cl on cl.id=c.cliente_id
 left join public.qf_comissao13_fechamentos f on f.desbloqueio_id=d.id
 ) x
$$;
revoke all on function private.qf_admin_negociacoes_dados() from public,anon,authenticated;

create or replace function public.qf_admin_negociacoes()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin authentication required' using errcode='42501';end if;
 return private.qf_admin_negociacoes_dados();
end $$;
revoke all on function public.qf_admin_negociacoes() from public,anon;
grant execute on function public.qf_admin_negociacoes() to authenticated;

create table if not exists private.qf_negociacoes_acessos(
 id uuid primary key default gen_random_uuid(),ator uuid not null,desbloqueio_id uuid not null,
 acao text not null,criado_em timestamptz not null default now());
alter table private.qf_negociacoes_acessos enable row level security;
revoke all on private.qf_negociacoes_acessos from public,anon,authenticated;

create or replace function public.qf_admin_negociacao_detalhe(p_desbloqueio uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.qf_desbloqueios;f public.qf_comissao13_fechamentos;v_cliente uuid;v_autorizado boolean;v_telefone text;
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin authentication required' using errcode='42501';end if;
 select * into d from public.qf_desbloqueios where id=p_desbloqueio;
 if not found then return jsonb_build_object('ok',false,'reason','nao_encontrado');end if;
 select * into f from public.qf_comissao13_fechamentos where desbloqueio_id=d.id;
 select cliente_id into v_cliente from public.qf_chamados where id=d.chamado_id;
 select coalesce(bool_or(a.respostas->>'autorizacao'='sim'),false) into v_autorizado from private.qf_atendimentos a where a.chamado_id=d.chamado_id;
 if v_autorizado then select coalesce(nullif(whatsapp,''),telefone) into v_telefone from public.qf_profiles where id=v_cliente;end if;
 insert into private.qf_negociacoes_acessos(ator,desbloqueio_id,acao) values(auth.uid(),d.id,'leitura_detalhe');
 return jsonb_build_object('ok',true,'contato_autorizado',v_autorizado,'telefone_suporte',v_telefone,
 'recebimentos',coalesce((select jsonb_agg(jsonb_build_object('profissional',p.nome,'profissional_id',e.user_id,'evento',e.evento,'envio_status',e.envio_status,'enviado_em',e.enviado_em,'criado_em',e.criado_em,'erro',e.envio_erro) order by e.criado_em) from public.qf_push_entregas e left join public.qf_profiles p on p.id=e.user_id where e.chamado_id=d.chamado_id),'[]'::jsonb),
 'historico_pedido',coalesce((select jsonb_agg(jsonb_build_object('de',h.status_anterior,'para',h.status_novo,'criado_em',h.criado_em) order by h.criado_em) from private.qf_pedido_historico_admin h where h.chamado_id=d.chamado_id),'[]'::jsonb),
 'mensagens',coalesce((select jsonb_agg(x order by x.criado_em,x.id) from (select m.id,m.mensagem,m.tipo,m.remetente_id,s.nome as remetente,m.criado_em,m.lida_em from public.qf_chat_mensagens m left join public.qf_profiles s on s.id=m.remetente_id where m.chamado_id=d.chamado_id and m.profissional_id=d.profissional_id) x),'[]'::jsonb),
 'auditoria',coalesce((select jsonb_agg(x order by x.criado_em) from (select a.ator,a.antes,a.depois,a.criado_em from private.qf13_auditoria a where fechamento_id=f.id) x),'[]'::jsonb),
 'pagamentos',coalesce((select jsonb_agg(jsonb_build_object('status',px.status,'valor_centavos',px.valor_centavos,'txid',px.txid,'end_to_end_id',px.end_to_end_id,'pago_em',px.pago_em,'emitido_em',px.emitido_em)) from public.qf_comissao13_pix px where px.fechamento_id=f.id),'[]'::jsonb));
end $$;
revoke all on function public.qf_admin_negociacao_detalhe(uuid) from public,anon;
grant execute on function public.qf_admin_negociacao_detalhe(uuid) to authenticated;

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
  comissao_vence_em=now()+interval '48 hours',
  observacao_admin='Confirmação automática: cliente confirmou a contratação e o valor com um toque'
 where id=f.id;
 return jsonb_build_object('ok',true,'resposta','confirmado','comissao_devida',true,'status','confirmado');
end $$;
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
 if p_acao in ('contratar','negociando') then
  select * into f from public.qf_comissao13_fechamentos where id=p_fechamento and chamado_id=p_chamado_id;
  if not found then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
  return private.qf13_responder_etapa(f.id,p_acao,p_valor_centavos);
 end if;
 if p_acao in ('responder','corrigir_valor') then
  if p_acao='responder' and p_contratou is null then return jsonb_build_object('ok',false,'reason','resposta_obrigatoria');end if;
  perform 1 from public.qf_chamados where id=p_chamado_id for update;
  select * into f from public.qf_comissao13_fechamentos where id=p_fechamento and chamado_id=p_chamado_id for update;
  if not found or f.status not in ('pendente','negociando','informado','recusado','confirmado','contestado') then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
  if p_acao='responder' and p_contratou then
   declare r jsonb;begin
    r:=private.qf13_concluir_com_codigo(f.id,p_valor_centavos,p_codigo,p_concluido);
    if coalesce((r->>'ok')::boolean,false) and f.cliente_concluiu_em is null then
     insert into public.qf_chat_mensagens(chamado_id,profissional_id,remetente_id,mensagem,tipo)
     select f.chamado_id,f.profissional_id,c0.cliente_id,'Cliente confirmou conclusão e valor final com código do pedido. Comissão devida com prazo de 48 horas.','sistema' from public.qf_chamados c0 where c0.id=f.chamado_id;
     perform private.qf_push_interno('chat_message',f.chamado_id);
    end if;
    return r;
   end;
  end if;
  if f.status='confirmado' then return jsonb_build_object('ok',false,'reason','resposta_indisponivel');end if;
  if p_acao='corrigir_valor' then
   if f.status not in ('informado','negociando') or f.valor_informado_centavos is null then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
   update public.qf_comissao13_fechamentos set contratado_em=null,valor_aceito_centavos=null,cliente_resposta='divergencia',cliente_respondeu_em=now() where id=f.id;
   return jsonb_build_object('ok',true,'resposta','divergencia','comissao_devida',false);
  end if;
  v_resposta:=case when p_contratou then case when f.status in ('recusado','contestado') then 'divergencia' else 'confirmado' end else 'nao_contratou' end;
  if f.cliente_resposta is distinct from v_resposta then
   update public.qf_comissao13_fechamentos set contratado_em=null,valor_aceito_centavos=null,cliente_resposta=v_resposta,cliente_respondeu_em=now() where id=f.id;
  end if;
  insert into public.qf_chat_mensagens(chamado_id,profissional_id,remetente_id,mensagem,tipo)
  select f.chamado_id,f.profissional_id,c0.cliente_id,'O cliente respondeu: '||v_resposta,'sistema' from public.qf_chamados c0 where c0.id=f.chamado_id;
  perform private.qf_push_interno('chat_message',f.chamado_id);
  return jsonb_build_object('ok',true,'resposta',v_resposta,'requer_analise_admin',true,'comissao_devida',false);
 elsif p_acao<>'ver' then return jsonb_build_object('ok',false,'reason','acao_invalida');end if;
 select * into c from public.qf_chamados where id=p_chamado_id;
 return jsonb_build_object('ok',true,'confirmacao_em_um_toque',true,'pedido',jsonb_build_object('id',c.id,'titulo',c.titulo,'cidade',c.cidade,'bairro',c.bairro,'status',c.status,
    'canal_contato',coalesce((select a.respostas->>'canal_contato'
      from private.qf_atendimentos a where a.chamado_id=c.id),'whatsapp'),
    'criado_em',c.criado_em),
 'codigo_seguranca',private.qf13_codigo_do_cliente(p_chamado_id),'profissionais',coalesce((select jsonb_agg(jsonb_build_object('id',f0.id,'profissional',p.nome,'plano_livre_ativo',private.qf_livre_identificacao(f0.profissional_id),'etapas_separadas',true,'status',f0.status,'contratado_em',f0.contratado_em,'valor_aceito_centavos',f0.valor_aceito_centavos,'cliente_concluiu_em',f0.cliente_concluiu_em,'valor_centavos',coalesce(f0.valor_confirmado_centavos,f0.valor_informado_centavos),'cliente_resposta',f0.cliente_resposta,'cliente_respondeu_em',f0.cliente_respondeu_em) order by f0.informado_em desc) from public.qf_comissao13_fechamentos f0 join public.qf_profiles p on p.id=f0.profissional_id where f0.chamado_id=c.id),'[]'::jsonb));
end $function$
;
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
    v_msg:='Cliente confirmou a contratação, o valor e a conclusão com o código do pedido. Comissão de 13% gerada automaticamente, com prazo de 48 horas para pagamento.';
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
;
notify pgrst,'reload schema';
commit;
