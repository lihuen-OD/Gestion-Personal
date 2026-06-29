-- Extend Position with the complete frontend contract fields.
ALTER TABLE "Position" ADD COLUMN "areaDepartment" TEXT;
ALTER TABLE "Position" ADD COLUMN "sectorName" TEXT;
ALTER TABLE "Position" ADD COLUMN "businessUnitName" TEXT;
ALTER TABLE "Position" ADD COLUMN "establishmentName" TEXT;
ALTER TABLE "Position" ADD COLUMN "lastUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Position" ADD COLUMN "businessUnitNames" JSONB;
ALTER TABLE "Position" ADD COLUMN "establishmentNames" JSONB;
ALTER TABLE "Position" ADD COLUMN "sectorNames" JSONB;
ALTER TABLE "Position" ADD COLUMN "salaryRangeCategories" JSONB;
ALTER TABLE "Position" ADD COLUMN "responsibilities" JSONB;
ALTER TABLE "Position" ADD COLUMN "internalRelations" JSONB;
ALTER TABLE "Position" ADD COLUMN "externalRelations" JSONB;
ALTER TABLE "Position" ADD COLUMN "competencies" JSONB;
ALTER TABLE "Position" ADD COLUMN "workConditions" JSONB;
ALTER TABLE "Position" ADD COLUMN "performanceIndicators" JSONB;
ALTER TABLE "Position" ADD COLUMN "evaluationCriteria" JSONB;
