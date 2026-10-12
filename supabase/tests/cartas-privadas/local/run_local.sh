#!/bin/bash
# Ejecuta las pruebas de cartas privadas en un PostgreSQL 16 LOCAL y desechable.
# No se conecta a ningún Supabase. Uso: bash run_local.sh
set -euo pipefail
H=$(cd "$(dirname "$0")" && pwd); R=$(cd "$H/../../../.." && pwd); B=/usr/lib/postgresql/16/bin
T=$(mktemp -d); chmod 755 $T; D=$T/pgdata
cleanup(){ runuser -u postgres -- $B/pg_ctl -D $D -m immediate stop >/dev/null 2>&1 || true; rm -rf $T; }
trap cleanup EXIT
chown postgres $T
runuser -u postgres -- $B/initdb -D $D -A trust -U postgres --no-sync >/dev/null
runuser -u postgres -- $B/pg_ctl -D $D -l $T/log -o "-k '' -c listen_addresses=127.0.0.1 -p 55434" -w start >/dev/null
P="runuser -u postgres -- $B/psql -h 127.0.0.1 -p 55434 -U postgres -X -q -v ON_ERROR_STOP=1 -d postgres"
for f in "$H/00_stub_supabase.sql" "$R/supabase/cartas_privadas.sql" "$R/supabase/cartas_revisores.sql"; do cp "$f" $T/x.sql; chmod 644 $T/x.sql; $P -f $T/x.sql; echo "aplicado: ${f#$R/}"; done
# La prueba de la concesión lee el archivo real a través de una función local.
cp "$R/supabase/cartas_revisores_concesion.sql" $T/conc.sql; chmod 644 $T/conc.sql
$P -c "create function pg_read_file_concesion() returns text language sql as \$\$ select pg_read_file('$T/conc.sql') \$\$;" >/dev/null
# D_revisores.sql sólo corre en meseo-c5-test: en esta base desechable se sustituye su
# identificador por el local EN LA COPIA TEMPORAL (el archivo del repositorio no cambia).
ID=$($P -At -c "select system_identifier from pg_control_system()")
for f in "$R/supabase/tests/cartas-privadas/D_revisores.sql" "$H/30_concesion.sql"; do
  sed "s/'7690937621030482216'/'$ID'/g" "$f" > $T/x.sql; chmod 644 $T/x.sql
  out=$($P -f $T/x.sql 2>&1 || true); echo "${f#$R/}: $(echo "$out" | grep -o 'RESULTADO.*\|ABORTA.*' | head -1)"
  echo "$out" | grep -q 'RESULTADO' || { echo "$out"; exit 1; }
done
