-- Reutiliza fila e remetente push existentes; prontidão financeira antiga continua falsa.
create or replace function private.qf13_simplificado_ativo() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select ativo from private.qf_comissao13_config where id),false) $$;
revoke all on function private.qf13_simplificado_ativo() from public,anon,authenticated;

create or replace function private.qf_comissao13_despachar() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.qf13_simplificado_ativo() then perform private.qf_push_interno('comissao13_queue',new.id); end if;
 return new;
end $$;

create or replace function public.qf_comissao13_notificacao_reservar(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare n private.qf_comissao13_notificacoes; pr public.qf_profissionais; momento time:=timezone('America/Sao_Paulo',now())::time;
begin
 if not private.qf13_simplificado_ativo() then return jsonb_build_object('ok',false,'reason','integracao_pendente'); end if;
 select * into n from private.qf_comissao13_notificacoes where id=p_id for update;
 if not found or n.status not in ('pendente','fora_horario','fora_disponibilidade','sem_inscricao') or n.tentativas>=3 then return jsonb_build_object('ok',false,'reason','ja_processado'); end if;
 if not exists(select 1 from public.qf_profiles where id=n.user_id and ativo) then update private.qf_comissao13_notificacoes set status='falhou',erro='perfil_inativo',tentativa_em=now() where id=p_id; return jsonb_build_object('ok',false,'reason','perfil_inativo'); end if;
 select * into pr from public.qf_profissionais where user_id=n.user_id;
 if found then
  if pr.online is not true then update private.qf_comissao13_notificacoes set status='fora_disponibilidade',tentativa_em=now() where id=p_id; return jsonb_build_object('ok',false,'reason','fora_disponibilidade'); end if;
  if pr.horario_inicio is not null and pr.horario_fim is not null and pr.horario_inicio<>pr.horario_fim and not (case when pr.horario_inicio<pr.horario_fim then momento>=pr.horario_inicio and momento<pr.horario_fim else momento>=pr.horario_inicio or momento<pr.horario_fim end) then
   update private.qf_comissao13_notificacoes set status='fora_horario',tentativa_em=now() where id=p_id; return jsonb_build_object('ok',false,'reason','fora_horario'); end if;
 end if;
 update private.qf_comissao13_notificacoes set status='processando',tentativas=tentativas+1,tentativa_em=now() where id=p_id;
 return jsonb_build_object('ok',true,'id',n.id,'user_id',n.user_id,'titulo',n.titulo,'corpo',n.corpo,'rota',n.rota,'alerta',coalesce(pr.alerta_modo,'silencioso'));
end $$;

create or replace function public.qf_comissao13_anunciar() returns jsonb language plpgsql security definer set search_path='' as $$
declare total integer;
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin authentication required'; end if;
 if not private.qf13_simplificado_ativo() then return jsonb_build_object('ok',false,'reason','integracao_pendente'); end if;
 insert into private.qf_comissao13_notificacoes(user_id,chave,titulo,corpo,rota)
 select p.id,'lancamento13-simplificado-v3','Novidade no Quem Faz!','Agora você pode desbloquear pedidos grátis! Só paga 13% se fechar o serviço. Confira os pedidos disponíveis.','/#/profissional/servicos/disponiveis'
 from public.qf_profiles p join public.qf_profissionais pr on pr.user_id=p.id
 where p.ativo and p.tipo='profissional' and cardinality(pr.especialidades)>0 and pr.raio_km>0
 on conflict(user_id,chave) do nothing;
 get diagnostics total=row_count;
 return jsonb_build_object('ok',true,'enfileirados',total,'entrega_confirmada',false);
end $$;

create or replace function private.qf_comissao13_reprocessar_notificacoes() returns void language plpgsql security definer set search_path='' as $$
declare n record;
begin
 if not private.qf13_simplificado_ativo() then return; end if;
 -- Estado incerto após queda não é reenviado: evita disparos duplicados.
 update private.qf_comissao13_notificacoes set status='incerto',erro='Processamento interrompido; requer revisão.' where status='processando' and tentativa_em<now()-interval '10 minutes';
 for n in select id from private.qf_comissao13_notificacoes where status in ('pendente','fora_horario','fora_disponibilidade','sem_inscricao') and tentativas<3 and coalesce(tentativa_em,criado_em)<now()-interval '5 minutes' order by coalesce(tentativa_em,criado_em) limit 50 loop
  perform private.qf_push_interno('comissao13_queue',n.id);
 end loop;
end $$;

create or replace function public.qf_comissao13_notificacoes_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin authentication required'; end if;
 return jsonb_build_object('ativo',private.qf13_simplificado_ativo(),'resumo',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from private.qf_comissao13_notificacoes group by status) x),'{}'::jsonb),'entrega_confirmada',false);
end $$;
