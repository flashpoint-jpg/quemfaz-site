-- Reconhece a identificação protegida já validada; não copia CPF/CNPJ para campos públicos.
create or replace function private.qf_livre_identificado(p_uid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.qf_profissionais pr join public.qf_profiles p on p.id=pr.user_id
 where pr.user_id=p_uid and p.tipo='profissional' and (
 nullif(trim(pr.documento),'') is not null or exists(select 1 from private.qf_identidades i
 where i.user_id=p_uid and (i.cpf_hash is not null or i.cnpj_hash is not null))))
$$;
revoke all on function private.qf_livre_identificado(uuid) from public,anon,authenticated;

create or replace function private.qf_livre_iniciar_por_identidade() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if private.qf_livre_identificado(new.user_id) then
  update private.qf_livre_beneficios set inicio_em=statement_timestamp(),
   fim_em=statement_timestamp()+make_interval(days=>dias)
  where user_id=new.user_id and inicio_em is null and encerrado_em is null;
 end if;
 return new;
end $$;
revoke all on function private.qf_livre_iniciar_por_identidade() from public,anon,authenticated;
create trigger qf_livre_identidade_validada after insert or update of cpf_hash,cnpj_hash
on private.qf_identidades for each row execute function private.qf_livre_iniciar_por_identidade();

do $migration$
declare source text;
begin
 select pg_get_functiondef(oid) into source from pg_proc where pronamespace='private'::regnamespace and proname='qf_livre_preparar_acesso';
 source:=replace(source,$old$EXISTS(SELECT 1 FROM public.qf_profissionais WHERE user_id=u.id AND nullif(documento,'') IS NOT NULL)$old$,$new$private.qf_livre_identificado(u.id)$new$);
 if position('qf_livre_identificado' in source)=0 then raise exception 'Não foi possível atualizar preparação'; end if;
 execute source;
 select pg_get_functiondef(oid) into source from pg_proc where pronamespace='private'::regnamespace and proname='qf_admin_livre_beneficio';
 source:=replace(source,$old$EXISTS(SELECT 1 FROM public.qf_profissionais WHERE user_id=uid AND nullif(documento,'') IS NOT NULL)$old$,$new$private.qf_livre_identificado(uid)$new$);
 if position('qf_livre_identificado' in source)=0 then raise exception 'Não foi possível atualizar cortesia'; end if;
 execute source;
end $migration$;

-- Somente benefícios já concedidos e ainda sem início: não renova teste vencido.
update private.qf_livre_beneficios b set inicio_em=statement_timestamp(),
 fim_em=statement_timestamp()+make_interval(days=>b.dias)
where b.inicio_em is null and b.encerrado_em is null and private.qf_livre_identificado(b.user_id);

alter table public.qf_profissionais add column modalidade_preferida text not null default 'livre'
 check(modalidade_preferida in ('livre','avulso'));
create or replace function public.qf_livre_escolher_modalidade(p_modalidade text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_modalidade not in ('livre','avulso') or p_modalidade is null then
  raise exception 'Modalidade inválida ou acesso ausente' using errcode='42501';
 end if;
 update public.qf_profissionais set modalidade_preferida=p_modalidade where user_id=auth.uid()
 and exists(select 1 from public.qf_profiles where id=auth.uid() and tipo='profissional');
 if not found then raise exception 'Conta profissional obrigatória' using errcode='42501'; end if;
 return jsonb_build_object('ok',true,'preferencia',p_modalidade);
end $$;
revoke all on function public.qf_livre_escolher_modalidade(text) from public,anon;
grant execute on function public.qf_livre_escolher_modalidade(text) to authenticated;

do $migration$
declare source text;
begin
 select pg_get_functiondef(oid) into source from pg_proc where pronamespace='private'::regnamespace and proname='qf_livre_status_beneficio';
 source:=replace(source,$old$jsonb_build_object('tipo_acesso','pago')$old$,$new$jsonb_build_object('tipo_acesso','pago','servidor_agora',clock_timestamp(),'duracao_dias',30,'preferencia',coalesce((select modalidade_preferida from public.qf_profissionais where user_id=auth.uid()),'livre'))$new$);
 source:=replace(source,$old$RETURN s||jsonb_build_object('ativo',$old$,$new$RETURN s||jsonb_build_object('preferencia',coalesce((select modalidade_preferida from public.qf_profissionais where user_id=auth.uid()),'livre'),'ativo',$new$);
 execute source;
end $migration$;
