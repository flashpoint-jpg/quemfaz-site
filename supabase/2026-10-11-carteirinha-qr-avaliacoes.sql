-- Carteirinha Quem Faz: feedback público pelo QR (não confundir com avaliações de serviços confirmados).
-- As notas aqui NÃO alteram qf_avaliacoes nem a média verificada do profissional.
create table if not exists public.qf_carteirinha_avaliacoes (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references public.qf_profissionais(user_id) on delete cascade,
  visitante_token uuid not null,
  nota smallint not null check (nota between 1 and 5),
  comentario text,
  criado_em timestamptz not null default now()
);
create index if not exists qf_carteirinha_avaliacoes_profissional_data_idx
  on public.qf_carteirinha_avaliacoes (profissional_id, criado_em desc);
create index if not exists qf_carteirinha_avaliacoes_visitante_idx
  on public.qf_carteirinha_avaliacoes (profissional_id, visitante_token, criado_em desc);
alter table public.qf_carteirinha_avaliacoes enable row level security;
revoke all on public.qf_carteirinha_avaliacoes from public, anon, authenticated;

create or replace function public.qf_carteirinha_resumo(p_profissional_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_nome text; v_foto text; v_total integer;
begin
  select p.nome, p.foto_url into v_nome, v_foto
    from public.qf_profiles p
    join public.qf_profissionais pr on pr.user_id = p.id
   where p.id = p_profissional_id and p.tipo = 'profissional' and p.ativo is true;
  if not found then return jsonb_build_object('ok', false, 'reason', 'profissional_indisponivel'); end if;
  select count(*) into v_total from public.qf_carteirinha_avaliacoes a
    where a.profissional_id = p_profissional_id;
  return jsonb_build_object(
    'ok', true, 'nome', v_nome, 'foto_url', v_foto,
    'cadastro', 'QF-' || upper(left(replace(p_profissional_id::text, '-', ''), 8)),
    'total_avaliacoes_qr', v_total
  );
end;
$$;
revoke all on function public.qf_carteirinha_resumo(uuid) from public, anon, authenticated;
grant execute on function public.qf_carteirinha_resumo(uuid) to anon, authenticated;

create or replace function public.qf_carteirinha_registrar(
  p_profissional_id uuid, p_nota integer, p_comentario text, p_visitante_token uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_ativo boolean; v_quantidade integer;
begin
  if p_profissional_id is null or p_visitante_token is null or p_nota is null or p_nota not between 1 and 5 then
    return jsonb_build_object('ok', false, 'reason', 'dados_invalidos');
  end if;
  if auth.uid() = p_profissional_id then
    return jsonb_build_object('ok', false, 'reason', 'proprio_profissional');
  end if;
  select true into v_ativo from public.qf_profiles p
    join public.qf_profissionais pr on pr.user_id = p.id
   where p.id = p_profissional_id and p.tipo = 'profissional' and p.ativo is true;
  if coalesce(v_ativo, false) is false then
    return jsonb_build_object('ok', false, 'reason', 'profissional_indisponivel');
  end if;
  -- Evita requisições simultâneas do mesmo dispositivo para o mesmo profissional.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_profissional_id::text || ':' || p_visitante_token::text, 0)
  );
  if exists (
    select 1 from public.qf_carteirinha_avaliacoes a
     where a.profissional_id = p_profissional_id
       and a.visitante_token = p_visitante_token
       and a.criado_em > now() - interval '48 hours'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'ja_avaliado');
  end if;
  select count(*) into v_quantidade from public.qf_carteirinha_avaliacoes a
    where a.profissional_id = p_profissional_id
      and a.criado_em > now() - interval '1 hour';
  if v_quantidade >= 30 then return jsonb_build_object('ok', false, 'reason', 'limite_temporario'); end if;
  insert into public.qf_carteirinha_avaliacoes(profissional_id, visitante_token, nota, comentario)
  values (
    p_profissional_id, p_visitante_token, p_nota,
    nullif(left(btrim(coalesce(p_comentario, '')), 350), '')
  );
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.qf_carteirinha_registrar(uuid,integer,text,uuid) from public, anon, authenticated;
grant execute on function public.qf_carteirinha_registrar(uuid,integer,text,uuid) to anon, authenticated;

-- Sem política pública de SELECT/INSERT na tabela. Apenas as RPCs restritas são acessíveis.
