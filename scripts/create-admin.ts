/**
 * Cria (ou reseta senha de) um admin de produção sem rodar o seed demo.
 * Uso:
 *   npm run prod:create-admin -- --email admin@empresa.com --password 'SenhaForte!' --org 'Minha MSP'
 */
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import bcrypt from 'bcryptjs';

const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

async function main() {
  const email = arg('email').toLowerCase().trim();
  const password = arg('password');
  const orgName = arg('org', 'NexaOps');
  const name = arg('name', 'Administrador');

  if (!email || !password || password.length < 10) {
    console.error('Uso: npx tsx scripts/create-admin.ts --email a@b.com --password "SenhaForte!" [--org "MSP"] [--name "Admin"]');
    process.exit(1);
  }

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    let org = await prisma.organization.findFirst({ where: { name: orgName } });
    if (!org) {
      const slug =
        orgName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'org';
      org = await prisma.organization.create({
        data: {
          name: orgName,
          slug: `${slug}-${Date.now().toString(36)}`,
        },
      });
      console.log('Organização criada:', org.id, org.slug);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, role: 'ADMIN', name, organizationId: org.id },
      });
      console.log('Admin atualizado:', email);
    } else {
      await prisma.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: 'ADMIN',
          organizationId: org.id,
          allowedSiteIds: [],
        },
      });
      console.log('Admin criado:', email);
    }
    console.log('Agent token (Admin → Organização):', org.agentToken);
    console.log('Portal token:', org.portalToken);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
