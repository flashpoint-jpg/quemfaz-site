-- QuemFaz 11.54 — nenhum plano pago se perde + avisos do admin religados.
-- (já aplicado no Supabase em 10/10/2026)
--
-- 1) Todo aviso para o admin sai pela função quemfaz-admin-aviso (a quemfaz-push não tratava
--    "admin_internal" e respondia 401: os avisos de cadastro novo, desbloqueio, orçamento,
--    status do pedido, suporte, recarga e prioridade paga não chegavam).
-- 2) Plano pago antes da conta: grava a hora da aprovação e avisa o admin quando a cobrança é
--    gerada e quando o pagamento cai.
-- 3) Rede de segurança: pagamento aprovado e conta criada com o MESMO e-mail (outro aparelho,
--    app reinstalado, navegador limpo) vira plano ativo sozinho, de minuto em minuto.
-- A conferência na Efí com o app fechado fica na função quemfaz-efi-pix-sync (v6).

create or replace function private.qf_admin_push_interno(p_evento text, p_id uuid)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_seg text;
  v_req bigint;
begin
  select decrypted_secret
    into v_seg
  from vault.decrypted_secrets
  where name = 'qf_push_internal'
  limit 1;

  select net.http_post(
    url := 'https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-admin-aviso',
    body := jsonb_build_object(
      'action','admin_internal',
      'event',p_evento,
      'entity_id',p_id
    ),
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-qf-internal',coalesce(v_seg,'')
    ),
    timeout_milliseconds := 8000
  ) into v_req;

  return v_req;
end;
$function$;

create or replace function private.qf_pre_cadastro_aprovado_em_trg()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if new.status = 'aprovado' and new.status is distinct from old.status and new.aprovado_em is null then
    new.aprovado_em := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists qf_pre_cadastro_aprovado_em on public.qf_pre_cadastro_pagamentos;
create trigger qf_pre_cadastro_aprovado_em
  before update of status on public.qf_pre_cadastro_pagamentos
  for each row execute function private.qf_pre_cadastro_aprovado_em_trg();

create or replace function private.qf_admin_push_pre_cadastro_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.status = 'aprovado' and new.status is distinct from old.status then
    perform private.qf_admin_push_interno('precadastro_approved', new.id);
  elsif old.provedor_id is null and new.provedor_id is not null and new.status = 'pendente' then
    perform private.qf_admin_push_interno('precadastro_started', new.id);
  end if;
  return new;
exception when others then
  raise warning 'QuemFaz admin push pre-cadastro: %', sqlerrm;
  return new;
end;
$function$;

drop trigger if exists qf_admin_push_pre_cadastro_after_update on public.qf_pre_cadastro_pagamentos;
create trigger qf_admin_push_pre_cadastro_after_update
  after update of status, provedor_id on public.qf_pre_cadastro_pagamentos
  for each row execute function private.qf_admin_push_pre_cadastro_trg();

-- Pagou, mas o app não resgatou (id + segredo ficaram em outro aparelho): se já existe conta de
-- profissional com o mesmo e-mail, o plano entra nela. Espera 2 minutos para o app resgatar primeiro.
create or replace function private.qf_pre_cadastro_resgatar_pendentes()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
     order by criado_em
     for update skip locked
  loop
    select u.id into v_uid
      from auth.users u
      join public.qf_profissionais p on p.user_id = u.id
     where lower(u.email) = lower(trim(r.email))
     order by u.created_at
     limit 1;
    continue when v_uid is null;

    insert into public.qf_recargas(profissional_id, valor_centavos, metodo, status, provedor, provedor_id, plano)
    values (v_uid, r.valor_centavos, r.metodo, 'pendente', r.provedor, r.provedor_id, r.plano)
    returning id into v_rec;
    update public.qf_recargas set status = 'aprovado' where id = v_rec;

    update public.qf_pre_cadastro_pagamentos
       set profissional_id = v_uid, recarga_id = v_rec, resgatado_em = now()
     where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;
revoke all on function private.qf_pre_cadastro_resgatar_pendentes() from public, anon, authenticated;

select cron.unschedule('qf-pre-cadastro-resgatar') where exists (select 1 from cron.job where jobname = 'qf-pre-cadastro-resgatar');
select cron.schedule('qf-pre-cadastro-resgatar', '* * * * *', 'select private.qf_pre_cadastro_resgatar_pendentes();');

-- A função de avisos do admin (service role) precisa ler o orçamento e a mensagem de suporte para montar o aviso.
grant select on public.qf_orcamentos to service_role;
grant select on public.qf_suporte_mensagens to service_role;
