-- Plano Livre: recebimento do cliente pelo Quem Faz + envio Pix ao banco do profissional.
-- NAO e split bancario atomico. Toda movimentacao depende de homologacao expressa (desligado).
create table if not exists private.qf_livre_pix_config(
 id boolean primary key default true check(id),
 habilitado boolean not null default false,
 homologado boolean not null default false,
 pix_send_aprovado boolean not null default false,
 atualizado_em timestamptz not null default now(),
 observacao text not null default 'Aguardando pix.send, limites da Efí, webhook, teste de titularidade e conciliação'
);
insert into private.qf_livre_pix_config(id) values(true) on conflict(id) do nothing;
alter table private.qf_livre_pix_config enable row level security;
revoke all on private.qf_livre_pix_config from public,anon,authenticated;

create table if not exists private.qf_livre_pix_recebedores(
 profissional_id uuid primary key references public.qf_profissionais(user_id),
 chave_pix text not null check(length(chave_pix) between 5 and 100),
 documento text not null check(length(documento) in (11,14)),
 status text not null default 'pendente' check(status in ('pendente','validado','reprovado')),
 atualizado_em timestamptz not null default now(),
 validado_em timestamptz,
 validado_por uuid,
 evidencia text
);
alter table private.qf_livre_pix_recebedores enable row level security;
revoke all on private.qf_livre_pix_recebedores from public,anon,authenticated;

create table if not exists private.qf_livre_pix_pagamentos(
 id uuid primary key default gen_random_uuid(),
 fechamento_id uuid not null unique references public.qf_comissao13_fechamentos(id),
 chamado_id uuid not null references public.qf_chamados(id),
 profissional_id uuid not null references public.qf_profissionais(user_id),
 txid text not null unique check(txid ~ '^[A-Za-z0-9]{26,35}$'),
 id_envio text not null unique check(id_envio ~ '^[A-Za-z0-9]{26,35}$'),
 chave_pix text not null,
 documento text not null,
 valor_centavos bigint not null check(valor_centavos between 100 and 100000000),
 comissao_centavos bigint not null check(comissao_centavos>0),
 repasse_centavos bigint not null check(repasse_centavos>0),
 status text not null default 'preparando'
  check(status in ('preparando','pix_pronto','pago','envio_solicitado','repassado','em_analise','cancelado')),
 pix_copia_cola text,
 checkout_url text,
 entrada_e2eid text unique,
 saida_e2eid text unique,
 pago_em timestamptz,
 repassado_em timestamptz,
 erro text,
 criado_em timestamptz not null default now(),
 atualizado_em timestamptz not null default now(),
 constraint qf_livre_pix_soma check(comissao_centavos+repasse_centavos=valor_centavos)
);
create index if not exists qf_livre_pix_ativos_idx on private.qf_livre_pix_pagamentos(status,criado_em);
alter table private.qf_livre_pix_pagamentos enable row level security;
revoke all on private.qf_livre_pix_pagamentos from public,anon,authenticated;

create table if not exists private.qf_livre_pix_avisos(
 pagamento_id uuid not null references private.qf_livre_pix_pagamentos(id),
 tipo text not null check(tipo in ('pagamento_confirmado','repasse_confirmado')),
 criado_em timestamptz not null default now(),
 primary key(pagamento_id,tipo)
);
alter table private.qf_livre_pix_avisos enable row level security;
revoke all on private.qf_livre_pix_avisos from public,anon,authenticated;

-- Chave Pix do proprio banco, so uma vez. A troca exige nova validacao.
create or replace function public.qf_livre_pix_conta_cadastrar(p_chave_pix text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare doc text; key_norm text;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 select regexp_replace(pr.documento,'[^0-9]','','g') into doc
 from public.qf_profissionais pr join public.qf_profiles p on p.id=pr.user_id
 where pr.user_id=auth.uid() and p.ativo and p.tipo='profissional';
 key_norm:=trim(coalesce(p_chave_pix,''));
 if doc is null or length(doc) not in(11,14) or length(key_norm) not between 5 and 100
  or not (key_norm ~ '^[0-9]{11}$' or key_norm ~ '^[0-9]{14}$'
     or key_norm ~ '^\+55[1-9][0-9]{10,11}$'
     or key_norm ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or key_norm ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
 then return jsonb_build_object('ok',false,'reason','chave_pix_invalida');end if;
 if exists(select 1 from private.qf_livre_pix_pagamentos where profissional_id=auth.uid()
  and status in ('preparando','pix_pronto','pago','envio_solicitado'))
 then return jsonb_build_object('ok',false,'reason','pagamento_em_andamento');end if;
 insert into private.qf_livre_pix_recebedores(profissional_id,chave_pix,documento,status)
 values(auth.uid(),key_norm,doc,'pendente')
 on conflict(profissional_id) do update set chave_pix=excluded.chave_pix,documento=excluded.documento,
 status='pendente',validado_em=null,validado_por=null,evidencia=null,atualizado_em=now();
 return jsonb_build_object('ok',true,'status','pendente','mensagem','Chave Pix salva. A verificacao do titular sera exigida antes do envio.');
end $$;
revoke all on function public.qf_livre_pix_conta_cadastrar(text) from public,anon;
grant execute on function public.qf_livre_pix_conta_cadastrar(text) to authenticated;

create or replace function public.qf_livre_pix_conta_status()
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 return coalesce((select jsonb_build_object('ok',true,'status',status,'chave_pix',chave_pix,'atualizado_em',atualizado_em)
  from private.qf_livre_pix_recebedores where profissional_id=auth.uid()),
  jsonb_build_object('ok',true,'status','nao_cadastrado'));
end $$;
revoke all on function public.qf_livre_pix_conta_status() from public,anon;
grant execute on function public.qf_livre_pix_conta_status() to authenticated;

create or replace function public.qf_livre_pix_contas_admin()
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin only' using errcode='42501';end if;
 return coalesce((select jsonb_agg(x order by x.atualizado_em desc) from
  (select r.profissional_id,p.nome as profissional,r.chave_pix,r.documento,r.status,
   r.atualizado_em,r.validado_em,r.evidencia
   from private.qf_livre_pix_recebedores r
   join public.qf_profiles p on p.id=r.profissional_id) x),'[]'::jsonb);
end $$;
revoke all on function public.qf_livre_pix_contas_admin() from public,anon;
grant execute on function public.qf_livre_pix_contas_admin() to authenticated;

create or replace function public.qf_livre_pix_conta_validar_admin(p_profissional uuid,p_aprovar boolean,p_evidencia text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
begin
 if auth.uid() is null or not private.qf_is_admin() then return jsonb_build_object('ok',false,'reason','sem_permissao');end if;
 if nullif(trim(coalesce(p_evidencia,'')),'') is null or length(trim(p_evidencia))<20
 then return jsonb_build_object('ok',false,'reason','verificacao_documentada_obrigatoria');end if;
 update private.qf_livre_pix_recebedores set status=case when p_aprovar then 'validado' else 'reprovado' end,
  validado_em=case when p_aprovar then now() else null end,validado_por=auth.uid(),
  evidencia=trim(p_evidencia),atualizado_em=now()
 where profissional_id=p_profissional;
 if not found then return jsonb_build_object('ok',false,'reason','nao_encontrado');end if;
 return jsonb_build_object('ok',true,'status',case when p_aprovar then 'validado' else 'reprovado' end);
end $$;
revoke all on function public.qf_livre_pix_conta_validar_admin(uuid,boolean,text) from public,anon;
grant execute on function public.qf_livre_pix_conta_validar_admin(uuid,boolean,text) to authenticated;

-- Checkout somente depois da conclusao e do codigo confirmados pelo cliente.
create or replace function public.qf_livre_pix_preparar(p_chamado_id uuid,p_segredo text,p_fechamento_id uuid)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare f public.qf_comissao13_fechamentos; r private.qf_livre_pix_recebedores;
 b private.qf_livre_pix_pagamentos;
begin
 if not exists(select 1 from private.qf_livre_pix_config where id and habilitado and homologado and pix_send_aprovado)
 then return jsonb_build_object('ok',false,'reason','repasse_em_preparacao');end if;
 if p_segredo is null or p_segredo !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 perform 1 from public.qf_chamados c join private.qf13_codigos_pedido k on k.chamado_id=c.id
 where c.id=p_chamado_id and c.status not in ('cancelado','expirado')
  and k.proprietario_hash=encode(extensions.digest(p_segredo,'sha256'),'hex') for update of c;
 if not found then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 select * into f from public.qf_comissao13_fechamentos
 where id=p_fechamento_id and chamado_id=p_chamado_id for update;
 if not found or f.status<>'confirmado' or f.codigo_validado_em is null or f.cliente_concluiu_em is null
  or f.cliente_resposta<>'confirmado' or f.valor_confirmado_centavos is null
 then return jsonb_build_object('ok',false,'reason','servico_nao_confirmado');end if;
 if not exists(select 1 from public.qf_desbloqueios d where d.id=f.desbloqueio_id
 and d.profissional_id=f.profissional_id and d.origem='comissao13')
 then return jsonb_build_object('ok',false,'reason','nao_e_livre');end if;
 if exists(select 1 from public.qf_comissao13_pix where fechamento_id=f.id)
  or exists(select 1 from private.qf_livre_split_pagamentos where fechamento_id=f.id)
 then return jsonb_build_object('ok',false,'reason','cobranca_anterior_existente');end if;
 select * into r from private.qf_livre_pix_recebedores where profissional_id=f.profissional_id
  and status='validado' and validado_em is not null for share;
 if not found then return jsonb_build_object('ok',false,'reason','chave_pix_nao_validada');end if;
 insert into private.qf_livre_pix_pagamentos(fechamento_id,chamado_id,profissional_id,txid,id_envio,
 chave_pix,documento,valor_centavos,comissao_centavos,repasse_centavos)
 values(f.id,f.chamado_id,f.profissional_id,replace(gen_random_uuid()::text,'-',''),
 replace(gen_random_uuid()::text,'-',''),r.chave_pix,r.documento,f.valor_confirmado_centavos,
 round(f.valor_confirmado_centavos*0.13)::bigint,
 f.valor_confirmado_centavos-round(f.valor_confirmado_centavos*0.13)::bigint)
 on conflict(fechamento_id) do nothing;
 select * into b from private.qf_livre_pix_pagamentos where fechamento_id=f.id;
 return jsonb_build_object('ok',true,'id',b.id,'status',b.status,'valor_centavos',b.valor_centavos,
 'comissao_centavos',b.comissao_centavos,'repasse_centavos',b.repasse_centavos);
end $$;
revoke all on function public.qf_livre_pix_preparar(uuid,text,uuid) from public;
grant execute on function public.qf_livre_pix_preparar(uuid,text,uuid) to anon,authenticated;

-- Rotas internas segregadas: o frontend nunca recebe chave do destinatario nem controla valor.
create or replace function public.qf_livre_pix_instrucao(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare b private.qf_livre_pix_pagamentos;
begin
 if not exists(select 1 from private.qf_livre_pix_config where id and habilitado and homologado and pix_send_aprovado)
 then return jsonb_build_object('ok',false,'reason','desabilitado');end if;
 select * into b from private.qf_livre_pix_pagamentos where id=p_id;
 if not found then return jsonb_build_object('ok',false,'reason','nao_encontrado');end if;
 return jsonb_build_object('ok',true,'id',b.id,'fechamento_id',b.fechamento_id,'chamado_id',b.chamado_id,
 'profissional_id',b.profissional_id,'txid',b.txid,'id_envio',b.id_envio,
 'valor_centavos',b.valor_centavos,'comissao_centavos',b.comissao_centavos,'repasse_centavos',b.repasse_centavos,
 'chave_pix',b.chave_pix,'documento',b.documento,'status',b.status,'entrada_e2eid',b.entrada_e2eid,
 'saida_e2eid',b.saida_e2eid,'pix_copia_cola',b.pix_copia_cola);
end $$;
revoke all on function public.qf_livre_pix_instrucao(uuid) from public,anon,authenticated;
grant execute on function public.qf_livre_pix_instrucao(uuid) to service_role;

create or replace function public.qf_livre_pix_pendentes()
returns jsonb language sql stable security definer set search_path to ''
as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from
 (select id from private.qf_livre_pix_pagamentos
 where status in('pix_pronto','pago','envio_solicitado') and criado_em>now()-interval '30 days'
 order by criado_em asc limit 50) x
$$;
revoke all on function public.qf_livre_pix_pendentes() from public,anon,authenticated;
grant execute on function public.qf_livre_pix_pendentes() to service_role;

create or replace function public.qf_livre_pix_marcar_qr(p_id uuid,p_txid text,p_codigo text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare b private.qf_livre_pix_pagamentos;
begin
 select * into b from private.qf_livre_pix_pagamentos where id=p_id for update;
 if not found or b.txid<>p_txid or b.status not in('preparando','pix_pronto')
  or p_codigo is null or length(p_codigo)<30 then return jsonb_build_object('ok',false,'reason','qr_invalido');end if;
 update private.qf_livre_pix_pagamentos set status='pix_pronto',pix_copia_cola=p_codigo,atualizado_em=now() where id=b.id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.qf_livre_pix_marcar_qr(uuid,text,text) from public,anon,authenticated;
grant execute on function public.qf_livre_pix_marcar_qr(uuid,text,text) to service_role;

create or replace function public.qf_livre_pix_confirmar_entrada(p_id uuid,p_txid text,p_e2e text,p_valor bigint)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare b private.qf_livre_pix_pagamentos;
begin
 select * into b from private.qf_livre_pix_pagamentos where id=p_id for update;
 if not found or b.txid<>p_txid or b.valor_centavos<>p_valor or p_e2e is null or length(p_e2e)<16
  or b.status not in('pix_pronto','pago','envio_solicitado','repassado')
 then return jsonb_build_object('ok',false,'reason','prova_bancaria_invalida');end if;
 if b.entrada_e2eid is not null and b.entrada_e2eid<>p_e2e
 then return jsonb_build_object('ok',false,'reason','pix_diferente');end if;
 if b.entrada_e2eid is null then
  update private.qf_livre_pix_pagamentos set entrada_e2eid=p_e2e,pago_em=now(),
   status='pago',atualizado_em=now() where id=p_id;
  return jsonb_build_object('ok',true,'novo',true,'status','pago');
 end if;
 return jsonb_build_object('ok',true,'novo',false,'status',b.status);
end $$;
revoke all on function public.qf_livre_pix_confirmar_entrada(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.qf_livre_pix_confirmar_entrada(uuid,text,text,bigint) to service_role;

create or replace function public.qf_livre_pix_confirmar_saida(p_id uuid,p_id_envio text,p_e2e text,p_valor bigint)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare b private.qf_livre_pix_pagamentos; f public.qf_comissao13_fechamentos;
begin
 select * into b from private.qf_livre_pix_pagamentos where id=p_id for update;
 if not found or b.id_envio<>p_id_envio or b.repasse_centavos<>p_valor
  or p_e2e is null or length(p_e2e)<16 or b.entrada_e2eid is null
  or b.status not in('pago','envio_solicitado','repassado')
 then return jsonb_build_object('ok',false,'reason','repasse_nao_conciliado');end if;
 if b.saida_e2eid is not null and b.saida_e2eid<>p_e2e
 then return jsonb_build_object('ok',false,'reason','id_bancario_divergente');end if;
 if b.status='repassado' then return jsonb_build_object('ok',true,'novo',false);end if;
 select * into f from public.qf_comissao13_fechamentos where id=b.fechamento_id for update;
 if f.status<>'confirmado' or f.cliente_concluiu_em is null or f.codigo_validado_em is null
 then return jsonb_build_object('ok',false,'reason','fechamento_divergente');end if;
 update private.qf_livre_pix_pagamentos set status='repassado',saida_e2eid=p_e2e,
  repassado_em=now(),atualizado_em=now() where id=b.id;
 update public.qf_comissao13_fechamentos set cobranca_status='paga',comissao_paga_em=now()
 where id=f.id and cobranca_status='pendente';
 update public.qf_chamados set status='finalizado',desfecho='fechado',
  desfecho_em=coalesce(desfecho_em,now()),atualizado_em=now()
 where id=f.chamado_id and status not in('cancelado','expirado','finalizado');
 return jsonb_build_object('ok',true,'novo',true,'status','repassado');
end $$;
revoke all on function public.qf_livre_pix_confirmar_saida(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.qf_livre_pix_confirmar_saida(uuid,text,text,bigint) to service_role;

create or replace function public.qf_livre_pix_estado(p_chamado_id uuid,p_segredo text,p_fechamento_id uuid)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare b private.qf_livre_pix_pagamentos;
begin
 if p_segredo is null or p_segredo !~ '^[a-f0-9]{64}$' or not exists(
 select 1 from private.qf13_codigos_pedido where chamado_id=p_chamado_id
  and proprietario_hash=encode(extensions.digest(p_segredo,'sha256'),'hex'))
 then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 select * into b from private.qf_livre_pix_pagamentos where chamado_id=p_chamado_id and fechamento_id=p_fechamento_id;
 return jsonb_build_object('ok',true,
 'disponivel',exists(select 1 from private.qf_livre_pix_config where id and habilitado and homologado and pix_send_aprovado),
 'status',coalesce(b.status,'nao_iniciado'),'valor_centavos',b.valor_centavos,
 'repasse_centavos',b.repasse_centavos,'comissao_centavos',b.comissao_centavos,
 'pix_copia_cola',case when b.status='pix_pronto' then b.pix_copia_cola else null end,
 'pago_em',b.pago_em,'repassado_em',b.repassado_em);
end $$;
revoke all on function public.qf_livre_pix_estado(uuid,text,uuid) from public;
grant execute on function public.qf_livre_pix_estado(uuid,text,uuid) to anon,authenticated;

create or replace function public.qf_livre_pix_avisar(p_id uuid,p_creditado boolean)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare b private.qf_livre_pix_pagamentos; novo boolean; v_tipo text;
begin
 select * into b from private.qf_livre_pix_pagamentos where id=p_id;
 if not found or b.entrada_e2eid is null or b.status not in('pago','envio_solicitado','repassado')
 then return jsonb_build_object('ok',false,'reason','pagamento_nao_confirmado');end if;
 if p_creditado and (b.status<>'repassado' or b.saida_e2eid is null)
 then return jsonb_build_object('ok',false,'reason','repasse_nao_confirmado');end if;
 v_tipo:=case when p_creditado then 'repasse_confirmado' else 'pagamento_confirmado' end;
 insert into private.qf_livre_pix_avisos(pagamento_id,tipo) values(b.id,v_tipo)
 on conflict do nothing returning true into novo;
 if novo is true then
  insert into public.qf_chat_mensagens(chamado_id,profissional_id,remetente_id,mensagem,tipo)
   select b.chamado_id,b.profissional_id,c.cliente_id,
    case when p_creditado
     then 'Quem Faz Livre: seu Pix de repasse de 87% foi confirmado no banco. Confira sua conta e o comprovante.'
     else 'Quem Faz Livre: pagamento do cliente confirmado. Seu repasse Pix de 87% está sendo preparado.'
    end,'sistema' from public.qf_chamados c where c.id=b.chamado_id;
  perform private.qf_push_interno('chat_message',b.chamado_id);
 end if;
 return jsonb_build_object('ok',true,'novo',coalesce(novo,false));
end $$;
revoke all on function public.qf_livre_pix_avisar(uuid,boolean) from public,anon,authenticated;
grant execute on function public.qf_livre_pix_avisar(uuid,boolean) to service_role;

-- Desativa a geracao paralela do Pix antigo de 13% APENAS para quem foi
-- habilitado neste novo fluxo e tem chave Pix validada. Nenhum efeito agora com flag false.
create or replace function private.qf_comissao13_automatico()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
 if new.status='confirmado' and new.cobranca_status='pendente' and new.comissao_centavos>0 then
  if (exists(select 1 from private.qf_livre_pix_config where id and habilitado and homologado and pix_send_aprovado)
    and exists(select 1 from private.qf_livre_pix_recebedores
      where profissional_id=new.profissional_id and status='validado' and validado_em is not null)
    and exists(select 1 from public.qf_desbloqueios d
      where d.id=new.desbloqueio_id and d.profissional_id=new.profissional_id and d.origem='comissao13'))
   or (exists(select 1 from private.qf_livre_split_config where id and habilitado and homologado)
    and exists(select 1 from private.qf_livre_split_recebedores
      where profissional_id=new.profissional_id and status='validado' and validado_em is not null)
    and exists(select 1 from public.qf_desbloqueios d
      where d.id=new.desbloqueio_id and d.profissional_id=new.profissional_id and d.origem='comissao13'))
  then
   update public.qf_comissao13_fechamentos set comissao_vence_em=null where id=new.id and comissao_vence_em is not null;
   return null;
  end if;
  insert into public.qf_comissao13_pix(fechamento_id,profissional_id,valor_centavos)
  values(new.id,new.profissional_id,new.comissao_centavos) on conflict(fechamento_id) do nothing;
 end if;
 return null;
end $$;
