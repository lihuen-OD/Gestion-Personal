-- CreateEnum
CREATE TYPE "HolidayWorkAssignmentStatus" AS ENUM ('ACTIVA', 'CANCELADA');

-- CreateTable
CREATE TABLE "HolidayWorkAssignment" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftTemplateId" TEXT,
    "expectedStartTime" TEXT,
    "expectedEndTime" TEXT,
    "notes" TEXT,
    "status" "HolidayWorkAssignmentStatus" NOT NULL DEFAULT 'ACTIVA',
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "HolidayWorkAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HolidayWorkAssignment_date_status_idx" ON "HolidayWorkAssignment"("date", "status");

-- CreateIndex
CREATE INDEX "HolidayWorkAssignment_employeeId_idx" ON "HolidayWorkAssignment"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "HolidayWorkAssignment_date_employeeId_key" ON "HolidayWorkAssignment"("date", "employeeId");

-- AddForeignKey
ALTER TABLE "HolidayWorkAssignment" ADD CONSTRAINT "HolidayWorkAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolidayWorkAssignment" ADD CONSTRAINT "HolidayWorkAssignment_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "ShiftTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolidayWorkAssignment" ADD CONSTRAINT "HolidayWorkAssignment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolidayWorkAssignment" ADD CONSTRAINT "HolidayWorkAssignment_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
