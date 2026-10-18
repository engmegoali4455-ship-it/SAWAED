#!/usr/bin/env bash
# يشغّل Postgres 16 مؤقتاً، يطبّق المهاجرات والبذور، ثم يشغّل الاختبارات.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DATA="$(mktemp -d)"
PORT="${PORT:-54329}"
RUN_AS=()
if [ "$(id -u)" = 0 ]; then chown postgres "$DATA"; RUN_AS=(runuser -u postgres --); fi
cleanup() { "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
"${RUN_AS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=''" -w start >/dev/null

PSQL=(psql -h /tmp -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -o /dev/null)
"${PSQL[@]}" -f "$HERE/shim_supabase.sql"
for f in "$ROOT"/migrations/*.sql; do echo "▸ $(basename "$f")"; "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f "$ROOT/seed.sql"
for t in "$HERE"/[0-9]*.sql; do echo "▸ $(basename "$t")"; "${PSQL[@]}" -f "$t"; done
echo "✔ all database tests passed"
