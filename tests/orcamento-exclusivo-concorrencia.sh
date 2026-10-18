#!/bin/bash
# Concorrência real: várias sessões ao mesmo tempo. Uso: PGHOST=... PGPORT=... bash tests/orcamento-exclusivo-concorrencia.sh <db>
# Pré-requisito: banco já preparado por tests/orcamento-exclusivo-db.sql.
DB=${1:-qft}; P="psql -h ${PGHOST:-/var/lib/postgresql/qfs} -p ${PGPORT:-54329} -U postgres -d $DB -v ON_ERROR_STOP=1 -qAt"
$P -c "insert into public.qf_chamados (id, cliente_id, categoria, descricao, max_orcamentos, latitude, longitude) values ('00000000-0000-4000-8000-0000000000f1', public.t_uid(1), 'pintor', 'corrida exclusiva', 4, -23.55, -46.63), ('00000000-0000-4000-8000-0000000000f2', public.t_uid(1), 'pintor', 'corrida mesmo pro', 4, -23.55, -46.63);
        update public.qf_carteiras set saldo_centavos = 100000 where profissional_id in (public.t_uid(11), public.t_uid(12), public.t_uid(13), public.t_uid(14));"
call() { $P -c "select public.t_as($1); select public.qf_desbloquear_chamado('00000000-0000-4000-8000-0000000000$2'::uuid, $3)->>'ok'" | tail -1; }
# 4 profissionais disputam o EXCLUSIVO do mesmo pedido ao mesmo tempo
for n in 11 12 13 14; do call $n f1 true > /tmp/conc_$n.out & done
# o mesmo profissional dispara 4 cliques simultâneos no mesmo pedido
for k in 1 2 3 4; do call 11 f2 false > /tmp/conc_dup_$k.out & done
wait
OK=$(cat /tmp/conc_11.out /tmp/conc_12.out /tmp/conc_13.out /tmp/conc_14.out | grep -c '^true$')
DESB=$($P -c "select count(*) from public.qf_desbloqueios where chamado_id='00000000-0000-4000-8000-0000000000f1' and coalesce(ativo,true)")
DEB=$($P -c "select count(*) from public.qf_movimentacoes_carteira where referencia_id='00000000-0000-4000-8000-0000000000f1' and tipo='debito'")
DUPD=$($P -c "select count(*) from public.qf_movimentacoes_carteira where referencia_id='00000000-0000-4000-8000-0000000000f2' and tipo='debito'")
echo "exclusivos_ok=$OK desbloqueios=$DESB debitos=$DEB debitos_duplicados_mesmo_pro=$DUPD"
[ "$OK" = 1 ] && [ "$DESB" = 1 ] && [ "$DEB" = 1 ] && [ "$DUPD" = 1 ] && echo "CONCORRENCIA: OK" || { echo "CONCORRENCIA: FALHOU"; exit 1; }
