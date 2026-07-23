-- CreateEnum
CREATE TYPE "ShiftAssignmentStatus" AS ENUM ('HABILITADO', 'DESHABILITADO');

-- DropIndex
DROP INDEX "AttendancePunch_faceValidationStatus_idx";

-- DropIndex
DROP INDEX "AttendancePunch_photoStoragePath_idx";

-- AlterTable
ALTER TABLE "ShiftTemplate" ADD COLUMN     "absoluteOpenShiftLimitMinutes" INTEGER NOT NULL DEFAULT 1200,
ADD COLUMN     "categoryName" TEXT,
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "expectedMinutes" INTEGER,
ADD COLUMN     "maximumInformativeMinutes" INTEGER,
ADD COLUMN     "minimumMinutesForCompliance" INTEGER,
ADD COLUMN     "missingOutAlertAfterMinutes" INTEGER,
ADD COLUMN     "updatedByUserId" TEXT;

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftTemplateId" TEXT NOT NULL,
    "status" "ShiftAssignmentStatus" NOT NULL DEFAULT 'HABILITADO',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" TEXT,
    "disabledAt" TIMESTAMP(3),
    "disabledByUserId" TEXT,
    "observation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftAssignment_employeeId_status_idx" ON "ShiftAssignment"("employeeId", "status");

-- CreateIndex
CREATE INDEX "ShiftAssignment_shiftTemplateId_status_idx" ON "ShiftAssignment"("shiftTemplateId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftAssignment_employeeId_shiftTemplateId_key" ON "ShiftAssignment"("employeeId", "shiftTemplateId");

-- CreateIndex
CREATE INDEX "ShiftTemplate_categoryName_idx" ON "ShiftTemplate"("categoryName");

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "ShiftTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
