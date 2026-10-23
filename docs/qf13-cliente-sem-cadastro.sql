-- Estende os registros existentes; não cria outra cobrança nem outro fluxo financeiro.
alter table public.qf_comissao13_fechamentos add column if not exists prorrogacoes_negociacao integer not null default 0;
alter table public.qf_comissao13_fechamentos add column if not exists cliente_resposta text;
alter table public.qf_comissao13_fechamentos add column if not exists cliente_respondeu_em timestamptz;
alter table private.qf_comissao13_links alter column acordo_id drop not null;
alter table private.qf_comissao13_links add column if not exists fechamento_id uuid references public.qf_comissao13_fechamentos(id);
alter table private.qf_comissao13_links add column if not exists usado_em timestamptz;
alter table private.qf_comissao13_links add column if not exists codigo_servico_hash text;
alter table private.qf_comissao13_links add column if not exists telefone_vinculado text;
create index if not exists qf13_links_fechamento_idx on private.qf_comissao13_links(fechamento_id,criado_em desc);
alter table private.qf_comissao13_codigos alter column acordo_id drop not null;
alter table private.qf_comissao13_codigos add column if not exists link_id uuid references private.qf_comissao13_links(id);
create index if not exists qf13_codigos_link_idx on private.qf_comissao13_codigos(link_id,criado_em desc);

create or replace function private.qf13_link_emitir(p_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare t text:=encode(extensions.gen_random_bytes(32),'hex');v_telefone text;
begin
 select telefone_vinculado into v_telefone from private.qf_comissao13_links where fechamento_id=p_id and telefone_vinculado is not null order by criado_em,id limit 1;
 if v_telefone is null then select coalesce(nullif(p.whatsapp,''),p.telefone) into v_telefone from public.qf_comissao13_fechamentos f join public.qf_chamados c on c.id=f.chamado_id join public.qf_profiles p on p.id=c.cliente_id where f.id=p_id;end if;
 insert into private.qf_comissao13_links(fechamento_id,token_hash,expira_em,telefone_vinculado) values(p_id,encode(extensions.digest(t,'sha256'),'hex'),now()+interval '7 days',v_telefone);
 return '/comissao13.html#fluxo=prestacao&token='||t;
end $$;
revoke all on function private.qf13_link_emitir(uuid) from public,anon,authenticated;

-- A sessão localiza o pedido, mas a resposta exige também o SMS no telefone original.
create or replace function public.qf13_cliente_abrir(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.qf_comissao13_fechamentos;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','sem_permissao');end if;
 select f0.* into f from public.qf_comissao13_fechamentos f0 join public.qf_chamados c on c.id=f0.chamado_id where f0.id=p_id and (c.cliente_id=auth.uid() or private.qf_is_admin()) for update of f0;
 if not found or f.status not in ('pendente','negociando','informado','recusado') or f.cliente_respondeu_em is not null then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
 if (select count(*) from private.qf_comissao13_links where fechamento_id=p_id and criado_em>now()-interval '1 hour')>=5 then return jsonb_build_object('ok',false,'reason','limite');end if;
 return jsonb_build_object('ok',true,'url',private.qf13_link_emitir(p_id));
end $$;
revoke all on function public.qf13_cliente_abrir(uuid) from public,anon;
grant execute on function public.qf13_cliente_abrir(uuid) to authenticated;

-- Somente a Edge Function pode preparar ou validar o OTP. Nunca recebe telefone do navegador.
create or replace function public.qf13_cliente_guest(p_token text,p_acao text,p_finalidade text default null,p_hash text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare l private.qf_comissao13_links;f public.qf_comissao13_fechamentos;k private.qf_comissao13_codigos;v_telefone text;v_nome text;v_titulo text;v_codigo text;v_id uuid;v_resposta text;
begin
 if p_token is null or p_token!~'^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'reason','link_invalido');end if;
 select * into l from private.qf_comissao13_links where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and fechamento_id is not null and expira_em>now() and usado_em is null for update;
 if not found then return jsonb_build_object('ok',false,'reason','link_invalido');end if;
 select * into f from public.qf_comissao13_fechamentos where id=l.fechamento_id for update;
 if f.status not in ('pendente','negociando','informado','recusado') or f.cliente_respondeu_em is not null then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
 select coalesce(nullif(p.whatsapp,''),p.telefone),c.titulo into v_telefone,v_titulo from public.qf_chamados c join public.qf_profiles p on p.id=c.cliente_id where c.id=f.chamado_id;
 v_telefone:=l.telefone_vinculado;
 select nome into v_nome from public.qf_profiles where id=f.profissional_id;
 if p_acao='info' then return jsonb_build_object('ok',true,'profissional',v_nome,'pedido',v_titulo,'status',f.status,'telefone_final',right(v_telefone,4),'valor_centavos',f.valor_informado_centavos);end if;
 if p_finalidade is null or p_finalidade not in ('contratou','nao_contratou') or p_hash is null or p_hash!~'^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'reason','dados_invalidos');end if;
 if p_acao='criar' then
  if exists(select 1 from private.qf_comissao13_codigos where link_id=l.id and criado_em>now()-interval '1 minute') or (select count(*) from private.qf_comissao13_codigos k0 join private.qf_comissao13_links l0 on l0.id=k0.link_id where l0.fechamento_id=f.id and k0.criado_em>now()-interval '1 hour')>=5 then return jsonb_build_object('ok',false,'reason','limite');end if;
  insert into private.qf_comissao13_codigos(link_id,finalidade,hash,expira_em) values(l.id,'contratar',p_hash,now()+interval '5 minutes') returning id into v_id;
  return jsonb_build_object('ok',true,'codigo_id',v_id,'telefone',v_telefone);
 elsif p_acao='confirmar' then
  select * into k from private.qf_comissao13_codigos where link_id=l.id order by criado_em desc,id desc limit 1 for update;
  if not found or k.usado_em is not null or k.enviado_em is null or k.expira_em<=now() or k.tentativas>=5 then return jsonb_build_object('ok',false,'reason','codigo_invalido');end if;
  update private.qf_comissao13_codigos set tentativas=tentativas+1 where id=k.id;
  if p_hash<>k.hash then return jsonb_build_object('ok',false,'reason','codigo_invalido');end if;
  v_resposta:=case when p_finalidade='contratou' then case when f.status='recusado' then 'divergencia' else 'contratou' end else case when f.status='informado' then 'divergencia' else 'nao_contratou' end end;
  if p_finalidade='contratou' and f.status in ('pendente','negociando') then v_codigo:=private.qf13_codigo_novo();end if;
  update private.qf_comissao13_codigos set usado_em=now() where id=k.id;
  update private.qf_comissao13_links set usado_em=now(),codigo_servico_hash=case when v_codigo is not null then encode(extensions.digest(f.id::text||':'||v_codigo,'sha256'),'hex') end where id=l.id;
  update public.qf_comissao13_fechamentos set cliente_resposta=v_resposta,cliente_respondeu_em=now() where id=f.id;
  return jsonb_build_object('ok',true,'resposta',v_resposta,'codigo_servico',v_codigo,'requer_analise_admin',true,'comissao_devida',false);
 end if;
 return jsonb_build_object('ok',false,'reason','acao_invalida');
end $$;
revoke all on function public.qf13_cliente_guest(text,text,text,text) from public,anon,authenticated;
grant execute on function public.qf13_cliente_guest(text,text,text,text) to service_role;

-- Desativa a confirmação baseada só na sessão: clientes rápidos não validam o telefone no login.
create or replace function public.qf13_cliente_verificar_nao_fechou(p_fechamento uuid,p_contratou boolean) returns jsonb language sql set search_path='' as $$select jsonb_build_object('ok',false,'reason','verificacao_telefone_obrigatoria')$$;

create or replace function private.qf13_notificar_cliente() returns trigger language plpgsql security definer set search_path='' as $$
declare v_cliente uuid;v_rota text;
begin
 if tg_op='UPDATE' then if new.status<>'recusado' or old.status=new.status then return new;end if;end if;
 select cliente_id into v_cliente from public.qf_chamados where id=new.chamado_id;
 v_rota:=private.qf13_link_emitir(new.id);
 insert into private.qf_comissao13_notificacoes(user_id,chave,titulo,corpo,rota) values(v_cliente,'fechamento13:'||new.id||':'||new.status,'Confirme a contratação no Quem Faz',case when new.status='recusado' then 'O profissional informou que não fechou. Confirme se houve contratação.' else 'Um profissional liberou seu contato. Quando contratar, confirme com segurança.' end,v_rota) on conflict(user_id,chave) do nothing;
 return new;
end $$;
revoke all on function private.qf13_notificar_cliente() from public,anon,authenticated;
drop trigger if exists qf13_notificar_cliente on public.qf_comissao13_fechamentos;
create trigger qf13_notificar_cliente after insert or update of status on public.qf_comissao13_fechamentos for each row execute function private.qf13_notificar_cliente();

create or replace function private.qf_comissao13_despachar() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.qf13_simplificado_ativo() then perform private.qf_push_interno('comissao13_queue',new.id);end if;return new;
end $$;

CREATE OR REPLACE FUNCTION public.qf_comissao13_prestar_contas(p_id uuid, p_situacao text, p_valor_centavos bigint DEFAULT NULL::bigint, p_codigo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ DECLARE f public.qf_comissao13_fechamentos; h text; BEGIN IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','nao_autenticado'); END IF; SELECT * INTO f FROM public.qf_comissao13_fechamentos WHERE id=p_id AND profissional_id=auth.uid() FOR UPDATE; IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','sem_permissao'); END IF; IF f.status NOT IN ('pendente','negociando') THEN RETURN jsonb_build_object('ok',false,'reason','ja_prestado'); END IF; IF p_situacao NOT IN ('informado','negociando','recusado') OR p_situacao IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','situacao_invalida'); END IF; IF p_situacao='negociando' AND f.prorrogacoes_negociacao>=1 THEN RETURN jsonb_build_object('ok',false,'reason','limite_prorrogacao'); END IF; IF p_situacao='informado' THEN IF p_valor_centavos IS NULL OR p_valor_centavos NOT BETWEEN 100 AND 100000000 THEN RETURN jsonb_build_object('ok',false,'reason','valor_invalido'); END IF; IF f.codigo_tentativas>=5 AND f.codigo_tentativa_em>now()-interval '1 hour' THEN RETURN jsonb_build_object('ok',false,'reason','limite_codigo'); END IF; SELECT codigo_hash INTO h FROM private.qf13_codigos_pedido WHERE chamado_id=f.chamado_id; IF p_codigo IS NULL OR p_codigo !~ '^[0-9]{6}$' OR (NOT EXISTS(select 1 from private.qf_comissao13_links l where l.fechamento_id=f.id and l.usado_em is not null and l.codigo_servico_hash=encode(extensions.digest(f.id::text||':'||p_codigo,'sha256'),'hex')) AND (h IS NULL OR h<>encode(extensions.digest(f.chamado_id::text||':'||p_codigo,'sha256'),'hex'))) THEN UPDATE public.qf_comissao13_fechamentos SET codigo_tentativas=CASE WHEN codigo_tentativa_em<now()-interval '1 hour' THEN 1 ELSE codigo_tentativas+1 END,codigo_tentativa_em=now() WHERE id=p_id; RETURN jsonb_build_object('ok',false,'reason',CASE WHEN h IS NULL THEN 'codigo_nao_emitido_contate_suporte' ELSE 'codigo_invalido' END); END IF; END IF; UPDATE public.qf_comissao13_fechamentos SET status=p_situacao,valor_informado_centavos=CASE WHEN p_situacao='informado' THEN p_valor_centavos ELSE NULL END,prestado_em=now(),informado_em=now(),prazo_contas=CASE WHEN p_situacao='negociando' THEN now()+interval '48 hours' ELSE prazo_contas END,prorrogacoes_negociacao=CASE WHEN p_situacao='negociando' THEN prorrogacoes_negociacao+1 ELSE prorrogacoes_negociacao END,codigo_validado_em=CASE WHEN p_situacao='informado' THEN now() ELSE NULL END WHERE id=p_id; RETURN jsonb_build_object('ok',true,'status',p_situacao,'comissao_devida',false); END $function$;

CREATE OR REPLACE FUNCTION public.qf_comissao13_fechamentos_painel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null then raise exception 'authentication required';end if;
 return coalesce((select jsonb_agg(x order by x.informado_em desc) from (select f.*,p.nome as profissional,cl.nome as cliente,cl.telefone,cl.whatsapp,c.titulo from public.qf_comissao13_fechamentos f join public.qf_chamados c on c.id=f.chamado_id join public.qf_profiles p on p.id=f.profissional_id join public.qf_profiles cl on cl.id=c.cliente_id where f.profissional_id=auth.uid() or private.qf_is_admin() order by f.informado_em desc ) x),'[]'::jsonb);
end $function$;

create or replace function public.qf13_admin_historico(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin authentication required';end if;
 return jsonb_build_object('eventos',coalesce((select jsonb_agg(jsonb_build_object('em',a.criado_em,'ator',a.ator,'antes',a.antes,'depois',a.depois) order by a.criado_em desc,a.id) from private.qf13_auditoria a where a.fechamento_id=p_id),'[]'::jsonb),'notificacoes',coalesce((select jsonb_agg(jsonb_build_object('status',n.status,'erro',n.erro,'em',n.criado_em,'tentativas',n.tentativas) order by n.criado_em desc) from private.qf_comissao13_notificacoes n where n.chave like 'fechamento13:'||p_id||':%'),'[]'::jsonb));
end $$;
revoke all on function public.qf13_admin_historico(uuid) from public,anon;
grant execute on function public.qf13_admin_historico(uuid) to authenticated;
create or replace function public.qf13_cliente_pendencias() returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'chamado_id',f.chamado_id,'profissional',p.nome,'informado_em',f.informado_em) order by f.informado_em desc),'[]'::jsonb) from public.qf_comissao13_fechamentos f join public.qf_chamados c on c.id=f.chamado_id join public.qf_profiles p on p.id=f.profissional_id where auth.uid() is not null and c.cliente_id=auth.uid() and f.status in ('pendente','negociando','informado','recusado') and f.cliente_respondeu_em is null
$$;
