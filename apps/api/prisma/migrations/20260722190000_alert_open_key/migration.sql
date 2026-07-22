-- Dedupe de alertas abertos: openKey único enquanto NEW/ACKNOWLEDGED
ALTER TABLE `Alert` ADD COLUMN `openKey` VARCHAR(191) NULL;

-- Remove duplicatas abertas (mantém o mais antigo por deviceId+metric)
DELETE a FROM `Alert` a
INNER JOIN `Alert` b
  ON a.deviceId = b.deviceId
  AND a.metric = b.metric
  AND a.deviceId IS NOT NULL
  AND a.metric IS NOT NULL
  AND a.status IN ('NEW', 'ACKNOWLEDGED')
  AND b.status IN ('NEW', 'ACKNOWLEDGED')
  AND a.createdAt > b.createdAt;

UPDATE `Alert`
SET `openKey` = CONCAT(`deviceId`, ':', `metric`)
WHERE `status` IN ('NEW', 'ACKNOWLEDGED')
  AND `deviceId` IS NOT NULL
  AND `metric` IS NOT NULL;

CREATE UNIQUE INDEX `Alert_openKey_key` ON `Alert`(`openKey`);
