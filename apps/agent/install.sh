#!/bin/bash
# NexaOps Agent — instalador Linux (pacote + systemd)
set -euo pipefail

TOKEN=""
API_URL="http://localhost:3001"
INSTALL_DIR="/opt/nexaops-agent"
AUTH_HEADER=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    --api) API_URL="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    *) echo "Uso: $0 --token TOKEN [--api URL] [--dir DIR]"; exit 1 ;;
  esac
done

if [[ -z "$TOKEN" ]]; then
  echo "TOKEN obrigatório (--token)"
  exit 1
fi

AUTH_HEADER=(-H "Authorization: Bearer $TOKEN")

echo "=== NexaOps Agent (Linux) ==="
echo "API: $API_URL"
echo "Install: $INSTALL_DIR"

mkdir -p "$INSTALL_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Preferir fontes locais do repo; senão baixar pacote versionado da API
if [[ -f "$SCRIPT_DIR/index.js" ]]; then
  cp -R "$SCRIPT_DIR"/. "$INSTALL_DIR/"
elif command -v curl >/dev/null 2>&1; then
  TMP="$(mktemp -d)"
  echo "Baixando pacote do agent..."
  if curl -fsSL "${AUTH_HEADER[@]}" -o "$TMP/agent.tgz" "$API_URL/api/agent/download/linux"; then
    tar -xzf "$TMP/agent.tgz" -C "$INSTALL_DIR"
  else
    echo "Aviso: download do pacote falhou — registrando sem binário local"
  fi
  rm -rf "$TMP"
fi

HOSTNAME_VAL="$(hostname)"
curl -fsS -X POST "$API_URL/api/agent/register" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\",\"hostname\":\"$HOSTNAME_VAL\",\"osType\":\"LINUX\",\"osVersion\":\"$(uname -r)\"}" \
  | tee /tmp/nexaops-register.json

UNIT=/etc/systemd/system/nexaops-agent.service
if [[ -w /etc/systemd/system ]] || [[ $(id -u) -eq 0 ]]; then
  cat > "$UNIT" <<EOF
[Unit]
Description=NexaOps Agent
After=network.target

[Service]
Type=simple
Environment=NEXAOPS_INSTALL_DIR=$INSTALL_DIR
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/index.js --token=$TOKEN --api=$API_URL
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now nexaops-agent || true
  echo "Serviço systemd nexaops-agent habilitado."
else
  echo ""
  echo "Sem root: rode como root para instalar systemd, ou:"
  echo "  cd $INSTALL_DIR && node index.js --token=$TOKEN --api=$API_URL"
fi

echo "Registro concluído."
