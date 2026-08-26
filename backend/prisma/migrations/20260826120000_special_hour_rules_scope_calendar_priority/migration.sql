-- AlterTable
ALTER TABLE "DoubleHourRule" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "costCenterId" TEXT,
ADD COLUMN     "positionId" TEXT,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sectorId" TEXT;

-- AlterTable
ALTER TABLE "SpecialHourRuleApplication" ADD COLUMN     "isWinner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wasConflicting" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SpecialHourRuleDate" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialHourRuleDate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialHourRuleDate_date_idx" ON "SpecialHourRuleDate"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialHourRuleDate_ruleId_date_key" ON "SpecialHourRuleDate"("ruleId", "date");

-- AddForeignKey
ALTER TABLE "DoubleHourRule" ADD CONSTRAINT "DoubleHourRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleHourRule" ADD CONSTRAINT "DoubleHourRule_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleHourRule" ADD CONSTRAINT "DoubleHourRule_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleHourRule" ADD CONSTRAINT "DoubleHourRule_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialHourRuleDate" ADD CONSTRAINT "SpecialHourRuleDate_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "DoubleHourRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
