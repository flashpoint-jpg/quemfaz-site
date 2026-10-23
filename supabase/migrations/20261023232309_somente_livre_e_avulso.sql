-- Somente Quem Faz Livre pago e ativo autoriza desbloqueios com comissão.
-- Avulso preserva cobrança por contato e saldo, sem comissão.
create or replace function private.qf_livre_acesso_ok(p_prof uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.qf_livre_assinaturas a join public.qf_recargas r on r.id=a.recarga_id
                where a.profissional_id=p_prof and a.inicio_em<=now() and a.fim_em>clock_timestamp() and r.status='aprovado')
$$;
revoke all on function private.qf_livre_acesso_ok(uuid) from public,anon,authenticated;

create or replace function private.qf_livre_desbloquear(p_chamado_id uuid,p_aceitar boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_prof uuid:=auth.uid(); c public.qf_chamados; n integer; lim integer; d uuid;
begin
 if v_prof is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 if p_aceitar is distinct from true then return jsonb_build_object('ok',false,'reason','aceite_obrigatorio');end if;
 -- Bônus vencido não conta como crédito (mesma regra do desbloqueio pago).
 perform private.qf_expirar_bonus_profissional(v_prof);
 if not private.qf_livre_acesso_ok(v_prof)
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
 if not private.qf_livre_acesso_ok(v_prof) then return jsonb_build_object('ok',false,'reason','plano_inativo');end if;
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
 return jsonb_build_object('ok',true,'desbloqueio_id',d,'origem','comissao13','plano','livre',
   'preco_centavos',0,'participantes',n+1,'limite',lim);
exception when unique_violation then return jsonb_build_object('ok',false,'reason','ja_participou');
end $$;

