-- Declaração independente de contratação pelo dono do pedido.
-- Não cria cobrança nem liquidação automática: divergência exige revisão do administrador.
create or replace function public.qf13_cliente_informar_fechamento(
  p_chamado_id uuid,
  p_segredo text,
  p_fechamento uuid,
  p_valor_centavos bigint
) returns jsonb
language plpgsql security definer set search_path to ''
as $qf$
declare
  v_f public.qf_comissao13_fechamentos;
  v_pedido uuid;
begin
  if p_segredo is null or p_segredo !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok',false,'reason','acesso_invalido');
  end if;
  if p_valor_centavos is null or p_valor_centavos not between 100 and 100000000 then
    return jsonb_build_object('ok',false,'reason','valor_invalido');
  end if;

  -- Acesso por segredo de 256 bits do pedido (mesma prova usada no acompanhamento).
  select c.id into v_pedido
    from public.qf_chamados c
    join private.qf13_codigos_pedido k on k.chamado_id=c.id
   where c.id=p_chamado_id
     and k.proprietario_hash=encode(extensions.digest(p_segredo,'sha256'),'hex')
     and c.status not in ('cancelado','expirado')
   for update of c;
  if v_pedido is null then return jsonb_build_object('ok',false,'reason','acesso_invalido'); end if;

  select f.* into v_f
    from public.qf_comissao13_fechamentos f
    join public.qf_desbloqueios d on d.id=f.desbloqueio_id
   where f.id=p_fechamento and f.chamado_id=p_chamado_id
     and d.chamado_id=p_chamado_id and d.profissional_id=f.profissional_id
     and d.origem='comissao13' and coalesce(d.ativo,true)
   for update of f;
  if not found then return jsonb_build_object('ok',false,'reason','fechamento_indisponivel'); end if;

  if v_f.status='contestado' and v_f.cliente_resposta='divergencia'
     and v_f.contratado_em is not null and v_f.valor_aceito_centavos=p_valor_centavos then
    return jsonb_build_object('ok',true,'status','contestado','revisao_admin',true,'comissao_devida',false,'duplicado',true);
  end if;
  if v_f.status not in ('pendente','negociando','recusado')
     or v_f.cobranca_status<>'nao_gerada'
     or v_f.cliente_resposta is not null then
    return jsonb_build_object('ok',false,'reason','ja_declarado');
  end if;
  if exists (
    select 1 from public.qf_comissao13_fechamentos x
    where x.chamado_id=v_f.chamado_id and x.id<>v_f.id
      and (x.status='confirmado' or x.cliente_resposta='confirmado' or x.contratado_em is not null)
  ) then return jsonb_build_object('ok',false,'reason','outro_profissional_contratado'); end if;

  update public.qf_comissao13_fechamentos
     set status='contestado',
         cliente_resposta='divergencia',
         cliente_respondeu_em=now(),
         contratado_em=now(),
         valor_aceito_centavos=p_valor_centavos,
         comissao_centavos=null,
         comissao_vence_em=null,
         cobranca_status='nao_gerada',
         observacao_admin='Declaração independente do cliente: informou contratação antes da confirmação do profissional; revisar as evidências e o valor.'
   where id=v_f.id;

  -- O gatilho qf13_notificar_admin já avisa sobre divergências e contratação.
  -- Nenhuma cobrança ou registro de pagamento pode nascer desta função.
  return jsonb_build_object('ok',true,'status','contestado','revisao_admin',true,'comissao_devida',false);
end
$qf$;

revoke all on function public.qf13_cliente_informar_fechamento(uuid,text,uuid,bigint) from public, anon;
grant execute on function public.qf13_cliente_informar_fechamento(uuid,text,uuid,bigint) to anon, authenticated;

-- Somente Pix liquidado com end-to-end-id torna o valor RECEBIDO no painel.
create or replace function public.qf_comissao13_fechamentos_painel()
returns jsonb language plpgsql stable security definer set search_path to ''
as $qf$
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
          ) as pagamento_conciliado
        from public.qf_comissao13_fechamentos f
        join public.qf_chamados c on c.id=f.chamado_id
        join public.qf_profiles p on p.id=f.profissional_id
        join public.qf_profiles cl on cl.id=c.cliente_id
        where f.profissional_id=auth.uid() or private.qf_is_admin()
      ) x
    ),'[]'::jsonb);
end
$qf$;