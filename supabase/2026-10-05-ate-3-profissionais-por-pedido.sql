-- QuemFaz V11.28.0 — até 3 profissionais podem desbloquear o mesmo pedido.
-- Antes (11.16.0) o primeiro que desbloqueava reservava o pedido sozinho.
--
-- O que muda:
--   * saem os índices únicos que deixavam só 1 desbloqueio por pedido;
--   * qf_desbloquear_chamado aceita até 3 desbloqueios ativos e devolve "participantes" e "limite";
--   * a lista de pedidos do profissional mostra quantas vagas já foram ocupadas;
--   * "Não fechei" passa a valer só para o profissional que respondeu: o pedido segue para os outros
--     e só é encerrado quando as 3 vagas foram usadas e ninguém mais está em conversa;
--   * "Fechei o serviço" continua concluindo o pedido;
--   * o fechamento automático de 7 dias marca "não fechado" quando todos já responderam;
--   * a cascata de avisos considera o pedido preenchido com 3 (antes 5);
--   * o painel recebe a lista de desbloqueios de cada pedido.
--
-- As funções são alteradas por troca de trechos, para não mexer no resto de cada uma.
-- Roda uma vez só: se algum trecho não for encontrado, nada é gravado.

alter table public.qf_desbloqueios
  add column if not exists desfecho text,
  add column if not exists desfecho_em timestamptz;

alter table public.qf_desbloqueios drop constraint if exists qf_desbloqueios_desfecho_check;
alter table public.qf_desbloqueios
  add constraint qf_desbloqueios_desfecho_check check (desfecho is null or desfecho in ('fechado','nao_fechado'));

-- Pedidos já encerrados pelo profissional: o resultado passa a ficar também no desbloqueio dele.
update public.qf_desbloqueios d
   set desfecho = c.desfecho, desfecho_em = coalesce(c.desfecho_em, c.atualizado_em)
  from public.qf_chamados c
 where c.id = d.chamado_id
   and c.desfecho in ('fechado','nao_fechado')
   and d.desfecho is null
   and coalesce(d.ativo, true);

drop index if exists public.uq_qf_desbloqueios_chamado;
drop index if exists public.qf_desbloqueios_um_ativo_por_chamado;
drop index if exists public.qf_desbloqueios_um_ativo_por_chamado_idx;

do $mig$
declare
  def text;
  novo text;
begin
  -- 1. Desbloqueio: até 3 por pedido.
  def := pg_get_functiondef('public.qf_desbloquear_chamado(uuid)'::regprocedure);
  novo := regexp_replace(def, 'select d\.profissional_id into v_reservado_por.*?end if;', $n$select count(*)::integer into v_participantes
  from public.qf_desbloqueios d
  where d.chamado_id=p_chamado_id
    and coalesce(d.ativo,true);

  if v_participantes >= 3 then
    return jsonb_build_object(
      'ok',false,'reason','reservado','lotado',true,
      'participantes',v_participantes,'limite',3,
      'message','As 3 vagas deste pedido já foram preenchidas.'
    );
  end if;$n$);
  if novo = def then raise exception 'qf_desbloquear_chamado: trecho da reserva não encontrado'; end if;
  def := novo;
  novo := replace(def, 'v_reservado_por uuid;', 'v_reservado_por uuid;' || E'\n' || '  v_participantes integer := 0;');
  if novo = def then raise exception 'qf_desbloquear_chamado: declaração não encontrada'; end if;
  def := novo;
  novo := replace(def, $o$'participantes',1,'limite',1$o$, $n$'participantes',(select count(*)::integer from public.qf_desbloqueios x where x.chamado_id=p_chamado_id and coalesce(x.ativo,true)),'limite',3$n$);
  if novo = def then raise exception 'qf_desbloquear_chamado: retorno de participantes não encontrado'; end if;
  def := novo;
  novo := replace(def, 'Trava o chamado para garantir que só o primeiro profissional consiga reservar.', 'Trava o chamado para a contagem das vagas (até 3 profissionais) não passar do limite.');
  execute novo;

  -- 2. Fechei / Não fechei: resultado por profissional.
  def := pg_get_functiondef('public.qf_profissional_fechar_chamado(uuid, boolean)'::regprocedure);
  novo := replace(def, $o$  if v_status not in ('em_negociacao', 'confirmado', 'em_andamento') then$o$, $n$  if exists (
    select 1 from public.qf_desbloqueios d
    where d.chamado_id = p_chamado_id
      and d.profissional_id = v_prof
      and coalesce(d.ativo, true)
      and d.desfecho is not null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'Você já informou o resultado deste pedido.');
  end if;

  if v_status not in ('em_negociacao', 'confirmado', 'em_andamento') then$n$);
  if novo = def then raise exception 'qf_profissional_fechar_chamado: conferência de status não encontrada'; end if;
  def := novo;
  novo := regexp_replace(def, $o$update public\.qf_chamados\s+set status = 'concluido'$o$, $n$update public.qf_desbloqueios
       set desfecho = 'fechado', desfecho_em = now()
     where chamado_id = p_chamado_id and profissional_id = v_prof and coalesce(ativo, true);

    update public.qf_chamados
       set status = 'concluido'$n$);
  if novo = def then raise exception 'qf_profissional_fechar_chamado: trecho do "fechei" não encontrado'; end if;
  def := novo;
  novo := regexp_replace(def, $o$-- Não fechou: encerra o pedido\..*?return jsonb_build_object\('ok', true, 'status', 'cancelado', 'desfecho', 'nao_fechado'\);$o$, $n$-- Não fechou: vale só para este profissional. O desbloqueio continua registrado e o crédito não volta.
  update public.qf_desbloqueios
     set desfecho = 'nao_fechado', desfecho_em = now()
   where chamado_id = p_chamado_id and profissional_id = v_prof and coalesce(ativo, true);

  -- O pedido só é encerrado quando as 3 vagas foram usadas e ninguém mais está em conversa.
  if not exists (
       select 1 from public.qf_desbloqueios d
       where d.chamado_id = p_chamado_id and coalesce(d.ativo, true) and d.desfecho is null
     )
     and (
       select count(*) from public.qf_desbloqueios d
       where d.chamado_id = p_chamado_id and coalesce(d.ativo, true)
     ) >= 3 then
    update public.qf_chamados
       set status = 'cancelado', desfecho = 'nao_fechado', desfecho_em = now(), atualizado_em = now()
     where id = p_chamado_id;
    return jsonb_build_object('ok', true, 'status', 'cancelado', 'desfecho', 'nao_fechado', 'pedido_encerrado', true);
  end if;

  update public.qf_chamados set atualizado_em = now() where id = p_chamado_id;
  return jsonb_build_object('ok', true, 'status', 'cancelado', 'desfecho', 'nao_fechado', 'pedido_encerrado', false);$n$);
  if novo = def then raise exception 'qf_profissional_fechar_chamado: trecho do "não fechei" não encontrado'; end if;
  execute novo;

  -- 3. Fechamento automático em 7 dias: "não fechado" se todos responderam, "sem retorno" se alguém não respondeu.
  def := pg_get_functiondef('private.qf_fechar_sem_retorno()'::regprocedure);
  novo := replace(def, $o$desfecho = 'sem_retorno'$o$, $n$desfecho = case when exists (
           select 1 from public.qf_desbloqueios dp
           where dp.chamado_id = c.id and coalesce(dp.ativo, true) and dp.desfecho is null
         ) then 'sem_retorno' else 'nao_fechado' end$n$);
  if novo = def then raise exception 'qf_fechar_sem_retorno: trecho não encontrado'; end if;
  execute novo;

  -- 4. Lista "meus pedidos" do profissional: quem respondeu "Não fechei" vê o pedido como encerrado para ele.
  def := pg_get_functiondef('private.qf_prof_chamados_desbloqueados()'::regprocedure);
  novo := regexp_replace(def, $o$case\s+when c\.status in \('confirmado','em_andamento','concluido','finalizado'\)\s+and not$o$, $n$case
      when exists (
        select 1 from public.qf_desbloqueios dn
        where dn.chamado_id=c.id and dn.profissional_id=auth.uid() and dn.desfecho='nao_fechado'
      ) then 'cancelado'::text
      when c.status in ('confirmado','em_andamento','concluido','finalizado')
       and not$n$);
  if novo = def then raise exception 'qf_prof_chamados_desbloqueados: trecho não encontrado'; end if;
  execute novo;

  -- 5. Pedidos disponíveis: some da lista quando as 3 vagas são preenchidas (antes 5).
  def := pg_get_functiondef('public.qf_listar_chamados_disponiveis()'::regprocedure);
  novo := replace(def, ') < 5', ') < 3');
  if novo = def then raise exception 'qf_listar_chamados_disponiveis: limite não encontrado'; end if;
  execute novo;

  -- 6. Portfólio: continua mostrando o pedido enquanto houver vaga, com a contagem.
  def := pg_get_functiondef('public.qf_portfolio_servicos()'::regprocedure);
  novo := regexp_replace(def, $o$0::integer as participantes,\s+1::integer as limite$o$, $n$(select count(*)::integer from public.qf_desbloqueios x where x.chamado_id=d.id and coalesce(x.ativo,true)) as participantes,
    3::integer as limite$n$);
  if novo = def then raise exception 'qf_portfolio_servicos: contagem não encontrada'; end if;
  def := novo;
  novo := regexp_replace(def, $o$where not exists \(.*?\)\s+order by$o$, 'order by');
  if novo = def then raise exception 'qf_portfolio_servicos: filtro de reserva não encontrado'; end if;
  execute novo;

  -- 7. Contagem de participantes.
  def := pg_get_functiondef('public.qf_contagem_participantes(uuid)'::regprocedure);
  novo := replace(def, $o$'limite',1$o$, $n$'limite',3$n$);
  if novo = def then raise exception 'qf_contagem_participantes: limite não encontrado'; end if;
  execute novo;

  -- 8. Cascata de avisos: para de avisar quando as 3 vagas são preenchidas (antes 5).
  def := pg_get_functiondef('private.qf_cascata_tick()'::regprocedure);
  novo := replace(def, ')<5', ')<3');
  if novo = def then raise exception 'qf_cascata_tick: limite não encontrado'; end if;
  execute novo;

  def := pg_get_functiondef('private.qf_cascata_aceite()'::regprocedure);
  novo := replace(replace(def, 'v_participantes >= 5', 'v_participantes >= 3'), 'chegam 5 participantes', 'chegam 3 participantes');
  if novo = def then raise exception 'qf_cascata_aceite: limite não encontrado'; end if;
  execute novo;

  def := pg_get_functiondef('public.qf_chamado_alcance(uuid)'::regprocedure);
  novo := replace(def, $o$'limite_orcamentos',5$o$, $n$'limite_orcamentos',3$n$);
  if novo = def then raise exception 'qf_chamado_alcance: limite não encontrado'; end if;
  execute novo;

  -- 9. Painel: lista de desbloqueios de cada pedido.
  def := pg_get_functiondef('public.qf_admin_snapshot()'::regprocedure);
  if position($k$'desbloqueios', coalesce$k$ in def) = 0 then
    novo := replace(def, $o$'gerado_em', now(),$o$, $n$'gerado_em', now(),
    'desbloqueios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'chamado_id', d.chamado_id,
        'profissional_id', d.profissional_id,
        'valor_centavos', d.valor_centavos,
        'origem', d.origem,
        'ativo', coalesce(d.ativo, true),
        'desfecho', d.desfecho,
        'criado_em', d.criado_em
      ) order by d.criado_em)
      from public.qf_desbloqueios d
    ), '[]'::jsonb),$n$);
    if novo = def then raise exception 'qf_admin_snapshot: ponto de inserção não encontrado'; end if;
    execute novo;
  end if;
end
$mig$;
