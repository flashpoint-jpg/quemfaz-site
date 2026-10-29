-- Marketing Dedicado é distinto da propaganda Premium já existente.
-- Propostas são coletadas sem cobrança. Venda/ativação exigem integração de entrega validada.
create table private.qf_md_config(
 id boolean primary key default true check(id),
 entrega_validada boolean not null default false,
 observacao text not null default 'Venda e ativação aguardam integração Meta com pausa automática e validação bancária de homologação.',
 atualizado_em timestamptz not null default now()
);
insert into private.qf_md_config(id) values(true);
create table private.qf_md_campanhas(
 id uuid primary key default gen_random_uuid(),
 profissional_id uuid not null references public.qf_profissionais(user_id),
 token text not null unique default encode(extensions.gen_random_bytes(24),'hex'),
 categoria text not null check(length(categoria) between 2 and 100),
 cidades text[] not null check(cardinality(cidades) between 1 and 10),
 bairro_raio text not null check(length(bairro_raio) between 2 and 250),
 horarios text not null check(length(horarios) between 2 and 250),
 objetivo text not null check(length(objetivo) between 8 and 1500),
 status text not null default 'solicitado' check(status in ('solicitado','aguardando_livre','aguardando_pagamento','preparacao','revisao_meta','ativa','pausada','concluida','cancelada')),
 pagamento_status text not null default 'nao_emitido' check(pagamento_status in ('nao_emitido','pendente','conciliado','estornado','contestado')),
 midia_centavos integer not null default 30000 check(midia_centavos=30000),
 gestao_centavos integer not null default 25000 check(gestao_centavos=25000),
 gasto_centavos integer check(gasto_centavos>=0),
 meta_id text,
 criativo_ref text,
 inicio_em timestamptz,
 fim_em timestamptz,
 segundos_consumidos integer not null default 0 check(segundos_consumidos between 0 and 2592000),
 janela_min integer not null default 15 check(janela_min between 1 and 60),
 urgente_min integer not null default 5 check(urgente_min between 1 and 15),
 pausa_solicitada_em timestamptz,
 criado_em timestamptz not null default now(),
 atualizado_em timestamptz not null default now(),
 check(fim_em is null or inicio_em is not null and fim_em>inicio_em)
);
create unique index qf_md_pro_solicitacao_aberta on private.qf_md_campanhas(profissional_id)
 where status not in ('cancelada','concluida');
create table private.qf_md_eventos(
 id bigint generated always as identity primary key,
 campanha_id uuid not null references private.qf_md_campanhas(id),
 ator uuid,
 tipo text not null,
 detalhe jsonb not null default '{}',
 criado_em timestamptz not null default now()
);
create table private.qf_md_leads(
 chamado_id uuid primary key references public.qf_chamados(id),
 campanha_id uuid not null references private.qf_md_campanhas(id),
 profissional_id uuid not null references public.qf_profissionais(user_id),
 elegivel boolean not null,
 origem jsonb not null,
 prioridade_ate timestamptz,
 resposta text not null default 'aguardando' check(resposta in ('aguardando','aceito','recusado','expirado','inelegivel')),
 respondido_em timestamptz,
 criado_em timestamptz not null default now()
);
create table private.qf_md_pagamentos(
 id uuid primary key default gen_random_uuid(),
 campanha_id uuid not null unique references private.qf_md_campanhas(id),
 profissional_id uuid not null references public.qf_profissionais(user_id),
 valor_centavos integer not null check(valor_centavos in (55000,58990)),
 livre_centavos integer not null check(livre_centavos in (0,3990)),
 marketing_centavos integer not null default 55000 check(marketing_centavos=55000),
 txid text not null unique default replace(gen_random_uuid()::text,'-',''),
 status text not null default 'preparando' check(status in ('preparando','pix_pronto','conciliado','em_analise')),
 end_to_end_id text unique,
 pix text,
 confirmado_em timestamptz,
 recarga_livre_id uuid unique references public.qf_recargas(id),
 consentido_em timestamptz not null default now(),
 criado_em timestamptz not null default now(),
 check(valor_centavos=livre_centavos+marketing_centavos)
);
alter table private.qf_md_config enable row level security;
alter table private.qf_md_campanhas enable row level security;
alter table private.qf_md_eventos enable row level security;
alter table private.qf_md_leads enable row level security;
alter table private.qf_md_pagamentos enable row level security;
revoke all on private.qf_md_pagamentos from public,anon,authenticated;
revoke all on private.qf_md_config,private.qf_md_campanhas,private.qf_md_eventos,private.qf_md_leads from public,anon,authenticated;
create function private.qf_md_livre_pago(p_pro uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.qf_livre_assinaturas a join public.qf_recargas r on r.id=a.recarga_id
 where a.profissional_id=p_pro and a.inicio_em<=now() and a.fim_em>now() and r.status='aprovado'
 and r.plano='livre' and r.valor_centavos=3990 and r.provedor='efi');
$$;
create function private.qf_md_auditar() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.id<>old.id or new.profissional_id<>old.profissional_id or new.token<>old.token)
 then raise exception 'identidade_da_campanha_imutavel';end if;
 insert into private.qf_md_eventos(campanha_id,ator,tipo,detalhe)
 values(new.id,auth.uid(),case when tg_op='INSERT' then 'solicitacao' else 'alteracao' end,
 jsonb_build_object('anterior',case when tg_op='UPDATE' then to_jsonb(old)-'token' else null end,'atual',to_jsonb(new)-'token'));
 return new;
end $$;
create trigger qf_md_auditar after insert or update on private.qf_md_campanhas
 for each row execute function private.qf_md_auditar();
create function private.qf_md_solicitar(p_categoria text,p_cidades text[],p_bairro_raio text,p_horarios text,p_objetivo text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();v_id uuid;
begin
 if u is null or not exists(select 1 from public.qf_profissionais pr join public.qf_profiles p on p.id=pr.user_id
 where pr.user_id=u and coalesce(p.ativo,true)) then raise exception 'profissional_autenticado_obrigatorio';end if;
 perform 1 from public.qf_profissionais where user_id=u for update;
 select id into v_id from private.qf_md_campanhas where profissional_id=u and status not in ('cancelada','concluida');
 if v_id is not null then return jsonb_build_object('ok',true,'id',v_id,'duplicado',true);end if;
 if length(trim(p_categoria)) not between 2 and 100 or cardinality(p_cidades) not between 1 and 10
 or length(trim(p_bairro_raio)) not between 2 and 250 or length(trim(p_horarios)) not between 2 and 250
 or length(trim(p_objetivo)) not between 8 and 1500 or exists(select 1 from unnest(p_cidades) c where c is null or length(trim(c)) not between 2 and 100)
 then return jsonb_build_object('ok',false,'reason','dados_invalidos');end if;
 insert into private.qf_md_campanhas(profissional_id,categoria,cidades,bairro_raio,horarios,objetivo)
 values(u,trim(p_categoria),p_cidades,trim(p_bairro_raio),trim(p_horarios),trim(p_objetivo)) returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id,'cobranca_criada',false);
end $$;
create function public.qf_md_solicitar(p_categoria text,p_cidades text[],p_bairro_raio text,p_horarios text,p_objetivo text)
 returns jsonb language sql security invoker set search_path='' as $$
 select private.qf_md_solicitar(p_categoria,p_cidades,p_bairro_raio,p_horarios,p_objetivo)
$$;
create function private.qf_md_painel() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare adm boolean;u uuid:=auth.uid();
begin
 if u is null then raise exception 'autenticacao_obrigatoria';end if;
 adm:=private.qf_is_admin();
 return jsonb_build_object('ok',true,'livre_pago',private.qf_md_livre_pago(u),
 'valor_adicional_centavos',55000,'valor_conjunto_centavos',58990,
 'entrega_validada',(select entrega_validada from private.qf_md_config where id),
 'bloqueio',(select observacao from private.qf_md_config where id),
 'campanhas',coalesce((select jsonb_agg(to_jsonb(x) order by x.criado_em desc) from (
 select c.*,p.nome profissional,private.qf_md_livre_pago(c.profissional_id) livre_pago,
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
create function public.qf_md_painel() returns jsonb language sql security invoker set search_path='' as $$select private.qf_md_painel()$$;
create function private.qf_md_admin(p_id uuid,p_acao text,p_meta_id text default null,p_criativo text default null,
 p_janela integer default 15,p_urgente integer default 5) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare c private.qf_md_campanhas;
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin_obrigatorio';end if;
 select * into c from private.qf_md_campanhas where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','nao_encontrada');end if;
 if p_acao='configurar' then
  if p_janela not between 1 and 60 or p_urgente not between 1 and least(15,p_janela) then raise exception 'janela_invalida';end if;
  update private.qf_md_campanhas set meta_id=nullif(left(trim(p_meta_id),100),''),criativo_ref=nullif(left(trim(p_criativo),500),''),
  janela_min=p_janela,urgente_min=p_urgente,atualizado_em=now() where id=c.id;
 elsif p_acao='revisar' then
  update private.qf_md_campanhas set status=case when private.qf_md_livre_pago(c.profissional_id) then 'aguardando_pagamento' else 'aguardando_livre' end,
   atualizado_em=now() where id=c.id and status in ('solicitado','aguardando_livre','aguardando_pagamento');
 elsif p_acao in ('ativar','cobrar') then
  -- Sem atestado do backend de entrega, não vender um serviço sem capacidade de cumprir a pausa.
  return jsonb_build_object('ok',false,'reason','integracao_entrega_pendente');
 elsif p_acao='cancelar' then
  if c.pagamento_status='conciliado' or c.inicio_em is not null then return jsonb_build_object('ok',false,'reason','cancelamento_pago_requer_suporte');end if;
  update private.qf_md_campanhas set status='cancelada',atualizado_em=now() where id=c.id;
 else return jsonb_build_object('ok',false,'reason','acao_invalida');end if;
 return jsonb_build_object('ok',true);
end $$;
create function public.qf_md_admin(p_id uuid,p_acao text,p_meta_id text default null,p_criativo text default null,
 p_janela integer default 15,p_urgente integer default 5) returns jsonb language sql security invoker set search_path='' as $$
 select private.qf_md_admin(p_id,p_acao,p_meta_id,p_criativo,p_janela,p_urgente)
$$;
create function private.qf_md_pausa(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'autenticacao_obrigatoria';end if;
 update private.qf_md_campanhas set pausa_solicitada_em=now(),atualizado_em=now()
 where id=p_id and profissional_id=auth.uid() and status not in ('concluida','cancelada');
 if not found then return jsonb_build_object('ok',false,'reason','campanha_indisponivel');end if;
 return jsonb_build_object('ok',true,'pausa_solicitada',true);
end $$;
create function public.qf_md_pausa(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.qf_md_pausa(p_id)$$;
create function public.qf_md_pagamento_preparar(p_prof uuid,p_campanha uuid,p_valor integer)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.qf_md_campanhas;p private.qf_md_pagamentos;price integer;
begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role'
 and coalesce(current_setting('request.jwt.claim.role',true),'') is distinct from 'service_role' then raise exception 'service_role_obrigatorio';end if;
 select * into c from private.qf_md_campanhas where id=p_campanha and profissional_id=p_prof for update;
 if not found then return jsonb_build_object('ok',false,'reason','campanha_indisponivel');end if;
 if not exists(select 1 from private.qf_md_config where id and entrega_validada) then return jsonb_build_object('ok',false,'reason','integracao_entrega_pendente');end if;
 if c.status not in ('aguardando_livre','aguardando_pagamento','preparacao') then return jsonb_build_object('ok',false,'reason','proposta_nao_aprovada');end if;
 perform 1 from public.qf_profissionais where user_id=p_prof for update;
 price:=case when private.qf_md_livre_pago(p_prof) then 55000 else 58990 end;
 if p_valor is distinct from price then return jsonb_build_object('ok',false,'reason','valor_mudou','valor_centavos',price);end if;
 insert into private.qf_md_pagamentos(campanha_id,profissional_id,valor_centavos,livre_centavos)
 values(c.id,p_prof,price,price-55000) on conflict(campanha_id) do nothing;
 select * into p from private.qf_md_pagamentos where campanha_id=c.id for update;
 if p.status='conciliado' then return jsonb_build_object('ok',true,'id',p.id,'status',p.status);end if;
 if p.valor_centavos<>price then return jsonb_build_object('ok',false,'reason','cobranca_anterior_requer_revisao');end if;
 return jsonb_build_object('ok',true,'id',p.id,'status',p.status,'valor_centavos',p.valor_centavos,'txid',p.txid,'pix',p.pix);
end $$;
create function public.qf_md_pagamento_registrar(p_id uuid,p_txid text,p_pix text)
 returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if length(coalesce(p_pix,'')) not between 30 and 8000 then return jsonb_build_object('ok',false);end if;
 update private.qf_md_pagamentos set pix=p_pix,status='pix_pronto' where id=p_id and txid=p_txid and status in ('preparando','pix_pronto');
 return jsonb_build_object('ok',found);
end $$;
create function public.qf_md_pagamento_liquidar(p_id uuid,p_txid text,p_e2e text,p_valor integer)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.qf_md_pagamentos;rid uuid;
begin
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
 update private.qf_md_campanhas set pagamento_status='conciliado',status='preparacao',atualizado_em=now() where id=p.campanha_id;
 return jsonb_build_object('ok',true,'status','conciliado');
end $$;
revoke all on function public.qf_md_pagamento_preparar(uuid,uuid,integer),public.qf_md_pagamento_registrar(uuid,text,text),
 public.qf_md_pagamento_liquidar(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.qf_md_pagamento_preparar(uuid,uuid,integer),public.qf_md_pagamento_registrar(uuid,text,text),
 public.qf_md_pagamento_liquidar(uuid,text,text,integer) to service_role;
-- A origem só pode ser gravada na publicação. Nenhum cliente muda patrocinador depois.
create function private.qf_md_origem_imutavel() returns trigger language plpgsql set search_path='' as $$
begin
 if new.marketing_origem is distinct from old.marketing_origem then raise exception 'origem_do_pedido_imutavel';end if;
 return new;
end $$;
create trigger qf_md_origem_imutavel before update of marketing_origem on public.qf_chamados
 for each row execute function private.qf_md_origem_imutavel();
-- Nenhuma campanha fica ativa nesta migração. Atribuição aceita somente tokens opacos e campanha comprovada.
create function private.qf_md_atribuir() returns trigger language plpgsql security definer set search_path='' as $$
declare c private.qf_md_campanhas;eligible boolean;expiry timestamptz;
begin
 if coalesce(new.marketing_origem->>'md_token','')!~'^[a-f0-9]{48}$' then return new;end if;
 select * into c from private.qf_md_campanhas where token=new.marketing_origem->>'md_token';
 if not found then return new;end if;
 eligible:=c.status='ativa' and c.pagamento_status='conciliado' and c.inicio_em<=now() and c.fim_em>now()
 and private.qf_md_livre_pago(c.profissional_id) and c.categoria=new.categoria
 and private.qf_pro_recebe_chamado(c.profissional_id,new.id)
 and exists(select 1 from public.qf_profissionais p join public.qf_profiles u on u.id=p.user_id
 where p.user_id=c.profissional_id and coalesce(u.ativo,true) and p.online and not coalesce(p.offline_manual,false)
 and private.qf_dentro_horario(p.horario_inicio,p.horario_fim));
 expiry:=case when eligible then now()+make_interval(mins=>case when new.urgencia='urgente' then c.urgente_min else c.janela_min end) else null end;
 insert into private.qf_md_leads(chamado_id,campanha_id,profissional_id,elegivel,origem,prioridade_ate,resposta)
 values(new.id,c.id,c.profissional_id,coalesce(eligible,false),new.marketing_origem,expiry,case when eligible then 'aguardando' else 'inelegivel' end)
 on conflict(chamado_id) do nothing;
 return new;
end $$;
create trigger qf_aa_md_atribuir after insert on public.qf_chamados for each row execute function private.qf_md_atribuir();
create function private.qf_md_prioridade_permite(p_pro uuid,p_pedido uuid) returns boolean
 language plpgsql stable security definer set search_path='' as $$
declare l private.qf_md_leads;c private.qf_md_campanhas;
begin
 select * into l from private.qf_md_leads where chamado_id=p_pedido;
 if not found or not l.elegivel or l.resposta<>'aguardando' or l.prioridade_ate<=now() then return true;end if;
 select * into c from private.qf_md_campanhas where id=l.campanha_id;
 if c.status<>'ativa' or c.pagamento_status<>'conciliado' or c.fim_em<=now() or not private.qf_md_livre_pago(l.profissional_id)
 or not exists(select 1 from public.qf_profissionais pr join public.qf_profiles u on u.id=pr.user_id
 join public.qf_chamados ch on ch.id=p_pedido
 where pr.user_id=l.profissional_id and coalesce(u.ativo,true) and pr.online and not coalesce(pr.offline_manual,false)
 and ch.categoria=any(coalesce(pr.especialidades,array[]::text[]))
 and private.qf_pro_atende_regiao(pr.user_id,ch.cidade,ch.uf::text,ch.latitude,ch.longitude)
 and private.qf_dentro_horario(pr.horario_inicio,pr.horario_fim)) then return true;end if;
 return p_pro=l.profissional_id;
end $$;
-- Preserva a função central e acrescenta somente a condição de prioridade.
do $$declare src text;needle text:='and c.categoria=any(coalesce(pr.especialidades,array[]::text[]))';begin
 src:=pg_get_functiondef('private.qf_pro_recebe_chamado(uuid,uuid)'::regprocedure);
 if strpos(src,needle)=0 then raise exception 'funcao_elegibilidade_inesperada';end if;
 execute replace(src,needle,'and private.qf_md_prioridade_permite(p_pro,p_chamado_id) '||needle);
end $$;
create function private.qf_md_guardar_desbloqueio() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not private.qf_md_prioridade_permite(new.profissional_id,new.chamado_id) then raise exception 'janela_prioritaria_ativa';end if;
 return new;
end $$;
create trigger qf_aa_md_guardar before insert on public.qf_desbloqueios for each row execute function private.qf_md_guardar_desbloqueio();
create function private.qf_md_aceite() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update private.qf_md_leads set resposta='aceito',respondido_em=now()
 where chamado_id=new.chamado_id and profissional_id=new.profissional_id and elegivel and resposta='aguardando';
 return new;
end $$;
create trigger qf_md_aceite after insert on public.qf_desbloqueios for each row execute function private.qf_md_aceite();
create function private.qf_md_recusar(p_pedido uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'autenticacao_obrigatoria';end if;
 perform 1 from public.qf_chamados where id=p_pedido for update;
 update private.qf_md_leads set resposta='recusado',respondido_em=now()
 where chamado_id=p_pedido and profissional_id=auth.uid() and resposta='aguardando';
 if not found then return jsonb_build_object('ok',false,'reason','prioridade_indisponivel');end if;
 perform private.qf_push_interno('new_call',p_pedido);
 return jsonb_build_object('ok',true);
end $$;
create function public.qf_md_recusar(p_pedido uuid) returns jsonb language sql security invoker set search_path='' as $$select private.qf_md_recusar(p_pedido)$$;
create function private.qf_md_tick() returns integer language plpgsql security definer set search_path='' as $$
declare l record;n integer:=0;
begin
 for l in select chamado_id from private.qf_md_leads where elegivel and resposta='aguardando'
 and (prioridade_ate<=now() or private.qf_md_prioridade_permite('00000000-0000-0000-0000-000000000000'::uuid,chamado_id))
 for update skip locked loop
  update private.qf_md_leads set resposta='expirado',respondido_em=now() where chamado_id=l.chamado_id;
  perform private.qf_push_interno('new_call',l.chamado_id);n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function private.qf_md_prioridade_permite(uuid,uuid),private.qf_md_guardar_desbloqueio(),
 private.qf_md_aceite(),private.qf_md_tick() from public,anon,authenticated;
revoke all on function private.qf_md_recusar(uuid),public.qf_md_recusar(uuid) from public,anon;
grant execute on function private.qf_md_recusar(uuid),public.qf_md_recusar(uuid) to authenticated;
-- Funções privadas: somente as quatro entradas autenticadas são expostas através de wrappers.
revoke all on function private.qf_md_livre_pago(uuid),private.qf_md_auditar(),private.qf_md_origem_imutavel(),private.qf_md_atribuir() from public,anon,authenticated;
revoke all on function private.qf_md_solicitar(text,text[],text,text,text),private.qf_md_painel(),
 private.qf_md_admin(uuid,text,text,text,integer,integer),private.qf_md_pausa(uuid),
 public.qf_md_solicitar(text,text[],text,text,text),public.qf_md_painel(),
 public.qf_md_admin(uuid,text,text,text,integer,integer),public.qf_md_pausa(uuid) from public,anon;
grant execute on function private.qf_md_solicitar(text,text[],text,text,text),private.qf_md_painel(),
 private.qf_md_admin(uuid,text,text,text,integer,integer),private.qf_md_pausa(uuid),
 public.qf_md_solicitar(text,text[],text,text,text),public.qf_md_painel(),
 public.qf_md_admin(uuid,text,text,text,integer,integer),public.qf_md_pausa(uuid) to authenticated;
