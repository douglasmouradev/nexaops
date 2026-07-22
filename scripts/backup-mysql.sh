#!/usr/bin/env bash
# Backup MySQL NexaOps (Linux/macOS / cron)
# Cron exemplo (02:00 diário):
#   0 2 * * * /opt/nexaops/scripts/backup-mysql.sh >> /var/log/nexaops-backup.log 2>&1

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${BACKUP_DIR:-$ROOT/backups}"
mkdir -p "$OUT_DIR"
STAMP=$(date +%Y-%m-%d_%H%M%S)
OUT="$OUT_DIR/nexaops-$STAMP.sql.gz"

if [[ -n "${DATABASE_URL:-}" ]]; then
  # mysql://user:pass@host:port/db
  proto="$(echo "$DATABASE_URL" | sed -E 's#mysql://([^:]+):([^@]+)@([^:/]+)(:([0-9]+))?/([^?]+).*#\1 \2 \3 \5 \6#')"
  read -r USER PASS HOST PORT DB <<< "$proto"
  PORT="${PORT:-3306}"
else
  USER="${MYSQL_USER:-nexaops}"
  PASS="${MYSQL_PASSWORD:-nexaops}"
  HOST="${MYSQL_HOST:-127.0.0.1}"
  PORT="${MYSQL_PORT:-3306}"
  DB="${MYSQL_DATABASE:-nexaops}"
fi

echo "Backup -> $OUT"
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q '^nexaops-mysql$'; then
  docker exec nexaops-mysql mysqldump -u"$USER" -p"$PASS" --single-transaction --routines --triggers "$DB" | gzip > "$OUT"
else
  MYSQL_PWD="$PASS" mysqldump -h"$HOST" -P"$PORT" -u"$USER" --single-transaction --routines --triggers "$DB" | gzip > "$OUT"
fi

SIZE=$(du -h "$OUT" | cut -f1)
echo "OK: $OUT ($SIZE)"

# Retenção 14 dias
ls -1t "$OUT_DIR"/nexaops-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
