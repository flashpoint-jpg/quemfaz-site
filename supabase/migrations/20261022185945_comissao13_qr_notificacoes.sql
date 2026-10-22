-- QR de acordo na carteirinha e notificações. Nenhuma prontidão é ativada aqui.
create table if not exists private.qf_comissao13_links (
 id uuid primary key default gen_random_uuid(), acordo_id uuid not null references public.qf_comissao13_acordos(id),
 token_hash text not null unique, expira_em timestamptz not null, criado_em timestamptz not null default now()
);
create index if not exists qf13_links_acordo_idx on private.qf_comissao13_links(acordo_id,criado_em desc);
alter table private.qf_comissao13_links enable row level security;
revoke all on private.qf_comissao13_links from public,anon,authenticated;
create or replace function private.qf_comissao13_acordo_token(p_token text) returns uuid language sql stable security definer set search_path='' as $$
 select id from public.qf_comissao13_acordos where token_hash=md5(p_token) and token_expira_em>now()
 union all
 select acordo_id from private.qf_comissao13_links where token_hash=md5(p_token) and expira_em>now() limit 1
$$;
revoke all on function private.qf_comissao13_acordo_token(text) from public,anon,authenticated;
create or replace function public.qf_comissao13_gerar_link(p_acordo_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.qf_comissao13_acordos; t text:=gen_random_uuid()::text; cart uuid;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
 select * into a from public.qf_comissao13_acordos where id=p_acordo_id and profissional_id=auth.uid() for update;
 if not found or a.status not in ('proposto','contratado','concluido','pagamento_pendente') then return jsonb_build_object('ok',false,'reason','estado_invalido'); end if;
 select c.token into cart from public.qf_carteirinhas c join public.qf_profiles p on p.id=c.profissional_id where c.profissional_id=auth.uid() and p.ativo and p.tipo='profissional';
 if cart is null then return jsonb_build_object('ok',false,'reason','carteirinha_necessaria'); end if;
 if (select count(*) from private.qf_comissao13_links where acordo_id=a.id and criado_em>now()-interval '1 day')>=10 then return jsonb_build_object('ok',false,'reason','limite'); end if;
 insert into private.qf_comissao13_links(acordo_id,token_hash,expira_em) values(a.id,md5(t),now()+interval '1 day');
 return jsonb_build_object('ok',true,'token',t,'carteirinha_token',cart,'expira_em',now()+interval '1 day');
end $$;
revoke all on function public.qf_comissao13_gerar_link(uuid) from public,anon;
grant execute on function public.qf_comissao13_gerar_link(uuid) to authenticated;
-- Capacidade pública: precisa simultaneamente do token aleatório do acordo e da carteirinha correspondente.
create or replace function public.qf_comissao13_carteirinha_info(p_carteirinha uuid,p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.qf_comissao13_acordos;
begin
 select x.* into a from public.qf_comissao13_acordos x join public.qf_carteirinhas c on c.profissional_id=x.profissional_id join public.qf_profiles p on p.id=c.profissional_id
 where x.id=private.qf_comissao13_acordo_token(p_token) and c.token=p_carteirinha and p.ativo and x.status not in ('cancelado','contestado');
 if not found then return jsonb_build_object('ok',false,'reason','carteirinha_incompativel'); end if;
 return jsonb_build_object('ok',true,'acordo_id',a.id,'pedido',a.chamado_id,'valor_centavos',a.valor_centavos,'status',a.status);
end $$;
revoke all on function public.qf_comissao13_carteirinha_info(uuid,text) from public;
grant execute on function public.qf_comissao13_carteirinha_info(uuid,text) to anon,authenticated,service_role;

create table if not exists private.qf_comissao13_notificacoes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.qf_profiles(id),
 acordo_id uuid references public.qf_comissao13_acordos(id), chave text not null,
 titulo text not null, corpo text not null, rota text not null,
 status text not null default 'pendente' check(status in ('pendente','processando','aceito_provedor','falhou','sem_inscricao','fora_horario','fora_disponibilidade','incerto')),
 tentativas integer not null default 0, criado_em timestamptz not null default now(), tentativa_em timestamptz,
 aceito_provedor_em timestamptz, erro text, unique(user_id,chave)
);
create index if not exists qf13_notificacoes_pendentes_idx on private.qf_comissao13_notificacoes(status,tentativa_em);
alter table private.qf_comissao13_notificacoes enable row level security;
revoke all on private.qf_comissao13_notificacoes from public,anon,authenticated;
create or replace function private.qf_comissao13_despachar() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.qf_comissao13_pronto() then perform private.qf_push_interno('comissao13_queue',new.id); end if;
 return new;
end $$;
revoke all on function private.qf_comissao13_despachar() from public,anon,authenticated;
drop trigger if exists qf13_despachar on private.qf_comissao13_notificacoes;
create trigger qf13_despachar after insert on private.qf_comissao13_notificacoes for each row execute function private.qf_comissao13_despachar();
create or replace function private.qf_comissao13_enfileirar_evento() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.qf_comissao13_acordos; titulo text; corpo text;
begin
 select * into a from public.qf_comissao13_acordos where id=new.acordo_id;
 titulo:=case new.tipo when 'proposto' then 'Acordo aguardando confirmação' when 'contratado' then 'Cliente confirmou a contratação' when 'concluido' then 'Cliente confirmou a conclusão' when 'contestado' then 'Serviço contestado: revisão necessária' when 'pago' then 'Pagamento do serviço confirmado' when 'repassado' then 'Repasse do serviço concluído' when 'estornado' then 'Estorno do serviço confirmado' when 'chargeback' then 'Chargeback: revisão necessária' when 'disputa' then 'Disputa financeira: revisão necessária' else null end;
 if titulo is null then return new; end if;
 corpo:='Pedido '||left(a.chamado_id::text,8)||'. Confira os detalhes no Quem Faz.';
 insert into private.qf_comissao13_notificacoes(user_id,acordo_id,chave,titulo,corpo,rota)
 select a.profissional_id,a.id,new.id::text,titulo,corpo,'/#/profissional/pedido/'||a.chamado_id
 union all select ad.user_id,a.id,new.id::text,titulo,corpo,'/admin.html#/admin/dashboard' from public.qf_admins ad
 on conflict(user_id,chave) do nothing;
 return new;
end $$;
revoke all on function private.qf_comissao13_enfileirar_evento() from public,anon,authenticated;
drop trigger if exists qf13_enfileirar_evento on public.qf_comissao13_eventos;
create trigger qf13_enfileirar_evento after insert on public.qf_comissao13_eventos for each row execute function private.qf_comissao13_enfileirar_evento();
create or replace function public.qf_comissao13_notificacao_reservar(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare n private.qf_comissao13_notificacoes; pr public.qf_profissionais; momento time:=timezone('America/Sao_Paulo',now())::time;
begin
 if not private.qf_comissao13_pronto() then return jsonb_build_object('ok',false,'reason','integracao_pendente'); end if;
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
create or replace function public.qf_comissao13_notificacao_resultado(p_id uuid,p_status text,p_erro text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('aceito_provedor','falhou','sem_inscricao','fora_horario','incerto') then raise exception 'invalid status'; end if;
 update private.qf_comissao13_notificacoes set status=p_status,erro=left(p_erro,300),aceito_provedor_em=case when p_status='aceito_provedor' then now() else null end where id=p_id and status='processando';
end $$;
revoke all on function public.qf_comissao13_notificacao_reservar(uuid),public.qf_comissao13_notificacao_resultado(uuid,text,text) from public,anon,authenticated;
grant execute on function public.qf_comissao13_notificacao_reservar(uuid),public.qf_comissao13_notificacao_resultado(uuid,text,text) to service_role;
create or replace function public.qf_comissao13_anunciar() returns jsonb language plpgsql security definer set search_path='' as $$
declare total integer;
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin authentication required'; end if;
 if not private.qf_comissao13_pronto() then return jsonb_build_object('ok',false,'reason','integracao_pendente'); end if;
 insert into private.qf_comissao13_notificacoes(user_id,chave,titulo,corpo,rota)
 select p.id,'lancamento13-v1','Nova modalidade de desbloqueio','Agora você pode optar por desbloquear sem pagar antecipadamente, com comissão de 13% após o serviço. Confira os termos e tenha sua carteirinha digital no celular.','/#/profissional/servicos/disponiveis'
 from public.qf_profiles p join public.qf_profissionais pr on pr.user_id=p.id join public.qf_carteirinhas c on c.profissional_id=p.id
 where p.ativo and p.tipo='profissional' and cardinality(pr.especialidades)>0 and pr.raio_km>0
 on conflict(user_id,chave) do nothing;
 get diagnostics total=row_count;
 return jsonb_build_object('ok',true,'enfileirados',total,'entrega_confirmada',false);
end $$;
revoke all on function public.qf_comissao13_anunciar() from public,anon;
grant execute on function public.qf_comissao13_anunciar() to authenticated;
create or replace function private.qf_comissao13_reprocessar_notificacoes() returns void language plpgsql security definer set search_path='' as $$
declare n record;
begin
 if not private.qf_comissao13_pronto() then return; end if;
 -- Estado incerto após queda não é reenviado: evita disparos duplicados.
 update private.qf_comissao13_notificacoes set status='incerto',erro='Processamento interrompido; requer revisão.' where status='processando' and tentativa_em<now()-interval '10 minutes';
 for n in select id from private.qf_comissao13_notificacoes where status in ('pendente','fora_horario','fora_disponibilidade','sem_inscricao') and tentativas<3 and coalesce(tentativa_em,criado_em)<now()-interval '5 minutes' order by coalesce(tentativa_em,criado_em) limit 50 loop
  perform private.qf_push_interno('comissao13_queue',n.id);
 end loop;
end $$;
revoke all on function private.qf_comissao13_reprocessar_notificacoes() from public,anon,authenticated;
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  execute $cmd$select cron.schedule('qf-comissao13-notificacoes','*/5 * * * *','select private.qf_comissao13_reprocessar_notificacoes()')$cmd$;
 end if;
end $$;

-- Links adicionais não invalidam links já enviados ao cliente.
create or replace function public.qf_comissao13_cliente_info(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.qf_comissao13_acordos; nome text;
begin
 select * into a from public.qf_comissao13_acordos where id=private.qf_comissao13_acordo_token(p_token);
 if not found then return jsonb_build_object('ok',false,'reason','link_invalido'); end if;
 select p.nome into nome from public.qf_profiles p where p.id=a.profissional_id;
 return jsonb_build_object('ok',true,'acordo_id',a.id,'pedido',a.chamado_id,'profissional',nome,'profissional_id',a.profissional_id,'valor_centavos',a.valor_centavos,'agendado_em',a.agendado_em,'status',a.status,'telefone_final',right(a.telefone_vinculado,4));
end $$;
create or replace function public.qf_comissao13_codigo_criar(p_token text,p_finalidade text,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.qf_comissao13_acordos; k uuid;
begin
 select * into a from public.qf_comissao13_acordos where id=private.qf_comissao13_acordo_token(p_token) for update;
 if not found then return jsonb_build_object('ok',false,'reason','link_invalido'); end if;
 if not exists(select 1 from public.qf_chamados c join public.qf_desbloqueios d on d.chamado_id=c.id where c.id=a.chamado_id and d.id=a.desbloqueio_id and d.ativo and c.status not in ('cancelado','expirado','finalizado')) then return jsonb_build_object('ok',false,'reason','estado_invalido'); end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_finalidade is null or p_finalidade not in ('contratar','concluir','contestar') then return jsonb_build_object('ok',false,'reason','dados_invalidos'); end if;
 if (p_finalidade='contratar' and a.status<>'proposto') or (p_finalidade='concluir' and (a.status<>'contratado' or a.agendado_em>now())) or (p_finalidade='contestar' and a.status not in ('proposto','contratado','concluido','pagamento_pendente')) then return jsonb_build_object('ok',false,'reason','estado_invalido'); end if;
 if exists(select 1 from private.qf_comissao13_codigos where acordo_id=a.id and criado_em>now()-interval '60 seconds') or (select count(*) from private.qf_comissao13_codigos where acordo_id=a.id and criado_em>now()-interval '1 hour')>=5 or coalesce((select sum(tentativas) from private.qf_comissao13_codigos where acordo_id=a.id and criado_em>now()-interval '1 hour'),0)>=10 then return jsonb_build_object('ok',false,'reason','limite'); end if;
 update private.qf_comissao13_codigos set usado_em=now() where acordo_id=a.id and usado_em is null;
 insert into private.qf_comissao13_codigos(acordo_id,finalidade,hash,expira_em) values(a.id,p_finalidade,p_hash,now()+interval '5 minutes') returning id into k;
 return jsonb_build_object('ok',true,'codigo_id',k,'telefone',a.telefone_vinculado);
end $$;
create or replace function public.qf_comissao13_cliente_confirmar(p_token text,p_finalidade text,p_hash text,p_confirmar boolean,p_motivo text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.qf_comissao13_acordos; k private.qf_comissao13_codigos; s text;
begin
 -- Serializa a contratação de profissionais diferentes para o mesmo pedido.
 perform 1 from public.qf_chamados c join public.qf_comissao13_acordos x on x.chamado_id=c.id where x.id=private.qf_comissao13_acordo_token(p_token) for update of c;
 select * into a from public.qf_comissao13_acordos where id=private.qf_comissao13_acordo_token(p_token) for update;
 if not found then return jsonb_build_object('ok',false,'reason','link_invalido'); end if;
 if not exists(select 1 from public.qf_chamados c join public.qf_desbloqueios d on d.chamado_id=c.id where c.id=a.chamado_id and d.id=a.desbloqueio_id and d.ativo and c.status not in ('cancelado','expirado','finalizado')) then return jsonb_build_object('ok',false,'reason','estado_invalido'); end if;
 if p_finalidade='contratar' and exists(select 1 from public.qf_comissao13_acordos x where x.chamado_id=a.chamado_id and x.id<>a.id and x.status in ('contratado','concluido','pagamento_pendente','pago','repasse_pendente','repassado','contestado')) then return jsonb_build_object('ok',false,'reason','reservado'); end if;
 if p_confirmar is distinct from true then return jsonb_build_object('ok',false,'reason','confirmacao_obrigatoria'); end if;
 select * into k from private.qf_comissao13_codigos where acordo_id=a.id and finalidade=p_finalidade order by criado_em desc limit 1 for update;
 if not found or k.usado_em is not null or k.enviado_em is null or k.expira_em<=now() or k.tentativas>=5 then return jsonb_build_object('ok',false,'reason','codigo_invalido'); end if;
 update private.qf_comissao13_codigos set tentativas=tentativas+1 where id=k.id;
 if p_hash is null or p_hash<>k.hash then return jsonb_build_object('ok',false,'reason','codigo_invalido'); end if;
 if p_finalidade='contratar' and a.status='proposto' then s:='contratado';
 elsif p_finalidade='concluir' and a.status='contratado' and a.agendado_em<=now() then s:='concluido';
 elsif p_finalidade='contestar' and a.status in ('proposto','contratado','concluido','pagamento_pendente') and length(trim(coalesce(p_motivo,'')))>=8 then s:='contestado';
 else return jsonb_build_object('ok',false,'reason','estado_invalido'); end if;
 update private.qf_comissao13_codigos set usado_em=now() where id=k.id;
 update public.qf_comissao13_acordos set status=s,telefone_verificado_em=now(),contratado_em=case when s='contratado' then now() else contratado_em end,concluido_em=case when s='concluido' then now() else concluido_em end,contestacao=case when s='contestado' then left(p_motivo,2000) else contestacao end where id=a.id;
 insert into public.qf_comissao13_eventos(acordo_id,tipo,idempotency_key,dados) values(a.id,s,a.id||':'||s,jsonb_build_object('verificacao','telefone_otp','codigo_id',k.id));
 return jsonb_build_object('ok',true,'status',s,'pagamento_disponivel',false);
end $$;
create or replace function public.qf_comissao13_notificacoes_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin authentication required'; end if;
 return jsonb_build_object('ativo',private.qf_comissao13_pronto(),'resumo',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from private.qf_comissao13_notificacoes group by status) x),'{}'::jsonb),'entrega_confirmada',false);
end $$;
revoke all on function public.qf_comissao13_notificacoes_status() from public,anon;
grant execute on function public.qf_comissao13_notificacoes_status() to authenticated;
