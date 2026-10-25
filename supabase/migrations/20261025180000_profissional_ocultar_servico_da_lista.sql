-- Tela Pedidos do profissional: "Remover da lista".
-- Apenas OCULTA o serviço encerrado na lista do próprio profissional.
-- Não altera nem apaga chamados, desbloqueios, avaliações, movimentações da carteira,
-- fechamentos ou comissões de 13%. O registro é só um marcador de visualização.

create table if not exists public.qf_profissional_servicos_ocultos (
  profissional_id uuid not null,
  chamado_id uuid not null,
  ocultado_em timestamptz not null default now(),
  primary key (profissional_id, chamado_id)
);

comment on table public.qf_profissional_servicos_ocultos is
  'Serviços que o profissional removeu da PRÓPRIA lista de Pedidos. Somente visualização: nenhum dado financeiro, avaliação ou comissão é alterado.';

alter table public.qf_profissional_servicos_ocultos enable row level security;

drop policy if exists qf_prof_servicos_ocultos_select_proprio on public.qf_profissional_servicos_ocultos;
create policy qf_prof_servicos_ocultos_select_proprio
  on public.qf_profissional_servicos_ocultos
  for select to authenticated
  using (profissional_id = (select auth.uid()));

-- Sem escrita direta: o único caminho é a função abaixo.
revoke all on table public.qf_profissional_servicos_ocultos from public, anon, authenticated;
grant select on table public.qf_profissional_servicos_ocultos to authenticated;

create or replace function public.qf_profissional_ocultar_servico(p_chamado_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_prof uuid := auth.uid();
  v_status text;
begin
  if v_prof is null then
    raise exception 'authentication required';
  end if;

  select c.status into v_status
  from public.qf_chamados c
  where c.id = p_chamado_id;

  if v_status is null then
    return jsonb_build_object('ok', false, 'reason', 'Serviço não encontrado.');
  end if;

  -- Só some da lista de quem de fato desbloqueou o pedido.
  if not exists (
    select 1 from public.qf_desbloqueios d
    where d.chamado_id = p_chamado_id and d.profissional_id = v_prof
  ) then
    return jsonb_build_object('ok', false, 'reason', 'Este serviço não está na sua lista.');
  end if;

  -- Serviço ainda ativo ou em negociação nunca pode ser removido.
  if v_status not in ('concluido', 'finalizado', 'cancelado', 'expirado') then
    return jsonb_build_object('ok', false, 'reason', 'Só é possível remover serviços já encerrados.', 'status', v_status);
  end if;

  insert into public.qf_profissional_servicos_ocultos (profissional_id, chamado_id)
  values (v_prof, p_chamado_id)
  on conflict do nothing;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.qf_profissional_ocultar_servico(uuid) from public, anon;
grant execute on function public.qf_profissional_ocultar_servico(uuid) to authenticated;
