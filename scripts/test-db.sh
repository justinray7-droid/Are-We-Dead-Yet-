#!/usr/bin/env bash
# Runs the migration, seed and database rule tests against a throwaway database.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="wager_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
run() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }
run supabase/tests/supabase_shim.sql
run supabase/migrations/0001_init.sql
run supabase/seed.sql
run supabase/tests/policies_test.sql
