-- Somente branch de revisão. Aplicar apenas após aprovação e homologação.
-- Altera somente publicação, preservando locks, fingerprint, permissões e desbloqueio.
begin;
create or replace function public.qf_publicar_atendimento(p_respostas jsonb, p_geo jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); k uuid; cid uuid:=gen_random_uuid(); a jsonb:=p_respostas;
  r private.qf_atendimentos; result public.qf_chamados; fp text; f text; b integer; dt date;
  faixa text; faixa_min integer; faixa_max integer; faixa_label text;
  tel text; profile_tel text; descricao_segura text; lat numeric; lng numeric;
begin
  if u is null or not exists(select 1 from public.qf_profiles p where p.id=u and p.tipo='cliente' and coalesce(p.ativo,true)) then raise exception 'cliente_autenticado_obrigatorio'; end if;
  if jsonb_typeof(a) is distinct from 'object' or octet_length(a::text)>20000 or a->>'versao' is distinct from '1' then raise exception 'atendimento_invalido'; end if;
  foreach f in array array['chave','categoria','servico','detalhes','escopo','cidade','uf','bairro','urgencia','materiais','data','disponibilidade','nome','contato','intencao','autorizacao','tipo'] loop
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
    if faixa='avaliacao' then
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
  if a->>'tipo'='garante' and (a->>'intencao'<>'contratar' or (b is null and faixa_max is null) or a->>'materiais'='combinar' or a->>'qualificacao' is distinct from 'sim') then raise exception 'garante_nao_qualificado'; end if;
  -- Lock key and semantic fingerprint: retries and concurrent submits have one winner.
  -- Contact is hashed inside a private table; different quick-access accounts cannot spam the same order.
  fp:=md5(lower(regexp_replace(concat_ws('|',tel,btrim(a->>'categoria'),btrim(a->>'detalhes'),btrim(a->>'escopo'),btrim(a->>'cidade'),a->>'uf',btrim(a->>'bairro'),dt::text),'\s+',' ','g')));
  perform pg_advisory_xact_lock(hashtextextended(k::text,0));
  perform pg_advisory_xact_lock(hashtextextended(fp,1));
  select * into r from private.qf_atendimentos where chave=k;
  if found then
    if r.cliente_id<>u or r.respostas<>a then raise exception 'chave_reutilizada_com_outros_dados'; end if;
    select * into result from public.qf_chamados where id=r.chamado_id and cliente_id=u;
    if not found then raise exception 'pedido_removido'; end if;
    return to_jsonb(result);
  end if;
  select * into r from private.qf_atendimentos where fingerprint=fp and criado_em>now()-interval '24 hours' order by criado_em desc limit 1;
  if found then
    if r.cliente_id<>u then raise exception 'pedido_duplicado: já existe um pedido equivalente para este contato'; end if;
    if (r.respostas - 'chave') is distinct from (a - 'chave') then raise exception 'pedido_duplicado_com_outros_dados: já existe pedido equivalente. Revise o pedido existente antes de alterar modalidade ou condições.'; end if;
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
  return to_jsonb(result);
end $$;
revoke all on function public.qf_publicar_atendimento(jsonb,jsonb) from public,anon;
grant execute on function public.qf_publicar_atendimento(jsonb,jsonb) to authenticated;

commit;
