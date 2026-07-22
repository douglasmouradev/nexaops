-- Stripe session id on invoices
ALTER TABLE `Invoice` ADD COLUMN `stripeSessionId` VARCHAR(191) NULL;
