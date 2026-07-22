-- AlterTable
ALTER TABLE `Organization` ADD COLUMN `maxDevices` INTEGER NULL;

-- AlterTable
ALTER TABLE `RemoteSession` ADD COLUMN `auditEvents` JSON NOT NULL;

UPDATE `RemoteSession` SET `auditEvents` = JSON_ARRAY() WHERE `auditEvents` IS NULL OR JSON_TYPE(`auditEvents`) IS NULL;

-- AlterTable
ALTER TABLE `Script` ADD COLUMN `requiresApproval` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `ScriptExecution` ADD COLUMN `awaitingApproval` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `approvedById` VARCHAR(191) NULL,
    ADD COLUMN `approvedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `TicketAttachment` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `contentType` VARCHAR(191) NULL,
    `sizeBytes` INTEGER NULL,
    `dataBase64` LONGTEXT NOT NULL,
    `uploadedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TicketAttachment_ticketId_idx`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TicketAttachment` ADD CONSTRAINT `TicketAttachment_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
