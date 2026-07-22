/**
 * Força troca da senha do admin demo (ou e-mail informado).
 * Uso: npx tsx scripts/force-admin-password.ts [email] [novaSenha]
 */
import '../src/load-env.js';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';

async function main() {
  const email = process.argv[2] || 'admin@nexaops.demo';
  const newPassword = process.argv[3] || process.env.NEW_ADMIN_PASSWORD;
  if (!newPassword || newPassword.length < 10) {
    console.error('Uso: npx tsx scripts/force-admin-password.ts <email> <novaSenhaMin10>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Usuário não encontrado: ${email}`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  console.log(`✅ Senha atualizada para ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
