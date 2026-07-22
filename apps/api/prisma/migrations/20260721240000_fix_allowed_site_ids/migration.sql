-- Fix User.allowedSiteIds: empty string breaks Prisma Json deserialize (MariaDB longtext)
UPDATE `User` SET `allowedSiteIds` = '[]' WHERE `allowedSiteIds` IS NULL OR CAST(`allowedSiteIds` AS CHAR) = '';

-- Prefer native JSON when the engine supports it (MySQL 8 / MariaDB 10.2+)
ALTER TABLE `User` MODIFY `allowedSiteIds` JSON NOT NULL;
