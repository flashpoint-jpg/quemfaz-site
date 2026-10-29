
-- Validação HUMANA da chave Pix para permitir registrar um repasse manual.
create table if not exists public.qf_pix_validacoes_admin(
 id uuid primary key default gen_random_uuid(),
 profissional_id uuid not null,
 ator uuid not null,
 chave_atualizada_em timestamptz,
 aprovou boolean not null,
 evidencia text not null,
 criado_em timestamptz not null default now()
);
alter table public.qf_pix_validacoes_admin enable row level security;
revoke all on public.qf_pix_validacoes_admin from anon,authenticated;

create or replace function public.qf_repasses_validar_chave_admin(
 p_profissional_id uuid, p_aprovar boolean, p_evidencia text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_k public.qf_livre_pix_chaves;
begin
 if v_uid is null or not private.qf_is_admin() then
   return jsonb_build_object('ok',false,'reason','nao_autorizado');
 end if;
 if p_profissional_id is null or p_aprovar is null or coalesce(length(trim(p_evidencia)),0)<20 or length(trim(p_evidencia))>1500 then
   return jsonb_build_object('ok',false,'reason','evidencia_obrigatoria');
 end if;
 select * into v_k from public.qf_livre_pix_chaves where profissional_id=p_profissional_id for update;
 if not found or length(trim(v_k.chave_pix))<5 then return jsonb_build_object('ok',false,'reason','chave_ausente'); end if;
 update public.qf_livre_pix_chaves set status=case when p_aprovar then 'validado' else 'rejeitado' end
 where profissional_id=p_profissional_id;
 insert into public.qf_pix_validacoes_admin(profissional_id,ator,chave_atualizada_em,aprovou,evidencia)
 values(p_profissional_id,v_uid,v_k.atualizado_em,p_aprovar,trim(p_evidencia));
 return jsonb_build_object('ok',true,'status',case when p_aprovar then 'validado' else 'rejeitado' end);
end;
$$;
revoke execute on function public.qf_repasses_validar_chave_admin(uuid,boolean,text) from public,anon;
grant execute on function public.qf_repasses_validar_chave_admin(uuid,boolean,text) to authenticated;
