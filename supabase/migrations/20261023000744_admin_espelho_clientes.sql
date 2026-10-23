create or replace function public.qf_admin_espelho_clientes(p_pagina integer default 0,p_busca text default '',p_status text default '',p_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare itens jsonb; pedido jsonb; total bigint; canal text; tela jsonb;
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin authentication required' using errcode='42501';end if;
 if p_id is not null then
  select to_jsonb(c)||jsonb_build_object('cliente',jsonb_build_object('nome',p.nome,'telefone',p.telefone,'whatsapp',p.whatsapp)) into pedido from public.qf_chamados c join public.qf_profiles p on p.id=c.cliente_id where c.id=p_id;
  -- Consulta de leitura já usada pelo cliente, sem transmitir sessão ou autorizar ações.
  if pedido is not null then
   canal:=current_setting('request.jwt.claim.sub',true);
   perform set_config('request.jwt.claim.sub',pedido->>'cliente_id',true);
   select to_jsonb(x) into tela from public.qf_cliente_chamados() x where x.id=p_id;
   perform set_config('request.jwt.claim.sub',coalesce(canal,''),true);
   pedido:=pedido||coalesce(tela,'{}'::jsonb);
  end if;
  return jsonb_build_object('pedido',pedido,'respostas',(select a.respostas-'chave' from private.qf_atendimentos a where a.chamado_id=p_id),'desbloqueios',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('profissional',jsonb_build_object('nome',p.nome,'telefone',p.telefone,'whatsapp',p.whatsapp,'foto_url',p.foto_url)) order by d.criado_em) from public.qf_desbloqueios d join public.qf_profiles p on p.id=d.profissional_id where d.chamado_id=p_id),'[]'::jsonb),'orcamentos',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('profissional_nome',p.nome,'profissional_telefone',p.telefone,'profissional_foto_url',p.foto_url) order by o.criado_em desc) from public.qf_orcamentos o join public.qf_profiles p on p.id=o.profissional_id where o.chamado_id=p_id),'[]'::jsonb),'avaliacoes',coalesce((select jsonb_agg(to_jsonb(a)) from public.qf_avaliacoes a where a.chamado_id=p_id),'[]'::jsonb));
 end if;
 select count(*) into total from public.qf_chamados c join public.qf_profiles p on p.id=c.cliente_id where (coalesce(p_status,'')='' or c.status=p_status) and (coalesce(p_busca,'')='' or concat_ws(' ',c.id::text,c.titulo,c.descricao,c.cidade,p.nome) ilike '%'||left(p_busca,200)||'%');
 select coalesce(jsonb_agg(x order by x.criado_em desc,x.id desc),'[]'::jsonb) into itens from (select c.id,c.titulo,c.categoria,c.descricao,c.status,c.cidade,c.uf,c.criado_em,jsonb_build_object('nome',p.nome) cliente from public.qf_chamados c join public.qf_profiles p on p.id=c.cliente_id where (coalesce(p_status,'')='' or c.status=p_status) and (coalesce(p_busca,'')='' or concat_ws(' ',c.id::text,c.titulo,c.descricao,c.cidade,p.nome) ilike '%'||left(p_busca,200)||'%') order by c.criado_em desc,c.id desc limit 50 offset least(greatest(coalesce(p_pagina,0),0),100000)*50) x;
 return jsonb_build_object('itens',itens,'total',total,'gerado_em',now());
end $$;
revoke all on function public.qf_admin_espelho_clientes(integer,text,text,uuid) from public,anon;
grant execute on function public.qf_admin_espelho_clientes(integer,text,text,uuid) to authenticated;
