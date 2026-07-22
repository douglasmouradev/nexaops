import '../src/load-env';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    console.error('❌ Seed de demo bloqueado em produção (NODE_ENV=production).');
    console.error('   Se realmente precisar: ALLOW_DEMO_SEED=true npm run db:seed');
    process.exit(1);
  }

  console.log('🌱 Iniciando seed...');

  await prisma.scriptExecution.deleteMany();
  await prisma.remoteSession.deleteMany();
  await prisma.resourceMetric.deleteMany();
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
  await prisma.device.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.passwordVault.deleteMany();
  await prisma.site.deleteMany();
  await prisma.script.deleteMany();
  await prisma.automationProfile.deleteMany();
  await prisma.alertRule.deleteMany();
  await prisma.thresholdProfile.deleteMany();
  await prisma.integration.deleteMany();
  await prisma.aiFeatureToggle.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  const passwordHash = await bcrypt.hash('Admin@123', 12);

  const org = await prisma.organization.create({
    data: {
      name: 'TechMSP Solutions',
      slug: 'techmsp-solutions',
      billingEmail: 'billing@techmsp.demo',
      plan: 'professional',
      aiCredits: 500,
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: 'admin@nexaops.demo',
      passwordHash,
      name: 'Carlos Administrador',
      role: 'ADMIN',
      organizationId: org.id,
      allowedSiteIds: [],
    },
  });

  const tech1 = await prisma.user.create({
    data: {
      email: 'joao@nexaops.demo',
      passwordHash,
      name: 'João Silva',
      role: 'TECHNICIAN',
      organizationId: org.id,
      allowedSiteIds: [],
    },
  });

  const tech2 = await prisma.user.create({
    data: {
      email: 'maria@nexaops.demo',
      passwordHash,
      name: 'Maria Santos',
      role: 'TECHNICIAN',
      organizationId: org.id,
      allowedSiteIds: [],
    },
  });

  const integrations = [
    'slack', 'teams', 'microsoft-365', 'stripe', 'quickbooks',
    'splashtop', 'anydesk', 'screenconnect',
  ];
  await prisma.integration.createMany({
    data: integrations.map((slug) => ({
      name: slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      slug,
      organizationId: org.id,
      connected: ['slack', 'microsoft-365'].includes(slug),
    })),
  });

  const aiFeatures = ['ticket-summary', 'response-suggestion', 'script-generation', 'alert-triage'];
  await prisma.aiFeatureToggle.createMany({
    data: aiFeatures.map((feature) => ({ feature, organizationId: org.id })),
  });

  const thresholdDefault = await prisma.thresholdProfile.create({
    data: {
      name: 'Padrão MSP',
      cpuThreshold: 85,
      ramThreshold: 90,
      diskThreshold: 90,
      offlineMinutes: 15,
      organizationId: org.id,
    },
  });

  await prisma.thresholdProfile.create({
    data: {
      name: 'Servidores Críticos',
      cpuThreshold: 75,
      ramThreshold: 80,
      diskThreshold: 85,
      offlineMinutes: 5,
      organizationId: org.id,
    },
  });

  const sites = await Promise.all([
    prisma.site.create({
      data: {
        name: 'Acme Corporation',
        address: 'Av. Paulista, 1000',
        city: 'São Paulo',
        state: 'SP',
        phone: '(11) 3000-0001',
        email: 'ti@acme.com.br',
        organizationId: org.id,
      },
    }),
    prisma.site.create({
      data: {
        name: 'Beta Industries',
        address: 'Rua das Flores, 500',
        city: 'Rio de Janeiro',
        state: 'RJ',
        phone: '(21) 2500-0002',
        email: 'suporte@betaind.com.br',
        organizationId: org.id,
      },
    }),
    prisma.site.create({
      data: {
        name: 'Gamma Tech Ltda',
        address: 'Av. Boa Viagem, 200',
        city: 'Recife',
        state: 'PE',
        phone: '(81) 3200-0003',
        email: 'helpdesk@gammatech.com.br',
        organizationId: org.id,
      },
    }),
  ]);

  const deviceData = [
    { name: 'SRV-ACME-01', type: 'SERVER' as const, status: 'ONLINE' as const, osType: 'WINDOWS' as const, osVersion: 'Windows Server 2022', site: 0, folder: 'Servidores', user: 'administrator', patches: 3, reboot: true },
    { name: 'WS-ACME-042', type: 'PC' as const, status: 'ONLINE' as const, osType: 'WINDOWS' as const, osVersion: 'Windows 11 Pro', site: 0, folder: 'Financeiro', user: 'pedro.silva', patches: 5, reboot: false },
    { name: 'WS-ACME-015', type: 'PC' as const, status: 'OFFLINE' as const, osType: 'WINDOWS' as const, osVersion: 'Windows 10 Pro', site: 0, folder: 'RH', user: 'ana.costa', patches: 2, reboot: false },
    { name: 'SRV-BETA-DC01', type: 'SERVER' as const, status: 'ONLINE' as const, osType: 'WINDOWS' as const, osVersion: 'Windows Server 2019', site: 1, folder: 'Infraestrutura', user: 'domain\\admin', patches: 1, reboot: false },
    { name: 'MAC-BETA-008', type: 'PC' as const, status: 'ONLINE' as const, osType: 'MACOS' as const, osVersion: 'macOS Sonoma 14.4', site: 1, folder: 'Design', user: 'lucas.design', patches: 0, reboot: false },
    { name: 'SRV-GAMMA-WEB', type: 'SERVER' as const, status: 'ONLINE' as const, osType: 'LINUX' as const, osVersion: 'Ubuntu 22.04 LTS', site: 2, folder: 'Produção', user: 'deploy', patches: 8, reboot: true },
    { name: 'WS-GAMMA-022', type: 'PC' as const, status: 'OFFLINE' as const, osType: 'LINUX' as const, osVersion: 'Ubuntu 24.04', site: 2, folder: 'Dev', user: 'dev.team', patches: 4, reboot: false },
    { name: 'SW-CORE-01', type: 'NETWORK' as const, status: 'ONLINE' as const, osType: 'LINUX' as const, osVersion: 'Cisco IOS', site: 0, folder: 'Rede', user: null, patches: 0, reboot: false },
    { name: 'MOB-ACME-003', type: 'MOBILE' as const, status: 'ONLINE' as const, osType: 'MACOS' as const, osVersion: 'iOS 17.4', site: 0, folder: 'Executivos', user: 'ceo@acme.com', patches: 0, reboot: false },
    { name: 'WS-ACME-099', type: 'PC' as const, status: 'ONLINE' as const, osType: 'WINDOWS' as const, osVersion: 'Windows 11 Pro', site: 0, folder: 'TI', user: 'ti.local', patches: 6, reboot: false, favorite: true },
  ];

  const devices = [];
  for (const d of deviceData) {
    const device = await prisma.device.create({
      data: {
        name: d.name,
        hostname: d.name.toLowerCase() + '.local',
        type: d.type,
        status: d.status,
        osType: d.osType,
        osVersion: d.osVersion,
        folder: d.folder,
        lastUserLogin: d.user,
        lastSeenAt: d.status === 'ONLINE' ? new Date() : new Date(Date.now() - 3600000 * 4),
        patchesAvailable: d.patches,
        rebootPending: d.reboot,
        isFavorite: 'favorite' in d ? d.favorite : false,
        siteId: sites[d.site].id,
        organizationId: org.id,
        thresholdProfileId: d.type === 'SERVER' ? thresholdDefault.id : undefined,
        tags: d.type === 'SERVER' ? ['critical', 'monitored'] : ['workstation'],
      },
    });
    devices.push(device);

    await prisma.hardwareInfo.create({
      data: {
        deviceId: device.id,
        cpuModel: d.type === 'SERVER' ? 'Intel Xeon E-2288G' : 'Intel Core i7-12700',
        cpuCores: d.type === 'SERVER' ? 8 : 4,
        ramTotalGb: d.type === 'SERVER' ? 64 : 16,
        diskTotalGb: d.type === 'SERVER' ? 2000 : 512,
        diskFreeGb: d.type === 'SERVER' ? 800 : 200,
        manufacturer: d.osType === 'MACOS' ? 'Apple' : 'Dell',
        model: d.type === 'SERVER' ? 'PowerEdge R740' : 'OptiPlex 7090',
        serialNumber: `SN-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        warrantyEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 * 2),
      },
    });

    const software = [
      { name: 'Google Chrome', version: '122.0.6261.112', publisher: 'Google LLC' },
      { name: 'Microsoft Office 365', version: '16.0.17328', publisher: 'Microsoft' },
      { name: 'Adobe Acrobat Reader', version: '24.001.20643', publisher: 'Adobe' },
    ];
    if (d.type === 'SERVER') {
      software.push({ name: 'SQL Server 2019', version: '15.0.4298.1', publisher: 'Microsoft' });
    }
    await prisma.softwareItem.createMany({
      data: software.map((s) => ({ ...s, deviceId: device.id })),
    });

    for (let i = 0; i < 24; i++) {
      await prisma.resourceMetric.create({
        data: {
          deviceId: device.id,
          cpuPercent: 20 + Math.random() * 60,
          ramPercent: 30 + Math.random() * 50,
          diskPercent: 40 + Math.random() * 30,
          recordedAt: new Date(Date.now() - i * 3600000),
        },
      });
    }

    if (d.patches > 0) {
      for (let p = 0; p < d.patches; p++) {
        await prisma.patch.create({
          data: {
            title: `KB5034${100 + p} - Atualização de Segurança`,
            kbId: `KB5034${100 + p}`,
            severity: p === 0 ? 'Critical' : 'Important',
            status: 'PENDING',
            deviceId: device.id,
            organizationId: org.id,
          },
        });
      }
    }
  }

  const alertData = [
    { title: 'CPU acima de 85%', severity: 'CRITICAL' as const, device: 0, status: 'NEW' as const },
    { title: 'Disco com menos de 10% livre', severity: 'WARNING' as const, device: 0, status: 'ACKNOWLEDGED' as const },
    { title: 'Dispositivo offline há 4 horas', severity: 'WARNING' as const, device: 2, status: 'NEW' as const },
    { title: 'Serviço Windows Update parado', severity: 'INFO' as const, device: 1, status: 'NEW' as const },
    { title: 'RAM acima de 90%', severity: 'CRITICAL' as const, device: 5, status: 'NEW' as const },
    { title: 'Reinício pendente após patch', severity: 'WARNING' as const, device: 0, status: 'NEW' as const },
  ];

  for (const a of alertData) {
    await prisma.alert.create({
      data: {
        title: a.title,
        message: `${a.title} detectado no dispositivo ${devices[a.device].name}`,
        severity: a.severity,
        status: a.status,
        deviceId: devices[a.device].id,
        organizationId: org.id,
        metric: 'CPU',
        value: 87 + Math.random() * 10,
      },
    });
  }

  await prisma.alertRule.createMany({
    data: [
      { name: 'CPU Alta', metric: 'CPU', threshold: 85, severity: 'CRITICAL', organizationId: org.id },
      { name: 'RAM Alta', metric: 'RAM', threshold: 90, severity: 'WARNING', organizationId: org.id },
      { name: 'Disco Cheio', metric: 'DISK', threshold: 90, severity: 'CRITICAL', organizationId: org.id },
      { name: 'Offline 15min', metric: 'OFFLINE', durationMinutes: 15, severity: 'WARNING', organizationId: org.id },
    ],
  });

  const ticketData = [
    { title: 'E-mail corporativo fora do ar', priority: 'URGENT' as const, status: 'OPEN' as const, site: 0, device: 0, assignee: tech1.id },
    { title: 'Impressora não imprime na rede', priority: 'MEDIUM' as const, status: 'PENDING' as const, site: 0, device: 1, assignee: tech2.id },
    { title: 'Solicitação de novo usuário AD', priority: 'LOW' as const, status: 'OPEN' as const, site: 1, device: null, assignee: tech1.id },
    { title: 'Servidor web lento', priority: 'HIGH' as const, status: 'OPEN' as const, site: 2, device: 5, assignee: tech2.id },
    { title: 'VPN não conecta', priority: 'HIGH' as const, status: 'RESOLVED' as const, site: 0, device: 2, assignee: tech1.id },
    { title: 'Backup falhou ontem à noite', priority: 'URGENT' as const, status: 'OPEN' as const, site: 0, device: 0, assignee: tech1.id },
  ];

  let ticketNum = 1001;
  for (const t of ticketData) {
    const ticket = await prisma.ticket.create({
      data: {
        number: ticketNum++,
        title: t.title,
        description: `Chamado aberto para: ${t.title}`,
        priority: t.priority,
        status: t.status,
        siteId: sites[t.site].id,
        deviceId: t.device !== null ? devices[t.device].id : undefined,
        assigneeId: t.assignee,
        creatorId: admin.id,
        organizationId: org.id,
        slaDeadline: new Date(Date.now() + (t.priority === 'URGENT' ? 2 : 8) * 3600000),
        slaBreached: t.priority === 'URGENT' && t.status === 'OPEN',
        resolvedAt: t.status === 'RESOLVED' ? new Date() : undefined,
      },
    });

    await prisma.ticketComment.create({
      data: {
        content: 'Chamado recebido e em análise.',
        type: 'INTERNAL',
        ticketId: ticket.id,
        authorId: t.assignee,
      },
    });
  }

  await prisma.script.createMany({
    data: [
      {
        name: 'Limpar Temp do Windows',
        description: 'Remove arquivos temporários',
        language: 'POWERSHELL',
        content: 'Remove-Item -Path $env:TEMP\\* -Recurse -Force -ErrorAction SilentlyContinue',
        category: 'Manutenção',
        organizationId: org.id,
      },
      {
        name: 'Reiniciar Spooler de Impressão',
        description: 'Reinicia o serviço de impressão',
        language: 'POWERSHELL',
        content: 'Restart-Service -Name Spooler -Force',
        category: 'Serviços',
        organizationId: org.id,
      },
      {
        name: 'Atualizar pacotes Linux',
        description: 'Executa apt update && upgrade',
        language: 'BASH',
        content: '#!/bin/bash\napt update && apt upgrade -y',
        category: 'Manutenção',
        organizationId: org.id,
      },
    ],
  });

  await prisma.knowledgeArticle.createMany({
    data: [
      {
        title: 'Como resetar senha do Active Directory',
        content: '<h2>Reset de senha AD</h2><p>Acesse o console AD e...</p>',
        category: 'Active Directory',
        visibility: 'INTERNAL',
        organizationId: org.id,
      },
      {
        title: 'Configurar VPN no Windows',
        content: '<h2>VPN</h2><p>Abra Configurações > Rede e Internet...</p>',
        category: 'Rede',
        visibility: 'PUBLIC',
        organizationId: org.id,
      },
    ],
  });

  await prisma.asset.createMany({
    data: [
      { name: 'Dell PowerEdge R740', type: 'HARDWARE', manufacturer: 'Dell', model: 'PowerEdge R740', serialNumber: 'DELL-001', organizationId: org.id, warrantyEnd: new Date('2027-06-15') },
      { name: 'Microsoft 365 E3', type: 'LICENSE', manufacturer: 'Microsoft', licenseKey: 'XXXXX-XXXXX', organizationId: org.id },
      { name: 'VMware vSphere', type: 'SOFTWARE', manufacturer: 'VMware', organizationId: org.id },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      { action: 'LOGIN', entity: 'User', entityId: admin.id, userId: admin.id, organizationId: org.id },
      { action: 'CREATE', entity: 'Device', entityId: devices[0].id, userId: admin.id, organizationId: org.id },
      { action: 'UPDATE', entity: 'Ticket', userId: tech1.id, organizationId: org.id },
    ],
  });

  console.log('✅ Seed concluído!');
  console.log('');
  console.log('📧 Login: admin@nexaops.demo');
  console.log('🔑 Senha: Admin@123');
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
