#!/bin/bash
# Deploy remoto nativo na VPS (rodar como root no servidor)
set -euo pipefail
ROOT=/www/wwwroot/nexaops.tdesksolutions.com.br
cd "$ROOT"

git pull origin main

ENV_FILE="$ROOT/.env"
touch "$ENV_FILE"

set_kv() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

set_kv REMOTE_PROVIDER native
set_kv WEB_URL https://nexaops.tdesksolutions.com.br

# Remover exigencia antiga de RDP se existir (native nao precisa)
# ALLOW_RDP_REMOTE pode ficar

npm ci --omit=dev 2>/dev/null || npm install
npm run build -w @nexaops/api
npm run build -w @nexaops/web

pm2 restart nexaops-api || pm2 restart all
pm2 save

echo "OK: REMOTE_PROVIDER=native, WEB_URL set, API/web rebuilt"
