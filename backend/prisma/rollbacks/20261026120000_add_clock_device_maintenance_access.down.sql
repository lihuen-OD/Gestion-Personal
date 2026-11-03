-- Reversión de 20261026120000_add_clock_device_maintenance_access. Una sola
-- transacción, con "ClockDevice" bloqueada antes de tocar nada.
--
-- No aborta: las columnas sólo guardan estado efímero (un código vence a los
-- 5 min y una sesión a los 10 min) y la historia del acceso de mantenimiento
-- vive en "AuditLog" (entidad ClockDeviceMaintenance), que no se toca. Borrarlas
-- sólo invalida los accesos en curso.
--
-- Fuera del alcance de SQL (responsabilidad de quien la ejecuta): revertir
-- antes el código que lee y escribe estas columnas (la revocación las limpia)
-- y, después, `prisma migrate resolve --rolled-back
-- 20261026120000_add_clock_device_maintenance_access`.
BEGIN;

LOCK TABLE "ClockDevice" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "ClockDevice" DROP CONSTRAINT IF EXISTS "ClockDevice_maintenance_active_only_check";
ALTER TABLE "ClockDevice" DROP CONSTRAINT IF EXISTS "ClockDevice_maintenance_session_shape_check";
ALTER TABLE "ClockDevice" DROP CONSTRAINT IF EXISTS "ClockDevice_maintenance_code_shape_check";

ALTER TABLE "ClockDevice"
  DROP COLUMN "maintenanceCodeExpiresAt",
  DROP COLUMN "maintenanceCodeFailedAttempts",
  DROP COLUMN "maintenanceCodeHash",
  DROP COLUMN "maintenanceSessionExpiresAt",
  DROP COLUMN "maintenanceSessionHash";

COMMIT;
