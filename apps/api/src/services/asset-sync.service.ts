import { prisma } from '../lib/prisma.js';

/**
 * Sincroniza inventário unificado (Asset) a partir do hardware/software do device.
 */
export async function syncAssetsFromDevice(deviceId: string): Promise<{ hardware: number; software: number }> {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: {
      hardwareInfo: true,
      softwareItems: { take: 200, orderBy: { name: 'asc' } },
    },
  });
  if (!device) return { hardware: 0, software: 0 };

  let hardware = 0;
  let software = 0;

  const hw = device.hardwareInfo;
  if (hw) {
    const name = [hw.manufacturer, hw.model].filter(Boolean).join(' ') || device.name;
    const existing = await prisma.asset.findFirst({
      where: {
        organizationId: device.organizationId,
        type: 'HARDWARE',
        OR: [
          ...(hw.serialNumber ? [{ serialNumber: hw.serialNumber }] : []),
          { name, siteId: device.siteId },
        ],
      },
    });
    if (existing) {
      await prisma.asset.update({
        where: { id: existing.id },
        data: {
          name,
          manufacturer: hw.manufacturer,
          model: hw.model,
          serialNumber: hw.serialNumber,
          siteId: device.siteId,
        },
      });
    } else {
      await prisma.asset.create({
        data: {
          name,
          type: 'HARDWARE',
          manufacturer: hw.manufacturer,
          model: hw.model,
          serialNumber: hw.serialNumber,
          siteId: device.siteId,
          organizationId: device.organizationId,
        },
      });
    }
    hardware = 1;
  }

  // Top software únicos → Asset SOFTWARE (limite para não explodir)
  const seen = new Set<string>();
  for (const item of device.softwareItems) {
    const key = item.name.toLowerCase();
    if (seen.has(key) || seen.size >= 50) continue;
    seen.add(key);

    const existing = await prisma.asset.findFirst({
      where: {
        organizationId: device.organizationId,
        type: 'SOFTWARE',
        name: item.name,
      },
    });
    if (existing) {
      await prisma.asset.update({
        where: { id: existing.id },
        data: {
          manufacturer: item.publisher,
          model: item.version,
        },
      });
    } else {
      await prisma.asset.create({
        data: {
          name: item.name,
          type: 'SOFTWARE',
          manufacturer: item.publisher,
          model: item.version,
          organizationId: device.organizationId,
          siteId: device.siteId,
        },
      });
    }
    software += 1;
  }

  return { hardware, software };
}
