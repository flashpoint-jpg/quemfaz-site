-- Pedido Fácil: conta do cliente (telefone + senha, e-mail verificado, recuperação por e-mail).
-- Migração ADITIVA: não altera tabelas, regras financeiras, distribuição, planos nem profissionais.
-- Senhas nunca ficam aqui: ficam em hash (bcrypt) no Supabase Auth. Esta migração guarda só estado e auditoria.

-- 1) Telefone único entre contas de cliente (WhatsApp normalizado, sem DDI).
create unique index if not exists qf_profiles_cliente_telefone_unico
  on public.qf_profiles ((public.qf_normalizar_whatsapp(coalesce(nullif(whatsapp, ''), telefone))))
  where tipo = 'cliente' and public.qf_normalizar_whatsapp(coalesce(nullif(whatsapp, ''), telefone)) <> '';

-- 2) Estado da conta: e-mail verificado e senha definida. Fica fora de qf_profiles (que o próprio
--    usuário pode atualizar) para o cliente não conseguir marcar o próprio e-mail como verificado.
create table if not exists public.qf_cliente_contas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  email_verificado_em timestamptz,
  senha_definida_em timestamptz,
  origem text not null default 'pedido_facil' check (origem in ('pedido_facil', 'legado_migrado')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.qf_cliente_contas enable row level security;
drop policy if exists qf_cliente_contas_select_own on public.qf_cliente_contas;
create policy qf_cliente_contas_select_own on public.qf_cliente_contas
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.qf_cliente_contas from anon, authenticated;
grant select on public.qf_cliente_contas to authenticated;

-- 3) Tokens de verificação de e-mail e recuperação de senha. Só o hash (SHA-256) é guardado.
create table if not exists public.qf_cliente_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  finalidade text not null check (finalidade in ('verificar_email', 'recuperar_senha')),
  token_hash text not null unique,
  email text not null,
  expira_em timestamptz not null,
  usado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists qf_cliente_tokens_user_idx on public.qf_cliente_tokens (user_id, finalidade, criado_em desc);
alter table public.qf_cliente_tokens enable row level security;
revoke all on public.qf_cliente_tokens from anon, authenticated;

-- 4) Auditoria de autenticação do cliente (também usada para limitar tentativas). Sem senha, sem token.
create table if not exists public.qf_cliente_auth_eventos (
  id bigserial primary key,
  criado_em timestamptz not null default now(),
  evento text not null,
  ok boolean not null default false,
  user_id uuid,
  telefone_fim text,
  ip_hash text,
  detalhe text
);
create index if not exists qf_cliente_auth_eventos_criado_idx on public.qf_cliente_auth_eventos (criado_em desc);
create index if not exists qf_cliente_auth_eventos_tel_idx on public.qf_cliente_auth_eventos (telefone_fim, evento, criado_em desc);
create index if not exists qf_cliente_auth_eventos_ip_idx on public.qf_cliente_auth_eventos (ip_hash, evento, criado_em desc);
alter table public.qf_cliente_auth_eventos enable row level security;
revoke all on public.qf_cliente_auth_eventos from anon, authenticated;

-- 5) Painel administrativo: leitura somente para admin (security definer + checagem explícita).
create or replace function public.qf_admin_clientes_busca(p_busca text default '', p_limite integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_busca text := btrim(coalesce(p_busca, ''));
  v_digitos text := regexp_replace(coalesce(p_busca, ''), '[^0-9]', '', 'g');
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'admin authentication required'; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'criado_em' desc) from (
      select jsonb_build_object(
        'id', p.id,
        'nome', p.nome,
        'telefone', coalesce(nullif(p.whatsapp, ''), p.telefone),
        'email', case when p.email ilike '%@acesso.quemfaz.app.br' then null else p.email end,
        'email_verificado', (c.email_verificado_em is not null),
        'email_verificado_em', c.email_verificado_em,
        'tem_senha', (c.senha_definida_em is not null),
        'conta', case when c.user_id is null then 'rapida_antiga' else c.origem end,
        'criado_em', p.criado_em,
        'pedidos_total', (select count(*) from public.qf_chamados ch where ch.cliente_id = p.id),
        'ultimo_pedido_em', (select max(ch.criado_em) from public.qf_chamados ch where ch.cliente_id = p.id)
      ) as x
      from public.qf_profiles p
      left join public.qf_cliente_contas c on c.user_id = p.id
      where p.tipo = 'cliente'
        and (v_busca = ''
             or p.nome ilike '%' || v_busca || '%'
             or (length(v_digitos) >= 3 and regexp_replace(coalesce(p.whatsapp, '') || coalesce(p.telefone, ''), '[^0-9]', '', 'g') like '%' || v_digitos || '%')
             or p.email ilike '%' || v_busca || '%')
      order by p.criado_em desc
      limit greatest(1, least(coalesce(p_limite, 50), 200))
    ) q
  ), '[]'::jsonb);
end $$;

create or replace function public.qf_admin_cliente_pedidos(p_cliente uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'admin authentication required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', ch.id,
      'categoria', ch.categoria,
      'status', ch.status,
      'cidade', ch.cidade, 'uf', ch.uf, 'bairro', ch.bairro,
      'criado_em', ch.criado_em,
      'max_orcamentos', ch.max_orcamentos,
      'desfecho', ch.desfecho,
      'recebidos', (select count(distinct e.user_id) from public.qf_push_entregas e where e.chamado_id = ch.id),
      'aceitos', (select coalesce(jsonb_agg(jsonb_build_object('profissional_id', o.profissional_id, 'nome', pp.nome, 'status', o.status)), '[]'::jsonb)
                    from public.qf_orcamentos o left join public.qf_profiles pp on pp.id = o.profissional_id where o.chamado_id = ch.id),
      'cascata_aceito_por', (select jsonb_build_object('profissional_id', k.aceito_por, 'nome', pk.nome, 'em', k.aceito_em)
                               from public.qf_chamado_cascata k left join public.qf_profiles pk on pk.id = k.aceito_por
                              where k.chamado_id = ch.id and k.aceito_por is not null),
      'desbloqueios', (select coalesce(jsonb_agg(jsonb_build_object('profissional_id', d.profissional_id, 'nome', pd.nome, 'em', d.criado_em, 'exclusivo', d.exclusivo, 'desfecho', d.desfecho)), '[]'::jsonb)
                         from public.qf_desbloqueios d left join public.qf_profiles pd on pd.id = d.profissional_id
                        where d.chamado_id = ch.id and d.ativo is not false),
      'conversas', (select count(distinct m.profissional_id) from public.qf_chat_mensagens m where m.chamado_id = ch.id),
      'conclusoes', (select coalesce(jsonb_agg(jsonb_build_object('profissional_id', c.profissional_id, 'status', c.status, 'nota', c.nota, 'em', c.respondida_em)), '[]'::jsonb)
                       from public.qf_conclusoes c where c.chamado_id = ch.id)
    ) order by ch.criado_em desc)
    from public.qf_chamados ch
    where ch.cliente_id = p_cliente
  ), '[]'::jsonb);
end $$;

create or replace function public.qf_admin_cliente_auth_eventos(p_limite integer default 100, p_somente_erros boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'admin authentication required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'criado_em', e.criado_em, 'evento', e.evento, 'ok', e.ok,
                                        'user_id', e.user_id, 'telefone_fim', e.telefone_fim, 'detalhe', e.detalhe)
                     order by e.criado_em desc)
    from (select * from public.qf_cliente_auth_eventos
           where (not coalesce(p_somente_erros, true)) or ok = false
           order by criado_em desc
           limit greatest(1, least(coalesce(p_limite, 100), 500))) e
  ), '[]'::jsonb);
end $$;

revoke all on function public.qf_admin_clientes_busca(text, integer) from public, anon;
revoke all on function public.qf_admin_cliente_pedidos(uuid) from public, anon;
revoke all on function public.qf_admin_cliente_auth_eventos(integer, boolean) from public, anon;
grant execute on function public.qf_admin_clientes_busca(text, integer) to authenticated;
grant execute on function public.qf_admin_cliente_pedidos(uuid) to authenticated;
grant execute on function public.qf_admin_cliente_auth_eventos(integer, boolean) to authenticated;
