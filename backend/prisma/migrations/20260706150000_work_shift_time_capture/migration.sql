CREATE TYPE "WorkShiftStatus" AS ENUM ('PROCESADO', 'OBSERVADO', 'ANULADO');

CREATE TYPE "WorkShiftSource" AS ENUM ('ADMIN', 'PORTAL_DNI', 'KIOSK', 'BIOTIME');

CREATE TABLE "WorkShift" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "source" "WorkShiftSource" NOT NULL DEFAULT 'ADMIN',
  "status" "WorkShiftStatus" NOT NULL DEFAULT 'PROCESADO',
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "totalMinutes" INTEGER NOT NULL,
  "observation" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkShift_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TimeEntry"
ADD COLUMN "workShiftId" TEXT,
ADD COLUMN "segmentStartAt" TIMESTAMP(3),
ADD COLUMN "segmentEndAt" TIMESTAMP(3),
ADD COLUMN "source" "WorkShiftSource";

CREATE INDEX "WorkShift_employeeId_startAt_idx" ON "WorkShift"("employeeId", "startAt");
CREATE INDEX "WorkShift_employeeId_endAt_idx" ON "WorkShift"("employeeId", "endAt");
CREATE INDEX "WorkShift_status_idx" ON "WorkShift"("status");
CREATE INDEX "WorkShift_source_idx" ON "WorkShift"("source");
CREATE INDEX "TimeEntry_workShiftId_idx" ON "TimeEntry"("workShiftId");

ALTER TABLE "WorkShift"
ADD CONSTRAINT "WorkShift_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeEntry"
ADD CONSTRAINT "TimeEntry_workShiftId_fkey"
FOREIGN KEY ("workShiftId") REFERENCES "WorkShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
