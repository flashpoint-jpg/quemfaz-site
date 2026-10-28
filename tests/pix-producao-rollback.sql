-- Executar somente em transação: não persiste chave nem movimenta dinheiro.
begin;
create temporary table qf_pix_test_ids as
 select user_id, row_number() over(order by user_id) n from public.qf_profissionais order by user_id limit 2;
grant select on qf_pix_test_ids to authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from qf_pix_test_ids where n=1),true);
set local role authenticated;
do $$
declare a uuid; b uuid; changed int;
begin
 select user_id into a from qf_pix_test_ids where n=1;
 select user_id into b from qf_pix_test_ids where n=2;
 insert into public.qf_livre_pix_chaves(profissional_id,chave_pix) values(a,'qa-rollback@example.com')
 on conflict(profissional_id) do update set chave_pix=excluded.chave_pix,status='pendente';
 update public.qf_livre_pix_chaves set chave_pix='qa-edit@example.com' where profissional_id=a;
 if not exists(select 1 from public.qf_livre_pix_chaves where profissional_id=a and chave_pix='qa-edit@example.com') then raise exception 'own edit failed';end if;
 if exists(select 1 from public.qf_livre_pix_chaves where profissional_id=b) then raise exception 'cross-account read';end if;
 update public.qf_livre_pix_chaves set chave_pix='forbidden@example.com' where profissional_id=b;
 get diagnostics changed = row_count;
 if changed<>0 then raise exception 'cross-account write';end if;
 begin
  insert into public.qf_livre_pix_chaves(profissional_id,chave_pix) values(b,'forbidden@example.com');
  raise exception 'cross-account insert accepted';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.qf_operacao_financeira_admin();
  raise exception 'non-admin financial access accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select user_id::text from public.qf_admins limit 1),true);
set local role authenticated;
do $$
declare d jsonb;
begin
 d:=public.qf_operacao_financeira_admin();
 if jsonb_typeof(d->'pedidos')<>'array' or jsonb_typeof(d->'chaves')<>'array' then raise exception 'admin response invalid';end if;
 if not exists(select 1 from jsonb_array_elements(d->'chaves') k where k->>'chave_pix'='qa-edit@example.com') then raise exception 'admin cannot see registered key';end if;
end $$;
reset role;
rollback;
select 'PASS: own insert/edit, cross-user read/write/insert denied, admin sees key, non-admin denied; ROLLBACK' as resultado;
