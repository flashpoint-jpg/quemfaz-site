create or replace function public.qf_admin_espelho_profissionais(p_profissional_id uuid default null,p_pagina integer default 0,p_busca text default '',p_status text default '',p_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare feed jsonb; itens jsonb; total bigint; prof jsonb; anterior text; estado jsonb; profissionais jsonb;
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin authentication required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nome',p.nome,'online',pr.online) order by p.nome),'[]'::jsonb) into profissionais from public.qf_profiles p join public.qf_profissionais pr on pr.user_id=p.id;
 estado:=jsonb_build_object('ok',true,'desbloqueio_gratuito_ativo',private.qf13_simplificado_ativo(),'bloqueio',null);
 if p_profissional_id is not null then
  select jsonb_build_object('id',p.id,'nome',p.nome,'fotoUrl',p.foto_url,'categorias',pr.especialidades,'online',pr.online,'statusAprovacao','aprovado','bloqueado',not p.ativo,'creditos',coalesce(w.saldo_centavos,0),'raioKm',pr.raio_km,'horarioInicio',pr.horario_inicio,'horarioFim',pr.horario_fim,'cidadeNome',p.cidade,'uf',p.uf,'areasAtendimento','[]'::jsonb,'plano',(select jsonb_build_object('restantes',sum(chamados_restantes),'validoAte',min(valido_ate)) from public.qf_planos_profissional where profissional_id=p.id and valido_ate>now() and chamados_restantes>0)) into prof from public.qf_profiles p join public.qf_profissionais pr on pr.user_id=p.id left join public.qf_carteiras w on w.profissional_id=p.id where p.id=p_profissional_id;
  if prof is null then raise exception 'profissional não encontrado';end if;
  anterior:=current_setting('request.jwt.claim.sub',true);
  perform set_config('request.jwt.claim.sub',p_profissional_id::text,true);
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into feed from public.qf_portfolio_servicos() x;
  select feed||coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into feed from public.qf_portfolio_abertos_todos() x;
  estado:=public.qf_comissao13_status();
  perform set_config('request.jwt.claim.sub',coalesce(anterior,''),true);
 end if;
 with dados as (
  select to_jsonb(c)||jsonb_build_object('status_banco',c.status,'status',case when c.status in ('aberto','em_negociacao') and (select count(*) from public.qf_desbloqueios d where d.chamado_id=c.id and coalesce(d.ativo,true))<least(4,public.qf_limite_orcamentos(c.id)) then 'aberto' else c.status end,'preco_centavos',coalesce((select preco_centavos from public.qf_precos_desbloqueio where categoria=c.categoria and ativo),790),'participantes',(select count(*) from public.qf_desbloqueios d where d.chamado_id=c.id and coalesce(d.ativo,true)),'limite',least(4,public.qf_limite_orcamentos(c.id)))||coalesce((select value from jsonb_array_elements(coalesce(feed,'[]'::jsonb)) where value->>'id'=c.id::text limit 1),'{}'::jsonb) r
  from public.qf_chamados c where (p_profissional_id is null or exists(select 1 from jsonb_array_elements(feed) x where x->>'id'=c.id::text)) and (p_id is null or c.id=p_id)
 ), filtrados as(select r from dados where (coalesce(p_status,'')='' or r->>'status_banco'=p_status) and (coalesce(p_busca,'')='' or concat_ws(' ',r->>'id',r->>'titulo',r->>'descricao',r->>'cidade',r->>'categoria') ilike '%'||left(p_busca,200)||'%'))
 select (select count(*) from filtrados),coalesce((select jsonb_agg(r order by r->>'criado_em' desc,r->>'id' desc) from(select r from filtrados order by r->>'criado_em' desc,r->>'id' desc limit 50 offset greatest(0,least(coalesce(p_pagina,0),100000))*50) pagina),'[]'::jsonb) into total,itens;
 return jsonb_build_object('itens',itens,'total',total,'profissional',prof,'profissionais',profissionais,'estado',estado,'gerado_em',now());
end $$;
revoke all on function public.qf_admin_espelho_profissionais(uuid,integer,text,text,uuid) from public,anon;
grant execute on function public.qf_admin_espelho_profissionais(uuid,integer,text,text,uuid) to authenticated;
