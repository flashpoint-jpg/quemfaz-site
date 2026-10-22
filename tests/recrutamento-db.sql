-- Executa no banco com transação e rollback: nenhum saldo ou cadastro de teste é persistido.
begin;
create temporary table qr_test(empresa uuid,outra uuid,pacote uuid,vaga uuid,candidato uuid,caminho text);
insert into qr_test(empresa,outra)
 select (select pr.user_id from public.qf_profissionais pr join public.qf_profiles p on p.id=pr.user_id join public.qf_carteiras c on c.profissional_id=pr.user_id where p.ativo order by pr.user_id limit 1),
 (select pr.user_id from public.qf_profissionais pr join public.qf_profiles p on p.id=pr.user_id where p.ativo order by pr.user_id offset 1 limit 1);
grant select,update on qr_test to authenticated,anon;
update public.qf_carteiras set saldo_centavos=0 where profissional_id=(select empresa from qr_test);
select set_config('request.jwt.claim.sub',(select empresa::text from qr_test),true);
set local role authenticated;
do $$ declare r jsonb; begin
 r:=public.qf_recrut_operar('comprar',jsonb_build_object('codigo','essencial','chave','a1111111-1111-4111-a111-111111111111'));
 if r->>'reason'<>'saldo_insuficiente' then raise exception 'TEST: pacote comprado sem saldo'; end if;
 if exists(select 1 from public.qf_recrut_pacotes) then raise exception 'TEST: pacote indevido'; end if;
end $$;
reset role;
update public.qf_carteiras set saldo_centavos=19900 where profissional_id=(select empresa from qr_test);
set local role authenticated;
do $$ declare r jsonb;r2 jsonb;j jsonb;begin
 r:=public.qf_recrut_operar('comprar',jsonb_build_object('codigo','essencial','chave','a1111111-1111-4111-a111-111111111111'));
 r2:=public.qf_recrut_operar('comprar',jsonb_build_object('codigo','essencial','chave','a1111111-1111-4111-a111-111111111111'));
 if r->'pacote'->>'id' is distinct from r2->'pacote'->>'id' then raise exception 'TEST: compra duplicada';end if;
 if (select saldo_centavos from public.qf_carteiras where profissional_id=auth.uid())<>0 then raise exception 'TEST: débito incorreto';end if;
 update qr_test set pacote=(r->'pacote'->>'id')::uuid;
 j:=jsonb_build_object('pacote_id',(select pacote from qr_test),'empresa','Empresa de teste','cargo','Auxiliar de produção','cidade','Campinas','uf','SP','descricao','Descrição fictícia para validação técnica da vaga.','quantidade',2);
 r:=public.qf_recrut_operar('salvar_vaga',j);
 update qr_test set vaga=(r->>'id')::uuid,caminho=(r->>'id')||'/a2222222-2222-4222-a222-222222222222.pdf';
 begin
  perform public.qf_recrut_operar('salvar_vaga',j);
  raise exception 'TEST: limite de vagas ignorado';
 exception when others then if sqlerrm<>'Limite de vagas ativas atingido' then raise;end if;end;
 begin
  perform public.qf_recrut_operar('admin_painel');raise exception 'TEST: admin aberto a empresa';
 exception when others then if sqlerrm<>'Sem permissão' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ declare r jsonb;p jsonb;begin
 r:=public.qf_recrut_operar('vaga_publica',jsonb_build_object('id',(select vaga from qr_test),'visita',true));
 if (r->>'ok')::boolean is not true or r->'vaga' ? 'empresa_id' then raise exception 'TEST: página pública inválida';end if;
 insert into storage.objects(bucket_id,name) values('qf-recrut-curriculos',(select caminho from qr_test));
 p:=jsonb_build_object('vaga_id',(select vaga from qr_test),'nome','Candidato fictício','telefone','11999999888','cidade','Campinas','consentimento',true,'curriculo_path',(select caminho from qr_test));
 r:=public.qf_recrut_operar('candidatar',p);
 if (r->>'ok')::boolean is not true then raise exception 'TEST: candidatura falhou';end if;
 r:=public.qf_recrut_operar('candidatar',p);
 if (r->>'duplicado')::boolean is not true then raise exception 'TEST: candidatura duplicada';end if;
 begin perform count(*) from public.qf_recrut_candidatos;raise exception 'TEST: candidatos públicos';exception when insufficient_privilege then null;end;
 if exists(select 1 from storage.objects where bucket_id='qf-recrut-curriculos') then raise exception 'TEST: currículo público';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select outra::text from qr_test),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.qf_recrut_vagas where id=(select vaga from qr_test)) then raise exception 'TEST: vaga vista por outra empresa';end if;
 if exists(select 1 from public.qf_recrut_candidatos where vaga_id=(select vaga from qr_test)) then raise exception 'TEST: candidatos vistos por outra empresa';end if;
 if exists(select 1 from storage.objects where name=(select caminho from qr_test)) then raise exception 'TEST: currículo visto por outra empresa';end if;
 begin perform public.qf_recrut_operar('status_vaga',jsonb_build_object('id',(select vaga from qr_test),'status','encerrada'));raise exception 'TEST: alteração de outra empresa';exception when others then if sqlerrm<>'Vaga não encontrada' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select empresa::text from qr_test),true);
set local role authenticated;
do $$ declare c uuid;begin
 select id into c from public.qf_recrut_candidatos where vaga_id=(select vaga from qr_test);
 if c is null then raise exception 'TEST: empresa sem candidatura';end if;
 if not exists(select 1 from storage.objects where name=(select caminho from qr_test)) then raise exception 'TEST: empresa sem currículo';end if;
 perform public.qf_recrut_operar('status_candidato',jsonb_build_object('id',c,'status','entrevista'));
 if not exists(select 1 from public.qf_recrut_candidatos where id=c and status='entrevista') then raise exception 'TEST: status não atualizou';end if;
 perform public.qf_recrut_operar('status_vaga',jsonb_build_object('id',(select vaga from qr_test),'status','pausada'));
 if (public.qf_recrut_operar('vaga_publica',jsonb_build_object('id',(select vaga from qr_test)))->>'ok')::boolean is true then raise exception 'TEST: vaga pausada pública';end if;
end $$;
rollback;
select 'PASS: saldo obrigatório, débito único, limite de vagas, candidatura sem conta, currículo privado, isolamento entre empresas, gestão e pausa' as resultado;
