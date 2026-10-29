create or replace function public.qf_comissao13_fechamentos_painel()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
 if auth.uid() is null then raise exception 'authentication required';end if;
 return coalesce((
 select jsonb_agg(x order by x.informado_em desc) from(
  select f.*,p.nome as profissional,cl.nome as cliente,
    case when private.qf_is_admin() then cl.telefone else null end as telefone,
    case when private.qf_is_admin() then cl.whatsapp else null end as whatsapp,c.titulo,
    (
      exists(select 1 from private.qf_livre_manual_config cfg where cfg.id and cfg.habilitado
       and cfg.ativado_em is not null and f.confirmado_em>=cfg.ativado_em)
      and exists(select 1 from public.qf_desbloqueios d
       where d.id=f.desbloqueio_id and d.origem='comissao13')
      and not exists(select 1 from public.qf_comissao13_pix pix where pix.fechamento_id=f.id)
    ) as pagamento_plataforma,
    exists(select 1 from public.qf_comissao13_pix pix where pix.fechamento_id=f.id
      and pix.status='pago' and pix.pago_em is not null and pix.end_to_end_id is not null)
    or exists(select 1 from private.qf_livre_split_pagamentos sp where sp.fechamento_id=f.id
      and sp.status='repassado' and sp.end_to_end_id is not null and sp.repassado_em is not null)
    or exists(select 1 from private.qf_livre_manual_pix mp where mp.fechamento_id=f.id
      and mp.status in ('pago','repassado') and mp.end_to_end_id is not null and mp.confirmado_em is not null)
    as pagamento_conciliado
  from public.qf_comissao13_fechamentos f
  join public.qf_chamados c on c.id=f.chamado_id
  join public.qf_profiles p on p.id=f.profissional_id
  join public.qf_profiles cl on cl.id=c.cliente_id
  where f.profissional_id=auth.uid() or private.qf_is_admin()
 ) x),'[]'::jsonb);
end $$;