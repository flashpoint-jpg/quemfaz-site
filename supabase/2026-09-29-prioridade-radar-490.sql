-- QuemFaz — prioridade do cliente no radar
-- Valor escolhido: R$ 4,90.
-- Ao aprovar o pagamento, ativa prioridade no chamado e dispara boost da cascata.

update public.qf_config
set valor = jsonb_set(coalesce(valor,'{}'::jsonb), '{valor_centavos}', '490'::jsonb, true)
where chave = 'prioridade_cliente';

create or replace function public.qf_solicitar_prioridade(
  p_chamado_id uuid,
  p_metodo text default 'pix'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_valor integer := 490;
  v_id uuid;
  v_status text;
  v_checkout text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if p_metodo not in ('pix','cartao','boleto') then raise exception 'invalid payment method'; end if;

  if not exists (
    select 1 from public.qf_chamados c
    where c.id = p_chamado_id and c.cliente_id = v_uid and c.status = 'aberto'
  ) then
    raise exception 'call not found or unavailable';
  end if;

  select coalesce((valor->>'valor_centavos')::integer, 490)
    into v_valor
  from public.qf_config
  where chave = 'prioridade_cliente';

  v_valor := coalesce(v_valor, 490);

  select id, status, checkout_url
    into v_id, v_status, v_checkout
  from public.qf_prioridade_pagamentos
  where chamado_id = p_chamado_id and cliente_id = v_uid;

  if v_id is not null then
    return jsonb_build_object(
      'ok', true, 'pagamento_id', v_id, 'status', v_status,
      'valor_centavos', v_valor, 'checkout_url', v_checkout,
      'prioridade_ativa', v_status = 'aprovado'
    );
  end if;

  insert into public.qf_prioridade_pagamentos(chamado_id, cliente_id, valor_centavos, metodo, status)
  values (p_chamado_id, v_uid, v_valor, p_metodo, 'pendente')
  returning id, status, checkout_url into v_id, v_status, v_checkout;

  return jsonb_build_object(
    'ok', true, 'pagamento_id', v_id, 'status', v_status,
    'valor_centavos', v_valor, 'checkout_url', v_checkout,
    'prioridade_ativa', false
  );
end;
$function$;

create or replace function public.qf_prioridade_pagamento_aplicado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    update public.qf_chamados
       set prioridade = true, atualizado_em = now()
     where id = new.chamado_id and cliente_id = new.cliente_id and status = 'aberto';

    begin
      perform private.qf_push_interno('priority_boost', new.chamado_id);
    exception when others then
      raise warning 'QuemFaz boost prioridade: %', sqlerrm;
    end;
  elsif new.status in ('cancelado','expirado','estornado') and old.status = 'aprovado' then
    update public.qf_chamados
       set prioridade = false, atualizado_em = now()
     where id = new.chamado_id and cliente_id = new.cliente_id and status = 'aberto';
  end if;
  return null;
end;
$function$;
