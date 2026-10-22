-- QuemFaz 17/10/2026 — urgência do pedido: apenas "Normal" ou "Urgente" (as duas GRÁTIS).
--
-- "Sem pressa", "Com pressa" e "Agendado" saem das telas. As colunas antigas (prazo, prazo_dia, periodo, data_preferida)
-- continuam no banco: o histórico fica intacto e as rotinas internas (expirar pedido, fechar sem retorno) seguem iguais.
--
-- Urgente NÃO é a prioridade paga. A prioridade paga (R$ 9,90) continua no campo `prioridade`, sem nenhuma mudança.
--
-- Migração só ADITIVA: coluna nova e nula, nenhum pedido existente é alterado, nenhum status muda,
-- nenhuma notificação é disparada (não há gatilho de aviso novo).

alter table public.qf_chamados
  add column if not exists urgencia text;

comment on column public.qf_chamados.urgencia is
  'Urgência escolhida pelo cliente: normal ou urgente (as duas grátis). Nulo = pedido antigo (não perguntava). Diferente de prioridade (paga).';

-- Arruma o valor antes de gravar. Nunca recusa o pedido: qualquer coisa estranha vira nulo.
create or replace function private.qf_chamado_normalizar_urgencia()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  new.urgencia := nullif(lower(btrim(coalesce(new.urgencia, ''))), '');
  if new.urgencia is not null and new.urgencia not in ('normal', 'urgente') then
    new.urgencia := null;
  end if;
  return new;
exception when others then
  raise warning 'QuemFaz normalizar urgencia: %', sqlerrm;
  new.urgencia := null;
  return new;
end;
$function$;

drop trigger if exists qf_chamado_normalizar_urgencia_before_write on public.qf_chamados;
create trigger qf_chamado_normalizar_urgencia_before_write
  before insert or update of urgencia on public.qf_chamados
  for each row execute function private.qf_chamado_normalizar_urgencia();

-- Urgência dos pedidos que o app já carregou. Função nova e separada, no mesmo molde de qf_chamados_prazos:
-- as funções que listam pedidos continuam exatamente como estavam. Quem vê: o próprio cliente e profissionais.
create or replace function public.qf_chamados_urgencias(p_ids uuid[])
returns table(id uuid, urgencia text)
language sql
stable
security definer
set search_path to ''
as $function$
  select c.id, c.urgencia
  from public.qf_chamados c
  where c.id = any((coalesce(p_ids, array[]::uuid[]))[1:500])
    and c.urgencia is not null
    and (
      c.cliente_id = auth.uid()
      or exists (select 1 from public.qf_profissionais pr where pr.user_id = auth.uid())
    );
$function$;

revoke all on function public.qf_chamados_urgencias(uuid[]) from public, anon;
grant execute on function public.qf_chamados_urgencias(uuid[]) to authenticated;

-- Notificação de chamado novo: em vez do prazo antigo ("SEM PRESSA", "PRA HOJE"...), pedido urgente leva "URGENTE" na frente.
-- Mesma assinatura e mesmo retorno; a função quemfaz-push não muda. Não cria nem dispara aviso novo.
create or replace function public.qf_push_detalhes_chamado(p_chamado_id uuid, p_user_ids uuid[])
 returns table(user_id uuid, distancia_km numeric, tempo_min integer, preco_centavos integer, plano_restantes integer, descricao text, fotos integer, videos integer)
 language sql
 stable security definer
 set search_path to ''
as $function$
  with c as (
    select ch.id,
           g.latitude,
           g.longitude,
           nullif(concat_ws(': ',
             case when ch.urgencia = 'urgente' then 'URGENTE' end,
             nullif(btrim(public.qf_ocultar_contato(ch.descricao)), '')
           ), '') as descricao,
           coalesce(pd.preco_centavos, padrao.preco_centavos, 790)::integer as preco,
           (select count(*) from jsonb_array_elements_text(case when jsonb_typeof(ch.fotos) = 'array' then ch.fotos else '[]'::jsonb end) f
             where f not ilike 'data:video/%')::integer as fotos,
           (select count(*) from jsonb_array_elements_text(case when jsonb_typeof(ch.fotos) = 'array' then ch.fotos else '[]'::jsonb end) f
             where f ilike 'data:video/%')::integer as videos
    from public.qf_chamados ch
    left join lateral private.qf_chamado_centro(ch.id) g on true
    left join public.qf_precos_desbloqueio pd on pd.categoria = ch.categoria and pd.ativo
    left join public.qf_precos_desbloqueio padrao on padrao.categoria = 'padrao'
    where ch.id = p_chamado_id
  )
  select pr.user_id,
         round(public.qf_distancia_km(pr.latitude, pr.longitude, c.latitude, c.longitude), 1),
         public.qf_tempo_estimado_min(public.qf_distancia_km(pr.latitude, pr.longitude, c.latitude, c.longitude)),
         c.preco,
         coalesce((select sum(pl.chamados_restantes) from public.qf_planos_profissional pl
                    where pl.profissional_id = pr.user_id and pl.valido_ate > now() and pl.chamados_restantes > 0), 0)::integer,
         c.descricao,
         c.fotos,
         c.videos
  from c
  join public.qf_profissionais pr on pr.user_id = any(coalesce(p_user_ids, array[]::uuid[]));
$function$;
