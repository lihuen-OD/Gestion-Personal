-- M2 — contracción del modelo organizacional (docs/decisions/A8_M2_PREPARATION.md §12.3, §12.9.1;
-- ORG_LOCATION_REORGANIZATION.md §7). Se aplica SÓLO después de la limpieza controlada con F1 verde
-- (§7.2 paso 6). D-B2: sin purga — se conservan Sector.areaId, Area.establishmentId,
-- Establishment.companyId/businessUnitId, Position.sectorId y @@unique([companyId, code]): son la forma
-- de las filas archivadas.
--
--   * DROP de Employee.sectorId, User.sectorId y ClockDevice.sectorId (con sus FKs e índices), sólo
--     si están vacíos (la limpieza los vació; la evidencia del sector anterior vive en
--     EmployeeLegacySectorPeriod).
--   * CHECKs de forma por fila (nombres que verifica G6): archivado ⇒ sin padre nuevo; activo ⇒ con
--     padre nuevo.
--   * Único (zoneId, code) en Establishment (D-13); convive con (companyId, code) de los archivados.
--
-- Guarda previa: aborta SIN cambios si algún dato no cumple. Reversión (sólo antes de la recarga):
-- prisma/rollbacks/20261009150000_org_location_contract_m2.down.sql, sin pérdida porque las columnas
-- retiradas estaban vacías; después, org-reorg-restore con el respaldo de la limpieza.
DO $$
DECLARE
  problems text;
BEGIN
  SELECT string_agg(format('%s: %s', label, n), '; ' ORDER BY label)
    INTO problems
    FROM (
      SELECT 'Employee.sectorId con valor' AS label, count(*) AS n FROM "Employee" WHERE "sectorId" IS NOT NULL
      UNION ALL SELECT 'User.sectorId con valor', count(*) FROM "User" WHERE "sectorId" IS NOT NULL
      UNION ALL SELECT 'ClockDevice.sectorId con valor', count(*) FROM "ClockDevice" WHERE "sectorId" IS NOT NULL
      UNION ALL SELECT 'Sector con forma inválida (archivedAt vs businessUnitId)', count(*) FROM "Sector"
        WHERE NOT (("archivedAt" IS NOT NULL AND "businessUnitId" IS NULL) OR ("archivedAt" IS NULL AND "businessUnitId" IS NOT NULL))
      UNION ALL SELECT 'Area con forma inválida (archivedAt vs sectorId)', count(*) FROM "Area"
        WHERE NOT (("archivedAt" IS NOT NULL AND "sectorId" IS NULL) OR ("archivedAt" IS NULL AND "sectorId" IS NOT NULL))
      UNION ALL SELECT 'Establishment con forma inválida (archivedAt vs zoneId)', count(*) FROM "Establishment"
        WHERE NOT (("archivedAt" IS NOT NULL AND "zoneId" IS NULL) OR ("archivedAt" IS NULL AND "zoneId" IS NOT NULL))
      UNION ALL SELECT 'Establishment con (zoneId, code) repetido', count(*) FROM (
        SELECT 1 FROM "Establishment" WHERE "zoneId" IS NOT NULL GROUP BY "zoneId", code HAVING count(*) > 1
      ) duplicated
    ) checks
   WHERE n > 0;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'M2 no se aplica: %. Ejecutar antes la limpieza controlada con F1 verde (A8 §7.2).', problems;
  END IF;
END $$;

-- Columnas retiradas (vacías)
ALTER TABLE "Employee" DROP CONSTRAINT "Employee_sectorId_fkey";
DROP INDEX "Employee_status_sectorId_idx";
DROP INDEX "Employee_sectorId_idx";
ALTER TABLE "Employee" DROP COLUMN "sectorId";

ALTER TABLE "User" DROP CONSTRAINT "User_sectorId_fkey";
ALTER TABLE "User" DROP COLUMN "sectorId";

ALTER TABLE "ClockDevice" DROP CONSTRAINT "ClockDevice_sectorId_fkey";
DROP INDEX "ClockDevice_sectorId_idx";
ALTER TABLE "ClockDevice" DROP COLUMN "sectorId";

-- CHECKs de forma (Prisma no modela CHECK: se verifican con G6)
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_archive_shape_check"
  CHECK (("archivedAt" IS NOT NULL AND "businessUnitId" IS NULL) OR ("archivedAt" IS NULL AND "businessUnitId" IS NOT NULL));
ALTER TABLE "Area" ADD CONSTRAINT "Area_archive_shape_check"
  CHECK (("archivedAt" IS NOT NULL AND "sectorId" IS NULL) OR ("archivedAt" IS NULL AND "sectorId" IS NOT NULL));
ALTER TABLE "Establishment" ADD CONSTRAINT "Establishment_archive_shape_check"
  CHECK (("archivedAt" IS NOT NULL AND "zoneId" IS NULL) OR ("archivedAt" IS NULL AND "zoneId" IS NOT NULL));

-- D-13: unicidad del modelo nuevo
CREATE UNIQUE INDEX "Establishment_zoneId_code_key" ON "Establishment"("zoneId", "code");
