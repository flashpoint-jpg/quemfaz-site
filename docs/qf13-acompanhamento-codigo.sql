alter table public.qf_comissao13_fechamentos add column if not exists prorrogacoes_negociacao integer not null default 0;
alter table public.qf_comissao13_fechamentos add column if not exists cliente_resposta text;
alter table public.qf_comissao13_fechamentos add column if not exists cliente_respondeu_em timestamptz;
-- Prova de propriedade do pedido: segredo aleatório do navegador que publicou, nunca telefone ou código compartilhável.
alter table private.qf13_codigos_pedido add column if not exists proprietario_hash text;
alter table private.qf13_codigos_pedido add column if not exists codigo_cliente text;

create or replace function private.qf13_iniciar_pedido(p_id uuid,p_segredo text) returns void language plpgsql security definer set search_path='' as $$
declare v_codigo text;
begin
 if p_segredo is null then return;end if;
 if p_segredo!~'^[a-f0-9]{64}$' then raise exception 'acesso_pedido_invalido';end if;
 v_codigo:=private.qf13_codigo_novo();
 insert into private.qf13_codigos_pedido(chamado_id,codigo_hash,proprietario_hash,codigo_cliente)
 values(p_id,encode(extensions.digest(p_id::text||':'||v_codigo,'sha256'),'hex'),encode(extensions.digest(p_segredo,'sha256'),'hex'),v_codigo)
 on conflict(chamado_id) do nothing;
end $$;
revoke all on function private.qf13_iniciar_pedido(uuid,text) from public,anon,authenticated;

-- Capability de 256 bits: não exige conta, não aceita telefone e não pode ser obtida pelo profissional.
create or replace function public.qf13_acompanhar(p_chamado_id uuid,p_segredo text,p_acao text default 'ver',p_fechamento uuid default null,p_contratou boolean default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare k private.qf13_codigos_pedido;f public.qf_comissao13_fechamentos;c public.qf_chamados;v_resposta text;
begin
 if p_segredo is null or p_segredo!~'^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 select * into k from private.qf13_codigos_pedido where chamado_id=p_chamado_id and proprietario_hash=encode(extensions.digest(p_segredo,'sha256'),'hex');
 if not found then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 if p_acao='responder' then
  if p_contratou is null then return jsonb_build_object('ok',false,'reason','resposta_obrigatoria');end if;
  select * into f from public.qf_comissao13_fechamentos where id=p_fechamento and chamado_id=p_chamado_id for update;
  if not found or f.status<>'recusado' or f.cliente_respondeu_em is not null then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
  v_resposta:=case when p_contratou then 'divergencia' else 'nao_contratou' end;
  update public.qf_comissao13_fechamentos set cliente_resposta=v_resposta,cliente_respondeu_em=now() where id=f.id;
  return jsonb_build_object('ok',true,'resposta',v_resposta,'requer_analise_admin',true,'comissao_devida',false);
 elsif p_acao<>'ver' then return jsonb_build_object('ok',false,'reason','acao_invalida');end if;
 select * into c from public.qf_chamados where id=p_chamado_id;
 return jsonb_build_object('ok',true,'pedido',jsonb_build_object('id',c.id,'titulo',c.titulo,'cidade',c.cidade,'bairro',c.bairro,'status',c.status,'criado_em',c.criado_em),
 'codigo',k.codigo_cliente,'profissionais',coalesce((select jsonb_agg(jsonb_build_object('id',f0.id,'profissional',p.nome,'status',f0.status,'valor_centavos',f0.valor_informado_centavos,'cliente_resposta',f0.cliente_resposta,'cliente_respondeu_em',f0.cliente_respondeu_em) order by f0.informado_em desc) from public.qf_comissao13_fechamentos f0 join public.qf_profiles p on p.id=f0.profissional_id where f0.chamado_id=c.id),'[]'::jsonb));
end $$;
revoke all on function public.qf13_acompanhar(uuid,text,text,uuid,boolean) from public;
grant execute on function public.qf13_acompanhar(uuid,text,text,uuid,boolean) to anon,authenticated;

-- Cliente autenticado não recebe o código só por conhecer o telefone ou trocar de sessão.
create or replace function public.qf13_codigo_cliente(p_chamado_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_codigo text;
begin
 if auth.uid() is null or not exists(select 1 from public.qf_chamados where id=p_chamado_id and cliente_id=auth.uid()) then return jsonb_build_object('ok',false,'reason','sem_permissao');end if;
 if exists(select 1 from private.qf13_codigos_pedido where chamado_id=p_chamado_id) then return jsonb_build_object('ok',false,'reason','use_acompanhamento_protegido');end if;
 -- Compatibilidade apenas para clientes com versão anterior no instante da publicação.
 v_codigo:=private.qf13_codigo_novo();insert into private.qf13_codigos_pedido(chamado_id,codigo_hash) values(p_chamado_id,encode(extensions.digest(p_chamado_id::text||':'||v_codigo,'sha256'),'hex')) on conflict do nothing;
 if not found then return jsonb_build_object('ok',false,'reason','codigo_ja_emitido');end if;
 return jsonb_build_object('ok',true,'codigo',v_codigo);
end $$;

-- A fila existente avisa para abrir o acompanhamento; não há SMS ou link de confirmação externo.
create or replace function private.qf13_notificar_cliente() returns trigger language plpgsql security definer set search_path='' as $$
declare v_cliente uuid;
begin
 if tg_op='UPDATE' then if new.status<>'recusado' or old.status=new.status then return new;end if;end if;
 select cliente_id into v_cliente from public.qf_chamados where id=new.chamado_id;
 insert into private.qf_comissao13_notificacoes(user_id,chave,titulo,corpo,rota) values(v_cliente,'fechamento13:'||new.id||':'||new.status,'Confira seu pedido no Quem Faz',case when new.status='recusado' then 'O profissional informou que não fechou. Confirme ou conteste dentro do seu pedido.' else 'O profissional liberou seu contato. Seu código permanece no acompanhamento do pedido.' end,'/acompanhar-pedido.html#pedido='||new.chamado_id) on conflict(user_id,chave) do nothing;
 return new;
end $$;
do $$ begin if to_regprocedure('public.qf13_cliente_guest(text,text,text,text)') is not null then execute 'revoke all on function public.qf13_cliente_guest(text,text,text,text) from public,anon,authenticated,service_role';end if;if to_regprocedure('public.qf13_cliente_abrir(uuid)') is not null then execute 'revoke all on function public.qf13_cliente_abrir(uuid) from public,anon,authenticated,service_role';end if;end $$;
-- Links já enfileirados passam a abrir o acompanhamento sem token de confirmação.
update private.qf_comissao13_notificacoes n set rota='/acompanhar-pedido.html#pedido='||f.chamado_id
from public.qf_comissao13_fechamentos f where n.chave like 'fechamento13:'||f.id||':%' and n.rota like '/comissao13.html%';

CREATE OR REPLACE FUNCTION public.qf_publicar_atendimento(p_respostas jsonb, p_geo jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  segredo text:=p_respostas->>'segredo_acompanhamento'; u uuid:=auth.uid(); k uuid; cid uuid:=gen_random_uuid(); a jsonb:=p_respostas - 'segredo_acompanhamento';
  r private.qf_atendimentos; result public.qf_chamados; fp text; f text; b integer; dt date;
  faixa text; faixa_min integer; faixa_max integer; faixa_label text;
  tel text; profile_tel text; descricao_segura text; lat numeric; lng numeric;
begin
  if u is null or not exists(select 1 from public.qf_profiles p where p.id=u and p.tipo='cliente' and coalesce(p.ativo,true)) then raise exception 'cliente_autenticado_obrigatorio'; end if;
  if jsonb_typeof(a) is distinct from 'object' or octet_length(a::text)>20000 or a->>'versao' is distinct from '1' then raise exception 'atendimento_invalido'; end if;
  foreach f in array array['chave','categoria','servico','detalhes','escopo','cidade','uf','bairro','urgencia','materiais','disponibilidade','nome','contato','intencao','autorizacao','tipo'] loop
    if nullif(btrim(a->>f),'') is null or length(a->>f)>2000 then raise exception 'resposta_obrigatoria: %',f; end if;
  end loop;
  if length(a->>'detalhes')<8 or length(a->>'escopo')<3 or length(a->>'disponibilidade')<3 or length(a->>'nome')<2
    or a->>'uf' !~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$'
    or a->>'tipo' not in ('tradicional','garante')
    or a->>'intencao' not in ('contratar','pesquisando')
    or a->>'urgencia' not in ('normal','urgente')
    or a->>'materiais' not in ('profissional','cliente','combinar','nao_aplica')
    or a->>'autorizacao' is distinct from 'sim' then raise exception 'respostas_invalidas_ou_sem_autorizacao'; end if;
  -- Never publish contact/address-like content embedded in public free text.
  foreach f in array array['servico','categoria','detalhes','escopo','cidade','bairro','disponibilidade'] loop
    if (a->>f) ~* '([0-9][ .()+-]*){7,}|@|https?://|www\.|\m(rua|avenida|travessa|alameda)\M' then
      raise exception 'dados_pessoais_no_campo: %. Remova contato e endereço exato.',f;
    end if;
  end loop;
  tel:=regexp_replace(a->>'contato','[^0-9]','','g');
  if tel !~ '^[1-9][0-9]9?[0-9]{8}$' then raise exception 'contato_invalido'; end if;
  select regexp_replace(coalesce(nullif(p.whatsapp,''),p.telefone,''),'[^0-9]','','g') into profile_tel from public.qf_profiles p where p.id=u;
  if profile_tel='55'||tel then profile_tel:=tel; end if;
  if tel is distinct from profile_tel then raise exception 'Use o celular cadastrado na sua conta ou atualize seu perfil antes de publicar.'; end if;
  k:=(a->>'chave')::uuid;
  if not (a ? 'orcamento_centavos') then raise exception 'orcamento_obrigatorio'; end if;
  b:=(a->>'orcamento_centavos')::integer;
  if b is not null and (b<100 or b>50000000) then raise exception 'orcamento_invalido'; end if;
  -- Optional range for the new client; legacy numerical answers remain valid.
  if a ? 'orcamento_faixa' then
    faixa:=a->>'orcamento_faixa';
    if faixa in ('avaliacao','a combinar') then
      if b is not null then raise exception 'avaliacao_sem_valor'; end if;
      faixa_label:='Preciso de uma avaliação';
    elsif faixa ~ '^[0-9]{1,8}:[0-9]{1,8}$' then
      faixa_min:=split_part(faixa,':',1)::integer; faixa_max:=split_part(faixa,':',2)::integer;
      if b is not null or faixa_min<0 or faixa_max<=faixa_min or faixa_max>50000000 then raise exception 'faixa_invalida'; end if;
      faixa_label:=case when faixa_min=0 then 'Até ' else 'R$ '||replace(to_char(faixa_min/100.0,'FM999999990.00'),'.',',')||' a ' end
        ||'R$ '||replace(to_char(faixa_max/100.0,'FM999999990.00'),'.',',');
    else raise exception 'faixa_invalida'; end if;
  end if;
  dt:=(a->>'data')::date;
  if dt<(now() at time zone 'America/Sao_Paulo')::date then raise exception 'data_passada'; end if;
  if a ? 'prazo' and (a->>'prazo' is null or a->>'prazo' not in ('normal','hoje','urgente') or (a->>'prazo' in ('hoje','urgente') and dt<>(now() at time zone 'America/Sao_Paulo')::date)) then raise exception 'prazo_invalido'; end if;
  -- A modalidade é calculada pelo orçamento; não depende da opção de cliente antigo.
  a:=(a - 'qualificacao') || jsonb_build_object('tipo',case when a->>'intencao'='contratar' and (b is not null or faixa_max is not null) then 'garante' else 'tradicional' end);
  -- Lock key and semantic fingerprint: retries and concurrent submits have one winner.
  -- Contact is hashed inside a private table; different quick-access accounts cannot spam the same order.
  fp:=md5(lower(regexp_replace(concat_ws('|',tel,btrim(a->>'categoria'),btrim(a->>'detalhes'),btrim(a->>'escopo'),btrim(a->>'cidade'),a->>'uf',btrim(a->>'bairro'),dt::text),'\s+',' ','g')));
  perform pg_advisory_xact_lock(hashtextextended(k::text,0));
  perform pg_advisory_xact_lock(hashtextextended(fp,1));
  select * into r from private.qf_atendimentos where chave=k;
  if found then
    if r.cliente_id<>u or (r.respostas - 'tipo' - 'qualificacao')<>(a - 'tipo' - 'qualificacao') then raise exception 'chave_reutilizada_com_outros_dados'; end if;
    select * into result from public.qf_chamados where id=r.chamado_id and cliente_id=u;
    if not found then raise exception 'pedido_removido'; end if;
    return to_jsonb(result);
  end if;
  select * into r from private.qf_atendimentos where fingerprint=fp and criado_em>now()-interval '24 hours' order by criado_em desc limit 1;
  if found then
    if r.cliente_id<>u then raise exception 'pedido_duplicado: já existe um pedido equivalente para este contato'; end if;
    if (r.respostas - 'chave' - 'tipo' - 'qualificacao') is distinct from (a - 'chave' - 'tipo' - 'qualificacao') then raise exception 'pedido_duplicado_com_outros_dados: já existe pedido equivalente. Revise o pedido existente antes de alterar modalidade ou condições.'; end if;
    select * into result from public.qf_chamados where id=r.chamado_id and cliente_id=u;
    if found then return to_jsonb(result); end if;
    raise exception 'pedido_duplicado_removido';
  end if;
  -- Geo is only approximate: the frontend resolves city/bairro using the current integration.
  lat:=(p_geo->>'latitude')::numeric; lng:=(p_geo->>'longitude')::numeric;
  if lat is not null and lng is not null and abs(lat)<=90 and abs(lng)<=180 then
    lat:=round(lat,2);lng:=round(lng,2);
  else lat:=null;lng:=null; end if;
  -- Keep routing functional when the browser geocoder is unavailable: use the existing city reference.
  if lat is null or lng is null then
    select round(gc.latitude,2),round(gc.longitude,2) into lat,lng
    from public.qf_cidades_coord gc
    where private.qf_norm_txt(gc.cidade)=private.qf_norm_txt(a->>'cidade') and gc.uf=a->>'uf'
      and gc.latitude between -90 and 90 and gc.longitude between -180 and 180
      and not (gc.latitude=0 and gc.longitude=0)
    limit 1;
  end if;
  if lat is null or lng is null then raise exception 'localizacao_indisponivel: Não foi possível localizar sua cidade agora. Suas respostas continuam aqui; tente novamente.'; end if;
  insert into private.qf_atendimentos(chave,cliente_id,chamado_id,respostas,fingerprint) values(k,u,cid,a,fp);
  descricao_segura:=concat_ws(E'\n',a->>'detalhes','Escopo: '||(a->>'escopo'),'Materiais: '||case a->>'materiais' when 'profissional' then 'O profissional fornece' when 'cliente' then 'O cliente fornece' when 'combinar' then 'A combinar' else 'Não se aplica' end,'Disponibilidade: '||(a->>'disponibilidade'),case when faixa_label is not null then 'Orçamento estimado: '||faixa_label end,case when a ? 'prazo' then 'Prazo: '||case a->>'prazo' when 'hoje' then 'Ainda hoje' when 'urgente' then 'Urgente' else 'Agendado' end||' — '||to_char(dt,'DD/MM/YYYY') end);
  descricao_segura:=replace(descricao_segura,a->>'nome','[nome protegido]');
  insert into public.qf_chamados(id,cliente_id,categoria,titulo,descricao,cidade,uf,bairro,latitude,longitude,geo_precisao,marketing_origem,
    data_preferida,status,prioridade,urgencia,max_orcamentos,orcamento_aproximado_centavos,interesse_cliente,atendimento_id,atendimento_tipo)
  values(cid,u,a->>'categoria',replace(a->>'servico',a->>'nome','[nome protegido]'),descricao_segura,a->>'cidade',a->>'uf',a->>'bairro',lat,lng,case when p_geo->>'geo_precisao' in ('bairro','cidade','cep','gps') then p_geo->>'geo_precisao' else 'cidade' end,case when jsonb_typeof(p_geo->'marketing_origem')='object' and octet_length((p_geo->'marketing_origem')::text)<4000 then p_geo->'marketing_origem' else '{}'::jsonb end,
    ((dt::text||' 12:00:00')::timestamp at time zone 'America/Sao_Paulo'),'aberto',false,a->>'urgencia',case when a->>'tipo'='garante' then 1 else 4 end,b,a->>'intencao',k,a->>'tipo')
  returning * into result;
  perform private.qf13_iniciar_pedido(cid,segredo);
  return to_jsonb(result);
end $function$
;


CREATE OR REPLACE FUNCTION public.qf_comissao13_prestar_contas(p_id uuid, p_situacao text, p_valor_centavos bigint DEFAULT NULL::bigint, p_codigo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ DECLARE f public.qf_comissao13_fechamentos; h text; BEGIN IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','nao_autenticado'); END IF; SELECT * INTO f FROM public.qf_comissao13_fechamentos WHERE id=p_id AND profissional_id=auth.uid() FOR UPDATE; IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','sem_permissao'); END IF; IF f.status NOT IN ('pendente','negociando') THEN RETURN jsonb_build_object('ok',false,'reason','ja_prestado'); END IF; IF p_situacao NOT IN ('informado','negociando','recusado') OR p_situacao IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','situacao_invalida'); END IF; IF p_situacao='negociando' AND f.prorrogacoes_negociacao>=1 THEN RETURN jsonb_build_object('ok',false,'reason','limite_prorrogacao'); END IF; IF p_situacao='informado' THEN IF p_valor_centavos IS NULL OR p_valor_centavos NOT BETWEEN 100 AND 100000000 THEN RETURN jsonb_build_object('ok',false,'reason','valor_invalido'); END IF; IF f.codigo_tentativas>=5 AND f.codigo_tentativa_em>now()-interval '1 hour' THEN RETURN jsonb_build_object('ok',false,'reason','limite_codigo'); END IF; SELECT codigo_hash INTO h FROM private.qf13_codigos_pedido WHERE chamado_id=f.chamado_id; IF p_codigo IS NULL OR p_codigo !~ '^[0-9]{6}$' OR h IS NULL OR h<>encode(extensions.digest(f.chamado_id::text||':'||p_codigo,'sha256'),'hex') THEN UPDATE public.qf_comissao13_fechamentos SET codigo_tentativas=CASE WHEN codigo_tentativa_em<now()-interval '1 hour' THEN 1 ELSE codigo_tentativas+1 END,codigo_tentativa_em=now() WHERE id=p_id; RETURN jsonb_build_object('ok',false,'reason',CASE WHEN h IS NULL THEN 'codigo_nao_emitido_contate_suporte' ELSE 'codigo_invalido' END); END IF; END IF; UPDATE public.qf_comissao13_fechamentos SET status=p_situacao,valor_informado_centavos=CASE WHEN p_situacao='informado' THEN p_valor_centavos ELSE NULL END,prestado_em=now(),informado_em=now(),prazo_contas=CASE WHEN p_situacao='negociando' THEN now()+interval '48 hours' ELSE prazo_contas END,prorrogacoes_negociacao=CASE WHEN p_situacao='negociando' THEN prorrogacoes_negociacao+1 ELSE prorrogacoes_negociacao END,codigo_validado_em=CASE WHEN p_situacao='informado' THEN now() ELSE NULL END WHERE id=p_id; RETURN jsonb_build_object('ok',true,'status',p_situacao,'comissao_devida',false); END $function$
;
create or replace function private.qf13_admin_historico(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin authentication required';end if;
 return jsonb_build_object('eventos',coalesce((select jsonb_agg(jsonb_build_object('em',a.criado_em,'ator',a.ator,'antes',a.antes,'depois',a.depois) order by a.criado_em desc,a.id) from private.qf13_auditoria a where a.fechamento_id=p_id),'[]'::jsonb),'notificacoes',coalesce((select jsonb_agg(jsonb_build_object('status',n.status,'erro',n.erro,'em',n.criado_em,'tentativas',n.tentativas) order by n.criado_em desc) from private.qf_comissao13_notificacoes n where n.chave like 'fechamento13:'||p_id||':%'),'[]'::jsonb));
end $$;
revoke all on function private.qf13_admin_historico(uuid) from public,anon;
grant execute on function private.qf13_admin_historico(uuid) to authenticated;

create or replace function public.qf13_admin_historico(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.qf13_admin_historico(p_id)$$;
revoke all on function public.qf13_admin_historico(uuid) from public,anon;
grant execute on function public.qf13_admin_historico(uuid) to authenticated;

drop trigger if exists qf13_notificar_cliente on public.qf_comissao13_fechamentos;
create trigger qf13_notificar_cliente after insert or update of status on public.qf_comissao13_fechamentos for each row execute function private.qf13_notificar_cliente();
