-- Quem Faz Livre: manter direito ao recebimento mesmo se a assinatura vencer após o desbloqueio.
-- Só entra na modalidade quem desbloqueou com origem='comissao13'.
create or replace function public.qf_livre_split_preparar(
 p_chamado_id uuid,p_segredo text,p_fechamento_id uuid
) returns jsonb language plpgsql security definer set search_path to ''
as $$
declare f public.qf_comissao13_fechamentos; r private.qf_livre_split_recebedores;
        b private.qf_livre_split_pagamentos; v_id uuid;
begin
 if not exists(select 1 from private.qf_livre_split_config where id and habilitado and homologado)
 then return jsonb_build_object('ok',false,'reason','split_em_preparacao'); end if;
 if p_segredo is null or p_segredo !~ '^[a-f0-9]{64}$'
 then return jsonb_build_object('ok',false,'reason','acesso_invalido'); end if;
 perform 1 from public.qf_chamados c join private.qf13_codigos_pedido k on k.chamado_id=c.id
 where c.id=p_chamado_id and c.status not in ('cancelado','expirado')
   and k.proprietario_hash=encode(extensions.digest(p_segredo,'sha256'),'hex') for update of c;
 if not found then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 select * into f from public.qf_comissao13_fechamentos where id=p_fechamento_id and chamado_id=p_chamado_id for update;
 if not found or f.status<>'confirmado' or f.codigo_validado_em is null or f.cliente_concluiu_em is null
   or f.cliente_resposta<>'confirmado' or f.valor_confirmado_centavos is null
 then return jsonb_build_object('ok',false,'reason','conclusao_nao_confirmada');end if;
 if exists(select 1 from public.qf_comissao13_pix where fechamento_id=f.id)
 then return jsonb_build_object('ok',false,'reason','cobranca_antiga_existente');end if;
 if not exists(select 1 from public.qf_desbloqueios d where d.id=f.desbloqueio_id and d.profissional_id=f.profissional_id and d.origem='comissao13')
 then return jsonb_build_object('ok',false,'reason','plano_livre_inativo');end if;
 select * into r from private.qf_livre_split_recebedores where profissional_id=f.profissional_id
  and status='validado' and validado_em is not null for share;
 if not found or r.conta_efi !~ '^[0-9]{1,20}$' or length(r.documento) not in(11,14)
 then return jsonb_build_object('ok',false,'reason','conta_efi_pendente');end if;
 insert into private.qf_livre_split_pagamentos(
  fechamento_id,chamado_id,profissional_id,txid,split_id,valor_centavos,
  profissional_centavos,plataforma_centavos,conta_efi,documento)
 values (
  f.id,f.chamado_id,f.profissional_id,
  replace(gen_random_uuid()::text,'-',''),
  replace(gen_random_uuid()::text,'-',''),
  f.valor_confirmado_centavos,
  f.valor_confirmado_centavos-round(f.valor_confirmado_centavos*0.13)::bigint,
  round(f.valor_confirmado_centavos*0.13)::bigint,r.conta_efi,r.documento)
 on conflict(fechamento_id) do nothing;
 select * into b from private.qf_livre_split_pagamentos where fechamento_id=f.id;
 if b.status in ('cancelado','erro_revisao') then return jsonb_build_object('ok',false,'reason','pagamento_em_analise');end if;
 return jsonb_build_object('ok',true,'id',b.id,'valor_centavos',b.valor_centavos,
  'profissional_centavos',b.profissional_centavos,'plataforma_centavos',b.plataforma_centavos,
  'status',b.status);
end $$;


create or replace function private.qf_comissao13_automatico()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
 if new.status='confirmado' and new.cobranca_status='pendente' and new.comissao_centavos>0 then
  if exists(select 1 from private.qf_livre_split_config where id and habilitado and homologado)
   and exists(select 1 from private.qf_livre_split_recebedores
     where profissional_id=new.profissional_id and status='validado' and validado_em is not null)
   and exists(select 1 from public.qf_desbloqueios d where d.id=new.desbloqueio_id and d.profissional_id=new.profissional_id and d.origem='comissao13')
  then
   update public.qf_comissao13_fechamentos set comissao_vence_em=null
     where id=new.id and comissao_vence_em is not null;
   return null;
  end if;
  insert into public.qf_comissao13_pix (fechamento_id,profissional_id,valor_centavos)
    values (new.id,new.profissional_id,new.comissao_centavos) on conflict(fechamento_id) do nothing;
 end if;
 return null;
end $$;
