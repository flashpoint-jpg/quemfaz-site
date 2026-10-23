-- Executar como uma única transação no Supabase. ROLLBACK é obrigatório.
-- Todas as identidades são sintéticas; pg_net só despacha após COMMIT, que não existe aqui.
begin;
set local statement_timeout='20s';
create temporary table qf13_fixture_ids(n integer primary key,id uuid default gen_random_uuid());
insert into qf13_fixture_ids(n) select generate_series(1,9);
-- Sementes controladas: nenhum gatilho de cadastro, cobrança ou publicação é executado na preparação.
set local session_replication_role=replica;
insert into auth.users(id,email,raw_user_meta_data) select id,'qf13-fixture-'||id||'@example.invalid','{}'::jsonb from qf13_fixture_ids where n<=7;
insert into public.qf_profiles(id,tipo,nome,telefone,whatsapp,foto_url) select id,case when n=6 then 'cliente' when n=7 then 'admin' else 'profissional' end,'QF13 FIXTURE ROLLBACK','11987654321','11987654321','https://example.invalid/fixture.png' from qf13_fixture_ids where n<=7;
insert into public.qf_profissionais(user_id,especialidades,raio_km,online,latitude,longitude,horario_inicio,horario_fim) select id,array['cat_eletricista'],22,true,-23.65,-46.53,'00:00','00:00' from qf13_fixture_ids where n<=5;
insert into public.qf_profissional_cidades(profissional_id,cidade,uf,raio_km) select id,'Santo André','SP',22 from qf13_fixture_ids where n<=5;
insert into public.qf_carteiras(profissional_id,saldo_centavos) select id,10000 from qf13_fixture_ids where n<=5;
insert into public.qf_admins(user_id) select id from qf13_fixture_ids where n=7;
insert into public.qf_chamados(id,cliente_id,categoria,titulo,descricao,cidade,uf,bairro,latitude,longitude,max_orcamentos,atendimento_tipo) select x.id,c.id,'cat_eletricista','QF13 FIXTURE ROLLBACK','Teste controlado que será revertido','Santo André','SP','Centro',-23.65,-46.53,4,'tradicional' from qf13_fixture_ids x cross join qf13_fixture_ids c where x.n in (8,9) and c.n=6;
insert into public.qf_recargas(profissional_id,valor_centavos,metodo,status,plano,provedor,provedor_id) select id,3990,'pix','aprovado','livre','efi','fixture-confirmed-'||id from qf13_fixture_ids where n=3;
set local session_replication_role=origin;
do $$
declare p uuid;c uuid;c2 uuid;cl uuid;adm uuid;f uuid;f2 uuid;r jsonb;t text;k uuid;v_code text;rec uuid;i integer;v_rejected boolean;v_answers jsonb;
begin
 select id into c from qf13_fixture_ids where n=8;select id into c2 from qf13_fixture_ids where n=9;select id into cl from qf13_fixture_ids where n=6;select id into adm from qf13_fixture_ids where n=7;
 perform set_config('request.jwt.claim.sub',cl::text,true);
 v_answers:=jsonb_build_object('versao',1,'chave',gen_random_uuid(),'categoria','cat_eletricista','servico','Eletricista','detalhes','Trocar uma tomada elétrica','escopo','Um item','cidade','Santo André','uf','SP','bairro','Centro','urgencia','normal','prazo','normal','orcamento_centavos',null,'orcamento_faixa','a combinar','materiais','profissional','data',null,'disponibilidade','A combinar diretamente','nome','Cliente Fixture','contato','11987654321','intencao','contratar','autorizacao','sim','tipo','tradicional','segredo_acompanhamento',repeat('a',64));
 r:=public.qf_publicar_atendimento(v_answers,jsonb_build_object('latitude',-23.65,'longitude',-46.53));c:=(r->>'id')::uuid;
 if r::text like '%'||repeat('a',64)||'%' then raise exception 'owner secret exposed';end if;
 perform set_config('request.jwt.claim.sub','',true);r:=public.qf13_acompanhar(c,repeat('a',64));v_code:=r->>'codigo';if not coalesce((r->>'ok')::boolean,false) or v_code!~'^[0-9]{6}$' then raise exception 'owner screen code: %',r;end if;
 r:=public.qf13_acompanhar(c,repeat('b',64));if (r->>'ok')::boolean then raise exception 'wrong browser access';end if;
 for i in 1..4 loop
  select id into p from qf13_fixture_ids where n=i;perform set_config('request.jwt.claim.sub',p::text,true);
  if i=3 then
   select id into rec from public.qf_recargas where profissional_id=p;perform private.qf_livre_ativar_recarga(rec);
   r:=public.qf_livre_desbloquear(c,true);
  elsif i in (1,4) then r:=public.qf_comissao13_desbloquear(c,true);
  else r:=public.qf_desbloquear_chamado(c);end if;
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'unlock mode %: %',i,r;end if;
 end loop;
 select id into p from qf13_fixture_ids where n=5;perform set_config('request.jwt.claim.sub',p::text,true);r:=public.qf_comissao13_desbloquear(c,true);
 if coalesce((r->>'ok')::boolean,false) then raise exception 'limit 4 failed';end if;
 select f0.id into f from public.qf_comissao13_fechamentos f0 join qf13_fixture_ids x on x.id=f0.profissional_id where x.n=1 and f0.chamado_id=c;
 select id into p from qf13_fixture_ids where n=1;perform set_config('request.jwt.claim.sub',p::text,true);
 r:=public.qf_comissao13_prestar_contas(f,'informado',50000,v_code);if not (r->>'ok')::boolean then raise exception 'service code: %',r;end if;
 if exists(select 1 from public.qf_comissao13_fechamentos where id=f and comissao_centavos is not null) then raise exception 'commission before admin';end if;
 perform set_config('request.jwt.claim.sub',adm::text,true);r:=public.qf_comissao13_admin(f,'confirmar',50000,'Cliente sintético confirmado no teste reversível');if not (r->>'ok')::boolean then raise exception 'admin: %',r;end if;
 if not exists(select 1 from public.qf_comissao13_fechamentos where id=f and comissao_centavos=6500 and cobranca_status='pendente') then raise exception '13 percent';end if;
 r:=public.qf_comissao13_admin(f,'pago',null,'Comprovante sintético no teste reversível');if not (r->>'ok')::boolean then raise exception 'payment review: %',r;end if;
 select f0.id into f2 from public.qf_comissao13_fechamentos f0 join qf13_fixture_ids x on x.id=f0.profissional_id where x.n=3 and f0.chamado_id=c;
 select id into p from qf13_fixture_ids where n=3;perform set_config('request.jwt.claim.sub',p::text,true);
 update public.qf_comissao13_fechamentos set prazo_contas=now()-interval '1 minute' where id=f2;
 if private.qf13_bloqueio(p) is distinct from 'prestacao_contas_vencida' then raise exception '48 hour block';end if;
 r:=public.qf_livre_desbloquear(c2,true);if r->>'reason'<>'prestacao_contas_vencida' then raise exception 'Livre bypass: %',r;end if;
 v_rejected:=false;begin r:=public.qf_desbloquear_chamado(c2);v_rejected:=(r->>'reason'='prestacao_contas_vencida');exception when others then if sqlerrm like '%prestacao_contas_vencida%' then v_rejected:=true;else raise;end if;end;
 if not v_rejected then raise exception 'Avulso bypass';end if;
 r:=public.qf_comissao13_prestar_contas(f2,'negociando');if not (r->>'ok')::boolean then raise exception 'extension: %',r;end if;
 r:=public.qf_comissao13_prestar_contas(f2,'negociando');if r->>'reason'<>'limite_prorrogacao' then raise exception 'double extension';end if;
 r:=public.qf_comissao13_prestar_contas(f2,'recusado');if not (r->>'ok')::boolean or private.qf13_bloqueio(p) is not null then raise exception 'regularization';end if;
 perform set_config('request.jwt.claim.sub','',true);r:=public.qf13_acompanhar(c,repeat('a',64),'responder',f2,true);
 if r->>'resposta'<>'divergencia' then raise exception 'divergence: %',r;end if;
 if private.qf13_bloqueio(p) is not null then raise exception 'automatic suspension from divergence';end if;
 perform set_config('request.jwt.claim.sub',adm::text,true);r:=public.qf13_admin_historico(f2);if jsonb_array_length(r->'eventos')<2 or jsonb_array_length(r->'notificacoes')<2 then raise exception 'audit missing';end if;
end $$;
rollback;
select 'PASS: real publication, private owner receipt, six-digit code, three modalities, commission approval and divergence; all synthetic fixtures rolled back' as resultado;
