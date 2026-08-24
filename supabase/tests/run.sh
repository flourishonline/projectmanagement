#!/usr/bin/env bash
# Rebuilds a scratch database, applies every migration in order, then runs the
# assertions in rls_test.sql. Requires a reachable Postgres superuser.
#
#   PGHOST=/tmp/pgsock PGPORT=5433 PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail

DB="${TEST_DB:-flourish_ops_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists ${DB};"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database ${DB};"

psql -v ON_ERROR_STOP=1 -q -d "${DB}" -f "${ROOT}/supabase/tests/_shim.sql"
for f in "${ROOT}"/supabase/migrations/*.sql; do
  echo "  applying $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -q -d "${DB}" -f "$f"
done

psql -v ON_ERROR_STOP=1 -d "${DB}" -f "${ROOT}/supabase/tests/rls_test.sql"
