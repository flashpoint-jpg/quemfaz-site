-- Preparação em rascunho: NÃO aplicar em produção antes da homologação.
-- Uma origem de cadastro: Carteira publicada pela PR 148.
create or replace function private.qf_livre_pix_sincronizar_chave()
returns trigger language plpgsql security definer set search_path='' as $$
declare doc text;
begin
 if tg_op='UPDATE' and old.chave_pix is not distinct from new.chave_pix then return new;end if;
 select regexp_replace(documento,'[^0-9]','','g') into doc from public.qf_profissionais where user_id=new.profissional_id;
 if length(coalesce(doc,'')) not in(11,14) then
  update private.qf_livre_pix_recebedores set status='pendente',validado_em=null,validado_por=null,evidencia=null where profissional_id=new.profissional_id;
  return new;
 end if;
 insert into private.qf_livre_pix_recebedores(profissional_id,chave_pix,documento,status)
 values(new.profissional_id,new.chave_pix,doc,'pendente') on conflict(profissional_id) do update
 set chave_pix=excluded.chave_pix,documento=excluded.documento,status='pendente',validado_em=null,validado_por=null,evidencia=null,atualizado_em=now();
 return new;
end $$;
revoke all on function private.qf_livre_pix_sincronizar_chave() from public,anon,authenticated;
create trigger qf_livre_pix_sincronizar_chave after insert or update of chave_pix
on public.qf_livre_pix_chaves for each row execute function private.qf_livre_pix_sincronizar_chave();
insert into private.qf_livre_pix_recebedores(profissional_id,chave_pix,documento,status)
select k.profissional_id,k.chave_pix,regexp_replace(p.documento,'[^0-9]','','g'),'pendente'
from public.qf_livre_pix_chaves k join public.qf_profissionais p on p.user_id=k.profissional_id
where length(regexp_replace(p.documento,'[^0-9]','','g')) in (11,14) on conflict(profissional_id) do nothing;

-- Reserva global persistente: uma transferência em andamento até resolução bancária.
create or replace function public.qf_livre_pix_reservar_envio(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.qf_livre_pix_pagamentos;
begin
 perform pg_advisory_xact_lock(hashtextextended('qf_livre_pix_envio_global',0));
 if not exists(select 1 from private.qf_livre_pix_config where id and habilitado and homologado
 and pix_send_aprovado and webhook_verificado and limites_verificados and tarifas_verificadas)
 then return jsonb_build_object('ok',false,'reason','desabilitado');end if;
 select * into b from private.qf_livre_pix_pagamentos where id=p_id for update;
 if not found or b.entrada_e2eid is null or b.pago_em is null or b.status not in ('pago','envio_solicitado')
 then return jsonb_build_object('ok',false,'reason','entrada_nao_conciliada');end if;
 if exists(select 1 from private.qf_livre_pix_pagamentos where status='envio_solicitado' and id<>b.id)
 then return jsonb_build_object('ok',false,'reason','outro_envio_em_andamento');end if;
 update private.qf_livre_pix_pagamentos set status='envio_solicitado',atualizado_em=now() where id=b.id;
 return jsonb_build_object('ok',true,'id_envio',b.id_envio);
end $$;
revoke all on function public.qf_livre_pix_reservar_envio(uuid) from public,anon,authenticated;
grant execute on function public.qf_livre_pix_reservar_envio(uuid) to service_role;
