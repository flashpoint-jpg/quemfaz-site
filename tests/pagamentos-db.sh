#!/bin/bash
# Recargas, planos e contabilidade em um Postgres isolado (nunca usa dados reais).
# Uso: PGHOST=... PGPORT=... bash tests/pagamentos-db.sh   (padrão: socket /var/lib/postgresql/qf-test, porta 54329)
set -e
H=${PGHOST:-/var/lib/postgresql/qf-test}; PORT=${PGPORT:-54329}; DB=qf_pagamentos_$$
P="psql -h $H -p $PORT -U postgres -v ON_ERROR_STOP=1 -qAt"
M=supabase/migrations/20261018190000_pagamentos_auditoria_contabilidade.sql
$P -d postgres -c "create database $DB"
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null 2>&1' EXIT
$P -d $DB -f tests/fixtures/pagamentos-schema.sql
$P -d $DB -f tests/pagamentos-db-antes.sql
$P -d $DB -c "create schema if not exists cron; create function cron.schedule(text,text,text) returns integer language sql as 'select 1'; create extension if not exists pg_cron" >/dev/null 2>&1 || true
$P -d $DB -f $M
$P -d $DB -f $M   # segunda vez: a migration é repetível
$P -d $DB -f tests/pagamentos-db.sql
# Concorrência real: 6 sessões aprovam a MESMA recarga e 6 sessões reconciliam o MESMO pagamento ao mesmo tempo.
$P -d $DB -c "insert into public.qf_profissionais values (public.t_uid(21)), (public.t_uid(22)) on conflict do nothing;
  insert into public.qf_recargas(id, profissional_id, valor_centavos, metodo, status) values ('00000000-0000-4000-8000-0000000000aa', public.t_uid(21), 3000, 'pix', 'pendente');
  insert into public.qf_recargas(id, profissional_id, valor_centavos, metodo, status) values ('00000000-0000-4000-8000-0000000000ab', public.t_uid(22), 4000, 'pix', 'pendente');"
for k in 1 2 3 4 5 6; do $P -d $DB -c "update public.qf_recargas set status='aprovado' where id='00000000-0000-4000-8000-0000000000aa'" >/dev/null & done; wait
# pagamento aprovado sem benefício (trigger desligado só aqui) e reconciliações simultâneas
$P -d $DB -c "alter table public.qf_recargas disable trigger qf_recarga_pagamento_aplicado; update public.qf_recargas set status='aprovado' where id='00000000-0000-4000-8000-0000000000ab'; alter table public.qf_recargas enable trigger qf_recarga_pagamento_aplicado;"
for k in 1 2 3 4 5 6; do $P -d $DB -c "select private.qf_reconciliar_recargas_job()" >/dev/null & done; wait
A=$($P -d $DB -c "select public.t_saldo(21)"); B=$($P -d $DB -c "select public.t_saldo(22)")
NA=$($P -d $DB -c "select count(*) from public.qf_movimentacoes_carteira where referencia_id='00000000-0000-4000-8000-0000000000aa' and tipo='credito'")
NB=$($P -d $DB -c "select count(*) from public.qf_movimentacoes_carteira where referencia_id='00000000-0000-4000-8000-0000000000ab' and tipo='credito'")
echo "aprovacoes simultaneas: saldo=$A lancamentos=$NA | reconciliacoes simultaneas: saldo=$B lancamentos=$NB"
[ "$A" = 3000 ] && [ "$NA" = 1 ] && [ "$B" = 4000 ] && [ "$NB" = 1 ] && echo "PAGAMENTOS-DB: OK" || { echo "PAGAMENTOS-DB: FALHOU"; exit 1; }
