CREATE OR REPLACE FUNCTION public.qf_livre_manual_pix_preparar(p_chamado_id uuid, p_segredo text, p_fechamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f public.qf_comissao13_fechamentos; v private.qf_livre_manual_pix; t timestamptz;
begin
 select ativado_em into t from private.qf_livre_manual_config where id and habilitado;
 if t is null then return jsonb_build_object('ok',false,'reason','pagamento_em_preparacao');end if;
 if p_segredo is null or p_segredo!~'^[a-f0-9]{64}$'
    or not exists(select 1 from private.qf13_codigos_pedido k where k.chamado_id=p_chamado_id
     and k.proprietario_hash=encode(extensions.digest(p_segredo,'sha256'),'hex'))
 then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 perform 1 from public.qf_chamados where id=p_chamado_id and status not in ('cancelado','expirado') for update;
 if not found then return jsonb_build_object('ok',false,'reason','pedido_encerrado');end if;
 select * into f from public.qf_comissao13_fechamentos where id=p_fechamento_id and chamado_id=p_chamado_id for update;
 if not found or f.status<>'confirmado' or f.cliente_resposta<>'confirmado'
   or f.confirmado_em is null or f.confirmado_em<t or f.cliente_concluiu_em is null or f.codigo_validado_em is null
   or f.valor_confirmado_centavos is null or f.valor_confirmado_centavos<100
 then return jsonb_build_object('ok',false,'reason','conclusao_nao_confirmada');end if;
 if not exists(select 1 from public.qf_desbloqueios d where d.id=f.desbloqueio_id and d.profissional_id=f.profissional_id and d.origem='comissao13')
 then return jsonb_build_object('ok',false,'reason','modalidade_incorreta');end if;
 if exists(select 1 from public.qf_comissao13_pix where fechamento_id=f.id)
   or exists(select 1 from private.qf_livre_split_pagamentos where fechamento_id=f.id)
 then return jsonb_build_object('ok',false,'reason','cobranca_antiga_existente');end if;
 insert into private.qf_livre_manual_pix(fechamento_id,chamado_id,profissional_id,valor_centavos,comissao_centavos,profissional_centavos)
 values(f.id,f.chamado_id,f.profissional_id,f.valor_confirmado_centavos,round(f.valor_confirmado_centavos*0.13)::bigint,
  f.valor_confirmado_centavos-round(f.valor_confirmado_centavos*0.13)::bigint)
 on conflict(fechamento_id) do nothing;
 select * into v from private.qf_livre_manual_pix where fechamento_id=f.id for update;
 if v.status='bloqueado' then return jsonb_build_object('ok',false,'reason','pagamento_em_analise');end if;
 return jsonb_build_object('ok',true,'id',v.id,'status',v.status,'valor_centavos',v.valor_centavos);
end $function$
