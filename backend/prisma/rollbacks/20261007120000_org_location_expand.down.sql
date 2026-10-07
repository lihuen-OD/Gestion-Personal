-- Reversión de M1 (20261007120000_org_location_expand).
-- docs/decisions/ORG_LOCATION_REORGANIZATION.md §7.
--
-- Sólo es válida mientras no existan datos del modelo nuevo. Si existen,
-- aborta sin tocar nada: revertir borraría información, y en ese caso la
-- reversión es restaurar la rama/respaldo.
--
-- Se ejecuta a mano, en una única transacción, contra la base verificada
-- (nunca producción). Quita además la fila de _prisma_migrations para que la
-- migración pueda volver a aplicarse.
-- La extensión btree_gist se conserva (la migración la crea con IF NOT
-- EXISTS y otra estructura podría usarla).

BEGIN;

DO $$
DECLARE
  new_rows bigint;
  null_companies bigint;
BEGIN
  SELECT
      (SELECT count(*) FROM "Zone")
    + (SELECT count(*) FROM "PositionOrgScope")
    + (SELECT count(*) FROM "EmployeeWorkLocation")
    + (SELECT count(*) FROM "EmployeeWorkLocationEstablishment")
    + (SELECT count(*) FROM "Sector" WHERE "businessUnitId" IS NOT NULL)
    + (SELECT count(*) FROM "Area" WHERE "sectorId" IS NOT NULL)
    + (SELECT count(*) FROM "Establishment" WHERE "zoneId" IS NOT NULL)
    + (SELECT count(*) FROM "ClockDevice" WHERE "establishmentId" IS NOT NULL)
  INTO new_rows;
  SELECT count(*) FROM "Establishment" WHERE "companyId" IS NULL INTO null_companies;

  IF new_rows > 0 OR null_companies > 0 THEN
    RAISE EXCEPTION 'Reversión de M1 abortada: hay % registros/valores del modelo nuevo y % establecimientos sin companyId. Revertir borraría datos; usar el respaldo.', new_rows, null_companies;
  END IF;
END $$;

-- DoubleHourRule: vuelve a ON DELETE SET NULL (comportamiento previo a M1).
ALTER TABLE "DoubleHourRule" DROP CONSTRAINT "DoubleHourRule_companyId_fkey";
ALTER TABLE "DoubleHourRule" DROP CONSTRAINT "DoubleHourRule_sectorId_fkey";
ALTER TABLE "DoubleHourRule" DROP CONSTRAINT "DoubleHourRule_costCenterId_fkey";
ALTER TABLE "DoubleHourRule" DROP CONSTRAINT "DoubleHourRule_positionId_fkey";
ALTER TABLE "DoubleHourRule" ADD CONSTRAINT "DoubleHourRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DoubleHourRule" ADD CONSTRAINT "DoubleHourRule_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DoubleHourRule" ADD CONSTRAINT "DoubleHourRule_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DoubleHourRule" ADD CONSTRAINT "DoubleHourRule_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE "EmployeeWorkLocationEstablishment";
DROP TABLE "EmployeeWorkLocation";
DROP TABLE "PositionOrgScope";

ALTER TABLE "ClockDevice" DROP CONSTRAINT "ClockDevice_establishmentId_fkey";
DROP INDEX "ClockDevice_establishmentId_idx";
ALTER TABLE "ClockDevice" DROP COLUMN "establishmentId";

ALTER TABLE "Sector" DROP CONSTRAINT "Sector_businessUnitId_fkey";
DROP INDEX "Sector_businessUnitId_idx";
ALTER TABLE "Sector" DROP COLUMN "businessUnitId";

ALTER TABLE "Area" DROP CONSTRAINT "Area_sectorId_fkey";
DROP INDEX "Area_sectorId_idx";
ALTER TABLE "Area" DROP COLUMN "sectorId";

ALTER TABLE "Establishment" DROP CONSTRAINT "Establishment_zoneId_fkey";
DROP INDEX "Establishment_zoneId_idx";
ALTER TABLE "Establishment" DROP COLUMN "zoneId";
ALTER TABLE "Establishment" ALTER COLUMN "companyId" SET NOT NULL;

DROP TABLE "Zone";
DROP TYPE "OrgScopeLevel";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261007120000_org_location_expand';

COMMIT;
