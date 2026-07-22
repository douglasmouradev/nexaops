-- AlterTable
ALTER TABLE `Device` ADD COLUMN `agentAuthToken` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Device_agentAuthToken_key` ON `Device`(`agentAuthToken`);
