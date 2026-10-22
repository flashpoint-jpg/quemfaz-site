-- Run inside BEGIN / ROLLBACK; no fixture survives and no push is dispatched.
do $test$
declare pro uuid; cli uuid; categoria_teste text; chamada uuid; n integer; ids uuid[];
begin
 select p.user_id,p.especialidades[1] into pro,categoria_teste
 from public.qf_profissionais p join public.qf_profiles pf on pf.id=p.user_id
 where cardinality(p.especialidades)>0 and coalesce(pf.ativo,true)
 and nullif(trim(pf.foto_url),'') is not null
 and private.qf_pendencia_finalizacao(p.user_id,'profissional') is null limit 1;
 if pro is null then raise exception 'No eligible integration fixture'; end if;
 select id into cli from public.qf_profiles where id<>pro limit 1;
 update public.qf_profissionais set latitude=-23.55,longitude=-46.63,raio_km=10,online=true,
 horario_inicio='00:00',horario_fim='00:00' where user_id=pro;
 if not private.qf_pro_atende_regiao(pro,'São Paulo','SP',-23.55,-46.63) then raise exception 'Same point blocked'; end if;
 if not private.qf_pro_atende_regiao(pro,'São Paulo','SP',-23.60,-46.63) then raise exception 'Inside radius blocked'; end if;
 if private.qf_pro_atende_regiao(pro,'São Paulo','SP',-23.75,-46.63) then raise exception 'Outside radius allowed'; end if;
 if private.qf_pro_atende_regiao(pro,'São Paulo','SP',null,null) then raise exception 'Missing client GPS allowed'; end if;
 if private.qf_pro_atende_regiao(pro,'São Paulo','SP',0,0) then raise exception 'Zero client GPS allowed'; end if;
 insert into public.qf_chamados(cliente_id,categoria,titulo,descricao,cidade,uf,latitude,longitude,status,data_preferida)
 values(cli,categoria_teste,'Validação transacional','Teste revertido ao final','São Paulo','SP',-23.60,-46.63,'aberto',now()+interval '2 days') returning id into chamada;
 select count(*) into n from public.qf_chamado_destinatarios_alcance(chamada,200) where user_id=pro;
 if n<>1 then raise exception 'Eligible push recipient blocked'; end if;
 ids:=public.qf_push_reservar_entregas(chamada,array[pro,pro],'new_call',200);
 if cardinality(ids)<>1 then raise exception 'Reservation must deduplicate input'; end if;
 ids:=public.qf_push_reservar_entregas(chamada,array[pro],'new_call',200);
 if cardinality(ids)<>0 then raise exception 'Concurrent retry must not duplicate delivery'; end if;
 perform set_config('request.jwt.claim.sub',pro::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pro,'role','authenticated')::text,true);
 if not exists(select 1 from public.qf_listar_chamados_disponiveis() where id=chamada) then raise exception 'Eligible acceptance blocked'; end if;
 update public.qf_chamados set latitude=-23.75 where id=chamada;
 if exists(select 1 from public.qf_chamado_destinatarios_alcance(chamada,200) where user_id=pro) then raise exception 'Push exceeds configured radius'; end if;
 if exists(select 1 from public.qf_listar_chamados_disponiveis() where id=chamada) then raise exception 'Acceptance exceeds radius'; end if;
 update public.qf_chamados set latitude=-23.60 where id=chamada;
 update public.qf_profissionais set online=false where user_id=pro;
 if exists(select 1 from public.qf_chamado_destinatarios_alcance(chamada,200) where user_id=pro) then raise exception 'Offline push allowed'; end if;
 if exists(select 1 from public.qf_listar_chamados_disponiveis() where id=chamada) then raise exception 'Offline acceptance allowed'; end if;
 update public.qf_profissionais set online=true,horario_inicio=((now() at time zone 'America/Sao_Paulo')+interval '2 hours')::time,
 horario_fim=((now() at time zone 'America/Sao_Paulo')+interval '3 hours')::time where user_id=pro;
 if exists(select 1 from public.qf_chamado_destinatarios_alcance(chamada,200) where user_id=pro) then raise exception 'Outside working hours push allowed'; end if;
 if exists(select 1 from public.qf_listar_chamados_disponiveis() where id=chamada) then raise exception 'Outside working hours acceptance allowed'; end if;
 update public.qf_profissionais set latitude=null,longitude=null,horario_inicio='00:00',horario_fim='00:00' where user_id=pro;
 if private.qf_pro_atende_regiao(pro,'São Paulo','SP',-23.60,-46.63) then raise exception 'Missing device GPS replaced by address'; end if;
 update public.qf_profissionais set latitude=-23.55,longitude=-46.63 where user_id=pro;
 update public.qf_chamados set categoria='__categoria_integracao__' where id=chamada;
 if exists(select 1 from public.qf_chamado_destinatarios_alcance(chamada,200) where user_id=pro) then raise exception 'Wrong profession notified'; end if;
 if exists(select 1 from public.qf_listar_chamados_disponiveis() where id=chamada) then raise exception 'Wrong profession accepted'; end if;
 raise notice 'PASS: radius, GPS, online, hours, profession, visibility/acceptance eligibility';
end $test$;
