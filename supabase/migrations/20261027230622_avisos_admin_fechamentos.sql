begin;
-- Uses the existing delivery queue; no balances, payments or customer outcomes are changed.
create or replace function private.qf13_avisar_admin(p_id uuid,p_evento text,p_titulo text)
returns void language sql security definer set search_path='' as $$
 insert into private.qf_comissao13_notificacoes(user_id,chave,titulo,corpo,rota)
 select a.user_id,'admin13:'||p_id||':'||p_evento,p_titulo,
 'Abra o painel para conferir o profissional, o cliente, os valores e o histórico.',
 '/admin.html#/admin/negociacoes'
 from public.qf_admins a
 on conflict(user_id,chave) do nothing
$$;
revoke all on function private.qf13_avisar_admin(uuid,text,text) from public,anon,authenticated;

create or replace function private.qf13_notificar_admin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='informado' and (tg_op='INSERT' or old.status is distinct from new.status) then
  perform private.qf13_avisar_admin(new.id,'informado','Profissional informou serviço fechado');
 end if;
 if new.contratado_em is not null and (tg_op='INSERT' or old.contratado_em is null) then
  perform private.qf13_avisar_admin(new.id,'contratado','Cliente confirmou a contratação');
 end if;
 if new.cliente_concluiu_em is not null and (tg_op='INSERT' or old.cliente_concluiu_em is null) then
  perform private.qf13_avisar_admin(new.id,'concluido','Cliente confirmou a conclusão');
 end if;
 if new.status='confirmado' and new.comissao_centavos>0 and new.cobranca_status='pendente'
  and (tg_op='INSERT' or old.status is distinct from new.status or old.comissao_centavos is distinct from new.comissao_centavos) then
  perform private.qf13_avisar_admin(new.id,'comissao','Comissão confirmada a receber');
 end if;
 if new.cobranca_status='paga' and (tg_op='INSERT' or old.cobranca_status is distinct from new.cobranca_status) then
  perform private.qf13_avisar_admin(new.id,'paga','Pagamento de comissão registrado — confira a conciliação');
 end if;
 if (new.status='contestado' or new.cliente_resposta in ('divergencia','nao_contratou'))
  and (tg_op='INSERT' or old.status is distinct from new.status or old.cliente_resposta is distinct from new.cliente_resposta) then
  perform private.qf13_avisar_admin(new.id,'contestado','Contestação de serviço para análise');
 end if;
 return new;
end $$;
revoke all on function private.qf13_notificar_admin() from public,anon,authenticated;
drop trigger if exists qf13_notificar_admin on public.qf_comissao13_fechamentos;
create trigger qf13_notificar_admin after insert or update on public.qf_comissao13_fechamentos
 for each row execute function private.qf13_notificar_admin();

create or replace function private.qf13_admin_prazos() returns void
language plpgsql security definer set search_path='' as $$
declare pending record;
begin
 for pending in select id from public.qf_comissao13_fechamentos
 where status='confirmado' and cobranca_status='pendente' and comissao_centavos>0 and comissao_vence_em<now() loop
  perform private.qf13_avisar_admin(pending.id,'vencida','Comissão confirmada vencida');
 end loop;
 for pending in select f.id from public.qf_comissao13_fechamentos f
 join public.qf_chamados c on c.id=f.chamado_id
 where f.status in ('pendente','negociando') and f.prestado_em is null and f.prazo_contas<now()
 and c.status not in ('cancelado','expirado') loop
  perform private.qf13_avisar_admin(pending.id,'prestacao_vencida','Prazo de prestação de contas vencido');
 end loop;
end $$;
revoke all on function private.qf13_admin_prazos() from public,anon,authenticated;
-- SCHEDULER
select cron.schedule('qf-admin-comissoes-prazos','*/5 * * * *','select private.qf13_admin_prazos()');
commit;
