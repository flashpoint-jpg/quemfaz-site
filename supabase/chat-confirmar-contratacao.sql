-- Registro explícito pelo dono do pedido; não altera carteiras, planos ou comissões.
create table if not exists private.qf_chat_contratacoes (
 chamado_id uuid primary key references public.qf_chamados(id),
 profissional_id uuid not null references public.qf_profiles(id),
 cliente_id uuid not null references public.qf_profiles(id),
 confirmado_em timestamptz not null default now()
);
alter table private.qf_chat_contratacoes enable row level security;
revoke all on private.qf_chat_contratacoes from public, anon, authenticated;
create or replace function private.qf_chat_confirmar_contratacao(p_chamado_id uuid,p_profissional_id uuid,p_confirmar boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.qf_chamados; v_uid uuid:=auth.uid(); v_escolhido uuid; v_ativo boolean; v_nome text;
begin
 if v_uid is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 select * into c from public.qf_chamados where id=p_chamado_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','pedido_indisponivel');end if;
 select exists(select 1 from public.qf_desbloqueios d where d.chamado_id=c.id and d.profissional_id=p_profissional_id and coalesce(d.ativo,true)) into v_ativo;
 if not v_ativo or (v_uid<>c.cliente_id and v_uid<>p_profissional_id) then return jsonb_build_object('ok',false,'reason','sem_permissao');end if;
 select profissional_id into v_escolhido from private.qf_chat_contratacoes where chamado_id=c.id;
 if v_escolhido is null then select profissional_id into v_escolhido from public.qf_orcamentos where chamado_id=c.id and status='aceito' limit 1;end if;
 if v_escolhido is null then select profissional_id into v_escolhido from public.qf_comissao13_fechamentos where chamado_id=c.id and (contratado_em is not null or status='confirmado' or cliente_resposta='confirmado') order by contratado_em nulls last limit 1;end if;
 select nome into v_nome from public.qf_profiles where id=p_profissional_id;
 if p_confirmar then
  if v_uid<>c.cliente_id then return jsonb_build_object('ok',false,'reason','somente_cliente');end if;
  if v_escolhido is not null and v_escolhido<>p_profissional_id then return jsonb_build_object('ok',false,'reason','outro_profissional_contratado');end if;
  if exists(select 1 from private.qf_chat_contratacoes where chamado_id=c.id and profissional_id=p_profissional_id) then return jsonb_build_object('ok',true,'contratado',true,'encerrado',true,'pode_contratar',false,'profissional_nome',v_nome);end if;
  if c.status not in ('aberto','em_negociacao') then return jsonb_build_object('ok',false,'reason','pedido_encerrado');end if;
  insert into private.qf_chat_contratacoes(chamado_id,profissional_id,cliente_id) values(c.id,p_profissional_id,c.cliente_id);
  update public.qf_chamados set status='confirmado',atualizado_em=now() where id=c.id;
  update public.qf_orcamentos set status=case when profissional_id=p_profissional_id then 'aceito' else 'nao_selecionado' end,atualizado_em=now() where chamado_id=c.id and status='enviado';
  insert into public.qf_chat_mensagens(chamado_id,profissional_id,remetente_id,mensagem,tipo)
  select c.id,d.profissional_id,v_uid,case when d.profissional_id=p_profissional_id then 'Cliente confirmou a contratação neste chat. O pedido não aceita novos desbloqueios. Isto não confirma conclusão nem pagamento.' else 'O cliente já contratou outro profissional. Este pedido não aceita novos desbloqueios.' end,'sistema'
  from public.qf_desbloqueios d where d.chamado_id=c.id and coalesce(d.ativo,true);
  return jsonb_build_object('ok',true,'contratado',true,'encerrado',true,'pode_contratar',false,'profissional_nome',v_nome);
 end if;
 return jsonb_build_object('ok',true,'contratado',v_escolhido=p_profissional_id,'encerrado',v_escolhido is not null or c.status not in ('aberto','em_negociacao'),'pode_contratar',v_uid=c.cliente_id and v_escolhido is null and c.status in ('aberto','em_negociacao'),'profissional_nome',v_nome);
end $$;
revoke all on function private.qf_chat_confirmar_contratacao(uuid,uuid,boolean) from public,anon;
grant execute on function private.qf_chat_confirmar_contratacao(uuid,uuid,boolean) to authenticated;
create or replace function public.qf_chat_confirmar_contratacao(p_chamado_id uuid,p_profissional_id uuid,p_confirmar boolean default false)
returns jsonb language sql security invoker set search_path='' as $$select private.qf_chat_confirmar_contratacao(p_chamado_id,p_profissional_id,p_confirmar)$$;
revoke all on function public.qf_chat_confirmar_contratacao(uuid,uuid,boolean) from public,anon;
grant execute on function public.qf_chat_confirmar_contratacao(uuid,uuid,boolean) to authenticated;
-- Defesa para tela antiga ou outro fluxo de desbloqueio. Qualquer débito anterior
-- na mesma transação também será revertido se a inserção for recusada.
create or replace function private.qf_chat_bloquear_novo_desbloqueio() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.qf_chamados where id=new.chamado_id for update;
 if exists(select 1 from private.qf_chat_contratacoes where chamado_id=new.chamado_id) then
  raise exception 'Cliente já contratou um profissional. Este pedido não aceita novos desbloqueios.' using errcode='P0001';
 end if;
 return new;
end $$;
revoke all on function private.qf_chat_bloquear_novo_desbloqueio() from public,anon,authenticated;
create trigger qf_chat_bloquear_novo_desbloqueio before insert on public.qf_desbloqueios for each row execute function private.qf_chat_bloquear_novo_desbloqueio();
