-- CreateEnum
CREATE TYPE "HourConceptLoadMode" AS ENUM ('MANUAL', 'AUTOMATIC', 'BOTH');

-- CreateEnum
CREATE TYPE "HourConceptBreakdownSource" AS ENUM ('MANUAL', 'AUTOMATIC');

-- AlterTable
ALTER TABLE "HourConcept" ADD COLUMN     "loadMode" "HourConceptLoadMode";

-- CreateTable
CREATE TABLE "HourConceptBreakdown" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "period" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "hourConceptId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "source" "HourConceptBreakdownSource" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'BORRADOR',
    "workShiftId" TEXT,
    "timeSegmentId" TEXT,
    "hourConceptRuleId" TEXT,
    "observation" TEXT,
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "HourConceptBreakdown_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HourConceptBreakdown_employeeId_period_idx" ON "HourConceptBreakdown"("employeeId", "period");

-- CreateIndex
CREATE INDEX "HourConceptBreakdown_employeeId_date_idx" ON "HourConceptBreakdown"("employeeId", "date");

-- CreateIndex
CREATE INDEX "HourConceptBreakdown_hourConceptId_period_idx" ON "HourConceptBreakdown"("hourConceptId", "period");

-- CreateIndex
CREATE INDEX "HourConceptBreakdown_workShiftId_idx" ON "HourConceptBreakdown"("workShiftId");

-- CreateIndex
CREATE INDEX "HourConceptBreakdown_timeSegmentId_idx" ON "HourConceptBreakdown"("timeSegmentId");

-- CreateIndex
CREATE INDEX "HourConceptBreakdown_hourConceptRuleId_idx" ON "HourConceptBreakdown"("hourConceptRuleId");

-- CreateIndex
CREATE INDEX "HourConceptBreakdown_createdByUserId_idx" ON "HourConceptBreakdown"("createdByUserId");

-- CreateIndex
CREATE INDEX "HourConceptBreakdown_approvedByUserId_idx" ON "HourConceptBreakdown"("approvedByUserId");

-- CreateIndex
CREATE INDEX "HourConceptBreakdown_period_status_idx" ON "HourConceptBreakdown"("period", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HourConceptBreakdown_timeSegmentId_hourConceptRuleId_hourCo_key" ON "HourConceptBreakdown"("timeSegmentId", "hourConceptRuleId", "hourConceptId", "source");

-- AddForeignKey
ALTER TABLE "HourConceptBreakdown" ADD CONSTRAINT "HourConceptBreakdown_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourConceptBreakdown" ADD CONSTRAINT "HourConceptBreakdown_hourConceptId_fkey" FOREIGN KEY ("hourConceptId") REFERENCES "HourConcept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourConceptBreakdown" ADD CONSTRAINT "HourConceptBreakdown_workShiftId_fkey" FOREIGN KEY ("workShiftId") REFERENCES "WorkShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourConceptBreakdown" ADD CONSTRAINT "HourConceptBreakdown_timeSegmentId_fkey" FOREIGN KEY ("timeSegmentId") REFERENCES "TimeSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourConceptBreakdown" ADD CONSTRAINT "HourConceptBreakdown_hourConceptRuleId_fkey" FOREIGN KEY ("hourConceptRuleId") REFERENCES "HourConceptRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourConceptBreakdown" ADD CONSTRAINT "HourConceptBreakdown_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourConceptBreakdown" ADD CONSTRAINT "HourConceptBreakdown_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
