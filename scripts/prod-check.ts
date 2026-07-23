/**
 * Pré-voo de produção: valida .env e opcionalmente /health.
 * Uso: npm run prod:check
 *      npm run prod:check -- --health http://localhost:3001/health
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env');

function loadEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

if (existsSync(envPath)) {
  loadEnvFile(envPath);
} else {
  console.warn('⚠️  .env não encontrado na raiz — validando process.env atual');
}

type Severity = 'error' | 'warn' | 'ok';
const results: { severity: Severity; msg: string }[] = [];

function ok(msg: string) {
  results.push({ severity: 'ok', msg });
}
function warn(msg: string) {
  results.push({ severity: 'warn', msg });
}
function err(msg: string) {
  results.push({ severity: 'error', msg });
}

function has(key: string): string {
  return (process.env[key] || '').trim();
}

function looksInsecure(value: string): boolean {
  return /change-me|changeme|^test|^ci-|password|secret123|dev-jwt|0123456789abcdef/i.test(value);
}

function isHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLocalhostUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
  } catch {
    return true;
  }
}

// ── Secrets ──────────────────────────────────────────────────────────────────
const secrets = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'VAULT_ENCRYPTION_KEY'] as const;
for (const key of secrets) {
  const v = has(key);
  if (!v) err(`${key} ausente`);
  else if (v.length < 32) err(`${key} tem ${v.length} chars (mínimo 32 em produção)`);
  else if (looksInsecure(v)) err(`${key} parece placeholder inseguro`);
  else ok(`${key} ok (${v.length} chars)`);
}

if (has('VAULT_ENCRYPTION_KEY') && has('VAULT_ENCRYPTION_KEY').length < 32) {
  err('VAULT_ENCRYPTION_KEY < 32 caracteres');
}

// ── URLs / DB / Redis / SMTP ─────────────────────────────────────────────────
const db = has('DATABASE_URL');
if (!db) err('DATABASE_URL ausente');
else if (/nexaops:nexaops@|root:root@|password@/i.test(db)) warn('DATABASE_URL parece usar senha fraca/demo');
else ok('DATABASE_URL definida');

const redis = has('REDIS_URL');
if (!redis) err('REDIS_URL ausente');
else ok(`REDIS_URL=${redis}`);

if (has('REDIS_REQUIRED') !== 'true') {
  err('REDIS_REQUIRED deve ser true em produção');
} else ok('REDIS_REQUIRED=true');

const cors = has('CORS_ORIGIN');
if (!cors) err('CORS_ORIGIN ausente');
else if (isLocalhostUrl(cors)) err(`CORS_ORIGIN não pode ser localhost em produção: ${cors}`);
else if (!isHttpsUrl(cors) && !cors.includes(',')) warn(`CORS_ORIGIN sem HTTPS: ${cors}`);
else ok(`CORS_ORIGIN=${cors}`);

const apiUrl = has('API_URL');
if (!apiUrl) err('API_URL ausente');
else if (isLocalhostUrl(apiUrl)) err(`API_URL não pode ser localhost em produção: ${apiUrl}`);
else if (!isHttpsUrl(apiUrl)) warn(`API_URL sem HTTPS: ${apiUrl}`);
else ok(`API_URL=${apiUrl}`);

const smtpHost = has('SMTP_HOST');
if (!smtpHost) err('SMTP_HOST ausente (e-mails de prod)');
else ok(`SMTP_HOST=${smtpHost}`);
if (has('SMTP_REQUIRED') !== 'true') {
  err('SMTP_REQUIRED deve ser true em produção');
} else ok('SMTP_REQUIRED=true');
if (!has('SMTP_FROM')) warn('SMTP_FROM vazio — usará noreply@nexaops.local');

// ── Storage / remoto / billing ───────────────────────────────────────────────
if (!has('S3_BUCKET') || !has('S3_ACCESS_KEY') || !has('S3_SECRET_KEY')) {
  if (has('ALLOW_DB_ATTACHMENTS') === 'true') {
    warn('S3 ausente com ALLOW_DB_ATTACHMENTS=true — anexos no MySQL (não escala)');
  } else {
    err('S3_BUCKET + S3_ACCESS_KEY + S3_SECRET_KEY obrigatórios (ou ALLOW_DB_ATTACHMENTS=true)');
  }
} else {
  ok(`S3_BUCKET=${has('S3_BUCKET')}`);
}

const remote = (has('REMOTE_PROVIDER') || 'native').toLowerCase();
if (remote === 'native') {
  ok('REMOTE_PROVIDER=native — viewer in-app (stream Socket.io)');
} else if (remote === 'rdp') {
  if (has('ALLOW_RDP_REMOTE') === 'true') {
    warn('REMOTE_PROVIDER=rdp com ALLOW_RDP_REMOTE=true — stream nativo + .rdp opcional');
  } else {
    err('REMOTE_PROVIDER=rdp — use native|guacamole|meshcentral|novnc ou ALLOW_RDP_REMOTE=true');
  }
} else if (remote === 'guacamole') {
  if (!has('GUACAMOLE_URL')) err('REMOTE_PROVIDER=guacamole exige GUACAMOLE_URL');
  else ok(`REMOTE_PROVIDER=guacamole (${has('GUACAMOLE_URL')})`);
} else if (remote === 'meshcentral') {
  if (!has('MESHCENTRAL_URL')) err('REMOTE_PROVIDER=meshcentral exige MESHCENTRAL_URL');
  else ok(`REMOTE_PROVIDER=meshcentral (${has('MESHCENTRAL_URL')})`);
} else if (remote === 'novnc') {
  if (!has('NOVNC_URL')) err('REMOTE_PROVIDER=novnc exige NOVNC_URL');
  else ok(`REMOTE_PROVIDER=novnc (${has('NOVNC_URL')})`);
} else if (remote === 'url') {
  ok('REMOTE_PROVIDER=url (template REMOTE_SESSION_URL_TEMPLATE)');
} else {
  warn(`REMOTE_PROVIDER desconhecido: ${remote}`);
}

if (!has('REMOTE_URL_SIGNING_SECRET') && remote !== 'rdp' && remote !== 'native') {
  warn('REMOTE_URL_SIGNING_SECRET ausente — URLs remotas usam JWT_SECRET (sem fallback hardcoded)');
}

if (has('PORTAL_ALLOW_QUERY_TOKEN') === 'true') {
  warn('PORTAL_ALLOW_QUERY_TOKEN=true — preferir só header X-Portal-Token');
} else {
  ok('Portal: query token desabilitada ou default-safe');
}

if (has('AGENT_ALLOW_QUERY_TOKEN') === 'true') {
  warn('AGENT_ALLOW_QUERY_TOKEN=true — preferir Authorization Bearer');
}

if (!has('SENTRY_DSN')) warn('SENTRY_DSN ausente — erros não vão ao Sentry');
else ok('SENTRY_DSN definida');

if (!has('STRIPE_SECRET_KEY')) warn('STRIPE_SECRET_KEY ausente — checkout Stripe em stub/503');
else {
  ok('STRIPE_SECRET_KEY definida');
  if (!has('STRIPE_WEBHOOK_SECRET')) {
    warn('STRIPE_WEBHOOK_SECRET ausente — webhook Stripe rejeitado em production (salvo ALLOW_STRIPE_WEBHOOK_STUB)');
  } else ok('STRIPE_WEBHOOK_SECRET definida');
}

if (!has('MICROSOFT_CLIENT_ID')) warn('SSO Entra não configurado (MICROSOFT_CLIENT_ID)');
else ok('Microsoft OAuth/SSO client configurado');

if (has('NODE_ENV') !== 'production') {
  warn(`NODE_ENV=${has('NODE_ENV') || '(vazio)'} — use production no deploy`);
} else ok('NODE_ENV=production');

if (has('ALLOW_DEMO_SEED') === 'true') err('ALLOW_DEMO_SEED=true — remova em produção');
else ok('ALLOW_DEMO_SEED não ativo');

// ── MSI / code sign ──────────────────────────────────────────────────────────
if (!has('CODE_SIGN_PFX_PATH') && !existsSync(resolve(root, 'apps/agent/installer/dist'))) {
  warn('MSI assinado: configure CODE_SIGN_PFX_* e rode npm run build:agent-msi');
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log('\n=== NexaOps prod:check ===\n');
for (const r of results) {
  const icon = r.severity === 'ok' ? '✅' : r.severity === 'warn' ? '⚠️ ' : '❌';
  console.log(`${icon} ${r.msg}`);
}

const errors = results.filter((r) => r.severity === 'error').length;
const warnings = results.filter((r) => r.severity === 'warn').length;
console.log(`\nResumo: ${errors} erro(s), ${warnings} aviso(s)\n`);

// ── Optional live health ─────────────────────────────────────────────────────
const healthIdx = process.argv.indexOf('--health');
const healthUrl =
  healthIdx >= 0
    ? process.argv[healthIdx + 1] || 'http://localhost:3001/health'
    : process.env.PROD_CHECK_HEALTH_URL;

async function checkHealth(url: string) {
  try {
    const res = await fetch(url);
    const body = (await res.json()) as Record<string, unknown>;
    console.log(`Health ${url} → HTTP ${res.status}`);
    console.log(JSON.stringify(body, null, 2));
    if (res.status !== 200 || body.status !== 'ok') {
      console.error('❌ /health não está ok');
      process.exit(1);
    }
    ok('Health endpoint ok');
  } catch (e) {
    console.error(`❌ Falha ao chamar ${url}:`, (e as Error).message);
    process.exit(1);
  }
}

(async () => {
  if (healthUrl) await checkHealth(healthUrl);
  if (errors > 0) {
    console.error('Corrija os erros antes do go-live. Veja DEPLOY.md.');
    process.exit(1);
  }
  console.log('Checklist de env passou (avisos não bloqueiam).');
  process.exit(0);
})();
