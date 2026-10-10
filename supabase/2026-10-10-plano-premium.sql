-- QuemFaz V11.49 — plano Premium (R$ 199,90 · 60 chamados · 30 dias) + anúncio incluído + selo.
-- 1) Catálogo e checagens aceitam 'premium'. A compra e a ativação usam o fluxo que já existe
--    (qf_solicitar_plano -> qf_recargas -> qf_recarga_pagamento_aplicado), que lê o catálogo.
-- 2) Anúncio incluído: enquanto o Premium estiver valendo, o PRIMEIRO anúncio "local" enviado
--    pelo profissional entra como pago (R$ 0,00), sem Pix. Continua indo para aprovação do admin.
--    O plano guarda qual anúncio usou o benefício (qf_planos_profissional.anuncio_id).
-- 3) Selo: qf_profissionais_premium(ids) diz quais profissionais têm Premium valendo.

alter table public.qf_planos_catalogo drop constraint if exists qf_planos_catalogo_plano_check;
alter table public.qf_planos_catalogo add constraint qf_planos_catalogo_plano_check check (plano = any (array['mensal'::text, 'pro'::text, 'premium'::text]));
alter table public.qf_recargas drop constraint if exists qf_recargas_plano_check;
alter table public.qf_recargas add constraint qf_recargas_plano_check check (plano = any (array['mensal'::text, 'pro'::text, 'premium'::text]));
alter table public.qf_planos_profissional drop constraint if exists qf_planos_profissional_plano_check;
alter table public.qf_planos_profissional add constraint qf_planos_profissional_plano_check check (plano = any (array['mensal'::text, 'pro'::text, 'premium'::text]));
alter table public.qf_planos_profissional add column if not exists anuncio_id uuid references public.qf_anuncios(id) on delete set null;

insert into public.qf_planos_catalogo (plano, nome, preco_centavos, chamados, dias, ativo)
values ('premium', 'Premium', 19990, 60, 30, true)
on conflict (plano) do update set nome = excluded.nome, preco_centavos = excluded.preco_centavos,
  chamados = excluded.chamados, dias = excluded.dias, ativo = excluded.ativo;

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

  select valor into v_cfg from public.qf_config where chave = 'anuncios';
  v_valor := case p_plano
    when 'premium' then coalesce((v_cfg->>'premium_centavos')::integer, 19900)
    when 'destaque' then coalesce((v_cfg->>'destaque_centavos')::integer, 12900)
    else coalesce((v_cfg->>'local_centavos')::integer, 7900)
  end;

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

-- Selo Premium: quais destes profissionais têm o Premium valendo agora.
create or replace function public.qf_profissionais_premium(p_ids uuid[])
returns table(id uuid)
language sql
stable
security definer
set search_path to ''
as $function$
  select distinct pp.profissional_id
    from public.qf_planos_profissional pp
   where pp.plano = 'premium' and pp.valido_ate > now()
     and pp.profissional_id = any(coalesce(p_ids, array[]::uuid[]));
$function$;
grant execute on function public.qf_profissionais_premium(uuid[]) to anon, authenticated;
