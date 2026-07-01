ALTER TABLE "User" ADD COLUMN "employeeId" TEXT;

ALTER TABLE "EmployeeAssignment" ADD COLUMN "role" TEXT;
ALTER TABLE "EmployeeAssignment" ADD COLUMN "effectiveFrom" TIMESTAMP(3);
ALTER TABLE "EmployeeAssignment" ADD COLUMN "effectiveTo" TIMESTAMP(3);
ALTER TABLE "EmployeeAssignment" ADD COLUMN "status" TEXT;
ALTER TABLE "EmployeeAssignment" ADD COLUMN "notes" TEXT;

CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");
CREATE INDEX "EmployeeAssignment_userId_idx" ON "EmployeeAssignment"("userId");

ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
