-- Guarda quem podia receber o chamado para exibir o cancelamento posteriormente.
alter table private.qf_plantao_chamados
  add column destinatarios uuid[],
  add column cancelado_pelo_cliente_em timestamptz;

create index qf_plantao_cancelados_destinatarios
  on private.qf_plantao_chamados using gin (destinatarios)
  where estado = 'cancelado' and cancelado_pelo_cliente_em is not null;

CREATE OR REPLACE FUNCTION public.qf_plantao_criar(p_cliente uuid, p_categoria text, p_descricao text, p_cep text, p_cidade text, p_uf text, p_bairro text, p_endereco text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_destinatarios uuid[];
begin
 if not exists(select 1 from public.qf_profiles where id=p_cliente and ativo and tipo='cliente') then raise exception 'Conta de cliente necessária'; end if;
 if not private.qf_plantao_texto_seguro(p_descricao) or not private.qf_plantao_texto_seguro(p_bairro) then raise exception 'Remova o telefone ou link da descrição'; end if;
 perform pg_advisory_xact_lock(hashtextextended('qf_plantao:'||p_cliente::text,0));
 if exists(select 1 from private.qf_plantao_chamados c where c.cliente_id=p_cliente
   and ((c.estado='buscando' and c.prazo_busca>now()) or (c.estado='oferta' and c.prazo_oferta>now()) or c.estado='pix')) then
   raise exception 'Você já tem um chamado urgente em andamento';
 end if;
 insert into private.qf_plantao_chamados(cliente_id,categoria,descricao,cep,cidade,uf,bairro,endereco)
 values(p_cliente,p_categoria,btrim(p_descricao),p_cep,p_cidade,p_uf,p_bairro,btrim(p_endereco)) returning id into v_id;
 v_destinatarios := public.qf_plantao_push_destinatarios(v_id);
 update private.qf_plantao_chamados set destinatarios=v_destinatarios where id=v_id;
 if cardinality(v_destinatarios)=0 then
   update private.qf_plantao_chamados
   set sem_profissional_em=now(),prazo_busca=now() where id=v_id;
 else
   perform private.qf_push_interno('plantao_24h',v_id);
 end if;
 return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.qf_plantao_recusar(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 update private.qf_plantao_chamados
 set estado='cancelado', cancelado_pelo_cliente_em=now(),
     destinatarios=array(
       select distinct unnest(coalesce(destinatarios,'{}'::uuid[]) || public.qf_plantao_push_destinatarios(p_id))
     )
 where id=p_id and cliente_id=auth.uid() and estado in ('buscando','oferta');
 if not found then raise exception 'Chamado indisponível para cancelamento'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.qf_plantao_listar()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(info order by criado_em desc),'[]'::jsonb)
 from (
   select c.criado_em, jsonb_build_object(
    'id',c.id,'categoria',c.categoria,'cidade',c.cidade,'uf',c.uf,'bairro',c.bairro,
    'estado',case when c.sem_profissional_em is not null then 'sem_profissional'
                 when c.estado='buscando' and c.prazo_busca<=now() then 'sem_atendimento'
                 when c.estado='oferta' and c.prazo_oferta<=now() then 'sem_atendimento' else c.estado end,
    'cliente',c.cliente_id=auth.uid(),'meu_aceite',coalesce(c.profissional_id=auth.uid(),false),
    'descricao',case when auth.uid() in (c.cliente_id,c.profissional_id) or c.estado='buscando' then c.descricao end,
    'chegada_minutos',c.chegada_minutos,'profissional_nome',case when c.cliente_id=auth.uid() then case when private.qf_plantao_texto_seguro(pro.nome) then split_part(pro.nome,' ',1) else 'Profissional de plantão' end end,
    'telefone',case when c.estado='confirmado' then case when auth.uid()=c.cliente_id then coalesce(nullif(pro.whatsapp,''),pro.telefone) else coalesce(nullif(cli.whatsapp,''),cli.telefone) end end,
    'endereco',case when c.estado='confirmado' and c.profissional_id=auth.uid() then c.endereco end,
    'prazo_pix',c.prazo_pix,
    'cancelado_pelo_cliente',c.cancelado_pelo_cliente_em is not null,
    'dados_busca',case when c.cliente_id=auth.uid() and c.estado<>'confirmado'
      then jsonb_build_object('cep',c.cep,'endereco',c.endereco)
    end,
    'distancia_km',case
      when c.cliente_id <> auth.uid() and c.estado='buscando' and c.prazo_busca>now()
      then (select round(distancia_km) from private.qf_plantao_alcance(auth.uid(),c.cidade,c.uf))
    end,
    'profissionais_disponiveis',case
      when c.cliente_id=auth.uid() and c.estado='buscando' and c.prazo_busca>now()
      then cardinality(public.qf_plantao_push_destinatarios(c.id))
    end
   ) as info
   from private.qf_plantao_chamados c
   join public.qf_profiles cli on cli.id=c.cliente_id
   left join public.qf_profiles pro on pro.id=c.profissional_id
   where auth.uid() is not null and (
     c.cliente_id=auth.uid() or c.profissional_id=auth.uid() or
     (c.estado='cancelado' and c.cancelado_pelo_cliente_em is not null
       and c.destinatarios @> array[auth.uid()]) or
     (c.estado='buscando' and c.prazo_busca>now() and private.qf_plantao_elegivel(auth.uid(),c.categoria,c.cidade,c.uf))
   )
   order by c.criado_em desc limit 30
 ) t;
$function$;
