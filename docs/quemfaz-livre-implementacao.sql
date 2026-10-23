-- Quem Faz Livre: checkout Efí e ativação exclusiva pelo servidor.
alter table public.qf_recargas drop constraint qf_recargas_plano_check;
alter table public.qf_recargas add constraint qf_recargas_plano_check check (plano in ('mensal','pro','premium','livre'));
create table if not exists public.qf_livre_assinaturas (
 id uuid primary key default gen_random_uuid(),
 profissional_id uuid not null references public.qf_profissionais(user_id) on delete cascade,
 recarga_id uuid not null unique references public.qf_recargas(id),
 valor_centavos integer not null default 3990 check (valor_centavos=3990),
 inicio_em timestamptz not null default now(),
 fim_em timestamptz not null,
 criado_em timestamptz not null default now(),
 constraint qf_livre_30_dias check (fim_em=inicio_em+interval '30 days')
);
create index if not exists qf_livre_prof_vigencia on public.qf_livre_assinaturas(profissional_id,fim_em desc);
alter table public.qf_livre_assinaturas enable row level security;
revoke all on public.qf_livre_assinaturas from anon,authenticated;
grant select on public.qf_livre_assinaturas to authenticated;
create policy qf_livre_assinatura_propria on public.qf_livre_assinaturas
 for select to authenticated using (profissional_id=(select auth.uid()));

-- Ativação pelo servidor: somente cobrança Efí de R$39,90 confirmada.
create or replace function private.qf_livre_ativar_recarga(p_recarga uuid)
returns text language plpgsql security definer set search_path='' as $$
declare r public.qf_recargas; v_inicio timestamptz;
begin
 select * into r from public.qf_recargas where id=p_recarga for update;
 if not found then return 'nao_encontrada'; end if;
 if r.plano is distinct from 'livre' or r.metodo is distinct from 'pix' or r.valor_centavos<>3990 or r.status<>'aprovado' or r.provedor<>'efi' or nullif(r.provedor_id,'') is null then return 'nao_confirmada'; end if;
 if exists(select 1 from public.qf_livre_assinaturas where recarga_id=r.id) then return 'ja_ativada'; end if;
 perform 1 from public.qf_profissionais where user_id=r.profissional_id for update;
 select greatest(now(),coalesce(max(fim_em),now())) into v_inicio from public.qf_livre_assinaturas where profissional_id=r.profissional_id and exists(select 1 from public.qf_recargas pr where pr.id=recarga_id and pr.status='aprovado');
 insert into public.qf_livre_assinaturas(profissional_id,recarga_id,valor_centavos,inicio_em,fim_em)
 values(r.profissional_id,r.id,3990,v_inicio,v_inicio+interval '30 days');
 return 'ativada';
end $$;
revoke all on function private.qf_livre_ativar_recarga(uuid) from public,anon,authenticated;

create or replace function public.qf_livre_status()
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('ok',auth.uid() is not null,'ativo',exists(
 select 1 from public.qf_livre_assinaturas where profissional_id=auth.uid() and inicio_em<=now() and fim_em>now() and exists(select 1 from public.qf_recargas r where r.id=recarga_id and r.status='aprovado')),
 'valido_ate',(select max(fim_em) from public.qf_livre_assinaturas where profissional_id=auth.uid() and exists(select 1 from public.qf_recargas r where r.id=recarga_id and r.status='aprovado')),
 'preco_centavos',3990,'comissao_percentual',13)
$$;
revoke all on function public.qf_livre_status() from public,anon;
grant execute on function public.qf_livre_status() to authenticated;

create or replace function private.qf_livre_solicitar_pix()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_prof uuid:=auth.uid();v_id uuid;
begin
 if v_prof is null or not exists(select 1 from public.qf_profissionais where user_id=v_prof) then
 return jsonb_build_object('ok',false,'reason','perfil_profissional_obrigatorio');end if;
 perform 1 from public.qf_profissionais where user_id=v_prof for update;
 select id into v_id from public.qf_recargas where profissional_id=v_prof and plano='livre' and status='pendente' and criado_em>now()-interval '23 hours' order by criado_em desc limit 1;
 if v_id is not null then return jsonb_build_object('ok',true,'recarga_id',v_id,'valor_centavos',3990,'tipo_checkout','recarga');end if;
 insert into public.qf_recargas(profissional_id,valor_centavos,metodo,status,plano)
 values(v_prof,3990,'pix','pendente','livre') returning id into v_id;
 return jsonb_build_object('ok',true,'recarga_id',v_id,'valor_centavos',3990,'tipo_checkout','recarga');
end $$;
revoke all on function private.qf_livre_solicitar_pix() from public,anon;
grant execute on function private.qf_livre_solicitar_pix() to authenticated;
create or replace function public.qf_livre_solicitar_pix() returns jsonb language sql security invoker set search_path='' as $$select private.qf_livre_solicitar_pix()$$;
revoke all on function public.qf_livre_solicitar_pix() from public,anon;
grant execute on function public.qf_livre_solicitar_pix() to authenticated;

create or replace function private.qf_livre_desbloquear(p_chamado_id uuid,p_aceitar boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_prof uuid:=auth.uid(); c public.qf_chamados; n integer; lim integer; d uuid;
begin
 if v_prof is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 if p_aceitar is distinct from true then return jsonb_build_object('ok',false,'reason','aceite_obrigatorio');end if;
 if not exists(select 1 from public.qf_livre_assinaturas where profissional_id=v_prof and inicio_em<=now() and fim_em>clock_timestamp() and exists(select 1 from public.qf_recargas r where r.id=recarga_id and r.status='aprovado'))
 then return jsonb_build_object('ok',false,'reason','plano_inativo');end if;
 if not exists(select 1 from public.qf_profissionais pr join public.qf_profiles p on p.id=pr.user_id
 where pr.user_id=v_prof and coalesce(p.ativo,true) and p.tipo='profissional' and pr.online is true)
 then return jsonb_build_object('ok',false,'reason','perfil_inativo');end if;
 if not exists(select 1 from public.qf_profiles where id=v_prof and nullif(trim(coalesce(foto_url,'')),'') is not null)
 then return jsonb_build_object('ok',false,'reason','selfie_obrigatoria');end if;
 if private.qf13_bloqueio(v_prof) is not null then return jsonb_build_object('ok',false,'reason',private.qf13_bloqueio(v_prof));end if;
 select * into c from public.qf_chamados where id=p_chamado_id for update;
 if not found or c.status not in ('aberto','em_negociacao') or c.atendimento_tipo='garante' or c.modalidade='valor_definido'
 then return jsonb_build_object('ok',false,'reason','indisponivel');end if;
 if not exists(select 1 from public.qf_livre_assinaturas a join public.qf_recargas r on r.id=a.recarga_id where a.profissional_id=v_prof and a.inicio_em<=now() and a.fim_em>clock_timestamp() and r.status='aprovado') then return jsonb_build_object('ok',false,'reason','plano_inativo');end if;
 if exists(select 1 from public.qf_desbloqueios where chamado_id=c.id and profissional_id=v_prof)
 then return jsonb_build_object('ok',false,'reason','ja_participou');end if;
 if exists(select 1 from public.qf_orcamentos where chamado_id=c.id and status='aceito')
 then return jsonb_build_object('ok',false,'reason','indisponivel');end if;
 lim:=least(4,public.qf_limite_orcamentos(c.id));
 select count(*) into n from public.qf_desbloqueios where chamado_id=c.id and coalesce(ativo,true);
 if n>=lim or exists(select 1 from public.qf_desbloqueios where chamado_id=c.id and exclusivo and coalesce(ativo,true))
 then return jsonb_build_object('ok',false,'reason','reservado','participantes',n,'limite',lim);end if;
 if not exists(select 1 from public.qf_listar_chamados_disponiveis() x where x.id=c.id)
 then return jsonb_build_object('ok',false,'reason','nao_elegivel');end if;
 insert into public.qf_comissao13_adesoes(profissional_id,versao_termos,aceito_em,revogado_em)
 values(v_prof,'livre-13pct-v1',now(),null)
 on conflict(profissional_id) do update set versao_termos=excluded.versao_termos,aceito_em=now(),revogado_em=null;
 insert into public.qf_desbloqueios(chamado_id,profissional_id,valor_centavos,origem,ativo,exclusivo)
 values(c.id,v_prof,0,'comissao13',true,false) returning id into d;
 update public.qf_chamados set status='em_negociacao',atualizado_em=now() where id=c.id;
 perform private.qf_push_interno('professional_connected',c.id);
 return jsonb_build_object('ok',true,'desbloqueio_id',d,'origem','comissao13','plano','livre','preco_centavos',0,'participantes',n+1,'limite',lim);
exception when unique_violation then return jsonb_build_object('ok',false,'reason','ja_participou');
end $$;
revoke all on function private.qf_livre_desbloquear(uuid,boolean) from public,anon;
grant execute on function private.qf_livre_desbloquear(uuid,boolean) to authenticated;
create or replace function public.qf_livre_desbloquear(p_chamado_id uuid,p_aceitar boolean) returns jsonb language sql security invoker set search_path='' as $$select private.qf_livre_desbloquear(p_chamado_id,p_aceitar)$$;
revoke all on function public.qf_livre_desbloquear(uuid,boolean) from public,anon;
grant execute on function public.qf_livre_desbloquear(uuid,boolean) to authenticated;

-- A aprovação e o benefício Livre são atômicos: falhas não são engolidas.
create or replace function public.qf_recarga_pagamento_aplicado()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='aprovado' and old.status is distinct from 'aprovado' then
  if new.plano='livre' then
   if private.qf_livre_ativar_recarga(new.id) not in ('ativada','ja_ativada') then raise exception 'Pagamento Livre sem confirmação válida';end if;
  else
   begin perform private.qf_aplicar_beneficio_recarga(new.id);
   exception when others then perform private.qf_log_pagamento(new.id,new.profissional_id,'erro_beneficio',jsonb_build_object('erro',sqlerrm,'sqlstate',sqlstate));end;
  end if;
 end if;
 return null;
end $$;
revoke all on function public.qf_recarga_pagamento_aplicado() from public,anon,authenticated;

create or replace view private.qf_recargas_aprovadas_sem_beneficio as
select id,profissional_id,valor_centavos,plano,metodo,aprovado_em from public.qf_recargas r
where status='aprovado' and (
 (plano='livre' and not exists(select 1 from public.qf_livre_assinaturas a where a.recarga_id=r.id)) or
 (plano is distinct from 'livre' and (
 (plano is not null and not exists(select 1 from public.qf_planos_profissional p where p.recarga_id=r.id) and not exists(select 1 from public.qf_movimentacoes_carteira m where m.referencia_tipo='recarga' and m.referencia_id=r.id and m.tipo='credito')) or
 (plano is null and not exists(select 1 from public.qf_movimentacoes_carteira m where m.referencia_tipo='recarga' and m.referencia_id=r.id and m.tipo='credito')))));
notify pgrst,'reload schema';
