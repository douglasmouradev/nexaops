import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

/** Carrega .env da raiz do monorepo e/ou de apps/api */
const envFiles = [
  resolve(process.cwd(), '../../.env'),
  resolve(process.cwd(), '.env'),
  resolve(__dirname, '../../../.env'),
  resolve(__dirname, '../../.env'),
];

for (const file of envFiles) {
  if (existsSync(file)) {
    config({ path: file });
  }
}

const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'VAULT_ENCRYPTION_KEY'] as const;
for (const key of required) {
  const value = process.env[key];
  if (!value || value.length < 16) {
    console.error(`❌ ${key} ausente ou muito curta. Configure no .env`);
    process.exit(1);
  }
}
if ((process.env.VAULT_ENCRYPTION_KEY || '').length < 32) {
  console.error('❌ VAULT_ENCRYPTION_KEY precisa ter no mínimo 32 caracteres');
  process.exit(1);
}

const isProd = process.env.NODE_ENV === 'production';
if (isProd) {
  const insecure = [/change-me/i, /changeme/i, /^test/i, /^ci-/i, /password/i, /secret123/i, /dev-jwt/i, /^0123456789abcdef/];
  for (const key of required) {
    const value = process.env[key] || '';
    if (value.length < 32) {
      console.error(`❌ ${key} deve ter ≥ 32 caracteres em production`);
      process.exit(1);
    }
    if (insecure.some((re) => re.test(value))) {
      console.error(`❌ ${key} parece um placeholder inseguro. Troque antes de subir em production`);
      process.exit(1);
    }
  }

  const must = [
    ['DATABASE_URL', process.env.DATABASE_URL],
    ['REDIS_URL', process.env.REDIS_URL],
    ['CORS_ORIGIN', process.env.CORS_ORIGIN],
    ['API_URL', process.env.API_URL],
    ['SMTP_HOST', process.env.SMTP_HOST],
  ] as const;
  for (const [key, value] of must) {
    if (!value || !String(value).trim()) {
      console.error(`❌ ${key} é obrigatório em production`);
      process.exit(1);
    }
  }

  if (process.env.REDIS_REQUIRED !== 'true') {
    console.error('❌ REDIS_REQUIRED=true é obrigatório em production');
    process.exit(1);
  }
  if (process.env.SMTP_REQUIRED !== 'true') {
    console.error('❌ SMTP_REQUIRED=true é obrigatório em production');
    process.exit(1);
  }

  const cors = process.env.CORS_ORIGIN || '';
  const apiUrl = process.env.API_URL || '';
  if (/localhost|127\.0\.0\.1/i.test(cors) && process.env.ALLOW_LOCALHOST_CORS !== 'true') {
    console.error('❌ CORS_ORIGIN não pode apontar para localhost em production');
    process.exit(1);
  }
  if (/localhost|127\.0\.0\.1/i.test(apiUrl)) {
    console.error('❌ API_URL não pode apontar para localhost em production (agents/MSI quebram)');
    process.exit(1);
  }

  if (!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY) {
    if (process.env.ALLOW_DB_ATTACHMENTS === 'true') {
      console.warn('⚠️  S3 ausente com ALLOW_DB_ATTACHMENTS=true — anexos no MySQL');
    } else {
      console.error('❌ S3_BUCKET + S3_ACCESS_KEY + S3_SECRET_KEY obrigatórios em production (ou ALLOW_DB_ATTACHMENTS=true)');
      process.exit(1);
    }
  }

  const remoteProvider = (process.env.REMOTE_PROVIDER || 'native').toLowerCase();
  if (remoteProvider === 'guacamole' && !process.env.GUACAMOLE_URL) {
    console.error('❌ REMOTE_PROVIDER=guacamole exige GUACAMOLE_URL em production');
    process.exit(1);
  }
  if (remoteProvider === 'meshcentral' && !process.env.MESHCENTRAL_URL) {
    console.error('❌ REMOTE_PROVIDER=meshcentral exige MESHCENTRAL_URL em production');
    process.exit(1);
  }
  if (remoteProvider === 'novnc' && !process.env.NOVNC_URL) {
    console.error('❌ REMOTE_PROVIDER=novnc exige NOVNC_URL em production');
    process.exit(1);
  }
  if (remoteProvider === 'native') {
    console.warn('ℹ️  REMOTE_PROVIDER=native — viewer in-app (stream Socket.io)');
  } else if (remoteProvider === 'rdp') {
    if (process.env.ALLOW_RDP_REMOTE === 'true') {
      console.warn('⚠️  REMOTE_PROVIDER=rdp com ALLOW_RDP_REMOTE=true — stream nativo + .rdp opcional');
    } else {
      console.error(
        '❌ Em production use REMOTE_PROVIDER=native|guacamole|meshcentral|novnc (ou ALLOW_RDP_REMOTE=true)'
      );
      process.exit(1);
    }
  }

  if (process.env.PORTAL_ALLOW_QUERY_TOKEN === 'true') {
    console.warn('⚠️  PORTAL_ALLOW_QUERY_TOKEN=true — token do portal pode vazar em logs/Referer');
  }
  if (process.env.AGENT_ALLOW_QUERY_TOKEN === 'true') {
    console.warn('⚠️  AGENT_ALLOW_QUERY_TOKEN=true — token do agent na query string');
  }

  if (process.env.ALLOW_DEMO_SEED === 'true') {
    console.warn('⚠️  ALLOW_DEMO_SEED=true em production — risco de dados demo');
  }
  if (!process.env.STRIPE_SECRET_KEY && process.env.ALLOW_STRIPE_STUB !== 'true') {
    console.warn('⚠️  STRIPE_SECRET_KEY ausente — checkout retorna 503 (ALLOW_STRIPE_STUB=true para stub)');
  }
  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET && process.env.ALLOW_STRIPE_WEBHOOK_STUB !== 'true') {
    console.warn('⚠️  STRIPE_WEBHOOK_SECRET ausente — webhook Stripe rejeitado (ALLOW_STRIPE_WEBHOOK_STUB=true para lab)');
  }
}
