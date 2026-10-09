-- Reversión de 20261008150000_org_catalog_archive_classification. Una sola
-- transacción, con las seis tablas bloqueadas ANTES de comprobar nada (nadie
-- puede archivar ni reclasificar entre la comprobación y el DROP).
--
-- Aborta, sin tocar nada, si retirar las columnas perdería información:
--
--   1. `archivedAt` NOT NULL en cualquiera de las seis tablas: el archivo ya
--      se usó (limpieza B3, A8_M2_PREPARATION.md §12.1). Esa clasificación es
--      evidencia de G4/G7 y el conjunto archivado sólo se revierte con la
--      restauración controlada (`scripts/org-reorg-restore.ts`, que repone
--      `archivedAt = NULL` contra el respaldo y verifica V1 contra el
--      manifiesto previo). Esta reversión nunca la sustituye.
--   2. `isLegacy` de Area/Establishment distinto del criterio de lectura previo
--      (Area: `sectorId IS NULL`; Establishment: `zoneId IS NULL`): el código
--      anterior volvería a derivar la clasificación del padre ACTUAL y la fila
--      cambiaría de clase en silencio. Sólo se retira si la rederivación da
--      exactamente el mismo valor en todas las filas.
--
-- Fuera del alcance de las comprobaciones SQL (responsabilidad de quien la
-- ejecuta): revertir también el código a la versión previa a 28b3387, que lee
-- estas columnas; y, después, `prisma migrate resolve --rolled-back
-- 20261008150000_org_catalog_archive_classification`.
BEGIN;

LOCK TABLE "Company", "BusinessUnit", "Establishment", "Area", "Sector", "Position" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  archived text;
  reclassified text;
BEGIN
  SELECT string_agg(format('%s: %s', t, n), ', ' ORDER BY t)
    INTO archived
    FROM (
      SELECT 'Company' AS t, count(*) AS n FROM "Company" WHERE "archivedAt" IS NOT NULL
      UNION ALL SELECT 'BusinessUnit', count(*) FROM "BusinessUnit" WHERE "archivedAt" IS NOT NULL
      UNION ALL SELECT 'Establishment', count(*) FROM "Establishment" WHERE "archivedAt" IS NOT NULL
      UNION ALL SELECT 'Area', count(*) FROM "Area" WHERE "archivedAt" IS NOT NULL
      UNION ALL SELECT 'Sector', count(*) FROM "Sector" WHERE "archivedAt" IS NOT NULL
      UNION ALL SELECT 'Position', count(*) FROM "Position" WHERE "archivedAt" IS NOT NULL
    ) counts
   WHERE n > 0;
  IF archived IS NOT NULL THEN
    RAISE EXCEPTION 'El archivo ya se utilizó (%): retirar archivedAt perdería la clasificación archivada. Revertir primero con la restauración controlada (scripts/org-reorg-restore.ts).', archived;
  END IF;

  SELECT string_agg(format('%s: %s', t, n), ', ' ORDER BY t)
    INTO reclassified
    FROM (
      SELECT 'Area' AS t, count(*) AS n FROM "Area" WHERE "isLegacy" IS DISTINCT FROM ("sectorId" IS NULL)
      UNION ALL SELECT 'Establishment', count(*) FROM "Establishment" WHERE "isLegacy" IS DISTINCT FROM ("zoneId" IS NULL)
    ) counts
   WHERE n > 0;
  IF reclassified IS NOT NULL THEN
    RAISE EXCEPTION 'isLegacy persistido difiere del criterio de lectura previo (%): retirarlo reclasificaría esas filas en silencio. Se aborta.', reclassified;
  END IF;
END $$;

ALTER TABLE "Position" DROP COLUMN "archivedAt";
ALTER TABLE "Sector" DROP COLUMN "archivedAt";
ALTER TABLE "Area" DROP COLUMN "archivedAt";
ALTER TABLE "Establishment" DROP COLUMN "archivedAt";
ALTER TABLE "BusinessUnit" DROP COLUMN "archivedAt";
ALTER TABLE "Company" DROP COLUMN "archivedAt";

ALTER TABLE "Establishment" DROP COLUMN "isLegacy";
ALTER TABLE "Area" DROP COLUMN "isLegacy";

COMMIT;
