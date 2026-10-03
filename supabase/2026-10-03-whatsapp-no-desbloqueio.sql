-- QuemFaz V11.20.0 — WhatsApp do cliente liberado ao profissional já no desbloqueio.
-- Antes: telefone/WhatsApp só apareciam depois que o cliente aceitava a proposta.
-- Agora: quem desbloqueou recebe o WhatsApp enquanto a negociação está aberta
-- (status em_negociacao), para chamar o cliente direto. Endereço exato, coordenadas
-- e contatos escritos na descrição continuam protegidos até o cliente escolher.
-- Para voltar atrás: reaplicar a versão anterior (2026-10-01-chat-portfolio-programados.sql).
create or replace function private.qf_prof_chamados_desbloqueados()
 returns table(id uuid, cliente_id uuid, categoria text, titulo text, descricao text, cidade text, uf character, bairro text, endereco_completo text, latitude numeric, longitude numeric, data_preferida timestamp with time zone, status text, prioridade boolean, prioridade_ate timestamp with time zone, criado_em timestamp with time zone, atualizado_em timestamp with time zone, cliente_nome text, cliente_telefone text, cliente_whatsapp text)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select
    c.id,
    c.cliente_id,
    c.categoria,
    c.titulo,
    case
      when private.qf_prof_has_accepted_quote(c.id,auth.uid()) then c.descricao
      else public.qf_ocultar_contato(c.descricao)
    end,
    c.cidade,
    c.uf,
    c.bairro,
    case when private.qf_prof_has_accepted_quote(c.id,auth.uid()) then c.endereco_completo else null::text end,
    case when private.qf_prof_has_accepted_quote(c.id,auth.uid()) then c.latitude else round(c.latitude,2) end,
    case when private.qf_prof_has_accepted_quote(c.id,auth.uid()) then c.longitude else round(c.longitude,2) end,
    c.data_preferida,
    case
      when c.status in ('confirmado','em_andamento','concluido','finalizado')
       and not private.qf_prof_has_accepted_quote(c.id,auth.uid())
      then 'nao_selecionado'::text
      else c.status
    end,
    c.prioridade,
    c.prioridade_ate,
    c.criado_em,
    c.atualizado_em,
    p.nome,
    case when c.status='em_negociacao' or private.qf_prof_has_accepted_quote(c.id,auth.uid()) then p.telefone else null::text end,
    case when c.status='em_negociacao' or private.qf_prof_has_accepted_quote(c.id,auth.uid()) then p.whatsapp else null::text end
  from public.qf_chamados c
  join public.qf_profiles p on p.id=c.cliente_id
  where exists (
    select 1 from public.qf_desbloqueios d
    where d.chamado_id=c.id
      and d.profissional_id=auth.uid()
      and d.ativo=true
  );
$function$;
