-- RPCs isoladas da modalidade 13%; desbloqueio gratuito permanece desativado.
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
 return jsonb_build_object('ok',true,'modalidade','comissao13','comissao_percentual',13,'desbloqueio_gratuito_ativo',false);
end $$;
revoke all on function public.qf_comissao13_aderir(boolean) from public,anon;
grant execute on function public.qf_comissao13_aderir(boolean) to authenticated;

create or replace function public.qf_comissao13_status()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_prof uuid := auth.uid();
begin
 if v_prof is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
 return jsonb_build_object('ok',true,'carteirinha_ativa',exists(select 1 from public.qf_carteirinhas c where c.profissional_id=v_prof),'aderiu',exists(select 1 from public.qf_comissao13_adesoes a where a.profissional_id=v_prof and a.revogado_em is null),'comissao_percentual',13,'desbloqueio_gratuito_ativo',false);
end $$;
revoke all on function public.qf_comissao13_status() from public,anon;
grant execute on function public.qf_comissao13_status() to authenticated;