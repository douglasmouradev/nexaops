/**
 * Limpa dados operacionais do banco (demo/ops), mantendo Organization + User.
 * Uso: npx tsx apps/api/scripts/wipe-ops-data.ts
 */
import '../src/load-env.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Limpando dados operacionais (mantém usuários e organizações)...');

  // Ordem: filhos → pais (FKs)
  await prisma.scriptExecution.deleteMany();
  await prisma.remoteSession.deleteMany();
  await prisma.resourceMetric.deleteMany();
  await prisma.deviceNetworkInterface.deleteMany().catch(() => undefined);
  await prisma.softwareItem.deleteMany();
  await prisma.hardwareInfo.deleteMany();
  await prisma.ticketComment.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.patch.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.discoveredDevice.deleteMany();
  await prisma.networkScan.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.knowledgeArticle.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.aiUsageLog.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.invoiceLine.deleteMany().catch(() => undefined);
  await prisma.invoice.deleteMany().catch(() => undefined);
  await prisma.timeEntry.deleteMany().catch(() => undefined);
  await prisma.device.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.passwordVault.deleteMany();
  await prisma.site.deleteMany();
  await prisma.script.deleteMany();
  await prisma.automationProfile.deleteMany();
  await prisma.alertRule.deleteMany();
  // Mantém threshold profiles / integrations / ai toggles se existirem — apaga também para “zerar”
  await prisma.thresholdProfile.deleteMany();
  await prisma.integration.deleteMany();
  await prisma.aiFeatureToggle.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.passwordReset.deleteMany().catch(() => undefined);

  const [orgs, users, devices, tickets] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.device.count(),
    prisma.ticket.count(),
  ]);

  console.log('✅ Limpeza concluída.');
  console.log(`   Organizações: ${orgs} | Usuários: ${users} | Dispositivos: ${devices} | Tickets: ${tickets}`);
  console.log('   Faça logout/login ou F5 no painel para atualizar o dashboard.');
}

main()
  .catch((err) => {
    console.error('❌ Falha na limpeza:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
