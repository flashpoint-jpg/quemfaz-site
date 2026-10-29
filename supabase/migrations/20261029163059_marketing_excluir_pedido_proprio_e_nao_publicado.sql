create or replace function private.qf_md_atribuir() returns trigger language plpgsql security definer set search_path='' as $$
declare c private.qf_md_campanhas;
begin
 if new.status not in ('aberto','em_negociacao') then return new;end if;
 -- Serializa somente a seleção/registro de ofertas; dois pedidos simultâneos não escolhem a mesma vez.
 perform 1 from private.qf_md_config where id for update;
 select m.* into c from private.qf_md_campanhas m
 join public.qf_profissionais pr on pr.user_id=m.profissional_id
 join public.qf_profiles u on u.id=pr.user_id
 where m.status='ativa' and m.pagamento_status='conciliado' and m.inicio_em<=now() and m.fim_em>now()
 and private.qf_md_livre_pago(m.profissional_id)
 and pr.user_id is distinct from new.cliente_id and coalesce(u.ativo,true) and pr.online and not coalesce(pr.offline_manual,false)
 and private.qf_dentro_horario(pr.horario_inicio,pr.horario_fim)
 and private.qf_pro_recebe_chamado(m.profissional_id,new.id)
 order by m.ultima_oferta_em nulls first,m.id limit 1 for update of m;
 if not found then return new;end if;
 insert into private.qf_md_leads(chamado_id,campanha_id,profissional_id,elegivel,origem,prioridade_ate)
 values(new.id,c.id,c.profissional_id,true,jsonb_build_object('distribuicao','marketing_pago','origem_publicacao',coalesce(new.marketing_origem,'{}')),
 now()+make_interval(mins=>case when new.urgencia='urgente' then c.urgente_min else c.janela_min end));
 update private.qf_md_campanhas set ultima_oferta_em=clock_timestamp() where id=c.id;
 return new;
end $$;