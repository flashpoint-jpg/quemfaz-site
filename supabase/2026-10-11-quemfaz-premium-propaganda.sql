-- QuemFaz 11.73 — propaganda com um plano só: QuemFaz Premium (R$ 300 por 30 dias).
-- (aplicado no Supabase em 11/10/2026)
--
-- 1) A empresa solicita SEM conta, pela função quemfaz-anuncio-premium (gera o Pix na Efí).
--    Quem pediu (nome, WhatsApp e o segredo da consulta) fica numa tabela à parte, que o público não lê.
-- 2) O admin corrige a propaganda antes de publicar (qf_admin_editar_anuncio) e vê quem pediu.
-- 3) Local e Destaque deixam de ser vendidos. O anúncio incluído no plano Premium do profissional continua.
-- 4) Visualizações e cliques passam a ser contados no banco.
-- 5) O admin é avisado quando o Pix de uma propaganda cai.

create table if not exists public.qf_anuncio_solicitacoes (
  anuncio_id uuid primary key references public.qf_anuncios(id) on delete cascade,
  nome text,
  whatsapp text,
  segredo text not null,
  criado_em timestamptz not null default now()
);
alter table public.qf_anuncio_solicitacoes enable row level security;
revoke all on public.qf_anuncio_solicitacoes from public, anon, authenticated;
create index if not exists qf_anuncio_solicitacoes_criado_idx on public.qf_anuncio_solicitacoes (criado_em desc);

update public.qf_config
   set valor = valor || jsonb_build_object('premium_centavos', 30000)
 where chave = 'anuncios';

-- Destino do clique: WhatsApp (número em "whatsapp"), ligação ("tel:") ou site ("https://").
create or replace function private.qf_anuncio_destino(p_tipo text, p_valor text, out whatsapp text, out destino_url text)
 language plpgsql
 immutable
 set search_path to ''
as $function$
declare
  v_tipo text := lower(trim(coalesce(p_tipo, '')));
  v_valor text := trim(coalesce(p_valor, ''));
  v_num text := regexp_replace(v_valor, '\D', '', 'g');
begin
  if v_tipo in ('whatsapp', 'ligacao') then
    if v_num like '55%' and length(v_num) >= 12 then v_num := substr(v_num, 3); end if;
    if length(v_num) < 10 or length(v_num) > 11 then raise exception 'telefone_invalido'; end if;
    if v_tipo = 'whatsapp' then
      whatsapp := v_num; destino_url := null;
    else
      whatsapp := null; destino_url := 'tel:+55' || v_num;
    end if;
  elsif v_tipo = 'site' then
    if v_valor !~* '^https?://[^\s/]+\.[^\s]+$' or length(v_valor) > 300 then raise exception 'site_invalido'; end if;
    whatsapp := null; destino_url := v_valor;
  else
    raise exception 'destino_invalido';
  end if;
end;
$function$;

create or replace function public.qf_admin_editar_anuncio(
  p_id uuid, p_empresa text, p_chamada text, p_destino_tipo text, p_destino_valor text, p_imagem_data text default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_d record;
begin
  if not private.qf_is_admin() then raise exception 'admin authentication required'; end if;
  p_empresa := trim(coalesce(p_empresa, ''));
  p_chamada := trim(coalesce(p_chamada, ''));
  p_imagem_data := nullif(coalesce(p_imagem_data, ''), '');
  if length(p_empresa) < 2 or length(p_empresa) > 60 then return jsonb_build_object('ok', false, 'reason', 'empresa_invalida'); end if;
  if length(p_chamada) < 4 or length(p_chamada) > 90 then return jsonb_build_object('ok', false, 'reason', 'frase_invalida'); end if;
  if p_imagem_data is not null and (p_imagem_data !~ '^data:image/' or length(p_imagem_data) > 1800000) then
    return jsonb_build_object('ok', false, 'reason', 'imagem_invalida');
  end if;
  begin
    select * into v_d from private.qf_anuncio_destino(p_destino_tipo, p_destino_valor);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', sqlerrm);
  end;
  update public.qf_anuncios
     set anunciante_nome = p_empresa,
         titulo = p_chamada,
         texto = p_chamada,
         whatsapp = v_d.whatsapp,
         destino_url = v_d.destino_url,
         imagem_data = coalesce(p_imagem_data, imagem_data),
         atualizado_em = now()
   where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'nao_encontrado'); end if;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke execute on function public.qf_admin_editar_anuncio(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.qf_admin_editar_anuncio(uuid, text, text, text, text, text) to authenticated;

create or replace function public.qf_admin_anuncio_solicitantes()
 returns table(anuncio_id uuid, nome text, whatsapp text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if not private.qf_is_admin() then raise exception 'admin authentication required'; end if;
  return query select s.anuncio_id, s.nome, s.whatsapp from public.qf_anuncio_solicitacoes s;
end;
$function$;
revoke execute on function public.qf_admin_anuncio_solicitantes() from public, anon;
grant execute on function public.qf_admin_anuncio_solicitantes() to authenticated;

-- Conta de verdade quantas vezes a propaganda apareceu e quantos cliques teve.
create or replace function public.qf_anuncio_evento(p_id uuid, p_tipo text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if p_tipo = 'clique' then
    update public.qf_anuncios set cliques = cliques + 1
     where id = p_id and status = 'aprovado' and pagamento_status = 'aprovado';
  elsif p_tipo = 'visualizacao' then
    update public.qf_anuncios set visualizacoes = visualizacoes + 1
     where id = p_id and status = 'aprovado' and pagamento_status = 'aprovado';
  end if;
end;
$function$;
revoke execute on function public.qf_anuncio_evento(uuid, text) from public;
grant execute on function public.qf_anuncio_evento(uuid, text) to anon, authenticated;

-- Aviso ao admin quando o Pix da propaganda é confirmado.
create or replace function private.qf_anuncio_pago_avisa_admin()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    begin
      perform private.qf_admin_push_interno('ad_paid', new.anuncio_id);
    exception when others then
      null; -- o aviso nunca pode impedir a confirmação do pagamento
    end;
  end if;
  return new;
end;
$function$;
drop trigger if exists qf_anuncio_pago_avisa_admin on public.qf_anuncio_pagamentos;
create trigger qf_anuncio_pago_avisa_admin
  after update of status on public.qf_anuncio_pagamentos
  for each row execute function private.qf_anuncio_pago_avisa_admin();

-- Local e Destaque não são mais vendidos: só passam quando é o anúncio incluído no plano Premium do profissional.
create or replace function public.qf_enviar_anuncio(p_empresa text, p_chamada text, p_regiao text, p_plano text, p_imagem_data text, p_whatsapp text, p_link text default null::text, p_metodo text default 'pix'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_cfg jsonb;
  v_valor integer;
  v_anuncio_id uuid;
  v_pagamento_id uuid;
  v_premium uuid;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  p_empresa := trim(coalesce(p_empresa,''));
  p_chamada := trim(coalesce(p_chamada,''));
  p_regiao := coalesce(nullif(trim(p_regiao),''), 'all');
  p_plano := lower(coalesce(nullif(trim(p_plano),''), 'local'));
  p_whatsapp := trim(coalesce(p_whatsapp,''));
  p_link := nullif(trim(coalesce(p_link,'')), '');
  p_metodo := lower(coalesce(nullif(trim(p_metodo),''), 'pix'));

  if length(p_empresa) < 2 or length(p_empresa) > 60 then raise exception 'invalid company name'; end if;
  if length(p_chamada) < 4 or length(p_chamada) > 90 then raise exception 'invalid ad headline'; end if;
  if p_whatsapp = '' then raise exception 'whatsapp required'; end if;
  if p_plano not in ('local','destaque','premium') then raise exception 'invalid plan'; end if;
  if p_metodo <> 'pix' then raise exception 'only pix is enabled in production'; end if;
  if p_imagem_data is null or length(p_imagem_data) < 100 then raise exception 'image required'; end if;
  if length(p_imagem_data) > 1800000 then raise exception 'image too large'; end if;

  -- V11.49: anúncio "local" incluído no plano Premium (um por plano comprado).
  if p_plano = 'local' then
    select pp.id into v_premium
      from public.qf_planos_profissional pp
     where pp.profissional_id = v_uid and pp.plano = 'premium'
       and pp.valido_ate > now() and pp.anuncio_id is null
     order by pp.valido_ate asc
     limit 1
     for update;
  end if;

  if v_premium is not null then
    insert into public.qf_anuncios(
      anunciante_id, anunciante_nome, contato, whatsapp, titulo, texto,
      imagem_data, destino_url, regiao, plano, valor_centavos, status,
      pagamento_status, pago_em
    )
    values (
      v_uid, p_empresa, p_whatsapp, p_whatsapp, p_chamada, p_chamada,
      p_imagem_data, p_link, p_regiao, 'local', 0, 'pendente',
      'aprovado', now()
    )
    returning id into v_anuncio_id;
    update public.qf_planos_profissional set anuncio_id = v_anuncio_id, atualizado_em = now() where id = v_premium;
    return jsonb_build_object(
      'ok', true, 'anuncio_id', v_anuncio_id, 'pagamento_id', null,
      'status', 'pendente', 'pagamento_status', 'aprovado',
      'valor_centavos', 0, 'dias', 30, 'modo_teste', false, 'incluido_no_plano', true
    );
  end if;

  -- V11.73: só o QuemFaz Premium é vendido.
  if p_plano <> 'premium' then
    return jsonb_build_object('ok', false, 'reason', 'sem_incluso');
  end if;

  select valor into v_cfg from public.qf_config where chave = 'anuncios';
  v_valor := coalesce((v_cfg->>'premium_centavos')::integer, 30000);

  insert into public.qf_anuncios(
    anunciante_id, anunciante_nome, contato, whatsapp, titulo, texto,
    imagem_data, destino_url, regiao, plano, valor_centavos, status,
    pagamento_status, pago_em
  )
  values (
    v_uid, p_empresa, p_whatsapp, p_whatsapp, p_chamada, p_chamada,
    p_imagem_data, p_link, p_regiao, p_plano, v_valor, 'pendente',
    'pendente', null
  )
  returning id into v_anuncio_id;

  insert into public.qf_anuncio_pagamentos(
    anuncio_id, valor_centavos, metodo, status, provedor, provedor_id, aprovado_em, checkout_url
  )
  values (
    v_anuncio_id, v_valor, 'pix', 'pendente', null, null, null, null
  )
  returning id into v_pagamento_id;

  return jsonb_build_object(
    'ok', true,
    'anuncio_id', v_anuncio_id,
    'pagamento_id', v_pagamento_id,
    'status', 'pendente',
    'pagamento_status', 'pendente',
    'valor_centavos', v_valor,
    'dias', 30,
    'modo_teste', false
  );
end;
$function$;

-- A função quemfaz-anuncio-premium (service_role) grava e consulta por aqui: nada disso é aberto ao público.
create or replace function public.qf_anuncio_premium_criar(
  p_empresa text, p_chamada text, p_imagem_data text, p_destino_tipo text, p_destino_valor text,
  p_nome text, p_whatsapp text, p_segredo text
) returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_d record;
  v_valor integer;
  v_anuncio uuid;
  v_pagamento uuid;
begin
  -- Freio contra abuso: cada solicitação guarda uma imagem e abre uma cobrança na Efí.
  if (select count(*) from public.qf_anuncio_solicitacoes s where s.whatsapp = p_whatsapp and s.criado_em > now() - interval '1 hour') >= 5
     or (select count(*) from public.qf_anuncio_solicitacoes s where s.criado_em > now() - interval '10 minutes') >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'muitas_tentativas');
  end if;
  begin
    select * into v_d from private.qf_anuncio_destino(p_destino_tipo, p_destino_valor);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'destino_invalido');
  end;
  select coalesce((valor->>'premium_centavos')::integer, 30000) into v_valor from public.qf_config where chave = 'anuncios';
  v_valor := coalesce(v_valor, 30000);
  if v_valor <= 0 then return jsonb_build_object('ok', false, 'reason', 'preco_invalido'); end if;

  insert into public.qf_anuncios(
    anunciante_id, anunciante_nome, contato, whatsapp, titulo, texto, imagem_data, destino_url,
    regiao, plano, valor_centavos, status, pagamento_status
  ) values (
    null, p_empresa, p_whatsapp, v_d.whatsapp, p_chamada, p_chamada, p_imagem_data, v_d.destino_url,
    'all', 'premium', v_valor, 'pendente', 'pendente'
  ) returning id into v_anuncio;
  insert into public.qf_anuncio_solicitacoes(anuncio_id, nome, whatsapp, segredo) values (v_anuncio, p_nome, p_whatsapp, p_segredo);
  insert into public.qf_anuncio_pagamentos(anuncio_id, valor_centavos, metodo, status) values (v_anuncio, v_valor, 'pix', 'pendente')
    returning id into v_pagamento;
  return jsonb_build_object('ok', true, 'anuncio_id', v_anuncio, 'pagamento_id', v_pagamento, 'valor_centavos', v_valor);
end;
$function$;

-- Se o Pix não pôde ser gerado, a solicitação some (só enquanto ainda não foi paga).
create or replace function public.qf_anuncio_premium_desfazer(p_id uuid)
 returns void
 language sql
 security definer
 set search_path to ''
as $function$
  delete from public.qf_anuncios where id = p_id and pagamento_status = 'pendente' and status = 'pendente';
$function$;

create or replace function public.qf_anuncio_premium_status(p_id uuid, p_segredo text)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select jsonb_build_object(
    'ok', true, 'status', a.status, 'fim_em', a.fim_em,
    'pagamento_id', p.id, 'pagamento', coalesce(p.status, 'pendente'),
    'provedor_id', p.provedor_id, 'valor_centavos', p.valor_centavos)
  from public.qf_anuncio_solicitacoes s
  join public.qf_anuncios a on a.id = s.anuncio_id
  left join lateral (
    select ap.id, ap.status, ap.provedor_id, ap.valor_centavos
      from public.qf_anuncio_pagamentos ap where ap.anuncio_id = a.id order by ap.criado_em desc limit 1
  ) p on true
  where s.anuncio_id = p_id and s.segredo = p_segredo;
$function$;

revoke execute on function public.qf_anuncio_premium_criar(text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.qf_anuncio_premium_desfazer(uuid) from public, anon, authenticated;
revoke execute on function public.qf_anuncio_premium_status(uuid, text) from public, anon, authenticated;
grant execute on function public.qf_anuncio_premium_criar(text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.qf_anuncio_premium_desfazer(uuid) to service_role;
grant execute on function public.qf_anuncio_premium_status(uuid, text) to service_role;

-- O aviso do Pix da propaganda usa o recado comum da quemfaz-admin-aviso (action user_notice) para todos os admins.
-- Esta versão substitui a de cima (que usava um evento que a função ainda não conhece).
create or replace function private.qf_anuncio_pago_avisa_admin()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_seg text;
  v_ids jsonb;
  v_nome text;
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    begin
      select decrypted_secret into v_seg from vault.decrypted_secrets where name = 'qf_push_internal' limit 1;
      select jsonb_agg(a.user_id) into v_ids from public.qf_admins a;
      select anunciante_nome into v_nome from public.qf_anuncios where id = new.anuncio_id;
      if v_ids is not null then
        perform net.http_post(
          url := 'https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-admin-aviso',
          body := jsonb_build_object(
            'action', 'user_notice',
            'user_ids', v_ids,
            'title', '💰 Propaganda paga: ' || coalesce(v_nome, 'empresa'),
            'body', 'QuemFaz Premium · R$ ' || replace(to_char(new.valor_centavos / 100.0, 'FM999990.00'), '.', ',') || ' no Pix. Confira, corrija e aprove no painel.',
            'url', '/admin.html',
            'tag', 'qf-anuncio-pago-' || new.anuncio_id
          ),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-qf-internal', coalesce(v_seg, '')),
          timeout_milliseconds := 8000
        );
      end if;
    exception when others then
      null; -- o aviso nunca pode impedir a confirmação do pagamento
    end;
  end if;
  return new;
end;
$function$;
