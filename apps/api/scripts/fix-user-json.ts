import '../src/load-env.js';
import { prisma } from '../src/lib/prisma.js';
import * as authService from '../src/services/auth.service.js';

async function main() {
  const col = await prisma.$queryRawUnsafe<{ COLUMN_TYPE: string; DATA_TYPE: string }[]>(
    `SELECT DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User' AND COLUMN_NAME = 'allowedSiteIds'`
  );
  console.log('column', col);

  // MariaDB/MySQL: empty string in JSON/text column breaks Prisma deserialize
  const result = await prisma.$executeRawUnsafe(
    `UPDATE User SET allowedSiteIds = '[]' WHERE CAST(allowedSiteIds AS CHAR) = '' OR allowedSiteIds IS NULL`
  );
  console.log('fixed rows:', result);

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE \`User\` MODIFY \`allowedSiteIds\` JSON NOT NULL`);
    console.log('ALTER to JSON: ok');
  } catch (e) {
    console.log('ALTER to JSON skipped:', (e as Error).message);
  }

  const u = await prisma.user.findUnique({
    where: { email: 'admin@nexaops.demo' },
    include: { organization: true },
  });
  console.log('findUnique ok', !!u, u?.email, u?.allowedSiteIds);

  const login = await authService.loginUser({
    email: 'admin@nexaops.demo',
    password: 'Admin@123',
  });
  console.log('login ok', login.user.email, login.tokens.accessToken.slice(0, 20) + '...');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
