-- QuemFaz 11.11.0 — Preferências de chamado do profissional.
-- 1) Horário para receber chamado estando OFFLINE (padrão 06:00 às 22:00, horário de Brasília).
--    Fora do horário, quem está offline não é avisado na etapa 2. Quem está online recebe sempre.
-- 2) Modo do alerta: 'toque' (toque + vibração, padrão) ou 'vibrar' (só vibração).
--    O servidor manda essa escolha junto com o aviso; o app Android aplica.

alter table public.qf_profissionais
  add column if not exists horario_inicio time not null default '06:00',
  add column if not exists horario_fim time not null default '22:00',
  add column if not exists alerta_modo text not null default 'toque';
alter table public.qf_profissionais drop constraint if exists qf_profissionais_alerta_modo_check;
alter table public.qf_profissionais add constraint qf_profissionais_alerta_modo_check check (alerta_modo in ('toque','vibrar'));

-- Dentro do horário? Aceita faixa que passa da meia-noite (ex.: 18:00 às 02:00).
-- Início igual ao fim = o dia todo.
create or replace function private.qf_dentro_horario(p_inicio time, p_fim time)
returns boolean language sql stable set search_path to '' as $$
  select case
    when p_inicio is null or p_fim is null or p_inicio = p_fim then true
    when p_inicio < p_fim then (now() at time zone 'America/Sao_Paulo')::time >= p_inicio
                           and (now() at time zone 'America/Sao_Paulo')::time <  p_fim
    else (now() at time zone 'America/Sao_Paulo')::time >= p_inicio
      or (now() at time zone 'America/Sao_Paulo')::time <  p_fim
  end;
$$;

create or replace function public.qf_cascata_destinatarios(p_chamado_id uuid)
returns table(user_id uuid, online boolean) language sql stable security definer set search_path to '' as $function$
  select pr.user_id, pr.online
  from public.qf_chamados c
  join public.qf_profissionais pr on true
  join public.qf_profiles pf on pf.id = pr.user_id
  where c.id = p_chamado_id
    and c.status = 'aberto'
    and coalesce(pf.ativo, true)
    and pr.user_id <> c.cliente_id
    and (cardinality(pr.especialidades) = 0 or c.categoria = any(pr.especialidades))
    and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = pr.user_id)
    and private.qf_pro_atende_regiao(pr.user_id, c.cidade, c.uf::text, c.latitude, c.longitude)
    and (pr.online or private.qf_dentro_horario(pr.horario_inicio, pr.horario_fim));
$function$;

-- Profissional salva as próprias preferências.
create or replace function public.qf_salvar_preferencias_chamado(p_inicio time, p_fim time, p_alerta text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if p_alerta not in ('toque','vibrar') then raise exception 'invalid alert mode'; end if;
  update public.qf_profissionais
     set horario_inicio = coalesce(p_inicio, '06:00'),
         horario_fim = coalesce(p_fim, '22:00'),
         alerta_modo = p_alerta
   where user_id = v_uid;
  if not found then raise exception 'professional profile required'; end if;
  return jsonb_build_object('ok', true, 'horario_inicio', to_char(coalesce(p_inicio,'06:00'),'HH24:MI'),
                            'horario_fim', to_char(coalesce(p_fim,'22:00'),'HH24:MI'), 'alerta_modo', p_alerta);
end $$;
revoke all on function public.qf_salvar_preferencias_chamado(time, time, text) from public, anon;
grant execute on function public.qf_salvar_preferencias_chamado(time, time, text) to authenticated;
