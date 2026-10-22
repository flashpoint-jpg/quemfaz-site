-- QuemFaz: corrige a distribuicao de chamados para respeitar profissao e raio do profissional.
-- Remove o efeito de liberar pedido sem aceite para profissionais fora da area.

create or replace function private.qf_pro_recebe_chamado(p_pro uuid, p_chamado_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.qf_chamados c
    join public.qf_profissionais pr on pr.user_id = p_pro
    left join lateral private.qf_chamado_centro(c.id) g on true
    where c.id = p_chamado_id
      and c.categoria = any(coalesce(pr.especialidades, array[]::text[]))
      and (
        (g.latitude is not null and g.longitude is not null and pr.latitude is not null and pr.longitude is not null
         and public.qf_distancia_km(pr.latitude, pr.longitude, g.latitude, g.longitude) <= greatest(1, coalesce(pr.raio_km,20)))
        or exists (
          select 1 from public.qf_profissional_cidades pc
          where pc.profissional_id=p_pro
            and g.latitude is not null and g.longitude is not null
            and pc.latitude is not null and pc.longitude is not null
            and public.qf_distancia_km(pc.latitude,pc.longitude,g.latitude,g.longitude) <= greatest(1,coalesce(pc.raio_km,pr.raio_km,20))
        )
        or (g.latitude is null and private.qf_pro_atende_cidade(p_pro,c.cidade,c.uf::text))
      )
  );
$$;

create or replace function private.qf_chamado_aberto_todos(p_chamado_id uuid)
returns text
language sql stable security definer set search_path to ''
as $$
 select case
   when c.status not in ('aberto','em_negociacao') then null
   when exists(select 1 from public.qf_desbloqueios d where d.chamado_id=c.id and coalesce(d.ativo,true)) then null
   when exists(select 1 from public.qf_chamado_cascata k where k.chamado_id=c.id and k.etapa>=3) then 'sem_desbloqueio'
   else null
 end
 from public.qf_chamados c where c.id=p_chamado_id;
$$;

-- A lista final tambem exige elegibilidade; a cascata nunca vira liberacao nacional.
do $do$
declare def text := pg_get_functiondef('public.qf_listar_chamados_disponiveis()'::regprocedure); novo text;
begin
 novo := regexp_replace(def,
   'private\.qf_pro_recebe_chamado\(p\.user_id,c\.id\)\s+or \(c\.cliente_id is distinct from p\.user_id and private\.qf_chamado_aberto_todos\(c\.id\) is not null\)',
   'private.qf_pro_recebe_chamado(p.user_id,c.id)');
 if novo <> def then execute novo; end if;
end $do$;

-- Retencao configuravel dos pedidos abertos sem aceite. Padrao: 3 dias.
insert into public.qf_config(chave,valor)
values('pedidos_abertos_retencao','{"ativo":true,"dias":3}'::jsonb)
on conflict(chave) do nothing;

create or replace function private.qf_expirar_pedidos_abertos()
returns integer language plpgsql security definer set search_path to ''
as $$
declare cfg jsonb; ativo boolean; dias integer; total integer;
begin
 select valor into cfg from public.qf_config where chave='pedidos_abertos_retencao';
 ativo:=coalesce((cfg->>'ativo')::boolean,true);
 dias:=least(30,greatest(1,coalesce((cfg->>'dias')::integer,3)));
 if not ativo then return 0; end if;
 with x as (
   update public.qf_chamados c set status='cancelado'
   from public.qf_chamado_cascata k
   where k.chamado_id=c.id and k.etapa>=3 and k.aceito_em is null and k.etapa3_em is not null
     and c.status in ('aberto','em_negociacao')
     and k.etapa3_em <= now()-make_interval(days=>dias)
     and not exists(select 1 from public.qf_desbloqueios d where d.chamado_id=c.id and coalesce(d.ativo,true))
   returning c.id
 ) select count(*) into total from x;
 return total;
end;
$$;

select cron.unschedule(jobid) from cron.job where jobname='qf-expirar-pedidos-abertos';
select cron.schedule('qf-expirar-pedidos-abertos','15 minutes','select private.qf_expirar_pedidos_abertos();');
