-- Reversión de 20261121090000_attendance_incident_block_key (R4.3a,
-- docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.4).
-- Una sola transacción, con la tabla bloqueada antes de comprobar nada.
--
-- Aborta sin cambios si existe algún incidente POR BLOQUE
-- ("scheduledStartAt" no nulo): la unicidad por (empleado, fecha) no puede
-- representar varios incidentes del mismo día, y esos incidentes (con su
-- estado de revisión y sus avisos) son historia. Resolverlos o eliminarlos por
-- su procedimiento controlado antes de revertir; nunca forzar este rollback.
-- Con sólo incidentes de día (scheduledStartAt NULL), ninguna fila cambia.
--
-- También borra la fila de esta migración de `_prisma_migrations` (patrón de
-- 20261009150000_org_location_contract_m2 y 20261120180000): el schema vuelve
-- EXACTAMENTE al anterior y `prisma migrate status` la vuelve a mostrar
-- pendiente (`prisma migrate resolve --rolled-back` sólo aplica a migraciones
-- fallidas, P3012).
--
-- Fuera del alcance de SQL: revertir antes el código que lee/escribe
-- "scheduledStartAt" (R4.3b+). Orden: debe correr antes que los rollbacks de
-- 20261120180000 y 20261120120000.
BEGIN;

LOCK TABLE "AttendanceInactivityIncident" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  with_block integer;
  duplicated integer;
BEGIN
  SELECT count(*) INTO with_block FROM "AttendanceInactivityIncident" WHERE "scheduledStartAt" IS NOT NULL;
  IF with_block > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % incidente(s) por bloque (scheduledStartAt no nulo). Resolverlos o eliminarlos por su procedimiento controlado antes de revertir.', with_block;
  END IF;
  SELECT count(*) INTO duplicated FROM (
    SELECT 1 FROM "AttendanceInactivityIncident" GROUP BY "employeeId", "operationalDate" HAVING count(*) > 1
  ) AS duplicates;
  IF duplicated > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % par(es) (empleado, fecha) repetidos.', duplicated;
  END IF;
END $$;

-- La unicidad anterior vuelve ANTES de quitar la nueva (nunca sin unicidad).
CREATE UNIQUE INDEX "AttendanceInactivityIncident_employeeId_operationalDate_key" ON "AttendanceInactivityIncident"("employeeId", "operationalDate");
DROP INDEX "AttendanceInactivityIncident_block_key";
ALTER TABLE "AttendanceInactivityIncident" DROP COLUMN "scheduledStartAt";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261121090000_attendance_incident_block_key';

COMMIT;
