-- Quem Faz — campanha inicial de convites para ativar o app via WhatsApp.
-- Esta migração NÃO envia mensagens; prepara uma fila auditável para envio manual.
create table if not exists public.qf_admin_convites_playstore (
  user_id uuid primary key references public.qf_profiles(id) on delete cascade,
  status text not null default 'pendente'
    check (status in ('pendente','aberto','enviado','pulado')),
  tentativas_abertura int not null default 0,
  criado_em timestamptz not null default now(),
  aberto_em timestamptz,
  enviado_em timestamptz,
  atualizado_em timestamptz not null default now()
);
alter table public.qf_admin_convites_playstore enable row level security;
revoke all on public.qf_admin_convites_playstore from public, anon, authenticated;

-- Primeiro lote: profissionais ativos sem assinatura de push.
-- Não inferir "sem instalação" nem tratar "aberto" como envio realizado.
insert into public.qf_admin_convites_playstore (user_id)
select p.id from public.qf_profiles p
where p.tipo='profissional' and coalesce(p.ativo,true)
  and length(regexp_replace(coalesce(nullif(p.whatsapp,''),p.telefone,''),'\D','','g')) between 10 and 13
  and not exists (
    select 1 from public.qf_push_subscriptions ps
    where ps.user_id=p.id and ps.ativo
  )
on conflict (user_id) do nothing;

create or replace function public.qf_admin_playstore_listar()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null
     or not exists (select 1 from public.qf_admins a where a.user_id=auth.uid()) then
    raise exception 'Apenas administradores';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id',c.user_id,
      'status',c.status,
      'tentativas_abertura',c.tentativas_abertura,
      'aberto_em',c.aberto_em,
      'enviado_em',c.enviado_em,
      'criado_em',c.criado_em,
      'push_ativo',exists (
        select 1 from public.qf_push_subscriptions ps
        where ps.user_id=c.user_id and ps.ativo
      )
    ) order by c.criado_em, c.user_id)
    from public.qf_admin_convites_playstore c
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.qf_admin_playstore_listar() from public, anon;
grant execute on function public.qf_admin_playstore_listar() to authenticated;

-- Inclusão manual de novos cadastros elegíveis, sem recriar contatos anteriores.
create or replace function public.qf_admin_playstore_adicionar_novos()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare novos integer;
begin
  if auth.uid() is null
     or not exists (select 1 from public.qf_admins a where a.user_id=auth.uid()) then
    raise exception 'Apenas administradores';
  end if;
  insert into public.qf_admin_convites_playstore (user_id)
  select p.id from public.qf_profiles p
  where p.tipo='profissional' and coalesce(p.ativo,true)
    and length(regexp_replace(coalesce(nullif(p.whatsapp,''),p.telefone,''),'\D','','g')) between 10 and 13
    and not exists (
      select 1 from public.qf_push_subscriptions ps
      where ps.user_id=p.id and ps.ativo
    )
  on conflict (user_id) do nothing;
  get diagnostics novos = row_count;
  return novos;
end;
$$;
revoke all on function public.qf_admin_playstore_adicionar_novos() from public, anon;
grant execute on function public.qf_admin_playstore_adicionar_novos() to authenticated;

-- Abertura não confirma envio. Enviado exige confirmação manual do admin.
create or replace function public.qf_admin_playstore_marcar(p_user_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare estado_anterior text;
begin
  if auth.uid() is null
     or not exists (select 1 from public.qf_admins a where a.user_id=auth.uid()) then
    raise exception 'Apenas administradores';
  end if;
  if p_status not in ('aberto','enviado','pulado','pendente') then
    raise exception 'Status inválido';
  end if;
  select c.status into estado_anterior
  from public.qf_admin_convites_playstore c where c.user_id=p_user_id for update;
  if not found then raise exception 'Profissional não incluído na campanha'; end if;
  if estado_anterior='enviado' and p_status='aberto' then
    raise exception 'Já confirmado como enviado; não reenviar automaticamente';
  end if;
  if p_status='enviado' and estado_anterior <> 'aberto' then
    raise exception 'Abra o WhatsApp antes de confirmar o envio';
  end if;
  update public.qf_admin_convites_playstore
  set status = p_status,
      tentativas_abertura=tentativas_abertura + case when p_status='aberto' then 1 else 0 end,
      aberto_em=case when p_status='aberto' then now() else aberto_em end,
      enviado_em=case when p_status='enviado' then now() when p_status='pendente' then null else enviado_em end,
      atualizado_em=now()
  where user_id=p_user_id;
end;
$$;
revoke all on function public.qf_admin_playstore_marcar(uuid,text) from public, anon;
grant execute on function public.qf_admin_playstore_marcar(uuid,text) to authenticated;