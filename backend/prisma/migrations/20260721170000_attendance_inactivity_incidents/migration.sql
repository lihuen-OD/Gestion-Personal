CREATE TABLE "AttendanceInactivityIncident" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "operationalDate" DATE NOT NULL,
    "status" "AttendanceReviewStatus" NOT NULL DEFAULT 'PENDIENTE',
    "observation" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewNote" TEXT,

    CONSTRAINT "AttendanceInactivityIncident_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendanceInactivityIncident_employeeId_operationalDate_key"
ON "AttendanceInactivityIncident"("employeeId", "operationalDate");

CREATE INDEX "AttendanceInactivityIncident_status_operationalDate_idx"
ON "AttendanceInactivityIncident"("status", "operationalDate");

CREATE INDEX "AttendanceInactivityIncident_employeeId_status_idx"
ON "AttendanceInactivityIncident"("employeeId", "status");

ALTER TABLE "AttendanceInactivityIncident"
ADD CONSTRAINT "AttendanceInactivityIncident_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendanceInactivityIncident"
ADD CONSTRAINT "AttendanceInactivityIncident_reviewedByUserId_fkey"
FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
