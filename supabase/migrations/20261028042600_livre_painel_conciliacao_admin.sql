-- Reconhecer como receita conciliada somente Pix/repasse de banco confirmado.
CREATE OR REPLACE FUNCTION public.qf_comissao13_fechamentos_painel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  return coalesce((
    select jsonb_agg(x order by x.informado_em desc)
      from (
        select f.*,p.nome as profissional,cl.nome as cliente,
          case when private.qf_is_admin() then cl.telefone else null end as telefone,
          case when private.qf_is_admin() then cl.whatsapp else null end as whatsapp,
          c.titulo,
          exists(
            select 1 from public.qf_comissao13_pix pix
             where pix.fechamento_id=f.id
               and pix.status='pago'
               and pix.pago_em is not null
               and pix.end_to_end_id is not null
          ) or exists(select 1 from private.qf_livre_split_pagamentos sp where sp.fechamento_id=f.id and sp.status='repassado' and sp.end_to_end_id is not null and sp.repassado_em is not null) as pagamento_conciliado
        from public.qf_comissao13_fechamentos f
        join public.qf_chamados c on c.id=f.chamado_id
        join public.qf_profiles p on p.id=f.profissional_id
        join public.qf_profiles cl on cl.id=c.cliente_id
        where f.profissional_id=auth.uid() or private.qf_is_admin()
      ) x
    ),'[]'::jsonb);
end
$function$
;
CREATE OR REPLACE FUNCTION private.qf_admin_negociacoes_dados()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.ultima_atividade desc),'[]'::jsonb) from (
 select d.id as desbloqueio_id,d.chamado_id,d.profissional_id,d.origem,d.ativo,d.criado_em as desbloqueado_em,
 p.nome as profissional,cl.nome as cliente,c.cliente_id,c.titulo,c.categoria,c.descricao,c.cidade,c.bairro,c.status as pedido_status,
 f.id as fechamento_id,f.status,f.valor_informado_centavos,f.valor_aceito_centavos,f.valor_confirmado_centavos,
 f.contratado_em,f.cliente_resposta,f.cliente_respondeu_em,f.cliente_concluiu_em,f.confirmado_em,f.confirmado_por,
 f.cobranca_status,f.comissao_centavos,f.comissao_vence_em,f.comissao_paga_em,f.prazo_contas,f.proposta_chat_em,
 f.codigo_validado_em,(exists(select 1 from public.qf_comissao13_pix px where px.fechamento_id=f.id and px.pago_em is not null and px.end_to_end_id is not null)  or exists(select 1 from private.qf_livre_split_pagamentos sp where sp.fechamento_id=f.id and sp.status='repassado' and sp.end_to_end_id is not null and sp.repassado_em is not null)) as pagamento_conciliado,private.qf13_bloqueio(d.profissional_id) as restricao_profissional,
 (select jsonb_build_object('id',m.id,'mensagem',m.mensagem,'remetente_id',m.remetente_id,'remetente',s.nome,'criado_em',m.criado_em,'lida_em',m.lida_em)
  from public.qf_chat_mensagens m left join public.qf_profiles s on s.id=m.remetente_id
  where m.chamado_id=d.chamado_id and m.profissional_id=d.profissional_id order by m.criado_em desc,m.id desc limit 1) as ultima_mensagem,
 (select count(*) from public.qf_chat_mensagens m where m.chamado_id=d.chamado_id and m.profissional_id=d.profissional_id and m.remetente_id=c.cliente_id) as mensagens_cliente,
 coalesce((select max(m.criado_em) from public.qf_chat_mensagens m where m.chamado_id=d.chamado_id and m.profissional_id=d.profissional_id),f.informado_em,d.criado_em) as ultima_atividade
 from public.qf_desbloqueios d join public.qf_chamados c on c.id=d.chamado_id
 left join public.qf_profiles p on p.id=d.profissional_id left join public.qf_profiles cl on cl.id=c.cliente_id
 left join public.qf_comissao13_fechamentos f on f.desbloqueio_id=d.id
 ) x
$function$
;

-- Somente administrador pode revisar cadastros bancários do Livre.
create or replace function public.qf_livre_split_contas_admin()
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
begin
 if auth.uid() is null or not private.qf_is_admin() then
  raise exception 'admin authentication required' using errcode='42501';
 end if;
 return coalesce((select jsonb_agg(x order by x.atualizado_em desc) from
  (select r.profissional_id,p.nome as profissional,r.chave_pix,r.conta_efi,
   r.documento,r.status,r.atualizado_em,r.validado_em,r.evidencia
   from private.qf_livre_split_recebedores r
   join public.qf_profiles p on p.id=r.profissional_id) x),'[]'::jsonb);
end $$;
revoke all on function public.qf_livre_split_contas_admin() from public,anon;
grant execute on function public.qf_livre_split_contas_admin() to authenticated;
