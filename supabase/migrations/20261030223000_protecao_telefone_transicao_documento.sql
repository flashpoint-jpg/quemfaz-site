-- Implantação gradual sem interromper cadastros já abertos no navegador.
-- Até atualizar o frontend, conferir telefone. Após novo frontend READY, exigir documento.
create table if not exists private.qf_pre_cadastro_politica(
 unico boolean primary key default true check (unico=true),
 exigir_documento boolean not null default false,
 atualizado_em timestamptz not null default now()
);
insert into private.qf_pre_cadastro_politica(unico,exigir_documento) values(true,false)
on conflict(unico) do nothing;
revoke all on private.qf_pre_cadastro_politica from public,anon,authenticated;
alter table private.qf_pre_cadastro_politica enable row level security;

create or replace function public.qf_pre_cadastro_politica_atual()
returns jsonb language sql stable security definer set search_path to ''
as $fn$ select jsonb_build_object('exigir_documento',exigir_documento)
from private.qf_pre_cadastro_politica where unico=true $fn$;
revoke all on function public.qf_pre_cadastro_politica_atual()
from public,anon,authenticated;
grant execute on function public.qf_pre_cadastro_politica_atual() to service_role;

create or replace function public.qf_pre_cadastro_telefone_elegivel(p_telefone text)
returns jsonb language plpgsql stable security definer set search_path to ''
as $fn$
declare v_tel text := regexp_replace(coalesce(p_telefone,''),'[^0-9]','','g');
begin
 if left(v_tel,2)='55' and length(v_tel) in(12,13)
 then v_tel:=substr(v_tel,3); end if;
 if length(v_tel) not in(10,11)
 then return jsonb_build_object('ok',false,'error','telefone_invalido'); end if;
 if exists(select 1 from public.qf_profiles p
  where p.tipo='profissional' and
  (case when length(regexp_replace(coalesce(p.telefone,''),'[^0-9]','','g')) in(12,13)
     and left(regexp_replace(coalesce(p.telefone,''),'[^0-9]','','g'),2)='55'
  then substr(regexp_replace(coalesce(p.telefone,''),'[^0-9]','','g'),3)
  else regexp_replace(coalesce(p.telefone,''),'[^0-9]','','g') end)=v_tel)
 then return jsonb_build_object('ok',false,'error','telefone_ja_cadastrado'); end if;
 if exists(select 1 from public.qf_pre_cadastro_pagamentos p
  where p.status in('pendente','aprovado') and
  (case when length(regexp_replace(coalesce(p.telefone,''),'[^0-9]','','g')) in(12,13)
     and left(regexp_replace(coalesce(p.telefone,''),'[^0-9]','','g'),2)='55'
  then substr(regexp_replace(coalesce(p.telefone,''),'[^0-9]','','g'),3)
  else regexp_replace(coalesce(p.telefone,''),'[^0-9]','','g') end)=v_tel)
 then return jsonb_build_object('ok',false,'error','telefone_cobranca_existente'); end if;
 return jsonb_build_object('ok',true);
end $fn$;
revoke all on function public.qf_pre_cadastro_telefone_elegivel(text)
from public,anon,authenticated;
grant execute on function public.qf_pre_cadastro_telefone_elegivel(text)
to service_role;

-- O índice garante atomicamente um celular por pré-cadastro aberto
-- mesmo quando duas solicitações chegam simultaneamente.
create unique index if not exists qf_pre_cadastro_um_telefone_global
on public.qf_pre_cadastro_pagamentos
((case when left(regexp_replace(coalesce(telefone,''),'[^0-9]','','g'),2)='55'
      and length(regexp_replace(coalesce(telefone,''),'[^0-9]','','g')) in(12,13)
 then substr(regexp_replace(coalesce(telefone,''),'[^0-9]','','g'),3)
 else regexp_replace(coalesce(telefone,''),'[^0-9]','','g') end))
where telefone is not null and status in('pendente','aprovado');
