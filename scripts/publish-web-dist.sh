#!/usr/bin/env bash
# Publica o front pré-compilado (deploy/web) sem precisar de vite/tsc na VPS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/deploy/web"
DEST="$ROOT/apps/web/dist"

if [[ ! -f "$SRC/index.html" ]]; then
  echo "ERRO: $SRC/index.html nao encontrado. Rode git pull."
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -a "$SRC"/. "$DEST"/
echo "OK: front publicado em $DEST"
ls -la "$DEST/index.html" "$DEST/assets"/DevicesPage*.js 2>/dev/null || true
