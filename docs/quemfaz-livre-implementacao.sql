-- Quem Faz Livre: implementar somente após testes de integração do checkout.
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
 if r.plano is distinct from 'livre' or r.valor_centavos<>3990 or r.status<>'aprovado' or r.provedor<>'efi' or nullif(r.provedor_id,'') is null then return 'nao_confirmada'; end if;
 if exists(select 1 from public.qf_livre_assinaturas where recarga_id=r.id) then return 'ja_ativada'; end if;
 select greatest(now(),coalesce(max(fim_em),now())) into v_inicio from public.qf_livre_assinaturas where profissional_id=r.profissional_id;
 insert into public.qf_livre_assinaturas(profissional_id,recarga_id,valor_centavos,inicio_em,fim_em)
 values(r.profissional_id,r.id,3990,v_inicio,v_inicio+interval '30 days');
 return 'ativada';
end $$;
revoke all on function private.qf_livre_ativar_recarga(uuid) from public,anon,authenticated;

create or replace function public.qf_livre_status()
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('ok',auth.uid() is not null,'ativo',exists(
 select 1 from public.qf_livre_assinaturas where profissional_id=auth.uid() and inicio_em<=now() and fim_em>now()),
 'valido_ate',(select max(fim_em) from public.qf_livre_assinaturas where profissional_id=auth.uid() and fim_em>now()),
 'preco_centavos',3990,'comissao_percentual',13)
$$;
revoke all on function public.qf_livre_status() from public,anon;
grant execute on function public.qf_livre_status() to authenticated;

create or replace function public.qf_livre_solicitar_pix()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_prof uuid:=auth.uid();v_id uuid;
begin
 if v_prof is null or not exists(select 1 from public.qf_profissionais where user_id=v_prof) then
 return jsonb_build_object('ok',false,'reason','perfil_profissional_obrigatorio');end if;
 insert into public.qf_recargas(profissional_id,valor_centavos,metodo,status,plano)
 values(v_prof,3990,'pix','pendente','livre') returning id into v_id;
 return jsonb_build_object('ok',true,'recarga_id',v_id,'valor_centavos',3990,'tipo_checkout','recarga');
end $$;
revoke all on function public.qf_livre_solicitar_pix() from public,anon;
grant execute on function public.qf_livre_solicitar_pix() to authenticated;

create or replace function public.qf_livre_desbloquear(p_chamado_id uuid,p_aceitar boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_prof uuid:=auth.uid(); c public.qf_chamados; n integer; lim integer; d uuid;
begin
 if v_prof is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 if p_aceitar is distinct from true then return jsonb_build_object('ok',false,'reason','aceite_obrigatorio');end if;
 if not exists(select 1 from public.qf_livre_assinaturas where profissional_id=v_prof and inicio_em<=now() and fim_em>now())
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
revoke all on function public.qf_livre_desbloquear(uuid,boolean) from public,anon;
grant execute on function public.qf_livre_desbloquear(uuid,boolean) to authenticated;
