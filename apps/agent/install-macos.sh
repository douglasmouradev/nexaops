#!/bin/bash
# NexaOps Agent — instalador macOS (pacote + LaunchAgent)
set -euo pipefail

TOKEN=""
API_URL="http://localhost:3001"
INSTALL_DIR="/usr/local/nexaops-agent"

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

echo "=== NexaOps Agent (macOS) ==="
HOSTNAME_VAL="$(hostname -s 2>/dev/null || hostname)"
mkdir -p "$INSTALL_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$SCRIPT_DIR/index.js" ]]; then
  cp -R "$SCRIPT_DIR"/. "$INSTALL_DIR/"
else
  TMP="$(mktemp -d)"
  echo "Baixando pacote do agent..."
  if curl -fsSL -H "Authorization: Bearer $TOKEN" -o "$TMP/agent.tgz" "$API_URL/api/agent/download/macos"; then
    tar -xzf "$TMP/agent.tgz" -C "$INSTALL_DIR"
  fi
  rm -rf "$TMP"
fi

curl -fsS -X POST "$API_URL/api/agent/register" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\",\"hostname\":\"$HOSTNAME_VAL\",\"osType\":\"MACOS\",\"osVersion\":\"$(sw_vers -productVersion 2>/dev/null || uname -r)\"}"

PLIST_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$PLIST_DIR"
PLIST="$PLIST_DIR/com.nexaops.agent.plist"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.nexaops.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>$INSTALL_DIR/index.js</string>
    <string>--token=$TOKEN</string>
    <string>--api=$API_URL</string>
  </array>
  <key>WorkingDirectory</key><string>$INSTALL_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NEXAOPS_INSTALL_DIR</key><string>$INSTALL_DIR</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST" 2>/dev/null || true
echo "LaunchAgent instalado: $PLIST"
echo "Registro OK."
