-- Hotfix de produção: pré-cadastro avulso R$13 vira saldo (não plano).
-- Pagamento aprovado Efí, vínculo de titularidade, crédito/benefício atômico, idempotência por pagamento.
create or replace function private.qf_pre_cadastro_resgatar_pendentes()
returns integer language plpgsql security definer set search_path to '' as $function$
declare
 r public.qf_pre_cadastro_pagamentos;
 v_uid uuid;
 v_rec uuid;
 v_n integer := 0;
begin
 for r in
  select * from public.qf_pre_cadastro_pagamentos
  where status = 'aprovado' and profissional_id is null
  and coalesce(aprovado_em, criado_em) < now() - interval '2 minutes'
  order by criado_em for update skip locked
 loop
  if r.provedor is distinct from 'efi' or nullif(r.provedor_id,'') is null then continue; end if;
  select u.id into v_uid from auth.users u
   join public.qf_profissionais p on p.user_id=u.id
   where lower(u.email)=lower(trim(r.email))
   order by u.created_at limit 1;
  continue when v_uid is null;
  if r.plano in ('avulso','basico_v2','pro_v2','completo_v2') and not exists(
   select 1 from private.qf_cadastro_pagamento_vinculo v
   where v.user_id=v_uid and v.pagamento_id=r.id
  ) then continue; end if;
  if r.plano='avulso' and (r.valor_centavos<>1300 or r.metodo<>'pix') then continue; end if;
  if r.plano='basico_v2' and (r.valor_centavos<>3990 or r.metodo<>'pix') then continue; end if;
  if r.plano='pro_v2' and (r.valor_centavos<>7990 or r.metodo<>'pix') then continue; end if;
  if r.plano='completo_v2' and (r.valor_centavos<>14990 or r.metodo<>'pix') then continue; end if;

  insert into public.qf_recargas(profissional_id,valor_centavos,metodo,status,provedor,provedor_id,plano)
  values (v_uid,r.valor_centavos,r.metodo,'pendente',r.provedor,r.provedor_id,
    case when r.plano='avulso' then null else r.plano end)
  returning id into v_rec;
  update public.qf_recargas set status='aprovado' where id=v_rec;
  if r.plano='avulso' and not exists(
   select 1 from public.qf_movimentacoes_carteira m
   where m.profissional_id=v_uid and m.referencia_tipo='recarga'
    and m.referencia_id=v_rec and m.tipo='credito' and m.valor_centavos=1300
  ) then raise exception 'Falha ao creditar Pix avulso de R$13'; end if;
  if r.plano in ('basico_v2','pro_v2','completo_v2') and not exists(
   select 1 from public.qf_planos_profissional pp
   where pp.profissional_id=v_uid and pp.recarga_id=v_rec and pp.valido_ate>now()
  ) then raise exception 'Falha ao ativar plano mensal pago'; end if;

  update public.qf_pre_cadastro_pagamentos
  set profissional_id=v_uid,recarga_id=v_rec,resgatado_em=now() where id=r.id;
  v_n:=v_n+1;
 end loop;
 return v_n;
end;
$function$;
