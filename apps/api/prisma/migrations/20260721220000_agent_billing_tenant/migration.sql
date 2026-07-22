-- AlterTable
ALTER TABLE `Organization` ADD COLUMN `agentMinVersion` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `allowedSiteIds` JSON NULL;
UPDATE `User` SET `allowedSiteIds` = JSON_ARRAY() WHERE `allowedSiteIds` IS NULL;
ALTER TABLE `User` MODIFY `allowedSiteIds` JSON NOT NULL;

-- AlterTable
ALTER TABLE `Device` ADD COLUMN `agentVersion` VARCHAR(191) NULL,
    ADD COLUMN `meshNodeId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `RemoteSession` ADD COLUMN `organizationId` VARCHAR(191) NULL;

-- Backfill RemoteSession.organizationId from Device
UPDATE `RemoteSession` rs
INNER JOIN `Device` d ON d.id = rs.deviceId
SET rs.organizationId = d.organizationId
WHERE rs.organizationId IS NULL;

-- Make organizationId required after backfill (MySQL)
ALTER TABLE `RemoteSession` MODIFY `organizationId` VARCHAR(191) NOT NULL;

CREATE INDEX `RemoteSession_organizationId_status_idx` ON `RemoteSession`(`organizationId`, `status`);

ALTER TABLE `RemoteSession` ADD CONSTRAINT `RemoteSession_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `NetworkScan` ADD COLUMN `mode` VARCHAR(191) NOT NULL DEFAULT 'api',
    ADD COLUMN `scannerDeviceId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `TimeEntry` (
    `id` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `hours` DOUBLE NOT NULL,
    `billable` BOOLEAN NOT NULL DEFAULT true,
    `hourlyRate` DOUBLE NULL,
    `workedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ticketId` VARCHAR(191) NULL,
    `siteId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TimeEntry_organizationId_workedAt_idx`(`organizationId`, `workedAt`),
    INDEX `TimeEntry_organizationId_userId_idx`(`organizationId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `currency` VARCHAR(191) NOT NULL DEFAULT 'BRL',
    `total` DOUBLE NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `siteId` VARCHAR(191) NULL,
    `dueDate` DATETIME(3) NULL,
    `issuedAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Invoice_organizationId_status_idx`(`organizationId`, `status`),
    UNIQUE INDEX `Invoice_organizationId_number_key`(`organizationId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InvoiceLine` (
    `id` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL DEFAULT 1,
    `unitPrice` DOUBLE NOT NULL,
    `amount` DOUBLE NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,

    INDEX `InvoiceLine_invoiceId_idx`(`invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TimeEntry` ADD CONSTRAINT `TimeEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TimeEntry` ADD CONSTRAINT `TimeEntry_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InvoiceLine` ADD CONSTRAINT `InvoiceLine_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
