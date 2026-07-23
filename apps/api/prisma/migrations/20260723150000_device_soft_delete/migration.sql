-- Soft-delete de dispositivos (evita agent recriar no register)
ALTER TABLE `Device` ADD COLUMN `deletedAt` DATETIME(3) NULL;
CREATE INDEX `Device_organizationId_deletedAt_idx` ON `Device`(`organizationId`, `deletedAt`);
