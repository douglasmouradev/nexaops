#!/usr/bin/env bash
# Atualização rápida em VPS (PM2 + nginx). Rode na raiz do monorepo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> git pull"
git pull origin main

echo "==> npm ci"
npm ci

echo "==> build shared"
npm run build -w @nexaops/shared

echo "==> prisma generate"
(cd apps/api && npx prisma generate)

echo "==> build api"
npm run build -w @nexaops/api

echo "==> build web"
unset VITE_API_URL || true
npm run build -w @nexaops/web

echo "==> pm2 restart"
pm2 restart nexaops-api
pm2 save

echo "OK. Ctrl+F5 no painel."
