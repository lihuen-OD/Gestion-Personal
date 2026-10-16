-- CreateEnum
CREATE TYPE "ClockPunchPostProcessKind" AS ENUM ('ENTRY', 'EXIT', 'ROLLOVER_ENTRY');

-- CreateEnum
CREATE TYPE "ClockPunchPostProcessJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ClockPunchPostProcessJob" (
    "id" TEXT NOT NULL,
    "attendancePunchId" TEXT NOT NULL,
    "workShiftId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "ClockPunchPostProcessKind" NOT NULL,
    "status" "ClockPunchPostProcessJobStatus" NOT NULL DEFAULT 'PENDING',
    "periods" TEXT[],
    "payload" JSONB NOT NULL,
    "stepsCompleted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClockPunchPostProcessJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClockPunchPostProcessJob_attendancePunchId_key" ON "ClockPunchPostProcessJob"("attendancePunchId");

-- CreateIndex
CREATE INDEX "ClockPunchPostProcessJob_status_nextAttemptAt_idx" ON "ClockPunchPostProcessJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ClockPunchPostProcessJob_status_leaseExpiresAt_idx" ON "ClockPunchPostProcessJob"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "ClockPunchPostProcessJob_workShiftId_createdAt_idx" ON "ClockPunchPostProcessJob"("workShiftId", "createdAt");

-- CreateIndex
CREATE INDEX "ClockPunchPostProcessJob_employeeId_status_idx" ON "ClockPunchPostProcessJob"("employeeId", "status");

-- AddForeignKey
ALTER TABLE "ClockPunchPostProcessJob" ADD CONSTRAINT "ClockPunchPostProcessJob_attendancePunchId_fkey" FOREIGN KEY ("attendancePunchId") REFERENCES "AttendancePunch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockPunchPostProcessJob" ADD CONSTRAINT "ClockPunchPostProcessJob_workShiftId_fkey" FOREIGN KEY ("workShiftId") REFERENCES "WorkShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockPunchPostProcessJob" ADD CONSTRAINT "ClockPunchPostProcessJob_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

