-- Reversión de 20261009150000_org_location_contract_m2. Una transacción.
--
-- SIN pérdida de datos: M2 sólo pudo retirar Employee/User/ClockDevice.sectorId si estaban VACÍAS
-- (su guarda lo exige), así que se recrean vacías con sus FKs e índices; los CHECKs de forma y el
-- único (zoneId, code) se retiran (no contienen datos).
--
-- También borra la fila de M2 de `_prisma_migrations`: el esquema vuelve EXACTAMENTE al estado previo
-- y `prisma migrate status` vuelve a mostrar M2 pendiente. (`prisma migrate resolve --rolled-back`
-- no sirve acá: sólo aplica a migraciones fallidas, P3012.)
--
-- Uso previsto: recuperar el estado previo a la limpieza ANTES de la recarga.
--   1. esta reversión → 2. `org-reorg-restore` con el respaldo de la limpieza (que se NIEGA mientras
--   falten estas columnas) → 3. comparación con el manifiesto previo a la limpieza.
-- Después de la recarga (datos nuevos en el esquema final) la vía es restaurar la rama o el pg_dump
-- de respaldo, no esta reversión.
BEGIN;

LOCK TABLE "Employee", "User", "ClockDevice", "Sector", "Area", "Establishment" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "Establishment" DROP CONSTRAINT IF EXISTS "Establishment_archive_shape_check";
ALTER TABLE "Area" DROP CONSTRAINT IF EXISTS "Area_archive_shape_check";
ALTER TABLE "Sector" DROP CONSTRAINT IF EXISTS "Sector_archive_shape_check";
DROP INDEX IF EXISTS "Establishment_zoneId_code_key";

ALTER TABLE "Employee" ADD COLUMN "sectorId" TEXT;
CREATE INDEX "Employee_sectorId_idx" ON "Employee"("sectorId");
CREATE INDEX "Employee_status_sectorId_idx" ON "Employee"("status", "sectorId");
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "sectorId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ClockDevice" ADD COLUMN "sectorId" TEXT;
CREATE INDEX "ClockDevice_sectorId_idx" ON "ClockDevice"("sectorId");
ALTER TABLE "ClockDevice" ADD CONSTRAINT "ClockDevice_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261009150000_org_location_contract_m2';

COMMIT;
