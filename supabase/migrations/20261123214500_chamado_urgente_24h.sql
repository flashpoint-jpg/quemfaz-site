-- Chamados urgentes têm fila própria. Os pedidos comuns preservam seu fluxo.
create table private.qf_plantao_profissionais (
  profissional_id uuid primary key references public.qf_profissionais(user_id) on delete cascade,
  disponivel boolean not null,
  atualizado_em timestamptz not null default now()
);

create table private.qf_plantao_chamados (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.qf_profiles(id) on delete restrict,
  profissional_id uuid references public.qf_profissionais(user_id) on delete restrict,
  categoria text not null check (categoria in ('cat_eletricista','cat_encanador','cat_guincho','cat_chaveiro')),
  descricao text not null check (char_length(descricao) between 8 and 500),
  cep text not null check (cep ~ '^[0-9]{8}$'),
  cidade text not null check (char_length(cidade) between 2 and 100),
  uf text not null check (uf ~ '^[A-Z]{2}$'),
  bairro text not null check (char_length(bairro) between 1 and 100),
  endereco text not null check (char_length(endereco) between 5 and 300),
  criado_em timestamptz not null default now(),
  prazo_busca timestamptz not null default now()+interval '5 minutes',
  prazo_oferta timestamptz,
  prazo_pix timestamptz,
  chegada_minutos integer check (chegada_minutos in (15,20,30,45,60)),
  estado text not null default 'buscando' check (estado in ('buscando','oferta','pix','confirmado','cancelado','reembolso_pendente','reembolsado')),
  pix_e2e text unique,
  confirmado_em timestamptz,
  check ((estado='buscando') = (profissional_id is null) or estado='cancelado')
);
create index qf_plantao_chamados_cliente on private.qf_plantao_chamados(cliente_id, criado_em desc);
create index qf_plantao_chamados_fila on private.qf_plantao_chamados(estado,prazo_busca);
create index qf_plantao_chamados_profissional on private.qf_plantao_chamados(profissional_id, criado_em desc);

alter table private.qf_plantao_profissionais enable row level security;
alter table private.qf_plantao_chamados enable row level security;
revoke all on table private.qf_plantao_profissionais, private.qf_plantao_chamados from public, anon, authenticated;

create function private.qf_plantao_texto_seguro(p_texto text)
returns boolean language sql immutable set search_path = '' as $$
 select p_texto is not null
    and p_texto !~ '[[:digit:]][[:space:]().+/_-]*[[:digit:]][[:space:]().+/_-]*[[:digit:]][[:space:]().+/_-]*[[:digit:]][[:space:]().+/_-]*[[:digit:]][[:space:]().+/_-]*[[:digit:]][[:space:]().+/_-]*[[:digit:]][[:space:]().+/_-]*[[:digit:]]'
    and p_texto !~* '(https?[:]|www[.]|wa[ ._-]*me|whats[ ._-]*app|telegram|t[.]me|@|instagram|[.](com|net|org|br)\y)';
$$;

create function private.qf_plantao_plano_ativo(p_profissional uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (
   select 1 from public.qf_planos_profissional a
   join public.qf_recargas r on r.id=a.recarga_id and r.profissional_id=a.profissional_id
   where a.profissional_id=p_profissional and a.plano='livre_24h'
     and a.valido_ate>now() and r.status='aprovado'
 );
$$;

create function private.qf_plantao_elegivel(p_profissional uuid,p_categoria text,p_cidade text,p_uf text)
returns boolean language sql stable security definer set search_path = '' as $$
 select private.qf_plantao_plano_ativo(p_profissional)
    and exists(select 1 from private.qf_plantao_profissionais d where d.profissional_id=p_profissional and d.disponivel)
    and exists (
      select 1 from public.qf_profissionais pr join public.qf_profiles p on p.id=pr.user_id
      where pr.user_id=p_profissional and p.ativo and p.tipo='profissional'
        and p_categoria=any(pr.especialidades)
        and (
          (upper(p.uf)=p_uf and lower(btrim(p.cidade))=lower(btrim(p_cidade)))
          or exists (
            select 1 from public.qf_profissional_cidades a
             where a.profissional_id=pr.user_id and upper(a.uf)=p_uf and lower(btrim(a.cidade))=lower(btrim(p_cidade))
          )
        )
    );
$$;

create function public.qf_plantao_disponibilidade(p_disponivel boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); ativo boolean; d boolean;
begin
 if not exists(select 1 from public.qf_profissionais where user_id=u) then raise exception 'Conta profissional necessária'; end if;
 ativo:=private.qf_plantao_plano_ativo(u);
 if p_disponivel is not null then
   if p_disponivel and not ativo then raise exception 'Ative o 24 Livre para entrar no plantão'; end if;
   insert into private.qf_plantao_profissionais values(u,p_disponivel,now())
     on conflict (profissional_id) do update set disponivel=excluded.disponivel,atualizado_em=excluded.atualizado_em;
 end if;
 select disponivel into d from private.qf_plantao_profissionais where profissional_id=u;
 return jsonb_build_object('plano_ativo',ativo,'disponivel',ativo and coalesce(d,false),'desbloqueios_restantes',(
   select coalesce(sum(chamados_restantes),0) from public.qf_planos_profissional
   where profissional_id=u and plano='livre_24h' and valido_ate>now()
 ));
end;
$$;

-- A função de borda valida o CEP e obtém cidade e bairro antes desta chamada.
create function public.qf_plantao_criar(p_cliente uuid,p_categoria text,p_descricao text,p_cep text,p_cidade text,p_uf text,p_bairro text,p_endereco text)
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
 perform private.qf_push_interno('plantao_24h',v_id);
 return v_id;
end;
$$;

create function public.qf_plantao_listar()
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(info order by criado_em desc),'[]'::jsonb)
 from (
   select c.criado_em, jsonb_build_object(
    'id',c.id,'categoria',c.categoria,'cidade',c.cidade,'uf',c.uf,'bairro',c.bairro,
    'estado',case when c.estado='buscando' and c.prazo_busca<=now() then 'sem_atendimento'
                 when c.estado='oferta' and c.prazo_oferta<=now() then 'sem_atendimento' else c.estado end,
    'cliente',c.cliente_id=auth.uid(),'meu_aceite',coalesce(c.profissional_id=auth.uid(),false),
    'descricao',case when auth.uid() in (c.cliente_id,c.profissional_id) or c.estado='buscando' then c.descricao end,
    'chegada_minutos',c.chegada_minutos,'profissional_nome',case when c.cliente_id=auth.uid() then case when private.qf_plantao_texto_seguro(pro.nome) then split_part(pro.nome,' ',1) else 'Profissional de plantão' end end,
    'telefone',case when c.estado='confirmado' then case when auth.uid()=c.cliente_id then coalesce(nullif(pro.whatsapp,''),pro.telefone) else coalesce(nullif(cli.whatsapp,''),cli.telefone) end end,
    'endereco',case when c.estado='confirmado' and c.profissional_id=auth.uid() then c.endereco end,
    'prazo_pix',c.prazo_pix
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

create function public.qf_plantao_aceitar(p_id uuid,p_minutos integer)
returns void language plpgsql security definer set search_path = '' as $$
declare c private.qf_plantao_chamados; u uuid:=auth.uid();
begin
 if u is null then raise exception 'Entre na conta profissional'; end if;
 perform pg_advisory_xact_lock(hashtextextended('qf_plantao_pro:'||u::text,0));
 select * into c from private.qf_plantao_chamados where id=p_id for update;
 if p_minutos is null or p_minutos not in (15,20,30,45,60)
   or not found or c.estado<>'buscando' or c.prazo_busca<=now()
   or not private.qf_plantao_elegivel(u,c.categoria,c.cidade,c.uf)
   or exists(select 1 from private.qf_plantao_chamados a where a.profissional_id=u
     and ((a.estado='oferta' and a.prazo_oferta>now()) or (a.estado='pix' and a.prazo_pix>now())))
 then raise exception 'Chamado indisponível para este profissional'; end if;
 update private.qf_plantao_chamados set profissional_id=u, estado='oferta',
   prazo_oferta=now()+interval '4 minutes', chegada_minutos=p_minutos where id=p_id;
end;
$$;

create function public.qf_plantao_recusar(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 update private.qf_plantao_chamados set estado='cancelado'
 where id=p_id and cliente_id=auth.uid() and estado in ('buscando','oferta');
 if not found then raise exception 'Chamado indisponível para cancelamento'; end if;
end;
$$;

create function public.qf_plantao_pix_reservar(p_cliente uuid,p_id uuid,p_criar boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c private.qf_plantao_chamados;
begin
 select * into c from private.qf_plantao_chamados where id=p_id and cliente_id=p_cliente for update;
 if not found then raise exception 'Chamado indisponível'; end if;
 if c.estado='oferta' and p_criar and c.prazo_oferta>now() then
   update private.qf_plantao_chamados set estado='pix',prazo_pix=now()+interval '8 minutes'
   where id=p_id returning * into c;
 end if;
 if c.estado not in ('pix','confirmado','reembolso_pendente','reembolsado') then raise exception 'Prazo da oferta encerrado'; end if;
 return jsonb_build_object('estado',c.estado,'prazo_pix',c.prazo_pix,'e2e',c.pix_e2e);
end;
$$;

create function public.qf_plantao_pix_confirmar(p_cliente uuid,p_id uuid,p_txid text,p_e2e text,p_centavos integer,p_recebido_em timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare c private.qf_plantao_chamados; resultado text;
begin
 select * into c from private.qf_plantao_chamados where id=p_id and cliente_id=p_cliente for update;
 if not found or p_txid is distinct from replace(p_id::text,'-','') or p_centavos is distinct from 2000
 or p_e2e !~ '^E[A-Za-z0-9]{31}$' or p_e2e is null or p_recebido_em is null then
   raise exception 'Pix não corresponde ao chamado';
 end if;
 if c.estado in ('confirmado','reembolso_pendente','reembolsado') then
   if c.pix_e2e is distinct from p_e2e then raise exception 'Pix divergente'; end if;
   return c.estado;
 end if;
 if c.estado<>'pix' then raise exception 'Chamado sem reserva Pix'; end if;
 resultado:=case when p_recebido_em<=c.prazo_pix then 'confirmado' else 'reembolso_pendente' end;
 update private.qf_plantao_chamados set estado=resultado,pix_e2e=p_e2e,
   confirmado_em=case when resultado='confirmado' then now() end where id=p_id;
 return resultado;
end;
$$;

revoke all on function private.qf_plantao_texto_seguro(text),private.qf_plantao_plano_ativo(uuid),private.qf_plantao_elegivel(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.qf_plantao_disponibilidade(boolean),public.qf_plantao_listar(),public.qf_plantao_aceitar(uuid,integer),public.qf_plantao_recusar(uuid) from public, anon, authenticated;
grant execute on function public.qf_plantao_disponibilidade(boolean),public.qf_plantao_listar(),public.qf_plantao_aceitar(uuid,integer),public.qf_plantao_recusar(uuid) to authenticated;
revoke all on function public.qf_plantao_criar(uuid,text,text,text,text,text,text,text),public.qf_plantao_pix_reservar(uuid,uuid,boolean),public.qf_plantao_pix_confirmar(uuid,uuid,text,text,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.qf_plantao_criar(uuid,text,text,text,text,text,text,text),public.qf_plantao_pix_reservar(uuid,uuid,boolean),public.qf_plantao_pix_confirmar(uuid,uuid,text,text,integer,timestamptz) to service_role;

create function public.qf_plantao_pix_expirar(p_cliente uuid,p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 update private.qf_plantao_chamados set estado='cancelado'
 where id=p_id and cliente_id=p_cliente and estado='pix' and prazo_pix<=now();
end;
$$;

revoke all on function public.qf_plantao_pix_expirar(uuid,uuid) from public, anon, authenticated;
grant execute on function public.qf_plantao_pix_expirar(uuid,uuid) to service_role;

create function public.qf_plantao_push_destinatarios(p_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
 select coalesce(array_agg(pr.profissional_id),'{}'::uuid[])
 from private.qf_plantao_chamados c cross join private.qf_plantao_profissionais pr
 where c.id=p_id and c.estado='buscando' and c.prazo_busca>now()
 and private.qf_plantao_elegivel(pr.profissional_id,c.categoria,c.cidade,c.uf);
$$;
revoke all on function public.qf_plantao_push_destinatarios(uuid) from public, anon, authenticated;
grant execute on function public.qf_plantao_push_destinatarios(uuid) to service_role;

create function public.qf_plantao_reconciliar_lista()
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(item),'[]'::jsonb)
 from (select jsonb_build_object('id',id,'cliente_id',cliente_id) item
  from private.qf_plantao_chamados where estado in ('pix','reembolso_pendente')
  order by prazo_pix limit 35) t;
$$;

create function public.qf_plantao_reembolso_confirmar(p_id uuid,p_e2e text)
returns void language sql security definer set search_path = '' as $$
 update private.qf_plantao_chamados set estado='reembolsado'
 where id=p_id and pix_e2e=p_e2e and estado='reembolso_pendente';
$$;
revoke all on function public.qf_plantao_reconciliar_lista(),public.qf_plantao_reembolso_confirmar(uuid,text) from public, anon, authenticated;
grant execute on function public.qf_plantao_reconciliar_lista(),public.qf_plantao_reembolso_confirmar(uuid,text) to service_role;

create function private.qf_plantao_reconciliar_job()
returns void language plpgsql security definer set search_path = '' as $$
declare s text;
begin
 if not exists(select 1 from private.qf_plantao_chamados where estado in ('pix','reembolso_pendente')) then return; end if;
 select decrypted_secret into s from vault.decrypted_secrets where name='qf_push_internal' limit 1;
 if nullif(s,'') is null then return; end if;
 perform net.http_post(
   url:='https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-plantao',
   body:=jsonb_build_object('action','reconciliar'),
   headers:=jsonb_build_object('Content-Type','application/json','x-qf-internal',s),
   timeout_milliseconds:=45000
 );
end;
$$;
revoke all on function private.qf_plantao_reconciliar_job() from public, anon, authenticated;
