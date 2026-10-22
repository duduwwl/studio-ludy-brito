#!/usr/bin/env bash
# Recria o banco de teste local e aplica shim + migrations.
set -euo pipefail
PSQL="psql -h /tmp -p ${PGPORT:-54329} -U postgres -v ON_ERROR_STOP=1 -q"
DB=${TEST_DB:-ludy_test}
$PSQL -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
$PSQL -d $DB -f "$(dirname "$0")/supabase_shim.sql"
for f in "$(dirname "$0")"/../../supabase/migrations/*.sql; do
  $PSQL -d $DB -f "$f"
done
echo "banco $DB pronto"
