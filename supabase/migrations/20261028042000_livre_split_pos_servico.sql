-- Quem Faz Livre: pagamentos POS-SERVICO com split Efí.
-- Feature flag fechada por padrão; nenhuma cobrança real antes da homologação.
create table if not exists private.qf_livre_split_config(
 id boolean primary key default true check(id),
 habilitado boolean not null default false,
 homologado boolean not null default false,
 atualizado_em timestamptz not null default now(),
 observacao text not null default 'Aguardando validação bancária, tarifária e teste real de repasse'
);
insert into private.qf_livre_split_config(id) values(true) on conflict(id) do nothing;
alter table private.qf_livre_split_config enable row level security;
revoke all on private.qf_livre_split_config from public, anon, authenticated;

create table if not exists private.qf_livre_split_pagamentos(
 id uuid primary key default gen_random_uuid(),
 fechamento_id uuid not null unique references public.qf_comissao13_fechamentos(id),
 chamado_id uuid not null references public.qf_chamados(id),
 profissional_id uuid not null references public.qf_profissionais(user_id),
 txid text not null unique check(txid ~ '^[a-zA-Z0-9]{26,35}$'),
 split_id text not null unique,
 valor_centavos bigint not null check(valor_centavos between 100 and 100000000),
 profissional_centavos bigint not null check(profissional_centavos>0),
 plataforma_centavos bigint not null check(plataforma_centavos>0),
 conta_efi text not null,
 documento text not null,
 status text not null default 'preparando' check(status in ('preparando','pix_pronto','pago','repassado','erro_revisao','cancelado')),
 pix_copia_cola text,
 checkout_url text,
 end_to_end_id text unique,
 confirmado_em timestamptz,
 repassado_em timestamptz,
 criado_em timestamptz not null default now(),
 atualizado_em timestamptz not null default now(),
 erro text,
 constraint qf_livre_split_total check(valor_centavos=profissional_centavos+plataforma_centavos)
);
create index if not exists qf_livre_split_status_idx on private.qf_livre_split_pagamentos(status,criado_em);
alter table private.qf_livre_split_pagamentos enable row level security;
revoke all on private.qf_livre_split_pagamentos from public,anon,authenticated;

-- Um fechamento com split só pode gerar cobrança com confirmação do cliente e conta Efí validada.
create or replace function public.qf_livre_split_preparar(
 p_chamado_id uuid,p_segredo text,p_fechamento_id uuid
) returns jsonb language plpgsql security definer set search_path to ''
as $$
declare f public.qf_comissao13_fechamentos; r private.qf_comissao13_recebedores;
        b private.qf_livre_split_pagamentos; v_id uuid;
begin
 if not exists(select 1 from private.qf_livre_split_config where id and habilitado and homologado)
 then return jsonb_build_object('ok',false,'reason','split_em_preparacao'); end if;
 if p_segredo is null or p_segredo !~ '^[a-f0-9]{64}$'
 then return jsonb_build_object('ok',false,'reason','acesso_invalido'); end if;
 perform 1 from public.qf_chamados c join private.qf13_codigos_pedido k on k.chamado_id=c.id
 where c.id=p_chamado_id and c.status not in ('cancelado','expirado')
   and k.proprietario_hash=encode(extensions.digest(p_segredo,'sha256'),'hex') for update of c;
 if not found then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 select * into f from public.qf_comissao13_fechamentos where id=p_fechamento_id and chamado_id=p_chamado_id for update;
 if not found or f.status<>'confirmado' or f.codigo_validado_em is null or f.cliente_concluiu_em is null
   or f.cliente_resposta<>'confirmado' or f.valor_confirmado_centavos is null
 then return jsonb_build_object('ok',false,'reason','conclusao_nao_confirmada');end if;
 if exists(select 1 from public.qf_comissao13_pix where fechamento_id=f.id)
 then return jsonb_build_object('ok',false,'reason','cobranca_antiga_existente');end if;
 if not private.qf_livre_identificacao(f.profissional_id)
 then return jsonb_build_object('ok',false,'reason','plano_livre_inativo');end if;
 select * into r from private.qf_comissao13_recebedores where profissional_id=f.profissional_id
  and status='validado' and validado_em is not null for share;
 if not found or r.conta_efi !~ '^[0-9]{1,20}$' or length(r.documento) not in(11,14)
 then return jsonb_build_object('ok',false,'reason','conta_efi_pendente');end if;
 insert into private.qf_livre_split_pagamentos(
  fechamento_id,chamado_id,profissional_id,txid,split_id,valor_centavos,
  profissional_centavos,plataforma_centavos,conta_efi,documento)
 values (
  f.id,f.chamado_id,f.profissional_id,
  replace(gen_random_uuid()::text,'-',''),
  replace(gen_random_uuid()::text,'-',''),
  f.valor_confirmado_centavos,
  f.valor_confirmado_centavos-round(f.valor_confirmado_centavos*0.13)::bigint,
  round(f.valor_confirmado_centavos*0.13)::bigint,r.conta_efi,r.documento)
 on conflict(fechamento_id) do nothing;
 select * into b from private.qf_livre_split_pagamentos where fechamento_id=f.id;
 if b.status in ('cancelado','erro_revisao') then return jsonb_build_object('ok',false,'reason','pagamento_em_analise');end if;
 return jsonb_build_object('ok',true,'id',b.id,'valor_centavos',b.valor_centavos,
  'profissional_centavos',b.profissional_centavos,'plataforma_centavos',b.plataforma_centavos,
  'status',b.status);
end $$;
revoke all on function public.qf_livre_split_preparar(uuid,text,uuid) from public;
grant execute on function public.qf_livre_split_preparar(uuid,text,uuid) to anon,authenticated;

-- Somente serviço bancário interno pode publicar QR ou confirmar liquidação.
create or replace function public.qf_livre_split_marcar_qr(p_id uuid,p_txid text,p_codigo text,p_url text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare b private.qf_livre_split_pagamentos;
begin
 select * into b from private.qf_livre_split_pagamentos where id=p_id for update;
 if not found or b.txid<>p_txid or b.status not in('preparando','pix_pronto')
 or p_codigo is null or length(p_codigo)<30
 then return jsonb_build_object('ok',false,'reason','qr_invalido');end if;
 update private.qf_livre_split_pagamentos
 set status='pix_pronto',pix_copia_cola=p_codigo,checkout_url=p_url,atualizado_em=now(),erro=null
 where id=b.id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.qf_livre_split_marcar_qr(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.qf_livre_split_marcar_qr(uuid,text,text,text) to service_role;

create or replace function public.qf_livre_split_confirmar_banco(
 p_id uuid,p_txid text,p_end_to_end_id text,p_valor bigint,
 p_split_id text,p_conta_efi text,p_repasse_creditado boolean
) returns jsonb language plpgsql security definer set search_path to ''
as $$
declare b private.qf_livre_split_pagamentos; f public.qf_comissao13_fechamentos;
begin
 select * into b from private.qf_livre_split_pagamentos where id=p_id for update;
 if not found or b.txid<>p_txid or b.valor_centavos<>p_valor
 or b.split_id<>p_split_id or b.conta_efi<>p_conta_efi or p_end_to_end_id is null
 or length(p_end_to_end_id)<16 or b.status not in('pix_pronto','pago','repassado')
 then return jsonb_build_object('ok',false,'reason','prova_bancaria_incompativel');end if;
 select * into f from public.qf_comissao13_fechamentos where id=b.fechamento_id for update;
 if f.status<>'confirmado' or f.valor_confirmado_centavos<>b.valor_centavos or f.cliente_concluiu_em is null
 or f.codigo_validado_em is null then return jsonb_build_object('ok',false,'reason','fechamento_incompativel');end if;
 if b.end_to_end_id is not null and b.end_to_end_id<>p_end_to_end_id
 then return jsonb_build_object('ok',false,'reason','pix_diferente');end if;
 if b.status='repassado' then return jsonb_build_object('ok',true,'duplicado',true,'status',b.status);end if;
 update private.qf_livre_split_pagamentos set
  end_to_end_id=p_end_to_end_id,
  status=case when p_repasse_creditado then 'repassado' else 'pago' end,
  confirmado_em=coalesce(confirmado_em,now()),
  repassado_em=case when p_repasse_creditado then coalesce(repassado_em,now()) else repassado_em end,
  atualizado_em=now()
 where id=b.id;
 if p_repasse_creditado then
  update public.qf_comissao13_fechamentos
    set cobranca_status='paga',comissao_paga_em=coalesce(comissao_paga_em,now())
  where id=f.id and cobranca_status='pendente';
  -- Baixa financeira só depois da prova de repasse confirmado pelo banco.
  update public.qf_chamados set status='finalizado',desfecho='fechado',desfecho_em=coalesce(desfecho_em,now()),atualizado_em=now()
   where id=f.chamado_id and status not in('cancelado','expirado','finalizado');
 end if;
 return jsonb_build_object('ok',true,'status',case when p_repasse_creditado then 'repassado' else 'pago' end,
    'notificar',b.confirmado_em is null or (p_repasse_creditado and b.repassado_em is null));
end $$;
revoke all on function public.qf_livre_split_confirmar_banco(uuid,text,text,bigint,text,text,boolean) from public,anon,authenticated;
grant execute on function public.qf_livre_split_confirmar_banco(uuid,text,text,bigint,text,text,boolean) to service_role;

-- Lê apenas dados do próprio pedido: acesso com segredo 256 bits criado ao publicar.
create or replace function public.qf_livre_split_estado(p_chamado_id uuid,p_segredo text,p_fechamento_id uuid)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare b private.qf_livre_split_pagamentos;
begin
 if p_segredo is null or p_segredo !~ '^[a-f0-9]{64}$' or not exists(
  select 1 from private.qf13_codigos_pedido
   where chamado_id=p_chamado_id
     and proprietario_hash=encode(extensions.digest(p_segredo,'sha256'),'hex'))
 then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 select * into b from private.qf_livre_split_pagamentos where chamado_id=p_chamado_id and fechamento_id=p_fechamento_id;
 return jsonb_build_object('ok',true,
    'disponivel',exists(select 1 from private.qf_livre_split_config where id and habilitado and homologado),
    'status',coalesce(b.status,'nao_iniciado'),
    'valor_centavos',b.valor_centavos,
    'profissional_centavos',b.profissional_centavos,
    'plataforma_centavos',b.plataforma_centavos,
    'pix_copia_cola',case when b.status='pix_pronto' then b.pix_copia_cola else null end,
    'repassado_em',b.repassado_em,'confirmado_em',b.confirmado_em);
end $$;
revoke all on function public.qf_livre_split_estado(uuid,text,uuid) from public;
grant execute on function public.qf_livre_split_estado(uuid,text,uuid) to anon,authenticated;

-- No modelo split validado, não gera um SEGUNDO Pix de 13% para o profissional.
create or replace function private.qf_comissao13_automatico()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
 if new.status='confirmado' and new.cobranca_status='pendente' and new.comissao_centavos>0 then
  if exists(select 1 from private.qf_livre_split_config where id and habilitado and homologado)
   and exists(select 1 from private.qf_comissao13_recebedores
     where profissional_id=new.profissional_id and status='validado' and validado_em is not null)
   and private.qf_livre_identificacao(new.profissional_id)
  then
   update public.qf_comissao13_fechamentos set comissao_vence_em=null
     where id=new.id and comissao_vence_em is not null;
   return null;
  end if;
  insert into public.qf_comissao13_pix (fechamento_id,profissional_id,valor_centavos)
    values (new.id,new.profissional_id,new.comissao_centavos) on conflict(fechamento_id) do nothing;
 end if;
 return null;
end $$;