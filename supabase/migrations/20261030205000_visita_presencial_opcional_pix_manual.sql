-- Orçamento presencial opcional: R$ 25,00. Recebimento Efí Pix e repasse EXCLUSIVAMENTE MANUAL.
-- Nenhuma transferência automática e nenhum saldo liberado por seleção ou checkout pendente.
create table if not exists public.qf_visita_pagamentos (
 id uuid primary key default gen_random_uuid(),
 chamado_id uuid not null unique references public.qf_chamados(id),
 cliente_id uuid not null references public.qf_profiles(id),
 valor_centavos integer not null default 2500 check(valor_centavos=2500),
 metodo text not null default 'pix' check(metodo='pix'),
 status text not null default 'pendente' check(status in ('pendente','aprovado','cancelado','estornado')),
 provedor text,
 provedor_id text unique,
 checkout_url text,
 end_to_end_id text unique,
 aprovado_em timestamptz,
 repasse_status text not null default 'pendente' check(repasse_status in ('pendente','realizado')),
 profissional_id uuid references public.qf_profissionais(user_id),
 repassado_em timestamptz,
 repassado_por uuid references public.qf_profiles(id),
 observacao_repasse text,
 criado_em timestamptz not null default now(),
 atualizado_em timestamptz not null default now(),
 constraint visita_pago_banco check(
  status <> 'aprovado' or
  (provedor='efi' and provedor_id is not null and end_to_end_id is not null and aprovado_em is not null)
 ),
 constraint visita_repasse_manual check(
  repasse_status<>'realizado' or
  (status='aprovado' and profissional_id is not null and repassado_em is not null and repassado_por is not null and nullif(trim(observacao_repasse),'') is not null)
 )
);
create index if not exists qf_visita_pagamentos_criado on public.qf_visita_pagamentos(criado_em desc);
create index if not exists qf_visita_pagamentos_pendentes on public.qf_visita_pagamentos(repasse_status,aprovado_em desc) where status='aprovado';
alter table public.qf_visita_pagamentos enable row level security;
revoke all on public.qf_visita_pagamentos from public,anon,authenticated;
grant select on public.qf_visita_pagamentos to authenticated;
drop policy if exists qf_visita_cliente_leitura on public.qf_visita_pagamentos;
create policy qf_visita_cliente_leitura on public.qf_visita_pagamentos
 for select to authenticated using (cliente_id=(select auth.uid()));

create or replace function public.qf_visita_pagamento_timestamps()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
 new.atualizado_em:=now();
 if new.status='aprovado' and old.status is distinct from 'aprovado' then
  -- A consulta bancária precisa ter trazido o endToEndId, o valor exato e o TXID.
  if new.provedor<>'efi' or nullif(new.provedor_id,'') is null or nullif(new.end_to_end_id,'') is null
   or new.valor_centavos<>2500 then
   raise exception 'visita_sem_comprovacao_efi';
  end if;
  new.aprovado_em:=coalesce(new.aprovado_em,now());
 end if;
 return new;
end $$;
drop trigger if exists qf_visita_pagamento_timestamps on public.qf_visita_pagamentos;
create trigger qf_visita_pagamento_timestamps before update on public.qf_visita_pagamentos
 for each row execute function public.qf_visita_pagamento_timestamps();

create or replace function public.qf_solicitar_visita(p_chamado_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare u uuid:=auth.uid(); r public.qf_visita_pagamentos; c public.qf_chamados;
begin
 if u is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
 select * into c from public.qf_chamados where id=p_chamado_id and cliente_id=u for update;
 if not found then return jsonb_build_object('ok',false,'reason','pedido_nao_encontrado'); end if;
 if c.status in ('cancelado','finalizado') then return jsonb_build_object('ok',false,'reason','pedido_encerrado'); end if;
 if not exists (
  select 1 from private.qf_atendimentos a where a.chamado_id=c.id and a.cliente_id=u
   and a.respostas->>'visita_presencial'='sim'
 ) then return jsonb_build_object('ok',false,'reason','visita_nao_escolhida'); end if;
 insert into public.qf_visita_pagamentos(chamado_id,cliente_id)
 values(c.id,u) on conflict(chamado_id) do nothing;
 select * into r from public.qf_visita_pagamentos where chamado_id=c.id and cliente_id=u;
 if r.status not in ('pendente','aprovado') then return jsonb_build_object('ok',false,'reason','pagamento_encerrado'); end if;
 return jsonb_build_object('ok',true,'pagamento_id',r.id,'status',r.status,'valor_centavos',2500);
end $$;
revoke all on function public.qf_solicitar_visita(uuid) from public,anon,authenticated;
grant execute on function public.qf_solicitar_visita(uuid) to authenticated,service_role;

create or replace function public.qf_visita_status(p_chamado_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare u uuid:=auth.uid(); r public.qf_visita_pagamentos;
begin
 if u is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
 if not exists(select 1 from public.qf_chamados where id=p_chamado_id and cliente_id=u)
 then return jsonb_build_object('ok',false,'reason','pedido_nao_encontrado'); end if;
 select * into r from public.qf_visita_pagamentos where chamado_id=p_chamado_id and cliente_id=u;
 if not found then return jsonb_build_object('ok',true,'status','nao_solicitada','pago',false); end if;
 return jsonb_build_object('ok',true,'status',r.status,'pago',r.status='aprovado',
 'valor_centavos',r.valor_centavos,'repasse_status',r.repasse_status);
end $$;
revoke all on function public.qf_visita_status(uuid) from public,anon,authenticated;
grant execute on function public.qf_visita_status(uuid) to authenticated,service_role;

create or replace function public.qf_visita_info_chamados(p_ids uuid[])
returns table(chamado_id uuid,visita_status text,visita_valor_centavos integer)
language sql stable security definer set search_path to '' as $$
 select c.id,
  case when v.status='aprovado' then 'paga'
       when v.status='pendente' then 'pendente'
       when v.status in ('cancelado','estornado') then 'cancelada'
       else 'solicitada' end as visita_status,
  case when v.status='aprovado' then v.valor_centavos else 2500 end as visita_valor_centavos
 from public.qf_chamados c
 join private.qf_atendimentos a on a.chamado_id=c.id and a.respostas->>'visita_presencial'='sim'
 left join public.qf_visita_pagamentos v on v.chamado_id=c.id
 where c.id=any(p_ids[1:500]) and auth.uid() is not null
 and (c.cliente_id=auth.uid() or private.qf_is_admin()
   or exists(select 1 from public.qf_desbloqueios d where d.chamado_id=c.id and d.profissional_id=auth.uid() and coalesce(d.ativo,true))
   or private.qf_pedido_acessivel_pro(c.id))
$$;
revoke all on function public.qf_visita_info_chamados(uuid[]) from public,anon,authenticated;
grant execute on function public.qf_visita_info_chamados(uuid[]) to authenticated,service_role;

create or replace function public.qf_admin_visitas_pagamentos()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare dados jsonb;
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'acesso_negado'; end if;
 select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.criado_em desc),'[]'::jsonb) into dados
 from (
  select v.id,v.chamado_id,v.cliente_id,v.valor_centavos,v.status,v.repasse_status,
   v.provedor_id,v.end_to_end_id,v.aprovado_em,v.repassado_em,v.profissional_id,
   v.observacao_repasse,v.criado_em,c.titulo,c.cidade,c.bairro,
   p.nome as cliente_nome,
   coalesce((select jsonb_agg(distinct jsonb_build_object('id',d.profissional_id,'nome',pf.nome))
     from public.qf_desbloqueios d join public.qf_profiles pf on pf.id=d.profissional_id
     where d.chamado_id=v.chamado_id and coalesce(d.ativo,true)),'[]'::jsonb) as profissionais
  from public.qf_visita_pagamentos v
  join public.qf_chamados c on c.id=v.chamado_id
  left join public.qf_profiles p on p.id=v.cliente_id
  order by v.criado_em desc limit 100
 ) x;
 return dados;
end $$;
revoke all on function public.qf_admin_visitas_pagamentos() from public,anon,authenticated;
grant execute on function public.qf_admin_visitas_pagamentos() to authenticated,service_role;

create or replace function public.qf_admin_visita_marcar_repasse(p_pagamento_id uuid,p_profissional_id uuid,p_observacao text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v public.qf_visita_pagamentos;
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'acesso_negado'; end if;
 if length(trim(coalesce(p_observacao,'')))<5 then return jsonb_build_object('ok',false,'reason','informe_comprovante_do_repasse'); end if;
 select * into v from public.qf_visita_pagamentos where id=p_pagamento_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','pagamento_nao_encontrado'); end if;
 if v.repasse_status='realizado' then return jsonb_build_object('ok',true,'ja_registrado',true); end if;
 if v.status<>'aprovado' or v.end_to_end_id is null then return jsonb_build_object('ok',false,'reason','visita_ainda_nao_paga'); end if;
 if not exists(select 1 from public.qf_desbloqueios d where d.chamado_id=v.chamado_id
  and d.profissional_id=p_profissional_id and coalesce(d.ativo,true))
 then return jsonb_build_object('ok',false,'reason','profissional_nao_vinculado_ao_pedido'); end if;
 update public.qf_visita_pagamentos set repasse_status='realizado',profissional_id=p_profissional_id,
 repassado_em=now(),repassado_por=auth.uid(),observacao_repasse=trim(p_observacao)
 where id=v.id;
 return jsonb_build_object('ok',true,'valor_centavos',v.valor_centavos,'repasse','manual_registrado');
end $$;
revoke all on function public.qf_admin_visita_marcar_repasse(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.qf_admin_visita_marcar_repasse(uuid,uuid,text) to authenticated,service_role;
