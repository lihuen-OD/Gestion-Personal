-- AlterTable
ALTER TABLE "NoveltyType" ALTER COLUMN "allowedLoadRoles" SET DEFAULT '[]',
ALTER COLUMN "approvalRoles" SET DEFAULT '[]';

-- CreateIndex
CREATE INDEX "DocumentCategory_status_idx" ON "DocumentCategory"("status");

-- CreateIndex
CREATE INDEX "HourConcept_status_idx" ON "HourConcept"("status");

-- CreateIndex
CREATE INDEX "LaborMovement_employeeId_type_idx" ON "LaborMovement"("employeeId", "type");

-- CreateIndex
CREATE INDEX "NoveltyType_status_idx" ON "NoveltyType"("status");

-- CreateIndex
CREATE INDEX "Position_status_idx" ON "Position"("status");

-- CreateIndex
CREATE INDEX "Position_areaId_sectorId_idx" ON "Position"("areaId", "sectorId");

-- CreateIndex
CREATE INDEX "SalaryCategory_status_idx" ON "SalaryCategory"("status");

-- CreateIndex
CREATE INDEX "TimeEntry_status_period_idx" ON "TimeEntry"("status", "period");
