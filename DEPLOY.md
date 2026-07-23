# Deploy NexaOps em produção

Guia rápido para subir API + Web + MySQL + Redis + agente Windows.

## Arquitetura mínima

```
Internet → HTTPS (nginx/Caddy) → web (static) + /api + /socket.io → api:3001
                                      ↓
                              MySQL 8 + Redis ≥ 7
```

## 0. Go-live rápido (o que o repo já automatiza)

```bash
# 1) Preencha .env de produção (secrets fortes, HTTPS, SMTP, Redis)
# 2) Valide
npm run prod:check

# 3) Suba stack de produção (MySQL/Redis sem porta pública)
npm run prod:up
# equivale a: docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# 4) Migrations (nunca db:push em prod)
npm run db:migrate:deploy

# 5) Admin real (NÃO use seed demo)
npm run prod:create-admin -- --email admin@empresa.com --password "SenhaForte!" --org "Minha MSP"

# 6) Health
npm run prod:check -- --health https://api.seudominio.com/health
# ou: curl https://api.seudominio.com/health

# 7) MSI com API pública + assinatura
# API_URL=https://api.seudominio.com npm run build:agent-msi
```

Em `NODE_ENV=production` a API **recusa boot** se faltar `REDIS_REQUIRED`, `SMTP_REQUIRED`, `SMTP_HOST`, `CORS_ORIGIN`, `API_URL` ou se secrets forem placeholders.

## 1. Pré-requisitos

- Node.js 20+
- Docker (recomendado) **ou** MySQL 8 + Redis 7
- Domínio com TLS (Let's Encrypt)
- Certificado Authenticode (opcional, reduz SmartScreen no MSI)

## 2. Variáveis obrigatórias

Copie `.env.example` → `.env` e defina valores **fortes**:

| Variável | Notas |
|----------|--------|
| `DATABASE_URL` | MySQL de produção |
| `REDIS_URL` | Redis ≥ 7 (`redis:7-alpine` no Compose) |
| `REDIS_REQUIRED` | `true` em produção |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | ≥ 32 chars aleatórios |
| `VAULT_ENCRYPTION_KEY` | exatamente 32+ chars |
| `CORS_ORIGIN` | URL pública do front (`https://app.seudominio.com`) |
| `API_URL` | URL pública da API (`https://api.seudominio.com`) |
| `SMTP_*` | Para e-mails (reset, convite, **alertas críticos**) |
| `SMTP_REQUIRED` | `true` em produção |
| `S3_*` | **Obrigatório** em produção (`ALLOW_DB_ATTACHMENTS=true` só como escape) |
| `AUTO_TICKET_ON_CRITICAL` | `true` (default) — CRITICAL vira ticket URGENT |
| `REMOTE_URL_TTL_SEC` | TTL das URLs assinadas Guacamole/Mesh/noVNC |

Opcionais úteis: `REMOTE_PROVIDER` + templates `{token}`/`{expires}`, OAuth Microsoft/Slack, Stripe, `CODE_SIGN_PFX_*`, `SENTRY_DSN`.

## 3. Docker Compose (caminho mais simples)

```bash
cp .env.example .env
# edite secrets no .env — em produção use compose.prod:

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d mysql redis
npm ci
npm run build -w @nexaops/shared
npm run db:migrate:deploy
npm run prod:create-admin -- --email admin@empresa.com --password "SenhaForte!" --org "MSP"

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api web
# atalho: npm run prod:up
```

- Web: bind `127.0.0.1` (proxie 443 na frente)
- API: bind `127.0.0.1:3001`
- Health: `GET /health` → `ready: true`, `database/redis/smtp: ok`

## 4. Reverse proxy (exemplo Caddy)

```caddy
app.seudominio.com {
  reverse_proxy localhost:5173
}

api.seudominio.com {
  reverse_proxy localhost:3001
}
```

Se web e API no mesmo host (nginx do container web), garanta proxy de `/api` e `/socket.io` (já no `apps/web/nginx.conf`).

## 5. Banco de dados

```bash
# Produção — sempre migrations versionadas
npm run db:migrate:deploy

# Nunca use db:push em produção
```

**Backup diário:**

```powershell
# Windows
npm run backup:mysql
# ou: .\scripts\backup-mysql.ps1 -OutDir .\backups

# Linux/macOS
./scripts/backup-mysql.sh
```

Restore (teste periodicamente):

```powershell
.\scripts\restore-mysql.ps1 -DumpFile .\backups\nexaops-YYYYMMDD.sql.gz
```

Guarde dumps fora do servidor da app.

## 6. Health watchdog

Monitora `GET /health` e dispara webhook/e-mail se a API cair:

```powershell
# Windows (agende no Task Scheduler a cada 5 min)
npm run watchdog:health
# ou: .\scripts\health-watchdog.ps1 -WebhookUrl $env:ALERT_WEBHOOK_URL

# Linux/macOS (cron)
./scripts/health-watchdog.sh
```

## 7. Seed e senha admin

- `npm run db:seed` **bloqueia** se `NODE_ENV=production` sem `ALLOW_DEMO_SEED=true`.
- Em produção real, **não** rode o seed demo.
- Reset forçado da senha admin (dev/ops): `npx tsx apps/api/scripts/force-admin-password.ts`

## 8. Agente Windows (MSI)

```bash
# Build com API pública
# (API_URL no .env deve ser a URL que os PCs alcançam)

npm run build:agent-msi

# Assinar (recomendado)
$env:CODE_SIGN_PFX_PATH="C:\certs\code.pfx"
$env:CODE_SIGN_PFX_PASSWORD="***"
.\apps\agent\installer\sign-msi.ps1
```

Instalação no cliente:

```powershell
msiexec /i NexaOpsAgent.msi /qn TOKEN=<agentToken> API_URL=https://api.seudominio.com
```

Token em **Admin → Organização**.

## 9. Portal do cliente

Link autenticado:

`https://app.seudominio.com/portal/<slug>?token=<portalToken>`

Regenere tokens se vazarem (botão na página Organização).

Webhook de alertas (Slack/Teams): **Admin → Organização**.

## 10. Checklist pré-go-live

```bash
npm run prod:check
npm run prod:check -- --health https://api.seudominio.com/health
```

- [ ] `npm run prod:check` sem erros
- [ ] Secrets trocados (nada do `.env.example`)
- [ ] `REDIS_REQUIRED=true` e Redis 7
- [ ] `SMTP_REQUIRED=true` + SMTP validado
- [ ] HTTPS no front e na API
- [ ] `/health` com `ready: true` + watchdog agendado
- [ ] Admin criado via `prod:create-admin` (não seed demo)
- [ ] 2FA obrigatório na org
- [ ] Um device com MSI registrado (heartbeat)
- [ ] Alerta gera e-mail/webhook
- [ ] Backup MySQL agendado
- [ ] MSI assinado (Authenticode)
- [ ] S3/MinIO **obrigatório** em produção (`ALLOW_DB_ATTACHMENTS=true` só como escape)
- [ ] Remoto nativo (`REMOTE_PROVIDER=native` + agent atualizado) **ou** Guacamole/Mesh/noVNC

### Remoto nativo (padrão recomendado — funciona atrás de NAT)

```bash
REMOTE_PROVIDER=native
WEB_URL=https://nexaops.tdesksolutions.com.br
# CORS_ORIGIN / APP_URL tambem servem como fallback para WEB_URL
```

O painel abre o viewer in-app (`/remote-sessions?session=…`). O agent em Session 0 sobe `windows/remote-helper.js` na sessão do usuário logado (captura + input). Requer usuário logado no Windows.

### Remoto Guacamole / Mesh / noVNC (opcional)

```bash
REMOTE_PROVIDER=guacamole
GUACAMOLE_URL=https://guac.seudominio.com
REMOTE_URL_TTL_SEC=3600
REMOTE_URL_SIGNING_SECRET=segredo-longo-diferente-do-jwt
# Templates opcionais: {base} {node} {sessionId} {token} {expires} {hostname}
```

O viewer abre iframe quando a URL permite embed. Configure o Guacamole/Mesh para permitir frame da origem do NexaOps (`X-Frame-Options` / CSP). Exige o PC alcançável pelo gateway (VPN/LAN) — não atravessa NAT sozinho.

### Authenticode (assinatura MSI)

SmartScreen some de verdade só com certificado de code signing (OV/EV) de uma CA (DigiCert, Sectigo, etc.). Configure `CODE_SIGN_PFX_PATH` + `CODE_SIGN_PFX_PASSWORD` e rode `npm run build:agent-msi` (ou `sign-msi.ps1`). Sem certificado, o MSI funciona mas o Windows pode avisar.

## 11b. Atualizar VPS (git + PM2, sem Docker)

### Front rápido (botão Excluir sem build na VPS)

O repositório inclui `deploy/web/` com o front já compilado:

```bash
cd /www/wwwroot/nexaops.tdesksolutions.com.br
git pull origin main
bash scripts/publish-web-dist.sh
# se o nginx aponta para outro path, copie tambem:
# cp -a deploy/web/. /caminho/do/nginx/html/
```

Depois **Ctrl+F5** no navegador. Deve aparecer a coluna **Excluir** e o botão vermelho ao selecionar.

### Build completo (API + web)

```bash
cd /www/wwwroot/nexaops.tdesksolutions.com.br
git pull origin main
npm ci
npm run build -w @nexaops/shared
cd apps/api && npx prisma generate && cd ../..
npm run build -w @nexaops/api
unset VITE_API_URL
npm run build -w @nexaops/web
# ou use o prebuild: bash scripts/publish-web-dist.sh
pm2 restart nexaops-api
pm2 save
```

Se o build da API falhar, veja o erro completo: `npm run build -w @nexaops/api`.  
Se o web falhar em `vitest`, use `bash scripts/publish-web-dist.sh`.

Confirme o front novo: `ls -la apps/web/dist/assets/DevicesPage*.js` (deve ser `DevicesPage-BL-wvkmx.js` ou mais recente) e Ctrl+F5 no browser.


## 11. Operação pós-deploy

| Item | Ação |
|------|------|
| Logs API | stdout do container / PM2 |
| Erros | `SENTRY_DSN` + `@sentry/node` (já no package da API) |
| Filas | BullMQ no Redis; sem Redis → fallback heartbeat |
| SLA tickets | job a cada 5 min marca breach + e-mail |
| Backup MySQL | `npm run backup:mysql` (Windows) ou `bash scripts/backup-mysql.sh` (Linux) — cron diário |
| Watchdog | `npm run watchdog:health` ou `bash scripts/health-watchdog.sh` — alerta se `/health` cair |
| Atualizar | `git pull` → `npm ci` → `migrate deploy` → rebuild images |
| Rollback DB | `restore-mysql.ps1`; migrations são forward-only |

Cron Linux (exemplo):

```cron
0 2 * * * cd /opt/nexaops && bash scripts/backup-mysql.sh
*/5 * * * * cd /opt/nexaops && bash scripts/health-watchdog.sh
```

## 12. Segurança rápida

- Não exponha MySQL/Redis na internet
- Rate limit já ativo (login mais restrito; canal do agent limitado)
- Rotas `/api/agent/*` (exceto register/download) exigem `Authorization: Bearer <agentToken>` + `X-Agent-Id`
- Downloads do agent: Bearer; em production query `?token=` só com `AGENT_ALLOW_QUERY_TOKEN=true`
- CORS: localhost só em non-production (ou `ALLOW_LOCALHOST_CORS=true`)
- Boot em production rejeita secrets `change-me-*` e exige S3 (+ URLs remotas se provider externo)
- Tokens OAuth gravados cifrados; GET `/api/integrations` não devolve secrets
- Sessão remota: CONNECTED só após ack do agent (timeout → DISCONNECTED)
- URLs remotas assinadas com `REMOTE_URL_SIGNING_SECRET` ou `JWT_SECRET` (sem segredo hardcoded)
- Vault: AES-GCM com chave derivada via scrypt (`v1:…`); blobs legados ainda descriptografam
- Portal: preferir `X-Portal-Token`; em production query `?token=` é negada por default (`PORTAL_ALLOW_QUERY_TOKEN=true` para compat)
- E-mail sem SMTP: fallback só registra destinatário/assunto (corpo com tokens nunca vai ao console)
- Convite: em production o token não volta no JSON (salvo `ALLOW_INVITE_TOKEN_IN_RESPONSE=true`); lab sem SMTP ainda devolve para copiar o link
- Agent downloads: Bearer; query só com `AGENT_ALLOW_QUERY_TOKEN=true`
- Bootstraps do agent: `apiUrl` só se igual a `API_URL` ou listado em `AGENT_API_URL_ALLOWLIST`
- SSO Entra: código one-time (`/login?sso=entra&code=`) — sem JWT na URL
- Org `requireTwoFactor`: API retorna `2FA_SETUP_REQUIRED` e o painel redireciona para `/settings/security`
- `allowedSiteIds` em listagens e mutações (tickets, assets, patches, dashboard, remoto)
- Remoto em production: `native` (stream in-app) ou Guacamole/Mesh/noVNC (ou `ALLOW_RDP_REMOTE=true`); senha não vai na URL
- Vault exige `VAULT_ENCRYPTION_KEY` (fail-fast)
- `READ_ONLY` não muta tickets/devices/scripts/integrações (`requireWrite`)
- Seed bloqueado em production sem `ALLOW_DEMO_SEED`
- Com `REDIS_REQUIRED=true`, `/health` retorna 503 se filas/Redis off
- Stripe webhook usa `express.raw` (assinatura HMAC válida)
- Checkout Stripe em production exige `STRIPE_SECRET_KEY` (ou `ALLOW_STRIPE_STUB=true`)
- Webhook Stripe em production exige `STRIPE_WEBHOOK_SECRET` (ou `ALLOW_STRIPE_WEBHOOK_STUB=true`)
- Scan de rede em production: preferir via agent; API scan só com `ALLOW_API_NETWORK_SCAN=true`
- WebRTC no viewer: só com `VITE_ENABLE_WEBRTC=true`
- Agent: registro devolve `deviceToken` (por device); org token ainda aceito até `REQUIRE_DEVICE_AGENT_TOKEN=true`
- Alertas: BullMQ quando Redis OK; sem Redis, fallback no processo da API a cada 60s
- SSO Entra: códigos one-time em Redis (TTL 60s) com fallback in-memory

---

Dúvidas frequentes: Redis 3.x do Windows **não** serve — use Docker Redis 7. Agente com `localhost` só funciona na mesma máquina da API.
