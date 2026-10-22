-- 2026-09-28
-- Inclui, no snapshot administrativo, endereço e apenas os 4 últimos dígitos
-- do CPF/CNPJ. O documento completo continua não sendo exposto no painel.

create or replace function public.qf_admin_snapshot()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists(select 1 from public.qf_admins a where a.user_id=v_uid) then
    raise exception 'forbidden';
  end if;

  return jsonb_build_object(
    'gerado_em', now(),
    'emails', coalesce((
      select jsonb_object_agg(p.id::text, coalesce(p.email, u.email))
      from public.qf_profiles p
      left join auth.users u on u.id=p.id
      where coalesce(p.email, u.email) is not null
    ), '{}'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(p) || jsonb_build_object('tem_foto', coalesce(p.foto_url,'') <> '') order by p.criado_em desc)
      from public.qf_profiles p
    ), '[]'::jsonb),
    'identidades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', i.user_id,
        'cpf_last4', i.cpf_last4,
        'cnpj_last4', i.cnpj_last4
      ))
      from private.qf_identidades i
    ), '[]'::jsonb),
    'enderecos', coalesce((
      select jsonb_agg(to_jsonb(e))
      from public.qf_enderecos e
    ), '[]'::jsonb),
    'profissionais', coalesce((select jsonb_agg(to_jsonb(pr) order by pr.criado_em desc) from public.qf_profissionais pr),'[]'::jsonb),
    'carteiras', coalesce((select jsonb_agg(to_jsonb(c)) from public.qf_carteiras c),'[]'::jsonb),
    'cidades', coalesce((select jsonb_agg(to_jsonb(pc) order by pc.criado_em) from public.qf_profissional_cidades pc),'[]'::jsonb),
    'push_usuarios', coalesce((select jsonb_agg(x.user_id) from (select distinct ps.user_id from public.qf_push_subscriptions ps where ps.ativo=true) x),'[]'::jsonb),
    'push_inscritos', (select count(*) from public.qf_push_subscriptions ps where ps.ativo=true),
    'movimentacoes', coalesce((select jsonb_agg(to_jsonb(m) order by m.criado_em desc) from public.qf_movimentacoes_carteira m),'[]'::jsonb),
    'orcamentos', coalesce((select jsonb_agg(to_jsonb(o) order by o.criado_em desc) from public.qf_orcamentos o),'[]'::jsonb),
    'avaliacoes', coalesce((select jsonb_agg(to_jsonb(a) order by a.criado_em desc) from public.qf_avaliacoes a),'[]'::jsonb),
    'chamados', coalesce((
      select jsonb_agg(
        to_jsonb(c) || jsonb_build_object(
          'profissional_id', d.profissional_id,
          'prioridade_pagamento_status', pg.status,
          'prioridade_valor_centavos', pg.valor_centavos
        )
        order by c.criado_em desc
      )
      from public.qf_chamados c
      left join lateral (
        select dd.profissional_id
        from public.qf_desbloqueios dd
        where dd.chamado_id=c.id
        order by dd.criado_em asc
        limit 1
      ) d on true
      left join lateral (
        select pp.status, pp.valor_centavos
        from public.qf_prioridade_pagamentos pp
        where pp.chamado_id=c.id
        order by pp.criado_em desc
        limit 1
      ) pg on true
    ),'[]'::jsonb)
  );
end;
$$;
