-- V11.66: pedido que entra num serviço sem nenhum profissional cadastrado avisa o administrador na hora.
-- Recado direto para os administradores (usa o "user_notice" da função quemfaz-admin-aviso).
create or replace function private.qf_admin_recado(p_titulo text, p_texto text, p_url text, p_tag text)
returns bigint language plpgsql security definer set search_path to '' as $$
declare v_seg text; v_ids jsonb; v_req bigint;
begin
  select coalesce(jsonb_agg(a.user_id), '[]'::jsonb) into v_ids from public.qf_admins a;
  if jsonb_array_length(v_ids) = 0 then return null; end if;
  select decrypted_secret into v_seg from vault.decrypted_secrets where name = 'qf_push_internal' limit 1;
  select net.http_post(
    url := 'https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-admin-aviso',
    body := jsonb_build_object('action','user_notice','user_ids',v_ids,'title',left(p_titulo,120),'body',left(p_texto,400),'url',p_url,'tag',p_tag),
    headers := jsonb_build_object('Content-Type','application/json','x-qf-internal',coalesce(v_seg,'')),
    timeout_milliseconds := 8000
  ) into v_req;
  return v_req;
end;
$$;
revoke all on function private.qf_admin_recado(text, text, text, text) from public, anon, authenticated;

create or replace function private.qf_chamado_sem_profissional_avisar()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.status = 'aberto' and not exists (
    select 1 from public.qf_profissionais pr join public.qf_profiles pf on pf.id = pr.user_id
    where coalesce(pf.ativo, true) and pr.user_id <> new.cliente_id and new.categoria = any(pr.especialidades)
  ) then
    perform private.qf_admin_recado(
      '⚠️ Pedido sem profissional: ' || coalesce(nullif(trim(new.titulo), ''), 'Serviço'),
      concat_ws(' · ', nullif(trim(new.bairro), ''), nullif(concat_ws('/', new.cidade, new.uf), '')) ||
        ' — ninguém cadastrado nesse serviço, então ninguém foi avisado. Abra o painel e decida para quem mandar.',
      '/admin.html#/admin/servicos/' || new.id::text,
      'qf-sem-prof-' || new.id::text);
  end if;
  return new;
exception when others then
  raise warning 'QuemFaz aviso pedido sem profissional: %', sqlerrm;
  return new;
end;
$$;
drop trigger if exists qf_chamado_sem_profissional_after_insert on public.qf_chamados;
create trigger qf_chamado_sem_profissional_after_insert
  after insert on public.qf_chamados
  for each row execute function private.qf_chamado_sem_profissional_avisar();
