#!/usr/bin/env bash
# Watchdog: monitora GET /health e alerta por e-mail/webhook se a API cair.
# Cron (a cada 2 min):
#   */2 * * * * /opt/nexaops/scripts/health-watchdog.sh
#
# Env:
#   HEALTH_URL=https://api.seudominio.com/health
#   WATCHDOG_WEBHOOK_URL=https://hooks.slack.com/...
#   WATCHDOG_EMAIL=ops@seudominio.com
#   SMTP_* (opcional — se so webhook, nao precisa)

set -euo pipefail
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/health}"
STATE_FILE="${WATCHDOG_STATE_FILE:-/tmp/nexaops-health-state}"
TIMEOUT="${WATCHDOG_TIMEOUT_SEC:-8}"

notify() {
  local msg="$1"
  echo "[watchdog] $msg"
  if [[ -n "${WATCHDOG_WEBHOOK_URL:-}" ]]; then
    curl -sS -X POST -H 'Content-Type: application/json' \
      -d "{\"text\":\"NexaOps watchdog: $msg\"}" \
      "$WATCHDOG_WEBHOOK_URL" >/dev/null || true
  fi
  if [[ -n "${WATCHDOG_EMAIL:-}" && -n "${SMTP_HOST:-}" ]]; then
    # fallback simples via sendmail se existir
    if command -v sendmail >/dev/null 2>&1; then
      printf "Subject: NexaOps health\n\n%s\n" "$msg" | sendmail "$WATCHDOG_EMAIL" || true
    fi
  fi
}

code=0
body=""
if body=$(curl -sS -m "$TIMEOUT" -w "\n%{http_code}" "$HEALTH_URL" 2>/dev/null); then
  code=$(echo "$body" | tail -n1)
  json=$(echo "$body" | sed '$d')
else
  code=0
  json=""
fi

prev="ok"
[[ -f "$STATE_FILE" ]] && prev=$(cat "$STATE_FILE")

if [[ "$code" != "200" ]] || ! echo "$json" | grep -q '"status":"ok"'; then
  echo "down" > "$STATE_FILE"
  if [[ "$prev" != "down" ]]; then
    notify "API DOWN ou degradada (HTTP $code) — $HEALTH_URL"
  fi
  exit 1
fi

echo "ok" > "$STATE_FILE"
if [[ "$prev" == "down" ]]; then
  notify "API recuperou — $HEALTH_URL"
fi
exit 0
