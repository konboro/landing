#!/usr/bin/env bash
# Penny Platform — build a full local Postgres database from the migrations.
#
# Gives you a working DB (schema + RLS + views + seed) without Supabase, so the
# apps and the gateway can be pointed at something real immediately.
#
#   ./scripts/db-local.sh                 # (re)create the penny_dev database
#   ./scripts/db-local.sh penny_test      # custom database name
#
# Requires: a running Postgres 15/16 with PostGIS available locally.

set -euo pipefail

DB_NAME="${1:-penny_dev}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"

# Prefer running as the postgres superuser (needed for CREATE EXTENSION postgis).
if command -v sudo >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
  PSQL=(sudo -u postgres psql)
else
  PSQL=(psql)
fi

echo "▶ Recreating database '$DB_NAME'"
"${PSQL[@]}" -q -c "DROP DATABASE IF EXISTS $DB_NAME;" -c "CREATE DATABASE $DB_NAME;"

echo "▶ Applying migrations from supabase/migrations"
shopt -s nullglob
count=0
for f in "$MIGRATIONS"/*.sql; do
  name="$(basename "$f")"
  if "${PSQL[@]}" -v ON_ERROR_STOP=1 -q -d "$DB_NAME" -f "$f" >/tmp/penny-migrate.log 2>&1; then
    echo "  ✓ $name"
    count=$((count + 1))
  else
    echo "  ✗ $name"
    tail -20 /tmp/penny-migrate.log
    exit 1
  fi
done

echo "▶ Applied $count migrations"

echo "▶ Sanity check"
"${PSQL[@]}" -d "$DB_NAME" -tA <<'SQL'
select 'tables:      ' || count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';
select 'views:       ' || count(*) from information_schema.views where table_schema='public';
select 'rls enabled: ' || count(*) from pg_tables t join pg_class c on c.relname=t.tablename
  where t.schemaname='public' and c.relrowsecurity;
select 'vehicles:    ' || count(*) from vehicles;
select 'ledger nets: ' || coalesce(sum(delta_cents),0) || ' (must be 0)' from ledger_entries;
SQL

echo
echo "✅ Local database ready: $DB_NAME"
echo "   psql:   sudo -u postgres psql -d $DB_NAME"
echo "   DB_URL: postgres://postgres:postgres@localhost:5432/$DB_NAME  (gateway)"
