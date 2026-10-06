-- F4 del fichador standalone (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md
-- §22): identidad individual de cada dispositivo de fichada.
--
-- Sólo agrega estructura: no crea ningún ClockDevice, no toca filas
-- existentes y no borra columnas. AttendancePunch.deviceId (columna ya
-- existente, nunca escrita por el código) pasa a ser FK a ClockDevice;
-- AttendancePunch.kioskId queda como legado hasta F12.
--
-- Diagnóstico previo en la base configurada (2026-10-06, read-only): 79 AttendancePunch,
-- 0 con deviceId, 0 con kioskId. Si en otro entorno hubiera valores, la FK
-- o la retirada futura de kioskId requerirían una decisión explícita: la
-- migración se detiene acá con un mensaje claro y no aplica nada.
DO $$
DECLARE
  with_device integer;
  with_kiosk integer;
BEGIN
  SELECT count(*) INTO with_device FROM "AttendancePunch" WHERE "deviceId" IS NOT NULL;
  SELECT count(*) INTO with_kiosk FROM "AttendancePunch" WHERE "kioskId" IS NOT NULL;
  IF with_device > 0 OR with_kiosk > 0 THEN
    RAISE EXCEPTION 'F4 ClockDevice: AttendancePunch contiene valores históricos (deviceId: %, kioskId: %). Revisarlos antes de migrar; no se crean dispositivos históricos.', with_device, with_kiosk;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "ClockDeviceStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "ClockDevice" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "status" "ClockDeviceStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "pairingCodeHash" TEXT,
    "pairingExpiresAt" TIMESTAMPTZ(3),
    "sectorId" TEXT,
    "activatedAt" TIMESTAMPTZ(3),
    "activatedByUserId" TEXT,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedByUserId" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3),
    "lastIp" TEXT,
    "lastUserAgent" TEXT,
    "lastAppVersion" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClockDevice_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ClockPunchAttempt" ADD COLUMN "deviceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ClockDevice_tokenHash_key" ON "ClockDevice"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ClockDevice_pairingCodeHash_key" ON "ClockDevice"("pairingCodeHash");

-- CreateIndex
CREATE INDEX "ClockDevice_status_lastSeenAt_idx" ON "ClockDevice"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "ClockDevice_sectorId_idx" ON "ClockDevice"("sectorId");

-- CreateIndex
CREATE INDEX "AttendancePunch_deviceId_timestamp_idx" ON "AttendancePunch"("deviceId", "timestamp");

-- CreateIndex
CREATE INDEX "ClockPunchAttempt_deviceId_startedAt_idx" ON "ClockPunchAttempt"("deviceId", "startedAt");

-- AddForeignKey
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ClockDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockPunchAttempt" ADD CONSTRAINT "ClockPunchAttempt_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ClockDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockDevice" ADD CONSTRAINT "ClockDevice_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockDevice" ADD CONSTRAINT "ClockDevice_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockDevice" ADD CONSTRAINT "ClockDevice_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
