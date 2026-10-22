-- Módulo adicional: não substitui funções, tabelas ou gatilhos dos serviços/pagamentos.
begin;
create table public.qf_recrut_planos (
 codigo text primary key, nome text not null, preco_centavos integer not null check(preco_centavos>0),
 midia_centavos integer not null check(midia_centavos>=0 and midia_centavos<preco_centavos),
 dias_campanha integer not null check(dias_campanha>0), vagas integer not null check(vagas>0), ativo boolean not null default true
);
insert into public.qf_recrut_planos values
 ('essencial','Essencial',19900,10000,7,1,true),('destaque','Destaque',39900,20000,14,3,true),('premium','Premium',69900,40000,21,5,true);
create table public.qf_recrut_pacotes (
 id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.qf_profissionais(user_id) on delete cascade,
 codigo text not null references public.qf_recrut_planos(codigo), preco_centavos integer not null,
 midia_centavos integer not null, dias_campanha integer not null, vagas integer not null,
 valido_ate timestamptz not null default now()+interval '30 days', criado_em timestamptz not null default now(),
 chave uuid not null, unique(empresa_id,chave)
);
create table public.qf_recrut_vagas (
 id uuid primary key default gen_random_uuid(), pacote_id uuid not null references public.qf_recrut_pacotes(id) on delete cascade,
 empresa_id uuid not null references public.qf_profissionais(user_id) on delete cascade,
 empresa text not null check(length(empresa) between 2 and 120), cargo text not null check(length(cargo) between 3 and 120),
 cidade text not null check(length(cidade) between 2 and 80), uf text not null check(uf ~ '^[A-Z]{2}$'),
 salario text not null default '' check(length(salario)<=120), descricao text not null check(length(descricao) between 20 and 6000),
 requisitos text not null default '' check(length(requisitos)<=4000), beneficios text not null default '' check(length(beneficios)<=2000),
 quantidade integer not null default 1 check(quantidade between 1 and 1000),
 status text not null default 'aberta' check(status in ('aberta','pausada','encerrada')),
 campanha_status text not null default 'aguardando' check(campanha_status in ('aguardando','em_preparacao','ativa','pausada','concluida')),
 campanha_referencia text not null default '', campanha_inicio timestamptz, campanha_fim timestamptz,
 investimento_centavos integer not null default 0 check(investimento_centavos>=0), impressoes bigint not null default 0 check(impressoes>=0),
 visitas bigint not null default 0, criado_em timestamptz not null default now()
);
create table public.qf_recrut_candidatos (
 id uuid primary key default gen_random_uuid(), vaga_id uuid not null references public.qf_recrut_vagas(id) on delete cascade,
 nome text not null check(length(nome) between 3 and 120), telefone text not null check(telefone ~ '^[1-9][0-9]{10}$'),
 cidade text not null check(length(cidade) between 2 and 100), experiencia text not null default '' check(length(experiencia)<=4000),
 disponibilidade text not null default '' check(length(disponibilidade)<=200), curriculo_path text,
 status text not null default 'novo' check(status in ('novo','em_analise','entrevista','aprovado','reprovado')),
 consentimento_em timestamptz not null default now(), criado_em timestamptz not null default now(), unique(vaga_id,telefone)
);
create index on public.qf_recrut_pacotes(empresa_id);
create index on public.qf_recrut_vagas(empresa_id,pacote_id);
create index on public.qf_recrut_candidatos(vaga_id,criado_em desc);
create index on public.qf_recrut_candidatos(telefone,criado_em desc);
alter table public.qf_recrut_planos enable row level security;
alter table public.qf_recrut_pacotes enable row level security;
alter table public.qf_recrut_vagas enable row level security;
alter table public.qf_recrut_candidatos enable row level security;
create policy recrut_catalogo on public.qf_recrut_planos for select to anon,authenticated using(ativo);
create policy recrut_pacotes_empresa on public.qf_recrut_pacotes for select to authenticated using(empresa_id=(select auth.uid()));
create policy recrut_vagas_empresa on public.qf_recrut_vagas for select to authenticated using(empresa_id=(select auth.uid()));
create policy recrut_candidatos_empresa on public.qf_recrut_candidatos for select to authenticated
 using(exists(select 1 from public.qf_recrut_vagas v where v.id=vaga_id and v.empresa_id=(select auth.uid())));
grant select on public.qf_recrut_planos to anon,authenticated;
grant select on public.qf_recrut_pacotes,public.qf_recrut_vagas,public.qf_recrut_candidatos to authenticated;
revoke all on public.qf_recrut_pacotes,public.qf_recrut_vagas,public.qf_recrut_candidatos from anon;

-- Operações privilegiadas ficam em private, com wrappers invoker na API.
create function private.qf_recrut_operar(p_acao text,p_dados jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); p public.qf_recrut_planos; pk public.qf_recrut_pacotes;
 v public.qf_recrut_vagas; saldo bigint; ident uuid; tel text; path text; resultado jsonb;
begin
 if p_acao='vaga_publica' then
  select x.* into v from public.qf_recrut_vagas x join public.qf_recrut_pacotes k on k.id=x.pacote_id
   where x.id=(p_dados->>'id')::uuid and x.status='aberta' and k.valido_ate>now();
  if v.id is null then return jsonb_build_object('ok',false,'reason','vaga_indisponivel'); end if;
  if coalesce((p_dados->>'visita')::boolean,false) then update public.qf_recrut_vagas set visitas=visitas+1 where id=v.id; end if;
  return jsonb_build_object('ok',true,'vaga',jsonb_build_object('id',v.id,'empresa',v.empresa,'cargo',v.cargo,'cidade',v.cidade,'uf',v.uf,'salario',v.salario,'descricao',v.descricao,'requisitos',v.requisitos,'beneficios',v.beneficios,'quantidade',v.quantidade));
 elsif p_acao='candidatar' then
  if coalesce(p_dados->>'website','')<>'' then raise exception 'Cadastro inválido'; end if;
  if coalesce((p_dados->>'consentimento')::boolean,false) is not true then raise exception 'Autorize o envio dos seus dados à empresa'; end if;
  select x.* into v from public.qf_recrut_vagas x join public.qf_recrut_pacotes k on k.id=x.pacote_id
   where x.id=(p_dados->>'vaga_id')::uuid and x.status='aberta' and k.valido_ate>now() for update of x;
  if v.id is null then raise exception 'Esta vaga não está recebendo candidaturas'; end if;
  tel:=regexp_replace(coalesce(p_dados->>'telefone',''),'[^0-9]','','g');
  if tel !~ '^[1-9][0-9]{10}$' then raise exception 'Informe um WhatsApp válido com DDD'; end if;
  perform pg_advisory_xact_lock(hashtext('qf_recrut_candidato:'||tel));
  if exists(select 1 from public.qf_recrut_candidatos where vaga_id=v.id and telefone=tel) then return jsonb_build_object('ok',true,'duplicado',true); end if;
  if (select count(*) from public.qf_recrut_candidatos where telefone=tel and criado_em>now()-interval '1 hour')>=5 then raise exception 'Aguarde antes de enviar novas candidaturas'; end if;
  path:=nullif(p_dados->>'curriculo_path','');
  if path is not null and (path !~ ('^'||v.id::text||'/[0-9a-f-]{36}\.pdf$') or not exists(select 1 from storage.objects where bucket_id='qf-recrut-curriculos' and name=path)) then raise exception 'Currículo inválido'; end if;
  insert into public.qf_recrut_candidatos(vaga_id,nome,telefone,cidade,experiencia,disponibilidade,curriculo_path)
   values(v.id,btrim(p_dados->>'nome'),tel,btrim(p_dados->>'cidade'),coalesce(p_dados->>'experiencia',''),coalesce(p_dados->>'disponibilidade',''),path);
  return jsonb_build_object('ok',true);
 end if;
 if u is null then raise exception 'Entre na sua conta'; end if;
 if p_acao like 'admin_%' then
  if not private.qf_is_admin() then raise exception 'Sem permissão'; end if;
  if p_acao='admin_painel' then
   return jsonb_build_object('ok',true,'pacotes',coalesce((select jsonb_agg(to_jsonb(k)) from public.qf_recrut_pacotes k),'[]'::jsonb),'vagas',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('candidatos',(select count(*) from public.qf_recrut_candidatos c where c.vaga_id=x.id),'midia_pacote',k.midia_centavos,'dias_campanha',k.dias_campanha) order by x.criado_em desc) from public.qf_recrut_vagas x join public.qf_recrut_pacotes k on k.id=x.pacote_id),'[]'::jsonb));
  elsif p_acao='admin_campanha' then
   update public.qf_recrut_vagas set campanha_status=p_dados->>'status',campanha_referencia=left(coalesce(p_dados->>'referencia',''),200),
    campanha_inicio=nullif(p_dados->>'inicio','')::timestamptz,campanha_fim=nullif(p_dados->>'fim','')::timestamptz,
    investimento_centavos=(p_dados->>'investimento_centavos')::integer,impressoes=(p_dados->>'impressoes')::bigint where id=(p_dados->>'id')::uuid returning id into ident;
   if ident is null then raise exception 'Vaga não encontrada'; end if;
   return jsonb_build_object('ok',true);
  end if;
 end if;
 if not exists(select 1 from public.qf_profissionais pr join public.qf_profiles prf on prf.id=pr.user_id where pr.user_id=u and prf.ativo) then raise exception 'Cadastro profissional necessário'; end if;
 if p_acao='comprar' then
  perform pg_advisory_xact_lock(hashtext('qf_recrut_compra:'||u::text));
  select * into pk from public.qf_recrut_pacotes where empresa_id=u and chave=(p_dados->>'chave')::uuid;
  if pk.id is not null then return jsonb_build_object('ok',true,'pacote',to_jsonb(pk)); end if;
  select * into p from public.qf_recrut_planos where codigo=p_dados->>'codigo' and ativo;
  if p.codigo is null then raise exception 'Pacote indisponível'; end if;
  select saldo_centavos into saldo from public.qf_carteiras where profissional_id=u for update;
  if coalesce(saldo,0)<p.preco_centavos then return jsonb_build_object('ok',false,'reason','saldo_insuficiente','faltam',p.preco_centavos-coalesce(saldo,0)); end if;
  insert into public.qf_recrut_pacotes(empresa_id,codigo,preco_centavos,midia_centavos,dias_campanha,vagas,chave)
   values(u,p.codigo,p.preco_centavos,p.midia_centavos,p.dias_campanha,p.vagas,(p_dados->>'chave')::uuid) returning * into pk;
  update public.qf_carteiras set saldo_centavos=saldo_centavos-p.preco_centavos,atualizado_em=now() where profissional_id=u;
  insert into public.qf_movimentacoes_carteira(profissional_id,tipo,valor_centavos,referencia_tipo,referencia_id,descricao)
   values(u,'debito',p.preco_centavos,'recrutamento',pk.id,'Recrutamento QuemFaz — pacote '||p.nome);
  return jsonb_build_object('ok',true,'pacote',to_jsonb(pk));
 elsif p_acao='salvar_vaga' then
  if nullif(p_dados->>'id','') is null then
   select * into pk from public.qf_recrut_pacotes where id=(p_dados->>'pacote_id')::uuid and empresa_id=u and valido_ate>now() for update;
   if pk.id is null then raise exception 'Contrate um pacote ativo'; end if;
   if (select count(*) from public.qf_recrut_vagas where pacote_id=pk.id and status<>'encerrada')>=pk.vagas then raise exception 'Limite de vagas ativas atingido'; end if;
   insert into public.qf_recrut_vagas(pacote_id,empresa_id,empresa,cargo,cidade,uf,salario,descricao,requisitos,beneficios,quantidade)
    values(pk.id,u,btrim(p_dados->>'empresa'),btrim(p_dados->>'cargo'),btrim(p_dados->>'cidade'),upper(p_dados->>'uf'),coalesce(p_dados->>'salario',''),btrim(p_dados->>'descricao'),coalesce(p_dados->>'requisitos',''),coalesce(p_dados->>'beneficios',''),(p_dados->>'quantidade')::integer) returning id into ident;
  else
   update public.qf_recrut_vagas set empresa=btrim(p_dados->>'empresa'),cargo=btrim(p_dados->>'cargo'),cidade=btrim(p_dados->>'cidade'),uf=upper(p_dados->>'uf'),salario=coalesce(p_dados->>'salario',''),descricao=btrim(p_dados->>'descricao'),requisitos=coalesce(p_dados->>'requisitos',''),beneficios=coalesce(p_dados->>'beneficios',''),quantidade=(p_dados->>'quantidade')::integer
    where id=(p_dados->>'id')::uuid and empresa_id=u returning id into ident;
   if ident is null then raise exception 'Vaga não encontrada'; end if;
  end if;
  return jsonb_build_object('ok',true,'id',ident);
 elsif p_acao='status_vaga' then
  select * into v from public.qf_recrut_vagas where id=(p_dados->>'id')::uuid and empresa_id=u;
  select * into pk from public.qf_recrut_pacotes where id=v.pacote_id for update;
  if v.id is null then raise exception 'Vaga não encontrada'; end if;
  if p_dados->>'status'<>'encerrada' then
   if pk.valido_ate<=now() then raise exception 'Pacote expirado'; end if;
   if v.status='encerrada' and (select count(*) from public.qf_recrut_vagas where pacote_id=pk.id and status<>'encerrada')>=pk.vagas then raise exception 'Limite de vagas ativas atingido'; end if;
  end if;
  update public.qf_recrut_vagas set status=p_dados->>'status' where id=v.id;
  return jsonb_build_object('ok',true);
 elsif p_acao='status_candidato' then
  update public.qf_recrut_candidatos c set status=p_dados->>'status' where c.id=(p_dados->>'id')::uuid
   and exists(select 1 from public.qf_recrut_vagas x where x.id=c.vaga_id and x.empresa_id=u) returning id into ident;
  if ident is null then raise exception 'Candidato não encontrado'; end if;
  return jsonb_build_object('ok',true);
 end if;
 raise exception 'Operação inválida';
end $$;
revoke all on function private.qf_recrut_operar(text,jsonb) from public;
grant usage on schema private to anon,authenticated;
grant execute on function private.qf_recrut_operar(text,jsonb) to anon,authenticated;
create function public.qf_recrut_operar(p_acao text,p_dados jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.qf_recrut_operar(p_acao,p_dados); $$;
revoke all on function public.qf_recrut_operar(text,jsonb) from public;
grant execute on function public.qf_recrut_operar(text,jsonb) to anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('qf-recrut-curriculos','qf-recrut-curriculos',false,5242880,array['application/pdf']);
-- Valida o prefixo sem expor dados privados da vaga.
create function private.qf_recrut_upload_valido(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$' and exists(
 select 1 from public.qf_recrut_vagas v join public.qf_recrut_pacotes k on k.id=v.pacote_id
 where v.id::text=split_part(p_name,'/',1) and v.status='aberta' and k.valido_ate>now()); $$;
revoke all on function private.qf_recrut_upload_valido(text) from public;
grant execute on function private.qf_recrut_upload_valido(text) to anon,authenticated;
create policy recrut_upload on storage.objects for insert to anon,authenticated
 with check(bucket_id='qf-recrut-curriculos' and private.qf_recrut_upload_valido(name));
create policy recrut_download on storage.objects for select to authenticated
 using(bucket_id='qf-recrut-curriculos' and exists(select 1 from public.qf_recrut_candidatos c join public.qf_recrut_vagas v on v.id=c.vaga_id where c.curriculo_path=name and v.empresa_id=(select auth.uid())));
commit;
