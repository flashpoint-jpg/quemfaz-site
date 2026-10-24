-- Confirmação pelo proprietário do pedido, independente da prestação do profissional.
-- Não altera valores, prazos, cobrança ou aprovação administrativa.
create or replace function public.qf13_acompanhar(p_chamado_id uuid,p_segredo text,p_acao text default 'ver',p_fechamento uuid default null,p_contratou boolean default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k private.qf13_codigos_pedido; f public.qf_comissao13_fechamentos; c public.qf_chamados; v_resposta text;
begin
 if p_segredo is null or p_segredo!~'^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 select * into k from private.qf13_codigos_pedido where chamado_id=p_chamado_id and proprietario_hash=encode(extensions.digest(p_segredo,'sha256'),'hex');
 if not found then return jsonb_build_object('ok',false,'reason','acesso_invalido');end if;
 if p_acao='responder' then
  if p_contratou is null then return jsonb_build_object('ok',false,'reason','resposta_obrigatoria');end if;
  select * into f from public.qf_comissao13_fechamentos where id=p_fechamento and chamado_id=p_chamado_id for update;
  if not found or f.status not in ('pendente','negociando','informado','recusado','confirmado','contestado') then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
  -- Após decisão administrativa, uma resposta divergente permanece possível e vai para revisão.
  v_resposta:=case when p_contratou then case when f.status in ('recusado','contestado') then 'divergencia' else 'confirmado' end else 'nao_contratou' end;
  if f.cliente_resposta is distinct from v_resposta then
   update public.qf_comissao13_fechamentos set cliente_resposta=v_resposta,cliente_respondeu_em=now() where id=f.id;
  end if;
  return jsonb_build_object('ok',true,'resposta',v_resposta,'requer_analise_admin',true,'comissao_devida',false);
 elsif p_acao<>'ver' then return jsonb_build_object('ok',false,'reason','acao_invalida');end if;
 select * into c from public.qf_chamados where id=p_chamado_id;
 return jsonb_build_object('ok',true,'confirmacao_em_um_toque',true,'pedido',jsonb_build_object('id',c.id,'titulo',c.titulo,'cidade',c.cidade,'bairro',c.bairro,'status',c.status,'criado_em',c.criado_em),
 'codigo',k.codigo_cliente,'profissionais',coalesce((select jsonb_agg(jsonb_build_object('id',f0.id,'profissional',p.nome,'plano_livre_ativo',private.qf_livre_identificacao(f0.profissional_id),'status',f0.status,'valor_centavos',coalesce(f0.valor_confirmado_centavos,f0.valor_informado_centavos),'cliente_resposta',f0.cliente_resposta,'cliente_respondeu_em',f0.cliente_respondeu_em) order by f0.informado_em desc) from public.qf_comissao13_fechamentos f0 join public.qf_profiles p on p.id=f0.profissional_id where f0.chamado_id=c.id),'[]'::jsonb));
end $$;
revoke all on function public.qf13_acompanhar(uuid,text,text,uuid,boolean) from public;
grant execute on function public.qf13_acompanhar(uuid,text,text,uuid,boolean) to anon,authenticated;

-- O código continua válido como alternativa, mas não impede informar o fechamento.
create or replace function public.qf_comissao13_prestar_contas(p_id uuid,p_situacao text,p_valor_centavos bigint default null,p_codigo text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.qf_comissao13_fechamentos; h text; v_codigo text:=nullif(btrim(p_codigo),''); v_validado boolean:=false;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 select * into f from public.qf_comissao13_fechamentos where id=p_id and profissional_id=auth.uid() for update;
 if not found then return jsonb_build_object('ok',false,'reason','sem_permissao');end if;
 if f.status not in ('pendente','negociando') then return jsonb_build_object('ok',false,'reason','ja_prestado');end if;
 if p_situacao is null or p_situacao not in ('informado','negociando','recusado') then return jsonb_build_object('ok',false,'reason','situacao_invalida');end if;
 if p_situacao='negociando' and f.prorrogacoes_negociacao>=1 then return jsonb_build_object('ok',false,'reason','limite_prorrogacao');end if;
 if p_situacao='informado' then
  if p_valor_centavos is null or p_valor_centavos not between 100 and 100000000 then return jsonb_build_object('ok',false,'reason','valor_invalido');end if;
  if v_codigo is not null then
   if f.codigo_tentativas>=5 and f.codigo_tentativa_em>now()-interval '1 hour' then return jsonb_build_object('ok',false,'reason','limite_codigo');end if;
   select codigo_hash into h from private.qf13_codigos_pedido where chamado_id=f.chamado_id;
   if v_codigo!~'^[0-9]{6}$' or h is null or h<>encode(extensions.digest(f.chamado_id::text||':'||v_codigo,'sha256'),'hex') then
    update public.qf_comissao13_fechamentos set codigo_tentativas=case when codigo_tentativa_em<now()-interval '1 hour' then 1 else codigo_tentativas+1 end,codigo_tentativa_em=now() where id=p_id;
    return jsonb_build_object('ok',false,'reason',case when h is null then 'codigo_nao_emitido_contate_suporte' else 'codigo_invalido' end);
   end if;
   v_validado:=true;
  end if;
 end if;
 update public.qf_comissao13_fechamentos set status=p_situacao,
 valor_informado_centavos=case when p_situacao='informado' then p_valor_centavos else null end,prestado_em=now(),informado_em=now(),
 prazo_contas=case when p_situacao='negociando' then now()+interval '48 hours' else prazo_contas end,
 prorrogacoes_negociacao=case when p_situacao='negociando' then prorrogacoes_negociacao+1 else prorrogacoes_negociacao end,
 codigo_validado_em=case when v_validado then now() else null end where id=p_id;
 return jsonb_build_object('ok',true,'status',p_situacao,'codigo_validado',v_validado,'comissao_devida',false);
end $$;
revoke all on function public.qf_comissao13_prestar_contas(uuid,text,bigint,text) from public,anon;
grant execute on function public.qf_comissao13_prestar_contas(uuid,text,bigint,text) to authenticated;

-- Aproveita a fila existente. A pergunta já aparece ao liberar o contato, mesmo sem retorno do profissional.
create or replace function private.qf13_notificar_cliente() returns trigger language plpgsql security definer set search_path='' as $$
declare v_cliente uuid;
begin
 if tg_op='UPDATE' then if old.status=new.status or new.status not in ('informado','recusado') then return new;end if;end if;
 if not exists(select 1 from private.qf13_codigos_pedido where chamado_id=new.chamado_id and proprietario_hash is not null) then return new;end if;
 select cliente_id into v_cliente from public.qf_chamados where id=new.chamado_id;
 insert into private.qf_comissao13_notificacoes(user_id,chave,titulo,corpo,rota)
 values(v_cliente,'fechamento13:'||new.id||':'||new.status,'Você contratou este profissional?',
 case when new.status='recusado' then 'O profissional informou que não fechou. Confirme ou corrija com um toque no acompanhamento.' when new.status='informado' then 'O profissional informou o fechamento. Abra seu pedido e confirme se contratou.' else 'Já combinou o serviço? Confirme com um toque no acompanhamento do pedido.' end,
 '/acompanhar-pedido.html#pedido='||new.chamado_id) on conflict(user_id,chave) do nothing;
 return new;
end $$;
revoke all on function private.qf13_notificar_cliente() from public,anon,authenticated;
