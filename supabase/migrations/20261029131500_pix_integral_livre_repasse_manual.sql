-- Quem Faz Livre: cobrança integral do serviço por Pix na conta do Quem Faz;
-- repasse dos 87% MANUAL, mediante comprovante da transferência feita pelo administrador.
-- Migração segura: a nova cobrança começa DESLIGADA, até deploy e validação bancária.
create table if not exists private.qf_livre_manual_config(
  id boolean primary key default true check (id),
  habilitado boolean not null default false,
  ativado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  observacao text not null default 'Aguardando publicação e validação da cobrança integral Efí'
);
insert into private.qf_livre_manual_config(id) values(true) on conflict(id) do nothing;

create table if not exists private.qf_livre_manual_pix(
  id uuid primary key default gen_random_uuid(),
  fechamento_id uuid not null unique references public.qf_comissao13_fechamentos(id) on delete restrict,
  chamado_id uuid not null references public.qf_chamados(id) on delete restrict,
  profissional_id uuid not null references public.qf_profissionais(user_id),
  txid text not null unique default replace(gen_random_uuid()::text,'-',''),
  valor_centavos bigint not null check(valor_centavos between 100 and 100000000),
  comissao_centavos bigint not null check(comissao_centavos>0),
  profissional_centavos bigint not null check(profissional_centavos>0),
  status text not null default 'criando' check(status in ('criando','pix_pronto','pago','repassado','bloqueado')),
  pix_copia_cola text,
  checkout_url text,
  end_to_end_id text unique,
  confirmado_em timestamptz,
  repassado_em timestamptz,
  repasse_referencia text,
  repasse_comprovante text,
  repasse_admin uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check(valor_centavos=comissao_centavos+profissional_centavos),
  check(comissao_centavos=round(valor_centavos*0.13)::bigint),
  check(txid~'^[A-Za-z0-9]{26,35}$')
);
create index if not exists qf_livre_manual_pix_status on private.qf_livre_manual_pix(status,criado_em);
alter table private.qf_livre_manual_pix enable row level security;

create or replace function public.qf_livre_manual_pix_preparar(p_chamado_id uuid,p_segredo text,p_fechamento_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare f public.qf_comissao13_fechamentos; v private.qf_livre_manual_pix; t timestamptz;
begin
 select ativado_em into t from private.qf_livre_manual_config where id and habilitado;
 if t is null then return jsonb_build_object('ok',false,'reason','pagamento_em_preparacao');end if;
 if p_segredo is null or p_segredo!~'^[a-f0-9]{64}$'
    or not exists(select 1 from private.qf13_codigos_pedido k where k.chamado_id=p_chamado_id
     and k.proprietario_hash=encode(extensions.digest(p_segredo,'sha256'),'hex'))
 then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 perform 1 from public.qf_chamados where id=p_chamado_id and status not in ('cancelado','expirado') for update;
 if not found then return jsonb_build_object('ok',false,'reason','pedido_encerrado');end if;
 select * into f from public.qf_comissao13_fechamentos where id=p_fechamento_id and chamado_id=p_chamado_id for update;
 if not found or f.status<>'confirmado' or f.cliente_resposta<>'confirmado'
   or f.confirmado_em<t or f.cliente_concluiu_em is null or f.codigo_validado_em is null
   or f.valor_confirmado_centavos is null or f.valor_confirmado_centavos<100
 then return jsonb_build_object('ok',false,'reason','conclusao_nao_confirmada');end if;
 if not exists(select 1 from public.qf_desbloqueios d where d.id=f.desbloqueio_id and d.profissional_id=f.profissional_id and d.origem='comissao13')
 then return jsonb_build_object('ok',false,'reason','modalidade_incorreta');end if;
 if exists(select 1 from public.qf_comissao13_pix where fechamento_id=f.id)
   or exists(select 1 from private.qf_livre_split_pagamentos where fechamento_id=f.id)
 then return jsonb_build_object('ok',false,'reason','cobranca_antiga_existente');end if;
 insert into private.qf_livre_manual_pix(fechamento_id,chamado_id,profissional_id,valor_centavos,comissao_centavos,profissional_centavos)
 values(f.id,f.chamado_id,f.profissional_id,f.valor_confirmado_centavos,round(f.valor_confirmado_centavos*0.13)::bigint,
  f.valor_confirmado_centavos-round(f.valor_confirmado_centavos*0.13)::bigint)
 on conflict(fechamento_id) do nothing;
 select * into v from private.qf_livre_manual_pix where fechamento_id=f.id for update;
 if v.status='bloqueado' then return jsonb_build_object('ok',false,'reason','pagamento_em_analise');end if;
 return jsonb_build_object('ok',true,'id',v.id,'status',v.status,'valor_centavos',v.valor_centavos);
end $$;

create or replace function public.qf_livre_manual_pix_estado(p_chamado_id uuid,p_segredo text,p_fechamento_id uuid)
returns jsonb language plpgsql security definer stable set search_path to '' as $$
declare v private.qf_livre_manual_pix; ativo boolean; t timestamptz;
begin
 if p_segredo is null or p_segredo!~'^[a-f0-9]{64}$'
   or not exists(select 1 from private.qf13_codigos_pedido where chamado_id=p_chamado_id
    and proprietario_hash=encode(extensions.digest(p_segredo,'sha256'),'hex'))
 then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 select habilitado,ativado_em into ativo,t from private.qf_livre_manual_config where id;
 select * into v from private.qf_livre_manual_pix where chamado_id=p_chamado_id and fechamento_id=p_fechamento_id;
 return jsonb_build_object('ok',true,'disponivel',coalesce(ativo,false),'status',coalesce(v.status,'nao_iniciado'),
 'valor_centavos',v.valor_centavos,'comissao_centavos',v.comissao_centavos,
 'profissional_centavos',v.profissional_centavos,
 'pix_copia_cola',case when v.status='pix_pronto' then v.pix_copia_cola else null end,
 'confirmado_em',v.confirmado_em,'repassado_em',v.repassado_em);
end $$;

create or replace function public.qf_livre_manual_pix_instrucao(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v private.qf_livre_manual_pix;
begin
 select * into v from private.qf_livre_manual_pix where id=p_id;
 if not found then return jsonb_build_object('ok',false,'reason','nao_encontrado');end if;
 return jsonb_build_object('ok',true,'id',v.id,'txid',v.txid,'valor_centavos',v.valor_centavos,
 'status',v.status,'pix_copia_cola',v.pix_copia_cola,'checkout_url',v.checkout_url);
end $$;
revoke all on function public.qf_livre_manual_pix_instrucao(uuid) from public,anon,authenticated;
grant execute on function public.qf_livre_manual_pix_instrucao(uuid) to service_role;

create or replace function public.qf_livre_manual_pix_marcar_qr(p_id uuid,p_txid text,p_pix text,p_url text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v private.qf_livre_manual_pix;
begin
 if length(coalesce(p_pix,''))<30 or length(p_pix)>8000 then return jsonb_build_object('ok',false,'reason','pix_invalido');end if;
 select * into v from private.qf_livre_manual_pix where id=p_id for update;
 if not found or v.txid<>p_txid or v.status not in ('criando','pix_pronto')
 then return jsonb_build_object('ok',false,'reason','cobranca_incompativel');end if;
 update private.qf_livre_manual_pix set status='pix_pronto',pix_copia_cola=p_pix,checkout_url=p_url,atualizado_em=now()
 where id=v.id;
 return jsonb_build_object('ok',true,'status','pix_pronto');
end $$;
revoke all on function public.qf_livre_manual_pix_marcar_qr(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.qf_livre_manual_pix_marcar_qr(uuid,text,text,text) to service_role;

create or replace function public.qf_livre_manual_pix_liquidar(p_id uuid,p_txid text,p_e2e text,p_valor bigint)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v private.qf_livre_manual_pix; f public.qf_comissao13_fechamentos;
begin
 select * into v from private.qf_livre_manual_pix where id=p_id for update;
 if not found or v.txid<>p_txid or v.valor_centavos<>p_valor or length(coalesce(p_e2e,''))<16
 then return jsonb_build_object('ok',false,'reason','pagamento_incompativel');end if;
 if v.status in ('pago','repassado') then
  return jsonb_build_object('ok',v.end_to_end_id=p_e2e,'status',v.status,'duplicado',true);
 end if;
 if v.status<>'pix_pronto' then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
 select * into f from public.qf_comissao13_fechamentos where id=v.fechamento_id for update;
 if f.status<>'confirmado' or f.valor_confirmado_centavos<>p_valor or f.codigo_validado_em is null
 or f.cliente_concluiu_em is null or f.cobranca_status not in ('pendente','paga')
 then return jsonb_build_object('ok',false,'reason','fechamento_invalido');end if;
 update private.qf_livre_manual_pix set status='pago',end_to_end_id=p_e2e,confirmado_em=now(),atualizado_em=now()
 where id=v.id;
 update public.qf_comissao13_fechamentos set cobranca_status='paga',comissao_paga_em=now(),
 comissao_vence_em=null where id=f.id and cobranca_status='pendente';
 return jsonb_build_object('ok',true,'status','pago');
end $$;
revoke all on function public.qf_livre_manual_pix_liquidar(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.qf_livre_manual_pix_liquidar(uuid,text,text,bigint) to service_role;

create or replace function public.qf_livre_manual_pix_pendentes()
returns jsonb language sql stable security definer set search_path to '' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status)),'[]'::jsonb)
 from private.qf_livre_manual_pix where status='pix_pronto';
$$;
revoke all on function public.qf_livre_manual_pix_pendentes() from public,anon,authenticated;
grant execute on function public.qf_livre_manual_pix_pendentes() to service_role;

create or replace function public.qf_livre_manual_pix_painel()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid:=auth.uid(); v_admin boolean;
begin
 if v_uid is null then return '[]'::jsonb;end if;
 v_admin:=private.qf_is_admin();
 return (select coalesce(jsonb_agg(jsonb_build_object(
 'id',v.id,'fechamento_id',v.fechamento_id,'chamado_id',v.chamado_id,
 'profissional_id',v.profissional_id,'profissional',p.nome,'valor_centavos',v.valor_centavos,
 'comissao_centavos',v.comissao_centavos,'profissional_centavos',v.profissional_centavos,
 'status',v.status,'confirmado_em',v.confirmado_em,'repassado_em',v.repassado_em,
 'pix_chave',case when v_admin then k.chave_pix else null end,
 'repasse_comprovante',case when v_admin then v.repasse_comprovante else null end
 ) order by v.criado_em desc),'[]'::jsonb)
 from private.qf_livre_manual_pix v
 join public.qf_profiles p on p.id=v.profissional_id
 left join public.qf_livre_pix_chaves k on k.profissional_id=v.profissional_id
 where v_admin or v.profissional_id=v_uid);
end $$;
revoke all on function public.qf_livre_manual_pix_painel() from public,anon;
grant execute on function public.qf_livre_manual_pix_painel() to authenticated;

create or replace function public.qf_livre_manual_pix_repassar(p_id uuid,p_referencia text,p_comprovante text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v private.qf_livre_manual_pix; k public.qf_livre_pix_chaves;
begin
 if auth.uid() is null or not private.qf_is_admin() then
 return jsonb_build_object('ok',false,'reason','admin_obrigatorio');end if;
 if length(trim(coalesce(p_referencia,'')))<16 or length(trim(coalesce(p_comprovante,'')))<8
 then return jsonb_build_object('ok',false,'reason','comprovacao_obrigatoria');end if;
 select * into v from private.qf_livre_manual_pix where id=p_id for update;
 if not found or v.status<>'pago' or v.confirmado_em is null or v.end_to_end_id is null
 then return jsonb_build_object('ok',false,'reason','pix_nao_conciliado_ou_repassado');end if;
 select * into k from public.qf_livre_pix_chaves where profissional_id=v.profissional_id;
 if not found or length(trim(k.chave_pix))<5
 then return jsonb_build_object('ok',false,'reason','chave_pix_ausente');end if;
 -- A movimentação financeira é EXTERNA e MANUAL; este RPC só registra comprovante.
 update private.qf_livre_manual_pix set status='repassado',repassado_em=now(),
 repasse_admin=auth.uid(),repasse_referencia=left(trim(p_referencia),150),
 repasse_comprovante=left(trim(p_comprovante),500),atualizado_em=now() where id=v.id;
 return jsonb_build_object('ok',true,'status','repassado','profissional_centavos',v.profissional_centavos);
end $$;
revoke all on function public.qf_livre_manual_pix_repassar(uuid,text,text) from public,anon;
grant execute on function public.qf_livre_manual_pix_repassar(uuid,text,text) to authenticated;

-- Não criar a cobrança antiga só de 13% para serviços NOVOS depois da ativação
-- (evita dois Pix pelo mesmo serviço). Cobranças antigas continuam válidas.
create or replace function private.qf_comissao13_automatico()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
 if new.status='confirmado' and new.cobranca_status='pendente' and new.comissao_centavos>0 then
  if exists(select 1 from private.qf_livre_manual_config where id and habilitado
     and ativado_em is not null and new.confirmado_em>=ativado_em)
   and exists(select 1 from public.qf_desbloqueios where id=new.desbloqueio_id
     and profissional_id=new.profissional_id and origem='comissao13')
   and not exists(select 1 from public.qf_comissao13_pix where fechamento_id=new.id)
  then
   -- Cliente pagará 100% à plataforma; a comissão não é dívida de Pix do profissional.
   return null;
  end if;
  insert into public.qf_comissao13_pix(fechamento_id,profissional_id,valor_centavos)
    values(new.id,new.profissional_id,new.comissao_centavos) on conflict(fechamento_id) do nothing;
 end if;
 return null;
end $$;

create or replace function private.qf13_bloqueio(p_prof uuid)
returns text language sql stable security definer set search_path to '' as $$
 select case when exists(
  select 1 from public.qf_comissao13_fechamentos f
  where f.profissional_id=p_prof and f.status='confirmado' and f.cobranca_status='pendente'
    and (f.comissao_vence_em<=now() or f.recebimento_direto_declarado_em is not null)
    and not(
      exists(select 1 from private.qf_livre_manual_config where id and habilitado
        and ativado_em is not null and f.confirmado_em>=ativado_em)
      and not exists(select 1 from public.qf_comissao13_pix where fechamento_id=f.id)
    )
 ) then 'comissao_pendente' else null end;
$$;

-- Regras sensíveis nunca ficam acessíveis por SELECT direto no navegador.
revoke all on private.qf_livre_manual_pix from anon,authenticated;
revoke all on private.qf_livre_manual_config from anon,authenticated;
