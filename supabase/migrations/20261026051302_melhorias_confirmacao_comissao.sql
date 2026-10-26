begin;
-- Uma proposta continua pendente somente enquanto o pedido e o valor aguardam o cliente.
create or replace function private.qf13_confirmacao_aberta(f public.qf_comissao13_fechamentos)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(f.status in ('informado','negociando') and f.proposta_chat_em is not null
 and f.cliente_resposta is null and f.cobranca_status='nao_gerada'
 and f.valor_informado_centavos between 100 and 100000000
 and exists(select 1 from public.qf_chamados c where c.id=f.chamado_id and c.status not in ('cancelado','expirado','finalizado','concluido'))
 and not exists(select 1 from public.qf_comissao13_fechamentos outro where outro.chamado_id=f.chamado_id and outro.id<>f.id and outro.status='confirmado'),false)
$$;
revoke all on function private.qf13_confirmacao_aberta(public.qf_comissao13_fechamentos) from public,anon,authenticated;

create or replace function private.qf13_avisar_confirmacao(f public.qf_comissao13_fechamentos,p_lembrete boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare v_cliente uuid;v_nome text;v_valor text;
begin
 if not private.qf13_confirmacao_aberta(f) then return;end if;
 select cliente_id into v_cliente from public.qf_chamados where id=f.chamado_id;
 select nome into v_nome from public.qf_profiles where id=f.profissional_id;
 v_valor:=replace(to_char(f.valor_informado_centavos/100.0,'FM999999990.00'),'.',',');
 insert into private.qf_comissao13_notificacoes(user_id,chave,titulo,corpo,rota)
 values(v_cliente,(case when p_lembrete then 'lembrete13:' else 'confirmacao13:' end)||f.id||':'||extract(epoch from f.proposta_chat_em)::text,
 case when p_lembrete then 'Sua contratação ainda aguarda confirmação' else 'Confirme sua contratação' end,
 coalesce(v_nome,'O profissional')||' informou que vocês fecharam por R$ '||v_valor||'. Confira e confirme no pedido.',
 '/?app=1#/cliente/chat/'||f.chamado_id||'/'||f.profissional_id)
 on conflict(user_id,chave) do nothing;
end $$;
revoke all on function private.qf13_avisar_confirmacao(public.qf_comissao13_fechamentos,boolean) from public,anon,authenticated;

create or replace function private.qf13_notificar_cliente() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_cliente uuid;
begin
 if private.qf13_confirmacao_aberta(new) then
  perform private.qf13_avisar_confirmacao(new,false);
 elsif new.status='recusado' and (tg_op='INSERT' or old.status is distinct from new.status) then
  select cliente_id into v_cliente from public.qf_chamados where id=new.chamado_id;
  insert into private.qf_comissao13_notificacoes(user_id,chave,titulo,corpo,rota)
  values(v_cliente,'fechamento13:'||new.id||':recusado','Confira o resultado do seu pedido',
  'O profissional informou que não fechou. Abra seu pedido para conferir ou falar com o suporte.',
  '/?app=1#/cliente/chat/'||new.chamado_id||'/'||new.profissional_id)
  on conflict(user_id,chave) do nothing;
 end if;
 return new;
end $$;
revoke all on function private.qf13_notificar_cliente() from public,anon,authenticated;
drop trigger if exists qf13_notificar_cliente on public.qf_comissao13_fechamentos;
create trigger qf13_notificar_cliente after insert or update of status,valor_informado_centavos,proposta_chat_em,cliente_resposta on public.qf_comissao13_fechamentos for each row execute function private.qf13_notificar_cliente();

-- Um lembrete por versão da proposta. O cron existente chama esta rotina a cada cinco minutos.
create or replace function private.qf13_lembretes_confirmacao() returns void
language plpgsql security definer set search_path='' as $$
declare f public.qf_comissao13_fechamentos;
begin
 if not private.qf13_simplificado_ativo() then return;end if;
 for f in select x.* from public.qf_comissao13_fechamentos x
 where x.proposta_chat_em<=now()-interval '24 hours' and private.qf13_confirmacao_aberta(x)
 and not exists(select 1 from private.qf_comissao13_notificacoes n where n.user_id=(select cliente_id from public.qf_chamados where id=x.chamado_id)
 and n.chave='lembrete13:'||x.id||':'||extract(epoch from x.proposta_chat_em)::text)
 order by x.proposta_chat_em limit 100
 loop perform private.qf13_avisar_confirmacao(f,true);end loop;
end $$;
revoke all on function private.qf13_lembretes_confirmacao() from public,anon,authenticated;

create or replace function public.qf13_minhas_confirmacoes() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(x) from (
 select f.id,f.chamado_id,f.profissional_id,p.nome as profissional,f.valor_informado_centavos as valor_centavos,
 '/?app=1#/cliente/chat/'||f.chamado_id||'/'||f.profissional_id as rota
 from public.qf_comissao13_fechamentos f join public.qf_chamados c on c.id=f.chamado_id
 join public.qf_profiles p on p.id=f.profissional_id
 where c.cliente_id=auth.uid() and private.qf13_confirmacao_aberta(f)
 order by f.proposta_chat_em limit 20) x),'[]'::jsonb);
end $$;
revoke all on function public.qf13_minhas_confirmacoes() from public,anon;
grant execute on function public.qf13_minhas_confirmacoes() to authenticated;
CREATE OR REPLACE FUNCTION private.qf_comissao13_reprocessar_notificacoes()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n record;
begin
 if not private.qf13_simplificado_ativo() then return; end if;
 perform private.qf13_lembretes_confirmacao();
 -- Estado incerto após queda não é reenviado: evita disparos duplicados.
 update private.qf_comissao13_notificacoes set status='incerto',erro='Processamento interrompido; requer revisão.' where status='processando' and tentativa_em<now()-interval '10 minutes';
 for n in select id from private.qf_comissao13_notificacoes where status in ('pendente','fora_horario','fora_disponibilidade','sem_inscricao') and tentativas<3 and coalesce(tentativa_em,criado_em)<now()-interval '5 minutes' order by coalesce(tentativa_em,criado_em) limit 50 loop
  perform private.qf_push_interno('comissao13_queue',n.id);
 end loop;
end $function$
;
CREATE OR REPLACE FUNCTION public.qf_comissao13_notificacao_reservar(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n private.qf_comissao13_notificacoes; pr public.qf_profissionais; momento time:=timezone('America/Sao_Paulo',now())::time;
begin
 if not private.qf13_simplificado_ativo() then return jsonb_build_object('ok',false,'reason','integracao_pendente'); end if;
 select * into n from private.qf_comissao13_notificacoes where id=p_id for update;
 if not found or n.status not in ('pendente','fora_horario','fora_disponibilidade','sem_inscricao') or n.tentativas>=3 then return jsonb_build_object('ok',false,'reason','ja_processado'); end if;
 if (n.chave like 'confirmacao13:%' or n.chave like 'lembrete13:%') and not exists(
  select 1 from public.qf_comissao13_fechamentos f join public.qf_chamados c on c.id=f.chamado_id
  where f.id::text=split_part(n.chave,':',2) and c.cliente_id=n.user_id
  and extract(epoch from f.proposta_chat_em)::text=split_part(n.chave,':',3)
  and private.qf13_confirmacao_aberta(f)) then
  update private.qf_comissao13_notificacoes set status='falhou',erro='confirmacao_ja_resolvida_ou_atualizada',tentativa_em=now() where id=p_id;
  return jsonb_build_object('ok',false,'reason','confirmacao_ja_resolvida_ou_atualizada');
 end if;
 if not exists(select 1 from public.qf_profiles where id=n.user_id and ativo) then update private.qf_comissao13_notificacoes set status='falhou',erro='perfil_inativo',tentativa_em=now() where id=p_id; return jsonb_build_object('ok',false,'reason','perfil_inativo'); end if;
 select * into pr from public.qf_profissionais where user_id=n.user_id;
 if found then
  if pr.horario_inicio is not null and pr.horario_fim is not null and pr.horario_inicio<>pr.horario_fim and not (case when pr.horario_inicio<pr.horario_fim then momento>=pr.horario_inicio and momento<pr.horario_fim else momento>=pr.horario_inicio or momento<pr.horario_fim end) then
   update private.qf_comissao13_notificacoes set status='fora_horario',tentativa_em=now() where id=p_id; return jsonb_build_object('ok',false,'reason','fora_horario'); end if;
 end if;
 update private.qf_comissao13_notificacoes set status='processando',tentativas=tentativas+1,tentativa_em=now() where id=p_id;
 return jsonb_build_object('ok',true,'id',n.id,'user_id',n.user_id,'titulo',n.titulo,'corpo',n.corpo,'rota',n.rota,'alerta',coalesce(pr.alerta_modo,'silencioso'));
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
      'profissional_nome',(select nome from public.qf_profiles where id=v_prof),'estado',v_f.status,'cliente_resposta',v_f.cliente_resposta,
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
revoke all on function private.qf_comissao13_reprocessar_notificacoes() from public,anon,authenticated;
revoke all on function public.qf_comissao13_notificacao_reservar(uuid) from public,anon,authenticated;
grant execute on function public.qf_comissao13_notificacao_reservar(uuid) to service_role;
notify pgrst, 'reload schema';
commit;
