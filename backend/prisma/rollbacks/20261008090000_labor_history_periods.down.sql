-- Reversión de 20261008090000_labor_history_periods (D-5). Una sola
-- transacción. Aborta si existe CUALQUIER fila de historia: borrar historia
-- no está autorizado (ORG_LOCATION_REORGANIZATION.md §19). Sólo sirve para
-- revertir la migración sobre una copia donde todavía no se registró nada.
-- Después de ejecutarla: `prisma migrate resolve --rolled-back 20261008090000_labor_history_periods`.
BEGIN;

DO $$
DECLARE
  total bigint;
BEGIN
  SELECT (SELECT count(*) FROM "EmployeePositionPeriod")
       + (SELECT count(*) FROM "EmployeeCostCenterPeriod")
       + (SELECT count(*) FROM "EmployeeLegacySectorPeriod")
       + (SELECT count(*) FROM "EmployeeEmployerPeriod")
       + (SELECT count(*) FROM "EmployeeEmployerPeriodCompany")
       + (SELECT count(*) FROM "PositionOrgScopePeriod")
       + (SELECT count(*) FROM "PositionOrgScopePeriodNode")
    INTO total;
  IF total > 0 THEN
    RAISE EXCEPTION 'Hay % fila(s) de historia temporal: la reversión borraría historia y se aborta.', total;
  END IF;
END $$;

DROP TABLE "PositionOrgScopePeriodNode";
DROP TABLE "PositionOrgScopePeriod";
DROP TABLE "EmployeeEmployerPeriodCompany";
DROP TABLE "EmployeeEmployerPeriod";
DROP TABLE "EmployeeLegacySectorPeriod";
DROP TABLE "EmployeeCostCenterPeriod";
DROP TABLE "EmployeePositionPeriod";

COMMIT;
