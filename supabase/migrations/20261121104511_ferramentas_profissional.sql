create schema qf_tools_private;
revoke all on schema qf_tools_private from public;
grant usage on schema qf_tools_private to authenticated, anon;

create function qf_tools_private.is_professional(owner_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select owner_id = (select auth.uid()) and exists (
    select 1 from public.qf_profiles where id = owner_id and tipo = 'profissional' and ativo is not false
  );
$$;
revoke all on function qf_tools_private.is_professional(uuid) from public;
grant execute on function qf_tools_private.is_professional(uuid) to authenticated;

create table public.qf_tools_agenda (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dia date not null,
  horario time not null,
  cliente text not null check (length(btrim(cliente)) between 1 and 100),
  servico text not null check (length(btrim(servico)) between 1 and 140),
  endereco text not null check (length(btrim(endereco)) between 1 and 250),
  telefone text not null check (telefone ~ '^55[1-9][0-9](9[0-9]{8}|[2-5][0-9]{7})$'),
  status text not null check (status in ('a_confirmar','confirmado','concluido','cancelado'))
);
create index on public.qf_tools_agenda (owner_id, dia, horario);

create function qf_tools_private.items_total(items jsonb) returns integer
language plpgsql immutable strict set search_path = '' as $$
declare item jsonb; total integer := 0; value integer;
begin
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) not between 1 and 30 then
    raise exception 'Informe de 1 a 30 itens.';
  end if;
  for item in select jsonb_array_elements(items) loop
    if jsonb_typeof(item) <> 'object' or not (item ? 'descricao' and item ? 'centavos')
      or item - 'descricao' - 'centavos' <> '{}'::jsonb
      or jsonb_typeof(item->'descricao') <> 'string'
      or length(btrim(item->>'descricao')) not between 1 and 160
      or jsonb_typeof(item->'centavos') <> 'number'
      or (item->>'centavos') !~ '^[0-9]{1,8}$' then
      raise exception 'Confira a descrição e o valor de cada item.';
    end if;
    value := (item->>'centavos')::integer;
    if value > 10000000 then raise exception 'Valor por item acima do limite.'; end if;
    total := total + value;
  end loop;
  return total;
end;
$$;
revoke all on function qf_tools_private.items_total(jsonb) from public;
grant execute on function qf_tools_private.items_total(jsonb) to authenticated;

create table public.qf_tools_quotes (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  numero integer not null check (numero > 0),
  token uuid not null unique default gen_random_uuid(),
  profissional text not null check (length(btrim(profissional)) between 1 and 100),
  cliente text not null check (length(btrim(cliente)) between 1 and 100),
  telefone text not null check (telefone ~ '^55[1-9][0-9](9[0-9]{8}|[2-5][0-9]{7})$'),
  itens jsonb not null,
  material text not null check (length(material) <= 250),
  validade date not null,
  prazo text not null check (length(btrim(prazo)) between 1 and 100),
  total integer generated always as (qf_tools_private.items_total(itens)) stored check (total between 1 and 10000000),
  criado_em timestamptz not null default now(),
  unique (owner_id, numero)
);
create index on public.qf_tools_quotes (owner_id, criado_em desc);

create table public.qf_tools_pix_details (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  titular text not null check (length(btrim(titular)) between 1 and 100),
  cidade text not null check (length(btrim(cidade)) between 1 and 100)
);

create table public.qf_tools_charges (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cliente text not null check (length(btrim(cliente)) between 1 and 100),
  telefone text not null check (telefone ~ '^55[1-9][0-9](9[0-9]{8}|[2-5][0-9]{7})$'),
  descricao text not null check (length(btrim(descricao)) between 1 and 160),
  valor integer not null check (valor between 1 and 10000000),
  titular text not null check (length(btrim(titular)) between 1 and 100),
  cidade text not null check (length(btrim(cidade)) between 1 and 100),
  chave_versao timestamptz not null,
  recebido_em timestamptz,
  numero_recibo integer,
  criado_em timestamptz not null default now(),
  unique (owner_id, numero_recibo),
  check ((recebido_em is null) = (numero_recibo is null))
);
create index on public.qf_tools_charges (owner_id, criado_em desc);

do $$
declare table_name text;
begin
  foreach table_name in array array['qf_tools_agenda','qf_tools_quotes','qf_tools_pix_details','qf_tools_charges'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('create policy own_data on public.%I for all to authenticated using (owner_id = (select auth.uid()) and qf_tools_private.is_professional(owner_id)) with check (owner_id = (select auth.uid()) and qf_tools_private.is_professional(owner_id))', table_name);
  end loop;
end;
$$;

grant insert (dia, horario, cliente, servico, endereco, telefone, status),
  update (dia, horario, cliente, servico, endereco, telefone, status)
on public.qf_tools_agenda to authenticated;
grant insert (id, cliente, telefone, descricao, valor, titular, cidade, chave_versao) on public.qf_tools_charges to authenticated;

create function qf_tools_private.create_quote(
  p_id uuid, p_cliente text, p_telefone text, p_itens jsonb, p_material text, p_validade date, p_prazo text
) returns public.qf_tools_quotes
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); next_number integer; result public.qf_tools_quotes; nome text;
begin
  if not coalesce(qf_tools_private.is_professional(uid), false) then raise exception 'Acesso reservado a profissionais.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('qf-tools-quote:' || uid::text, 0));
  select * into result from public.qf_tools_quotes where owner_id = uid and id = p_id;
  if found then return result; end if;
  if p_validade < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'A validade deve ser hoje ou uma data futura.'; end if;
  select coalesce(max(numero), 0) + 1 into next_number from public.qf_tools_quotes where owner_id = uid;
  select left(coalesce(nullif(btrim(nome_fantasia), ''), nullif(btrim(p.nome), ''), 'Profissional'), 100) into nome
    from public.qf_profiles p where id = uid;
  insert into public.qf_tools_quotes (id, owner_id, numero, profissional, cliente, telefone, itens, material, validade, prazo)
  values (p_id, uid, next_number, nome, p_cliente, p_telefone, p_itens, p_material, p_validade, p_prazo)
  returning * into result;
  return result;
end;
$$;
create function public.qf_tools_create_quote(
  p_id uuid, p_cliente text, p_telefone text, p_itens jsonb, p_material text, p_validade date, p_prazo text
) returns jsonb language sql set search_path = '' as $$
  select to_jsonb(qf_tools_private.create_quote(p_id, p_cliente, p_telefone, p_itens, p_material, p_validade, p_prazo));
$$;

create function qf_tools_private.public_quote(p_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('numero', numero, 'profissional', profissional, 'cliente', cliente,
    'itens', itens, 'material', material, 'validade', validade, 'prazo', prazo, 'total', total, 'criado_em', criado_em)
  from public.qf_tools_quotes where token = p_token;
$$;
create function public.qf_tools_public_quote(p_token uuid) returns jsonb
language sql stable set search_path = '' as $$
  select qf_tools_private.public_quote(p_token);
$$;

create function qf_tools_private.valid_document(p_key text) returns boolean
language plpgsql immutable strict set search_path = '' as $$
declare weights integer[]; weight_set integer; sum_digits integer; expected integer; i integer;
begin
  if p_key = repeat(left(p_key, 1), length(p_key)) then return false; end if;
  for weight_set in 1..2 loop
    if length(p_key) = 11 then
      select array_agg(n order by n desc) into weights
      from generate_series(2, 9 + weight_set) n;
    elsif weight_set = 1 then
      weights := array[5,4,3,2,9,8,7,6,5,4,3,2];
    else
      weights := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
    end if;
    sum_digits := 0;
    for i in 1..cardinality(weights) loop
      sum_digits := sum_digits + substr(p_key,i,1)::integer * weights[i];
    end loop;
    expected := case when sum_digits % 11 < 2 then 0 else 11 - sum_digits % 11 end;
    if substr(p_key,length(p_key)-2+weight_set,1)::integer <> expected then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function qf_tools_private.valid_document(text) from public;

create function qf_tools_private.save_pix(p_key text, p_name text, p_city text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if not coalesce(qf_tools_private.is_professional(uid), false) then raise exception 'Acesso reservado a profissionais.'; end if;
  if p_key is null or length(p_key) > 77 or p_key !~ '^([0-9]{11}|[0-9]{14}|[+]55[1-9][0-9](9[0-9]{8}|[2-5][0-9]{7})|[a-zA-Z0-9._%+~-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$' then
    raise exception 'Confira o formato da sua chave Pix.';
  end if;
  if p_key ~ '^[0-9]+$' and not qf_tools_private.valid_document(p_key) then
    raise exception 'Confira os dígitos da sua chave Pix.';
  end if;
  insert into public.qf_livre_pix_chaves as k (profissional_id, chave_pix, status, atualizado_em)
  values (uid, p_key, 'pendente', now())
  on conflict (profissional_id) do update
  set chave_pix = excluded.chave_pix, status = 'pendente', atualizado_em = now()
  where k.chave_pix is distinct from excluded.chave_pix;
  insert into public.qf_tools_pix_details (owner_id, titular, cidade) values (uid, p_name, p_city)
  on conflict (owner_id) do update set titular = excluded.titular, cidade = excluded.cidade;
end;
$$;
create function public.qf_tools_save_pix(p_key text, p_name text, p_city text) returns void
language sql set search_path = '' as $$
  select qf_tools_private.save_pix(p_key, p_name, p_city);
$$;

create function qf_tools_private.receive_charge(p_id uuid) returns public.qf_tools_charges
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result public.qf_tools_charges; next_number integer;
begin
  if not coalesce(qf_tools_private.is_professional(uid), false) then raise exception 'Acesso reservado a profissionais.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('qf-tools-receipt:' || uid::text, 0));
  select * into result from public.qf_tools_charges where owner_id = uid and id = p_id;
  if not found then raise exception 'Cobrança não encontrada.'; end if;
  if result.recebido_em is not null then return result; end if;
  select coalesce(max(numero_recibo), 0) + 1 into next_number from public.qf_tools_charges where owner_id = uid;
  update public.qf_tools_charges set recebido_em = now(), numero_recibo = next_number
  where owner_id = uid and id = p_id returning * into result;
  return result;
end;
$$;
create function public.qf_tools_receive_charge(p_id uuid) returns jsonb
language sql set search_path = '' as $$
  select to_jsonb(qf_tools_private.receive_charge(p_id));
$$;

-- A estreia usa as leituras existentes. A entrega é separada dos avisos gerais
-- para que a publicação deste aviso nunca tire um comunicado do admin do ar.
create table qf_tools_private.launch_notice (
  notice_id uuid primary key references public.qf_avisos_gerais(id) on delete cascade
);
alter table qf_tools_private.launch_notice enable row level security;
alter table public.qf_avisos_gerais_leituras add column qf_tools_clicked_at timestamptz;

with aviso as (
  insert into public.qf_avisos_gerais (titulo, mensagem, publico, ativo)
  values ('Nova ferramenta para o seu dia a dia', 'Use agenda, orçamentos, cobranças por Pix e recibos grátis no QuemFaz.', 'profissionais', false)
  returning id
)
insert into qf_tools_private.launch_notice select id from aviso;

create function qf_tools_private.notice(p_action text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); notice uuid; affected integer;
begin
  if not coalesce(qf_tools_private.is_professional(uid), false) then return false; end if;
  select notice_id into notice from qf_tools_private.launch_notice;
  if p_action = 'visualizar' then
    insert into public.qf_avisos_gerais_leituras (aviso_id, user_id)
    values (notice, uid) on conflict do nothing;
  elsif p_action = 'experimentar' then
    update public.qf_avisos_gerais_leituras set qf_tools_clicked_at = now()
    where aviso_id = notice and user_id = uid and qf_tools_clicked_at is null;
  else
    return false;
  end if;
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;
create function public.qf_tools_notice(p_action text) returns boolean
language sql set search_path = '' as $$
  select qf_tools_private.notice(p_action);
$$;

create function qf_tools_private.notice_report() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'Acesso reservado ao administrador.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('nome', coalesce(nullif(p.nome_fantasia, ''), p.nome),
      'user_id', p.id, 'visto', l.lido_em, 'clicou', l.qf_tools_clicked_at) order by l.lido_em desc)
    from qf_tools_private.launch_notice n join public.qf_avisos_gerais_leituras l on n.notice_id = l.aviso_id
    join public.qf_profiles p on p.id = l.user_id
  ), '[]'::jsonb);
end;
$$;
create function public.qf_tools_notice_report() returns jsonb
language sql stable set search_path = '' as $$
  select qf_tools_private.notice_report();
$$;

revoke all on function qf_tools_private.create_quote(uuid,text,text,jsonb,text,date,text),
  qf_tools_private.save_pix(text,text,text), qf_tools_private.receive_charge(uuid),
  qf_tools_private.notice(text), qf_tools_private.notice_report(),
  public.qf_tools_create_quote(uuid,text,text,jsonb,text,date,text), public.qf_tools_save_pix(text,text,text),
  public.qf_tools_receive_charge(uuid), public.qf_tools_notice(text), public.qf_tools_notice_report()
from public, anon, authenticated;
grant execute on function qf_tools_private.create_quote(uuid,text,text,jsonb,text,date,text),
  qf_tools_private.save_pix(text,text,text), qf_tools_private.receive_charge(uuid),
  qf_tools_private.notice(text), qf_tools_private.notice_report(),
  public.qf_tools_create_quote(uuid,text,text,jsonb,text,date,text), public.qf_tools_save_pix(text,text,text),
  public.qf_tools_receive_charge(uuid), public.qf_tools_notice(text), public.qf_tools_notice_report()
to authenticated;
revoke all on function qf_tools_private.public_quote(uuid), public.qf_tools_public_quote(uuid) from public, anon, authenticated;
grant execute on function qf_tools_private.public_quote(uuid), public.qf_tools_public_quote(uuid) to anon, authenticated;
