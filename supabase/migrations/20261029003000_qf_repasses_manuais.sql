
-- Controle de repasse MANUAL. Não inicia Pix e não modifica cobranças existentes.
create table if not exists public.qf_repasses_manuais (
  id uuid primary key default gen_random_uuid(),
  financeiro_id uuid not null unique references public.qf_comissao13_financeiro(id),
  acordo_id uuid not null references public.qf_comissao13_acordos(id),
  profissional_id uuid not null,
  valor_bruto_centavos bigint not null check (valor_bruto_centavos > 0),
  comissao_centavos bigint not null check(comissao_centavos >= 0),
  profissional_centavos bigint not null check(profissional_centavos > 0),
  pix_chave text not null,
  pix_atualizado_em timestamptz,
  status text not null default 'solicitado' check(status in ('solicitado','em_analise','bloqueado','pago')),
  solicitado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  pago_em timestamptz,
  comprovante_ref text,
  pix_end_to_end_id text unique,
  observacao text,
  aprovado_por uuid,
  constraint qf_manual_soma check (valor_bruto_centavos = comissao_centavos + profissional_centavos)
);
alter table public.qf_repasses_manuais enable row level security;
revoke all on public.qf_repasses_manuais from anon,authenticated;
create table if not exists public.qf_repasses_manuais_eventos (
 id uuid primary key default gen_random_uuid(),
 repasse_id uuid not null references public.qf_repasses_manuais(id),
 ator uuid,
 tipo text not null,
 detalhe jsonb not null default '{}'::jsonb,
 criado_em timestamptz not null default now()
);
create index if not exists qf_repasses_manuais_eventos_repasse on public.qf_repasses_manuais_eventos(repasse_id,criado_em desc);
alter table public.qf_repasses_manuais_eventos enable row level security;
revoke all on public.qf_repasses_manuais_eventos from anon,authenticated;

create or replace function public.qf_repasses_manuais_painel()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_admin boolean; v_result jsonb;
begin
 if v_uid is null then raise exception 'authentication required'; end if;
 v_admin := private.qf_is_admin();
 select coalesce(jsonb_agg(to_jsonb(x) order by x.pago_em desc),'[]'::jsonb)
 into v_result from (
  select a.id acordo_id, f.id financeiro_id, c.titulo pedido,
  case when v_admin then p.nome else null end profissional,
  a.profissional_id, f.valor_centavos valor_bruto_centavos,
  f.comissao_centavos, f.profissional_centavos,
  f.pago_em, m.solicitado_em, m.pago_em as repassado_em,
  m.id repasse_id, m.status repasse_status,
  case when m.id is null then 'disponivel' else m.status end situacao,
  k.chave_pix, k.status chave_status,
  m.comprovante_ref, m.pix_end_to_end_id,
  (m.id is null and f.status='pago' and f.repasse_status not in ('concluido','repassado')
   and a.status not in ('contestado','cancelado') and a.concluido_em is not null
   and f.estornado_centavos=0 and k.chave_pix is not null
   and f.comissao_centavos=round(f.valor_centavos::numeric*0.13)::bigint
   and f.profissional_centavos=f.valor_centavos-f.comissao_centavos) can_request
  from public.qf_comissao13_financeiro f
  join public.qf_comissao13_acordos a on a.id=f.acordo_id
  join public.qf_chamados c on c.id=a.chamado_id
  join public.qf_profiles p on p.id=a.profissional_id
  left join public.qf_livre_pix_chaves k on k.profissional_id=a.profissional_id
  left join public.qf_repasses_manuais m on m.financeiro_id=f.id
  where (v_admin or a.profissional_id=v_uid) and
    (f.status='pago' and f.pago_em is not null or m.id is not null)
 ) x;
 return v_result;
end;
$$;
revoke execute on function public.qf_repasses_manuais_painel() from public,anon;
grant execute on function public.qf_repasses_manuais_painel() to authenticated;

create or replace function public.qf_repasses_manuais_solicitar(p_financeiro_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_f public.qf_comissao13_financeiro; v_a public.qf_comissao13_acordos;
v_k public.qf_livre_pix_chaves; v_id uuid; v_comissao bigint;
begin
 if v_uid is null then return jsonb_build_object('ok',false,'reason','auth_required'); end if;
 select * into v_f from public.qf_comissao13_financeiro where id=p_financeiro_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','nao_encontrado'); end if;
 select * into v_a from public.qf_comissao13_acordos where id=v_f.acordo_id;
 if v_a.profissional_id is distinct from v_uid then return jsonb_build_object('ok',false,'reason','nao_autorizado'); end if;
 if exists(select 1 from public.qf_repasses_manuais where financeiro_id=v_f.id) then
   return jsonb_build_object('ok',true,'duplicado',true);
 end if;
 if v_f.status<>'pago' or v_f.pago_em is null or v_f.repasse_status in ('concluido','repassado','bloqueado')
 or v_f.estornado_centavos<>0 or v_a.concluido_em is null or v_a.telefone_verificado_em is null
 or v_a.status in ('contestado','cancelado') then
  return jsonb_build_object('ok',false,'reason','pagamento_nao_liberado');
 end if;
 if not exists(select 1 from public.qf_livre_assinaturas s
  where s.profissional_id=v_uid and v_a.contratado_em between s.inicio_em and s.fim_em) then
  return jsonb_build_object('ok',false,'reason','plano_livre_nao_comprovado');
 end if;
 v_comissao:=round(v_f.valor_centavos::numeric*0.13)::bigint;
 if v_f.comissao_centavos<>v_comissao or v_f.profissional_centavos<>v_f.valor_centavos-v_comissao
 or v_f.valor_centavos<=0 then
   return jsonb_build_object('ok',false,'reason','divisao_inconsistente');
 end if;
 select * into v_k from public.qf_livre_pix_chaves where profissional_id=v_uid;
 if not found or length(trim(v_k.chave_pix))<5 then
   return jsonb_build_object('ok',false,'reason','chave_pix_ausente');
 end if;
 insert into public.qf_repasses_manuais(financeiro_id,acordo_id,profissional_id,
 valor_bruto_centavos,comissao_centavos,profissional_centavos,pix_chave,pix_atualizado_em)
 values(v_f.id,v_a.id,v_uid,v_f.valor_centavos,v_comissao,v_f.profissional_centavos,
 v_k.chave_pix,v_k.atualizado_em) returning id into v_id;
 insert into public.qf_repasses_manuais_eventos(repasse_id,ator,tipo)
 values(v_id,v_uid,'solicitado');
 return jsonb_build_object('ok',true,'repasse_id',v_id);
end;
$$;
revoke execute on function public.qf_repasses_manuais_solicitar(uuid) from public,anon;
grant execute on function public.qf_repasses_manuais_solicitar(uuid) to authenticated;

create or replace function public.qf_repasses_manuais_admin(
 p_repasse_id uuid, p_acao text, p_referencia text default null, p_comprovante text default null, p_observacao text default null
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_r public.qf_repasses_manuais;
v_f public.qf_comissao13_financeiro; v_a public.qf_comissao13_acordos;
v_k public.qf_livre_pix_chaves;
begin
 if v_uid is null or not private.qf_is_admin() then
   return jsonb_build_object('ok',false,'reason','nao_autorizado');
 end if;
 if p_acao not in ('analisar','bloquear','confirmar') then
   return jsonb_build_object('ok',false,'reason','acao_invalida');
 end if;
 select * into v_r from public.qf_repasses_manuais where id=p_repasse_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','nao_encontrado'); end if;
 if v_r.status='pago' then return jsonb_build_object('ok',false,'reason','ja_pago'); end if;
 select * into v_f from public.qf_comissao13_financeiro where id=v_r.financeiro_id for update;
 select * into v_a from public.qf_comissao13_acordos where id=v_r.acordo_id;
 if p_acao='confirmar' then
  if v_r.status not in ('solicitado','em_analise') or v_f.status<>'pago' or v_f.pago_em is null
   or v_f.estornado_centavos<>0 or v_f.repasse_status in ('concluido','repassado','bloqueado')
   or v_a.status in ('cancelado','contestado') or v_a.concluido_em is null then
     return jsonb_build_object('ok',false,'reason','repasse_bloqueado');
  end if;
  select * into v_k from public.qf_livre_pix_chaves where profissional_id=v_r.profissional_id;
  if not found or v_k.chave_pix is distinct from v_r.pix_chave or v_k.status<>'validado' then
     return jsonb_build_object('ok',false,'reason','validar_chave_pix');
  end if;
  if coalesce(length(trim(p_referencia)),0)<8 or coalesce(length(trim(p_comprovante)),0)<8
   or length(trim(p_referencia))>150 or length(trim(p_comprovante))>500 then
    return jsonb_build_object('ok',false,'reason','exigir_referencia_e_comprovante');
  end if;
  update public.qf_repasses_manuais set status='pago',
    pago_em=now(),aprovado_por=v_uid,atualizado_em=now(),
    pix_end_to_end_id=trim(p_referencia),comprovante_ref=trim(p_comprovante),
    observacao=left(p_observacao,1500) where id=p_repasse_id;
 else
  if p_acao='bloquear' and coalesce(length(trim(p_observacao)),0)<8 then
    return jsonb_build_object('ok',false,'reason','motivo_obrigatorio');
  end if;
  update public.qf_repasses_manuais set status=case when p_acao='bloquear' then 'bloqueado' else 'em_analise' end,
    observacao=left(p_observacao,1500),atualizado_em=now(),aprovado_por=v_uid where id=p_repasse_id;
 end if;
 insert into public.qf_repasses_manuais_eventos(repasse_id,ator,tipo,detalhe) values
 (p_repasse_id,v_uid,p_acao,jsonb_build_object('referencia',case when p_acao='confirmar' then trim(p_referencia) else null end,'observacao',left(p_observacao,1500)));
 return jsonb_build_object('ok',true,'status',case when p_acao='confirmar' then 'pago' when p_acao='bloquear' then 'bloqueado' else 'em_analise' end);
end;
$$;
revoke execute on function public.qf_repasses_manuais_admin(uuid,text,text,text,text) from public,anon;
grant execute on function public.qf_repasses_manuais_admin(uuid,text,text,text,text) to authenticated;
