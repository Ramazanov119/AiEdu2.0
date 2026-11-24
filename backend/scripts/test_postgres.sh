#!/usr/bin/env bash
# Creates and destroys only its own disposable local cluster. Never uses DATABASE_URL.
set -euo pipefail
project_root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
: "${PG_BIN:?Set PG_BIN to the directory containing initdb/pg_ctl/createdb}"
base=/private/tmp
[[ -d "$base" ]] || base=/tmp
cluster="$(mktemp -d "$base/aiedu-rbac-XXXXXX")"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$cluster/data" stop -m fast >/dev/null 2>&1 || true
  rm -rf -- "$cluster"
}
trap cleanup EXIT
"$PG_BIN/initdb" -D "$cluster/data" -U aiedu_test_owner --auth-local=trust --auth-host=scram-sha-256 --no-instructions >"$cluster/init.log"
printf "\nlisten_addresses = ''\nunix_socket_directories = '%s'\nport = 5548\n" "$cluster" >>"$cluster/data/postgresql.conf"
"$PG_BIN/pg_ctl" -D "$cluster/data" -l "$cluster/server.log" -w start
"$PG_BIN/createdb" -h "$cluster" -p 5548 -U aiedu_test_owner aiedu_rbac_test
cd "$project_root"
AIEDU_TEST_POSTGRES_URL="postgresql+psycopg://aiedu_test_owner@/aiedu_rbac_test?host=$cluster&port=5548" \
PYTHONDONTWRITEBYTECODE=1 "${PYTHON:-$project_root/.venv/bin/python}" -m pytest app/tests -p no:cacheprovider "$@"
