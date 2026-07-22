-- AlterTable
ALTER TABLE `Organization` ADD COLUMN `alertWebhookUrl` TEXT NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `notifyAlertSeverities` VARCHAR(191) NOT NULL DEFAULT 'CRITICAL';
