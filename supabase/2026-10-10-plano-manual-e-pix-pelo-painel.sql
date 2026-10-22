-- QuemFaz 11.57 — admin ativa/troca/tira o plano de um profissional na mão e gera o Pix do plano pelo painel.
-- (já aplicado no Supabase em 10/10/2026)

alter table public.qf_planos_profissional add column if not exists origem text;
alter table public.qf_planos_profissional add column if not exists ativado_por uuid;

-- Recado no celular de um usuário (aviso comum, sem toque de chamado), pela função quemfaz-admin-aviso.
create or replace function private.qf_recado_usuario(p_user uuid, p_titulo text, p_texto text, p_url text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_seg text;
begin
  select decrypted_secret into v_seg from vault.decrypted_secrets where name = 'qf_push_internal' limit 1;
  perform net.http_post(
    url := 'https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-admin-aviso',
    body := jsonb_build_object('action','user_notice','user_ids', jsonb_build_array(p_user), 'title', p_titulo, 'body', p_texto, 'url', p_url, 'tag', 'qf-plano'),
    headers := jsonb_build_object('Content-Type','application/json','x-qf-internal',coalesce(v_seg,'')),
    timeout_milliseconds := 8000);
exception when others then
  raise warning 'QuemFaz recado usuario: %', sqlerrm;
end;
$function$;
revoke all on function private.qf_recado_usuario(uuid, text, text, text) from public, anon, authenticated;

-- Ativa (ou troca) o plano sem pagamento. O plano que estava ativo é encerrado; o novo entra cheio.
create or replace function public.qf_admin_ativar_plano(p_profissional uuid, p_plano text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare c public.qf_planos_catalogo;
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if not exists (select 1 from public.qf_profissionais p where p.user_id = p_profissional) then
    return jsonb_build_object('ok', false, 'reason', 'Profissional não encontrado.');
  end if;
  select * into c from public.qf_planos_catalogo where plano = p_plano;
  if c.plano is null then
    return jsonb_build_object('ok', false, 'reason', 'Plano não encontrado.');
  end if;
  update public.qf_planos_profissional set chamados_restantes = 0, atualizado_em = now()
   where profissional_id = p_profissional and valido_ate > now() and chamados_restantes > 0;
  insert into public.qf_planos_profissional(profissional_id, plano, chamados_total, chamados_restantes, valido_ate, origem, ativado_por)
  values (p_profissional, c.plano, c.chamados, c.chamados, now() + make_interval(days => c.dias), 'manual', auth.uid());
  perform private.qf_recado_usuario(p_profissional, 'Seu plano ' || c.nome || ' está ativo',
    c.chamados || ' chamados para usar em ' || c.dias || ' dias. Bom trabalho! Obrigado de coração. QuemFaz', '/#/profissional/carteira');
  return jsonb_build_object('ok', true) || public.qf_admin_planos_painel();
end;
$function$;
revoke all on function public.qf_admin_ativar_plano(uuid, text) from public, anon;
grant execute on function public.qf_admin_ativar_plano(uuid, text) to authenticated;

-- Tira o plano ativo (zera os chamados que restavam). O saldo da carteira não muda.
create or replace function public.qf_admin_remover_plano(p_profissional uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_n integer;
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  update public.qf_planos_profissional set chamados_restantes = 0, atualizado_em = now()
   where profissional_id = p_profissional and valido_ate > now() and chamados_restantes > 0;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'Esse profissional não tem plano ativo.');
  end if;
  return jsonb_build_object('ok', true) || public.qf_admin_planos_painel();
end;
$function$;
revoke all on function public.qf_admin_remover_plano(uuid) from public, anon;
grant execute on function public.qf_admin_remover_plano(uuid) to authenticated;

-- Recarga pendente de um plano criada pelo admin (o Pix é gerado pela função quemfaz-admin-pix).
create or replace function public.qf_admin_recarga_plano_criar(p_admin uuid, p_profissional uuid, p_plano text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare c public.qf_planos_catalogo; v_id uuid;
begin
  if p_admin is null or not exists (select 1 from public.qf_admins a where a.user_id = p_admin) then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if not exists (select 1 from public.qf_profissionais p where p.user_id = p_profissional) then
    return jsonb_build_object('ok', false, 'reason', 'Profissional não encontrado.');
  end if;
  select * into c from public.qf_planos_catalogo where plano = p_plano and ativo;
  if c.plano is null then
    return jsonb_build_object('ok', false, 'reason', 'Plano não encontrado.');
  end if;
  insert into public.qf_recargas(profissional_id, valor_centavos, metodo, status, plano)
  values (p_profissional, c.preco_centavos, 'pix', 'pendente', c.plano)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'recarga_id', v_id, 'plano', c.plano, 'nome_plano', c.nome, 'valor_centavos', c.preco_centavos);
end;
$function$;
revoke all on function public.qf_admin_recarga_plano_criar(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.qf_admin_recarga_plano_criar(uuid, uuid, text) to service_role;

-- Painel: a lista passa a trazer o profissional (para os atalhos) e os planos ativados na mão.
create or replace function public.qf_admin_planos_painel()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare v_planos jsonb; v_lista jsonb;
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'plano', c.plano, 'nome', c.nome, 'preco_centavos', c.preco_centavos, 'chamados', c.chamados, 'dias', c.dias,
           'ativos', (select count(*) from public.qf_planos_profissional pp
                       where pp.plano = c.plano and pp.valido_ate > now() and pp.chamados_restantes > 0)
         ) order by c.preco_centavos), '[]'::jsonb)
    into v_planos
    from public.qf_planos_catalogo c;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.criado_em desc), '[]'::jsonb)
    into v_lista
    from (
      select r.id, 'conta' as origem, r.profissional_id, p.nome, coalesce(p.whatsapp, p.telefone) as telefone, p.email,
             r.plano, r.valor_centavos, r.metodo, r.criado_em, r.aprovado_em,
             case when r.status = 'aprovado' then 'pago'
                  when r.status = 'pendente' and r.provedor_id is null then 'nao_gerou'
                  when r.status = 'pendente' and r.metodo = 'pix' and r.criado_em < now() - interval '24 hours' then 'vencido'
                  when r.status = 'pendente' and r.criado_em < now() - interval '4 days' then 'vencido'
                  when r.status = 'pendente' then 'aguardando'
                  else 'cancelado' end as situacao,
             pp.chamados_restantes, pp.chamados_total, pp.valido_ate
        from public.qf_recargas r
        left join public.qf_profiles p on p.id = r.profissional_id
        left join public.qf_planos_profissional pp on pp.recarga_id = r.id
       where r.plano is not null
      union all
      select m.id, 'manual', m.profissional_id, p.nome, coalesce(p.whatsapp, p.telefone), p.email,
             m.plano, 0, 'manual', m.criado_em, m.criado_em, 'manual',
             m.chamados_restantes, m.chamados_total, m.valido_ate
        from public.qf_planos_profissional m
        left join public.qf_profiles p on p.id = m.profissional_id
       where m.origem = 'manual'
      union all
      select g.id, 'cadastro', null::uuid, g.nome, g.telefone, g.email,
             g.plano, g.valor_centavos, g.metodo, g.criado_em, g.aprovado_em,
             case when g.status = 'aprovado' then 'pago_sem_conta'
                  when g.status = 'pendente' and g.provedor_id is null then 'nao_gerou'
                  when g.status = 'pendente' and g.metodo = 'pix' and g.criado_em < now() - interval '24 hours' then 'vencido'
                  when g.status = 'pendente' and g.criado_em < now() - interval '4 days' then 'vencido'
                  when g.status = 'pendente' then 'aguardando'
                  else 'cancelado' end,
             null::integer, null::integer, null::timestamptz
        from public.qf_pre_cadastro_pagamentos g
       where g.profissional_id is null and g.email not ilike '%@exemplo.com'
      order by criado_em desc
      limit 300
    ) x;

  return jsonb_build_object('ok', true, 'planos', v_planos, 'lista', v_lista);
end;
$function$;
revoke all on function public.qf_admin_planos_painel() from public, anon;
grant execute on function public.qf_admin_planos_painel() to authenticated;
