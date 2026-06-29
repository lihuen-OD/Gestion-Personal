-- Employee field/block history used by Legajo detail cards.
-- This is separate from global AuditLog because users need business-effective dates.

CREATE TABLE "EmployeeFieldHistory" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "section" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "fieldLabel" TEXT NOT NULL,
  "oldValue" TEXT,
  "newValue" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmployeeFieldHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeeBlockHistory" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "section" TEXT NOT NULL,
  "block" TEXT NOT NULL,
  "blockLabel" TEXT NOT NULL,
  "oldValue" TEXT,
  "newValue" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmployeeBlockHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeFieldHistory_employeeId_section_field_idx" ON "EmployeeFieldHistory"("employeeId", "section", "field");
CREATE INDEX "EmployeeFieldHistory_effectiveFrom_idx" ON "EmployeeFieldHistory"("effectiveFrom");
CREATE INDEX "EmployeeBlockHistory_employeeId_section_block_idx" ON "EmployeeBlockHistory"("employeeId", "section", "block");
CREATE INDEX "EmployeeBlockHistory_effectiveFrom_idx" ON "EmployeeBlockHistory"("effectiveFrom");

ALTER TABLE "EmployeeFieldHistory"
  ADD CONSTRAINT "EmployeeFieldHistory_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmployeeFieldHistory"
  ADD CONSTRAINT "EmployeeFieldHistory_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmployeeBlockHistory"
  ADD CONSTRAINT "EmployeeBlockHistory_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmployeeBlockHistory"
  ADD CONSTRAINT "EmployeeBlockHistory_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
