-- Cadastro seguro da conta do profissional para o novo modelo Livre.
-- A chave Pix é informativa; Efí split exige uma conta Efí e CPF/CNPJ validados.
create table if not exists private.qf_livre_split_recebedores(
 profissional_id uuid primary key references public.qf_profissionais(user_id),
 chave_pix text not null,
 conta_efi text not null check(conta_efi ~ '^[0-9]{1,20}$'),
 documento text not null check(length(documento) in (11,14)),
 status text not null default 'pendente' check(status in('pendente','validado','reprovado')),
 criado_em timestamptz not null default now(),
 atualizado_em timestamptz not null default now(),
 validado_em timestamptz,
 validado_por uuid,
 evidencia text
);
alter table private.qf_livre_split_recebedores enable row level security;
revoke all on private.qf_livre_split_recebedores from public,anon,authenticated;

create or replace function public.qf_livre_split_conta_cadastrar(p_chave_pix text,p_conta_efi text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare doc text;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 select regexp_replace(pr.documento,'[^0-9]','','g') into doc
 from public.qf_profissionais pr join public.qf_profiles p on p.id=pr.user_id
 where pr.user_id=auth.uid() and p.ativo and p.tipo='profissional';
 if doc is null or length(doc) not in (11,14) or p_chave_pix is null
 or length(trim(p_chave_pix)) not between 5 and 100
 or p_conta_efi is null or p_conta_efi !~ '^[0-9]{1,20}$'
 then return jsonb_build_object('ok',false,'reason','dados_invalidos');end if;
 if exists(select 1 from private.qf_livre_split_pagamentos
   where profissional_id=auth.uid() and status in('preparando','pix_pronto','pago'))
 then return jsonb_build_object('ok',false,'reason','pagamento_em_andamento');end if;
 insert into private.qf_livre_split_recebedores
  (profissional_id,chave_pix,conta_efi,documento,status)
 values(auth.uid(),trim(p_chave_pix),p_conta_efi,doc,'pendente')
 on conflict(profissional_id) do update set
  chave_pix=excluded.chave_pix,conta_efi=excluded.conta_efi,
  documento=excluded.documento,status='pendente',atualizado_em=now(),
  validado_em=null,validado_por=null,evidencia=null;
 return jsonb_build_object('ok',true,'status','pendente',
 'mensagem','Dados recebidos. O repasse só poderá ser habilitado após validação da conta Efí e do CPF/CNPJ.');
end $$;
revoke all on function public.qf_livre_split_conta_cadastrar(text,text) from public,anon;
grant execute on function public.qf_livre_split_conta_cadastrar(text,text) to authenticated;

create or replace function public.qf_livre_split_conta_status()
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 return coalesce((select jsonb_build_object('ok',true,'status',status,
 'conta_efi_final',right(conta_efi,4),'chave_pix',chave_pix,'atualizado_em',atualizado_em)
 from private.qf_livre_split_recebedores where profissional_id=auth.uid()),
 jsonb_build_object('ok',true,'status','nao_cadastrado'));
end $$;
revoke all on function public.qf_livre_split_conta_status() from public,anon;
grant execute on function public.qf_livre_split_conta_status() to authenticated;

-- Validação manual exige documento, titular e evidência bancária confirmada.
create or replace function public.qf_livre_split_conta_validar_admin(
 p_profissional uuid,p_aprovar boolean,p_evidencia text
) returns jsonb language plpgsql security definer set search_path to ''
as $$
begin
 if not private.qf_is_admin() then return jsonb_build_object('ok',false,'reason','sem_permissao');end if;
 if p_evidencia is null or length(trim(p_evidencia))<20
 then return jsonb_build_object('ok',false,'reason','evidencia_obrigatoria');end if;
 update private.qf_livre_split_recebedores set
  status=case when p_aprovar then 'validado' else 'reprovado' end,
  validado_em=case when p_aprovar then now() else null end,
  validado_por=auth.uid(),evidencia=trim(p_evidencia),atualizado_em=now()
 where profissional_id=p_profissional;
 if not found then return jsonb_build_object('ok',false,'reason','conta_nao_encontrada');end if;
 return jsonb_build_object('ok',true,'status',case when p_aprovar then 'validado' else 'reprovado' end);
end $$;
revoke all on function public.qf_livre_split_conta_validar_admin(uuid,boolean,text) from public,anon;
grant execute on function public.qf_livre_split_conta_validar_admin(uuid,boolean,text) to authenticated;

-- O fluxo financeiro agora usa apenas recebedores exclusivos do Livre.
create or replace function public.qf_livre_split_preparar(
 p_chamado_id uuid,p_segredo text,p_fechamento_id uuid
) returns jsonb language plpgsql security definer set search_path to ''
as $$
declare f public.qf_comissao13_fechamentos; r private.qf_livre_split_recebedores;
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
 select * into r from private.qf_livre_split_recebedores where profissional_id=f.profissional_id
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

create or replace function private.qf_comissao13_automatico()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
 if new.status='confirmado' and new.cobranca_status='pendente' and new.comissao_centavos>0 then
  if exists(select 1 from private.qf_livre_split_config where id and habilitado and homologado)
   and exists(select 1 from private.qf_livre_split_recebedores
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