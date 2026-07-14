CREATE TYPE "ClockPunchAttemptStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "ClockPunchAttempt" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "punchType" "AttendancePunchType" NOT NULL,
    "status" "ClockPunchAttemptStatus" NOT NULL DEFAULT 'PROCESSING',
    "requestHash" TEXT NOT NULL,
    "response" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "httpStatus" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClockPunchAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClockPunchAttempt_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ClockPunchAttempt_requestId_key" ON "ClockPunchAttempt"("requestId");
CREATE INDEX "ClockPunchAttempt_employeeId_startedAt_idx" ON "ClockPunchAttempt"("employeeId", "startedAt");
CREATE INDEX "ClockPunchAttempt_status_startedAt_idx" ON "ClockPunchAttempt"("status", "startedAt");

-- Database-level protection against concurrent requests opening two shifts.
CREATE UNIQUE INDEX "WorkShift_one_open_per_employee"
ON "WorkShift"("employeeId")
WHERE "status" = 'ABIERTO' AND "endAt" IS NULL;
