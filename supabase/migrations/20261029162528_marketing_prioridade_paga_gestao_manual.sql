-- Prioridade por pagamento, independente de origem/link e de integração Meta.
alter table private.qf_md_campanhas add column ultima_oferta_em timestamptz;
alter table private.qf_md_campanhas add column trecho_inicio_em timestamptz;
create index qf_md_campanhas_distribuicao on private.qf_md_campanhas(ultima_oferta_em,id) where status='ativa' and pagamento_status='conciliado';
update private.qf_md_config set entrega_validada=true,observacao='Anúncios gerenciados manualmente pelo Quem Faz. Prioridade para pedidos compatíveis, sem exigir link do anúncio.',atualizado_em=now() where id;

create or replace function private.qf_md_atribuir() returns trigger language plpgsql security definer set search_path='' as $$
declare c private.qf_md_campanhas;
begin
 -- Serializa somente a seleção/registro de ofertas; dois pedidos simultâneos não escolhem a mesma vez.
 perform 1 from private.qf_md_config where id for update;
 select m.* into c from private.qf_md_campanhas m
 join public.qf_profissionais pr on pr.user_id=m.profissional_id
 join public.qf_profiles u on u.id=pr.user_id
 where m.status='ativa' and m.pagamento_status='conciliado' and m.inicio_em<=now() and m.fim_em>now()
 and private.qf_md_livre_pago(m.profissional_id)
 and coalesce(u.ativo,true) and pr.online and not coalesce(pr.offline_manual,false)
 and private.qf_dentro_horario(pr.horario_inicio,pr.horario_fim)
 and private.qf_pro_recebe_chamado(m.profissional_id,new.id)
 order by m.ultima_oferta_em nulls first,m.id limit 1 for update of m;
 if not found then return new;end if;
 insert into private.qf_md_leads(chamado_id,campanha_id,profissional_id,elegivel,origem,prioridade_ate)
 values(new.id,c.id,c.profissional_id,true,jsonb_build_object('distribuicao','marketing_pago','origem_publicacao',coalesce(new.marketing_origem,'{}')),
 now()+make_interval(mins=>case when new.urgencia='urgente' then c.urgente_min else c.janela_min end));
 update private.qf_md_campanhas set ultima_oferta_em=clock_timestamp() where id=c.id;
 return new;
end $$;

create or replace function private.qf_md_admin(p_id uuid,p_acao text,p_meta_id text default null,p_criativo text default null,
 p_janela integer default 15,p_urgente integer default 5) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.qf_md_campanhas;used integer;
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin_obrigatorio';end if;
 select * into c from private.qf_md_campanhas where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','nao_encontrada');end if;
 if p_acao='configurar' then
  if p_janela is null or p_urgente is null or p_janela not between 1 and 60 or p_urgente not between 1 and least(15,p_janela) then raise exception 'janela_invalida';end if;
  update private.qf_md_campanhas set meta_id=nullif(left(trim(p_meta_id),100),''),criativo_ref=nullif(left(trim(p_criativo),500),''),
  janela_min=p_janela,urgente_min=p_urgente,atualizado_em=now() where id=c.id;
 elsif p_acao='revisar' then
  update private.qf_md_campanhas set status=case when private.qf_md_livre_pago(c.profissional_id) then 'aguardando_pagamento' else 'aguardando_livre' end,atualizado_em=now()
  where id=c.id and status in ('solicitado','aguardando_livre','aguardando_pagamento');
 elsif p_acao in ('ativar','retomar') then
  if c.pagamento_status<>'conciliado' or not exists(select 1 from private.qf_md_pagamentos p where p.campanha_id=c.id and p.status='conciliado') then return jsonb_build_object('ok',false,'reason','pagamento_nao_confirmado');end if;
  if not private.qf_md_livre_pago(c.profissional_id) then return jsonb_build_object('ok',false,'reason','livre_pago_necessario');end if;
  if c.status='ativa' then return jsonb_build_object('ok',true,'duplicado',true);end if;
  if c.status not in ('preparacao','revisao_meta','pausada') or c.segundos_consumidos>=2592000 then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
  update private.qf_md_campanhas set status='ativa',inicio_em=coalesce(inicio_em,now()),trecho_inicio_em=now(),fim_em=now()+make_interval(secs=>2592000-segundos_consumidos),pausa_solicitada_em=null,atualizado_em=now() where id=c.id;
 elsif p_acao='pausar' then
  if c.status<>'ativa' then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
  used:=least(2592000,c.segundos_consumidos+greatest(0,ceil(extract(epoch from now()-coalesce(c.trecho_inicio_em,c.inicio_em)))::integer));
  update private.qf_md_campanhas set status=case when used>=2592000 then 'concluida' else 'pausada' end,segundos_consumidos=used,trecho_inicio_em=null,atualizado_em=now() where id=c.id;
 elsif p_acao='cancelar' then
  if c.pagamento_status='conciliado' or c.inicio_em is not null or exists(select 1 from private.qf_md_pagamentos where campanha_id=c.id) then return jsonb_build_object('ok',false,'reason','cancelamento_pago_requer_suporte');end if;
  update private.qf_md_campanhas set status='cancelada',atualizado_em=now() where id=c.id;
 else return jsonb_build_object('ok',false,'reason','acao_invalida');end if;
 perform private.qf_md_tick();
 return jsonb_build_object('ok',true);
end $$;

create or replace function private.qf_md_pausa(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.qf_md_campanhas;used integer;
begin
 if auth.uid() is null then raise exception 'autenticacao_obrigatoria';end if;
 select * into c from private.qf_md_campanhas where id=p_id and profissional_id=auth.uid() for update;
 if not found or c.status in ('concluida','cancelada') then return jsonb_build_object('ok',false,'reason','campanha_indisponivel');end if;
 used:=least(2592000,c.segundos_consumidos+case when c.status='ativa' then greatest(0,ceil(extract(epoch from now()-coalesce(c.trecho_inicio_em,c.inicio_em)))::integer) else 0 end);
 update private.qf_md_campanhas set status=case when inicio_em is null then status when used>=2592000 then 'concluida' else 'pausada' end,
 segundos_consumidos=used,trecho_inicio_em=null,pausa_solicitada_em=now(),atualizado_em=now() where id=c.id;
 perform private.qf_md_tick();
 return jsonb_build_object('ok',true,'pausa_solicitada',true);
end $$;

-- Status não emite cobrança nem exige consentir um preço novo.
create function public.qf_md_pagamento_consultar(p_prof uuid,p_campanha uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.qf_md_pagamentos;
begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role'
 and coalesce(current_setting('request.jwt.claim.role',true),'') is distinct from 'service_role' then raise exception 'service_role_obrigatorio';end if;
 select * into p from private.qf_md_pagamentos where profissional_id=p_prof and campanha_id=p_campanha;
 if not found then return jsonb_build_object('ok',false,'reason','cobranca_nao_emitida');end if;
 return jsonb_build_object('ok',true,'id',p.id,'status',p.status,'valor_centavos',p.valor_centavos,'txid',p.txid,'pix',p.pix);
end $$;
revoke all on function public.qf_md_pagamento_consultar(uuid,uuid) from public,anon,authenticated;
grant execute on function public.qf_md_pagamento_consultar(uuid,uuid) to service_role;

create or replace function private.qf_md_tick() returns integer language plpgsql security definer set search_path='' as $$
declare l record;n integer:=0;
begin
 update private.qf_md_campanhas set status='concluida',segundos_consumidos=2592000,trecho_inicio_em=null,atualizado_em=now() where status='ativa' and fim_em<=now();
 -- A elegibilidade cessa imediatamente no filtro; a tarefa registra a pausa e libera avisos em até um minuto.
 update private.qf_md_campanhas set status='pausada',segundos_consumidos=least(2592000,segundos_consumidos+greatest(0,ceil(extract(epoch from now()-coalesce(trecho_inicio_em,inicio_em)))::integer)),trecho_inicio_em=null,pausa_solicitada_em=now(),atualizado_em=now()
 where status='ativa' and (pagamento_status<>'conciliado' or not private.qf_md_livre_pago(profissional_id));
 for l in select chamado_id from private.qf_md_leads where elegivel and resposta='aguardando'
 and (prioridade_ate<=now() or private.qf_md_prioridade_permite('00000000-0000-0000-0000-000000000000'::uuid,chamado_id)) for update skip locked loop
  update private.qf_md_leads set resposta='expirado',respondido_em=now() where chamado_id=l.chamado_id;
  perform private.qf_push_interno('new_call',l.chamado_id);n:=n+1;
 end loop;
 return n;
end $$;

create or replace function public.qf_md_pagamento_preparar(p_prof uuid,p_campanha uuid,p_valor integer)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.qf_md_campanhas;p private.qf_md_pagamentos;price integer;
begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role'
 and coalesce(current_setting('request.jwt.claim.role',true),'') is distinct from 'service_role' then raise exception 'service_role_obrigatorio';end if;
 select * into c from private.qf_md_campanhas where id=p_campanha and profissional_id=p_prof for update;
 if not found then return jsonb_build_object('ok',false,'reason','campanha_indisponivel');end if;
 if c.status in ('cancelada','concluida') then return jsonb_build_object('ok',false,'reason','campanha_indisponivel');end if;
 select * into p from private.qf_md_pagamentos where campanha_id=c.id for update;
 if found then
 if p_valor is distinct from p.valor_centavos then return jsonb_build_object('ok',false,'reason','valor_mudou','valor_centavos',p.valor_centavos);end if;
 return jsonb_build_object('ok',true,'id',p.id,'status',p.status,'valor_centavos',p.valor_centavos,'txid',p.txid,'pix',p.pix);end if;
 if not exists(select 1 from private.qf_md_config where id and entrega_validada) then return jsonb_build_object('ok',false,'reason','integracao_entrega_pendente');end if;
 if c.status not in ('aguardando_livre','aguardando_pagamento','preparacao') then return jsonb_build_object('ok',false,'reason','proposta_nao_aprovada');end if;
 perform 1 from public.qf_profissionais where user_id=p_prof for update;
 price:=case when private.qf_md_livre_pago(p_prof) then 55000 else 58990 end;
 if p_valor is distinct from price then return jsonb_build_object('ok',false,'reason','valor_mudou','valor_centavos',price);end if;
 insert into private.qf_md_pagamentos(campanha_id,profissional_id,valor_centavos,livre_centavos)
 values(c.id,p_prof,price,price-55000) on conflict(campanha_id) do nothing;
 update private.qf_md_campanhas set pagamento_status='pendente',atualizado_em=now() where id=c.id;
 select * into p from private.qf_md_pagamentos where campanha_id=c.id for update;
 if p.status='conciliado' then return jsonb_build_object('ok',true,'id',p.id,'status',p.status);end if;
 if p.valor_centavos<>price then return jsonb_build_object('ok',false,'reason','cobranca_anterior_requer_revisao');end if;
 return jsonb_build_object('ok',true,'id',p.id,'status',p.status,'valor_centavos',p.valor_centavos,'txid',p.txid,'pix',p.pix);
end $$;
create or replace function public.qf_md_pagamento_liquidar(p_id uuid,p_txid text,p_e2e text,p_valor integer)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.qf_md_pagamentos;rid uuid;
begin
 select * into p from private.qf_md_pagamentos where id=p_id;
 if not found then return jsonb_build_object('ok',false,'reason','liquidacao_incompativel');end if;
 perform 1 from private.qf_md_campanhas where id=p.campanha_id for update;
 select * into p from private.qf_md_pagamentos where id=p_id for update;
 if not found or p.txid<>p_txid or p.valor_centavos<>p_valor or length(coalesce(p_e2e,''))<16
 then return jsonb_build_object('ok',false,'reason','liquidacao_incompativel');end if;
 if p.status='conciliado' then return jsonb_build_object('ok',p.end_to_end_id=p_e2e,'duplicado',true,'status','conciliado');end if;
 if p.status<>'pix_pronto' then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
 perform 1 from public.qf_profissionais where user_id=p.profissional_id for update;
 -- Uma assinatura paga em paralelo exige revisão da parcela Livre e não cria uma segunda assinatura.
 if p.livre_centavos>0 and private.qf_md_livre_pago(p.profissional_id) then
  update private.qf_md_pagamentos set status='em_analise',end_to_end_id=p_e2e,confirmado_em=now() where id=p.id;
  return jsonb_build_object('ok',false,'reason','livre_pago_em_paralelo_revisar_restituicao');
 end if;
 if p.livre_centavos=3990 then
  insert into public.qf_recargas(profissional_id,valor_centavos,metodo,status,provedor,provedor_id,plano)
  values(p.profissional_id,3990,'pix','pendente','efi',p.txid,'livre') returning id into rid;
  update public.qf_recargas set status='aprovado',aprovado_em=now() where id=rid;
 end if;
 update private.qf_md_pagamentos set status='conciliado',end_to_end_id=p_e2e,confirmado_em=now(),recarga_livre_id=rid where id=p.id;
 update private.qf_md_campanhas set pagamento_status='conciliado',status=case when private.qf_md_livre_pago(p.profissional_id) then 'ativa' else 'preparacao' end,inicio_em=case when private.qf_md_livre_pago(p.profissional_id) then now() else null end,trecho_inicio_em=case when private.qf_md_livre_pago(p.profissional_id) then now() else null end,fim_em=case when private.qf_md_livre_pago(p.profissional_id) then now()+interval '30 days' else null end,atualizado_em=now() where id=p.campanha_id;
 return jsonb_build_object('ok',true,'status','conciliado');
end $$;

create or replace function private.qf_md_painel() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare adm boolean;u uuid:=auth.uid();
begin
 if u is null then raise exception 'autenticacao_obrigatoria';end if;
 adm:=private.qf_is_admin();
 return jsonb_build_object('ok',true,'livre_pago',private.qf_md_livre_pago(u),
 'valor_adicional_centavos',55000,'valor_conjunto_centavos',58990,
 'entrega_validada',(select entrega_validada from private.qf_md_config where id),
 'bloqueio',(select observacao from private.qf_md_config where id),
 'campanhas',coalesce((select jsonb_agg(to_jsonb(x) order by x.criado_em desc) from (
 select c.*,(select mp.valor_centavos from private.qf_md_pagamentos mp where mp.campanha_id=c.id) valor_pagamento_centavos,(select mp.status from private.qf_md_pagamentos mp where mp.campanha_id=c.id) recebimento_status,p.nome profissional,private.qf_md_livre_pago(c.profissional_id) livre_pago,
 (select count(*) from private.qf_md_leads l where l.campanha_id=c.id) pedidos_publicados,
 (select count(*) from private.qf_md_leads l where l.campanha_id=c.id and l.resposta='aceito') aceitos,
 (select count(*) from private.qf_md_leads l where l.campanha_id=c.id and l.resposta='recusado') recusados,
 (select count(*) from private.qf_md_leads l where l.campanha_id=c.id and (l.resposta='expirado' or l.resposta='aguardando' and l.prioridade_ate<now())) expirados,
 (select count(*) from private.qf_md_leads l join public.qf_desbloqueios d on d.chamado_id=l.chamado_id and d.profissional_id<>l.profissional_id where l.campanha_id=c.id) entregas_outros,
 coalesce((select jsonb_agg(jsonb_build_object('pedido',l.chamado_id,'elegivel',l.elegivel,'resposta',l.resposta,
 'prioridade_ate',l.prioridade_ate,'criado_em',l.criado_em)) from private.qf_md_leads l where l.campanha_id=c.id),'[]') leads,
 coalesce((select jsonb_agg(jsonb_build_object('tipo',e.tipo,'ator',e.ator,'criado_em',e.criado_em) order by e.criado_em desc)
 from private.qf_md_eventos e where e.campanha_id=c.id),'[]') eventos
 from private.qf_md_campanhas c join public.qf_profiles p on p.id=c.profissional_id
 where adm or c.profissional_id=u) x),'[]'));
end $$;
create function public.qf_md_pagamentos_pendentes() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(p)),'[]') from (select id,txid,valor_centavos from private.qf_md_pagamentos where status='pix_pronto' and criado_em>now()-interval '7 days' order by criado_em limit 50) p
$$;
revoke all on function public.qf_md_pagamentos_pendentes() from public,anon,authenticated;
grant execute on function public.qf_md_pagamentos_pendentes() to service_role;
