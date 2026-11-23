-- O cadastro registra a adesão ao Plantão 24h junto da criação do profissional.
create table private.qf_inscricoes_plantao_24h (
  profissional_id uuid primary key references public.qf_profissionais(user_id) on delete cascade,
  cadastrado_em timestamptz not null default now()
);

alter table private.qf_inscricoes_plantao_24h enable row level security;
revoke all on table private.qf_inscricoes_plantao_24h from public, anon, authenticated;

create function private.qf_registrar_adesao_plantao_24h()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.qf_inscricoes_plantao_24h(profissional_id)
  select new.user_id
    from auth.users u
    join public.qf_profiles p on p.id = u.id and p.tipo = 'profissional'
   where u.id = new.user_id
     and u.raw_user_meta_data -> 'qf_inscricao_plantao_24h' = 'true'::jsonb
  on conflict (profissional_id) do nothing;
  return new;
end;
$$;

revoke all on function private.qf_registrar_adesao_plantao_24h() from public, anon, authenticated;

create trigger qf_registrar_adesao_plantao_24h
after insert on public.qf_profissionais
for each row execute function private.qf_registrar_adesao_plantao_24h();
