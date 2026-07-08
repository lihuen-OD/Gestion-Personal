-- Extend existing shift states and sources without rewriting current data.
ALTER TYPE "WorkShiftStatus" ADD VALUE IF NOT EXISTS 'FALTA_SALIDA';
ALTER TYPE "WorkShiftStatus" ADD VALUE IF NOT EXISTS 'FALTA_INGRESO';
ALTER TYPE "WorkShiftStatus" ADD VALUE IF NOT EXISTS 'INVALIDO';
ALTER TYPE "WorkShiftStatus" ADD VALUE IF NOT EXISTS 'REVISADO';
ALTER TYPE "WorkShiftStatus" ADD VALUE IF NOT EXISTS 'CERRADO_MANUAL';

ALTER TYPE "WorkShiftSource" ADD VALUE IF NOT EXISTS 'FACIAL';

CREATE TYPE "AttendancePunchType" AS ENUM ('INGRESO', 'SALIDA');
CREATE TYPE "AttendancePunchStatus" AS ENUM ('VALIDA', 'OBSERVADA', 'RECHAZADA');

ALTER TABLE "WorkShift"
  ADD COLUMN "startPunchId" TEXT,
  ADD COLUMN "endPunchId" TEXT,
  ADD COLUMN "crossesMidnight" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "maxAllowedMinutes" INTEGER NOT NULL DEFAULT 1200,
  ADD COLUMN "closedAt" TIMESTAMP(3);

ALTER TABLE "TimeEntry"
  ADD COLUMN "timeSegmentId" TEXT;

CREATE TABLE "AttendancePunch" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "type" "AttendancePunchType" NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "source" "WorkShiftSource" NOT NULL DEFAULT 'PORTAL_DNI',
  "deviceId" TEXT,
  "kioskId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "status" "AttendancePunchStatus" NOT NULL DEFAULT 'VALIDA',
  "observation" TEXT,
  "externalPunchId" TEXT,
  "rawPayload" JSONB,
  "biometricProvider" TEXT,
  "importedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AttendancePunch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TimeSegment" (
  "id" TEXT NOT NULL,
  "workShiftId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "fromDateTime" TIMESTAMP(3) NOT NULL,
  "toDateTime" TIMESTAMP(3) NOT NULL,
  "minutes" INTEGER NOT NULL,
  "hourConceptId" TEXT NOT NULL,
  "hourConceptName" TEXT NOT NULL,
  "isHoliday" BOOLEAN NOT NULL DEFAULT false,
  "isNight" BOOLEAN NOT NULL DEFAULT false,
  "isSpecial" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL DEFAULT 'CALCULATED',
  "observation" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TimeSegment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkShift_startPunchId_idx" ON "WorkShift"("startPunchId");
CREATE INDEX "WorkShift_endPunchId_idx" ON "WorkShift"("endPunchId");
CREATE INDEX "TimeEntry_timeSegmentId_idx" ON "TimeEntry"("timeSegmentId");

CREATE INDEX "AttendancePunch_employeeId_timestamp_idx" ON "AttendancePunch"("employeeId", "timestamp");
CREATE INDEX "AttendancePunch_type_status_idx" ON "AttendancePunch"("type", "status");
CREATE INDEX "AttendancePunch_source_idx" ON "AttendancePunch"("source");
CREATE INDEX "AttendancePunch_externalPunchId_idx" ON "AttendancePunch"("externalPunchId");

CREATE INDEX "TimeSegment_workShiftId_idx" ON "TimeSegment"("workShiftId");
CREATE INDEX "TimeSegment_employeeId_date_idx" ON "TimeSegment"("employeeId", "date");
CREATE INDEX "TimeSegment_hourConceptId_idx" ON "TimeSegment"("hourConceptId");

ALTER TABLE "AttendancePunch"
  ADD CONSTRAINT "AttendancePunch_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkShift"
  ADD CONSTRAINT "WorkShift_startPunchId_fkey"
  FOREIGN KEY ("startPunchId") REFERENCES "AttendancePunch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkShift"
  ADD CONSTRAINT "WorkShift_endPunchId_fkey"
  FOREIGN KEY ("endPunchId") REFERENCES "AttendancePunch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TimeSegment"
  ADD CONSTRAINT "TimeSegment_workShiftId_fkey"
  FOREIGN KEY ("workShiftId") REFERENCES "WorkShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeSegment"
  ADD CONSTRAINT "TimeSegment_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeSegment"
  ADD CONSTRAINT "TimeSegment_hourConceptId_fkey"
  FOREIGN KEY ("hourConceptId") REFERENCES "HourConcept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TimeEntry"
  ADD CONSTRAINT "TimeEntry_timeSegmentId_fkey"
  FOREIGN KEY ("timeSegmentId") REFERENCES "TimeSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
