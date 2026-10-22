CREATE OR REPLACE FUNCTION public.qf_comissao13_desbloquear(p_chamado_id uuid, p_aceitar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prof uuid := auth.uid();
  c public.qf_chamados;
  n integer;
  lim integer;
  d uuid;
  ex record;
begin
  if v_prof is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
  if not coalesce((select ativo from private.qf_comissao13_config where id),false) then
    return jsonb_build_object('ok',false,'reason','modalidade_desativada');
  end if;
  if p_aceitar is distinct from true then return jsonb_build_object('ok',false,'reason','aceite_obrigatorio'); end if;

  if not exists(select 1 from public.qf_profissionais pr join public.qf_profiles p on p.id=pr.user_id
                where pr.user_id=v_prof and coalesce(p.ativo,true) and p.tipo='profissional' and pr.online is true) then
    return jsonb_build_object('ok',false,'reason','perfil_inativo');
  end if;
  if not exists(select 1 from public.qf_profiles where id=v_prof and nullif(trim(coalesce(foto_url,'')),'') is not null) then
    return jsonb_build_object('ok',false,'reason','selfie_obrigatoria');
  end if;
  if private.qf13_bloqueio(v_prof) is not null then return jsonb_build_object('ok',false,'reason',private.qf13_bloqueio(v_prof));end if;

  -- Bloqueio do pedido: serializa desbloqueios concorrentes (pagos e gratuitos) e garante o limite de 4
  select * into c from public.qf_chamados where id=p_chamado_id for update;
  if not found or c.status not in ('aberto','em_negociacao') then
    return jsonb_build_object('ok',false,'reason','indisponivel');
  end if;
  if c.atendimento_tipo='garante' or c.modalidade='valor_definido' then
    return jsonb_build_object('ok',false,'reason','indisponivel');
  end if;

  select * into ex from public.qf_desbloqueios where chamado_id=c.id and profissional_id=v_prof;
  if found then
    if coalesce(ex.ativo,true) and ex.origem='comissao13' then
      return jsonb_build_object('ok',true,'already_unlocked',true,'origem','comissao13','preco_centavos',0);
    end if;
    return jsonb_build_object('ok',false,'reason','ja_participou');
  end if;

  if exists(select 1 from public.qf_orcamentos where chamado_id=c.id and status='aceito') then
    return jsonb_build_object('ok',false,'reason','indisponivel');
  end if;

  lim := least(4, public.qf_limite_orcamentos(c.id));
  select count(*) into n from public.qf_desbloqueios where chamado_id=c.id and coalesce(ativo,true);
  if n >= lim or exists(select 1 from public.qf_desbloqueios where chamado_id=c.id and exclusivo and coalesce(ativo,true)) then
    return jsonb_build_object('ok',false,'reason','reservado','lotado',true,'participantes',n,'limite',lim);
  end if;

  -- Categoria, raio, online, expiração e demais regras de elegibilidade
  if not exists(select 1 from public.qf_listar_chamados_disponiveis() x where x.id=c.id) then
    return jsonb_build_object('ok',false,'reason','nao_elegivel');
  end if;

  insert into public.qf_comissao13_adesoes(profissional_id,versao_termos,aceito_em,revogado_em)
  values(v_prof,'13pct-simplificado-v3',now(),null)
  on conflict(profissional_id) do update set versao_termos=excluded.versao_termos,aceito_em=now(),revogado_em=null;

  insert into public.qf_desbloqueios(chamado_id,profissional_id,valor_centavos,origem,ativo,exclusivo)
  values(c.id,v_prof,0,'comissao13',true,false) returning id into d;

  update public.qf_chamados set status='em_negociacao',atualizado_em=now() where id=c.id;
  perform private.qf_push_interno('professional_connected',c.id);

  return jsonb_build_object('ok',true,'desbloqueio_id',d,'origem','comissao13','preco_centavos',0,
                            'participantes',n+1,'limite',lim);
exception when unique_violation then
  return jsonb_build_object('ok',false,'reason','ja_participou');
end $function$

