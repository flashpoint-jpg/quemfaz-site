-- QuemFaz V11.28.1 — quando um profissional informa "Fechei o serviço", os outros que desbloquearam
-- o mesmo pedido e ainda não tinham respondido recebem um aviso no app.
-- Só acrescenta um trecho à função do gatilho; o resto fica igual.
do $mig$
declare def text; novo text;
begin
  def := pg_get_functiondef('private.qf_registrar_chamados_perdidos()'::regprocedure);
  if position('pedido_fechado_outro' in def) = 0 then
    novo := replace(def, '  -- Cancelamento/expiração antes de qualquer negociação mantém o aviso antigo.', $n$  -- Um profissional informou que fechou o serviço: avisa os outros que desbloquearam e ainda estavam em conversa.
  if new.status = 'concluido' and old.status = 'em_negociacao' and new.desfecho = 'fechado' then
    insert into public.qf_profissional_avisos
      (user_id,chamado_id,tipo,titulo,corpo,rota)
    select distinct
      d.profissional_id,
      new.id,
      'pedido_fechado_outro',
      'Pedido fechado com outro profissional',
      coalesce(new.titulo,'Serviço') ||
        case when nullif(trim(coalesce(new.cidade,'')),'') is not null then ' · ' || new.cidade else '' end ||
        ' · O cliente fechou este serviço com outro profissional. Continue de olho nos pedidos perto de você.',
      '/profissional/pedido/' || new.id::text
    from public.qf_desbloqueios d
    where d.chamado_id=new.id
      and coalesce(d.ativo,true)
      and d.desfecho is null
    on conflict (user_id,chamado_id,tipo) do nothing;

    return new;
  end if;

  -- Cancelamento/expiração antes de qualquer negociação mantém o aviso antigo.$n$);
    if novo = def then raise exception 'qf_registrar_chamados_perdidos: ponto de inserção não encontrado'; end if;
    execute novo;
  end if;
end
$mig$;
