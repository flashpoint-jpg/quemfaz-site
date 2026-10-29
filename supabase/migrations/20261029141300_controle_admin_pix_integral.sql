-- Controle administrativo para o Pix integral do Quem Faz Livre.
-- Somente a Edge Function autenticada como service_role escreve configurações.
alter table private.qf_livre_manual_config
  add column if not exists efi_verificado_em timestamptz,
  add column if not exists ultima_acao_admin uuid,
  add column if not exists ambiente_efi text;

create table if not exists private.qf_livre_manual_config_auditoria(
 id bigint generated always as identity primary key,
 admin_id uuid not null references auth.users(id),
 habilitado boolean not null,
 verificado_efi boolean not null,
 criado_em timestamptz not null default now()
);
alter table private.qf_livre_manual_config_auditoria enable row level security;
revoke all on private.qf_livre_manual_config_auditoria from public,anon,authenticated;

create or replace function public.qf_livre_manual_admin_config(
 p_ativar boolean default null,
 p_admin uuid default null,
 p_efi_testado boolean default false,
 p_ambiente text default null
) returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare c private.qf_livre_manual_config; n integer;
begin
 if current_setting('request.jwt.claim.role',true) <> 'service_role' then
   return jsonb_build_object('ok',false,'reason','service_role_obrigatorio');
 end if;
 if p_ativar is not null then
   if p_admin is null or not exists(select 1 from public.qf_admins where user_id=p_admin)
   then return jsonb_build_object('ok',false,'reason','admin_invalido');end if;
   if p_ativar and not p_efi_testado
   then return jsonb_build_object('ok',false,'reason','efí_nao_verificada');end if;
   if p_ativar and p_ambiente <> 'production'
   then return jsonb_build_object('ok',false,'reason','ambiente_de_producao_obrigatorio');end if;
   update private.qf_livre_manual_config
    set habilitado=p_ativar,
        ativado_em=case when p_ativar and not habilitado then now()
                        when p_ativar then ativado_em else ativado_em end,
        efi_verificado_em=case when p_ativar then now() else efi_verificado_em end,
        ambiente_efi=case when p_ativar then p_ambiente else ambiente_efi end,
        atualizado_em=now(),
        ultima_acao_admin=p_admin,
        observacao=case when p_ativar then 'Recebimento Pix integral ativo; repasse de 87% manual'
                        else 'Emissão de novas cobranças pausada pelo administrador' end
    where id=true;
   insert into private.qf_livre_manual_config_auditoria(admin_id,habilitado,verificado_efi)
    values(p_admin,p_ativar,p_efi_testado);
 end if;
 select * into c from private.qf_livre_manual_config where id=true;
 select count(*) into n from private.qf_livre_manual_pix where status='pago';
 return jsonb_build_object('ok',true,'habilitado',coalesce(c.habilitado,false),
    'ativado_em',c.ativado_em,'efi_verificado_em',c.efi_verificado_em,
    'ambiente_efi',c.ambiente_efi,'observacao',c.observacao,
    'pagamentos_aguardando_repasse',n);
end $$;
revoke all on function public.qf_livre_manual_admin_config(boolean,uuid,boolean,text)
  from public,anon,authenticated;
grant execute on function public.qf_livre_manual_admin_config(boolean,uuid,boolean,text)
  to service_role;
