-- 2FA obrigatório por organização + anexos com object storage
ALTER TABLE `Organization` ADD COLUMN `requireTwoFactor` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `TicketAttachment` MODIFY `dataBase64` LONGTEXT NULL;
ALTER TABLE `TicketAttachment` ADD COLUMN `storageKey` VARCHAR(512) NULL;
