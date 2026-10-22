-- Piloto simplificado: cliente paga diretamente ao profissional; comissão somente após revisão administrativa.
create table if not exists private.qf_comissao13_config(id boolean primary key default true check(id),ativo boolean not null default false,atualizado_em timestamptz not null default now());
insert into private.qf_comissao13_config(id,ativo) values(true,false) on conflict do nothing;
alter table private.qf_comissao13_config enable row level security;
revoke all on private.qf_comissao13_config from public,anon,authenticated;
create table if not exists public.qf_comissao13_fechamentos(
 id uuid primary key default gen_random_uuid(),desbloqueio_id uuid not null unique references public.qf_desbloqueios(id),chamado_id uuid not null references public.qf_chamados(id),profissional_id uuid not null references public.qf_profissionais(user_id),
 valor_informado_centavos bigint,valor_confirmado_centavos bigint check(valor_confirmado_centavos between 100 and 100000000),comissao_percentual integer not null default 13 check(comissao_percentual=13),comissao_centavos bigint,
 status text not null default 'pendente',cobranca_status text not null default 'nao_gerada' check(cobranca_status in ('nao_gerada','pendente','paga','cancelada')),informado_em timestamptz not null default now(),confirmado_em timestamptz,confirmado_por uuid,observacao_admin text
);
alter table public.qf_comissao13_fechamentos alter column valor_informado_centavos drop not null;
alter table public.qf_comissao13_fechamentos alter column status set default 'pendente';
alter table public.qf_comissao13_fechamentos drop constraint if exists qf_comissao13_fechamentos_status_check;
alter table public.qf_comissao13_fechamentos add constraint qf_comissao13_fechamentos_status_check check(status in ('pendente','negociando','informado','confirmado','recusado','contestado'));
alter table public.qf_comissao13_fechamentos add column if not exists prazo_contas timestamptz not null default now()+interval '48 hours';
alter table public.qf_comissao13_fechamentos add column if not exists prestado_em timestamptz;
alter table public.qf_comissao13_fechamentos add column if not exists comissao_vence_em timestamptz;
alter table public.qf_comissao13_fechamentos add column if not exists comissao_paga_em timestamptz;
alter table public.qf_comissao13_fechamentos add column if not exists codigo_validado_em timestamptz;
alter table public.qf_comissao13_fechamentos add column if not exists codigo_tentativas integer not null default 0;
alter table public.qf_comissao13_fechamentos add column if not exists codigo_tentativa_em timestamptz;
alter table public.qf_comissao13_fechamentos enable row level security;
revoke all on public.qf_comissao13_fechamentos from public,anon,authenticated;
create index if not exists qf13_contas_prof_prazo_idx on public.qf_comissao13_fechamentos(profissional_id,prazo_contas);
create table if not exists private.qf13_codigos_pedido(chamado_id uuid primary key references public.qf_chamados(id),codigo_hash text not null,criado_em timestamptz not null default now());
alter table private.qf13_codigos_pedido enable row level security;
revoke all on private.qf13_codigos_pedido from public,anon,authenticated;
create table if not exists private.qf13_auditoria(id uuid primary key default gen_random_uuid(),fechamento_id uuid not null references public.qf_comissao13_fechamentos(id),ator uuid,antes jsonb,depois jsonb,criado_em timestamptz not null default now());
alter table private.qf13_auditoria enable row level security;
revoke all on private.qf13_auditoria from public,anon,authenticated;
create or replace function private.qf13_auditar() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into private.qf13_auditoria(fechamento_id,ator,antes,depois) values(new.id,auth.uid(),case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));return new;
end $$;
drop trigger if exists qf13_auditar on public.qf_comissao13_fechamentos;
create trigger qf13_auditar after insert or update on public.qf_comissao13_fechamentos for each row execute function private.qf13_auditar();
create or replace function private.qf13_bloqueio(p_prof uuid) returns text language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.qf_comissao13_fechamentos where profissional_id=p_prof and status in ('pendente','negociando') and prazo_contas<now()) then 'prestacao_contas_vencida'
 when exists(select 1 from public.qf_comissao13_fechamentos where profissional_id=p_prof and status='confirmado' and cobranca_status='pendente' and comissao_vence_em<now()) then 'comissao_vencida' else null end
$$;
create or replace function private.qf13_registrar_desbloqueio() returns trigger language plpgsql security definer set search_path='' as $$
declare motivo text;
begin
 if auth.uid()=new.profissional_id then motivo:=private.qf13_bloqueio(new.profissional_id);if motivo is not null then raise exception '%',motivo;end if;end if;
 if new.origem='comissao13' then
  insert into public.qf_comissao13_fechamentos(desbloqueio_id,chamado_id,profissional_id,status,prazo_contas) values(new.id,new.chamado_id,new.profissional_id,'pendente',now()+interval '48 hours') on conflict(desbloqueio_id) do nothing;
 end if;return new;
end $$;
drop trigger if exists qf13_registrar_desbloqueio on public.qf_desbloqueios;
create trigger qf13_registrar_desbloqueio after insert on public.qf_desbloqueios for each row execute function private.qf13_registrar_desbloqueio();
-- Não há código de telefone ou SMS: este é o código anotado pelo cliente ao publicar.
create or replace function private.qf13_codigo_novo() returns text language plpgsql set search_path='' as $$
declare b bytea; n bigint;
begin loop b:=extensions.gen_random_bytes(4);n:=get_byte(b,0)::bigint*16777216+get_byte(b,1)::bigint*65536+get_byte(b,2)::bigint*256+get_byte(b,3);exit when n<4294000000;end loop;return lpad((n%1000000)::text,6,'0');end $$;
create or replace function public.qf13_codigo_cliente(p_chamado_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare codigo text;
begin
 if auth.uid() is null or not exists(select 1 from public.qf_chamados where id=p_chamado_id and cliente_id=auth.uid()) then return jsonb_build_object('ok',false,'reason','sem_permissao');end if;
 codigo:=private.qf13_codigo_novo();
 insert into private.qf13_codigos_pedido(chamado_id,codigo_hash) values(p_chamado_id,encode(extensions.digest(p_chamado_id::text||':'||codigo,'sha256'),'hex')) on conflict do nothing;
 if not found then return jsonb_build_object('ok',false,'reason','codigo_ja_emitido');end if;
 return jsonb_build_object('ok',true,'codigo',codigo);
end $$;
create or replace function public.qf_comissao13_prestar_contas(p_id uuid,p_situacao text,p_valor_centavos bigint default null,p_codigo text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.qf_comissao13_fechamentos;h text;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 select * into f from public.qf_comissao13_fechamentos where id=p_id and profissional_id=auth.uid() for update;
 if not found then return jsonb_build_object('ok',false,'reason','sem_permissao');end if;
 if f.status not in ('pendente','negociando') then return jsonb_build_object('ok',false,'reason','ja_prestado');end if;
 if p_situacao not in ('informado','negociando','recusado') or p_situacao is null then return jsonb_build_object('ok',false,'reason','situacao_invalida');end if;
 if p_situacao='informado' then
  if p_valor_centavos is null or p_valor_centavos not between 100 and 100000000 then return jsonb_build_object('ok',false,'reason','valor_invalido');end if;
  if f.codigo_tentativas>=5 and f.codigo_tentativa_em>now()-interval '1 hour' then return jsonb_build_object('ok',false,'reason','limite_codigo');end if;
  select codigo_hash into h from private.qf13_codigos_pedido where chamado_id=f.chamado_id;
  if p_codigo is null or p_codigo !~ '^[0-9]{6}$' or h is null or h<>encode(extensions.digest(f.chamado_id::text||':'||p_codigo,'sha256'),'hex') then
   update public.qf_comissao13_fechamentos set codigo_tentativas=case when codigo_tentativa_em<now()-interval '1 hour' then 1 else codigo_tentativas+1 end,codigo_tentativa_em=now() where id=p_id;
   return jsonb_build_object('ok',false,'reason',case when h is null then 'codigo_nao_emitido_contate_suporte' else 'codigo_invalido' end);
  end if;
 end if;
 update public.qf_comissao13_fechamentos set status=p_situacao,valor_informado_centavos=case when p_situacao='informado' then p_valor_centavos else null end,prestado_em=now(),informado_em=now(),prazo_contas=case when p_situacao='negociando' then now()+interval '48 hours' else prazo_contas end,codigo_validado_em=case when p_situacao='informado' then now() else null end where id=p_id;
 return jsonb_build_object('ok',true,'status',p_situacao,'comissao_devida',false);
end $$;
create or replace function public.qf_comissao13_admin(p_id uuid,p_acao text,p_valor_centavos bigint default null,p_observacao text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.qf_comissao13_fechamentos;
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin authentication required';end if;
 perform 1 from public.qf_chamados c where c.id=(select chamado_id from public.qf_comissao13_fechamentos where id=p_id) for update;
 select * into f from public.qf_comissao13_fechamentos where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','nao_encontrado');end if;
 if p_acao='confirmar' then
  if f.cobranca_status='paga' then return jsonb_build_object('ok',false,'reason','comissao_ja_paga');end if;
  if f.status='confirmado' then return jsonb_build_object('ok',true,'ja_confirmado',true,'comissao_centavos',f.comissao_centavos);end if;
  if p_valor_centavos is null or p_valor_centavos not between 100 and 100000000 or length(trim(coalesce(p_observacao,'')))<5 then return jsonb_build_object('ok',false,'reason','valor_e_evidencia_obrigatorios');end if;
  if exists(select 1 from public.qf_comissao13_fechamentos where chamado_id=f.chamado_id and id<>f.id and status='confirmado') then return jsonb_build_object('ok',false,'reason','outro_confirmado');end if;
  perform 1 from public.qf_chamados where id=f.chamado_id for update;
  update public.qf_comissao13_fechamentos set status='confirmado',valor_confirmado_centavos=p_valor_centavos,comissao_centavos=round(p_valor_centavos*0.13)::bigint,cobranca_status='pendente',confirmado_por=auth.uid(),confirmado_em=now(),comissao_vence_em=now()+interval '48 hours',observacao_admin=left(p_observacao,2000) where id=p_id;
 elsif p_acao in ('nao_contratado','contestar') then
  if length(trim(coalesce(p_observacao,'')))<5 then return jsonb_build_object('ok',false,'reason','observacao_obrigatoria');end if;
  if f.cobranca_status='paga' then return jsonb_build_object('ok',false,'reason','comissao_ja_paga');end if;
  update public.qf_comissao13_fechamentos set status=case when p_acao='contestar' then 'contestado' else 'recusado' end,cobranca_status='cancelada',comissao_centavos=null,comissao_vence_em=null,observacao_admin=left(p_observacao,2000),prestado_em=now() where id=p_id;
 elsif p_acao='pago' then
  if f.status<>'confirmado' then return jsonb_build_object('ok',false,'reason','comissao_nao_confirmada');end if;
  if f.cobranca_status='paga' then return jsonb_build_object('ok',true,'ja_pago',true);end if;
  if length(trim(coalesce(p_observacao,'')))<5 then return jsonb_build_object('ok',false,'reason','comprovante_obrigatorio');end if;
  update public.qf_comissao13_fechamentos set cobranca_status='paga',comissao_paga_em=now(),observacao_admin=left(p_observacao,2000) where id=p_id;
 else return jsonb_build_object('ok',false,'reason','acao_invalida');end if;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.qf_comissao13_fechamentos_painel() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'authentication required';end if;
 return coalesce((select jsonb_agg(x order by x.informado_em desc) from (select f.*,p.nome as profissional,cl.nome as cliente,cl.telefone,cl.whatsapp,c.titulo from public.qf_comissao13_fechamentos f join public.qf_chamados c on c.id=f.chamado_id join public.qf_profiles p on p.id=f.profissional_id join public.qf_profiles cl on cl.id=c.cliente_id where f.profissional_id=auth.uid() or private.qf_is_admin() order by f.informado_em desc limit 500) x),'[]'::jsonb);
end $$;
create or replace function public.qf_comissao13_status() returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 return jsonb_build_object('ok',true,'comissao_percentual',13,'desbloqueio_gratuito_ativo',coalesce((select ativo from private.qf_comissao13_config where id),false),'bloqueio',private.qf13_bloqueio(auth.uid()));
end $$;
-- A RPC obsoleta não deve encerrar o pedido ou transformar declaração em dívida.
create or replace function public.qf_comissao13_informar_valor(p_chamado_id uuid,p_valor_centavos bigint) returns jsonb language plpgsql security definer set search_path='' as $$ begin return jsonb_build_object('ok',false,'reason','informe_valor_e_codigo_na_carteira');end $$;
revoke all on function private.qf13_auditar(),private.qf13_bloqueio(uuid),private.qf13_registrar_desbloqueio(),private.qf13_codigo_novo() from public,anon,authenticated;
revoke all on function public.qf13_codigo_cliente(uuid),public.qf_comissao13_prestar_contas(uuid,text,bigint,text),public.qf_comissao13_admin(uuid,text,bigint,text),public.qf_comissao13_fechamentos_painel(),public.qf_comissao13_status(),public.qf_comissao13_informar_valor(uuid,bigint) from public,anon;
grant execute on function public.qf13_codigo_cliente(uuid),public.qf_comissao13_prestar_contas(uuid,text,bigint,text),public.qf_comissao13_admin(uuid,text,bigint,text),public.qf_comissao13_fechamentos_painel(),public.qf_comissao13_status(),public.qf_comissao13_informar_valor(uuid,bigint) to authenticated;

create or replace function private.qf_comissao13_guardar_desfecho() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.origem='comissao13' and new.desfecho='fechado' and old.desfecho is distinct from new.desfecho and not exists(select 1 from public.qf_comissao13_fechamentos where desbloqueio_id=new.id and status='confirmado') then raise exception 'confirmacao_administrativa_obrigatoria';end if;return new;end $$;
