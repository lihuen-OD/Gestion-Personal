-- CreateEnum
CREATE TYPE "WorkRegimeKind" AS ENUM ('TURNO_OBLIGATORIO', 'TURNO_FLEXIBLE', 'SIN_TURNO');

-- CreateEnum
CREATE TYPE "SegmentConceptStatus" AS ENUM ('SUGERIDO', 'MANUAL', 'SIN_CONCEPTO_COMPATIBLE', 'CONCEPTO_NO_HABILITADO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShiftAlertType" ADD VALUE 'CONCEPTO_NO_HABILITADO';
ALTER TYPE "ShiftAlertType" ADD VALUE 'SEGMENTO_SIN_CLASIFICAR';

-- AlterTable
ALTER TABLE "ShiftAssignment" ADD COLUMN     "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "effectiveTo" DATE,
ADD COLUMN     "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- Backfill: para asignaciones ya existentes, effectiveFrom se deriva del
-- assignedAt real (dato que ya representa "desde cuándo aplica esta
-- asignación"), en vez de quedar en la fecha en la que corre esta migración.
-- Corre una sola vez, inmediatamente después de agregar la columna, así que
-- en este punto toda fila existente todavía tiene el valor del DEFAULT.
UPDATE "ShiftAssignment" SET "effectiveFrom" = "assignedAt"::date;

-- AlterTable
ALTER TABLE "ShiftTemplate" ADD COLUMN     "criticalThresholdMinutes" INTEGER,
ADD COLUMN     "reviewThresholdMinutes" INTEGER NOT NULL DEFAULT 960,
ADD COLUMN     "warningThresholdMinutes" INTEGER NOT NULL DEFAULT 720;

-- AlterTable
ALTER TABLE "TimeSegment" ADD COLUMN     "conceptStatus" "SegmentConceptStatus" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "hourConceptRuleId" TEXT;

-- CreateTable
CREATE TABLE "HourConceptRule" (
    "id" TEXT NOT NULL,
    "hourConceptId" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "crossesMidnight" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVO',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "HourConceptRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkRegime" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WorkRegimeKind" NOT NULL,
    "alertOnOutOfShift" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVO',
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkRegime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeWorkRegime" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workRegimeId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "assignedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeWorkRegime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialHourRuleApplication" (
    "id" TEXT NOT NULL,
    "timeSegmentId" TEXT NOT NULL,
    "doubleHourRuleId" TEXT NOT NULL,
    "multiplierApplied" DECIMAL(4,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialHourRuleApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HourConceptRule_hourConceptId_status_idx" ON "HourConceptRule"("hourConceptId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkRegime_code_key" ON "WorkRegime"("code");

-- CreateIndex
CREATE INDEX "WorkRegime_status_idx" ON "WorkRegime"("status");

-- CreateIndex
CREATE INDEX "WorkRegime_kind_idx" ON "WorkRegime"("kind");

-- CreateIndex
CREATE INDEX "EmployeeWorkRegime_employeeId_effectiveFrom_idx" ON "EmployeeWorkRegime"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "SpecialHourRuleApplication_timeSegmentId_idx" ON "SpecialHourRuleApplication"("timeSegmentId");

-- AddForeignKey
ALTER TABLE "HourConceptRule" ADD CONSTRAINT "HourConceptRule_hourConceptId_fkey" FOREIGN KEY ("hourConceptId") REFERENCES "HourConcept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkRegime" ADD CONSTRAINT "WorkRegime_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkRegime" ADD CONSTRAINT "WorkRegime_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeWorkRegime" ADD CONSTRAINT "EmployeeWorkRegime_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeWorkRegime" ADD CONSTRAINT "EmployeeWorkRegime_workRegimeId_fkey" FOREIGN KEY ("workRegimeId") REFERENCES "WorkRegime"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeWorkRegime" ADD CONSTRAINT "EmployeeWorkRegime_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialHourRuleApplication" ADD CONSTRAINT "SpecialHourRuleApplication_timeSegmentId_fkey" FOREIGN KEY ("timeSegmentId") REFERENCES "TimeSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialHourRuleApplication" ADD CONSTRAINT "SpecialHourRuleApplication_doubleHourRuleId_fkey" FOREIGN KEY ("doubleHourRuleId") REFERENCES "DoubleHourRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSegment" ADD CONSTRAINT "TimeSegment_hourConceptRuleId_fkey" FOREIGN KEY ("hourConceptRuleId") REFERENCES "HourConceptRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
