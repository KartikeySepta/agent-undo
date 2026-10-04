#!/bin/sh
# Admin tasks against the PRODUCTION orders database (see .env.production).
#   ./scripts/prod-db.sh reset [--seed]   drop all tables, re-run schema, optionally load seed data
#   ./scripts/prod-db.sh status
set -e
cd "$(dirname "$0")/.."
exec node scripts/db-client.js "$@"
