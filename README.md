# NexaOps

Plataforma SaaS all-in-one de gestão de TI (RMM + PSA) para MSPs e departamentos internos de TI.

Veja também: [DEPLOY.md](./DEPLOY.md) — checklist completo de produção.

```bash
npm run prod:check          # valida .env para go-live
npm run prod:create-admin   # admin sem seed demo
npm run prod:up             # docker compose + overlay de produção
```

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React + TypeScript + Vite + Tailwind CSS + shadcn/ui |
| Backend | Node.js + Express + TypeScript |
| Banco | MySQL 8 + Prisma ORM |
| Cache/Filas | Redis 7 + BullMQ |
| Real-time | Socket.io |
| Validação | Zod (compartilhado via `@nexaops/shared`) |
| Testes | Jest + Supertest (API), Vitest (Web), Playwright (E2E) |

## Estrutura do Monorepo

```
apps/
  api/       → Backend REST + WebSocket
  web/       → Frontend React
  agent/     → Agente Windows/Linux/macOS (métricas, scripts, patches, remoto, auto-update)
packages/
  shared/    → Tipos e schemas Zod compartilhados
```

## Pré-requisitos

- Node.js 20+
- Docker e Docker Compose (para MySQL e Redis)
- npm 10+

## Setup Local

### 1. Clonar e instalar dependências

```bash
cd NexaOps
cp .env.example .env
npm install
```

### 2. Subir MySQL e Redis

```bash
docker compose up mysql redis -d
```

### 3. Configurar banco de dados

```bash
# Preferido (migrations versionadas)
npm run db:migrate:deploy

# Alternativa em dev rápido:
# npm run db:push

npm run db:seed
```

### 4. Iniciar em desenvolvimento

```bash
npm run dev
```

- **Frontend:** http://localhost:5173
- **API:** http://localhost:3001
- **Swagger:** http://localhost:3001/api/docs

### Credenciais de demonstração

| Campo | Valor |
|-------|-------|
| E-mail | `admin@nexaops.demo` |
| Senha | `Admin@123` |

## Docker (stack completa)

```bash
docker compose up -d
```

## Testes

```bash
# Todos os testes
npm test

# Apenas API
npm run test -w @nexaops/api

# Apenas Web
npm run test -w @nexaops/web

# E2E (Playwright) — com API + web rodando
npx playwright install chromium
npm run test:e2e
```

## Módulos Implementados

- **Autenticação** — Login, cadastro, JWT + refresh, 2FA (TOTP), convites, SSO Entra (código one-time)
- **Dashboard** — KPIs, gráfico de tickets, alertas críticos
- **Dispositivos** — Tabela, filtros (linguagem natural / LLM opcional), ações em lote, wizard do agente, métricas
- **Sites** — CRUD de clientes, cofre de senhas criptografado
- **Tickets** — Help desk com SLA, comentários internos/cliente
- **Alertas** — Central com regras, notificações e ticket automático em CRITICAL
- **Patch Management** — Lista, agendamento, compliance via agent
- **Scripts & Automação** — Biblioteca, execução via agent, dual-control, profiles de automação
- **Inventário de Ativos** — Hardware, software, licenças
- **Descoberta de Rede** — Scan via agent (API scan só em lab)
- **Base de Conhecimento** — Artigos internos e públicos
- **Centro de IA** — Toggles, créditos, assist/parse-filter (OpenAI se `OPENAI_API_KEY`)
- **Centro de Aplicativos** — Marketplace de integrações
- **Relatórios** — Por categoria (JSON/PDF) com escopo de sites
- **Administração** — Usuários, perfis de limite, auditoria, organização
- **Portal do Cliente** — Preferir `X-Portal-Token` (query `?token=` desligada em production por default)

## Variáveis de Ambiente

Veja `.env.example` para todas as variáveis. As principais:

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | Connection string MySQL |
| `REDIS_URL` | Connection string Redis |
| `JWT_SECRET` | Segredo para access tokens |
| `JWT_REFRESH_SECRET` | Segredo para refresh tokens |
| `VAULT_ENCRYPTION_KEY` | Chave AES-256 para cofre de senhas |

## API

Documentação OpenAPI disponível em `/api/docs` quando a API estiver rodando.

## Novidades (v0.5+)

- **Agente v0.5** — Socket.io, patches, network scan on-site, `deviceToken` por equipamento
- **Paginação** — tickets, alerts, patches, sites, scripts, knowledge, assets, admin
- **Web** — lazy routes, Admin Users/Thresholds/Audit, AI/Referrals/Reports, vault, CSV
- **Docker** — Redis 7, secrets via env, nginx proxy `/socket.io`
- **Portal** — `portalToken` + header; query token gated em production
- **Hardening** — dual-control, site scope, Stripe webhook assinado, allowlist `apiUrl` do agent
- **Instalador MSI** — `npm run build:agent-msi`

### Agente NexaOps

```bash
# Token em Admin > Organização
node apps/agent/index.js --token=SEU_AGENT_TOKEN --api=http://localhost:3001

# Ou MSI
npm run build:agent-msi
# msiexec /i apps/agent/installer/dist/NexaOpsAgent.msi TOKEN=... API_URL=http://localhost:3001
```

### Portal do cliente

Link (Admin → Organização). Em **production**, prefira header `X-Portal-Token` (query `?token=` só com `PORTAL_ALLOW_QUERY_TOKEN=true`):

`http://localhost:5173/portal/<slug>` + header, ou em lab: `?token=<portalToken>`

O cliente informa o e-mail para ver apenas os próprios chamados.

### Segurança (2FA e convites)

http://localhost:5173/settings/security


- Filtro em linguagem natural e assistente usam LLM quando `OPENAI_API_KEY` está definida; sem chave, há parser/heurística local.
- Varredura de rede em larga escala pode ser extraída para Go no futuro, conforme documentado no prompt de arquitetura.
