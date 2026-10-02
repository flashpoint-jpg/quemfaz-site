-- QuemFaz 11.16.33
-- Chat ao vivo: avisa uma vez e depois a conversa segue na mesma tela.
--
-- Regra do aviso (push) de mensagem nova:
--   1. Quem está com a conversa aberta na tela NÃO recebe push: a mensagem
--      aparece sozinha no chat, só com um toque curto.
--   2. Quem está fora recebe UM push. As mensagens seguintes não geram outro
--      enquanto aquele aviso não for lido (reforço só depois de 30 minutos).
--
-- Baseado nas funções registradas em 2026-10-01-chat-portfolio-programados.sql.
-- As assinaturas não mudam, então o app antigo continua funcionando.

-- Quem está com a conversa aberta agora (atualizado a cada leitura do chat).
create table if not exists public.qf_chat_presenca (
  chamado_id uuid not null references public.qf_chamados(id) on delete cascade,
  profissional_id uuid not null references public.qf_profiles(id) on delete cascade,
  user_id uuid not null references public.qf_profiles(id) on delete cascade,
  visto_em timestamptz not null default now(),
  primary key (chamado_id, profissional_id, user_id)
);

alter table public.qf_chat_presenca enable row level security;
revoke all on public.qf_chat_presenca from anon, authenticated;

-- Marca as mensagens que geraram push, para não avisar de novo a cada mensagem.
alter table public.qf_chat_mensagens
  add column if not exists avisado_em timestamptz;

CREATE OR REPLACE FUNCTION public.qf_chat_conversa(p_chamado_id uuid, p_profissional_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, chamado_id uuid, profissional_id uuid, remetente_id uuid, remetente_nome text, remetente_tipo text, mensagem text, tipo text, lida_em timestamp with time zone, criado_em timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_cliente uuid;
  v_prof uuid;
begin
  if v_user is null then raise exception 'authentication required'; end if;

  select c.cliente_id into v_cliente
  from public.qf_chamados c
  where c.id=p_chamado_id;

  if v_cliente is null then raise exception 'call not found'; end if;

  if v_user=v_cliente then
    v_prof := p_profissional_id;
    if v_prof is null then raise exception 'professional required'; end if;
  else
    v_prof := coalesce(p_profissional_id,v_user);
    if v_prof<>v_user then raise exception 'forbidden'; end if;
  end if;

  if not exists(
    select 1 from public.qf_desbloqueios d
    where d.chamado_id=p_chamado_id
      and d.profissional_id=v_prof
      and coalesce(d.ativo,true)
  ) then
    raise exception 'conversation unavailable';
  end if;

  if v_user<>v_cliente and v_user<>v_prof then raise exception 'forbidden'; end if;

  -- Esta pessoa está com a conversa aberta na tela agora.
  insert into public.qf_chat_presenca as pr (chamado_id,profissional_id,user_id,visto_em)
  values (p_chamado_id,v_prof,v_user,now())
  on conflict on constraint qf_chat_presenca_pkey
  do update set visto_em=excluded.visto_em;

  update public.qf_chat_mensagens m
     set lida_em=now()
   where m.chamado_id=p_chamado_id
     and m.profissional_id=v_prof
     and m.remetente_id<>v_user
     and m.lida_em is null;

  return query
  select
    m.id,m.chamado_id,m.profissional_id,m.remetente_id,
    p.nome,
    case when m.remetente_id=v_cliente then 'cliente'::text else 'profissional'::text end,
    m.mensagem,m.tipo,m.lida_em,m.criado_em
  from public.qf_chat_mensagens m
  join public.qf_profiles p on p.id=m.remetente_id
  where m.chamado_id=p_chamado_id
    and m.profissional_id=v_prof
  order by m.criado_em asc;
end;
$function$;

-- O app chama ao sair da conversa (trocar de tela ou minimizar): a partir daí
-- a próxima mensagem volta a gerar push.
CREATE OR REPLACE FUNCTION public.qf_chat_sair(p_chamado_id uuid, p_profissional_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  delete from public.qf_chat_presenca pr
   where pr.chamado_id=p_chamado_id
     and pr.user_id=v_user
     and (p_profissional_id is null or pr.profissional_id=p_profissional_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.qf_enviar_mensagem_chat(p_chamado_id uuid, p_profissional_id uuid, p_mensagem text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_cliente uuid;
  v_prof uuid;
  v_status text;
  v_msg text := trim(coalesce(p_mensagem,''));
  v_id uuid;
  v_dest uuid;
  v_na_tela boolean;
  v_ja_avisado boolean;
  v_avisou boolean := false;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if char_length(v_msg)<1 or char_length(v_msg)>1500 then
    return jsonb_build_object('ok',false,'reason','mensagem_invalida');
  end if;

  select c.cliente_id,c.status into v_cliente,v_status
  from public.qf_chamados c
  where c.id=p_chamado_id
  for update;

  if v_cliente is null then raise exception 'call not found'; end if;

  if v_user=v_cliente then
    v_prof := p_profissional_id;
    if v_prof is null then return jsonb_build_object('ok',false,'reason','profissional_obrigatorio'); end if;
  else
    v_prof := v_user;
    if p_profissional_id is not null and p_profissional_id<>v_user then
      return jsonb_build_object('ok',false,'reason','forbidden');
    end if;
  end if;

  if not exists(
    select 1 from public.qf_desbloqueios d
    where d.chamado_id=p_chamado_id
      and d.profissional_id=v_prof
      and coalesce(d.ativo,true)
  ) then
    return jsonb_build_object('ok',false,'reason','conversa_indisponivel');
  end if;

  if v_status in ('cancelado','expirado','finalizado') then
    return jsonb_build_object('ok',false,'reason','chamado_encerrado');
  end if;

  if v_status in ('confirmado','em_andamento','concluido') and not exists(
    select 1 from public.qf_orcamentos o
    where o.chamado_id=p_chamado_id
      and o.profissional_id=v_prof
      and o.status='aceito'
  ) then
    return jsonb_build_object('ok',false,'reason','nao_selecionado');
  end if;

  insert into public.qf_chat_mensagens(
    chamado_id,profissional_id,remetente_id,mensagem,tipo
  )
  values(p_chamado_id,v_prof,v_user,v_msg,'mensagem')
  returning id into v_id;

  v_dest := case when v_user=v_cliente then v_prof else v_cliente end;

  -- A outra pessoa está com esta conversa aberta? (o app renova a presença a cada 2 s)
  v_na_tela := exists(
    select 1 from public.qf_chat_presenca pr
    where pr.chamado_id=p_chamado_id
      and pr.profissional_id=v_prof
      and pr.user_id=v_dest
      and pr.visto_em>now()-interval '10 seconds'
  );

  -- Já existe um aviso meu ainda não lido por ela? Então não avisa de novo.
  v_ja_avisado := exists(
    select 1 from public.qf_chat_mensagens m
    where m.chamado_id=p_chamado_id
      and m.profissional_id=v_prof
      and m.remetente_id=v_user
      and m.id<>v_id
      and m.lida_em is null
      and m.avisado_em>now()-interval '30 minutes'
  );

  if not v_na_tela and not v_ja_avisado then
    update public.qf_chat_mensagens set avisado_em=now() where id=v_id;
    perform private.qf_push_interno('chat_message',p_chamado_id);
    v_avisou := true;
  end if;

  return jsonb_build_object(
    'ok',true,'id',v_id,'chamado_id',p_chamado_id,
    'profissional_id',v_prof,'criado_em',now(),
    'push',v_avisou
  );
end;
$function$;

revoke execute on function public.qf_chat_sair(uuid,uuid) from public, anon;
grant execute on function public.qf_chat_sair(uuid,uuid) to authenticated;
