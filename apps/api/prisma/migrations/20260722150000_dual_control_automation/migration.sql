-- Dual-control: quem pediu a execução + lastRun em automações
ALTER TABLE `ScriptExecution` ADD COLUMN `requestedById` VARCHAR(191) NULL;
CREATE INDEX `ScriptExecution_organizationId_awaitingApproval_idx` ON `ScriptExecution`(`organizationId`, `awaitingApproval`);
CREATE INDEX `ScriptExecution_organizationId_startedAt_idx` ON `ScriptExecution`(`organizationId`, `startedAt`);
ALTER TABLE `ScriptExecution` ADD CONSTRAINT `ScriptExecution_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `AutomationProfile` ADD COLUMN `lastRunAt` DATETIME(3) NULL;
CREATE INDEX `AutomationProfile_organizationId_enabled_idx` ON `AutomationProfile`(`organizationId`, `enabled`);
