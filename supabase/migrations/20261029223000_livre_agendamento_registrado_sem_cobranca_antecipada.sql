-- Quem Faz Livre: proposta com descrição e data agendada, sem cobrança antecipada.
alter table public.qf_comissao13_fechamentos
  add column if not exists agendado_em timestamptz,
  add column if not exists descricao_proposta text;

create or replace function public.qf_livre_proposta_agendada(
 p_chamado_id uuid, p_profissional_id uuid, p_valor_centavos bigint,
 p_agendado_em timestamptz default null, p_descricao text default null
) returns jsonb
language plpgsql security definer set search_path to ''
as $livre$
declare result jsonb; v_id uuid;
begin
 if auth.uid() is null or auth.uid()<>p_profissional_id
 then return jsonb_build_object('ok',false,'reason','sem_permissao');end if;
 if p_valor_centavos is null or p_valor_centavos not between 100 and 100000000
 then return jsonb_build_object('ok',false,'reason','valor_invalido');end if;
 if length(trim(coalesce(p_descricao,''))) < 10 or length(p_descricao)>600
 then return jsonb_build_object('ok',false,'reason','descricao_obrigatoria');end if;
 if p_agendado_em is not null
  and (p_agendado_em<=now() or p_agendado_em>now()+interval '365 days')
 then return jsonb_build_object('ok',false,'reason','data_invalida');end if;
 -- Mesma transação para proposta e dados de agendamento.
 result:=public.qf_chat_contratacao(p_chamado_id,p_profissional_id,'propor',p_valor_centavos,null,false);
 if not coalesce((result->>'ok')::boolean,false) then return result;end if;
 update public.qf_comissao13_fechamentos f set
  agendado_em=p_agendado_em,descricao_proposta=left(trim(p_descricao),600),
  prestado_em=coalesce(f.prestado_em,now())
 from public.qf_desbloqueios d
 where f.chamado_id=p_chamado_id and f.profissional_id=p_profissional_id
 and d.id=f.desbloqueio_id and d.origem='comissao13' and coalesce(d.ativo,true);
 if not found then raise exception 'desbloqueio do Plano Livre não localizado após proposta';end if;
 return result || jsonb_build_object('agendado_em',p_agendado_em,'descricao_proposta',left(trim(p_descricao),600),'comissao_devida',false);
end $livre$;

create or replace function public.qf_livre_agendamento_ver(
 p_chamado_id uuid, p_profissional_id uuid
) returns jsonb language plpgsql security definer set search_path to ''
as $livre$
declare f public.qf_comissao13_fechamentos; v_cliente uuid;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 select cliente_id into v_cliente from public.qf_chamados where id=p_chamado_id;
 if v_cliente is null or (auth.uid()<>v_cliente and auth.uid()<>p_profissional_id)
 then return jsonb_build_object('ok',false,'reason','sem_permissao');end if;
 select x.* into f from public.qf_comissao13_fechamentos x
 join public.qf_desbloqueios d on d.id=x.desbloqueio_id
 where x.chamado_id=p_chamado_id and x.profissional_id=p_profissional_id
 and d.origem='comissao13' and d.chamado_id=p_chamado_id
 and d.profissional_id=p_profissional_id and coalesce(d.ativo,true);
 if not found then return jsonb_build_object('ok',false,'reason','nao_plano_livre');end if;
 return jsonb_build_object('ok',true,'descricao_proposta',f.descricao_proposta,
 'agendado_em',f.agendado_em,'proposta_em',f.proposta_chat_em,
 'contratado_em',f.contratado_em,'cliente_aceitou',f.contratado_em is not null,
 'concluido_em',f.cliente_concluiu_em,'valor_centavos',f.valor_informado_centavos,
 'status',f.status);
end $livre$;

create or replace function public.qf_livre_agendamentos_admin()
returns jsonb language plpgsql security definer set search_path to ''
as $livre$
declare data jsonb;
begin
 if auth.uid() is null or not private.qf_is_admin()
 then return jsonb_build_object('ok',false,'reason','admin_obrigatorio');end if;
 select coalesce(jsonb_agg(row_data order by data_agendada), '[]'::jsonb) into data
 from (
  select jsonb_build_object('chamado_id',f.chamado_id,'fechamento_id',f.id,
   'profissional',p.nome,'servico',c.titulo,'cidade',c.cidade,
   'data',f.agendado_em,'valor_centavos',f.valor_informado_centavos,
   'aceito',f.contratado_em is not null,'concluido',f.cliente_concluiu_em is not null,
   'descricao',f.descricao_proposta,'situacao',f.status) as row_data,
   f.agendado_em as data_agendada
  from public.qf_comissao13_fechamentos f
  join public.qf_desbloqueios d on d.id=f.desbloqueio_id and d.origem='comissao13'
  join public.qf_chamados c on c.id=f.chamado_id
  join public.qf_profiles p on p.id=f.profissional_id
  where f.agendado_em is not null
   and f.agendado_em>=now()-interval '30 days'
  order by f.agendado_em desc limit 100
 ) source;
 return jsonb_build_object('ok',true,'items',data);
end $livre$;

-- Mesmo código já existente. Só bloqueia encerramento anterior à data aceita.
CREATE OR REPLACE FUNCTION private.qf13_concluir_com_codigo(p_id uuid, p_valor bigint, p_codigo text, p_concluido boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f public.qf_comissao13_fechamentos;v_hash text;r jsonb;
begin
 perform 1 from public.qf_chamados where id=(select chamado_id from public.qf_comissao13_fechamentos where id=p_id) for update;
 select * into f from public.qf_comissao13_fechamentos where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
 if f.agendado_em is not null and f.agendado_em > now()
 then return jsonb_build_object('ok',false,'reason','servico_ainda_agendado','agendado_em',f.agendado_em);
 end if;
 if p_concluido is distinct from true then return jsonb_build_object('ok',false,'reason','conclusao_obrigatoria');end if;
 if p_codigo is null or p_codigo!~'^[0-9]{6}$' then return jsonb_build_object('ok',false,'reason','codigo_obrigatorio');end if;
 if f.codigo_tentativas>=5 and f.codigo_tentativa_em>now()-interval '1 hour' then return jsonb_build_object('ok',false,'reason','limite_codigo');end if;
 select codigo_hash into v_hash from private.qf13_codigos_pedido where chamado_id=f.chamado_id;
 if v_hash is null or v_hash<>encode(extensions.digest(f.chamado_id::text||':'||p_codigo,'sha256'),'hex') then
  update public.qf_comissao13_fechamentos set codigo_tentativas=case when codigo_tentativa_em is null or codigo_tentativa_em<now()-interval '1 hour' then 1 else codigo_tentativas+1 end,codigo_tentativa_em=now() where id=p_id;
  return jsonb_build_object('ok',false,'reason','codigo_invalido');
 end if;
 -- A função existente bloqueia o pedido, confere o valor e impede dois contratados e cobrança repetida.
 r:=private.qf13_confirmar_valor(p_id,p_valor);
 if coalesce((r->>'ok')::boolean,false) then
  update public.qf_comissao13_fechamentos set codigo_validado_em=coalesce(codigo_validado_em,now()),cliente_concluiu_em=coalesce(cliente_concluiu_em,now()),
  observacao_admin=case when confirmado_por is null then 'Cliente confirmou contratação, valor e conclusão com código do pedido; comissão automática de 13%' else observacao_admin end
  where id=p_id;
 end if;
 return r;
end $function$
;

revoke all on function public.qf_livre_proposta_agendada(uuid,uuid,bigint,timestamptz,text) from public,anon;
revoke all on function public.qf_livre_agendamento_ver(uuid,uuid) from public,anon;
revoke all on function public.qf_livre_agendamentos_admin() from public,anon;
grant execute on function public.qf_livre_proposta_agendada(uuid,uuid,bigint,timestamptz,text) to authenticated;
grant execute on function public.qf_livre_agendamento_ver(uuid,uuid) to authenticated;
grant execute on function public.qf_livre_agendamentos_admin() to authenticated;
