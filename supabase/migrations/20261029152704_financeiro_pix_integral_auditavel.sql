-- Amplia o fluxo existente, sem habilitar cobranças ou alterar transações históricas.
alter table private.qf_livre_manual_config add column if not exists operacao_aprovada boolean not null default false,
 add column if not exists operacao_referencia text,
 add column if not exists efi_ultima_tentativa timestamptz,
 add column if not exists efi_ultimo_resultado text;
create table private.qf_livre_manual_eventos(
 id bigint generated always as identity primary key,
 pagamento_id uuid not null references private.qf_livre_manual_pix(id),
 ator uuid,
 tipo text not null,
 detalhe jsonb not null,
 criado_em timestamptz not null default now()
);
alter table private.qf_livre_manual_eventos enable row level security;
revoke all on private.qf_livre_manual_eventos from public,anon,authenticated;
create function private.qf_livre_manual_auditar() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.qf_livre_manual_eventos(pagamento_id,ator,tipo,detalhe)
 values(new.id,auth.uid(),case when tg_op='INSERT' then 'emitido' else new.status end,
 jsonb_build_object('estado_anterior',case when tg_op='UPDATE' then old.status else null end,
 'estado_atual',new.status,'txid',new.txid,'end_to_end_id',new.end_to_end_id,
 'referencia',new.repasse_referencia,'comprovante',new.repasse_comprovante));
 return new;
end $$;
revoke all on function private.qf_livre_manual_auditar() from public,anon,authenticated;
create trigger qf_livre_manual_auditar after insert or update on private.qf_livre_manual_pix
 for each row execute function private.qf_livre_manual_auditar();
create function public.qf_livre_manual_pix_admin_ledger() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin_obrigatorio';end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.criado_em desc),'[]') from (
 select v.id,v.fechamento_id,v.chamado_id,v.profissional_id,p.nome profissional,v.txid,v.end_to_end_id,
 v.valor_centavos,v.comissao_centavos,v.profissional_centavos,v.status,v.criado_em,v.confirmado_em,
 v.repassado_em,v.repasse_referencia,v.repasse_comprovante,v.repasse_admin,k.chave_pix pix_chave,
 coalesce((select jsonb_agg(jsonb_build_object('tipo',e.tipo,'ator',e.ator,'criado_em',e.criado_em)
 order by e.criado_em) from private.qf_livre_manual_eventos e where e.pagamento_id=v.id),'[]') eventos
 from private.qf_livre_manual_pix v join public.qf_profiles p on p.id=v.profissional_id
 left join public.qf_livre_pix_chaves k on k.profissional_id=v.profissional_id) x);
end $$;
revoke all on function public.qf_livre_manual_pix_admin_ledger() from public,anon;
grant execute on function public.qf_livre_manual_pix_admin_ledger() to authenticated;
-- Intercepta a ativação existente. Autenticação bancária não equivale à aprovação operacional.
alter function public.qf_livre_manual_admin_config(boolean,uuid,boolean,text) rename to qf_livre_manual_admin_config_base;
revoke all on function public.qf_livre_manual_admin_config_base(boolean,uuid,boolean,text) from public,anon,authenticated;
create function public.qf_livre_manual_admin_config(p_ativar boolean default null,p_admin uuid default null,
 p_efi_testado boolean default false,p_ambiente text default null) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare c private.qf_livre_manual_config; result jsonb;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'') is distinct from 'service_role'
 and coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role'
 then return jsonb_build_object('ok',false,'reason','service_role_obrigatorio');end if;
 select * into c from private.qf_livre_manual_config where id;
 if p_ativar is true and not c.operacao_aprovada then return jsonb_build_object('ok',false,'reason','operacao_em_analise');end if;
 result:=public.qf_livre_manual_admin_config_base(p_ativar,p_admin,p_efi_testado,p_ambiente);
 return result||jsonb_build_object('operacao_aprovada',c.operacao_aprovada,
 'operacao_referencia',c.operacao_referencia,'efi_ultima_tentativa',c.efi_ultima_tentativa,
 'efi_ultimo_resultado',c.efi_ultimo_resultado,
 'bloqueio',case when not c.operacao_aprovada then 'Aguardando confirmação específica da Efí e revisão fiscal/KYC para receber serviços de terceiros e repassar manualmente.' else null end);
end $$;
revoke all on function public.qf_livre_manual_admin_config(boolean,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.qf_livre_manual_admin_config(boolean,uuid,boolean,text) to service_role;
create function public.qf_livre_manual_validacao(p_admin uuid,p_ok boolean,p_ambiente text) returns jsonb
 language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'') is distinct from 'service_role'
 and coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role'
 then raise exception 'service_role_obrigatorio';end if;
 if not exists(select 1 from public.qf_admins where user_id=p_admin) then raise exception 'admin_obrigatorio';end if;
 update private.qf_livre_manual_config set efi_ultima_tentativa=now(),
 efi_ultimo_resultado=case when p_ok then 'Autenticação mTLS confirmada · '||p_ambiente else 'Autenticação Efí não confirmada · '||p_ambiente end,
 efi_verificado_em=case when p_ok and p_ambiente='production' then now() else efi_verificado_em end,
 ambiente_efi=case when p_ok then p_ambiente else ambiente_efi end where id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.qf_livre_manual_validacao(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.qf_livre_manual_validacao(uuid,boolean,text) to service_role;
