-- Complemento financeiro isolado. Requer homologação, recebedor e tarifas reais.
create table if not exists private.qf_comissao13_recebedores (
 profissional_id uuid primary key references public.qf_profissionais(user_id), payee_code text not null,
 conta_efi text not null, documento text not null, status text not null default 'pendente' check(status in ('pendente','validado','bloqueado')),
 atualizado_em timestamptz not null default now(), validado_em timestamptz, validado_por uuid, evidencia text
);
create table if not exists private.qf_comissao13_tarifas (
 metodo text primary key check(metodo in ('pix','cartao')), fixo_centavos integer not null check(fixo_centavos>=0), percentual_bps integer not null check(percentual_bps between 0 and 10000),
 responsavel text not null check(responsavel='quemfaz'), evidencia text not null, verificado_em timestamptz not null,
 verificado_por uuid not null references public.qf_profiles(id)
);
create table if not exists public.qf_comissao13_financeiro (
 id uuid primary key default gen_random_uuid(), acordo_id uuid not null unique references public.qf_comissao13_acordos(id),
 metodo text not null check(metodo in ('pix','cartao')), provedor text not null default 'efi' check(provedor='efi'),
 provedor_id text unique, txid text not null unique, split_id text not null unique,
 valor_centavos bigint not null check(valor_centavos>0), comissao_centavos bigint not null check(comissao_centavos>=0), profissional_centavos bigint not null check(profissional_centavos>0),
 taxa_prevista_centavos bigint not null check(taxa_prevista_centavos>=0), taxa_real_centavos bigint check(taxa_real_centavos>=0), recebedor jsonb not null,
 status text not null default 'criando' check(status in ('criando','pendente','pago','estornado','chargeback','disputa','incerto','cancelado')),
 repasse_status text not null default 'pendente' check(repasse_status in ('pendente','bloqueado','concluido')),
 checkout_url text, pix_copia_cola text, criado_em timestamptz not null default now(), pago_em timestamptz, repassado_em timestamptz,
 estornado_centavos bigint not null default 0 check(estornado_centavos>=0),
 check(comissao_centavos+profissional_centavos=valor_centavos),check(estornado_centavos<=valor_centavos)
);
create table if not exists private.qf_comissao13_fin_eventos (
 provedor_evento_id text primary key, financeiro_id uuid not null references public.qf_comissao13_financeiro(id),
 tipo text not null, valor_centavos bigint not null, criado_em timestamptz not null default now()
);
alter table private.qf_comissao13_recebedores enable row level security;
alter table private.qf_comissao13_tarifas enable row level security;
alter table public.qf_comissao13_financeiro enable row level security;
alter table private.qf_comissao13_fin_eventos enable row level security;
revoke all on private.qf_comissao13_recebedores,private.qf_comissao13_tarifas,public.qf_comissao13_financeiro,private.qf_comissao13_fin_eventos from public,anon,authenticated;
create index if not exists qf13_fin_eventos_fin_idx on private.qf_comissao13_fin_eventos(financeiro_id);
create or replace function public.qf_comissao13_recebedor_informar(p_payee_code text,p_conta_efi text) returns jsonb language plpgsql security definer set search_path='' as $$
declare doc text;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
 select regexp_replace(pr.documento,'[^0-9]','','g') into doc from public.qf_profissionais pr join public.qf_profiles p on p.id=pr.user_id where pr.user_id=auth.uid() and p.ativo and p.tipo='profissional';
 if doc is null or length(doc) not in (11,14) or p_payee_code is null or p_payee_code!~'^[a-zA-Z0-9_-]{4,100}$' or p_conta_efi is null or p_conta_efi!~'^[0-9]{1,20}$' then return jsonb_build_object('ok',false,'reason','dados_invalidos'); end if;
 if exists(select 1 from public.qf_comissao13_acordos a where a.profissional_id=auth.uid() and a.status not in ('cancelado','repassado','contestado')) then return jsonb_build_object('ok',false,'reason','acordo_em_andamento'); end if;
 insert into private.qf_comissao13_recebedores(profissional_id,payee_code,conta_efi,documento) values(auth.uid(),p_payee_code,p_conta_efi,doc)
 on conflict(profissional_id) do update set payee_code=excluded.payee_code,conta_efi=excluded.conta_efi,documento=excluded.documento,status='pendente',atualizado_em=now(),validado_em=null,validado_por=null,evidencia=null;
 return jsonb_build_object('ok',true,'status','pendente','message','O recebimento depende da validação da conta e do documento.');
end $$;
create or replace function public.qf_comissao13_recebedor_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
 return jsonb_build_object('ok',true,'status',coalesce((select status from private.qf_comissao13_recebedores where profissional_id=auth.uid()),'nao_cadastrado'));
end $$;
revoke all on function public.qf_comissao13_recebedor_informar(text,text),public.qf_comissao13_recebedor_status() from public,anon;
grant execute on function public.qf_comissao13_recebedor_informar(text,text),public.qf_comissao13_recebedor_status() to authenticated;
-- Nenhuma função pública de aprovação manual de recebedor ou de habilitação financeira.
-- O backend de homologação deve validar no provedor antes de registrar validação.
create or replace function public.qf_comissao13_pagamento_preparar(p_token text,p_metodo text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.qf_comissao13_acordos; r private.qf_comissao13_recebedores; t private.qf_comissao13_tarifas; f public.qf_comissao13_financeiro; v_taxa bigint; v_comissao bigint; v_id uuid:=gen_random_uuid(); v_novo boolean:=false;
begin
 if not private.qf_comissao13_pronto() then return jsonb_build_object('ok',false,'reason','integracao_pendente'); end if;
 select * into a from public.qf_comissao13_acordos where id=private.qf_comissao13_acordo_token(p_token) for update;
 if not found or a.status not in ('concluido','pagamento_pendente') or a.concluido_em is null or a.telefone_verificado_em is null then return jsonb_build_object('ok',false,'reason','conclusao_nao_confirmada'); end if;
 if exists(select 1 from public.qf_chamados where id=a.chamado_id and status in ('cancelado','expirado')) then return jsonb_build_object('ok',false,'reason','pedido_cancelado'); end if;
 select * into r from private.qf_comissao13_recebedores where profissional_id=a.profissional_id and status='validado';
 if not found then return jsonb_build_object('ok',false,'reason','recebedor_nao_validado'); end if;
 select * into t from private.qf_comissao13_tarifas where metodo=p_metodo;
 if not found then return jsonb_build_object('ok',false,'reason','tarifa_nao_validada'); end if;
 v_taxa:=t.fixo_centavos+ceil(a.valor_centavos*t.percentual_bps::numeric/10000)::bigint;v_comissao:=round(a.valor_centavos*0.13)::bigint;
 if v_taxa>v_comissao then return jsonb_build_object('ok',false,'reason','tarifa_supera_comissao'); end if;
 insert into public.qf_comissao13_financeiro(id,acordo_id,metodo,txid,split_id,valor_centavos,comissao_centavos,profissional_centavos,taxa_prevista_centavos,recebedor)
 values(v_id,a.id,p_metodo,replace(v_id::text,'-',''),'q13'||replace(v_id::text,'-',''),a.valor_centavos,v_comissao,a.valor_centavos-v_comissao,v_taxa,jsonb_build_object('payee_code',r.payee_code,'conta_efi',r.conta_efi,'documento',r.documento)) on conflict(acordo_id) do nothing returning true into v_novo;
 select * into f from public.qf_comissao13_financeiro where acordo_id=a.id;
 if f.metodo<>p_metodo then return jsonb_build_object('ok',false,'reason','cobranca_ja_criada'); end if;
 return jsonb_build_object('ok',true,'novo',coalesce(v_novo,false),'financeiro_id',f.id,'acordo_id',a.id,'metodo',f.metodo,'valor_centavos',f.valor_centavos,'comissao_centavos',f.comissao_centavos,'profissional_centavos',f.profissional_centavos,'txid',f.txid,'split_id',f.split_id,'recebedor',f.recebedor,'status',f.status,'checkout_url',f.checkout_url,'pix_copia_cola',f.pix_copia_cola,'provedor_id',f.provedor_id);
end $$;
create or replace function public.qf_comissao13_pagamento_emitido(p_id uuid,p_provedor_id text,p_checkout_url text,p_pix_copia_cola text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.qf_comissao13_financeiro;
begin
 select * into f from public.qf_comissao13_financeiro where id=p_id for update;
 if not found or f.status<>'criando' or p_provedor_id is null or length(p_provedor_id)<1 then return jsonb_build_object('ok',false,'reason','estado_invalido'); end if;
 update public.qf_comissao13_financeiro set provedor_id=p_provedor_id,checkout_url=p_checkout_url,pix_copia_cola=p_pix_copia_cola,status='pendente' where id=f.id;
 update public.qf_comissao13_acordos set status='pagamento_pendente' where id=f.acordo_id and status='concluido';
 return jsonb_build_object('ok',true);
end $$;
-- Somente dados reconciliados por consulta autenticada à Efí podem chegar a esta RPC.
create or replace function public.qf_comissao13_financeiro_evento(p_provedor_id text,p_evento_id text,p_tipo text,p_valor_centavos bigint,p_taxa_real_centavos bigint default null,p_estornado_centavos bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.qf_comissao13_financeiro; a public.qf_comissao13_acordos; inserido boolean;
begin
 if p_evento_id is null or length(p_evento_id)<8 or p_tipo not in ('pago','estornado','chargeback','disputa','repassado') or p_valor_centavos is null then return jsonb_build_object('ok',false,'reason','dados_invalidos'); end if;
 select * into f from public.qf_comissao13_financeiro where provedor_id=p_provedor_id for update;
 if not found or p_valor_centavos<>f.valor_centavos then return jsonb_build_object('ok',false,'reason','valor_ou_cobranca_incompativel'); end if;
 select * into a from public.qf_comissao13_acordos where id=f.acordo_id for update;
 if a.concluido_em is null or a.telefone_verificado_em is null then return jsonb_build_object('ok',false,'reason','conclusao_nao_confirmada'); end if;
 if p_estornado_centavos is not null and (p_estornado_centavos<0 or p_estornado_centavos>f.valor_centavos) then return jsonb_build_object('ok',false,'reason','estorno_incompativel'); end if;
 if p_tipo='estornado' and p_estornado_centavos is distinct from f.valor_centavos then return jsonb_build_object('ok',false,'reason','estorno_nao_confirmado'); end if;
 if p_tipo='repassado' and (f.status<>'pago' or a.status in ('contestado','cancelado') or a.pago_em is null or p_taxa_real_centavos is null or p_taxa_real_centavos<0) then return jsonb_build_object('ok',false,'reason','repasse_bloqueado'); end if;
 if p_tipo='pago' and f.status='pago' then return jsonb_build_object('ok',true,'duplicado',true); end if;
 if p_tipo='repassado' and f.repasse_status='concluido' then return jsonb_build_object('ok',true,'duplicado',true); end if;
 if p_tipo='pago' and f.status in ('estornado','chargeback','disputa') then return jsonb_build_object('ok',false,'reason','evento_fora_ordem'); end if;
 insert into private.qf_comissao13_fin_eventos(provedor_evento_id,financeiro_id,tipo,valor_centavos) values(p_evento_id,f.id,p_tipo,p_valor_centavos) on conflict do nothing returning true into inserido;
 if inserido is not true then return jsonb_build_object('ok',true,'duplicado',true); end if;
 if p_tipo='pago' then
  update public.qf_comissao13_financeiro set status='pago',pago_em=coalesce(pago_em,now()),taxa_real_centavos=coalesce(p_taxa_real_centavos,taxa_real_centavos),repasse_status=case when a.status in ('contestado','cancelado') then 'bloqueado' else repasse_status end where id=f.id;
  update public.qf_comissao13_acordos set pago_em=coalesce(pago_em,now()),status=case when status in ('contestado','cancelado') then status else 'pago' end where id=a.id;
 elsif p_tipo='repassado' then
  update public.qf_comissao13_financeiro set repasse_status='concluido',repassado_em=now(),taxa_real_centavos=p_taxa_real_centavos where id=f.id;
  update public.qf_comissao13_acordos set status='repassado',repassado_em=now() where id=a.id;
 else
  update public.qf_comissao13_financeiro set status=p_tipo,repasse_status='bloqueado',estornado_centavos=greatest(estornado_centavos,coalesce(p_estornado_centavos,0)) where id=f.id;
  update public.qf_comissao13_acordos set status='contestado',contestacao='Evento financeiro: '||p_tipo where id=a.id;
 end if;
 insert into public.qf_comissao13_eventos(acordo_id,tipo,idempotency_key,dados) values(a.id,p_tipo,'qf13fin:'||f.id||':'||p_tipo,jsonb_build_object('financeiro_id',f.id,'valor_centavos',p_valor_centavos)) on conflict(idempotency_key) do nothing;
 return jsonb_build_object('ok',true,'tipo',p_tipo);
end $$;
revoke all on function public.qf_comissao13_pagamento_preparar(text,text),public.qf_comissao13_pagamento_emitido(uuid,text,text,text),public.qf_comissao13_financeiro_evento(text,text,text,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.qf_comissao13_pagamento_preparar(text,text),public.qf_comissao13_pagamento_emitido(uuid,text,text,text),public.qf_comissao13_financeiro_evento(text,text,text,bigint,bigint,bigint) to service_role;

create or replace function public.qf_comissao13_desbloquear(p_chamado_id uuid,p_aceitar boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_prof uuid:=auth.uid(); c public.qf_chamados; n integer; d uuid;
begin
 if v_prof is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
 if not private.qf_comissao13_pronto() then return jsonb_build_object('ok',false,'reason','integracao_pendente'); end if;
 if not exists(select 1 from private.qf_comissao13_recebedores where profissional_id=v_prof and status='validado') then return jsonb_build_object('ok',false,'reason','recebedor_nao_validado'); end if;
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
create or replace function public.qf_comissao13_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
 return jsonb_build_object('ok',true,'carteirinha_ativa',exists(select 1 from public.qf_carteirinhas c join public.qf_profiles p on p.id=c.profissional_id where c.profissional_id=auth.uid() and p.ativo and p.tipo='profissional'),
 'aderiu',exists(select 1 from public.qf_comissao13_adesoes where profissional_id=auth.uid() and revogado_em is null and versao_termos='13pct-v1'),
 'recebedor_validado',exists(select 1 from private.qf_comissao13_recebedores where profissional_id=auth.uid() and status='validado'),'comissao_percentual',13,'desbloqueio_gratuito_ativo',private.qf_comissao13_pronto(),'dependencias',jsonb_build_array('OTP ao telefone vinculado','Cobrança e repasse de serviços validados'));
end $$;
create or replace function public.qf_comissao13_painel() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 return coalesce((select jsonb_agg(x) from (select a.id,a.chamado_id,a.desbloqueio_id,a.profissional_id,p.nome as profissional,'comissao13' as modalidade,a.valor_centavos,a.agendado_em,a.status,a.contratado_em,a.concluido_em,a.telefone_verificado_em,a.contestacao,a.pago_em,a.repassado_em,round(a.valor_centavos*0.13)::bigint as comissao_centavos,a.valor_centavos-round(a.valor_centavos*0.13)::bigint as profissional_centavos, f.taxa_real_centavos as taxas_centavos,case when f.taxa_real_centavos is null then 'não apuradas' else (f.taxa_real_centavos/100.0)::text end as taxas, f.status as status_financeiro,f.estornado_centavos,f.repasse_status,case when a.pago_em is null then 'pendente' else 'confirmado' end as pagamento,case when a.repassado_em is null then 'pendente' else 'concluido' end as repasse from public.qf_comissao13_acordos a join public.qf_profiles p on p.id=a.profissional_id left join public.qf_comissao13_financeiro f on f.acordo_id=a.id where a.profissional_id=auth.uid() or private.qf_is_admin() order by a.criado_em desc limit 200) x),'[]'::jsonb);
end $$;

create or replace function private.qf_comissao13_contestacao_financeira() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('contestado','cancelado') and new.status is distinct from old.status then
  update public.qf_comissao13_financeiro set repasse_status=case when repassado_em is null then 'bloqueado' else repasse_status end where acordo_id=new.id;
 end if;
 return new;
end $$;
revoke all on function private.qf_comissao13_contestacao_financeira() from public,anon,authenticated;
drop trigger if exists qf13_contestacao_financeira on public.qf_comissao13_acordos;
create trigger qf13_contestacao_financeira after update of status on public.qf_comissao13_acordos for each row execute function private.qf_comissao13_contestacao_financeira();

create or replace function public.qf_comissao13_codigo_criar(p_token text,p_finalidade text,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.qf_comissao13_acordos; k uuid;
begin
 select * into a from public.qf_comissao13_acordos where id=private.qf_comissao13_acordo_token(p_token) for update;
 if not found then return jsonb_build_object('ok',false,'reason','link_invalido'); end if;
 if not exists(select 1 from public.qf_chamados c join public.qf_desbloqueios d on d.chamado_id=c.id where c.id=a.chamado_id and d.id=a.desbloqueio_id and d.ativo and c.status not in ('cancelado','expirado','finalizado')) then return jsonb_build_object('ok',false,'reason','estado_invalido'); end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_finalidade is null or p_finalidade not in ('contratar','concluir','contestar') then return jsonb_build_object('ok',false,'reason','dados_invalidos'); end if;
 if (p_finalidade='contratar' and a.status<>'proposto') or (p_finalidade='concluir' and (a.status<>'contratado' or a.agendado_em>now())) or (p_finalidade='contestar' and a.status not in ('proposto','contratado','concluido','pagamento_pendente','pago','repasse_pendente','repassado')) then return jsonb_build_object('ok',false,'reason','estado_invalido'); end if;
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
 elsif p_finalidade='contestar' and a.status in ('proposto','contratado','concluido','pagamento_pendente','pago','repasse_pendente','repassado') and length(trim(coalesce(p_motivo,'')))>=8 then s:='contestado';
 else return jsonb_build_object('ok',false,'reason','estado_invalido'); end if;
 update private.qf_comissao13_codigos set usado_em=now() where id=k.id;
 update public.qf_comissao13_acordos set status=s,telefone_verificado_em=now(),contratado_em=case when s='contratado' then now() else contratado_em end,concluido_em=case when s='concluido' then now() else concluido_em end,contestacao=case when s='contestado' then left(p_motivo,2000) else contestacao end where id=a.id;
 insert into public.qf_comissao13_eventos(acordo_id,tipo,idempotency_key,dados) values(a.id,s,a.id||':'||s,jsonb_build_object('verificacao','telefone_otp','codigo_id',k.id));
 return jsonb_build_object('ok',true,'status',s,'pagamento_disponivel',false);
end $$;
grant select,update on public.qf_comissao13_financeiro to service_role;

create or replace function public.qf_comissao13_aderir(p_aceitar boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_prof uuid := auth.uid();
begin
 if v_prof is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
 if not exists(select 1 from public.qf_profissionais pr join public.qf_profiles p on p.id=pr.user_id where pr.user_id=v_prof and p.ativo=true and p.tipo='profissional') then
   return jsonb_build_object('ok',false,'reason','perfil_inativo'); end if;
 if not exists(select 1 from public.qf_carteirinhas c where c.profissional_id=v_prof) then
   return jsonb_build_object('ok',false,'reason','carteirinha_necessaria'); end if;
 if p_aceitar is distinct from true then return jsonb_build_object('ok',false,'reason','aceite_obrigatorio'); end if;
 insert into public.qf_comissao13_adesoes(profissional_id,versao_termos,aceito_em,revogado_em)
 values(v_prof,'13pct-v1',now(),null)
 on conflict(profissional_id) do update set versao_termos=excluded.versao_termos,aceito_em=now(),revogado_em=null;
 return jsonb_build_object('ok',true,'modalidade','comissao13','comissao_percentual',13,'desbloqueio_gratuito_ativo',private.qf_comissao13_pronto());
end $$;
