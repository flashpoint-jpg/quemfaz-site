-- QuemFaz V11.48 — bônus de cadastro do profissional com chave no painel.
-- Antes: todo profissional novo ganhava R$ 25 automático (gatilho qf_bonus_lancamento_novo_profissional),
-- sem como desligar. Agora o gatilho lê qf_config.bonus_cadastro = {"ativo": bool, "valor_centavos": int}.
-- Começa DESLIGADO (decisão do dono em 10/10/2026). Quem já recebeu continua com o crédito.
-- O admin liga, desliga e muda o valor pela página Bônus do painel (qf_admin_salvar_bonus_cadastro).

insert into public.qf_config (chave, valor)
values ('bonus_cadastro', '{"ativo": false, "valor_centavos": 2500}'::jsonb)
on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();

create or replace function qf_private.conceder_bonus_lancamento_profissional()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_rows integer := 0;
  v_cfg jsonb := (select c.valor from public.qf_config c where c.chave = 'bonus_cadastro');
  v_ativo boolean := coalesce((v_cfg->>'ativo')::boolean, false);
  v_valor integer := least(greatest(coalesce((v_cfg->>'valor_centavos')::integer, 0), 0), 10000);
begin
  insert into public.qf_carteiras(
    profissional_id,saldo_centavos,bonus_inicial_centavos,bonus_inicial_usado
  )
  values(new.user_id,0,0,true)
  on conflict(profissional_id) do update
  set bonus_inicial_usado=true;

  -- V11.48: bônus desligado (ou valor zero) no painel: cria só a carteira, sem crédito.
  if not v_ativo or v_valor <= 0 then
    return new;
  end if;

  insert into public.qf_movimentacoes_carteira(
    profissional_id,tipo,valor_centavos,referencia_tipo,descricao
  )
  values(
    new.user_id,'bonus',v_valor,'bonus_lancamento',
    'Bônus de cadastro QuemFaz — R$ ' || replace(to_char(v_valor / 100.0, 'FM999990.00'), '.', ',')
  )
  on conflict do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 1 then
    update public.qf_carteiras
       set saldo_centavos=saldo_centavos+v_valor,
           atualizado_em=now()
     where profissional_id=new.user_id;
  end if;

  return new;
end;
$function$;

-- Leitura pública (o site mostra a promessa do bônus só quando ele está ligado).
create or replace function public.qf_bonus_cadastro_info()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'ativo', coalesce((c.valor->>'ativo')::boolean, false),
    'valor_centavos', coalesce((c.valor->>'valor_centavos')::integer, 0)
  )
  from (select (select x.valor from public.qf_config x where x.chave = 'bonus_cadastro') as valor) c;
$function$;
grant execute on function public.qf_bonus_cadastro_info() to anon, authenticated;

-- Só o admin altera.
create or replace function public.qf_admin_salvar_bonus_cadastro(p_ativo boolean, p_valor_centavos integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if p_valor_centavos is null or p_valor_centavos < 100 or p_valor_centavos > 10000 then
    return jsonb_build_object('ok', false, 'reason', 'Use um valor de R$ 1 a R$ 100.');
  end if;
  insert into public.qf_config (chave, valor, atualizado_em)
  values ('bonus_cadastro', jsonb_build_object('ativo', coalesce(p_ativo, false), 'valor_centavos', p_valor_centavos), now())
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
  return jsonb_build_object('ok', true) || public.qf_bonus_cadastro_info();
end;
$function$;
revoke execute on function public.qf_admin_salvar_bonus_cadastro(boolean, integer) from anon;
grant execute on function public.qf_admin_salvar_bonus_cadastro(boolean, integer) to authenticated;
