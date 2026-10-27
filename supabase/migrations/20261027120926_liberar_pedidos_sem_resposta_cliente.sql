begin;
-- A espera por resposta, aprovação ou prestação de contas não impede novos contatos.
-- A cobrança só mantém o bloqueio se já foi confirmada e venceu sem pagamento.
-- Os registros, prazos de acompanhamento e regras financeiras continuam intactos.
create or replace function private.qf13_bloqueio(p_prof uuid) returns text
language sql stable security definer set search_path='' as $$
 select case when exists (
   select 1 from public.qf_comissao13_fechamentos
   where profissional_id=p_prof and status='confirmado'
     and cobranca_status='pendente' and comissao_vence_em<=now()
 ) then 'comissao_pendente' else null end
$$;
revoke all on function private.qf13_bloqueio(uuid) from public,anon,authenticated;
commit;
