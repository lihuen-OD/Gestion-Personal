CREATE TYPE "MonthlyClosureStatus" AS ENUM ('ABIERTO', 'ENVIADO', 'APROBADO', 'DEVUELTO', 'CORRECCION_PENDIENTE');
CREATE TYPE "CorrectionRequestStatus" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA');
CREATE TYPE "NotificationStatus" AS ENUM ('NO_LEIDA', 'LEIDA');
CREATE TYPE "ShiftAlertType" AS ENUM ('INGRESO_TARDE', 'SALIDA_ANTICIPADA', 'SALIDA_TARDIA', 'TURNO_NO_IDENTIFICADO');
CREATE TYPE "ShiftAlertStatus" AS ENUM ('PENDIENTE', 'RESUELTA');
CREATE TYPE "RecurrenceType" AS ENUM ('FECHA', 'RANGO', 'SEMANAL');

ALTER TABLE "TimeEntry" ADD COLUMN "actualMinutes" INTEGER,
ADD COLUMN "appliedMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 1;
UPDATE "TimeEntry" SET "actualMinutes" = "totalMinutes" WHERE "actualMinutes" IS NULL;
ALTER TABLE "WorkShift" ADD COLUMN "shiftTemplateId" TEXT;

CREATE TABLE "MonthlyTimeClosure" (
  "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "period" TEXT NOT NULL,
  "status" "MonthlyClosureStatus" NOT NULL DEFAULT 'ABIERTO', "snapshot" JSONB,
  "submittedByUserId" TEXT, "submittedAt" TIMESTAMP(3), "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3), "reviewNote" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "MonthlyTimeClosure_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TimeCorrectionRequest" (
  "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "timeEntryId" TEXT NOT NULL, "closureId" TEXT,
  "previousHours" DECIMAL(8,2) NOT NULL, "proposedHours" DECIMAL(8,2) NOT NULL, "reason" TEXT NOT NULL,
  "status" "CorrectionRequestStatus" NOT NULL DEFAULT 'PENDIENTE', "createdByUserId" TEXT NOT NULL,
  "reviewedByUserId" TEXT, "reviewedAt" TIMESTAMP(3), "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TimeCorrectionRequest_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SystemNotification" (
  "id" TEXT NOT NULL, "recipientUserId" TEXT NOT NULL, "type" TEXT NOT NULL, "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "title" TEXT NOT NULL, "message" TEXT NOT NULL, "entityType" TEXT, "entityId" TEXT, "link" TEXT,
  "status" "NotificationStatus" NOT NULL DEFAULT 'NO_LEIDA', "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SystemNotification_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ShiftTemplate" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "startTime" TEXT NOT NULL, "endTime" TEXT NOT NULL,
  "crossesMidnight" BOOLEAN NOT NULL DEFAULT false, "entryToleranceMinutes" INTEGER NOT NULL DEFAULT 10,
  "exitToleranceMinutes" INTEGER NOT NULL DEFAULT 20, "detectionWindowMinutes" INTEGER NOT NULL DEFAULT 180,
  "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVO', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ShiftAlert" (
  "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "workShiftId" TEXT NOT NULL, "type" "ShiftAlertType" NOT NULL,
  "status" "ShiftAlertStatus" NOT NULL DEFAULT 'PENDIENTE', "scheduledAt" TIMESTAMP(3), "actualAt" TIMESTAMP(3) NOT NULL,
  "differenceMinutes" INTEGER, "resolvedAt" TIMESTAMP(3), "resolvedByUserId" TEXT, "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ShiftAlert_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "DoubleHourRule" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "recurrenceType" "RecurrenceType" NOT NULL, "fromDate" TIMESTAMP(3) NOT NULL,
  "toDate" TIMESTAMP(3), "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[], "multiplier" DECIMAL(4,2) NOT NULL DEFAULT 2,
  "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVO', "reason" TEXT NOT NULL, "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DoubleHourRule_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "DoubleHourRuleEmployee" (
  "ruleId" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
  CONSTRAINT "DoubleHourRuleEmployee_pkey" PRIMARY KEY ("ruleId", "employeeId")
);

CREATE UNIQUE INDEX "MonthlyTimeClosure_employeeId_period_key" ON "MonthlyTimeClosure"("employeeId", "period");
CREATE INDEX "MonthlyTimeClosure_period_status_idx" ON "MonthlyTimeClosure"("period", "status");
CREATE INDEX "TimeCorrectionRequest_status_createdAt_idx" ON "TimeCorrectionRequest"("status", "createdAt");
CREATE INDEX "TimeCorrectionRequest_employeeId_status_idx" ON "TimeCorrectionRequest"("employeeId", "status");
CREATE INDEX "SystemNotification_recipientUserId_status_createdAt_idx" ON "SystemNotification"("recipientUserId", "status", "createdAt");
CREATE UNIQUE INDEX "ShiftTemplate_code_key" ON "ShiftTemplate"("code");
CREATE INDEX "ShiftTemplate_status_idx" ON "ShiftTemplate"("status");
CREATE UNIQUE INDEX "ShiftAlert_workShiftId_type_key" ON "ShiftAlert"("workShiftId", "type");
CREATE INDEX "ShiftAlert_employeeId_status_createdAt_idx" ON "ShiftAlert"("employeeId", "status", "createdAt");
CREATE INDEX "DoubleHourRule_status_fromDate_toDate_idx" ON "DoubleHourRule"("status", "fromDate", "toDate");
CREATE INDEX "DoubleHourRuleEmployee_employeeId_idx" ON "DoubleHourRuleEmployee"("employeeId");
CREATE INDEX "WorkShift_shiftTemplateId_idx" ON "WorkShift"("shiftTemplateId");

ALTER TABLE "WorkShift" ADD CONSTRAINT "WorkShift_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "ShiftTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MonthlyTimeClosure" ADD CONSTRAINT "MonthlyTimeClosure_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonthlyTimeClosure" ADD CONSTRAINT "MonthlyTimeClosure_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MonthlyTimeClosure" ADD CONSTRAINT "MonthlyTimeClosure_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimeCorrectionRequest" ADD CONSTRAINT "TimeCorrectionRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeCorrectionRequest" ADD CONSTRAINT "TimeCorrectionRequest_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "TimeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeCorrectionRequest" ADD CONSTRAINT "TimeCorrectionRequest_closureId_fkey" FOREIGN KEY ("closureId") REFERENCES "MonthlyTimeClosure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimeCorrectionRequest" ADD CONSTRAINT "TimeCorrectionRequest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimeCorrectionRequest" ADD CONSTRAINT "TimeCorrectionRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SystemNotification" ADD CONSTRAINT "SystemNotification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftAlert" ADD CONSTRAINT "ShiftAlert_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftAlert" ADD CONSTRAINT "ShiftAlert_workShiftId_fkey" FOREIGN KEY ("workShiftId") REFERENCES "WorkShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DoubleHourRuleEmployee" ADD CONSTRAINT "DoubleHourRuleEmployee_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "DoubleHourRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DoubleHourRuleEmployee" ADD CONSTRAINT "DoubleHourRuleEmployee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
