-- QuemFaz V11.51 — "Simular chamado": teste do aviso de chamado no celular do profissional.
-- O teste fica numa tabela própria. NÃO cria pedido (qf_chamados), NÃO mexe em carteira,
-- NÃO entra na receita nem nas contagens de pedidos do painel.
-- Envio: o admin aciona a edge function quemfaz-push (action "teste_chamado"), que grava o
-- registro e manda o push pelo mesmo caminho do chamado real (strong, mesmo canal e toque),
-- com tipo = "teste". Vai direto para o profissional: ignora online/offline e horário.

create table if not exists public.chamados_teste (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references public.qf_profissionais(user_id) on delete cascade,
  enviado_em timestamptz not null default now(),
  chegou_em timestamptz,
  confirmado_em timestamptz,
  enviado_por uuid not null,
  -- Chave do aviso: deixa o celular marcar "chegou" mesmo sem sessão aberta (service worker / APK).
  token uuid not null default gen_random_uuid(),
  -- Resultado do envio (quantos aparelhos receberam o push do servidor).
  envio jsonb
);
create index if not exists chamados_teste_prof_idx on public.chamados_teste (profissional_id, enviado_em desc);

alter table public.chamados_teste enable row level security;

drop policy if exists chamados_teste_admin_le on public.chamados_teste;
create policy chamados_teste_admin_le on public.chamados_teste for select to authenticated using (private.qf_is_admin());
drop policy if exists chamados_teste_admin_cria on public.chamados_teste;
create policy chamados_teste_admin_cria on public.chamados_teste for insert to authenticated with check (private.qf_is_admin() and enviado_por = auth.uid());
drop policy if exists chamados_teste_prof_le on public.chamados_teste;
create policy chamados_teste_prof_le on public.chamados_teste for select to authenticated using (profissional_id = auth.uid());
drop policy if exists chamados_teste_prof_atualiza on public.chamados_teste;
create policy chamados_teste_prof_atualiza on public.chamados_teste for update to authenticated
  using (profissional_id = auth.uid()) with check (profissional_id = auth.uid());

-- O profissional só altera chegou_em e confirmado_em.
revoke all on public.chamados_teste from anon;
revoke update on public.chamados_teste from authenticated;
grant select, insert on public.chamados_teste to authenticated;
grant update (chegou_em, confirmado_em) on public.chamados_teste to authenticated;
-- A edge function quemfaz-push grava o teste com o acesso interno (este projeto não dá permissão automática).
grant select, insert, update on public.chamados_teste to service_role;
revoke truncate, trigger, references on public.chamados_teste from authenticated;

-- Chegou no aparelho: chamada pelo service worker (PWA) ou pelo app nativo, com a chave do aviso.
create or replace function public.qf_teste_chegou(p_id uuid, p_token uuid)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  with u as (
    update public.chamados_teste t set chegou_em = coalesce(t.chegou_em, now())
     where t.id = p_id and t.token = p_token
    returning t.chegou_em
  )
  select jsonb_build_object('ok', exists(select 1 from u), 'chegou_em', (select chegou_em from u));
$function$;
grant execute on function public.qf_teste_chegou(uuid, uuid) to anon, authenticated;

-- Confirmado pelo profissional (logado). Se ainda não tinha "chegou", marca junto.
create or replace function public.qf_teste_confirmar(p_id uuid)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  with u as (
    update public.chamados_teste t
       set chegou_em = coalesce(t.chegou_em, now()), confirmado_em = coalesce(t.confirmado_em, now())
     where t.id = p_id and t.profissional_id = auth.uid()
    returning t.confirmado_em
  )
  select jsonb_build_object('ok', exists(select 1 from u), 'confirmado_em', (select confirmado_em from u));
$function$;
revoke execute on function public.qf_teste_confirmar(uuid) from anon;
grant execute on function public.qf_teste_confirmar(uuid) to authenticated;
