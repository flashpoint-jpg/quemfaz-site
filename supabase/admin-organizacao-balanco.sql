-- Administrative list controls preserve operational and financial history.
create table if not exists private.qf_admin_lista_controles (
 tipo text not null check(tipo in ('negociacao','cadastro')), chave text not null,
 excluido boolean not null default false, observacao text not null default '',
 atualizado_em timestamptz not null default now(), ator uuid not null,
 primary key(tipo,chave)
);
alter table private.qf_admin_lista_controles enable row level security;
revoke all on private.qf_admin_lista_controles from public,anon,authenticated;
create table if not exists private.qf_admin_lista_auditoria (
 id bigint generated always as identity primary key, tipo text not null, chave text not null,
 antes jsonb, depois jsonb not null, ator uuid not null, criado_em timestamptz not null default now()
);
alter table private.qf_admin_lista_auditoria enable row level security;
revoke all on private.qf_admin_lista_auditoria from public,anon,authenticated;

create or replace function private.qf_admin_lista_controle(p_tipo text, p_chave text default null, p_dados jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_antes jsonb; v_depois jsonb; v_f public.qf_comissao13_fechamentos; v_valor bigint;
begin
 if auth.uid() is null or not coalesce(private.qf_is_admin(),false) then raise exception 'Acesso administrativo obrigatório' using errcode='42501'; end if;
 if p_tipo is null or p_tipo not in ('negociacao','cadastro') then raise exception 'Tipo inválido'; end if;
 if p_dados is null then
  return coalesce((select jsonb_agg(to_jsonb(c)) from private.qf_admin_lista_controles c where tipo=p_tipo),'[]');
 end if;
 if p_chave is null or length(p_chave)>320 then raise exception 'Registro inválido'; end if;
 if p_tipo='cadastro' then p_chave:=lower(trim(p_chave)); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tipo||p_chave,0));
 if p_tipo='negociacao' then
  if not exists(select 1 from public.qf_desbloqueios where id=p_chave::uuid) then raise exception 'Negociação não encontrada'; end if;
 else
  if not exists(select 1 from public.qf_profiles where lower(trim(email))=p_chave and tipo='profissional') and not exists(select 1 from public.qf_pre_cadastro_pagamentos where lower(trim(email))=p_chave) then raise exception 'Cadastro não encontrado'; end if;
 end if;
 select to_jsonb(c) into v_antes from private.qf_admin_lista_controles c where tipo=p_tipo and chave=p_chave for update;
 if length(coalesce(p_dados->>'observacao',''))>2000 then raise exception 'Observação excede 2000 caracteres'; end if;
 if p_dados ? 'valor_centavos' then
  if p_tipo<>'negociacao' then raise exception 'Ação inválida'; end if;
  select * into v_f from public.qf_comissao13_fechamentos where desbloqueio_id=p_chave::uuid for update;
  if v_f.id is null or v_f.status='confirmado' or v_f.contratado_em is not null or v_f.cliente_resposta='confirmado' or v_f.cobranca_status in ('pendente','paga') then raise exception 'Orçamento aceito ou cobrado. Use a revisão de comissão no financeiro.'; end if;
  v_valor:=(p_dados->>'valor_centavos')::bigint;
  if v_valor is null or v_valor<1 or v_valor>100000000 then raise exception 'Valor inválido'; end if;
  update public.qf_comissao13_fechamentos set valor_informado_centavos=v_valor, observacao_admin=p_dados->>'observacao' where id=v_f.id;
 end if;
 insert into private.qf_admin_lista_controles(tipo,chave,excluido,observacao,ator)
 values(p_tipo,p_chave,coalesce((p_dados->>'excluido')::boolean,false),coalesce(p_dados->>'observacao',''),auth.uid())
 on conflict(tipo,chave) do update set excluido=coalesce((p_dados->>'excluido')::boolean,qf_admin_lista_controles.excluido),
 observacao=coalesce(p_dados->>'observacao',qf_admin_lista_controles.observacao),atualizado_em=now(),ator=auth.uid()
 returning to_jsonb(qf_admin_lista_controles.*) into v_depois;
 insert into private.qf_admin_lista_auditoria(tipo,chave,antes,depois,ator)
 values(p_tipo,p_chave,v_antes,v_depois||jsonb_build_object('alteracoes',p_dados,'orcamento_anterior',v_f.valor_informado_centavos),auth.uid());
 return jsonb_build_object('ok',true,'registro',v_depois);
end $$;
revoke all on function private.qf_admin_lista_controle(text,text,jsonb) from public,anon,authenticated;
create or replace function public.qf_admin_lista_controle(p_tipo text,p_chave text default null,p_dados jsonb default null)
returns jsonb language sql set search_path='' as $$select private.qf_admin_lista_controle(p_tipo,p_chave,p_dados)$$;
grant execute on function private.qf_admin_lista_controle(text,text,jsonb) to authenticated;
revoke all on function public.qf_admin_lista_controle(text,text,jsonb) from public,anon;
grant execute on function public.qf_admin_lista_controle(text,text,jsonb) to authenticated;

create or replace function private.qf_admin_balanco(p_dias integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_ini timestamptz; v_result jsonb;
begin
 if auth.uid() is null or not coalesce(private.qf_is_admin(),false) then raise exception 'Acesso administrativo obrigatório' using errcode='42501'; end if;
 v_ini:=(date_trunc('day',now() at time zone 'America/Sao_Paulo')-make_interval(days=>greatest(1,least(coalesce(p_dias,1),365))-1)) at time zone 'America/Sao_Paulo';
 with eventos as (
  select 'recarga:'||r.id id,coalesce(r.aprovado_em,r.atualizado_em,r.criado_em) em,case when r.plano is null then 'Recarga' else 'Plano' end tipo,r.valor_centavos::bigint entrada,0::bigint saida,
   '/admin/profissionais/'||r.profissional_id rota
  from public.qf_recargas r where r.status='aprovado' and r.provedor='efi' and nullif(r.provedor_id,'') is not null
  union all select 'pre:'||g.id,coalesce(g.aprovado_em,g.criado_em),'Plano',g.valor_centavos,0,'/admin/planos'
  from public.qf_pre_cadastro_pagamentos g where g.status='aprovado' and g.provedor='efi' and nullif(g.provedor_id,'') is not null and g.recarga_id is null
  and not exists(select 1 from public.qf_recargas r where r.provedor_id=g.provedor_id)
  union all select 'urgente:'||u.id,coalesce(u.aprovado_em,u.criado_em),'Pedido urgente',u.valor_centavos,0,'/admin/servicos/'||u.chamado_id
  from public.qf_prioridade_pagamentos u where u.status='aprovado' and u.provedor='efi' and nullif(u.provedor_id,'') is not null
  union all select 'anuncio:'||a.id,coalesce(a.aprovado_em,a.criado_em),'Anúncio',a.valor_centavos,0,'/admin/anuncios'
  from public.qf_anuncio_pagamentos a where a.status='aprovado' and a.provedor='efi' and nullif(a.provedor_id,'') is not null
  union all select 'comissao:'||p.id,p.pago_em,'Comissão',p.valor_centavos,0,'/admin/comissao13'
  from public.qf_comissao13_pix p where p.pago_em is not null and nullif(p.end_to_end_id,'') is not null
  union all select 'manual:'||p.id,p.confirmado_em,'Serviço recebido',p.valor_centavos,0,'/admin/servicos/'||p.chamado_id
  from private.qf_livre_manual_pix p where p.confirmado_em is not null and nullif(p.end_to_end_id,'') is not null
  union all select 'manual_saida:'||p.id,p.repassado_em,'Repasse',0,p.profissional_centavos,'/admin/servicos/'||p.chamado_id
  from private.qf_livre_manual_pix p where p.status='repassado' and p.repassado_em is not null and nullif(p.end_to_end_id,'') is not null
  union all select 'split:'||p.id,p.confirmado_em,'Serviço recebido',p.valor_centavos,0,'/admin/servicos/'||p.chamado_id
  from private.qf_livre_split_pagamentos p where p.confirmado_em is not null and nullif(p.end_to_end_id,'') is not null
   and not exists(select 1 from private.qf_livre_manual_pix m where m.end_to_end_id=p.end_to_end_id)
  union all select 'split_saida:'||p.id,p.repassado_em,'Repasse',0,p.profissional_centavos,'/admin/servicos/'||p.chamado_id
  from private.qf_livre_split_pagamentos p where p.status='repassado' and p.repassado_em is not null and nullif(p.end_to_end_id,'') is not null
   and not exists(select 1 from private.qf_livre_manual_pix m where m.end_to_end_id=p.end_to_end_id)
  union all select 'financeiro:'||f.id,f.pago_em,'Serviço recebido',f.valor_centavos,0,'/admin/financeiro'
  from public.qf_comissao13_financeiro f where f.pago_em is not null and nullif(f.provedor_id,'') is not null
  union all select 'financeiro_saida:'||f.id,f.repassado_em,'Repasse',0,f.profissional_centavos,'/admin/financeiro'
  from public.qf_comissao13_financeiro f where f.repasse_status='concluido' and f.repassado_em is not null
  union all select 'financeiro_taxa:'||f.id,coalesce(f.repassado_em,f.pago_em),'Tarifa registrada',0,f.taxa_real_centavos,'/admin/financeiro'
  from public.qf_comissao13_financeiro f where f.pago_em is not null and f.taxa_real_centavos>0
  union all select 'financeiro_estorno:'||f.id,(select max(e.criado_em) from private.qf_comissao13_fin_eventos e where e.financeiro_id=f.id and e.tipo in ('estornado','chargeback')),'Estorno registrado',0,f.estornado_centavos,'/admin/financeiro'
  from public.qf_comissao13_financeiro f where f.estornado_centavos>0
 ), periodo as(select * from eventos where em>=v_ini and em<=now())
 select jsonb_build_object('ok',true,'desde',v_ini,'gerado_em',now(),
  'entradas_centavos',coalesce(sum(entrada),0),'saidas_centavos',coalesce(sum(saida),0),
  'saldo_periodo_centavos',coalesce(sum(entrada-saida),0),
  'planos_centavos',coalesce(sum(entrada) filter(where tipo='Plano'),0),
  'eventos',coalesce((select jsonb_agg(to_jsonb(e) order by e.em desc) from (select * from periodo order by em desc,id limit 100) e),'[]'),
  'eventos_total',count(*),
  'fechamentos',(select count(*) from public.qf_comissao13_fechamentos where contratado_em>=v_ini),
  'comissoes_pendentes_centavos',(select coalesce(sum(comissao_centavos),0) from public.qf_comissao13_fechamentos where status='confirmado' and cobranca_status='pendente')
 ) into v_result from periodo;
 return v_result;
end $$;
revoke all on function private.qf_admin_balanco(integer) from public,anon;
grant execute on function private.qf_admin_balanco(integer) to authenticated;
create or replace function public.qf_admin_balanco(p_dias integer default 1)
returns jsonb language sql set search_path='' as $$select private.qf_admin_balanco(p_dias)$$;
revoke all on function public.qf_admin_balanco(integer) from public,anon;
grant execute on function public.qf_admin_balanco(integer) to authenticated;

