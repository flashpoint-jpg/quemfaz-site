-- Encerra de imediato buscas iniciadas sem profissionais e informa a contagem ao titular.
alter table private.qf_plantao_chamados add column sem_profissional_em timestamptz;

create or replace function public.qf_plantao_push_destinatarios(p_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
 select coalesce(array_agg(pr.profissional_id),'{}'::uuid[])
 from private.qf_plantao_chamados c cross join private.qf_plantao_profissionais pr
 where c.id=p_id and c.estado='buscando' and c.prazo_busca>now()
 and private.qf_plantao_elegivel(pr.profissional_id,c.categoria,c.cidade,c.uf)
 and not exists (
   select 1 from private.qf_plantao_chamados reservado
   where reservado.profissional_id=pr.profissional_id
   and ((reservado.estado='oferta' and reservado.prazo_oferta>now())
     or (reservado.estado='pix' and reservado.prazo_pix>now()))
 );
$$;

create or replace function public.qf_plantao_criar(p_cliente uuid,p_categoria text,p_descricao text,p_cep text,p_cidade text,p_uf text,p_bairro text,p_endereco text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
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
 if cardinality(public.qf_plantao_push_destinatarios(v_id))=0 then
   update private.qf_plantao_chamados
   set sem_profissional_em=now(),prazo_busca=now() where id=v_id;
 else
   perform private.qf_push_interno('plantao_24h',v_id);
 end if;
 return v_id;
end;
$$;

create or replace function public.qf_plantao_listar()
returns jsonb language sql stable security definer set search_path = '' as $$
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
     (c.estado='buscando' and c.prazo_busca>now() and private.qf_plantao_elegivel(auth.uid(),c.categoria,c.cidade,c.uf))
   )
   order by c.criado_em desc limit 30
 ) t;
$$;
