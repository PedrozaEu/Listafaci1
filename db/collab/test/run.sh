#!/usr/bin/env bash
# Throwaway Postgres: 6A, its tests, 6B, import tests.
set -e
D=$(mktemp -d); trap 'pg_ctl -D $D/data stop -m immediate >/dev/null 2>&1; rm -rf $D' EXIT
initdb -D $D/data -U postgres >/dev/null
pg_ctl -D $D/data -o "-k $D -p 55439 -c listen_addresses=''" -l $D/log start -w >/dev/null
P="psql -X -q -h $D -p 55439 -U postgres -v ON_ERROR_STOP=1"
$P -c 'create database t' >/dev/null
cd "$(dirname "$0")"
$P -d t -f 00_supabase_mock.sql >/dev/null
$P -d t -f ../6A_colaboracao.sql >/dev/null
$P -d t -f 10_access_tests.sql 2>&1 | grep -c "ok:" | sed 's/^/6A ok: /'
$P -d t -f ../6B_migracao.sql >/dev/null
$P -d t -f 20_import_tests.sql 2>&1 | grep -E "ok:|FALHOU|ERROR|PASSARAM"
$P -d t -f ../7_operacoes.sql >/dev/null
$P -d t -f 30_ops_tests.sql 2>&1 | grep -E "ok:|FALHOU|ERROR|PASSARAM"
$P -d t -f ../8_convites.sql >/dev/null
$P -d t -f 40_invite_tests.sql 2>&1 | grep -E "ok:|FALHOU|ERROR|PASSARAM"
$P -d t -f ../9_ao_vivo.sql >/dev/null
$P -d t -f 50_live_tests.sql 2>&1 | grep -E "ok:|FALHOU|ERROR|PASSARAM"
$P -d t -f ../10_papeis_por_lista.sql >/dev/null
$P -d t -f 60_roles_tests.sql 2>&1 | grep -E "ok:|FALHOU|ERROR|PASSARAM"
$P -d t -f ../11_vinculo_ativo.sql >/dev/null
$P -d t -f 70_link_tests.sql 2>&1 | grep -E "ok:|FALHOU|ERROR|PASSARAM|error"
$P -d t -f ../12_unidades_simplificadas.sql >/dev/null
$P -d t -f 80_units_tests.sql 2>&1 | grep -E "ok:|FALHOU|ERROR|PASSARAM|error"
