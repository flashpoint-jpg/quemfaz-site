-- Plano Livre: disponibilizar contato ao próprio profissional após o desbloqueio.
-- Reaproveita a função já existente, sem abrir acesso a pedidos não desbloqueados.
-- Mudança segura e idempotente para ambientes já atualizados.
do $qf$
declare
 definition text;
 original text := 'paid.origem<>''comissao13''';
 approved text := 'paid.origem in (''saldo'', ''plano'', ''cortesia_admin'', ''comissao13'')';
 old_count integer;
 new_count integer;
begin
 definition := pg_get_functiondef('private.qf_prof_chamados_desbloqueados()'::regprocedure);
 old_count := (length(definition)-length(replace(definition, original,'')))/length(original);
 new_count := (length(definition)-length(replace(definition, approved,'')))/length(approved);
 if old_count = 2 and new_count = 0 then
   execute replace(definition,original,approved);
 elsif old_count = 0 and new_count = 2 then
   null; -- Já aplicada no banco de produção.
 else
   raise exception 'Versão da função inesperada; conferir alteração de acesso antes de prosseguir.';
 end if;
end $qf$;

-- O predicado de acesso continua exigindo o desbloqueio autenticado e ativo.
