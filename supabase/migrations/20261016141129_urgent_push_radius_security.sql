-- Shared exact eligibility: only real device coordinates and the professional's own radius.
create or replace function private.qf_pro_atende_regiao(p_pro uuid,p_cidade text,p_uf text,p_lat numeric,p_lng numeric)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.qf_profissionais pr
 where pr.user_id=p_pro
 and pr.latitude between -90 and 90 and pr.longitude between -180 and 180
 and not (pr.latitude=0 and pr.longitude=0)
 and p_lat between -90 and 90 and p_lng between -180 and 180
 and not (p_lat=0 and p_lng=0)
 and public.qf_distancia_km(pr.latitude,pr.longitude,p_lat,p_lng)<=coalesce(pr.raio_km,20));
$$;

create or replace function public.qf_chamado_destinatarios_alcance(p_chamado_id uuid,p_raio_km integer default 0)
returns table(user_id uuid,online boolean,distancia_regiao_km numeric)
language sql stable security definer set search_path='' as $$
 select pr.user_id,pr.online,
 round(public.qf_distancia_km(pr.latitude,pr.longitude,c.latitude,c.longitude),1)
 from public.qf_chamados c
 join public.qf_profissionais pr on c.categoria=any(coalesce(pr.especialidades,array[]::text[]))
 join public.qf_profiles pf on pf.id=pr.user_id and coalesce(pf.ativo,true)
 where c.id=p_chamado_id and c.status in ('aberto','em_negociacao')
 and pr.user_id<>c.cliente_id and pr.online is true
 and private.qf_dentro_horario(pr.horario_inicio,pr.horario_fim)
 and private.qf_pendencia_finalizacao(pr.user_id,'profissional') is null
 and private.qf_pro_recebe_chamado(pr.user_id,c.id)
 and not exists(select 1 from public.qf_orcamentos o where o.chamado_id=c.id and o.status='aceito')
 and not exists(select 1 from public.qf_desbloqueios d where d.chamado_id=c.id and d.profissional_id=pr.user_id)
 and (select count(*) from public.qf_desbloqueios d where d.chamado_id=c.id and coalesce(d.ativo,true))<public.qf_limite_orcamentos(c.id)
 -- Same-city priority never overrides the exact radius check above.
 and ((coalesce(p_raio_km,0)=0 and private.qf_pro_atende_cidade(pr.user_id,c.cidade,c.uf::text))
 or (p_raio_km>0 and public.qf_distancia_km(pr.latitude,pr.longitude,c.latitude,c.longitude)<=p_raio_km))
 order by public.qf_distancia_km(pr.latitude,pr.longitude,c.latitude,c.longitude);
$$;

-- Preserve the existing result schema and paid-unlock implementation. Its eligibility
-- query now also enforces online and working hours before any payment mutation.
do $$ declare definition text; begin
 select pg_get_functiondef('public.qf_listar_chamados_disponiveis()'::regprocedure) into definition;
 if position('where pr.user_id=auth.uid()' in definition)=0 then raise exception 'Unexpected available-calls definition'; end if;
 execute replace(definition,'where pr.user_id=auth.uid()',
 'where pr.user_id=auth.uid() and pr.online is true and private.qf_dentro_horario(pr.horario_inicio,pr.horario_fim)');
end $$;

-- These trigger functions cannot be used as RPCs. Trigger execution is unaffected.
revoke execute on function public.qf_disparar_push_novo_chamado() from public,anon,authenticated;
revoke execute on function public.qf_exigir_selfie_para_online() from public,anon,authenticated;
revoke execute on function public.qf_fill_profile_email() from public,anon,authenticated;
-- Admin-only function already checks identity; anon has no legitimate dependency.
revoke execute on function public.qf_admin_profissionais_pedido(uuid) from public,anon;
grant execute on function public.qf_admin_profissionais_pedido(uuid) to authenticated;
alter function public.qf_normalizar_whatsapp(text) set search_path='';
alter function private.qf_cidade_chave(text,text) set search_path='';
alter function private.qf_coord_cidade(text,text) set search_path='';

-- Supporting indexes only: no changes to financial data, RLS or business rules.
create index if not exists qf_chat_mensagens_profissional_fk_idx on public.qf_chat_mensagens(profissional_id);
create index if not exists qf_chat_mensagens_remetente_fk_idx on public.qf_chat_mensagens(remetente_id);
create index if not exists qf_chat_presenca_profissional_fk_idx on public.qf_chat_presenca(profissional_id);
create index if not exists qf_chat_presenca_user_fk_idx on public.qf_chat_presenca(user_id);
create index if not exists qf_desbloqueios_plano_fk_idx on public.qf_desbloqueios(plano_id);
create index if not exists qf_devolucoes_lead_chamado_fk_idx on public.qf_devolucoes_lead(chamado_id);
create index if not exists qf_planos_profissional_anuncio_fk_idx on public.qf_planos_profissional(anuncio_id);
create index if not exists qf_pre_cadastro_pagamentos_plano_fk_idx on public.qf_pre_cadastro_pagamentos(plano);
create index if not exists qf_pre_cadastro_pagamentos_profissional_fk_idx on public.qf_pre_cadastro_pagamentos(profissional_id);
create index if not exists qf_recrut_pacotes_codigo_fk_idx on public.qf_recrut_pacotes(codigo);
create index if not exists qf_recrut_vagas_pacote_fk_idx on public.qf_recrut_vagas(pacote_id);
create index if not exists qf_suporte_atendimentos_atendido_fk_idx on public.qf_suporte_atendimentos(atendido_por);
create index if not exists qf_suporte_mensagens_autor_fk_idx on public.qf_suporte_mensagens(autor_id);
