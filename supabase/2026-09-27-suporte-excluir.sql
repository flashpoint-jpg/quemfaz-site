-- V11.11.4: admin pode excluir atendimentos do suporte (mensagens caem junto por ON DELETE CASCADE).
-- Já aplicado no projeto dczlyrgnzlxmzghzaooz.
create policy suporte_atendimentos_delete_admin on public.qf_suporte_atendimentos
  for delete to authenticated using (qf_private.is_admin());
grant delete on public.qf_suporte_atendimentos to authenticated;
