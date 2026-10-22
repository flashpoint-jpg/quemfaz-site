-- Endurece a validação de telefone e impede uso da baixa antiga no piloto.
create or replace function public.qf_comissao13_propor(p_desbloqueio_id uuid,p_valor_centavos bigint,p_agendado_em timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.qf_desbloqueios; a uuid; t text:=gen_random_uuid()::text; tel text; cli uuid;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
 if not private.qf_comissao13_pronto() then return jsonb_build_object('ok',false,'reason','integracao_pendente'); end if;
 if p_valor_centavos is null or p_valor_centavos<100 or p_valor_centavos>100000000 or p_agendado_em is null or p_agendado_em<now()-interval '1 day' then return jsonb_build_object('ok',false,'reason','dados_invalidos'); end if;
 select * into d from public.qf_desbloqueios where id=p_desbloqueio_id and profissional_id=auth.uid() and ativo and origem='comissao13' for update;
 if not found then return jsonb_build_object('ok',false,'reason','sem_desbloqueio'); end if;
 if exists(select 1 from public.qf_comissao13_acordos where desbloqueio_id=d.id) then return jsonb_build_object('ok',false,'reason','acordo_existente'); end if;
 select c.cliente_id,regexp_replace(coalesce(nullif(p.telefone,''),p.whatsapp,''),'[^0-9]','','g') into cli,tel from public.qf_chamados c join public.qf_profiles p on p.id=c.cliente_id where c.id=d.chamado_id and c.status in ('aberto','em_negociacao');
 if tel is null or length(tel) not in (10,11,12,13) then return jsonb_build_object('ok',false,'reason','telefone_invalido'); end if;
 if cli=auth.uid() or exists(select 1 from public.qf_profiles pr where pr.id=auth.uid() and right(regexp_replace(coalesce(pr.telefone,''),'[^0-9]','','g'),11)=right(tel,11)) then return jsonb_build_object('ok',false,'reason','telefone_profissional'); end if;
 insert into public.qf_comissao13_acordos(chamado_id,desbloqueio_id,profissional_id,cliente_id,valor_centavos,agendado_em,telefone_vinculado,token_hash,token_expira_em)
 values(d.chamado_id,d.id,auth.uid(),cli,p_valor_centavos,p_agendado_em,tel,md5(t),now()+interval '7 days') returning id into a;
 insert into public.qf_comissao13_eventos(acordo_id,tipo,idempotency_key) values(a,'proposto',a||':proposto');
 return jsonb_build_object('ok',true,'acordo_id',a,'token',t);
end $$;
create or replace function public.qf_comissao13_codigo_criar(p_token text,p_finalidade text,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.qf_comissao13_acordos; k uuid;
begin
 select * into a from public.qf_comissao13_acordos where token_hash=md5(p_token) and token_expira_em>now() for update;
 if not found then return jsonb_build_object('ok',false,'reason','link_invalido'); end if;
 if not exists(select 1 from public.qf_chamados c join public.qf_desbloqueios d on d.chamado_id=c.id where c.id=a.chamado_id and d.id=a.desbloqueio_id and d.ativo and c.status not in ('cancelado','expirado','finalizado')) then return jsonb_build_object('ok',false,'reason','estado_invalido'); end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_finalidade is null or p_finalidade not in ('contratar','concluir','contestar') then return jsonb_build_object('ok',false,'reason','dados_invalidos'); end if;
 if (p_finalidade='contratar' and a.status<>'proposto') or (p_finalidade='concluir' and (a.status<>'contratado' or a.agendado_em>now())) or (p_finalidade='contestar' and a.status not in ('proposto','contratado','concluido','pagamento_pendente')) then return jsonb_build_object('ok',false,'reason','estado_invalido'); end if;
 if exists(select 1 from private.qf_comissao13_codigos where acordo_id=a.id and criado_em>now()-interval '60 seconds') or (select count(*) from private.qf_comissao13_codigos where acordo_id=a.id and criado_em>now()-interval '1 hour')>=5 or coalesce((select sum(tentativas) from private.qf_comissao13_codigos where acordo_id=a.id and criado_em>now()-interval '1 hour'),0)>=10 then return jsonb_build_object('ok',false,'reason','limite'); end if;
 update private.qf_comissao13_codigos set usado_em=now() where acordo_id=a.id and usado_em is null;
 insert into private.qf_comissao13_codigos(acordo_id,finalidade,hash,expira_em) values(a.id,p_finalidade,p_hash,now()+interval '5 minutes') returning id into k;
 return jsonb_build_object('ok',true,'codigo_id',k,'telefone',a.telefone_vinculado);
end $$;

-- Impede que a RPC antiga de fechamento substitua a confirmação OTP do piloto.
create or replace function private.qf_comissao13_guardar_desfecho() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.origem='comissao13' and new.desfecho='fechado' and old.desfecho is distinct from new.desfecho and not exists(select 1 from public.qf_comissao13_acordos a where a.desbloqueio_id=new.id and a.concluido_em is not null and a.status not in ('contestado','cancelado')) then
  raise exception 'confirmacao_cliente_otp_obrigatoria';
 end if;
 return new;
end $$;
revoke all on function private.qf_comissao13_guardar_desfecho() from public,anon,authenticated;
drop trigger if exists qf_comissao13_guardar_desfecho on public.qf_desbloqueios;
create trigger qf_comissao13_guardar_desfecho before update of desfecho on public.qf_desbloqueios for each row execute function private.qf_comissao13_guardar_desfecho();
