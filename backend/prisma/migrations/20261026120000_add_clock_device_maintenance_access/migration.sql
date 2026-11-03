-- Acceso de mantenimiento del fichador (docs/decisions/FICHADOR_MAINTENANCE_MODE.md).
-- Migración ADITIVA: columnas nulas (o con default 0) en "ClockDevice", sin
-- backfill. No toca fichadas, intentos ni auditoría. Ninguna fila queda con
-- código ni sesión al aplicarla, así que las CHECK se cumplen desde el inicio.

-- AlterTable
ALTER TABLE "ClockDevice" ADD COLUMN     "maintenanceCodeExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "maintenanceCodeFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "maintenanceCodeHash" TEXT,
ADD COLUMN     "maintenanceSessionExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "maintenanceSessionHash" TEXT;

-- CHECKs de forma (Prisma no modela CHECK): hash y vencimiento van juntos, y
-- sólo un dispositivo ACTIVE puede tener código o sesión de mantenimiento (la
-- revocación los limpia en el mismo UPDATE).
ALTER TABLE "ClockDevice" ADD CONSTRAINT "ClockDevice_maintenance_code_shape_check"
  CHECK (("maintenanceCodeHash" IS NULL) = ("maintenanceCodeExpiresAt" IS NULL));
ALTER TABLE "ClockDevice" ADD CONSTRAINT "ClockDevice_maintenance_session_shape_check"
  CHECK (("maintenanceSessionHash" IS NULL) = ("maintenanceSessionExpiresAt" IS NULL));
ALTER TABLE "ClockDevice" ADD CONSTRAINT "ClockDevice_maintenance_active_only_check"
  CHECK ("status" = 'ACTIVE' OR ("maintenanceCodeHash" IS NULL AND "maintenanceSessionHash" IS NULL));
