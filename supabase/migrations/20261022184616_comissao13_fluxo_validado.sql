-- Continuação do piloto. Integrações NÃO são habilitadas por esta migração.
create table if not exists private.qf_comissao13_prontidao (
 id boolean primary key default true check(id), otp_validado boolean not null default false,
 financeiro_validado boolean not null default false, testes_aprovados boolean not null default false
);
insert into private.qf_comissao13_prontidao(id) values(true) on conflict do nothing;
revoke all on private.qf_comissao13_prontidao from public, anon, authenticated;
alter table public.qf_comissao13_acordos add column if not exists agendado_em timestamptz;
alter table public.qf_comissao13_acordos add column if not exists telefone_vinculado text;
alter table public.qf_comissao13_acordos add column if not exists token_hash text;
alter table public.qf_comissao13_acordos add column if not exists token_expira_em timestamptz;
alter table public.qf_comissao13_acordos add column if not exists telefone_verificado_em timestamptz;
alter table public.qf_comissao13_acordos add column if not exists contestacao text;
create index if not exists qf_comissao13_prof_idx on public.qf_comissao13_acordos(profissional_id,criado_em desc);
create index if not exists qf_comissao13_chamado_idx on public.qf_comissao13_acordos(chamado_id);
create table if not exists private.qf_comissao13_codigos (
 id uuid primary key default gen_random_uuid(), acordo_id uuid not null references public.qf_comissao13_acordos(id),
 finalidade text not null check(finalidade in ('contratar','concluir','contestar')),
 hash text not null, expira_em timestamptz not null, criado_em timestamptz not null default now(),
 tentativas integer not null default 0, enviado_em timestamptz, usado_em timestamptz, provedor_id text
);
create index if not exists qf_comissao13_codigos_acordo_idx on private.qf_comissao13_codigos(acordo_id,criado_em desc);
revoke all on private.qf_comissao13_codigos from public,anon,authenticated;
alter table private.qf_comissao13_codigos enable row level security;
alter table private.qf_comissao13_prontidao enable row level security;

create or replace function private.qf_comissao13_pronto() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select otp_validado and financeiro_validado and testes_aprovados from private.qf_comissao13_prontidao where id),false)
$$;
revoke all on function private.qf_comissao13_pronto() from public,anon,authenticated;
create or replace function public.qf_comissao13_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
 return jsonb_build_object('ok',true,'carteirinha_ativa',exists(select 1 from public.qf_carteirinhas c join public.qf_profiles p on p.id=c.profissional_id where c.profissional_id=auth.uid() and p.ativo and p.tipo='profissional'),
 'aderiu',exists(select 1 from public.qf_comissao13_adesoes where profissional_id=auth.uid() and revogado_em is null and versao_termos='13pct-v1'),
 'comissao_percentual',13,'desbloqueio_gratuito_ativo',private.qf_comissao13_pronto(),'dependencias',jsonb_build_array('OTP ao telefone vinculado','Cobrança e repasse de serviços validados'));
end $$;

-- Mesmo bloqueio de linha utilizado pelo desbloqueio tradicional. Todos contam na mesma tabela.
alter table public.qf_desbloqueios drop constraint if exists qf_desbloqueios_origem_check;
alter table public.qf_desbloqueios add constraint qf_desbloqueios_origem_check check(origem in ('saldo','bonus','cortesia_admin','plano','comissao13'));
create or replace function public.qf_comissao13_desbloquear(p_chamado_id uuid,p_aceitar boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_prof uuid:=auth.uid(); c public.qf_chamados; n integer; d uuid;
begin
 if v_prof is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
 if not private.qf_comissao13_pronto() then return jsonb_build_object('ok',false,'reason','integracao_pendente'); end if;
 if p_aceitar is distinct from true then return jsonb_build_object('ok',false,'reason','aceite_obrigatorio'); end if;
 if not exists(select 1 from public.qf_comissao13_adesoes where profissional_id=v_prof and revogado_em is null and versao_termos='13pct-v1') then return jsonb_build_object('ok',false,'reason','adesao_necessaria'); end if;
 if not exists(select 1 from public.qf_carteirinhas k join public.qf_profiles p on p.id=k.profissional_id where k.profissional_id=v_prof and p.ativo and p.tipo='profissional' and nullif(trim(p.foto_url),'') is not null) then return jsonb_build_object('ok',false,'reason','carteirinha_necessaria'); end if;
 if private.qf_pendencia_finalizacao(v_prof,'profissional') is not null then return jsonb_build_object('ok',false,'reason','avaliacao_pendente'); end if;
 select * into c from public.qf_chamados where id=p_chamado_id for update;
 if not found or c.status not in ('aberto','em_negociacao') or c.atendimento_tipo='garante' then return jsonb_build_object('ok',false,'reason','indisponivel'); end if;
 if exists(select 1 from public.qf_desbloqueios where chamado_id=c.id and profissional_id=v_prof) then return jsonb_build_object('ok',false,'reason','ja_participou'); end if;
 select count(*) into n from public.qf_desbloqueios where chamado_id=c.id and coalesce(ativo,true);
 if n>=least(4,public.qf_limite_orcamentos(c.id)) or exists(select 1 from public.qf_desbloqueios where chamado_id=c.id and exclusivo and coalesce(ativo,true)) or exists(select 1 from public.qf_orcamentos where chamado_id=c.id and status='aceito') then return jsonb_build_object('ok',false,'reason','reservado'); end if;
 if not exists(select 1 from public.qf_listar_chamados_disponiveis() where id=c.id) then return jsonb_build_object('ok',false,'reason','nao_elegivel'); end if;
 insert into public.qf_desbloqueios(chamado_id,profissional_id,valor_centavos,origem,ativo,exclusivo) values(c.id,v_prof,0,'comissao13',true,false) returning id into d;
 update public.qf_chamados set status='em_negociacao',atualizado_em=now() where id=c.id;
 perform private.qf_push_interno('professional_connected',c.id);
 return jsonb_build_object('ok',true,'desbloqueio_id',d,'origem','comissao13','preco_centavos',0,'participantes',n+1,'limite',least(4,public.qf_limite_orcamentos(c.id)));
end $$;

create or replace function public.qf_comissao13_propor(p_desbloqueio_id uuid,p_valor_centavos bigint,p_agendado_em timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.qf_desbloqueios; a uuid; t text:=gen_random_uuid()::text; tel text; cli uuid;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
 if not private.qf_comissao13_pronto() then return jsonb_build_object('ok',false,'reason','integracao_pendente'); end if;
 if p_valor_centavos is null or p_valor_centavos<100 or p_valor_centavos>100000000 or p_agendado_em is null or p_agendado_em<now()-interval '1 day' then return jsonb_build_object('ok',false,'reason','dados_invalidos'); end if;
 select * into d from public.qf_desbloqueios where id=p_desbloqueio_id and profissional_id=auth.uid() and ativo and origem='comissao13' for update;
 if not found then return jsonb_build_object('ok',false,'reason','sem_desbloqueio'); end if;
 if exists(select 1 from public.qf_comissao13_acordos where desbloqueio_id=d.id) then return jsonb_build_object('ok',false,'reason','acordo_existente'); end if;
 select c.cliente_id,regexp_replace(coalesce(nullif(p.telefone,''),p.whatsapp,''),'[^0-9]','','g') into cli,tel from public.qf_chamados c join public.qf_profiles p on p.id=c.cliente_id where c.id=d.chamado_id and c.status in ('aberto','em_negociacao');
 if length(tel) not in (10,11,12,13) then return jsonb_build_object('ok',false,'reason','telefone_invalido'); end if;
 insert into public.qf_comissao13_acordos(chamado_id,desbloqueio_id,profissional_id,cliente_id,valor_centavos,agendado_em,telefone_vinculado,token_hash,token_expira_em)
 values(d.chamado_id,d.id,auth.uid(),cli,p_valor_centavos,p_agendado_em,tel,md5(t),now()+interval '7 days') returning id into a;
 insert into public.qf_comissao13_eventos(acordo_id,tipo,idempotency_key) values(a,'proposto',a||':proposto');
 return jsonb_build_object('ok',true,'acordo_id',a,'token',t);
end $$;

-- Métodos do cliente são exclusivos do backend; nenhum JWT de profissional os executa.
create or replace function public.qf_comissao13_cliente_info(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.qf_comissao13_acordos; nome text;
begin
 select * into a from public.qf_comissao13_acordos where token_hash=md5(p_token) and token_expira_em>now();
 if not found then return jsonb_build_object('ok',false,'reason','link_invalido'); end if;
 select p.nome into nome from public.qf_profiles p where p.id=a.profissional_id;
 return jsonb_build_object('ok',true,'acordo_id',a.id,'pedido',a.chamado_id,'profissional',nome,'profissional_id',a.profissional_id,'valor_centavos',a.valor_centavos,'agendado_em',a.agendado_em,'status',a.status,'telefone_final',right(a.telefone_vinculado,4));
end $$;
create or replace function public.qf_comissao13_codigo_criar(p_token text,p_finalidade text,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.qf_comissao13_acordos; k uuid;
begin
 select * into a from public.qf_comissao13_acordos where token_hash=md5(p_token) and token_expira_em>now() for update;
 if not found then return jsonb_build_object('ok',false,'reason','link_invalido'); end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_finalidade is null or p_finalidade not in ('contratar','concluir','contestar') then return jsonb_build_object('ok',false,'reason','dados_invalidos'); end if;
 if (p_finalidade='contratar' and a.status<>'proposto') or (p_finalidade='concluir' and (a.status<>'contratado' or a.agendado_em>now())) or (p_finalidade='contestar' and a.status not in ('proposto','contratado','concluido','pagamento_pendente')) then return jsonb_build_object('ok',false,'reason','estado_invalido'); end if;
 if exists(select 1 from private.qf_comissao13_codigos where acordo_id=a.id and criado_em>now()-interval '60 seconds') or (select count(*) from private.qf_comissao13_codigos where acordo_id=a.id and criado_em>now()-interval '1 hour')>=5 or coalesce((select sum(tentativas) from private.qf_comissao13_codigos where acordo_id=a.id and criado_em>now()-interval '1 hour'),0)>=10 then return jsonb_build_object('ok',false,'reason','limite'); end if;
 update private.qf_comissao13_codigos set usado_em=now() where acordo_id=a.id and usado_em is null;
 insert into private.qf_comissao13_codigos(acordo_id,finalidade,hash,expira_em) values(a.id,p_finalidade,p_hash,now()+interval '5 minutes') returning id into k;
 return jsonb_build_object('ok',true,'codigo_id',k,'telefone',a.telefone_vinculado);
end $$;
create or replace function public.qf_comissao13_codigo_enviado(p_id uuid,p_provedor_id text) returns void language sql security definer set search_path='' as $$
 update private.qf_comissao13_codigos set enviado_em=now(),provedor_id=p_provedor_id where id=p_id and p_provedor_id is not null and length(p_provedor_id)>0 and enviado_em is null and usado_em is null
$$;
create or replace function public.qf_comissao13_cliente_confirmar(p_token text,p_finalidade text,p_hash text,p_confirmar boolean,p_motivo text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.qf_comissao13_acordos; k private.qf_comissao13_codigos; s text;
begin
 -- Serializa a contratação de profissionais diferentes para o mesmo pedido.
 perform 1 from public.qf_chamados c join public.qf_comissao13_acordos x on x.chamado_id=c.id where x.token_hash=md5(p_token) for update of c;
 select * into a from public.qf_comissao13_acordos where token_hash=md5(p_token) and token_expira_em>now() for update;
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

create or replace function public.qf_comissao13_painel() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 return coalesce((select jsonb_agg(x) from (select a.id,a.chamado_id,a.desbloqueio_id,a.profissional_id,p.nome as profissional,'comissao13' as modalidade,a.valor_centavos,a.agendado_em,a.status,a.contratado_em,a.concluido_em,a.telefone_verificado_em,a.contestacao,a.pago_em,a.repassado_em,round(a.valor_centavos*0.13)::bigint as comissao_centavos,a.valor_centavos-round(a.valor_centavos*0.13)::bigint as profissional_centavos, 'não apuradas' as taxas,case when a.pago_em is null then 'pendente' else 'confirmado' end as pagamento,case when a.repassado_em is null then 'pendente' else 'concluido' end as repasse from public.qf_comissao13_acordos a join public.qf_profiles p on p.id=a.profissional_id where a.profissional_id=auth.uid() or private.qf_is_admin() order by a.criado_em desc limit 200) x),'[]'::jsonb);
end $$;
-- Revogar inclusive os grants automáticos do projeto.
revoke all on function public.qf_comissao13_status() from public,anon;
grant execute on function public.qf_comissao13_status() to authenticated;
revoke all on function public.qf_comissao13_desbloquear(uuid,boolean), public.qf_comissao13_propor(uuid,bigint,timestamptz),public.qf_comissao13_painel() from public,anon;
grant execute on function public.qf_comissao13_desbloquear(uuid,boolean),public.qf_comissao13_propor(uuid,bigint,timestamptz),public.qf_comissao13_painel() to authenticated;
revoke all on function public.qf_comissao13_cliente_info(text), public.qf_comissao13_codigo_criar(text,text,text),public.qf_comissao13_codigo_enviado(uuid,text),public.qf_comissao13_cliente_confirmar(text,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.qf_comissao13_cliente_info(text),public.qf_comissao13_codigo_criar(text,text,text),public.qf_comissao13_codigo_enviado(uuid,text),public.qf_comissao13_cliente_confirmar(text,text,text,boolean,text) to service_role;

create unique index if not exists qf_comissao13_contratacao_unica on public.qf_comissao13_acordos(chamado_id) where status in ('contratado','concluido','pagamento_pendente','pago','repasse_pendente','repassado','contestado');
create or replace function public.qf_comissao13_meu_desbloqueio(p_chamado_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d public.qf_desbloqueios;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false); end if;
 select * into d from public.qf_desbloqueios where chamado_id=p_chamado_id and profissional_id=auth.uid() and origem='comissao13' and ativo;
 if not found then return jsonb_build_object('ok',false); end if;
 return jsonb_build_object('ok',true,'id',d.id,'acordo',(select jsonb_build_object('id',a.id,'status',a.status,'valor_centavos',a.valor_centavos,'agendado_em',a.agendado_em) from public.qf_comissao13_acordos a where a.desbloqueio_id=d.id));
end $$;
revoke all on function public.qf_comissao13_meu_desbloqueio(uuid) from public,anon;
grant execute on function public.qf_comissao13_meu_desbloqueio(uuid) to authenticated;
